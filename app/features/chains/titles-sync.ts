/**
 * Групповая подтяжка названий по локалям из словаря Promo Graphic («Названия фронт»)
 * для выделенных на канве задач: словарь — одним запросом, затем для каждой задачи
 * свежая версия с бэка админки, слияние локалей и PATCH (если что-то поменялось).
 */
import { create } from "zustand";

import { KNOWN_LOCALE_CODES } from "@/features/task-form/task-form";
import { fetchFrontTitlesDictionary, frontTitleKey, mergeLocales } from "@/lib/front-titles";
import { buildPatchPayload } from "@/lib/tasks";
import { fetchTask, updateTask } from "@/lib/task-api";

import { useChainsStore } from "./store";

export type TitlesSyncOutcome =
  | "updated" //   названия записаны на бэк
  | "unchanged" // в словаре то же, что уже было
  | "not-found" // Front ID нет в словаре
  | "skipped" //  локальный черновик или нет Front ID
  | "error";

export interface TitlesSyncRow {
  id: string;
  name: string;
  frontendIdentifier: string;
  outcome: TitlesSyncOutcome;
  /** Локали, оставшиеся пустыми после синхронизации. */
  missing: string[];
  message?: string;
}

interface TitlesSyncState {
  open: boolean;
  phase: "dictionary" | "tasks" | "done" | "failed";
  total: number;
  rows: TitlesSyncRow[];
  error: string;
  close: () => void;
}

export const useTitlesSync = create<TitlesSyncState>((set, get) => ({
  open: false,
  phase: "done",
  total: 0,
  rows: [],
  error: "",
  close: () => {
    if (get().phase === "dictionary" || get().phase === "tasks") return;
    set({ open: false });
  },
}));

const CONCURRENCY = 4;

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function runTitlesSync(ids: string[]): Promise<void> {
  const store = useChainsStore.getState();
  const domain = store.domain;
  const order = ids.filter((id) => store.canvas[id]);
  useTitlesSync.setState({
    open: true,
    phase: "dictionary",
    total: order.length,
    rows: [],
    error: "",
  });

  let dictionary: Awaited<ReturnType<typeof fetchFrontTitlesDictionary>>;
  try {
    dictionary = await fetchFrontTitlesDictionary();
  } catch (err) {
    useTitlesSync.setState({ phase: "failed", error: errorText(err) });
    return;
  }
  useTitlesSync.setState({ phase: "tasks" });

  const push = (row: TitlesSyncRow) => useTitlesSync.setState((s) => ({ rows: [...s.rows, row] }));

  const syncOne = async (id: string) => {
    const task = useChainsStore.getState().canvas[id];
    const name = task?.name ?? "";
    const frontendIdentifier = task?.frontend_identifier ?? "";
    const base = { id, name, frontendIdentifier, missing: [] as string[] };
    if (!task || task.localOnly || !frontendIdentifier) {
      push({
        ...base,
        outcome: "skipped",
        message: task?.localOnly ? "локальный черновик" : "нет frontend_identifier",
      });
      return;
    }
    const titles = dictionary.get(frontTitleKey(frontendIdentifier));
    if (!titles) {
      push({ ...base, outcome: "not-found" });
      return;
    }
    try {
      // Свежая версия: не затираем правки, сделанные на бэке после загрузки канвы.
      const full = await fetchTask(domain, id);
      const merged = mergeLocales(full.locales, titles, KNOWN_LOCALE_CODES);
      if (!merged.changed) {
        useChainsStore.getState().applyUpdatedTask(full);
        push({ ...base, outcome: "unchanged", missing: merged.missing });
        return;
      }
      const payload = buildPatchPayload(
        { ...full, locales: merged.locales },
        (full.conditions as never) ?? [],
      );
      const { task: saved } = await updateTask(domain, id, payload);
      if (saved) useChainsStore.getState().applyUpdatedTask(saved);
      push({ ...base, outcome: "updated", missing: merged.missing });
    } catch (err) {
      push({ ...base, outcome: "error", message: errorText(err) });
    }
  };

  let cursor = 0;
  const worker = async () => {
    while (cursor < order.length) await syncOne(order[cursor++]!);
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, order.length) }, worker));
  useTitlesSync.setState({ phase: "done" });
  const rows = useTitlesSync.getState().rows;
  const updated = rows.filter((r) => r.outcome === "updated").length;
  useChainsStore
    .getState()
    .setStatus(`Названия из графика: обновлено ${updated} из ${order.length}`);
}
