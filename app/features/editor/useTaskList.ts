/** Список задач домена: постраничная загрузка, фильтр статуса, поиск. */
import { useCallback, useMemo, useRef, useState } from "react";

import { PAGE_SIZE } from "@/lib/constants";
import { fetchTasksPage } from "@/lib/task-api";
import type { GamificationTask } from "@/lib/types";

export type StatusFilter = "all" | "active" | "draft";

export interface TaskListState {
  tasks: GamificationTask[];
  /** Отфильтрованные по статусу и поиску. */
  visible: GamificationTask[];
  hidden: number;
  offset: number;
  hasMore: boolean;
  loading: boolean;
  error: string;
  loadedDomain: string;
  statusFilter: StatusFilter;
  setStatusFilter: (next: StatusFilter) => void;
  query: string;
  setQuery: (next: string) => void;
  load: (domain: string, reset: boolean) => Promise<void>;
  /** Подменить задачу в списке (после правки) или добавить (после создания). */
  upsert: (task: GamificationTask) => void;
}

function matchesQuery(task: GamificationTask, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    String(task.id).includes(q) ||
    String(task.name || "")
      .toLowerCase()
      .includes(q) ||
    String(task.frontend_identifier || "")
      .toLowerCase()
      .includes(q)
  );
}

export function useTaskList(): TaskListState {
  const [tasks, setTasks] = useState<GamificationTask[]>([]);
  const [hidden, setHidden] = useState(0);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [loadedDomain, setLoadedDomain] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const seq = useRef(0);

  const load = useCallback(
    async (domain: string, reset: boolean) => {
      const mySeq = ++seq.current;
      const startOffset = reset ? 0 : offset;
      setLoading(true);
      setError("");
      try {
        const page = await fetchTasksPage(domain, startOffset, PAGE_SIZE);
        if (mySeq !== seq.current) return;
        setTasks((prev) => (reset ? page.tasks : [...prev, ...page.tasks]));
        setHidden((prev) => (reset ? page.hidden : prev + page.hidden));
        setOffset(startOffset + page.rawCount);
        setHasMore(page.hasMore);
        setLoadedDomain(domain);
      } catch (err) {
        if (mySeq !== seq.current) return;
        setError(err instanceof Error ? err.message : String(err));
        throw err;
      } finally {
        if (mySeq === seq.current) setLoading(false);
      }
    },
    [offset],
  );

  const upsert = useCallback((task: GamificationTask) => {
    setTasks((prev) => {
      const idx = prev.findIndex((t) => String(t.id) === String(task.id));
      if (idx < 0) return [task, ...prev];
      const next = [...prev];
      next[idx] = task;
      return next;
    });
  }, []);

  const visible = useMemo(() => {
    const q = query.trim();
    return tasks.filter((task) => {
      if (statusFilter !== "all") {
        const state = String(task.state ?? "draft").toLowerCase();
        if (state !== statusFilter) return false;
      }
      return matchesQuery(task, q);
    });
  }, [tasks, statusFilter, query]);

  return {
    tasks,
    visible,
    hidden,
    offset,
    hasMore,
    loading,
    error,
    loadedDomain,
    statusFilter,
    setStatusFilter,
    query,
    setQuery,
    load,
    upsert,
  };
}
