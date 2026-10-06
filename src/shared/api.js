import { normalizeDomainOrEmpty } from "./domains.js";
import { formatAuthFetchError, withTimeout } from "./auth.js";
import { ensureAuthenticated } from "./auth-modal.js";

export { withTimeout };
export const API_REQUEST_TIMEOUT_MS = 30_000;

/** Кэш успешной сессии — повторные apiFetch не ждут PH_AUTH_STATUS. */
const AUTH_CONTEXT_TTL_MS = 60_000;
/** Короткий gate: не ждём полный AUTH_MESSAGE_TIMEOUT_MS (20с) перед API. */
const AUTH_STATUS_GATE_MS = 2_000;
/** @type {Map<string, number>} domain → timestamp */
const authenticatedAtByDomain = new Map();
/** @type {Map<string, Promise<{ authenticated: boolean, timedOut?: boolean, explicitDeny?: boolean }>>} */
const inflightAuthStatusByDomain = new Map();

export function formatApiError(response) {
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

export async function findTabForDomain(domain) {
  const tabs = await chrome.tabs.query({ url: `https://${domain}/*` });
  const tab = tabs.find((item) => item.id != null);
  return tab?.id ?? null;
}

/**
 * Сбрасывает кэш «вход подтверждён» для домена (или для всех).
 * @param {string} [domainInput]
 */
export function clearResolvedAdminContext(domainInput) {
  const domain = normalizeDomainOrEmpty(domainInput);
  if (domain) authenticatedAtByDomain.delete(domain);
  else authenticatedAtByDomain.clear();
}

/**
 * @param {string} domain
 * @param {number} [timeoutMs]
 * @returns {Promise<{ authenticated: boolean, timedOut?: boolean, explicitDeny?: boolean }>}
 */
async function queryAuthStatus(domain, timeoutMs = AUTH_STATUS_GATE_MS) {
  try {
    // force: false — не обходим failure-cache current_user и не дублируем тяжёлый probe.
    const response = await withTimeout(
      chrome.runtime.sendMessage({
        action: "PH_AUTH_STATUS",
        payload: { domain, force: false },
      }),
      timeoutMs,
      "AUTH_STATUS_TIMEOUT"
    );
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
    const message = String(err?.message || err);
    if (message === "AUTH_STATUS_TIMEOUT") {
      return { authenticated: false, timedOut: true };
    }
    return { authenticated: false };
  }
}

/**
 * Возвращает контекст API (background → adminApiFetch).
 * Не блокирует загрузку условий/meta на долгом PH_AUTH_STATUS (раньше до 20с):
 * короткий gate, soft-fail, кэш успеха; реальный 401/403 — из PH_ADMIN_API_FETCH.
 * @returns {Promise<{ domain: string, mode: "background" }>}
 */
export async function resolveAdminTab(domainInput) {
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

  // Таймаут / мягкий сбой / cached failure: не мешаем API — реальный запрос сам
  // разберётся (401/403 обрабатывается в sendApiRequestViaBackground).
  if (authStatus.timedOut || !authStatus.explicitDeny) {
    return { domain, mode: "background" };
  }

  authenticatedAtByDomain.delete(domain);

  // Явный отказ: на странице с модалкой входа (chains.html) не просто просим "нажмите
  // «Загрузить задачи»" — сразу запускаем ту же проверку/вход, что и по этой кнопке.
  // Иначе meta, страны, condition-схема и т.п. молча уходят в ручной режим, хотя
  // пользователь может войти прямо сейчас.
  if (typeof document !== "undefined" && document.getElementById("auth-modal-overlay")) {
    const authed = await ensureAuthenticated(domain, {
      message: "Для загрузки справочников нужен вход в админку",
    });
    if (authed) {
      authenticatedAtByDomain.set(domain, Date.now());
      return { domain, mode: "background" };
    }
  }

  throw new Error(
    `Требуется вход в админку https://${domain} — нажмите «Загрузить задачи» для авторизации`
  );
}

function isHttpAuthFailure(response) {
  const status = Number(response?.status);
  return status === 401 || status === 403;
}

async function sendApiRequestViaBackground(domain, path, method = "GET", body = null) {
  const response = await withTimeout(
    chrome.runtime.sendMessage({
      action: "PH_ADMIN_API_FETCH",
      payload: { domain, path, method, body },
    }),
    API_REQUEST_TIMEOUT_MS,
    "Превышено время ожидания API — проверьте вход в админку"
  );
  if (!response?.ok) {
    if (isHttpAuthFailure(response)) clearResolvedAdminContext(domain);
    throw new Error(formatApiError(response));
  }
  authenticatedAtByDomain.set(domain, Date.now());
  return response;
}

async function sendApiRequestViaTab(tabId, path, method = "GET", body = null) {
  const response = await withTimeout(
    chrome.tabs.sendMessage(tabId, {
      action: "PH_API_FETCH",
      payload: { path, method, body },
    }),
    API_REQUEST_TIMEOUT_MS,
    "Превышено время ожидания API — проверьте вход в админку"
  );
  if (!response?.ok) {
    throw new Error(formatApiError(response));
  }
  return response;
}

async function sendApiRequest(context, path, method = "GET", body = null) {
  if (context?.mode === "background") {
    return sendApiRequestViaBackground(context.domain, path, method, body);
  }
  return sendApiRequestViaTab(context.tabId, path, method, body);
}

export async function apiFetch(contextOrTabId, path, method = "GET", body = null) {
  const context =
    typeof contextOrTabId === "object" && contextOrTabId != null
      ? contextOrTabId
      : { tabId: contextOrTabId, mode: "tab" };
  const response = await sendApiRequest(context, path, method, body);
  return response.data;
}

/** Как apiFetch, но возвращает status, url и headers (для create — Location). */
export async function apiFetchResult(contextOrTabId, path, method = "GET", body = null) {
  const context =
    typeof contextOrTabId === "object" && contextOrTabId != null
      ? contextOrTabId
      : { tabId: contextOrTabId, mode: "tab" };
  const response = await sendApiRequest(context, path, method, body);
  return {
    data: response.data,
    status: response.status,
    url: response.url,
    headers: response.headers || {},
  };
}
