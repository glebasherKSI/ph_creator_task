/**
 * Схема условий таргетинга: GET /admin/api/filters/conditions с кэшем и
 * откатом на фикстуру public/test_primer/conditions.json. Группы из схемы с бэка
 * синхронизируются в Promo Graphic (graphic-groups.ts).
 */
import { browser } from "wxt/browser";

import { apiFetch, resolveAdminTab } from "./api";
import { syncGraphicGroups } from "./graphic-groups";

export const CACHE_TTL_MS = 10 * 60 * 1000;
export const CONDITIONS_API_PATH = "/admin/api/filters/conditions?locale=ru";
export const CONSTANTS_API_PATH = "/admin/api/constants?locale=ru";
export const FIXTURE_PATH = "test_primer/conditions.json";
export const CONSTANTS_FIXTURE_PATH = "test_primer/constant.json";

export interface OptionRef {
  id: string;
  name: string;
}

export interface ConditionDefinition {
  name: string;
  label: string;
  type: string;
  value: unknown;
  collection?: OptionRef[];
  availableTypes?: OptionRef[];
  availableExtraTypes?: OptionRef[];
  extra: Record<string, unknown>;
}

export interface WidgetTypeInfo {
  count: number;
  exampleName: string;
  exampleLabel: string;
}

export interface ParsedConditionsSchema {
  conditions: ConditionDefinition[];
  byName: Map<string, ConditionDefinition>;
  widgetTypes: Map<string, WidgetTypeInfo>;
  source: string;
}

const cache = new Map<string, { data: ParsedConditionsSchema; expiresAt: number }>();
let fixtureCache: ParsedConditionsSchema | null = null;
let duplicableFixtureCache: Set<string> | null = null;
const duplicableCache = new Map<string, { data: Set<string>; expiresAt: number }>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeOptionList(value: unknown): OptionRef[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((item): item is Record<string, unknown> => isRecord(item) && item.id != null)
    .map((item) => ({ id: String(item.id), name: String(item.name ?? item.id) }));
}

const EXTRA_SKIP = new Set([
  "name",
  "label",
  "type",
  "value",
  "errors",
  "collection",
  "availableTypes",
  "availableExtraTypes",
]);

function collectExtraProps(item: Record<string, unknown>): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(item)) {
    if (EXTRA_SKIP.has(key)) continue;
    extra[key] = val;
  }
  return extra;
}

function cloneDefaultValue(value: unknown): unknown {
  if (value == null) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

export function parseConditionsSchema(raw: unknown, source = "unknown"): ParsedConditionsSchema {
  const root = isRecord(raw) ? raw : {};
  const list = Array.isArray(root.conditions) ? root.conditions : [];
  const byName = new Map<string, ConditionDefinition>();
  const widgetTypes = new Map<string, WidgetTypeInfo>();

  const conditions = list
    .filter((item): item is Record<string, unknown> => isRecord(item) && Boolean(item.name))
    .map((item) => {
      const def: ConditionDefinition = {
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

/** Фикстуры лежат в public/ — WXT типизирует их пути, поэтому литералы, а не строки. */
const FIXTURE_URLS = {
  [FIXTURE_PATH]: () => browser.runtime.getURL("/test_primer/conditions.json"),
  [CONSTANTS_FIXTURE_PATH]: () => browser.runtime.getURL("/test_primer/constant.json"),
} as const;

function fixtureUrl(path: keyof typeof FIXTURE_URLS): string {
  return FIXTURE_URLS[path]();
}

async function loadConditionsFixture(): Promise<ParsedConditionsSchema> {
  if (fixtureCache) return fixtureCache;
  const response = await fetch(fixtureUrl(FIXTURE_PATH));
  if (!response.ok) {
    throw new Error(`Не удалось загрузить fixture conditions (${response.status})`);
  }
  fixtureCache = parseConditionsSchema(await response.json(), "fixture");
  return fixtureCache;
}

/** Схема с бэка (TTL 10 мин); без домена или при ошибке — фикстура. */
export async function loadConditionsSchema(domain: string): Promise<ParsedConditionsSchema> {
  const key = String(domain || "").trim();
  if (!key) return loadConditionsFixture();

  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    // И из кэша: проект для домена мог смениться; без изменений запроса в график не будет.
    void syncGraphicGroups(key, cached.data.byName.get("groups")?.collection);
    return cached.data;
  }

  try {
    const adminContext = await resolveAdminTab(key);
    const raw = await apiFetch(adminContext, CONDITIONS_API_PATH);
    const data = parseConditionsSchema(raw, "api");
    cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    void syncGraphicGroups(key, data.byName.get("groups")?.collection);
    return data;
  } catch (err) {
    const fixture = await loadConditionsFixture();
    return { ...fixture, source: `fixture (API: ${(err as Error)?.message || err})` };
  }
}

export async function loadConditionsSchemaFixture(): Promise<ParsedConditionsSchema> {
  return loadConditionsFixture();
}

export function getConditionDef(
  schema: ParsedConditionsSchema | null | undefined,
  name: string,
): ConditionDefinition | null {
  if (!schema?.byName) return null;
  return schema.byName.get(String(name)) ?? null;
}

export function getAllConditions(
  schema: ParsedConditionsSchema | null | undefined,
): ConditionDefinition[] {
  return schema?.conditions ? [...schema.conditions] : [];
}

export function getWidgetTypesMap(
  schema: ParsedConditionsSchema | null | undefined,
): Map<string, WidgetTypeInfo> {
  if (!schema?.widgetTypes) return new Map();
  return new Map(schema.widgetTypes);
}

export function clearConditionsSchemaCache(domain?: string): void {
  if (domain) cache.delete(String(domain).trim());
  else cache.clear();
}

/** Имена условий, которые можно добавить в таргетинг несколько раз (dsl.duplicable_options). */
export function parseDuplicableOptions(raw: unknown): Set<string> {
  const root = isRecord(raw) ? raw : {};
  const constants = isRecord(root.constants) ? root.constants : root;
  const dsl = isRecord(constants.dsl) ? constants.dsl : {};
  const list = Array.isArray(dsl.duplicable_options) ? dsl.duplicable_options : [];
  return new Set(list.map((item) => String(item)));
}

async function loadDuplicableFixture(): Promise<Set<string>> {
  if (duplicableFixtureCache) return duplicableFixtureCache;
  const response = await fetch(fixtureUrl(CONSTANTS_FIXTURE_PATH));
  if (!response.ok) {
    throw new Error(`Не удалось загрузить fixture constants (${response.status})`);
  }
  duplicableFixtureCache = parseDuplicableOptions(await response.json());
  return duplicableFixtureCache;
}

export async function loadDuplicableOptions(domain: string): Promise<Set<string>> {
  const key = String(domain || "").trim();
  if (!key) return loadDuplicableFixture();

  const cached = duplicableCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

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

export function isConditionDuplicable(
  name: string,
  duplicable: Set<string> | null | undefined,
): boolean {
  return Boolean(duplicable?.has(String(name)));
}
