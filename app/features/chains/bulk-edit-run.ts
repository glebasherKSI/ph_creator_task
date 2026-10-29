/**
 * Массовая правка выделенных задач: предпросмотр по загруженным задачам, затем для каждой
 * свежая версия с бэка → операции → PATCH. Черновики меняются только на канве.
 * Снимки «до» хранятся до закрытия окна — по ним работает «Откатить».
 */
import { create } from "zustand";

import { buildPatchPayload } from "@/lib/tasks";
import { fetchTask, updateTask } from "@/lib/task-api";
import type { Condition, TaskLike } from "@/lib/types";

import {
  type BulkContext,
  type BulkOp,
  type FieldChange,
  applyBulkOps,
  changedTaskKeys,
  restoreFields,
} from "./bulk-edit";
import { useChainsStore } from "./store";

export type BulkRowOutcome = "updated" | "unchanged" | "skipped" | "error" | "reverted";

export interface BulkRow {
  id: string;
  name: string;
  outcome: BulkRowOutcome;
  changes: FieldChange[];
  message?: string;
}

interface Snapshot {
  before: TaskLike;
  keys: string[];
  draft: boolean;
}

export type BulkPhase = "loading" | "edit" | "applying" | "done" | "reverting";

interface BulkEditState {
  open: boolean;
  phase: BulkPhase;
  ids: string[];
  /** Задачи для предпросмотра (с канвы или загруженные), по id. */
  tasks: Record<string, TaskLike>;
  loadErrors: Record<string, string>;
  rows: BulkRow[];
  snapshots: Record<string, Snapshot>;
  /** Операции, с которыми окно откроется (например, из сравнения задач). */
  seed: BulkOp[];
  /** Что сделать после закрытия окна — например, вернуться в сравнение. */
  onClose: (() => void) | null;
  show: (ids: string[], options?: BulkShowOptions) => void;
  close: () => void;
}

export interface BulkShowOptions {
  seed?: BulkOp[];
  onClose?: (() => void) | null;
}

const busy = (phase: BulkPhase) => phase === "applying" || phase === "reverting";

export const useBulkEdit = create<BulkEditState>((set, get) => ({
  open: false,
  phase: "edit",
  ids: [],
  tasks: {},
  loadErrors: {},
  rows: [],
  snapshots: {},
  seed: [],
  onClose: null,
  show: (ids, options = {}) => {
    const order = ids.filter((id) => useChainsStore.getState().canvas[id]);
    set({
      open: true,
      phase: "loading",
      ids: order,
      tasks: {},
      loadErrors: {},
      rows: [],
      snapshots: {},
      seed: options.seed ?? [],
      onClose: options.onClose ?? null,
    });
    void loadPreviewTasks(order);
  },
  close: () => {
    if (busy(get().phase)) return;
    const after = get().onClose;
    set({ open: false, snapshots: {}, seed: [], onClose: null });
    after?.();
  },
}));

const CONCURRENCY = 4;

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function runPool(ids: string[], worker: (id: string) => Promise<void>): Promise<void> {
  let cursor = 0;
  const lane = async () => {
    while (cursor < ids.length) await worker(ids[cursor++]!);
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, lane));
}

async function loadPreviewTasks(ids: string[]): Promise<void> {
  await runPool(ids, async (id) => {
    try {
      const full = await useChainsStore.getState().ensureFull(id);
      if (!full) throw new Error("не удалось получить задачу");
      useBulkEdit.setState((s) => ({ tasks: { ...s.tasks, [id]: full } }));
    } catch (err) {
      useBulkEdit.setState((s) => ({ loadErrors: { ...s.loadErrors, [id]: errorText(err) } }));
    }
  });
  if (useBulkEdit.getState().phase === "loading") useBulkEdit.setState({ phase: "edit" });
}

function cardName(id: string): string {
  const card = useChainsStore.getState().canvas[id];
  return card?.name || `#${id}`;
}

/** Черновик: правим задачу прямо на канве. */
function writeDraft(id: string, task: TaskLike): void {
  useChainsStore.setState((s) => {
    const card = s.canvas[id];
    if (!card) return {};
    return {
      canvas: {
        ...s.canvas,
        [id]: {
          ...card,
          full: task,
          conditions: Array.isArray(task.conditions) ? (task.conditions as Condition[]) : [],
        },
      },
    };
  });
}

async function patchTask(id: string, task: TaskLike): Promise<void> {
  const domain = useChainsStore.getState().domain;
  const payload = buildPatchPayload(task, (task.conditions as Condition[] | undefined) ?? []);
  const { task: saved } = await updateTask(domain, id, payload);
  if (saved) useChainsStore.getState().applyUpdatedTask(saved);
}

/** Применяет операции к выбранным задачам; excluded — задачи, снятые в предпросмотре. */
export async function applyBulkEdit(
  ops: ReadonlyArray<BulkOp>,
  ctx: BulkContext,
  excluded: ReadonlySet<string> = new Set(),
): Promise<void> {
  const { ids } = useBulkEdit.getState();
  const order = ids.filter((id) => !excluded.has(id));
  useBulkEdit.setState({ phase: "applying", rows: [], snapshots: {} });
  const push = (row: BulkRow) => useBulkEdit.setState((s) => ({ rows: [...s.rows, row] }));

  await runPool(order, async (id) => {
    const store = useChainsStore.getState();
    const card = store.canvas[id];
    const base = { id, name: cardName(id), changes: [] as FieldChange[] };
    if (!card) {
      push({ ...base, outcome: "skipped", message: "карточки уже нет на канве" });
      return;
    }
    if (store.dirtyTargets.includes(id)) {
      push({ ...base, outcome: "skipped", message: "несохранённые связи — сначала сохраните их" });
      return;
    }
    try {
      // Свежая версия: не затираем правки, сделанные на бэке после загрузки канвы.
      const draft = Boolean(card.localOnly);
      const before = draft ? card.full : await fetchTask(store.domain, id);
      if (!before) throw new Error("у черновика нет данных");
      const result = applyBulkOps(before, ops, ctx);
      const message = result.notes.join("; ") || undefined;
      if (result.errors.length) {
        push({
          ...base,
          outcome: "error",
          changes: result.changes,
          message: result.errors.join("; "),
        });
        return;
      }
      if (!result.changes.length) {
        if (!draft) useChainsStore.getState().applyUpdatedTask(before as never);
        push({ ...base, outcome: "unchanged", message });
        return;
      }
      if (draft) writeDraft(id, result.task);
      else await patchTask(id, result.task);
      useBulkEdit.setState((s) => ({
        snapshots: {
          ...s.snapshots,
          [id]: { before, keys: changedTaskKeys(before, result.task), draft },
        },
      }));
      push({
        ...base,
        outcome: "updated",
        changes: result.changes,
        message: draft
          ? ["черновик — изменён на канве", message].filter(Boolean).join("; ")
          : message,
      });
    } catch (err) {
      push({ ...base, outcome: "error", message: errorText(err) });
    }
  });

  useBulkEdit.setState({ phase: "done" });
  const updated = useBulkEdit.getState().rows.filter((r) => r.outcome === "updated").length;
  useChainsStore.getState().setStatus(`Массовая правка: изменено ${updated} из ${order.length}`);
}

/** Возвращает изменённые поля к значениям до правки (по снимкам). */
export async function revertBulkEdit(): Promise<void> {
  const { snapshots } = useBulkEdit.getState();
  const ids = Object.keys(snapshots);
  if (!ids.length) return;
  useBulkEdit.setState({ phase: "reverting" });
  const patchRow = (id: string, next: Partial<BulkRow>) =>
    useBulkEdit.setState((s) => ({
      rows: s.rows.map((row) => (row.id === id ? { ...row, ...next } : row)),
    }));

  await runPool(ids, async (id) => {
    const snap = snapshots[id]!;
    try {
      const store = useChainsStore.getState();
      if (snap.draft) {
        const current = store.canvas[id]?.full;
        if (!current) throw new Error("черновика уже нет на канве");
        writeDraft(id, restoreFields(current, snap.before, snap.keys));
      } else {
        const fresh = await fetchTask(store.domain, id);
        await patchTask(id, restoreFields(fresh, snap.before, snap.keys));
      }
      patchRow(id, { outcome: "reverted", message: undefined });
    } catch (err) {
      patchRow(id, { outcome: "error", message: `Откат не удался: ${errorText(err)}` });
    }
  });

  useBulkEdit.setState({ phase: "done", snapshots: {} });
  useChainsStore.getState().setStatus(`Массовая правка откатена: ${ids.length} задач`);
}
