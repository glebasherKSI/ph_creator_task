import { apiFetch, resolveAdminTab } from "./api.js";

const CACHE_TTL_MS = 10 * 60 * 1000;

/** @type {Map<string, { data: ParsedTaskMeta, expiresAt: number }>} */
const cache = new Map();

export const DEFAULT_TASK_TYPES = ["interactive", "informational", "achievement"];
export const DEFAULT_CATEGORIES = ["basic", "beginning", "passive", "progressive", "sequence"];
export const DEFAULT_PRIORITIES = [0, 1, 2, 3, 4];

/**
 * @typedef {object} ParsedTaskMeta
 * @property {string[]} events
 * @property {{ id: number, name: string }[]} filters
 * @property {{ id: number, name: string }[]} tags
 * @property {{ id: string, title?: string, name?: string }[]} bonuses
 * @property {string[]} notification_events
 * @property {string[]} dsl_tags
 * @property {string[]} categories
 * @property {string[]} types
 * @property {number[]} priorities
 */

/**
 * @param {unknown} raw
 * @returns {ParsedTaskMeta}
 */
export function parseTaskMeta(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const constants =
    source.constants && typeof source.constants === "object" ? source.constants : {};

  const categories = normalizeStringList(
    source.categories ??
      constants.categories ??
      constants.gamification_task_categories ??
      DEFAULT_CATEGORIES
  );

  const types = normalizeStringList(
    source.types ??
      constants.gamification_task_types ??
      constants.task_types ??
      DEFAULT_TASK_TYPES
  );

  const priorities = normalizePriorityList(source.priorities ?? constants.priorities);

  return {
    events: normalizeStringList(source.events),
    filters: normalizeObjectList(source.filters, ["id", "name"]),
    tags: normalizeObjectList(source.tags, ["id", "name"]),
    bonuses: normalizeBonusList(source.bonuses),
    notification_events: normalizeStringList(source.notification_events),
    dsl_tags: normalizeStringList(source.dsl_tags),
    categories,
    types,
    priorities,
  };
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item)).filter(Boolean);
}

function normalizeObjectList(value, keys) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const next = {};
      for (const key of keys) {
        if (item[key] != null) next[key] = item[key];
      }
      return next;
    })
    .filter((item) => Object.keys(item).length > 0);
}

function normalizeBonusList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === "object" && item.id != null)
    .map((item) => ({
      id: String(item.id),
      title: item.title ?? item.name ?? String(item.id),
    }));
}

function normalizePriorityList(value) {
  if (!Array.isArray(value) || !value.length) return [...DEFAULT_PRIORITIES];
  const nums = value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item));
  return nums.length ? nums : [...DEFAULT_PRIORITIES];
}

/**
 * GET /admin/api/gamification/tasks/meta?locale=ru с кэшем на сессию (TTL 10 мин).
 * @param {string} domain
 * @returns {Promise<ParsedTaskMeta>}
 */
export async function loadTaskMeta(domain) {
  const key = String(domain || "").trim();
  if (!key) throw new Error("Домен не задан для загрузки meta");

  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const adminContext = await resolveAdminTab(key);
  const raw = await apiFetch(adminContext, "/admin/api/gamification/tasks/meta?locale=ru");
  const data = parseTaskMeta(raw);
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  return data;
}

/** @param {string} [domain] */
export function clearTaskMetaCache(domain) {
  if (domain) cache.delete(String(domain).trim());
  else cache.clear();
}
