/**
 * Вызовы admin API со страниц расширения.
 * Запросы идут через background (PH_ADMIN_API_FETCH) или через content-script вкладки (PH_API_FETCH).
 */
import { browser } from "wxt/browser";

import { formatAuthFetchError, withTimeout } from "./auth/errors";
import { normalizeDomainOrEmpty } from "./domains";

export { withTimeout };
export const API_REQUEST_TIMEOUT_MS = 30_000;

/** Кэш успешной сессии — повторные apiFetch не ждут PH_AUTH_STATUS. */
const AUTH_CONTEXT_TTL_MS = 60_000;
/** Короткий gate: не ждём полный AUTH_MESSAGE_TIMEOUT_MS (20с) перед API. */
const AUTH_STATUS_GATE_MS = 2_000;

const authenticatedAtByDomain = new Map<string, number>();
const inflightAuthStatusByDomain = new Map<string, Promise<AuthGateResult>>();

export type ApiContext = { mode: "background"; domain: string } | { mode: "tab"; tabId: number };

export interface ApiResponse {
  ok: boolean;
  status?: number;
  url?: string;
  data?: unknown;
  headers?: Record<string, string>;
  error?: string;
  errorCode?: string;
  domain?: string;
}

export interface ApiFetchResult {
  data: unknown;
  status?: number;
  url?: string;
  headers: Record<string, string>;
}

interface AuthGateResult {
  authenticated: boolean;
  timedOut?: boolean;
  explicitDeny?: boolean;
}

interface AuthStatusResponse {
  ok?: boolean;
  authenticated?: boolean;
  pendingOtp?: boolean;
  awaitingMagicLink?: boolean;
  cached?: boolean;
}

export function formatApiError(response: ApiResponse | null | undefined): string {
  const status = response?.status;
  const data = response?.data;
  let detail = "";
  if (data != null && typeof data === "object") {
    detail = JSON.stringify(data, null, 2);
  } else if (data != null && String(data).trim()) {
    detail = String(data);
  }

  if (status === 422) {
    return detail
      ? `HTTP 422 — ошибки валидации:\n${detail}`
      : "HTTP 422 — ошибки валидации (тело ответа пустое)";
  }
  if (response?.error) return response.error;
  if (response?.errorCode) return formatAuthFetchError(response.errorCode, response?.domain);
  if (detail) return `HTTP ${status || "unknown"}:\n${detail}`;
  return `HTTP ${status || "unknown"}`;
}

export async function findTabForDomain(domain: string): Promise<number | null> {
  const tabs = await browser.tabs.query({ url: `https://${domain}/*` });
  const tab = tabs.find((item) => item.id != null);
  return tab?.id ?? null;
}

/** Сбрасывает кэш «вход подтверждён» для домена (или для всех). */
export function clearResolvedAdminContext(domainInput?: string): void {
  const domain = normalizeDomainOrEmpty(domainInput);
  if (domain) authenticatedAtByDomain.delete(domain);
  else authenticatedAtByDomain.clear();
}

async function queryAuthStatus(
  domain: string,
  timeoutMs = AUTH_STATUS_GATE_MS,
): Promise<AuthGateResult> {
  try {
    // force: false — не обходим failure-cache current_user и не дублируем тяжёлый probe.
    const response = (await withTimeout(
      browser.runtime.sendMessage({ action: "PH_AUTH_STATUS", payload: { domain, force: false } }),
      timeoutMs,
      "AUTH_STATUS_TIMEOUT",
    )) as AuthStatusResponse | undefined;
    if (response?.ok && response.authenticated) {
      return { authenticated: true };
    }
    // Явный отказ только без pending OTP и без «cached failure» current_user —
    // иначе блокируем живую сессию ложным deny.
    if (
      response?.ok &&
      response.authenticated === false &&
      !response.pendingOtp &&
      !response.cached &&
      !response.awaitingMagicLink
    ) {
      return { authenticated: false, explicitDeny: true };
    }
    return { authenticated: false };
  } catch (err) {
    if ((err as Error)?.message === "AUTH_STATUS_TIMEOUT") {
      return { authenticated: false, timedOut: true };
    }
    return { authenticated: false };
  }
}

/**
 * Контекст API (background → adminApiFetch).
 * Не блокирует загрузку условий/meta на долгом PH_AUTH_STATUS:
 * короткий gate, soft-fail, кэш успеха; реальный 401/403 — из PH_ADMIN_API_FETCH.
 */
export async function resolveAdminTab(domainInput: string): Promise<ApiContext> {
  const domain = normalizeDomainOrEmpty(domainInput);
  if (!domain) throw new Error("Выберите домен админки");

  const cachedAt = authenticatedAtByDomain.get(domain);
  if (cachedAt != null && Date.now() - cachedAt < AUTH_CONTEXT_TTL_MS) {
    return { domain, mode: "background" };
  }

  let statusPromise = inflightAuthStatusByDomain.get(domain);
  if (!statusPromise) {
    statusPromise = queryAuthStatus(domain, AUTH_STATUS_GATE_MS).finally(() => {
      inflightAuthStatusByDomain.delete(domain);
    });
    inflightAuthStatusByDomain.set(domain, statusPromise);
  }

  const authStatus = await statusPromise;

  if (authStatus.authenticated) {
    authenticatedAtByDomain.set(domain, Date.now());
    return { domain, mode: "background" };
  }

  // Таймаут / мягкий сбой / cached failure: не мешаем API.
  if (authStatus.timedOut || !authStatus.explicitDeny) {
    return { domain, mode: "background" };
  }

  authenticatedAtByDomain.delete(domain);
  throw new Error(
    `Требуется вход в админку https://${domain} — нажмите «Загрузить задачи» для авторизации`,
  );
}

function isHttpAuthFailure(response: ApiResponse | undefined): boolean {
  const status = Number(response?.status);
  return status === 401 || status === 403;
}

async function sendApiRequestViaBackground(
  domain: string,
  path: string,
  method: string,
  body: unknown,
): Promise<ApiResponse> {
  const response = (await withTimeout(
    browser.runtime.sendMessage({
      action: "PH_ADMIN_API_FETCH",
      payload: { domain, path, method, body },
    }),
    API_REQUEST_TIMEOUT_MS,
    "Превышено время ожидания API — проверьте вход в админку",
  )) as ApiResponse | undefined;
  if (!response?.ok) {
    if (isHttpAuthFailure(response)) clearResolvedAdminContext(domain);
    throw new Error(formatApiError(response));
  }
  authenticatedAtByDomain.set(domain, Date.now());
  return response;
}

async function sendApiRequestViaTab(
  tabId: number,
  path: string,
  method: string,
  body: unknown,
): Promise<ApiResponse> {
  const response = (await withTimeout(
    browser.tabs.sendMessage(tabId, { action: "PH_API_FETCH", payload: { path, method, body } }),
    API_REQUEST_TIMEOUT_MS,
    "Превышено время ожидания API — проверьте вход в админку",
  )) as ApiResponse | undefined;
  if (!response?.ok) {
    throw new Error(formatApiError(response));
  }
  return response;
}

function toContext(contextOrTabId: ApiContext | number): ApiContext {
  return typeof contextOrTabId === "object" && contextOrTabId != null
    ? contextOrTabId
    : { tabId: contextOrTabId, mode: "tab" };
}

async function sendApiRequest(
  context: ApiContext,
  path: string,
  method: string,
  body: unknown,
): Promise<ApiResponse> {
  if (context.mode === "background") {
    return sendApiRequestViaBackground(context.domain, path, method, body);
  }
  return sendApiRequestViaTab(context.tabId, path, method, body);
}

export async function apiFetch(
  contextOrTabId: ApiContext | number,
  path: string,
  method = "GET",
  body: unknown = null,
): Promise<unknown> {
  const response = await sendApiRequest(toContext(contextOrTabId), path, method, body);
  return response.data;
}

/** Как apiFetch, но возвращает status, url и headers (для create — Location). */
export async function apiFetchResult(
  contextOrTabId: ApiContext | number,
  path: string,
  method = "GET",
  body: unknown = null,
): Promise<ApiFetchResult> {
  const response = await sendApiRequest(toContext(contextOrTabId), path, method, body);
  return {
    data: response.data,
    status: response.status,
    url: response.url,
    headers: response.headers || {},
  };
}
