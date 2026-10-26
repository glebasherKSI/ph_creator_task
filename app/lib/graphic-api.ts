/**
 * Promo Graphic (планировщик): авторизация по токену и запросы к его API.
 * Вызовы с сетью (login/refresh/request) живут в background; страницы ходят через сообщения.
 */
import { browser } from "wxt/browser";

import { withTimeout } from "./auth/errors";
import { STORAGE_KEYS } from "./constants";

export const GRAPHIC_DEFAULT_BASE_URL = "http://127.0.0.1:8000";
const FETCH_TIMEOUT_MS = 30_000;

export interface GraphicUser {
  username?: string;
  name?: string;
  email?: string;
  [key: string]: unknown;
}

export interface GraphicAuthRecord {
  access_token: string;
  refresh_token: string;
  user: GraphicUser;
  updatedAt: number;
}

export interface GraphicStatus {
  ok: true;
  authenticated: boolean;
  user: GraphicUser | null;
  baseUrl: string;
}

interface RawResult {
  ok: boolean;
  status: number;
  data: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function normalizeGraphicBaseUrl(raw: unknown): string {
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

export function graphicOriginPattern(baseUrl: unknown): string {
  return `${normalizeGraphicBaseUrl(baseUrl)}/*`;
}

export async function loadGraphicBaseUrl(): Promise<string> {
  const stored = await browser.storage.local.get(STORAGE_KEYS.GRAPHIC_BASE_URL);
  return normalizeGraphicBaseUrl(stored[STORAGE_KEYS.GRAPHIC_BASE_URL]);
}

export async function saveGraphicBaseUrl(raw: unknown): Promise<string> {
  const url = normalizeGraphicBaseUrl(raw);
  await browser.storage.local.set({ [STORAGE_KEYS.GRAPHIC_BASE_URL]: url });
  return url;
}

export async function loadGraphicAuth(): Promise<GraphicAuthRecord | null> {
  const stored = await browser.storage.local.get(STORAGE_KEYS.GRAPHIC_AUTH);
  const raw = stored[STORAGE_KEYS.GRAPHIC_AUTH];
  if (!isRecord(raw) || !raw.access_token) return null;
  return raw as unknown as GraphicAuthRecord;
}

async function saveGraphicAuth(record: GraphicAuthRecord): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEYS.GRAPHIC_AUTH]: record });
}

export async function clearGraphicAuth(): Promise<void> {
  await browser.storage.local.remove(STORAGE_KEYS.GRAPHIC_AUTH);
}

export async function ensureGraphicHostPermission(baseUrl: unknown): Promise<boolean> {
  const origin = graphicOriginPattern(baseUrl);
  try {
    if (await browser.permissions.contains({ origins: [origin] })) return true;
    return await browser.permissions.request({ origins: [origin] });
  } catch {
    return false;
  }
}

function parseJsonSafe(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function formatGraphicError(status: number | undefined, data: unknown): string {
  let detail = "";
  if (isRecord(data)) {
    const raw = data.detail ?? data.message ?? data.error;
    if (typeof raw === "string") detail = raw;
    else if (Array.isArray(raw)) {
      detail = raw
        .map((item) =>
          typeof item === "string" ? item : (isRecord(item) && item.msg) || JSON.stringify(item),
        )
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

async function rawFetch(
  baseUrl: string,
  path: string,
  {
    method = "GET",
    body = null,
    token = null,
  }: { method?: string; body?: unknown; token?: string | null } = {},
): Promise<RawResult> {
  const url = `${normalizeGraphicBaseUrl(baseUrl)}${path.startsWith("/") ? path : `/${path}`}`;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body != null) headers["Content-Type"] = "application/json";
  const response = await fetch(url, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { ok: response.ok, status: response.status, data: text ? parseJsonSafe(text) : null };
}

async function refreshGraphicAccess(baseUrl: string, refreshToken: string): Promise<string> {
  const result = await rawFetch(baseUrl, "/api/auth/refresh", {
    method: "POST",
    body: { refresh_token: refreshToken },
  });
  const access = isRecord(result.data) ? result.data.access_token : undefined;
  if (!result.ok || !access) {
    throw new Error(formatGraphicError(result.status, result.data));
  }
  return String(access);
}

export async function loginGraphic(
  login: string,
  password: string,
  baseUrlInput = "",
): Promise<GraphicStatus> {
  if (baseUrlInput) await saveGraphicBaseUrl(baseUrlInput);
  const baseUrl = await loadGraphicBaseUrl();
  const username = String(login || "").trim();
  const result = await rawFetch(baseUrl, "/api/auth/login", {
    method: "POST",
    body: { username, password: String(password || "") },
  });
  if (!result.ok) throw new Error(formatGraphicError(result.status, result.data));
  const data = isRecord(result.data) ? result.data : {};
  if (!data.access_token) throw new Error("Сервер не вернул access_token");
  const record: GraphicAuthRecord = {
    access_token: String(data.access_token),
    refresh_token: data.refresh_token ? String(data.refresh_token) : "",
    user: isRecord(data.user) ? (data.user as GraphicUser) : { username },
    updatedAt: Date.now(),
  };
  await saveGraphicAuth(record);
  return { ok: true, authenticated: true, user: record.user, baseUrl };
}

export async function logoutGraphic(): Promise<GraphicStatus> {
  await clearGraphicAuth();
  return { ok: true, authenticated: false, user: null, baseUrl: await loadGraphicBaseUrl() };
}

export async function getGraphicStatus(): Promise<GraphicStatus> {
  const [auth, baseUrl] = await Promise.all([loadGraphicAuth(), loadGraphicBaseUrl()]);
  return {
    ok: true,
    authenticated: Boolean(auth?.access_token),
    user: auth?.user || null,
    baseUrl,
  };
}

/** Запрос к Graphic API с токеном и одним refresh при 401. Только background. */
export async function graphicApiRequest(
  path: string,
  method = "GET",
  body: unknown = null,
): Promise<unknown> {
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
    } catch (err) {
      await clearGraphicAuth();
      throw new Error("Сессия Promo Graphic истекла — войдите снова", { cause: err });
    }
  }
  if (!result.ok) {
    if (result.status === 401) await clearGraphicAuth();
    throw new Error(formatGraphicError(result.status, result.data));
  }
  return result.data;
}

export function withGraphicQuery(path: string, query?: Record<string, unknown> | null): string {
  if (!isRecord(query)) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value == null || value === "") continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

export interface GraphicAuthPayload {
  op: "login" | "logout" | "status" | "setBaseUrl";
  login?: string;
  password?: string;
  baseUrl?: string;
}

export interface GraphicFetchPayload {
  path: string;
  method?: string;
  body?: unknown;
}

export async function handleGraphicAuthMessage(
  payload: GraphicAuthPayload | undefined,
): Promise<GraphicStatus | { ok: boolean; baseUrl?: string; error?: string }> {
  const op = payload?.op;
  if (op === "login") {
    return loginGraphic(payload?.login ?? "", payload?.password ?? "", payload?.baseUrl ?? "");
  }
  if (op === "logout") return logoutGraphic();
  if (op === "status") return getGraphicStatus();
  if (op === "setBaseUrl") {
    const baseUrl = await saveGraphicBaseUrl(payload?.baseUrl);
    return { ok: true, baseUrl };
  }
  return { ok: false, error: "Неизвестный запрос Graphic auth" };
}

export async function handleGraphicFetchMessage(
  payload: GraphicFetchPayload | undefined,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const path = payload?.path;
  if (!path) return { ok: false, error: "Не указан path Graphic API" };
  const data = await graphicApiRequest(path, payload?.method || "GET", payload?.body ?? null);
  return { ok: true, data };
}

// ---------------------------------------------------------------------------
// Со страниц расширения: RPC в background
// ---------------------------------------------------------------------------

interface GraphicMessageResponse {
  ok?: boolean;
  error?: string;
  data?: unknown;
  [key: string]: unknown;
}

async function sendGraphicMessage<T = GraphicMessageResponse>(
  action: string,
  payload: unknown,
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<T> {
  const response = (await withTimeout(
    browser.runtime.sendMessage({ action, payload }),
    timeoutMs,
    "Превышено время ожидания Graphic",
  )) as GraphicMessageResponse | undefined;
  if (!response?.ok) throw new Error(response?.error || "Ошибка Graphic");
  return response as unknown as T;
}

export async function graphicLoginFromPage(
  login: string,
  password: string,
  baseUrl?: string,
): Promise<GraphicStatus> {
  const url = normalizeGraphicBaseUrl(baseUrl);
  const allowed = await ensureGraphicHostPermission(url);
  if (!allowed) {
    throw new Error("Нет разрешения на хост Graphic API — подтвердите доступ в диалоге Chrome");
  }
  return sendGraphicMessage<GraphicStatus>("PH_GRAPHIC_AUTH", {
    op: "login",
    login,
    password,
    baseUrl: url,
  });
}

export async function graphicLogoutFromPage(): Promise<GraphicStatus> {
  return sendGraphicMessage<GraphicStatus>("PH_GRAPHIC_AUTH", { op: "logout" });
}

export async function graphicStatusFromPage(): Promise<GraphicStatus> {
  try {
    return await sendGraphicMessage<GraphicStatus>("PH_GRAPHIC_AUTH", { op: "status" });
  } catch {
    const baseUrl = await loadGraphicBaseUrl();
    return { ok: true, authenticated: false, user: null, baseUrl };
  }
}

export async function graphicApiGet(
  path: string,
  query?: Record<string, unknown> | null,
): Promise<unknown> {
  const response = await sendGraphicMessage("PH_GRAPHIC_FETCH", {
    path: withGraphicQuery(path, query),
    method: "GET",
  });
  return response.data;
}

/** timeoutMs — для долгих запросов (импорт в пакет); по умолчанию 30 с. */
export async function graphicApiPost(
  path: string,
  body?: unknown,
  timeoutMs?: number,
): Promise<unknown> {
  const response = await sendGraphicMessage(
    "PH_GRAPHIC_FETCH",
    { path, method: "POST", body: body ?? null },
    timeoutMs,
  );
  return response.data;
}

export async function graphicApiPut(path: string, body?: unknown): Promise<unknown> {
  const response = await sendGraphicMessage("PH_GRAPHIC_FETCH", {
    path,
    method: "PUT",
    body: body ?? null,
  });
  return response.data;
}
