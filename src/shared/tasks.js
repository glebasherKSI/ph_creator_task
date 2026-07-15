import {
  VISIBLE_TASK_STATES,
  CREATE_TASK_KEYS,
  CREATE_TASK_KEY_SET,
  STRIP_FROM_CREATE,
  READONLY_KEYS,
} from "./constants.js";

export function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

export function isVisibleTaskState(raw) {
  const taskState = String(raw?.state ?? "draft").toLowerCase();
  return VISIBLE_TASK_STATES.has(taskState);
}

export function taskListFromResponse(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];

  const candidates = [
    payload.gamification_tasks,
    payload.tasks,
    payload.data,
    payload.items,
    payload.results,
  ];
  for (const maybe of candidates) {
    if (Array.isArray(maybe)) return maybe;
  }

  for (const value of Object.values(payload)) {
    if (
      Array.isArray(value) &&
      value.length &&
      value[0] &&
      typeof value[0] === "object" &&
      ("id" in value[0] || "name" in value[0])
    ) {
      return value;
    }
  }
  return [];
}

export function taskFromResponse(payload) {
  if (payload?.gamification_task) return payload.gamification_task;
  if (payload?.data?.gamification_task) return payload.data.gamification_task;
  if (payload?.task) return payload.task;
  if (payload && typeof payload === "object" && "id" in payload) return payload;
  return null;
}

const TASK_ID_IN_PATH_RE = /\/gamification\/tasks\/(\d+)/i;

function parseTaskIdFromUrl(url) {
  if (!url) return null;
  const match = String(url).match(TASK_ID_IN_PATH_RE);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isFinite(id) ? id : null;
}

function isLikelyHttpStatusBody(value) {
  if (typeof value === "number") return value >= 100 && value < 600;
  if (typeof value === "string" && /^\d{3}$/.test(value.trim())) return true;
  return false;
}

/** Извлекает id новой задачи из тела ответа create и метаданных (Location, url). */
export function extractTaskIdFromCreateResponse(response, meta = {}) {
  const created = taskFromResponse(response);
  if (created?.id != null) return created.id;

  if (response && typeof response === "object" && !Array.isArray(response)) {
    const nested =
      response.gamification_task?.id ??
      response.data?.gamification_task?.id ??
      response.data?.id ??
      response.id ??
      response.task_id ??
      response.gamification_task_id;
    if (nested != null && typeof nested !== "object") return nested;
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

function sortTasksNewestFirst(tasks) {
  return [...tasks].sort((a, b) => {
    const aCreated = a.created_at ? Date.parse(a.created_at) : 0;
    const bCreated = b.created_at ? Date.parse(b.created_at) : 0;
    if (bCreated !== aCreated) return bCreated - aCreated;
    return Number(b.id) - Number(a.id);
  });
}

/**
 * Определяет id только что созданной задачи: сначала из response/Location,
 * затем GET list и match по frontend_identifier (+ name).
 * @param {(path: string, method?: string, body?: unknown) => Promise<unknown>} apiFetch
 */
export async function resolveCreatedTaskId(apiFetch, payload, response, meta = {}) {
  const direct = extractTaskIdFromCreateResponse(response, meta);
  if (direct != null) return direct;

  const taskPayload = payload?.gamification_task || payload || {};
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
  return sortTasksNewestFirst(matches)[0].id ?? null;
}

export function boolValue(value, fallback = false) {
  if (typeof value === "boolean") return value;
  return fallback;
}

export function removeReadonlyDeep(value) {
  if (Array.isArray(value)) return value.map(removeReadonlyDeep);
  if (!value || typeof value !== "object") return value;
  const next = {};
  for (const [key, nested] of Object.entries(value)) {
    if (READONLY_KEYS.has(key)) continue;
    next[key] = removeReadonlyDeep(nested);
  }
  return next;
}

export function sanitizeTag(tag) {
  if (!tag || typeof tag !== "object" || Array.isArray(tag)) return null;
  const id = tag.id;
  if (id == null) return null;
  return {
    cross_project: !!tag.cross_project,
    id,
    name: tag.name ?? "",
    settings: tag.settings && typeof tag.settings === "object" ? { ...tag.settings } : {},
    shared_projects: Array.isArray(tag.shared_projects) ? [...tag.shared_projects] : [],
  };
}

export function resolveTagFromInput(raw, fallbackTag, fallbackTagId) {
  if (!raw) {
    return {
      tag: sanitizeTag(fallbackTag),
      tag_id: fallbackTagId ?? fallbackTag?.id ?? null,
    };
  }
  const parsed = JSON.parse(raw);
  if (typeof parsed === "number") {
    return {
      tag: sanitizeTag(fallbackTag?.id === parsed ? fallbackTag : { id: parsed }),
      tag_id: parsed,
    };
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const tag = sanitizeTag(parsed);
    return { tag, tag_id: tag?.id ?? fallbackTagId ?? null };
  }
  return { tag: null, tag_id: null };
}

function applyCreateDefaults(payload) {
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
  return payload;
}

export function buildCreatePayload(task, overrides = {}) {
  const source = task && typeof task === "object" ? task : {};
  const merged = { ...source, ...overrides };

  const payload = {};
  for (const key of CREATE_TASK_KEYS) {
    if (!(key in merged) || merged[key] === undefined) continue;
    if (key === "tag") continue;
    if (key === "tag_id") continue;
    payload[key] = cloneJson(merged[key]);
  }

  const tagInfo = resolveTagFromInput(
    overrides.__tagRaw,
    merged.tag ?? source.tag,
    merged.tag_id ?? source.tag_id
  );
  if (tagInfo.tag_id != null) payload.tag_id = tagInfo.tag_id;
  if (tagInfo.tag) payload.tag = tagInfo.tag;

  return applyCreateDefaults(payload);
}

export function buildPatchPayload(task, conditions) {
  const payload = {};
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
  payload.id = task.id;
  return { gamification_task: payload };
}

export { CREATE_TASK_KEYS, CREATE_TASK_KEY_SET, STRIP_FROM_CREATE, VISIBLE_TASK_STATES };
