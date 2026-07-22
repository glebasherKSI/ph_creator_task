import { apiFetch, resolveAdminTab } from "./api.js";

const CACHE_TTL_MS = 10 * 60 * 1000;
const GAMES_API_PATH = "/admin/api/game_specs";
const SEARCH_LIMIT = 50;

/** @type {Map<string, { data: Array<{ id: string, label: string }>, expiresAt: number }>} */
const searchCache = new Map();

/** @type {Map<string, { data: Map<string, { id: string, label: string }>, expiresAt: number }>} */
const labelCache = new Map();

/**
 * @param {unknown} raw
 * @returns {Array<Record<string, unknown>>}
 */
function extractGameList(raw) {
  if (Array.isArray(raw)) return raw.filter((item) => item && typeof item === "object");
  if (!raw || typeof raw !== "object") return [];

  const root = /** @type {Record<string, unknown>} */ (raw);
  const candidates = [
    root.game_specs,
    root.gameSpecs,
    root.games,
    root.data,
    root.items,
    root.results,
    root.collection,
  ];

  for (const maybe of candidates) {
    if (Array.isArray(maybe)) {
      return maybe.filter((item) => item && typeof item === "object");
    }
    if (maybe && typeof maybe === "object" && !Array.isArray(maybe)) {
      const nested = extractGameList(maybe);
      if (nested.length) return nested;
    }
  }

  for (const value of Object.values(root)) {
    if (
      Array.isArray(value) &&
      value.length &&
      value[0] &&
      typeof value[0] === "object" &&
      ("identifier" in value[0] ||
        "game_identifier" in value[0] ||
        "producer" in value[0] ||
        "id" in value[0])
    ) {
      return value;
    }
  }

  return [];
}

/**
 * @param {Record<string, unknown>} item
 * @returns {string}
 */
export function formatGameId(item) {
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

/**
 * @param {Record<string, unknown>} item
 * @param {string} id
 * @returns {string}
 */
function formatGameLabel(item, id) {
  const title =
    item.title ??
    item.name ??
    item.label ??
    item.game_title ??
    item.gameTitle ??
    item.frontend_title ??
    item.frontendTitle;
  if (title != null && String(title).trim()) {
    return String(title).trim();
  }
  return id;
}

/**
 * @param {unknown} raw
 * @returns {Array<{ id: string, label: string }>}
 */
export function parseGamesOptions(raw) {
  const list = extractGameList(raw);
  const out = [];
  const seen = new Set();

  for (const item of list) {
    const id = formatGameId(/** @type {Record<string, unknown>} */ (item));
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      label: formatGameLabel(/** @type {Record<string, unknown>} */ (item), id),
    });
  }

  return out;
}

/**
 * @param {string} domain
 * @param {Record<string, string>} params
 * @returns {Promise<unknown>}
 */
async function fetchGamesApi(domain, params) {
  const adminContext = await resolveAdminTab(domain);
  const query = new URLSearchParams({ locale: "ru", limit: String(SEARCH_LIMIT), ...params });
  return apiFetch(adminContext, `${GAMES_API_PATH}?${query.toString()}`);
}

/**
 * @param {string} domain
 * @param {string} query
 * @returns {Promise<Array<{ id: string, label: string }>>}
 */
export async function searchGames(domain, query = "") {
  const key = String(domain || "").trim();
  const q = String(query || "").trim();
  const cacheKey = `${key}::${q.toLowerCase()}`;

  if (!key) return [];

  const cached = searchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const paramSets = q
    ? [{ search: q }, { query: q }, { q }, { term: q }, { identifier: q }]
    : [{}, { search: "" }];

  let lastError = null;
  for (const params of paramSets) {
    try {
      const raw = await fetchGamesApi(key, params);
      const data = parseGamesOptions(raw);
      if (data.length || !q) {
        searchCache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS });
        return data;
      }
    } catch (err) {
      lastError = err;
    }
  }

  if (lastError) throw lastError;
  return [];
}

/**
 * @param {string} domain
 * @param {string[]} ids
 * @returns {Promise<Array<{ id: string, label: string }>>}
 */
export async function resolveGamesByIds(domain, ids) {
  const key = String(domain || "").trim();
  const list = [...new Set((ids || []).map(String).filter(Boolean))];
  if (!key || !list.length) return [];

  let cache = labelCache.get(key);
  if (!cache || cache.expiresAt <= Date.now()) {
    cache = { data: new Map(), expiresAt: Date.now() + CACHE_TTL_MS };
    labelCache.set(key, cache);
  }

  const missing = list.filter((id) => !cache.data.has(id));
  if (!missing.length) {
    return list.map((id) => cache.data.get(id) || { id, label: id });
  }

  const batches = [];
  for (let i = 0; i < missing.length; i += 20) {
    batches.push(missing.slice(i, i + 20));
  }

  for (const batch of batches) {
    let resolved = false;

    for (const paramName of ["identifiers[]", "ids[]", "game_ids[]"]) {
      try {
        const adminContext = await resolveAdminTab(key);
        const query = new URLSearchParams({ locale: "ru", limit: String(Math.max(SEARCH_LIMIT, batch.length)) });
        for (const id of batch) query.append(paramName, id);
        const raw = await apiFetch(adminContext, `${GAMES_API_PATH}?${query.toString()}`);
        for (const opt of parseGamesOptions(raw)) {
          cache.data.set(opt.id, opt);
        }
        if (batch.some((id) => cache.data.has(id))) {
          resolved = true;
          break;
        }
      } catch {
        /* try next param shape */
      }
    }

    if (resolved) continue;

    for (const id of batch) {
      if (cache.data.has(id)) continue;
      const searchPart = id.includes(":") ? id.split(":").slice(1).join(":") : id;
      try {
        const found = await searchGames(key, searchPart);
        const exact = found.find((item) => item.id === id);
        if (exact) {
          cache.data.set(id, exact);
          continue;
        }
        const bySuffix = found.find((item) => item.id.endsWith(`:${searchPart}`) || item.id === searchPart);
        if (bySuffix) {
          cache.data.set(id, bySuffix);
        }
      } catch {
        /* keep id as label */
      }
    }
  }

  return list.map((id) => cache.data.get(id) || { id, label: id });
}

/** @param {string} [domain] */
export function clearGamesCache(domain) {
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

export { GAMES_API_PATH, SEARCH_LIMIT, CACHE_TTL_MS };
