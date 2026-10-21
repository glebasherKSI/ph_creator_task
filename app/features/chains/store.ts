/**
 * Состояние канвы (Zustand): каталог задач домена, карточки на канве, рёбра и настройки связей,
 * сохранение на бэк. Логика графа — в graph.ts, раскладка — в layout.ts.
 */
import { create } from "zustand";

import { PAGE_SIZE } from "@/lib/constants";
import { loadChainsLayout, saveChainsLayout, type CanvasPosition } from "@/lib/storage";
import { fetchTask, fetchTasksPage, updateTask } from "@/lib/task-api";
import { buildPatchPayload, isSequenceType } from "@/lib/tasks";
import type { GamificationTask, TaskLike } from "@/lib/types";

import {
  type CanvasTask,
  type GraphState,
  type GtConfig,
  EMPTY_GRAPH,
  addEdge,
  conditionsForSave,
  importGraphFromConditions,
  remapTaskId,
  removeEdge,
  removeTasks,
  savableDirtyTargets,
  setTargetConfig,
} from "./graph";
import { GRID_START_X, GRID_START_Y, type LayoutOptions, layoutCanvasTasks } from "./layout";

export interface CatalogTask {
  id: string;
  name: string;
  frontend_identifier: string;
  state: string;
  type: string;
  available_from: string | null;
  available_till: string | null;
  main_bonus_group_id: string | null;
}

export interface SaveLogEntry {
  id: string;
  text: string;
  kind: "pending" | "ok" | "err";
}

export const HEADER_COLORS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "green", label: "Зелёный" },
  { id: "orange", label: "Оранжевый" },
  { id: "purple", label: "Фиолетовый" },
  { id: "red", label: "Красный" },
  { id: "teal", label: "Бирюзовый" },
  { id: "gray", label: "Серый" },
  { id: "pink", label: "Розовый" },
  { id: "amber", label: "Янтарный" },
];

function catalogEntry(task: GamificationTask): CatalogTask {
  return {
    id: String(task.id),
    name: String(task.name ?? ""),
    frontend_identifier: String(task.frontend_identifier ?? ""),
    state: String(task.state ?? "draft").toLowerCase(),
    type: String(task.type ?? ""),
    available_from: task.available_from ?? null,
    available_till: task.available_till ?? null,
    main_bonus_group_id: task.main_bonus_group_id ?? null,
  };
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface ChainsStore extends GraphState {
  domain: string;
  catalog: Record<string, CatalogTask>;
  catalogOrder: string[];
  catalogOffset: number;
  catalogHasMore: boolean;
  catalogHidden: number;
  catalogLoading: boolean;
  catalogError: string;
  /** Сохранённые позиции из storage (ключ — id задачи). */
  savedPositions: Record<string, CanvasPosition>;
  saving: boolean;
  saveLog: SaveLogEntry[];
  selectedTaskId: string | null;
  /** Все выделенные карточки (рамка, Shift+клик); selectedTaskId — последняя из них. */
  selectedIds: string[];
  selectedEdge: { from: string; to: string } | null;
  status: { text: string; error: boolean };

  setDomain: (domain: string) => Promise<void>;
  setStatus: (text: string, error?: boolean) => void;
  loadCatalog: (reset: boolean) => Promise<void>;
  /** Добавляет задачи из каталога на канву: позиция из storage или автораскладка, conditions с бэка. */
  addToCanvas: (ids: string[]) => Promise<void>;
  removeFromCanvas: (ids: string[]) => void;
  moveTask: (id: string, x: number, y: number) => void;
  persistPositions: () => Promise<void>;
  connect: (from: string, to: string) => void;
  disconnect: (from: string, to: string) => void;
  updateTargetConfig: (to: string, patch: Partial<GtConfig>) => void;
  autoLayout: (options?: LayoutOptions) => void;
  setHeaderColor: (id: string, color: string | null) => void;
  select: (taskId: string | null) => void;
  setSelectedIds: (ids: string[]) => void;
  selectEdge: (edge: { from: string; to: string } | null) => void;
  /** Полная задача с бэка для карточки (и кэш в full). */
  ensureFull: (id: string) => Promise<TaskLike | null>;
  saveChanges: (onlyIds?: string[]) => Promise<{ ok: number; err: number }>;
  /** Задача создана через форму: в каталог и на канву (если была локальным черновиком — переносим id). */
  applyCreatedTask: (task: GamificationTask, localId?: string | null, near?: string | null) => void;
  applyUpdatedTask: (task: GamificationTask) => void;
}

export const useChainsStore = create<ChainsStore>((set, get) => ({
  ...EMPTY_GRAPH,
  domain: "",
  catalog: {},
  catalogOrder: [],
  catalogOffset: 0,
  catalogHasMore: false,
  catalogHidden: 0,
  catalogLoading: false,
  catalogError: "",
  savedPositions: {},
  saving: false,
  saveLog: [],
  selectedTaskId: null,
  selectedIds: [],
  selectedEdge: null,
  status: { text: "Выберите домен и загрузите задачи", error: false },

  setStatus: (text, error = false) => set({ status: { text, error } }),

  setDomain: async (domain) => {
    if (domain === get().domain) return;
    const layout = domain ? await loadChainsLayout(domain) : { positions: {} };
    set({
      ...EMPTY_GRAPH,
      domain,
      catalog: {},
      catalogOrder: [],
      catalogOffset: 0,
      catalogHasMore: false,
      catalogHidden: 0,
      catalogError: "",
      savedPositions: layout.positions ?? {},
      saveLog: [],
      selectedTaskId: null,
      selectedIds: [],
      selectedEdge: null,
    });
  },

  loadCatalog: async (reset) => {
    const { domain, catalogOffset } = get();
    if (!domain) return;
    set({ catalogLoading: true, catalogError: "" });
    try {
      const page = await fetchTasksPage(domain, reset ? 0 : catalogOffset, PAGE_SIZE);
      set((s) => {
        const catalog = reset ? {} : { ...s.catalog };
        const order = reset ? [] : [...s.catalogOrder];
        for (const task of page.tasks) {
          const entry = catalogEntry(task);
          if (!catalog[entry.id]) order.push(entry.id);
          catalog[entry.id] = entry;
        }
        return {
          catalog,
          catalogOrder: order,
          catalogOffset: (reset ? 0 : s.catalogOffset) + page.rawCount,
          catalogHasMore: page.hasMore,
          catalogHidden: (reset ? 0 : s.catalogHidden) + page.hidden,
          catalogLoading: false,
        };
      });
    } catch (err) {
      set({ catalogLoading: false, catalogError: errorText(err) });
      throw err;
    }
  },

  addToCanvas: async (ids) => {
    const { catalog, savedPositions } = get();
    const fresh = ids.map(String).filter((id) => catalog[id] && !get().canvas[id]);
    if (!fresh.length) return;

    set((s) => {
      const canvas = { ...s.canvas };
      for (const id of fresh) {
        const meta = catalog[id]!;
        const saved = savedPositions[id];
        canvas[id] = {
          id,
          name: meta.name,
          frontend_identifier: meta.frontend_identifier,
          conditions: null,
          full: null,
          x: saved?.x ?? GRID_START_X,
          y: saved?.y ?? GRID_START_Y,
          ...(saved?.headerColor ? { headerColor: saved.headerColor } : {}),
          ...(saved?.configuredOnBackend ? { configuredOnBackend: true } : {}),
        };
      }
      return { canvas };
    });

    await Promise.all(fresh.map((id) => get().ensureFull(id)));
    set((s) => importGraphFromConditions(s, fresh));

    // Без сохранённой позиции — раскладываем новые карточки, остальные не трогаем.
    const toLayout = fresh.filter((id) => !savedPositions[id]);
    if (toLayout.length) get().autoLayout({ onlyIds: toLayout });
    await get().persistPositions();
  },

  removeFromCanvas: (ids) => {
    set((s) => {
      const next = removeTasks(s, ids);
      const gone = new Set(ids);
      return {
        ...next,
        selectedTaskId: s.selectedTaskId && gone.has(s.selectedTaskId) ? null : s.selectedTaskId,
        selectedIds: s.selectedIds.filter((id) => !gone.has(id)),
        selectedEdge:
          s.selectedEdge && (gone.has(s.selectedEdge.from) || gone.has(s.selectedEdge.to))
            ? null
            : s.selectedEdge,
      };
    });
    void get().persistPositions();
  },

  moveTask: (id, x, y) =>
    set((s) => (s.canvas[id] ? { canvas: { ...s.canvas, [id]: { ...s.canvas[id]!, x, y } } } : {})),

  persistPositions: async () => {
    const { domain, canvas } = get();
    if (!domain) return;
    const positions: Record<string, CanvasPosition> = {};
    for (const task of Object.values(canvas)) {
      positions[task.id] = {
        x: task.x,
        y: task.y,
        ...(task.headerColor ? { headerColor: task.headerColor } : {}),
        ...(task.localOnly ? { localOnly: true, configuredOnBackend: false } : {}),
        ...(!task.localOnly && task.configuredOnBackend ? { configuredOnBackend: true } : {}),
      };
    }
    // Позиции задач, которых сейчас нет на канве, сохраняем — вернутся на то же место.
    const merged = { ...get().savedPositions, ...positions };
    set({ savedPositions: merged });
    await saveChainsLayout(domain, merged);
  },

  connect: (from, to) => {
    const s = get();
    // У цепочек (type: sequence) нет таргетинга — входящие связи им не записать.
    if (isSequenceType(s.canvas[to]?.full?.type ?? s.catalog[to]?.type)) {
      set({
        status: {
          text: `Задача #${to} — цепочка: у неё нет таргетинга, входящие связи недоступны`,
          error: true,
        },
      });
      return;
    }
    set((st) => addEdge(st, from, to));
  },
  disconnect: (from, to) =>
    set((s) => ({
      ...removeEdge(s, from, to),
      selectedEdge:
        s.selectedEdge?.from === from && s.selectedEdge?.to === to ? null : s.selectedEdge,
    })),
  updateTargetConfig: (to, patch) => set((s) => setTargetConfig(s, to, patch)),

  autoLayout: (options = { forceAll: true }) => {
    set((s) => {
      const positions = layoutCanvasTasks(s.canvas, s.edges, options);
      const canvas = { ...s.canvas };
      for (const [id, pos] of Object.entries(positions)) {
        if (canvas[id]) canvas[id] = { ...canvas[id]!, x: pos.x, y: pos.y };
      }
      return { canvas };
    });
    void get().persistPositions();
  },

  setHeaderColor: (id, color) => {
    set((s) => {
      const task = s.canvas[id];
      if (!task) return {};
      const next: CanvasTask = { ...task };
      if (color) next.headerColor = color;
      else delete next.headerColor;
      return { canvas: { ...s.canvas, [id]: next } };
    });
    void get().persistPositions();
  },

  select: (taskId) =>
    set({
      selectedTaskId: taskId,
      selectedIds: taskId ? [taskId] : [],
      selectedEdge: taskId ? null : get().selectedEdge,
    }),
  setSelectedIds: (ids) =>
    set((s) => ({
      selectedIds: ids,
      selectedTaskId: ids.length
        ? ids.includes(s.selectedTaskId ?? "")
          ? s.selectedTaskId
          : ids[ids.length - 1]!
        : null,
      selectedEdge: ids.length ? null : s.selectedEdge,
    })),
  selectEdge: (edge) =>
    set({ selectedEdge: edge, selectedTaskId: edge ? null : get().selectedTaskId }),

  ensureFull: async (id) => {
    const task = get().canvas[id];
    if (!task) return null;
    if (task.full) return task.full;
    if (task.localOnly) return null;
    const full = await fetchTask(get().domain, id);
    set((s) => {
      const current = s.canvas[id];
      if (!current) return {};
      const dirty = s.dirtyTargets.includes(id);
      const conditions = dirty ? current.conditions : (full.conditions ?? []);
      return {
        canvas: {
          ...s.canvas,
          [id]: {
            ...current,
            full,
            conditions,
            name: full.name || current.name,
            frontend_identifier: full.frontend_identifier || current.frontend_identifier,
          },
        },
      };
    });
    return full;
  },

  saveChanges: async (onlyIds) => {
    const state = get();
    const targets = savableDirtyTargets(state).filter((id) => !onlyIds || onlyIds.includes(id));
    if (!targets.length) return { ok: 0, err: 0 };
    const log: SaveLogEntry[] = [];
    const push = (id: string, text: string, kind: SaveLogEntry["kind"]) => {
      const entry = { id: `${id}:${log.length}`, text, kind };
      log.push(entry);
      set({ saveLog: [...log] });
    };
    set({ saving: true, saveLog: [] });
    let ok = 0;
    let err = 0;
    for (const id of targets) {
      push(id, `#${id}: загрузка...`, "pending");
      try {
        const full = await get().ensureFull(id);
        if (!full) throw new Error("не удалось получить задачу");
        const { merged, toSend } = conditionsForSave(get(), id, full.conditions as never);
        const payload = buildPatchPayload(full, toSend);
        push(id, `#${id}: сохранение...`, "pending");
        const { task } = await updateTask(get().domain, id, payload);
        set((s) => ({
          canvas: s.canvas[id]
            ? { ...s.canvas, [id]: { ...s.canvas[id]!, conditions: merged, full: task ?? full } }
            : s.canvas,
          dirtyTargets: s.dirtyTargets.filter((d) => d !== id),
        }));
        ok += 1;
        push(id, `#${id}: OK`, "ok");
      } catch (e) {
        err += 1;
        push(id, `#${id}: ${errorText(e)}`, "err");
      }
    }
    set({ saving: false });
    return { ok, err };
  },

  applyCreatedTask: (task, localId = null, near = null) => {
    const id = String(task.id);
    set((s) => {
      const entry = catalogEntry(task);
      const catalog = { ...s.catalog, [id]: entry };
      const catalogOrder = s.catalogOrder.includes(id) ? s.catalogOrder : [id, ...s.catalogOrder];
      let next: GraphState = s;
      let x = GRID_START_X;
      let y = GRID_START_Y;
      if (localId && s.canvas[localId]) {
        next = remapTaskId(s, localId, id);
        x = s.canvas[localId]!.x;
        y = s.canvas[localId]!.y;
      } else if (near && s.canvas[near]) {
        x = s.canvas[near]!.x + 360;
        y = s.canvas[near]!.y;
      }
      const existing = next.canvas[id];
      const canvas = {
        ...next.canvas,
        [id]: {
          ...(existing ?? { id, headerColor: near ? s.canvas[near]?.headerColor : undefined }),
          id,
          name: entry.name,
          frontend_identifier: entry.frontend_identifier,
          conditions: task.conditions ?? [],
          full: task,
          x: existing?.x ?? x,
          y: existing?.y ?? y,
          localOnly: undefined,
        } as CanvasTask,
      };
      const withTask: GraphState = { ...next, canvas };
      return {
        ...importGraphFromConditions(withTask, [id]),
        catalog,
        catalogOrder,
        selectedTaskId: id,
      };
    });
    void get().persistPositions();
  },

  applyUpdatedTask: (task) => {
    const id = String(task.id);
    set((s) => {
      const entry = catalogEntry(task);
      const catalog = s.catalog[id] ? { ...s.catalog, [id]: entry } : s.catalog;
      const current = s.canvas[id];
      if (!current) return { catalog };
      const dirty = s.dirtyTargets.includes(id);
      const canvas = {
        ...s.canvas,
        [id]: {
          ...current,
          name: entry.name,
          frontend_identifier: entry.frontend_identifier,
          full: task,
          conditions: dirty ? current.conditions : (task.conditions ?? []),
        },
      };
      const withTask: GraphState = { ...s, canvas };
      return { ...(dirty ? withTask : importGraphFromConditions(withTask, [id])), catalog };
    });
  },
}));
