/**
 * «Открыть пакет на канве»: задачи из Promo Graphic становятся карточками —
 * уже созданные на бэке подгружаются по ph_backend_id, остальные — локальные черновики.
 * Связи графика (prerequisite_task_id) переносятся в рёбра / conditions.
 */
import { graphicApiGet, graphicApiPost } from "@/lib/graphic-api";
import {
  type PlannerTask,
  getPlannerPhBackendId,
  mapPlannerTaskToDraft,
  mergeBackendTaskWithPlannerBrief,
} from "@/lib/graphic-task-map";
import { fetchTask } from "@/lib/task-api";
import { getGamificationTasksCondition } from "@/lib/tasks";
import type { GamificationTask, TaskLike } from "@/lib/types";

import {
  type CanvasTask,
  type GraphState,
  DEFAULT_GT_CONFIG,
  addEdge,
  importGraphFromConditions,
  isLocalCanvasId,
  mergeGamificationTasks,
  newLocalDraftId,
  syncConditionsFromEdges,
} from "./graph";
import {
  type GraphicPackage,
  collectPlannerLinks,
  extractPackageTasks,
  nextStackOrigin,
  planPackagePlacement,
  plannerTaskLabel,
} from "./packages";
import { type CatalogTask, useChainsStore } from "./store";

export interface OpenPackageResult {
  placedBackend: string[];
  placedDrafts: string[];
  loadErrors: string[];
  linked: number;
  backendDirty: number;
  unresolved: string[];
  packageName: string;
}

function catalogFromTask(task: GamificationTask): CatalogTask {
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

/**
 * Связь «from → to» на канве. Если предшественник есть только на бэке (не на канве),
 * его id пишется прямо в conditions цели. Возвращает, появилась ли новая связь.
 */
export function linkPrerequisite(
  state: GraphState,
  from: string,
  to: string,
): { state: GraphState; result: "linked" | "exists" | "skip" } {
  const target = state.canvas[to];
  if (!target || from === to) return { state, result: "skip" };

  if (state.canvas[from]) {
    if (state.edges.some((e) => e.from === from && e.to === to)) return { state, result: "exists" };
    let next = addEdge(state, from, to);
    // От черновика на бэк сохранять нечего: PATCH случится, когда черновик создадут.
    if (target.localOnly || isLocalCanvasId(state, from)) {
      next = {
        ...next,
        dirtyTargets: next.dirtyTargets.filter(
          (id) => id !== to || state.dirtyTargets.includes(to),
        ),
      };
    }
    return { state: next, result: "linked" };
  }

  const gt = getGamificationTasksCondition(target.conditions);
  const list = Array.isArray(gt?.list) ? gt.list.map(String) : [];
  if (list.includes(from)) return { state, result: "exists" };
  const cfg = state.targetConfigs[to] ?? DEFAULT_GT_CONFIG;
  const conditions = mergeGamificationTasks(target.conditions ?? [], {
    ...cfg,
    ...(gt ?? {}),
    list: [...list, from],
  });
  let next: GraphState = {
    ...state,
    canvas: { ...state.canvas, [to]: { ...target, conditions } },
    targetConfigs: state.targetConfigs[to]
      ? state.targetConfigs
      : { ...state.targetConfigs, [to]: { ...cfg } },
  };
  next = syncConditionsFromEdges(next, to);
  if (!target.localOnly && !next.dirtyTargets.includes(to)) {
    next = { ...next, dirtyTargets: [...next.dirtyTargets, to] };
  }
  return { state: next, result: "linked" };
}

export async function openPackageOnCanvas(
  pkgRef: GraphicPackage,
  { ensureAuthenticated }: { ensureAuthenticated: (domain: string) => Promise<boolean> },
): Promise<OpenPackageResult> {
  const id = Number(pkgRef.id);
  if (!Number.isInteger(id) || id <= 0) throw new Error("Некорректный id пакета");

  const pkg = (await graphicApiGet(
    `/api/promohub-planner/packages/${id}`,
  )) as GraphicPackage | null;
  let tasks = Array.isArray(pkg?.tasks) ? pkg.tasks : [];
  if (!tasks.length) {
    tasks = extractPackageTasks(await graphicApiGet(`/api/promohub-planner/packages/${id}/tasks`));
  }
  if (!tasks.length) throw new Error("В пакете нет задач");

  const store = useChainsStore.getState();
  const domain = store.domain;
  const linkedTasks = tasks.filter((t) => getPlannerPhBackendId(t) != null);
  if (linkedTasks.length && !domain) {
    throw new Error("Выберите домен админки — без него нельзя подгрузить задачи с ph_backend_id");
  }
  if (linkedTasks.length && !(await ensureAuthenticated(domain))) {
    throw new Error("Вход не выполнен — задачи с бэка не загружены");
  }

  const tasksById = new Map<unknown, PlannerTask>();
  for (const item of tasks) {
    if (!item || item.id == null) continue;
    tasksById.set(item.id, item);
    tasksById.set(String(item.id), item);
  }
  const placements = planPackagePlacement(tasks, nextStackOrigin(store.canvas));
  const canvasIdByPlannerId = new Map<number, string>();
  const result: OpenPackageResult = {
    placedBackend: [],
    placedDrafts: [],
    loadErrors: [],
    linked: 0,
    backendDirty: 0,
    unresolved: [],
    packageName: String(pkg?.name || id),
  };

  const newCanvas: Record<string, CanvasTask> = {};
  const newCatalog: Record<string, CatalogTask> = {};
  for (const p of placements) {
    const { task } = p;
    if (p.phBackendId != null) {
      const backendId = String(p.phBackendId);
      store.setStatus(`Загружаю с бэка #${backendId}…`);
      try {
        const backendTask = await fetchTask(domain, backendId);
        const body = mergeBackendTaskWithPlannerBrief(backendTask, task, { tasksById });
        const existing = useChainsStore.getState().canvas[backendId];
        newCanvas[backendId] = {
          id: backendId,
          name: String(body.name || existing?.name || ""),
          frontend_identifier: String(
            body.frontend_identifier || existing?.frontend_identifier || "",
          ),
          conditions: Array.isArray(body.conditions)
            ? (body.conditions as CanvasTask["conditions"])
            : [],
          full: body,
          x: existing?.x ?? p.x,
          y: existing?.y ?? p.y,
          ...(existing?.headerColor ? { headerColor: existing.headerColor } : {}),
          configuredOnBackend: existing?.configuredOnBackend,
        };
        newCatalog[backendId] = catalogFromTask(backendTask);
        result.placedBackend.push(backendId);
        canvasIdByPlannerId.set(Number(task.id), backendId);
      } catch (err) {
        result.loadErrors.push(
          `#${backendId} (${plannerTaskLabel(task, String(task.id))}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      continue;
    }
    const body: TaskLike = mapPlannerTaskToDraft(task, { tasksById });
    const draftId = newLocalDraftId();
    newCanvas[draftId] = {
      id: draftId,
      name: String(body.name || "(локальный черновик)"),
      frontend_identifier: String(body.frontend_identifier || ""),
      conditions: Array.isArray(body.conditions)
        ? (body.conditions as CanvasTask["conditions"])
        : [],
      full: body,
      x: p.x,
      y: p.y,
      localOnly: true,
    };
    result.placedDrafts.push(draftId);
    canvasIdByPlannerId.set(Number(task.id), draftId);
  }

  // Предшественники из других пакетов — по их ph_backend_id (GET задачи графика).
  const links = collectPlannerLinks(placements, canvasIdByPlannerId);
  const outside = new Map<number, PlannerTask | null>();
  const resolvedSources = new Map<number, string | null>();
  for (const link of links) {
    if (link.cycle || resolvedSources.has(link.prereqPlannerId)) continue;
    let sourceId = canvasIdByPlannerId.get(link.prereqPlannerId) ?? null;
    if (!sourceId) {
      let prereq = tasksById.get(link.prereqPlannerId) ?? null;
      if (!prereq) {
        if (!outside.has(link.prereqPlannerId)) {
          outside.set(
            link.prereqPlannerId,
            (await graphicApiGet(`/api/promohub-planner/tasks/${link.prereqPlannerId}`).catch(
              () => null,
            )) as PlannerTask | null,
          );
        }
        prereq = outside.get(link.prereqPlannerId) ?? null;
      }
      const backendId = getPlannerPhBackendId(prereq);
      sourceId = backendId != null ? String(backendId) : null;
      if (!sourceId) {
        const prereqLabel = plannerTaskLabel(prereq, `задача графика #${link.prereqPlannerId}`);
        result.unresolved.push(`${prereqLabel} → ${link.targetLabel}`);
      }
    }
    resolvedSources.set(link.prereqPlannerId, sourceId);
  }

  useChainsStore.setState((s) => {
    const catalog = { ...s.catalog, ...newCatalog };
    const catalogOrder = [...s.catalogOrder];
    for (const cid of Object.keys(newCatalog))
      if (!catalogOrder.includes(cid)) catalogOrder.unshift(cid);
    let next: GraphState = { ...s, canvas: { ...s.canvas, ...newCanvas } };
    if (result.placedBackend.length) next = importGraphFromConditions(next, result.placedBackend);
    for (const link of links) {
      if (link.cycle) {
        result.unresolved.push(`${link.targetLabel}: цикл связей в графике`);
        continue;
      }
      const sourceId = resolvedSources.get(link.prereqPlannerId);
      if (!sourceId) continue;
      const wasDirty = next.dirtyTargets.includes(link.targetId);
      const linked = linkPrerequisite(next, sourceId, link.targetId);
      next = linked.state;
      if (linked.result === "linked") {
        result.linked += 1;
        if (!wasDirty && next.dirtyTargets.includes(link.targetId)) result.backendDirty += 1;
      }
    }
    return { ...next, catalog, catalogOrder };
  });
  void useChainsStore.getState().persistPositions();
  return result;
}

/** Сообщает планировщику, что задача графика создана на бэке. Ошибка не критична. */
export async function notifyGraphicBackendCreated(
  plannerTaskId: number | string | null | undefined,
  phBackendId: number | string,
): Promise<void> {
  if (plannerTaskId == null || plannerTaskId === "") return;
  try {
    await graphicApiPost(`/api/promohub-planner/tasks/${plannerTaskId}/mark-backend-created`, {
      ph_backend_id: String(phBackendId),
    });
  } catch (err) {
    console.warn("[graphic] mark-backend-created failed:", err);
  }
}
