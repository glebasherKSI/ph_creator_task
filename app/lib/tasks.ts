import {
  CREATE_TASK_KEYS,
  READONLY_KEYS,
  SEQUENCE_TASK_TYPE,
  STRIP_FROM_CREATE,
  VISIBLE_TASK_STATES,
} from "./constants";
import type {
  Condition,
  GamificationTask,
  GamificationTasksCondition,
  TaskLike,
  TaskPayloadEnvelope,
  TaskTag,
} from "./types";

export function cloneJson<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function isVisibleTaskState(raw: { state?: unknown } | null | undefined): boolean {
  const taskState = String(raw?.state ?? "draft").toLowerCase();
  return VISIBLE_TASK_STATES.has(taskState);
}

/** Достаёт массив задач из любого формата ответа списка. */
export function taskListFromResponse(payload: unknown): GamificationTask[] {
  if (Array.isArray(payload)) return payload as GamificationTask[];
  if (!isRecord(payload)) return [];

  const candidates = [
    payload.gamification_tasks,
    payload.tasks,
    payload.data,
    payload.items,
    payload.results,
  ];
  for (const maybe of candidates) {
    if (Array.isArray(maybe)) return maybe as GamificationTask[];
  }

  for (const value of Object.values(payload)) {
    if (
      Array.isArray(value) &&
      value.length &&
      isRecord(value[0]) &&
      ("id" in value[0] || "name" in value[0])
    ) {
      return value as GamificationTask[];
    }
  }
  return [];
}

export function taskFromResponse(payload: unknown): GamificationTask | null {
  if (!isRecord(payload)) return null;
  if (isRecord(payload.gamification_task)) return payload.gamification_task as GamificationTask;
  if (isRecord(payload.data) && isRecord(payload.data.gamification_task)) {
    return payload.data.gamification_task as GamificationTask;
  }
  if (isRecord(payload.task)) return payload.task as GamificationTask;
  if ("id" in payload) return payload as unknown as GamificationTask;
  return null;
}

const TASK_ID_IN_PATH_RE = /\/gamification\/tasks\/(\d+)/i;

function parseTaskIdFromUrl(url: unknown): number | null {
  if (!url) return null;
  const match = String(url).match(TASK_ID_IN_PATH_RE);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isFinite(id) ? id : null;
}

function isLikelyHttpStatusBody(value: unknown): boolean {
  if (typeof value === "number") return value >= 100 && value < 600;
  if (typeof value === "string" && /^\d{3}$/.test(value.trim())) return true;
  return false;
}

export interface ResponseMeta {
  headers?: Record<string, string | undefined>;
  url?: string;
}

/** Извлекает id новой задачи из тела ответа create и метаданных (Location, url). */
export function extractTaskIdFromCreateResponse(
  response: unknown,
  meta: ResponseMeta = {},
): number | string | null {
  const created = taskFromResponse(response);
  if (created?.id != null) return created.id;

  if (isRecord(response)) {
    const nested =
      (isRecord(response.gamification_task) ? response.gamification_task.id : undefined) ??
      (isRecord(response.data) && isRecord(response.data.gamification_task)
        ? response.data.gamification_task.id
        : undefined) ??
      (isRecord(response.data) ? response.data.id : undefined) ??
      response.id ??
      response.task_id ??
      response.gamification_task_id;
    if (nested != null && typeof nested !== "object") return nested as number | string;
  }

  if (!isLikelyHttpStatusBody(response)) {
    const asNum = Number(response);
    if (Number.isFinite(asNum) && asNum > 0 && !isLikelyHttpStatusBody(asNum)) return asNum;
  }

  const headers = meta.headers || {};
  const location = headers.location || headers.Location;
  const fromLocation = parseTaskIdFromUrl(location);
  if (fromLocation != null) return fromLocation;

  const fromUrl = parseTaskIdFromUrl(meta.url);
  if (fromUrl != null) return fromUrl;

  return null;
}

function sortTasksNewestFirst(tasks: GamificationTask[]): GamificationTask[] {
  return [...tasks].sort((a, b) => {
    const aCreated = a.created_at ? Date.parse(a.created_at) : 0;
    const bCreated = b.created_at ? Date.parse(b.created_at) : 0;
    if (bCreated !== aCreated) return bCreated - aCreated;
    return Number(b.id) - Number(a.id);
  });
}

export type ApiFetchFn = (path: string, method?: string, body?: unknown) => Promise<unknown>;

/**
 * Определяет id только что созданной задачи: сначала из response/Location,
 * затем GET list и match по frontend_identifier (+ name).
 */
export async function resolveCreatedTaskId(
  apiFetch: ApiFetchFn,
  payload: TaskPayloadEnvelope | TaskLike | null | undefined,
  response: unknown,
  meta: ResponseMeta = {},
): Promise<number | string | null> {
  const direct = extractTaskIdFromCreateResponse(response, meta);
  if (direct != null) return direct;

  const taskPayload: TaskLike =
    (payload && isRecord(payload.gamification_task)
      ? (payload.gamification_task as TaskLike)
      : (payload as TaskLike)) || {};
  const frontendId = taskPayload.frontend_identifier;
  const name = taskPayload.name;
  if (!frontendId && !name) return null;

  const listData = await apiFetch("/admin/api/gamification/tasks?limit=10&offset=0&locale=ru");
  const tasks = taskListFromResponse(listData);
  const matches = tasks.filter((task) => {
    const fiOk = frontendId ? task.frontend_identifier === frontendId : true;
    const nameOk = name ? task.name === name : true;
    return fiOk && nameOk;
  });

  if (!matches.length) return null;
  return sortTasksNewestFirst(matches)[0]?.id ?? null;
}

export function boolValue(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  return fallback;
}

export function removeReadonlyDeep<T>(value: T): T {
  if (Array.isArray(value)) return value.map(removeReadonlyDeep) as T;
  if (!isRecord(value)) return value;
  const next: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (READONLY_KEYS.has(key)) continue;
    next[key] = removeReadonlyDeep(nested);
  }
  return next as T;
}

export function sanitizeTag(tag: unknown): TaskTag | null {
  if (!isRecord(tag)) return null;
  const id = tag.id;
  if (id == null) return null;
  return {
    cross_project: !!tag.cross_project,
    id: id as number | string,
    name: (tag.name as string | undefined) ?? "",
    settings: isRecord(tag.settings) ? { ...tag.settings } : {},
    shared_projects: Array.isArray(tag.shared_projects) ? [...tag.shared_projects] : [],
  };
}

export interface ResolvedTag {
  tag: TaskTag | null;
  tag_id: number | string | null;
}

/**
 * Тег из «сырого» значения формы (JSON-строка с числом или объектом)
 * с откатом к тегу исходной задачи.
 */
export function resolveTagFromInput(
  raw: string | null | undefined,
  fallbackTag: unknown,
  fallbackTagId: number | string | null | undefined,
): ResolvedTag {
  const fallback = isRecord(fallbackTag) ? fallbackTag : null;
  if (!raw) {
    return {
      tag: sanitizeTag(fallback),
      tag_id: fallbackTagId ?? (fallback?.id as number | string | undefined) ?? null,
    };
  }
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed === "number") {
    return {
      tag: sanitizeTag(fallback?.id === parsed ? fallback : { id: parsed }),
      tag_id: parsed,
    };
  }
  if (isRecord(parsed)) {
    const tag = sanitizeTag(parsed);
    return { tag, tag_id: tag?.id ?? fallbackTagId ?? null };
  }
  return { tag: null, tag_id: null };
}

function stripFromCreatePayload(payload: TaskLike): TaskLike {
  for (const key of Object.keys(payload)) {
    if (STRIP_FROM_CREATE.has(key)) delete payload[key];
  }
  return payload;
}

function applyCreateDefaults(payload: TaskLike): TaskLike {
  if (!("infinite" in payload)) payload.infinite = false;
  if (!("state" in payload)) payload.state = "draft";
  if (!("locales" in payload)) payload.locales = {};
  if (!("notification_events" in payload)) payload.notification_events = [];
  if (!("conditions" in payload)) payload.conditions = [];
  if (!("countries" in payload)) payload.countries = [];
  if (!("countries_lists" in payload)) payload.countries_lists = [];
  if (!("serialized_main_actions" in payload)) payload.serialized_main_actions = [];
  if (!("serialized_secondary_actions" in payload)) payload.serialized_secondary_actions = [];
  if (!("events" in payload)) payload.events = [];
  if (!("hidden" in payload)) payload.hidden = false;
  // Как админка: эти три поля всегда в теле, по умолчанию выключены.
  if (!("manual_reward" in payload)) payload.manual_reward = false;
  if (!("cross_project" in payload)) payload.cross_project = false;
  if (!("shared_projects" in payload)) payload.shared_projects = [];
  return payload;
}

/** Переопределения формы поверх исходной задачи; `__tagRaw` — сырое значение поля тега. */
export type TaskOverrides = TaskLike & { __tagRaw?: string | null };

/**
 * Поля, которые админка не заполняет у заданий-цепочек (type: "sequence").
 * Применяются поверх любых значений, чтобы при копировании с обычной задачи они не протекли.
 */
export const SEQUENCE_FIELD_OVERRIDES: Readonly<TaskLike> = Object.freeze({
  conditions: [],
  category: null,
  events: [],
  repeatable: false,
  cron: null,
  available_from: null,
  available_till: null,
  max_repetitions: null,
  countries: [],
  countries_matching_type: null,
  countries_lists: [],
});

export function isSequenceType(type: unknown): boolean {
  return String(type ?? "").trim() === SEQUENCE_TASK_TYPE;
}

/** Тело POST create: поля CREATE_TASK_KEYS из task + overrides, тег, дефолты. */
export function buildCreatePayload(
  task: TaskLike | null | undefined,
  overrides: TaskOverrides = {},
): TaskLike {
  const source: TaskLike = isRecord(task) ? (task as TaskLike) : {};
  const merged: TaskOverrides = { ...source, ...overrides };

  const payload: TaskLike = {};
  for (const key of CREATE_TASK_KEYS) {
    if (!(key in merged) || merged[key] === undefined) continue;
    if (STRIP_FROM_CREATE.has(key)) continue;
    if (key === "tag") continue;
    if (key === "tag_id") continue;
    payload[key] = cloneJson(merged[key]);
  }

  const tagInfo = resolveTagFromInput(
    overrides.__tagRaw,
    merged.tag ?? source.tag,
    (merged.tag_id ?? source.tag_id) as number | string | null | undefined,
  );
  if (tagInfo.tag_id != null) payload.tag_id = tagInfo.tag_id;
  if (tagInfo.tag) payload.tag = tagInfo.tag;

  stripFromCreatePayload(payload);
  return applyCreateDefaults(payload);
}

/** Тело PATCH: как create, но conditions берутся отдельно и добавляется id. */
export function buildPatchPayload(
  task: TaskLike,
  conditions: Condition[] | null | undefined,
): TaskPayloadEnvelope {
  const payload: TaskLike = {};
  for (const key of CREATE_TASK_KEYS) {
    if (!(key in task) || task[key] === undefined) continue;
    if (key === "tag") continue;
    if (key === "tag_id") continue;
    payload[key] = key === "conditions" ? cloneJson(conditions) : cloneJson(task[key]);
  }

  const tag = sanitizeTag(task.tag);
  if (task.tag_id != null) payload.tag_id = task.tag_id;
  if (tag) payload.tag = tag;

  applyCreateDefaults(payload);
  stripFromCreatePayload(payload);
  payload.id = task.id;
  return { gamification_task: payload };
}

/** Блок `gamification_tasks` из conditions задачи (связи между задачами). */
export function getGamificationTasksCondition(
  conditions: unknown,
): GamificationTasksCondition | null {
  if (!Array.isArray(conditions)) return null;
  for (const item of conditions) {
    if (isRecord(item) && isRecord(item.gamification_tasks)) {
      return item.gamification_tasks as unknown as GamificationTasksCondition;
    }
  }
  return null;
}

/**
 * Нормализует блок `gamification_tasks`: list → строки, дефолты type/extra_type.
 * Бэк не отдаёт `only_completed`, когда оно false, поэтому отсутствие поля = false.
 */
export function normalizeGamificationTasksCondition(
  raw: Partial<GamificationTasksCondition> | null | undefined,
): Required<GamificationTasksCondition> {
  return {
    list: Array.isArray(raw?.list) ? raw.list.map((id) => String(id)) : [],
    type: raw?.type === "disabled" ? "disabled" : "enabled",
    extra_type: raw?.extra_type === "and" ? "and" : "or",
    only_completed: raw?.only_completed === true,
  };
}

export { CREATE_TASK_KEYS, STRIP_FROM_CREATE, VISIBLE_TASK_STATES };
