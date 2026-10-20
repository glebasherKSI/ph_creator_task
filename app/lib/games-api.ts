/** Поиск игр в admin API (/admin/api/game_specs) для полей действий «ставка в играх». */
import { apiFetch, resolveAdminTab } from "./api";

export const CACHE_TTL_MS = 10 * 60 * 1000;
export const GAMES_API_PATH = "/admin/api/game_specs";
export const SEARCH_LIMIT = 50;

export interface GameOption {
  id: string;
  label: string;
}

const searchCache = new Map<string, { data: GameOption[]; expiresAt: number }>();
const labelCache = new Map<string, { data: Map<string, GameOption>; expiresAt: number }>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function extractGameList(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw.filter(isRecord);
  if (!isRecord(raw)) return [];

  const candidates = [
    raw.game_specs,
    raw.gameSpecs,
    raw.games,
    raw.data,
    raw.items,
    raw.results,
    raw.collection,
  ];

  for (const maybe of candidates) {
    if (Array.isArray(maybe)) return maybe.filter(isRecord);
    if (isRecord(maybe)) {
      const nested = extractGameList(maybe);
      if (nested.length) return nested;
    }
  }

  for (const value of Object.values(raw)) {
    if (
      Array.isArray(value) &&
      value.length &&
      isRecord(value[0]) &&
      ("identifier" in value[0] ||
        "game_identifier" in value[0] ||
        "producer" in value[0] ||
        "id" in value[0])
    ) {
      return value.filter(isRecord);
    }
  }
  return [];
}

/** Идентификатор игры в формате `producer:identifier`. */
export function formatGameId(item: Record<string, unknown>): string {
  const explicit =
    item.id ??
    item.value ??
    item.game_id ??
    item.gameId ??
    item.game_identifier ??
    item.gameIdentifier ??
    item.frontend_identifier ??
    item.frontendIdentifier;
  if (explicit != null && String(explicit).includes(":")) {
    return String(explicit);
  }

  const producer = item.producer ?? item.provider ?? item.game_provider ?? item.gameProvider;
  const identifier =
    item.identifier ??
    item.game_identifier ??
    item.gameIdentifier ??
    item.frontend_identifier ??
    item.frontendIdentifier ??
    explicit;

  if (producer != null && identifier != null) {
    return `${String(producer)}:${String(identifier)}`;
  }
  if (identifier != null) return String(identifier);
  if (explicit != null) return String(explicit);
  return "";
}

function formatGameLabel(item: Record<string, unknown>, id: string): string {
  const title =
    item.title ??
    item.name ??
    item.label ??
    item.game_title ??
    item.gameTitle ??
    item.frontend_title ??
    item.frontendTitle;
  if (title != null && String(title).trim()) return String(title).trim();
  return id;
}

export function parseGamesOptions(raw: unknown): GameOption[] {
  const out: GameOption[] = [];
  const seen = new Set<string>();
  for (const item of extractGameList(raw)) {
    const id = formatGameId(item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label: formatGameLabel(item, id) });
  }
  return out;
}

/** Admin collection API сериализует поиск как filters[field]=value (qs brackets). */
function buildGamesQueryParams(params: Record<string, unknown> = {}): URLSearchParams {
  const query = new URLSearchParams({ locale: "ru", limit: String(SEARCH_LIMIT), offset: "0" });
  for (const [key, value] of Object.entries(params)) {
    if (key === "filters" && isRecord(value)) {
      for (const [filterKey, filterValue] of Object.entries(value)) {
        if (filterValue == null || !String(filterValue).trim()) continue;
        query.append(`filters[${filterKey}]`, String(filterValue));
      }
      continue;
    }
    if (value == null || !String(value).trim()) continue;
    query.set(key, String(value));
  }
  return query;
}

async function fetchGamesApi(domain: string, params: Record<string, unknown>): Promise<unknown> {
  const adminContext = await resolveAdminTab(domain);
  const query = buildGamesQueryParams(params);
  return apiFetch(adminContext, `${GAMES_API_PATH}?${query.toString()}`);
}

function gameMatchesQuery(item: GameOption, q: string): boolean {
  const needle = q.toLowerCase();
  return item.label.toLowerCase().includes(needle) || item.id.toLowerCase().includes(needle);
}

function filterGamesByQuery(data: GameOption[], q: string): GameOption[] {
  if (!q) return data;
  return data.filter((item) => gameMatchesQuery(item, q));
}

export async function searchGames(domain: string, query = ""): Promise<GameOption[]> {
  const key = String(domain || "").trim();
  const q = String(query || "").trim();
  const cacheKey = `${key}::${q.toLowerCase()}`;
  if (!key) return [];

  const cached = searchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  // Admin panel: GET /admin/api/game_specs?filters[title]=…&limit=&offset=&locale=
  const paramSets: Record<string, unknown>[] = q
    ? [
        { filters: { title: q } },
        { filters: { identifier: q } },
        { filters: { frontend_identifier: q } },
        { filters: { producer: q } },
      ]
    : [{}];

  let lastError: unknown = null;

  for (const params of paramSets) {
    try {
      const raw = await fetchGamesApi(key, params);
      const data = parseGamesOptions(raw);
      if (!q) {
        searchCache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS });
        return data;
      }
      if (params.filters) {
        if (data.length) {
          searchCache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS });
          return data;
        }
        continue;
      }
      if (data.some((item) => gameMatchesQuery(item, q))) {
        const filtered = filterGamesByQuery(data, q);
        searchCache.set(cacheKey, { data: filtered, expiresAt: Date.now() + CACHE_TTL_MS });
        return filtered;
      }
    } catch (err) {
      lastError = err;
    }
  }

  if (lastError) throw lastError;
  searchCache.set(cacheKey, { data: [], expiresAt: Date.now() + CACHE_TTL_MS });
  return [];
}

export async function resolveGamesByIds(domain: string, ids: string[]): Promise<GameOption[]> {
  const key = String(domain || "").trim();
  const list = [...new Set((ids || []).map(String).filter(Boolean))];
  if (!key || !list.length) return [];

  let cache = labelCache.get(key);
  if (!cache || cache.expiresAt <= Date.now()) {
    cache = { data: new Map(), expiresAt: Date.now() + CACHE_TTL_MS };
    labelCache.set(key, cache);
  }
  const known = cache.data;

  const missing = list.filter((id) => !known.has(id));
  if (!missing.length) {
    return list.map((id) => known.get(id) || { id, label: id });
  }

  const batches: string[][] = [];
  for (let i = 0; i < missing.length; i += 20) {
    batches.push(missing.slice(i, i + 20));
  }

  for (const batch of batches) {
    let resolved = false;

    for (const paramName of ["identifiers[]", "ids[]", "game_ids[]"]) {
      try {
        const adminContext = await resolveAdminTab(key);
        const query = new URLSearchParams({
          locale: "ru",
          limit: String(Math.max(SEARCH_LIMIT, batch.length)),
        });
        for (const id of batch) query.append(paramName, id);
        const raw = await apiFetch(adminContext, `${GAMES_API_PATH}?${query.toString()}`);
        for (const opt of parseGamesOptions(raw)) known.set(opt.id, opt);
        if (batch.some((id) => known.has(id))) {
          resolved = true;
          break;
        }
      } catch {
        /* try next param shape */
      }
    }

    if (resolved) continue;

    for (const id of batch) {
      if (known.has(id)) continue;
      const searchPart = id.includes(":") ? id.split(":").slice(1).join(":") : id;
      try {
        const found = await searchGames(key, searchPart);
        const exact = found.find((item) => item.id === id);
        if (exact) {
          known.set(id, exact);
          continue;
        }
        const bySuffix = found.find(
          (item) => item.id.endsWith(`:${searchPart}`) || item.id === searchPart,
        );
        if (bySuffix) known.set(id, bySuffix);
      } catch {
        /* keep id as label */
      }
    }
  }

  return list.map((id) => known.get(id) || { id, label: id });
}

export function clearGamesCache(domain?: string): void {
  if (domain) {
    const key = String(domain).trim();
    for (const cacheKey of [...searchCache.keys()]) {
      if (cacheKey.startsWith(`${key}::`)) searchCache.delete(cacheKey);
    }
    labelCache.delete(key);
    return;
  }
  searchCache.clear();
  labelCache.clear();
}
