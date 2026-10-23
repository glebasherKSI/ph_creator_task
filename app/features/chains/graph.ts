/**
 * Граф связей на канве: чистые операции над состоянием (без React и chrome.*).
 * Связь A → B означает, что у задачи B в conditions есть блок gamification_tasks с A в list.
 * Состояние иммутабельное: каждая операция возвращает новый объект.
 */
import { cloneJson, getGamificationTasksCondition } from "@/lib/tasks";
import type { Condition, GamificationTasksCondition, TaskLike } from "@/lib/types";

export interface CanvasTask {
  id: string;
  name: string;
  frontend_identifier: string;
  /** null — conditions ещё не загружены с бэка. */
  conditions: Condition[] | null;
  /** Полная задача (для формы и PATCH). */
  full: TaskLike | null;
  x: number;
  y: number;
  headerColor?: string;
  /** Локальный черновик — на бэке ещё нет, id начинается с local_. */
  localOnly?: boolean;
  configuredOnBackend?: boolean;
}

export interface CanvasEdge {
  from: string;
  to: string;
}

export interface GtConfig {
  type: "enabled" | "disabled";
  extra_type: "and" | "or";
  only_completed: boolean;
}

export interface GraphState {
  canvas: Record<string, CanvasTask>;
  edges: CanvasEdge[];
  targetConfigs: Record<string, GtConfig>;
  dirtyTargets: string[];
}

export const DEFAULT_GT_CONFIG: GtConfig = {
  type: "enabled",
  extra_type: "or",
  only_completed: true,
};

export const EMPTY_GRAPH: GraphState = {
  canvas: {},
  edges: [],
  targetConfigs: {},
  dirtyTargets: [],
};

export function edgeKey(from: string, to: string): string {
  return `${from}->${to}`;
}

export function isLocalId(id: string): boolean {
  return String(id).startsWith("local_");
}

export function isLocalCanvasId(state: GraphState, id: string): boolean {
  return isLocalId(id) || state.canvas[String(id)]?.localOnly === true;
}

export function newLocalDraftId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return `local_${crypto.randomUUID()}`;
  return `local_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/** Подменяет/добавляет/удаляет блок gamification_tasks в conditions. */
export function mergeGamificationTasks(
  conditions: Condition[] | null | undefined,
  gtValue: Partial<GamificationTasksCondition> | null,
): Condition[] {
  const next = Array.isArray(conditions) ? conditions.map((item) => cloneJson(item)) : [];
  const idx = next.findIndex((item) => item && item.gamification_tasks);
  const hasList = !!gtValue && Array.isArray(gtValue.list) && gtValue.list.length > 0;
  if (hasList) {
    const block: Condition = { gamification_tasks: cloneJson(gtValue) };
    if (idx >= 0) next[idx] = block;
    else next.push(block);
  } else if (idx >= 0) {
    next.splice(idx, 1);
  }
  return next;
}

/**
 * Значение блока gamification_tasks для задачи по рёбрам канвы.
 * Id задач, которых нет на канве (но они были в conditions с бэка), сохраняются.
 */
export function buildGtValueForTarget(
  state: GraphState,
  targetId: string,
): Required<GamificationTasksCondition> {
  const target = String(targetId);
  const edgeSources = state.edges.filter((e) => e.to === target).map((e) => e.from);
  const gt = getGamificationTasksCondition(state.canvas[target]?.conditions);
  const conditionList = Array.isArray(gt?.list) ? gt.list.map(String) : [];
  const offCanvasPreserved = conditionList.filter((id) => !state.canvas[id] && !isLocalId(id));
  const sources = [...new Set([...edgeSources, ...offCanvasPreserved])];
  const cfg = state.targetConfigs[target] ?? DEFAULT_GT_CONFIG;
  return {
    list: sources.sort((a, b) => Number(a) - Number(b)),
    type: cfg.type,
    extra_type: cfg.extra_type,
    only_completed: cfg.only_completed,
  };
}

/** Убирает id локальных черновиков перед отправкой на бэк (локально связь остаётся). */
export function stripLocalTaskIds(state: GraphState, conditions: Condition[]): Condition[] {
  const gt = getGamificationTasksCondition(conditions);
  if (!gt || !Array.isArray(gt.list)) return conditions;
  const list = gt.list.filter((id) => !isLocalCanvasId(state, String(id)));
  if (list.length === gt.list.length) return conditions;
  return mergeGamificationTasks(conditions, list.length ? { ...gt, list } : null);
}

/**
 * Тело локального черновика для формы: связи с канвы (рёбра) — в его conditions.
 * Id других черновиков не попадают: их связь перелинкуется, когда они получат id на бэке.
 */
export function draftBodyWithCanvasLinks(
  state: GraphState,
  full: TaskLike,
  canvasConditions: Condition[] | null | undefined,
): TaskLike {
  const gt = getGamificationTasksCondition(stripLocalTaskIds(state, canvasConditions ?? []));
  const own = Array.isArray(full.conditions) ? (full.conditions as Condition[]) : [];
  return gt ? { ...full, conditions: mergeGamificationTasks(own, gt) } : full;
}

function withTask(state: GraphState, id: string, patch: Partial<CanvasTask>): GraphState {
  const task = state.canvas[id];
  if (!task) return state;
  return { ...state, canvas: { ...state.canvas, [id]: { ...task, ...patch } } };
}

/** conditions задачи на канве пересобираются из рёбер (локальная копия, до PATCH). */
export function syncConditionsFromEdges(state: GraphState, targetId: string): GraphState {
  const task = state.canvas[targetId];
  if (!task) return state;
  const gt = buildGtValueForTarget(state, targetId);
  return withTask(state, targetId, {
    conditions: mergeGamificationTasks(task.conditions ?? [], gt.list.length ? gt : null),
  });
}

function markDirty(state: GraphState, targetId: string): GraphState {
  if (state.dirtyTargets.includes(targetId)) return state;
  return { ...state, dirtyTargets: [...state.dirtyTargets, targetId] };
}

/**
 * Рёбра и настройки связей из conditions задач на канве.
 * `onlyIds` — пересобрать только эти задачи (грязные не трогаем, рёбра от черновиков сохраняем).
 */
export function importGraphFromConditions(
  state: GraphState,
  onlyIds: string[] | null = null,
): GraphState {
  const onlySet = onlyIds ? new Set(onlyIds.map(String)) : null;
  let edges = onlySet ? [...state.edges] : [];
  const targetConfigs = onlySet ? { ...state.targetConfigs } : {};

  for (const task of Object.values(state.canvas)) {
    const targetId = task.id;
    if (onlySet && !onlySet.has(targetId)) continue;
    if (onlySet && state.dirtyTargets.includes(targetId)) {
      // Локальные правки не перетираем, но связи с вернувшимися на канву задачами — дорисовываем.
      for (const from of conditionSources(task)) {
        if (state.canvas[from] && !edges.some((e) => e.from === from && e.to === targetId))
          edges.push({ from, to: targetId });
      }
      continue;
    }
    if (onlySet) {
      edges = edges.filter((e) => e.to !== targetId || isLocalCanvasId(state, e.from));
      delete targetConfigs[targetId];
    }
    const gt = getGamificationTasksCondition(task.conditions);
    if (!gt || !Array.isArray(gt.list)) continue;
    targetConfigs[targetId] = {
      type: gt.type === "disabled" ? "disabled" : "enabled",
      extra_type: gt.extra_type === "and" ? "and" : "or",
      // Бэк не отдаёт only_completed, когда оно false.
      only_completed: gt.only_completed === true,
    };
    for (const raw of gt.list) {
      const from = String(raw);
      if (!state.canvas[from] || from === targetId) continue;
      if (!edges.some((e) => e.from === from && e.to === targetId))
        edges.push({ from, to: targetId });
    }
  }
  return { ...state, edges, targetConfigs };
}

/**
 * `ids` плюс задачи канвы, у которых они указаны в gamification_tasks. Нужна при добавлении:
 * связи «новая → уже на канве» живут в conditions старых задач, а не новой.
 */
export function withReferencingTasks(state: GraphState, ids: string[]): string[] {
  const added = new Set(ids.map(String));
  const result = new Set(added);
  for (const task of Object.values(state.canvas)) {
    if (result.has(task.id)) continue;
    const gt = getGamificationTasksCondition(task.conditions);
    if (Array.isArray(gt?.list) && gt.list.some((raw) => added.has(String(raw)))) {
      result.add(task.id);
    }
  }
  return [...result];
}

export function addEdge(state: GraphState, from: string, to: string): GraphState {
  if (from === to || !state.canvas[from] || !state.canvas[to]) return state;
  if (state.edges.some((e) => e.from === from && e.to === to)) return state;
  let next: GraphState = {
    ...state,
    edges: [...state.edges, { from, to }],
    targetConfigs: state.targetConfigs[to]
      ? state.targetConfigs
      : { ...state.targetConfigs, [to]: { ...DEFAULT_GT_CONFIG } },
  };
  next = markDirty(next, to);
  return syncConditionsFromEdges(next, to);
}

export function removeEdge(state: GraphState, from: string, to: string): GraphState {
  const edges = state.edges.filter((e) => !(e.from === from && e.to === to));
  if (edges.length === state.edges.length) return state;
  let next: GraphState = { ...state, edges };
  if (!edges.some((e) => e.to === to)) {
    const targetConfigs = { ...next.targetConfigs };
    delete targetConfigs[to];
    next = { ...next, targetConfigs };
  }
  next = markDirty(next, to);
  return syncConditionsFromEdges(next, to);
}

export function setTargetConfig(
  state: GraphState,
  to: string,
  patch: Partial<GtConfig>,
): GraphState {
  const current = state.targetConfigs[to] ?? DEFAULT_GT_CONFIG;
  let next: GraphState = {
    ...state,
    targetConfigs: { ...state.targetConfigs, [to]: { ...current, ...patch } },
  };
  next = markDirty(next, to);
  return syncConditionsFromEdges(next, to);
}

/** Убирает задачи с канвы вместе с их рёбрами; цели потерянных рёбер становятся грязными. */
/**
 * Убрать задачи с канвы. Это только вид: conditions оставшихся задач не меняются
 * (связь с убранной остаётся в gamification_tasks и показывается в карточке как «не на канве»).
 */
export function removeTasks(state: GraphState, ids: string[]): GraphState {
  const gone = new Set(ids);
  const canvas = { ...state.canvas };
  for (const id of gone) delete canvas[id];
  const targetConfigs = { ...state.targetConfigs };
  for (const id of gone) delete targetConfigs[id];
  return {
    ...state,
    canvas,
    edges: state.edges.filter((e) => !gone.has(e.from) && !gone.has(e.to)),
    targetConfigs,
    dirtyTargets: state.dirtyTargets.filter((id) => !gone.has(id)),
  };
}

/** Id задач из gamification_tasks задачи (без самой задачи). */
export function conditionSources(task: CanvasTask | undefined): string[] {
  const gt = getGamificationTasksCondition(task?.conditions);
  if (!Array.isArray(gt?.list)) return [];
  return [...new Set(gt.list.map(String))].filter((id) => id !== task!.id);
}

/** Локальный черновик создан на бэке: переносим рёбра, настройки и выделение на реальный id. */
export function remapTaskId(state: GraphState, fromId: string, toId: string): GraphState {
  if (fromId === toId || !state.canvas[fromId]) return state;
  const canvas = { ...state.canvas };
  const task = canvas[fromId]!;
  delete canvas[fromId];
  canvas[toId] = { ...task, id: toId, localOnly: undefined };
  const edges = state.edges.map((e) => ({
    from: e.from === fromId ? toId : e.from,
    to: e.to === fromId ? toId : e.to,
  }));
  const targetConfigs = { ...state.targetConfigs };
  if (targetConfigs[fromId]) {
    targetConfigs[toId] = targetConfigs[fromId]!;
    delete targetConfigs[fromId];
  }
  const dirtyTargets = state.dirtyTargets.map((id) => (id === fromId ? toId : id));
  let next: GraphState = { ...state, canvas, edges, targetConfigs, dirtyTargets };
  // Последователи черновика теперь ссылаются на настоящий id — их надо дописать на бэк.
  for (const e of edges) {
    if (e.from === toId) {
      next = markDirty(next, e.to);
      next = syncConditionsFromEdges(next, e.to);
    }
  }
  return next;
}

/** Цели, которые реально можно сохранить (не локальные черновики). */
export function savableDirtyTargets(state: GraphState): string[] {
  return state.dirtyTargets.filter((id) => state.canvas[id] && !isLocalCanvasId(state, id));
}

/** Conditions для PATCH цели: полные conditions с бэка + блок по рёбрам, без локальных id. */
export function conditionsForSave(
  state: GraphState,
  targetId: string,
  fullConditions: Condition[] | null | undefined,
): { merged: Condition[]; toSend: Condition[] } {
  const gt = buildGtValueForTarget(state, targetId);
  const merged = mergeGamificationTasks(fullConditions ?? [], gt.list.length ? gt : null);
  return { merged, toSend: stripLocalTaskIds(state, merged) };
}
