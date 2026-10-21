import { apiFetch, resolveAdminTab } from "./api.js";

const CACHE_TTL_MS = 10 * 60 * 1000;
const CONDITIONS_API_PATH = "/admin/api/filters/conditions?locale=ru";
const CONSTANTS_API_PATH = "/admin/api/constants?locale=ru";
const FIXTURE_PATH = "test_primer/conditions.json";
const CONSTANTS_FIXTURE_PATH = "test_primer/constant.json";

/** @type {Map<string, { data: ParsedConditionsSchema, expiresAt: number }>} */
const cache = new Map();

/** @type {ParsedConditionsSchema | null} */
let fixtureCache = null;

/** @type {Set<string> | null} */
let duplicableFixtureCache = null;

/** @type {Map<string, { data: Set<string>, expiresAt: number }>} */
const duplicableCache = new Map();

/**
 * @typedef {object} ConditionDefinition
 * @property {string} name
 * @property {string} label
 * @property {string} type
 * @property {unknown} value
 * @property {Array<{ id: string, name: string }>} [collection]
 * @property {Array<{ id: string, name: string }>} [availableTypes]
 * @property {Array<{ id: string, name: string }>} [availableExtraTypes]
 * @property {Record<string, unknown>} [extra]
 */

/**
 * @typedef {object} ParsedConditionsSchema
 * @property {ConditionDefinition[]} conditions
 * @property {Map<string, ConditionDefinition>} byName
 * @property {Map<string, { count: number, exampleName: string, exampleLabel: string }>} widgetTypes
 * @property {string} source
 */

/**
 * @param {unknown} raw
 * @returns {ParsedConditionsSchema}
 */
export function parseConditionsSchema(raw, source = "unknown") {
  const root = raw && typeof raw === "object" ? raw : {};
  const list = Array.isArray(root.conditions) ? root.conditions : [];
  /** @type {Map<string, ConditionDefinition>} */
  const byName = new Map();
  /** @type {Map<string, { count: number, exampleName: string, exampleLabel: string }>} */
  const widgetTypes = new Map();

  const conditions = list
    .filter((item) => item && typeof item === "object" && item.name)
    .map((item) => {
      const def = {
        name: String(item.name),
        label: String(item.label || item.name),
        type: String(item.type || "unknown"),
        value: cloneDefaultValue(item.value),
        collection: normalizeOptionList(item.collection),
        availableTypes: normalizeOptionList(item.availableTypes),
        availableExtraTypes: normalizeOptionList(item.availableExtraTypes),
        extra: collectExtraProps(item),
      };
      byName.set(def.name, def);

      const wt = widgetTypes.get(def.type) || {
        count: 0,
        exampleName: def.name,
        exampleLabel: def.label,
      };
      wt.count += 1;
      widgetTypes.set(def.type, wt);
      return def;
    });

  return { conditions, byName, widgetTypes, source };
}

function normalizeOptionList(value) {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((item) => item && item.id != null)
    .map((item) => ({ id: String(item.id), name: String(item.name ?? item.id) }));
}

function collectExtraProps(item) {
  const skip = new Set([
    "name",
    "label",
    "type",
    "value",
    "errors",
    "collection",
    "availableTypes",
    "availableExtraTypes",
  ]);
  const extra = {};
  for (const [key, val] of Object.entries(item)) {
    if (skip.has(key)) continue;
    extra[key] = val;
  }
  return extra;
}

function cloneDefaultValue(value) {
  if (value == null) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

async function loadConditionsFixture() {
  if (fixtureCache) return fixtureCache;

  let url;
  if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
    url = chrome.runtime.getURL(FIXTURE_PATH);
  } else {
    url = `/${FIXTURE_PATH}`;
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Не удалось загрузить fixture conditions (${response.status})`);
  }
  const raw = await response.json();
  fixtureCache = parseConditionsSchema(raw, "fixture");
  return fixtureCache;
}

/**
 * GET /admin/api/filters/conditions?locale=ru с кэшем (TTL 10 мин).
 * Fallback — test_primer/conditions.json через chrome.runtime.getURL.
 * @param {string} domain
 * @returns {Promise<ParsedConditionsSchema>}
 */
export async function loadConditionsSchema(domain) {
  const key = String(domain || "").trim();
  if (!key) {
    return loadConditionsFixture();
  }

  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  try {
    const adminContext = await resolveAdminTab(key);
    const raw = await apiFetch(adminContext, CONDITIONS_API_PATH);
    const data = parseConditionsSchema(raw, "api");
    cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    return data;
  } catch (err) {
    const fixture = await loadConditionsFixture();
    return {
      ...fixture,
      source: `fixture (API: ${err?.message || err})`,
    };
  }
}

/** @returns {Promise<ParsedConditionsSchema>} */
export async function loadConditionsSchemaFixture() {
  return loadConditionsFixture();
}

/** @param {ParsedConditionsSchema | null | undefined} schema */
export function getConditionDef(schema, name) {
  if (!schema?.byName) return null;
  return schema.byName.get(String(name)) ?? null;
}

/** @param {ParsedConditionsSchema | null | undefined} schema */
export function getAllConditions(schema) {
  return schema?.conditions ? [...schema.conditions] : [];
}

/** @param {ParsedConditionsSchema | null | undefined} schema */
export function getWidgetTypesMap(schema) {
  if (!schema?.widgetTypes) return new Map();
  return new Map(schema.widgetTypes);
}

/** @param {string} [domain] */
export function clearConditionsSchemaCache(domain) {
  if (domain) cache.delete(String(domain).trim());
  else cache.clear();
}

/**
 * @param {unknown} raw
 * @returns {Set<string>}
 */
export function parseDuplicableOptions(raw) {
  const root = raw && typeof raw === "object" ? raw : {};
  const constants =
    root.constants && typeof root.constants === "object" ? root.constants : root;
  const dsl = constants.dsl && typeof constants.dsl === "object" ? constants.dsl : {};
  const list = Array.isArray(dsl.duplicable_options) ? dsl.duplicable_options : [];
  return new Set(list.map((item) => String(item)));
}

async function loadDuplicableFixture() {
  if (duplicableFixtureCache) return duplicableFixtureCache;

  let url;
  if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
    url = chrome.runtime.getURL(CONSTANTS_FIXTURE_PATH);
  } else {
    url = `/${CONSTANTS_FIXTURE_PATH}`;
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Не удалось загрузить fixture constants (${response.status})`);
  }
  const raw = await response.json();
  duplicableFixtureCache = parseDuplicableOptions(raw);
  return duplicableFixtureCache;
}

/**
 * Имена условий, которые можно добавить в таргетинг несколько раз (dsl.duplicable_options).
 * @param {string} domain
 * @returns {Promise<Set<string>>}
 */
export async function loadDuplicableOptions(domain) {
  const key = String(domain || "").trim();
  if (!key) {
    return loadDuplicableFixture();
  }

  const cached = duplicableCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  try {
    const adminContext = await resolveAdminTab(key);
    const raw = await apiFetch(adminContext, CONSTANTS_API_PATH);
    const data = parseDuplicableOptions(raw);
    duplicableCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    return data;
  } catch {
    return loadDuplicableFixture();
  }
}

/** @param {string} name @param {Set<string> | null | undefined} duplicable */
export function isConditionDuplicable(name, duplicable) {
  return Boolean(duplicable?.has(String(name)));
}

export {
  CONDITIONS_API_PATH,
  CONSTANTS_API_PATH,
  FIXTURE_PATH,
  CONSTANTS_FIXTURE_PATH,
  CACHE_TTL_MS,
};
