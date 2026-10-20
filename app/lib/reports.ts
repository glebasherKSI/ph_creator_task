/** Отчёты Reports (reports.maxbit.private): payload запроса, разбор строк, метрики. */

export const REPORTS_ORIGIN = "https://reports.maxbit.private";
export const REPORTS_ENDPOINT = `${REPORTS_ORIGIN}/reports/gamification-tasks`;
export const SET_ACTIVE_PROJECT_ENDPOINT = `${REPORTS_ORIGIN}/set-active-project`;
export const REPORTS_STATE_ENDPOINT = `${REPORTS_ORIGIN}/state/0`;

export const REPORTS_FETCH_ERRORS = {
  TAB_REQUIRED: "REPORTS_TAB_REQUIRED",
  SESSION_MISSING: "REPORTS_SESSION_MISSING",
  XSRF_MISSING: "REPORTS_XSRF_MISSING",
  SSL_ERROR: "REPORTS_SSL_ERROR",
  SCRIPT_FAILED: "REPORTS_SCRIPT_FAILED",
} as const;

export function formatReportsFetchError(err: unknown): string {
  const raw = String((err as Error)?.message || err || "").trim();
  const code = raw.startsWith("REPORTS_") ? raw : "";

  const byCode: Record<string, string> = {
    [REPORTS_FETCH_ERRORS.TAB_REQUIRED]:
      "Откройте https://reports.maxbit.private в браузере (вкладка должна оставаться открытой), примите сертификат при первом заходе и нажмите «Обновить».",
    [REPORTS_FETCH_ERRORS.SESSION_MISSING]:
      "Вы не авторизованы в Reports. Откройте https://reports.maxbit.private, войдите в систему и повторите загрузку.",
    [REPORTS_FETCH_ERRORS.XSRF_MISSING]:
      "Не найден XSRF-токен. Обновите страницу Reports и повторите загрузку.",
    [REPORTS_FETCH_ERRORS.SSL_ERROR]:
      "Ошибка SSL-сертификата Reports. Откройте https://reports.maxbit.private в браузере, примите сертификат и повторите загрузку.",
    [REPORTS_FETCH_ERRORS.SCRIPT_FAILED]:
      "Не удалось выполнить запрос на вкладке Reports. Обновите страницу https://reports.maxbit.private и повторите попытку.",
  };

  const known = byCode[code];
  if (known) return known;
  if (/ERR_CERT|CERT_AUTHORITY|SSL|certificate/i.test(raw)) {
    return byCode[REPORTS_FETCH_ERRORS.SSL_ERROR]!;
  }
  if (/Failed to fetch/i.test(raw)) {
    return "Не удалось подключиться к Reports. Убедитесь, что вкладка https://reports.maxbit.private открыта, и повторите загрузку.";
  }
  const httpMatch = raw.match(/HTTP\s*(\d{3})/i);
  if (httpMatch) {
    return `Сервер Reports вернул ошибку ${httpMatch[1]}. Проверьте авторизацию и повторите загрузку.`;
  }
  if (!raw) return "Не удалось загрузить отчёт из Reports.";
  return `Ошибка загрузки отчёта: ${raw}`;
}

export const REPORTS_DEFAULT_PAYLOAD = {
  reportId: 71,
  currentPage: 1,
  perPage: 500,
  period: { type: "date_range", from: "", to: "" },
  filters: {
    date_range: { start: "", end: "" },
    date_start: "",
    date_end: "",
    created_at_start: "",
    created_at_end: "",
    month_start: "",
    month_end: "",
    created_at_period: "1",
  },
};

export type ReportsPayload = typeof REPORTS_DEFAULT_PAYLOAD & { project_id?: string };

const DOMAIN_PROJECT_ID_MAP: Readonly<Record<string, string>> = Object.freeze({
  "admin.crimson.lex.prd.maxbit.private": "13",
});

function toDateInputValue(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function normalizeProjectId(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (!/^\d+$/.test(raw)) return "";
  const asNumber = Number(raw);
  if (!Number.isInteger(asNumber) || asNumber <= 0) return "";
  return String(asNumber);
}

export function buildReportsPayload({
  from,
  to,
  projectId,
  now = new Date(),
}: { from?: string; to?: string; projectId?: unknown; now?: Date } = {}): ReportsPayload {
  const fromDate = new Date(now);
  // 14 дней по умолчанию — типичный период сезонных кампаний (~2 недели).
  fromDate.setDate(fromDate.getDate() - 13);

  const fromValue = from || toDateInputValue(fromDate);
  const toValue = to || toDateInputValue(now);
  const normalizedProjectId = normalizeProjectId(projectId);

  return {
    ...REPORTS_DEFAULT_PAYLOAD,
    ...(normalizedProjectId ? { project_id: normalizedProjectId } : {}),
    period: { ...REPORTS_DEFAULT_PAYLOAD.period, from: fromValue, to: toValue },
    filters: {
      ...REPORTS_DEFAULT_PAYLOAD.filters,
      date_range: { start: fromValue, end: toValue },
      date_start: fromValue,
      date_end: toValue,
      created_at_start: fromValue,
      created_at_end: toValue,
      month_start: fromValue,
      month_end: toValue,
      created_at_period: "1",
    },
  };
}

export interface ReportsProject {
  id: string;
  name: string;
}

/** Разбирает ответ GET /state/0: список проектов и текущий активный проект. */
export function extractReportsProjects(data: unknown): {
  projects: ReportsProject[];
  activeProjectId: string;
} {
  const root = (data ?? {}) as { projects?: unknown; active_project_id?: unknown };
  const list = Array.isArray(root.projects) ? root.projects : [];
  const projects = list
    .map((item) => {
      const rec = (item ?? {}) as { id?: unknown; name?: unknown };
      return { id: normalizeProjectId(rec.id), name: String(rec.name ?? "").trim() };
    })
    .filter((item) => item.id)
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  return { projects, activeProjectId: normalizeProjectId(root.active_project_id) };
}

export function inferProjectIdFromDomain(domain: unknown): string {
  const normalizedDomain = String(domain ?? "")
    .trim()
    .toLowerCase();
  if (!normalizedDomain) return "";
  const fromDirectMap = DOMAIN_PROJECT_ID_MAP[normalizedDomain];
  if (fromDirectMap) return fromDirectMap;
  if (normalizedDomain.includes(".lex.")) return "13";
  return "";
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const normalized = String(value ?? "")
    .replace(/\s+/g, "")
    .replace("%", "")
    .replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Нормализует имя задачи для сопоставления admin ↔ reports (пробелы, регистр). */
export function normalizeTaskNameForMatch(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/** Сопоставляет имя из admin API и строку отчёта Reports (в т.ч. «(Копия)»). */
export function reportTaskNamesMatch(reportName: unknown, adminName: unknown): boolean {
  const report = normalizeTaskNameForMatch(reportName);
  const admin = normalizeTaskNameForMatch(adminName);
  if (!report || !admin) return false;
  return report.includes(admin) || admin.includes(report);
}

export function extractReportCountAll(response: unknown): number | null {
  const root = (response ?? {}) as { countAll?: unknown; count_all?: unknown };
  const parsed = Number(root.countAll ?? root.count_all);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export interface ReportRow {
  projectId: string;
  name: string;
  period: string;
  tasksCount: number;
  tasksActive: number;
  tasksExpired: number;
  tasksFinished: number;
  tasksFinishedPercent: number;
  depositsSum: number;
  depositsCount: number;
  betsSum: number;
  betsCount: number;
  sportBetsSum: number;
  sportBetsCount: number;
}

export function normalizeReportRows(response: unknown): ReportRow[] {
  const root = (response ?? {}) as { rows?: unknown };
  const rowsRaw = Array.isArray(root.rows) ? root.rows : [];
  return rowsRaw.map((raw) => {
    const row = (raw ?? {}) as Record<string, unknown>;
    return {
      projectId: String(row.project_id ?? "--"),
      name: String(row.name ?? "")
        .trim()
        .replace(/\s+/g, " "),
      period: String(row.period ?? ""),
      tasksCount: toNumber(row.tasks_count),
      tasksActive: toNumber(row.tasks_active),
      tasksExpired: toNumber(row.tasks_expired),
      tasksFinished: toNumber(row.tasks_finished),
      tasksFinishedPercent: toNumber(row.tasks_finished_percent),
      depositsSum: toNumber(row.deposits_sum),
      depositsCount: toNumber(row.deposits_count),
      betsSum: toNumber(row.bets_sum),
      betsCount: toNumber(row.bets_count),
      sportBetsSum: toNumber(row.sport_bets_sum),
      sportBetsCount: toNumber(row.sport_bets_count),
    };
  });
}

function parseIsoDate(value: unknown): Date | null {
  const raw = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [y, m, d] = raw.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return Number.isNaN(date.getTime()) ? null : date;
}

function computeInclusiveDays(from: unknown, to: unknown): number {
  const fromDate = parseIsoDate(from);
  const toDate = parseIsoDate(to);
  if (!fromDate || !toDate) return 0;
  const ms = toDate.getTime() - fromDate.getTime();
  if (ms < 0) return 0;
  return Math.floor(ms / 86400000) + 1;
}

export interface ReportMetrics {
  tasksCount: number;
  tasksActive: number;
  tasksFinished: number;
  tasksExpired: number;
  depositsSum: number;
  depositsCount: number;
  betsSum: number;
  betsCount: number;
  uniqueTasks: number;
  daysCount: number;
  completionRate: number;
  depositsToBetsRate: number;
}

export function computeMetrics(
  rows: ReportRow[],
  period: { from?: string; to?: string } = {},
): ReportMetrics {
  const totals = rows.reduce(
    (acc, row) => {
      acc.tasksCount += row.tasksCount;
      acc.tasksActive += row.tasksActive;
      acc.tasksFinished += row.tasksFinished;
      acc.tasksExpired += row.tasksExpired;
      acc.depositsSum += row.depositsSum;
      acc.depositsCount += row.depositsCount;
      acc.betsSum += row.betsSum;
      acc.betsCount += row.betsCount;
      return acc;
    },
    {
      tasksCount: 0,
      tasksActive: 0,
      tasksFinished: 0,
      tasksExpired: 0,
      depositsSum: 0,
      depositsCount: 0,
      betsSum: 0,
      betsCount: 0,
    },
  );

  const uniqueTasks = new Set(rows.map((row) => row.name).filter(Boolean)).size;
  const daysFromRange = computeInclusiveDays(period.from, period.to);
  const daysFromRows = new Set(rows.map((row) => row.period).filter(Boolean)).size;
  const daysCount = daysFromRange || daysFromRows;
  const completionRate =
    totals.tasksCount > 0 ? (totals.tasksFinished / totals.tasksCount) * 100 : 0;
  const depositsToBetsRate =
    totals.betsCount > 0 ? (totals.depositsCount / totals.betsCount) * 100 : 0;

  return { ...totals, uniqueTasks, daysCount, completionRate, depositsToBetsRate };
}

export function formatMetricNumber(value: number, fractionDigits = 0): string {
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}
