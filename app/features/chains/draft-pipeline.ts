/**
 * Путь локального черновика на бэк без формы — тот же, что проходит человек:
 * тело с канвы (со связями) → значения формы с подстановками из брифа → payload → POST,
 * затем карточка получает настоящий id, график — отметку, последователи — связь.
 */
import type { TaskOption } from "@/features/task-form/conditions-builder";
import {
  buildTaskPayload,
  prefillDraftValues,
  taskToFormValues,
} from "@/features/task-form/task-form";
import type { ParsedTaskMeta } from "@/lib/meta";
import { validateTaskPayload } from "@/lib/task-schema";
import type { GamificationTask, TaskLike, TaskPayloadEnvelope } from "@/lib/types";

import { type GraphState, draftBodyWithCanvasLinks } from "./graph";
import { notifyGraphicBackendCreated } from "./packages-actions";
import { type ChainsStore, useChainsStore } from "./store";

export interface DraftRefs {
  meta: ParsedTaskMeta | null;
}

/** Задачи каталога для выбора предшественника по имени — как taskOptions формы. */
export function catalogTaskOptions(state: Pick<ChainsStore, "catalog" | "catalogOrder">) {
  return state.catalogOrder.map((id): TaskOption => ({ id, name: state.catalog[id]?.name ?? "" }));
}

/** Тело черновика, каким его открыла бы форма; null — это не локальный черновик. */
export function draftSourceTask(state: GraphState, id: string): TaskLike | null {
  const card = state.canvas[id];
  if (!card?.localOnly || !card.full) return null;
  return draftBodyWithCanvasLinks(state, card.full, card.conditions);
}

export interface DraftPayload {
  task: TaskLike;
  payload: TaskPayloadEnvelope;
  /** Ошибки схемы payload — с ними бэк задачу не примет. */
  errors: string[];
}

/**
 * Payload черновика, который уйдёт на бэк. Статус всегда draft: задача появится в админке
 * неактивной и дождётся проверки человеком.
 */
export function buildDraftPayload(
  state: GraphState & Pick<ChainsStore, "catalog" | "catalogOrder">,
  id: string,
  refs: DraftRefs,
): DraftPayload | null {
  const task = draftSourceTask(state, id);
  if (!task) return null;
  const values = prefillDraftValues(taskToFormValues(task, { mode: "edit" }), task, {
    metaTags: refs.meta?.tags ?? null,
    metaBonuses: refs.meta?.bonuses ?? null,
    taskOptions: catalogTaskOptions(state),
  });
  let payload: TaskPayloadEnvelope;
  try {
    payload = buildTaskPayload(values, task, { metaTags: refs.meta?.tags ?? null });
  } catch (err) {
    return {
      task,
      payload: { gamification_task: task },
      errors: [err instanceof Error ? err.message : String(err)],
    };
  }
  payload.gamification_task.state = "draft";
  return { task, payload, errors: validateTaskPayload(payload.gamification_task) };
}

/** После POST черновика: id на канве, отметка в графике, связи последователей — на бэк. */
export function applyDraftCreated(
  task: GamificationTask,
  localId: string,
  plannerTaskId: number | string | null,
): void {
  useChainsStore.getState().applyCreatedTask(task, localId);
  void notifyGraphicBackendCreated(plannerTaskId, task.id);
  const followers = useChainsStore.getState().dirtyTargets;
  if (followers.length) void useChainsStore.getState().saveChanges(followers);
}
