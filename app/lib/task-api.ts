/** Операции с задачами через admin API (со страниц расширения, через background). */
import { apiFetch, apiFetchResult, resolveAdminTab } from "./api";
import { PAGE_SIZE } from "./constants";
import {
  isVisibleTaskState,
  resolveCreatedTaskId,
  taskFromResponse,
  taskListFromResponse,
} from "./tasks";
import type { GamificationTask, TaskPayloadEnvelope } from "./types";

export interface TasksPage {
  tasks: GamificationTask[];
  /** Сколько задач на странице скрыто по статусу (не active/draft). */
  hidden: number;
  /** Сколько строк вернул бэк (для offset и hasMore). */
  rawCount: number;
  hasMore: boolean;
}

export async function fetchTasksPage(
  domain: string,
  offset: number,
  limit: number = PAGE_SIZE,
): Promise<TasksPage> {
  const context = await resolveAdminTab(domain);
  const data = await apiFetch(
    context,
    `/admin/api/gamification/tasks?limit=${limit}&offset=${offset}&locale=ru`,
  );
  const page = taskListFromResponse(data);
  const tasks = page.filter(isVisibleTaskState);
  return {
    tasks,
    hidden: page.length - tasks.length,
    rawCount: page.length,
    hasMore: page.length === limit,
  };
}

export async function fetchTask(
  domain: string,
  taskId: number | string,
): Promise<GamificationTask> {
  const context = await resolveAdminTab(domain);
  const data = await apiFetch(context, `/admin/api/gamification/tasks/${taskId}?locale=ru`);
  const task = taskFromResponse(data);
  if (!task) throw new Error("API не вернул объект gamification_task");
  return task;
}

export interface CreateTaskResult {
  response: unknown;
  /** id новой задачи или null, если бэк его не вернул и найти по списку не удалось. */
  newId: number | string | null;
  /** Полная задача после создания (если удалось дочитать). */
  task: GamificationTask | null;
}

export async function createTask(
  domain: string,
  payload: TaskPayloadEnvelope,
): Promise<CreateTaskResult> {
  const context = await resolveAdminTab(domain);
  const {
    data: response,
    headers,
    url,
  } = await apiFetchResult(context, "/admin/api/gamification/tasks?locale=ru", "POST", payload);
  const newId = await resolveCreatedTaskId(
    (path, method, body) => apiFetch(context, path, method, body),
    payload,
    response,
    { headers, url },
  );
  const task =
    newId == null ? null : await fetchTask(domain, newId).catch(() => taskFromResponse(response));
  return { response, newId, task };
}

export async function updateTask(
  domain: string,
  taskId: number | string,
  payload: TaskPayloadEnvelope,
): Promise<{ response: unknown; task: GamificationTask | null }> {
  const context = await resolveAdminTab(domain);
  const body: TaskPayloadEnvelope = {
    gamification_task: { ...payload.gamification_task, id: Number(taskId) || taskId },
  };
  const response = await apiFetch(
    context,
    `/admin/api/gamification/tasks/${taskId}?locale=ru`,
    "PATCH",
    body,
  );
  const task = await fetchTask(domain, taskId).catch(() => taskFromResponse(response));
  return { response, task };
}
