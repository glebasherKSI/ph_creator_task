import { normalizeDomainOrEmpty } from "./domains.js";
import { ensureContentScriptReady } from "./content-script.js";

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
  if (detail) return `HTTP ${status || "unknown"}:\n${detail}`;
  return `HTTP ${status || "unknown"}`;
}

export async function findTabForDomain(domain) {
  const tabs = await chrome.tabs.query({ url: `https://${domain}/*` });
  const tab = tabs.find((item) => item.id != null);
  return tab?.id ?? null;
}

/**
 * Находит вкладку админки, подключает content script.
 * @returns {Promise<number>} tabId
 */
export async function resolveAdminTab(domainInput) {
  const domain = normalizeDomainOrEmpty(domainInput);
  if (!domain) throw new Error("Выберите домен админки");

  const tabId = await findTabForDomain(domain);
  if (tabId == null) {
    throw new Error(`Откройте вкладку https://${domain}/... и повторите`);
  }

  const ready = await ensureContentScriptReady(tabId);
  if (!ready) {
    throw new Error("Не удалось подключить content.js к вкладке админки");
  }

  return { tabId, domain };
}

async function sendApiRequest(tabId, path, method = "GET", body = null) {
  const response = await chrome.tabs.sendMessage(tabId, {
    action: "PH_API_FETCH",
    payload: { path, method, body },
  });
  if (!response?.ok) {
    throw new Error(formatApiError(response));
  }
  return response;
}

export async function apiFetch(tabId, path, method = "GET", body = null) {
  const response = await sendApiRequest(tabId, path, method, body);
  return response.data;
}

/** Как apiFetch, но возвращает status, url и headers (для create — Location). */
export async function apiFetchResult(tabId, path, method = "GET", body = null) {
  const response = await sendApiRequest(tabId, path, method, body);
  return {
    data: response.data,
    status: response.status,
    url: response.url,
    headers: response.headers || {},
  };
}
