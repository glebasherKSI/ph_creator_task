/**
 * Состояние канвы (Zustand): каталог задач домена, карточки на канве, рёбра и настройки связей,
 * сохранение на бэк. Логика графа — в graph.ts, раскладка — в layout.ts.
 */
import { create } from "zustand";

import { loadChainsLayout, saveChainsLayout, type CanvasPosition } from "@/lib/storage";
import { type TasksPage, fetchTask, fetchTasksPage, updateTask } from "@/lib/task-api";
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
  isLocalCanvasId,
  remapTaskId,
  removeEdge,
  removeTasks,
  savableDirtyTargets,
  conditionSources,
  setTargetConfig,
  withReferencingTasks,
} from "./graph";
import {
  GRID_START_X,
  GRID_START_Y,
  type LayoutOptions,
  layoutCanvasTasks,
  layoutSelection,
} from "./layout";

/** Размер страницы каталога и предохранитель от бесконечного цикла (250 × 100 = 25 000 задач). */
const CATALOG_PAGE_SIZE = 250;
const MAX_CATALOG_PAGES = 100;
/** Сколько страниц каталога запрашивается одновременно. */
const CATALOG_CONCURRENCY = 4;
/** Сколько полных задач загружается одновременно при добавлении на канву. */
const ADD_CONCURRENCY = 6;

export interface AddProgress {
  /** Загружено задач (включая неудачные). */
  done: number;
  total: number;
}

export interface CatalogProgress {
  phase: "auth" | "loading";
  /** Просмотрено строк бэка (включая скрытые по статусу). */
  scanned: number;
  /** Всего задач на бэке, если известно. */
  total: number | null;
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface ChainsStore extends GraphState {
  domain: string;
  catalog: Record<string, CatalogTask>;
  catalogOrder: string[];
  catalogOffset: number;
  catalogHasMore: boolean;
  catalogHidden: number;
  catalogLoading: boolean;
  /** Этап загрузки каталога для UI: проверка входа → страницы (scanned из total). */
  catalogProgress: CatalogProgress | null;
  catalogError: string;
  /** Загрузка задач перед добавлением на канву (null — ничего не добавляется). */
  addProgress: AddProgress | null;
  /** Сохранённые позиции из storage (ключ — id задачи). */
  savedPositions: Record<string, CanvasPosition>;
  saving: boolean;
  /**
   * Убранные с канвы задачи → их gamification_tasks. Нужна, чтобы карточка оставшейся задачи
   * показывала «требуется для #N (не на канве)»: conditions убранной на канве больше нет.
   */
  detachedDeps: Record<string, string[]>;
  saveLog: SaveLogEntry[];
  selectedTaskId: string | null;
  /** Все выделенные карточки (рамка, Shift+клик); selectedTaskId — последняя из них. */
  selectedIds: string[];
  selectedEdge: { from: string; to: string } | null;
  status: { text: string; error: boolean };

  setDomain: (domain: string) => Promise<void>;
  /** Сразу показать «Проверяю вход…» (до ensureAuthenticated) или сбросить индикатор. */
  setCatalogAuthPhase: (active: boolean) => void;
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
  /** Разложить дорожками только эти карточки — на месте их текущего блока. */
  alignTasks: (ids: string[], heights?: Record<string, number>) => void;
  /** Цвет шапки одной или нескольких карточек (null — по умолчанию). */
  setHeaderColor: (ids: string | string[], color: string | null) => void;
  select: (taskId: string | null) => void;
  setSelectedIds: (ids: string[]) => void;
  selectEdge: (edge: { from: string; to: string } | null) => void;
  /** Полная задача с бэка для карточки (и кэш в full). */
  ensureFull: (id: string) => Promise<TaskLike | null>;
  saveChanges: (onlyIds?: string[]) => Promise<{ ok: number; err: number }>;
  /**
   * Правит full.locales карточки на канве (импорт перевода по front_id) и помечает её грязной
   * для обычного saveChanges — PATCH уйдёт с текущими locales, когда карточка сохранится
   * (сразу через saveChanges или позже — изменение просто ждёт на канве до нажатия «Сохранить»).
   */
  applyLocaleUpdates: (id: string, locales: Record<string, string>) => Promise<void>;
  /** Принудительный ресинк: помечает все не-черновиковые карточки канвы грязными и сохраняет их. */
  saveAllCanvasTasks: () => Promise<{ ok: number; err: number }>;
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
  catalogProgress: null,
  catalogError: "",
  addProgress: null,
  savedPositions: {},
  saving: false,
  detachedDeps: {},
  saveLog: [],
  selectedTaskId: null,
  selectedIds: [],
  selectedEdge: null,
  status: { text: "Выберите домен и загрузите задачи", error: false },

  setStatus: (text, error = false) => set({ status: { text, error } }),

  setCatalogAuthPhase: (active) =>
    set(
      active
        ? { catalogLoading: true, catalogProgress: { phase: "auth", scanned: 0, total: null } }
        : { catalogLoading: false, catalogProgress: null },
    ),

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
      detachedDeps: {},
      saveLog: [],
      selectedTaskId: null,
      selectedIds: [],
      selectedEdge: null,
    });
  },

  loadCatalog: async (reset) => {
    const { domain } = get();
    if (!domain) return;
    set({
      catalogLoading: true,
      catalogError: "",
      catalogProgress: { phase: "loading", scanned: 0, total: null },
    });

    /** Страницы применяются строго по порядку offset — каталог сохраняет порядок бэка. */
    const commit = (page: TasksPage, offsetAfter: number, replace: boolean) => {
      set((s) => {
        const catalog = replace ? {} : { ...s.catalog };
        const order = replace ? [] : [...s.catalogOrder];
        for (const task of page.tasks) {
          const entry = catalogEntry(task);
          if (!catalog[entry.id]) order.push(entry.id);
          catalog[entry.id] = entry;
        }
        return {
          catalog,
          catalogOrder: order,
          catalogOffset: offsetAfter,
          catalogHasMore: page.hasMore,
          catalogHidden: (replace ? 0 : s.catalogHidden) + page.hidden,
          catalogProgress: { phase: "loading", scanned: offsetAfter, total: page.total },
          status: {
            text: `Загружаю задачи… ${order.length} (просмотрено ${offsetAfter})`,
            error: false,
          },
        };
      });
    };

    try {
      const startOffset = reset ? 0 : get().catalogOffset;
      const first = await fetchTasksPage(domain, startOffset, CATALOG_PAGE_SIZE);
      if (get().domain !== domain) return;
      let offset = startOffset + first.rawCount;
      commit(first, offset, reset);
      let last = first;

      if (reset && first.hasMore && first.rawCount > 0) {
        // Шаг — фактический размер страницы (бэк может урезать limit).
        const step = first.rawCount;
        if (first.total != null) {
          const offsets: number[] = [];
          for (let o = offset; o < first.total && offsets.length < MAX_CATALOG_PAGES; o += step) {
            offsets.push(o);
          }
          const results = new Map<number, TasksPage>();
          let nextToCommit = 0;
          let cursor = 0;
          const worker = async () => {
            while (cursor < offsets.length) {
              const index = cursor++;
              const page = await fetchTasksPage(domain, offsets[index]!, step);
              if (get().domain !== domain) return;
              results.set(index, page);
              while (results.has(nextToCommit)) {
                const ready = results.get(nextToCommit)!;
                results.delete(nextToCommit);
                offset = offsets[nextToCommit]! + ready.rawCount;
                commit(ready, offset, false);
                last = ready;
                nextToCommit += 1;
              }
            }
          };
          await Promise.all(Array.from({ length: CATALOG_CONCURRENCY }, worker));
          if (get().domain !== domain) return;
        }
        // Без count (или если задач стало больше, пока грузили) — дочитываем по одной.
        for (let n = 0; last.hasMore && last.rawCount > 0 && n < MAX_CATALOG_PAGES; n += 1) {
          last = await fetchTasksPage(domain, offset, step);
          if (get().domain !== domain) return;
          offset += last.rawCount;
          commit(last, offset, false);
        }
      }
      set({ catalogLoading: false, catalogProgress: null });
    } catch (err) {
      set({ catalogLoading: false, catalogProgress: null, catalogError: errorText(err) });
      throw err;
    }
  },

  addToCanvas: async (ids) => {
    const { catalog, savedPositions } = get();
    const fresh = ids.map(String).filter((id) => catalog[id] && !get().canvas[id]);
    if (!fresh.length) return;
    const domain = get().domain;

    // Сначала загружаем все задачи (канва не перерисовывается на каждый ответ),
    // затем добавляем их одним обновлением и раскладываем.
    const loaded = new Map<string, GamificationTask>();
    const failed: string[] = [];
    let done = 0;
    let cursor = 0;
    set({ addProgress: { done: 0, total: fresh.length } });
    const worker = async () => {
      while (cursor < fresh.length) {
        const id = fresh[cursor++]!;
        try {
          loaded.set(id, await fetchTask(domain, id));
        } catch {
          failed.push(id);
        }
        done += 1;
        set({ addProgress: { done, total: fresh.length } });
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(ADD_CONCURRENCY, fresh.length) }, worker));
    } finally {
      set({ addProgress: null });
    }
    if (get().domain !== domain) return;

    const added = fresh.filter((id) => loaded.has(id) && !get().canvas[id]);
    set((s) => {
      const canvas = { ...s.canvas };
      for (const id of added) {
        const meta = catalog[id]!;
        const full = loaded.get(id)!;
        const saved = savedPositions[id];
        canvas[id] = {
          id,
          name: full.name || meta.name,
          frontend_identifier: full.frontend_identifier || meta.frontend_identifier,
          conditions: full.conditions ?? [],
          full,
          x: saved?.x ?? GRID_START_X,
          y: saved?.y ?? GRID_START_Y,
          ...(saved?.headerColor ? { headerColor: saved.headerColor } : {}),
          ...(saved?.configuredOnBackend ? { configuredOnBackend: true } : {}),
        };
      }
      const next = { ...s, canvas };
      const detachedDeps = { ...s.detachedDeps };
      for (const id of added) delete detachedDeps[id];
      return {
        ...importGraphFromConditions(next, withReferencingTasks(next, added)),
        detachedDeps,
      };
    });

    // Без сохранённой позиции — раскладываем новые карточки, остальные не трогаем.
    const toLayout = added.filter((id) => !savedPositions[id]);
    if (toLayout.length) get().autoLayout({ onlyIds: toLayout });
    await get().persistPositions();
    if (failed.length) {
      throw new Error(`не загрузились ${failed.length} из ${fresh.length}: #${failed.join(", #")}`);
    }
  },

  removeFromCanvas: (ids) => {
    set((s) => {
      const next = removeTasks(s, ids);
      const gone = new Set(ids);
      const detachedDeps = { ...s.detachedDeps };
      for (const id of ids) {
        const sources = conditionSources(s.canvas[id]);
        if (sources.length) detachedDeps[id] = sources;
      }
      return {
        ...next,
        detachedDeps,
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

  alignTasks: (ids, heights = {}) => {
    set((s) => {
      const positions = layoutSelection(s.canvas, s.edges, ids, heights);
      const canvas = { ...s.canvas };
      for (const [id, pos] of Object.entries(positions)) {
        canvas[id] = { ...canvas[id]!, x: pos.x, y: pos.y };
      }
      return { canvas };
    });
    void get().persistPositions();
  },

  setHeaderColor: (ids, color) => {
    set((s) => {
      const canvas = { ...s.canvas };
      for (const id of typeof ids === "string" ? [ids] : ids) {
        const task = canvas[id];
        if (!task) continue;
        const next: CanvasTask = { ...task };
        if (color) next.headerColor = color;
        else delete next.headerColor;
        canvas[id] = next;
      }
      return { canvas };
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

  applyLocaleUpdates: async (id, locales) => {
    const task = get().canvas[id];
    if (!task) throw new Error("задачи нет на канве");
    const full = task.full ?? (await get().ensureFull(id));
    const current = get().canvas[id];
    if (!current) return;
    const base = full ?? current.full;
    const baseLocales = isRecord(base?.locales) ? base.locales : {};
    const nextFull: TaskLike = { ...(base ?? {}), locales: { ...baseLocales, ...locales } };
    set((s) => {
      const existing = s.canvas[id];
      if (!existing) return {};
      return {
        canvas: { ...s.canvas, [id]: { ...existing, full: nextFull } },
        dirtyTargets: s.dirtyTargets.includes(id) ? s.dirtyTargets : [...s.dirtyTargets, id],
      };
    });
  },

  saveAllCanvasTasks: async () => {
    const state = get();
    const realIds = Object.keys(state.canvas).filter((id) => !isLocalCanvasId(state, id));
    if (!realIds.length) return { ok: 0, err: 0 };
    set((s) => ({ dirtyTargets: [...new Set([...s.dirtyTargets, ...realIds])] }));
    return get().saveChanges(realIds);
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
        ...importGraphFromConditions(withTask, withReferencingTasks(withTask, [id])),
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
