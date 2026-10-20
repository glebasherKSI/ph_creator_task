/**
 * Справочник стран и уровней стран для таргетинга задач.
 * GET /admin/api/constants?locale=ru с кэшем (TTL 10 мин); откат на фикстуру
 * public/test_primer/constant.json + обогащение из схемы условий (profile_country).
 * Чистая логика без React — UI в CountrySelector.tsx.
 */
import { browser } from "wxt/browser";

import { apiFetch, resolveAdminTab } from "@/lib/api";
import {
  getConditionDef,
  loadConditionsSchema,
  type ParsedConditionsSchema,
} from "@/lib/conditions-schema";

export const CACHE_TTL_MS = 10 * 60 * 1000;
export const CONSTANTS_API_PATH = "/admin/api/constants?locale=ru";
export const FIXTURE_PATH = "test_primer/constant.json";

export type CountriesMatchingTypeId = "countries" | "countries_lists";

export const COUNTRIES_MATCHING_TYPES: ReadonlyArray<{
  id: CountriesMatchingTypeId;
  label: string;
}> = [
  { id: "countries", label: "Страны" },
  { id: "countries_lists", label: "Уровни стран" },
];

export interface CountryOption {
  code: string;
  en: string;
  ru: string;
}

export interface CountryListOption {
  id: string;
  label: string;
}

export interface CountriesData {
  countries: CountryOption[];
  countriesLists: CountryListOption[];
  source: string;
}

export type CountrySelectorMode = "loading" | "ui" | "fallback";

export interface CountrySelectorValue {
  matchingType: string;
  countries: string[];
  countriesLists: string[];
}

/** Значение условия profile_country (`{ type, matchingType, list }`). */
export interface CountryConditionValue {
  /** Пробрасывается из текущего значения условия как есть; по умолчанию "enabled". */
  type: unknown;
  matchingType: CountriesMatchingTypeId;
  list: string[];
}

/** Значение «все страны» в `countries` (как у MultiCombobox.ALL_VALUE). */
export const ALL_COUNTRIES = "all";

const cache = new Map<string, { data: CountriesData; expiresAt: number }>();
let fixtureCache: CountriesData | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function byRuName<T extends { ru: string }>(a: T, b: T): number {
  return a.ru.localeCompare(b.ru, "ru");
}

/** Разбор ответа /admin/api/constants (или фикстуры) в справочник стран. */
export function parseCountriesData(raw: unknown, source = "unknown"): CountriesData {
  const root = isRecord(raw) ? raw : {};
  const constants = isRecord(root.constants) ? root.constants : root;
  const countriesBlock = isRecord(constants.countries) ? constants.countries : {};

  const pick = (list: unknown): unknown[] | null =>
    Array.isArray(list) && list.length ? list : null;
  const countrySource = pick(countriesBlock.all) ?? pick(countriesBlock.allowed) ?? [];

  const countries: CountryOption[] = countrySource
    .filter((item): item is Record<string, unknown> => isRecord(item) && Boolean(item.code))
    .map((item) => ({
      code: String(item.code).toUpperCase(),
      en: String(item.en ?? item.code),
      ru: String(item.ru ?? item.en ?? item.code),
    }))
    .sort(byRuName);

  let countriesLists: CountryListOption[] = [];
  const rawLists = constants.countries_lists;
  if (Array.isArray(rawLists)) {
    countriesLists = rawLists.flatMap((item): CountryListOption[] => {
      if (typeof item === "string") return [{ id: item, label: item }];
      if (isRecord(item)) {
        const id = String(item.id ?? item.value ?? "");
        return [{ id, label: String(item.name ?? item.label ?? id) }];
      }
      return [];
    });
  }

  return { countries, countriesLists, source };
}

/** Пустые списки дополняем из схемы условий (collection / extra.countriesLists profile_country). */
export function enrichFromConditions(
  data: CountriesData,
  schema: ParsedConditionsSchema | null,
): CountriesData {
  if (!schema) return data;
  const def = getConditionDef(schema, "profile_country");
  if (!def) return data;

  const next: CountriesData = {
    ...data,
    countries: [...data.countries],
    countriesLists: [...data.countriesLists],
  };

  if (!next.countries.length && Array.isArray(def.collection)) {
    next.countries = def.collection
      .filter((item) => Boolean(item?.id))
      .map((item) => ({
        code: String(item.id).toUpperCase(),
        en: String(item.name ?? item.id),
        ru: String(item.name ?? item.id),
      }))
      .sort(byRuName);
  }

  if (!next.countriesLists.length) {
    const lists = def.extra.countriesLists;
    if (Array.isArray(lists)) {
      next.countriesLists = lists
        .filter((item): item is Record<string, unknown> => isRecord(item))
        .filter((item) => item.id != null || item.value != null)
        .map((item) => {
          const id = String(item.id ?? item.value);
          return { id, label: String(item.name ?? id) };
        });
    }
  }

  return next;
}

async function loadConstantsFixture(): Promise<CountriesData> {
  if (fixtureCache) return fixtureCache;
  const response = await fetch(browser.runtime.getURL("/test_primer/constant.json"));
  if (!response.ok) {
    throw new Error(`Не удалось загрузить fixture constants (${response.status})`);
  }
  fixtureCache = parseCountriesData(await response.json(), "fixture");
  return fixtureCache;
}

/**
 * Справочник стран для домена: API с кэшем (TTL 10 мин), без домена или при
 * ошибке — фикстура; в обоих случаях обогащение из схемы условий.
 */
export async function loadCountriesData(domain: string): Promise<CountriesData> {
  const key = String(domain || "").trim();

  if (key) {
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.data;
  }

  const schema: ParsedConditionsSchema | null = await loadConditionsSchema(key).catch(() => null);

  if (!key) {
    return enrichFromConditions(await loadConstantsFixture(), schema);
  }

  try {
    const adminContext = await resolveAdminTab(key);
    const raw = await apiFetch(adminContext, CONSTANTS_API_PATH);
    const data = enrichFromConditions(parseCountriesData(raw, "api"), schema);
    cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    return data;
  } catch (err) {
    const fixture = await loadConstantsFixture();
    const message = err instanceof Error ? err.message : String(err);
    return enrichFromConditions({ ...fixture, source: `fixture (API: ${message})` }, schema);
  }
}

export function clearCountriesDataCache(domain?: string): void {
  if (domain) cache.delete(String(domain).trim());
  else cache.clear();
}

/** Подпись страны в списке и чипе: `CODE - English - Русский`. */
export function countryLabel(country: CountryOption): string {
  return `${country.code} - ${country.en} - ${country.ru}`;
}

export function isCountriesMatchingType(value: unknown): value is CountriesMatchingTypeId {
  return COUNTRIES_MATCHING_TYPES.some((item) => item.id === value);
}

/**
 * Нормализация значения селектора (как setValue → getValue старого компонента):
 * неизвестный matchingType → "countries"; коды — trim + UPPERCASE, без пустых и дублей;
 * только "ALL" → `["all"]`, "ALL" среди кодов — отбрасывается; id уровней — строки.
 */
export function normalizeCountrySelectorValue(
  input: Partial<CountrySelectorValue> | null | undefined,
): CountrySelectorValue {
  const matchingType = isCountriesMatchingType(input?.matchingType)
    ? input.matchingType
    : "countries";

  const codes = (input?.countries ?? [])
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .map((code) => code.toUpperCase());
  const allSelected = codes.length > 0 && codes.every((code) => code === "ALL");
  const countries = allSelected
    ? [ALL_COUNTRIES]
    : [...new Set(codes.filter((code) => code !== "ALL"))];

  const countriesLists = [...new Set((input?.countriesLists ?? []).map(String))];

  return { matchingType, countries, countriesLists };
}

/** Значение условия profile_country → значение селектора. */
export function conditionValueToCountrySelector(value: unknown): CountrySelectorValue {
  const v = isRecord(value) ? value : {};
  const matchingType: CountriesMatchingTypeId =
    v.matchingType === "countries_lists" ? "countries_lists" : "countries";
  const list = toStringList(v.list);
  if (matchingType === "countries_lists") {
    return { matchingType, countries: [], countriesLists: list };
  }
  return { matchingType, countries: list, countriesLists: [] };
}

/** Значение селектора → значение условия (type берётся из текущего значения, по умолчанию "enabled"). */
export function countrySelectorToConditionValue(
  selectorValue: Partial<CountrySelectorValue> | null | undefined,
  currentValue: unknown,
): CountryConditionValue {
  const v = isRecord(currentValue) ? currentValue : {};
  const matchingType: CountriesMatchingTypeId =
    selectorValue?.matchingType === "countries_lists" ? "countries_lists" : "countries";
  const list =
    matchingType === "countries_lists"
      ? toStringList(selectorValue?.countriesLists)
      : toStringList(selectorValue?.countries);
  return { type: v.type ?? "enabled", matchingType, list };
}

/** Поля задачи (countries_matching_type / countries / countries_lists) → значение селектора. */
export function taskToCountrySelectorValue(task: {
  countries_matching_type?: string | null;
  countries?: unknown;
  countries_lists?: unknown;
}): CountrySelectorValue {
  return {
    matchingType: task.countries_matching_type || "countries",
    countries: toStringList(task.countries),
    countriesLists: toStringList(task.countries_lists),
  };
}

/** Значение селектора → поля payload задачи (как в copy-panel). */
export function countrySelectorValueToTaskFields(value: CountrySelectorValue): {
  countries_matching_type: string | undefined;
  countries: string[];
  countries_lists: string[];
} {
  return {
    countries_matching_type: value.matchingType || undefined,
    countries: value.countries,
    countries_lists: value.countriesLists,
  };
}
