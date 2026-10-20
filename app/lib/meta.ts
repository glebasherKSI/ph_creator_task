/** GET /admin/api/gamification/tasks/meta — справочники формы задачи, с кэшем на сессию. */
import { apiFetch, resolveAdminTab } from "./api";

const CACHE_TTL_MS = 10 * 60 * 1000;

const cache = new Map<string, { data: ParsedTaskMeta; expiresAt: number }>();

export const DEFAULT_TASK_TYPES = ["interactive", "informational", "achievement", "sequence"];
export const DEFAULT_CATEGORIES = ["basic", "beginning", "passive", "progressive", "sequence"];
export const DEFAULT_PRIORITIES = [0, 1, 2, 3, 4];

export interface MetaRef {
  id: number | string;
  name: string;
}

export interface MetaBonus {
  id: string;
  title: string;
}

export interface ParsedTaskMeta {
  events: string[];
  filters: MetaRef[];
  tags: MetaRef[];
  bonuses: MetaBonus[];
  notification_events: string[];
  dsl_tags: string[];
  categories: string[];
  types: string[];
  priorities: number[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item)).filter(Boolean);
}

function normalizeRefList(value: unknown): MetaRef[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .filter((item) => item.id != null || item.name != null)
    .map((item) => ({ id: item.id as number | string, name: String(item.name ?? "") }));
}

function normalizeBonusList(value: unknown): MetaBonus[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => isRecord(item) && item.id != null)
    .map((item) => ({
      id: String(item.id),
      title: String(item.title ?? item.name ?? item.id),
    }));
}

function normalizePriorityList(value: unknown): number[] {
  if (!Array.isArray(value) || !value.length) return [...DEFAULT_PRIORITIES];
  const nums = value.map((item) => Number(item)).filter((item) => Number.isFinite(item));
  return nums.length ? nums : [...DEFAULT_PRIORITIES];
}

export function parseTaskMeta(raw: unknown): ParsedTaskMeta {
  const source = isRecord(raw) ? raw : {};
  const constants = isRecord(source.constants) ? source.constants : {};

  const categories = normalizeStringList(
    source.categories ??
      constants.categories ??
      constants.gamification_task_categories ??
      DEFAULT_CATEGORIES,
  );

  const types = normalizeStringList(
    source.types ?? constants.gamification_task_types ?? constants.task_types ?? DEFAULT_TASK_TYPES,
  );

  return {
    events: normalizeStringList(source.events),
    filters: normalizeRefList(source.filters),
    tags: normalizeRefList(source.tags),
    bonuses: normalizeBonusList(source.bonuses),
    notification_events: normalizeStringList(source.notification_events),
    dsl_tags: normalizeStringList(source.dsl_tags),
    categories,
    types,
    priorities: normalizePriorityList(source.priorities ?? constants.priorities),
  };
}

export async function loadTaskMeta(domain: string): Promise<ParsedTaskMeta> {
  const key = String(domain || "").trim();
  if (!key) throw new Error("Домен не задан для загрузки meta");

  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const adminContext = await resolveAdminTab(key);
  const raw = await apiFetch(adminContext, "/admin/api/gamification/tasks/meta?locale=ru");
  const data = parseTaskMeta(raw);
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  return data;
}

export function clearTaskMetaCache(domain?: string): void {
  if (domain) cache.delete(String(domain).trim());
  else cache.clear();
}
