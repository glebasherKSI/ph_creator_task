/** Отчёт Reports: проекты, фильтры периода/проекта, загрузка с защитой от устаревших ответов. */
import { useCallback, useEffect, useRef, useState } from "react";

import { sendMessage } from "@/lib/messaging";
import {
  type ReportRow,
  type ReportsPayload,
  type ReportsProject,
  buildReportsPayload,
  extractReportCountAll,
  extractReportsProjects,
  formatReportsFetchError,
  inferProjectIdFromDomain,
  normalizeProjectId,
  normalizeReportRows,
} from "@/lib/reports";

export interface StatsFilters {
  from: string;
  to: string;
  /** Явно выбранный проект; пусто — берём по домену. */
  projectId: string;
}

export interface StatsReportState {
  filters: StatsFilters;
  setFilters: (patch: Partial<StatsFilters>) => void;
  /** Проект, с которым реально ходим в отчёт (фильтр или по домену). */
  effectiveProjectId: string;
  projects: { list: ReportsProject[]; loading: boolean; loaded: boolean; error: string };
  loadProjects: (opts?: { force?: boolean }) => Promise<void>;
  rows: ReportRow[];
  countAll: number | null;
  payload: ReportsPayload | null;
  updatedAt: string;
  loading: boolean;
  error: string;
  /** Загрузка отчёта по текущим фильтрам (с небольшой задержкой — debounce). */
  reload: (delayMs?: number) => void;
}

const DEBOUNCE_MS = 250;

export function useStatsReport(domain: string): StatsReportState {
  const [filters, setFiltersState] = useState<StatsFilters>({ from: "", to: "", projectId: "" });
  const [projects, setProjects] = useState({
    list: [] as ReportsProject[],
    loading: false,
    loaded: false,
    error: "",
    activeProjectId: "",
  });
  const [report, setReport] = useState({
    rows: [] as ReportRow[],
    countAll: null as number | null,
    payload: null as ReportsPayload | null,
    updatedAt: "",
    loading: false,
    error: "",
  });
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const inferred = inferProjectIdFromDomain(domain);
  const effectiveProjectId = normalizeProjectId(
    filters.projectId || inferred || projects.activeProjectId,
  );

  const setFilters = useCallback(
    (patch: Partial<StatsFilters>) => setFiltersState((prev) => ({ ...prev, ...patch })),
    [],
  );

  const loadProjects = useCallback(
    async ({ force = false }: { force?: boolean } = {}) => {
      if (projects.loading || (projects.loaded && !force)) return;
      setProjects((prev) => ({ ...prev, loading: true, error: "" }));
      try {
        const result = await sendMessage("PH_REPORTS_STATE", undefined, { timeoutMs: 30_000 });
        if (!result?.ok) {
          const err = result as { errorCode?: string; error?: string } | undefined;
          throw new Error(err?.errorCode || err?.error || "REPORTS_STATE_FAILED");
        }
        const { projects: list, activeProjectId } = extractReportsProjects(result.data);
        setProjects({ list, loading: false, loaded: true, error: "", activeProjectId });
      } catch (err) {
        setProjects((prev) => ({
          ...prev,
          loading: false,
          error: formatReportsFetchError(err),
        }));
      }
    },
    [projects.loading, projects.loaded],
  );

  const fetchReport = useCallback(async () => {
    const projectId = effectiveProjectId;
    if (!projectId) {
      setReport((prev) => ({
        ...prev,
        loading: false,
        error:
          "Не определен Project ID. Укажите его в поле Project ID на вкладке «Статистика» и повторите загрузку.",
      }));
      return;
    }
    const payload = buildReportsPayload({ from: filters.from, to: filters.to, projectId });
    const mySeq = ++seq.current;
    setReport((prev) => ({ ...prev, payload, loading: true, error: "", updatedAt: "" }));
    try {
      const result = await sendMessage(
        "PH_REPORTS_FETCH",
        { body: payload },
        { timeoutMs: 120_000 },
      );
      if (mySeq !== seq.current) return;
      if (!result?.ok) {
        const err = result as { errorCode?: string; error?: string; status?: number } | undefined;
        throw new Error(err?.errorCode || err?.error || `HTTP ${err?.status || "unknown"}`);
      }
      setReport({
        rows: normalizeReportRows(result.data),
        countAll: extractReportCountAll(result.data),
        payload,
        updatedAt: new Date().toLocaleString("ru-RU"),
        loading: false,
        error: "",
      });
    } catch (err) {
      if (mySeq !== seq.current) return;
      setReport((prev) => ({ ...prev, loading: false, error: formatReportsFetchError(err) }));
    }
  }, [effectiveProjectId, filters.from, filters.to]);

  const reload = useCallback(
    (delayMs: number = DEBOUNCE_MS) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        void fetchReport();
      }, delayMs);
    },
    [fetchReport],
  );

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return {
    filters,
    setFilters,
    effectiveProjectId,
    projects: {
      list: projects.list,
      loading: projects.loading,
      loaded: projects.loaded,
      error: projects.error,
    },
    loadProjects,
    rows: report.rows,
    countAll: report.countAll,
    payload: report.payload,
    updatedAt: report.updatedAt,
    loading: report.loading,
    error: report.error,
    reload,
  };
}
