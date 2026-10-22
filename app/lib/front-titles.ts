/**
 * Словарь «Названия фронт» в Promo Graphic: переводы названия задачи по локалям,
 * общие для всех проектов, ключ — frontend_identifier (без регистра и пробелов по краям).
 * Бэк: GET /api/promohub-planner/front-titles[/lookup?frontend_identifier=…].
 */
import { graphicApiGet } from "./graphic-api";

export type FrontTitles = Record<string, string>;

export function frontTitleKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

/** Только заполненные переводы, коды локалей — в нижнем регистре. */
export function normalizeFrontTitles(value: unknown): FrontTitles {
  if (!value || typeof value !== "object") return {};
  const result: FrontTitles = {};
  for (const [code, text] of Object.entries(value as Record<string, unknown>)) {
    if (typeof text === "string" && text.trim()) result[code.toLowerCase()] = text.trim();
  }
  return result;
}

/** Переводы одной задачи; null — Front ID нет в словаре. */
export async function lookupFrontTitles(frontendIdentifier: string): Promise<FrontTitles | null> {
  const data = (await graphicApiGet("/api/promohub-planner/front-titles/lookup", {
    frontend_identifier: frontendIdentifier.trim(),
  })) as { titles?: unknown } | null;
  const titles = normalizeFrontTitles(data?.titles);
  return Object.keys(titles).length ? titles : null;
}

/** Весь словарь одним запросом: ключ Front ID → переводы (для групповой синхронизации). */
export async function fetchFrontTitlesDictionary(): Promise<Map<string, FrontTitles>> {
  const data = (await graphicApiGet("/api/promohub-planner/front-titles")) as {
    items?: Array<{ frontend_identifier?: unknown; titles?: unknown }>;
  } | null;
  const map = new Map<string, FrontTitles>();
  for (const item of Array.isArray(data?.items) ? data.items : []) {
    const titles = normalizeFrontTitles(item.titles);
    if (Object.keys(titles).length) map.set(frontTitleKey(item.frontend_identifier), titles);
  }
  return map;
}

export interface MergedLocales {
  locales: Record<string, string>;
  /** Локали из `codes`, оставшиеся пустыми после подстановки. */
  missing: string[];
  /** Хоть одно значение поменялось. */
  changed: boolean;
}

/**
 * Переводы словаря поверх текущих названий задачи: есть в словаре — берём оттуда,
 * нет — оставляем как было. `codes` — локали, по которым считается «не заполнено».
 */
export function mergeLocales(
  current: unknown,
  titles: FrontTitles,
  codes: ReadonlyArray<string>,
): MergedLocales {
  const base: Record<string, string> = {};
  if (current && typeof current === "object") {
    for (const [code, text] of Object.entries(current as Record<string, unknown>)) {
      if (typeof text === "string" && text.trim()) base[code] = text;
    }
  }
  const locales = { ...base, ...titles };
  const changed = Object.keys(locales).some((code) => locales[code] !== base[code]);
  const missing = codes.filter((code) => !locales[code]?.trim());
  return { locales, missing, changed };
}
