import { normalizeDomainOrEmpty } from "./domains.js";
import { AUTH_MESSAGE_TIMEOUT_MS, formatAuthFetchError, withTimeout } from "./auth.js";
import { ensureAuthenticated } from "./auth-modal.js";

export { withTimeout };
export const API_REQUEST_TIMEOUT_MS = 30_000;

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

async function queryAuthStatus(domain) {
  try {
    const response = await withTimeout(
      chrome.runtime.sendMessage({
        action: "PH_AUTH_STATUS",
        payload: { domain, force: true },
      }),
      AUTH_MESSAGE_TIMEOUT_MS,
      "AUTH_STATUS_TIMEOUT"
    );
    if (response?.ok && response.authenticated) return response;
  } catch (err) {
    const message = String(err?.message || err);
    if (message === "AUTH_STATUS_TIMEOUT") {
      throw new Error("Превышено время ожидания проверки входа — откройте админку в браузере");
    }
  }
  return null;
}

/**
 * Возвращает контекст API только при подтверждённой сессии (background → adminApiFetch).
 * @returns {Promise<{ domain: string, mode: "background" }>}
 */
export async function resolveAdminTab(domainInput) {
  const domain = normalizeDomainOrEmpty(domainInput);
  if (!domain) throw new Error("Выберите домен админки");

  const authStatus = await queryAuthStatus(domain);
  if (authStatus?.authenticated) {
    return { domain, mode: "background" };
  }

  // На странице с модалкой входа (chains.html) не просто просим "нажмите «Загрузить
  // задачи»" — сразу запускаем ту же проверку/вход, что и по этой кнопке. Иначе meta,
  // страны, condition-схема и т.п. молча уходят в ручной режим до первой ручной загрузки
  // задач, хотя пользователь может быть уже залогинен.
  if (typeof document !== "undefined" && document.getElementById("auth-modal-overlay")) {
    const authed = await ensureAuthenticated(domain, {
      message: "Для загрузки справочников нужен вход в админку",
    });
    if (authed) {
      return { domain, mode: "background" };
    }
  }

  throw new Error(
    `Требуется вход в админку https://${domain} — нажмите «Загрузить задачи» для авторизации`
  );
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
    throw new Error(formatApiError(response));
  }
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
