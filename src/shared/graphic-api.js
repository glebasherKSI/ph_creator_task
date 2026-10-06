import { STORAGE_KEYS } from "./constants.js";
import { withTimeout } from "./auth.js";

export const GRAPHIC_DEFAULT_BASE_URL = "http://127.0.0.1:8000";
const FETCH_TIMEOUT_MS = 30_000;

export function normalizeGraphicBaseUrl(raw) {
  const text = String(raw || "").trim();
  if (!text) return GRAPHIC_DEFAULT_BASE_URL;
  try {
    const url = new URL(text.includes("://") ? text : `http://${text}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return GRAPHIC_DEFAULT_BASE_URL;
    return url.origin;
  } catch {
    return GRAPHIC_DEFAULT_BASE_URL;
  }
}

export function graphicOriginPattern(baseUrl) {
  return `${normalizeGraphicBaseUrl(baseUrl)}/*`;
}

export async function loadGraphicBaseUrl() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.GRAPHIC_BASE_URL);
  return normalizeGraphicBaseUrl(stored[STORAGE_KEYS.GRAPHIC_BASE_URL]);
}

export async function saveGraphicBaseUrl(raw) {
  const url = normalizeGraphicBaseUrl(raw);
  await chrome.storage.local.set({ [STORAGE_KEYS.GRAPHIC_BASE_URL]: url });
  return url;
}

export async function loadGraphicAuth() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.GRAPHIC_AUTH);
  const raw = stored[STORAGE_KEYS.GRAPHIC_AUTH];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (!raw.access_token) return null;
  return raw;
}

async function saveGraphicAuth(record) {
  await chrome.storage.local.set({ [STORAGE_KEYS.GRAPHIC_AUTH]: record });
}

export async function clearGraphicAuth() {
  await chrome.storage.local.remove(STORAGE_KEYS.GRAPHIC_AUTH);
}

export async function ensureGraphicHostPermission(baseUrl) {
  const origin = graphicOriginPattern(baseUrl);
  try {
    if (await chrome.permissions.contains({ origins: [origin] })) return true;
    return await chrome.permissions.request({ origins: [origin] });
  } catch {
    return false;
  }
}

function parseJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function formatGraphicError(status, data) {
  let detail = "";
  if (data && typeof data === "object") {
    const raw = data.detail ?? data.message ?? data.error;
    if (typeof raw === "string") detail = raw;
    else if (Array.isArray(raw)) {
      detail = raw
        .map((item) => (typeof item === "string" ? item : item?.msg || JSON.stringify(item)))
        .filter(Boolean)
        .join("; ");
    } else if (raw != null) detail = JSON.stringify(raw);
  } else if (data != null && String(data).trim()) {
    detail = String(data);
  }
  if (status && detail) return `HTTP ${status}: ${detail}`;
  if (status) return `HTTP ${status}`;
  return detail || "Ошибка Graphic API";
}

async function rawFetch(baseUrl, path, { method = "GET", body = null, token = null } = {}) {
  const url = `${normalizeGraphicBaseUrl(baseUrl)}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body != null) headers["Content-Type"] = "application/json";
  const response = await fetch(url, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const data = text ? parseJsonSafe(text) : null;
  return { ok: response.ok, status: response.status, data };
}

async function refreshGraphicAccess(baseUrl, refreshToken) {
  const result = await rawFetch(baseUrl, "/api/auth/refresh", {
    method: "POST",
    body: { refresh_token: refreshToken },
  });
  if (!result.ok || !result.data?.access_token) {
    throw new Error(formatGraphicError(result.status, result.data));
  }
  return result.data.access_token;
}

export async function loginGraphic(login, password, baseUrlInput = "") {
  if (baseUrlInput) await saveGraphicBaseUrl(baseUrlInput);
  const baseUrl = await loadGraphicBaseUrl();
  const username = String(login || "").trim();
  const result = await rawFetch(baseUrl, "/api/auth/login", {
    method: "POST",
    body: { username, password: String(password || "") },
  });
  if (!result.ok) throw new Error(formatGraphicError(result.status, result.data));
  const data = result.data && typeof result.data === "object" ? result.data : {};
  if (!data.access_token) throw new Error("Сервер не вернул access_token");
  const record = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || "",
    user: data.user && typeof data.user === "object" ? data.user : { username },
    updatedAt: Date.now(),
  };
  await saveGraphicAuth(record);
  return { ok: true, authenticated: true, user: record.user, baseUrl };
}

export async function logoutGraphic() {
  await clearGraphicAuth();
  return { ok: true, authenticated: false, user: null, baseUrl: await loadGraphicBaseUrl() };
}

export async function getGraphicStatus() {
  const [auth, baseUrl] = await Promise.all([loadGraphicAuth(), loadGraphicBaseUrl()]);
  return {
    ok: true,
    authenticated: Boolean(auth?.access_token),
    user: auth?.user || null,
    baseUrl,
  };
}

export async function graphicApiRequest(path, method = "GET", body = null) {
  const baseUrl = await loadGraphicBaseUrl();
  let auth = await loadGraphicAuth();
  if (!auth?.access_token) throw new Error("Нет входа в Promo Graphic");

  let result = await rawFetch(baseUrl, path, { method, body, token: auth.access_token });
  if (result.status === 401 && auth.refresh_token) {
    try {
      const access = await refreshGraphicAccess(baseUrl, auth.refresh_token);
      auth = { ...auth, access_token: access, updatedAt: Date.now() };
      await saveGraphicAuth(auth);
      result = await rawFetch(baseUrl, path, { method, body, token: access });
    } catch {
      await clearGraphicAuth();
      throw new Error("Сессия Promo Graphic истекла — войдите снова");
    }
  }
  if (!result.ok) {
    if (result.status === 401) await clearGraphicAuth();
    throw new Error(formatGraphicError(result.status, result.data));
  }
  return result.data;
}

export function withGraphicQuery(path, query) {
  if (!query || typeof query !== "object") return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value == null || value === "") continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

export async function handleGraphicAuthMessage(payload) {
  const op = payload?.op;
  if (op === "login") return loginGraphic(payload.login, payload.password, payload.baseUrl);
  if (op === "logout") return logoutGraphic();
  if (op === "status") return getGraphicStatus();
  if (op === "setBaseUrl") {
    const baseUrl = await saveGraphicBaseUrl(payload.baseUrl);
    return { ok: true, baseUrl };
  }
  return { ok: false, error: "Неизвестный запрос Graphic auth" };
}

export async function handleGraphicFetchMessage(payload) {
  const path = payload?.path;
  if (!path) return { ok: false, error: "Не указан path Graphic API" };
  const data = await graphicApiRequest(path, payload?.method || "GET", payload?.body ?? null);
  return { ok: true, data };
}

async function sendGraphicMessage(action, payload) {
  const response = await withTimeout(
    chrome.runtime.sendMessage({ action, payload }),
    FETCH_TIMEOUT_MS,
    "Превышено время ожидания Graphic"
  );
  if (!response?.ok) throw new Error(response?.error || "Ошибка Graphic");
  return response;
}

export async function graphicLoginFromPage(login, password, baseUrl) {
  const url = normalizeGraphicBaseUrl(baseUrl);
  const allowed = await ensureGraphicHostPermission(url);
  if (!allowed) {
    throw new Error("Нет разрешения на хост Graphic API — подтвердите доступ в диалоге Chrome");
  }
  return sendGraphicMessage("PH_GRAPHIC_AUTH", { op: "login", login, password, baseUrl: url });
}

export async function graphicLogoutFromPage() {
  return sendGraphicMessage("PH_GRAPHIC_AUTH", { op: "logout" });
}

export async function graphicStatusFromPage() {
  try {
    return await sendGraphicMessage("PH_GRAPHIC_AUTH", { op: "status" });
  } catch {
    const baseUrl = await loadGraphicBaseUrl();
    return { ok: true, authenticated: false, user: null, baseUrl };
  }
}

export async function graphicApiGet(path, query) {
  const response = await sendGraphicMessage("PH_GRAPHIC_FETCH", {
    path: withGraphicQuery(path, query),
    method: "GET",
  });
  return response.data;
}

export async function graphicApiPost(path, body) {
  const response = await sendGraphicMessage("PH_GRAPHIC_FETCH", {
    path,
    method: "POST",
    body: body ?? null,
  });
  return response.data;
}
