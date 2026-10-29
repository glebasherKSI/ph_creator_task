/**
 * Журнал создания/правки задач — датасет для будущего ИИ-агента, хранится в БД Promo Graphic.
 * Пример: задание графика (снимает бэк по planner_task_id) → draft (с чего начал человек)
 * → payload (что ушло в админку) → result (что сохранила админка).
 * Журнал не мешает работе: без входа в график или при сбое сети событие теряется.
 */
import { browser } from "wxt/browser";

import { errorMessage } from "./auth/errors";
import { graphicApiPost } from "./graphic-api";
import { getGraphicProjectForDomain } from "./storage";

export type TaskEventKind = "created" | "create_failed" | "updated";
/**
 * package — черновик из пакета графика, draft — локальный черновик, copy — копия, edit — правка,
 * agent — черновик создал агент (agent_run_id и notes — для проверки человеком).
 */
export type TaskEventSource = "package" | "draft" | "copy" | "edit" | "agent";

export interface TaskEvent {
  event: TaskEventKind;
  source: TaskEventSource;
  domain: string;
  ph_backend_id?: number | string | null;
  planner_task_id?: number | string | null;
  draft?: unknown;
  payload?: unknown;
  result?: unknown;
  error?: string;
  duration_ms?: number;
  agent_run_id?: string;
  /** Пояснение агента для проверяющего: что заполнил и в чём не уверен. */
  notes?: string;
}

export async function logTaskEvent(event: TaskEvent): Promise<void> {
  try {
    await graphicApiPost("/api/promohub-planner/task-events", {
      ...event,
      project_code: await getGraphicProjectForDomain(event.domain),
      client_version: browser.runtime.getManifest().version,
    });
  } catch (err) {
    console.warn("[task-events] не записано:", errorMessage(err));
  }
}
