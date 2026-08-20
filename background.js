import {
  STORAGE_KEYS,
  DEFAULT_DOMAIN,
  CONTENT_SCRIPT_PATH,
} from "./src/shared/constants.js";
import { hostFromUrl, originPattern, loadDomainsFromStorage } from "./src/shared/domains.js";
import {
  adminApiFetch,
  clearAwaitingMagicLink,
  extractMagicLinkToken,
  formatAuthFetchError,
  getAuthStatus,
  isAwaitingMagicLink,
  logoutAdmin,
  magicLogin,
  sendMagicLoginInstructions,
  verifyOtp,
} from "./src/shared/auth.js";
import {
  REPORTS_ENDPOINT,
  REPORTS_ORIGIN,
  REPORTS_FETCH_ERRORS,
  SET_ACTIVE_PROJECT_ENDPOINT,
  REPORTS_STATE_ENDPOINT,
} from "./src/shared/reports.js";

async function getDomains() {
  return loadDomainsFromStorage();
}

async function hasOriginPermission(host) {
  return chrome.permissions.contains({ origins: [originPattern(host)] });
}

async function injectTab(tabId) {
  try {
    const ping = await chrome.tabs.sendMessage(tabId, { action: "PING" });
    if (ping?.ok) return;
  } catch {
    /* not injected yet */
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [CONTENT_SCRIPT_PATH],
    });
  } catch {
    /* tab may be restricted or not ready */
  }
}

async function maybeInjectTab(tab) {
  if (!tab?.id || !tab.url?.startsWith("https://")) return;
  const host = hostFromUrl(tab.url);
  if (!host) return;

  const domains = await getDomains();
  if (!domains.includes(host)) return;
  if (!(await hasOriginPermission(host))) return;

  await injectTab(tab.id);
}

async function resolveReportsAuthCookies() {
  const targetUrl = `${REPORTS_ORIGIN}/`;
  const [xsrfCookie, sessionCookie] = await Promise.all([
    chrome.cookies.get({ url: targetUrl, name: "XSRF-TOKEN" }),
    chrome.cookies.get({ url: targetUrl, name: "reports_session" }),
  ]);
  return { xsrfCookie, sessionCookie };
}

async function findReportsTab() {
  const tabs = await chrome.tabs.query({ url: `${REPORTS_ORIGIN}/*` });
  if (!tabs.length) return null;
  return tabs.find((tab) => tab.active) || tabs[0];
}

async function fetchInReportsPageContext(tabId, endpoint, body, method = "POST") {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async (endpoint, requestBody, httpMethod) => {
      const getCookieValue = (name) => {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const match = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
        return match ? decodeURIComponent(match[1]) : "";
      };

      try {
        const xsrfToken = getCookieValue("XSRF-TOKEN");
        if (!xsrfToken) {
          return {
            ok: false,
            errorCode: "REPORTS_XSRF_MISSING",
            error: "XSRF-TOKEN не найден в cookies страницы",
          };
        }

        const method = String(httpMethod || "POST").toUpperCase();
        const hasBody = method !== "GET" && method !== "HEAD";
        const requestInit = {
          method,
          credentials: "include",
          headers: {
            Accept: "application/json, text/plain, */*",
            "X-XSRF-TOKEN": xsrfToken,
          },
        };
        if (hasBody) {
          requestInit.headers["Content-Type"] = "application/json";
          requestInit.body = JSON.stringify(requestBody || {});
        }

        const response = await fetch(endpoint, requestInit);

        const text = await response.text();
        let data = text;
        const contentType = String(response.headers.get("content-type") || "").toLowerCase();
        if (contentType.includes("application/json")) {
          try {
            data = JSON.parse(text);
          } catch {
            data = text;
          }
        }

        const headers = {};
        response.headers.forEach((value, key) => {
          headers[key.toLowerCase()] = value;
        });

        return {
          ok: response.ok,
          status: response.status,
          url: response.url || endpoint,
          data,
          headers,
          error: response.ok ? undefined : `HTTP ${response.status}`,
        };
      } catch (err) {
        return {
          ok: false,
          error: String(err?.message || err),
        };
      }
    },
    args: [endpoint, body ?? null, method ?? "POST"],
  });

  return result;
}

// Reports фильтрует данные по «активному проекту», который хранится в серверной
// сессии, а не берётся из тела запроса отчёта. UI Reports переключает его через
// POST /set-active-project { project_id: <number> }. Повторяем этот вызов, чтобы
// выбирать проект целиком из расширения (иначе отчёт возвращает агрегат --ALL--).
async function setActiveReportsProject(tabId, projectId) {
  const numericId = Number(String(projectId ?? "").trim());
  if (!Number.isInteger(numericId) || numericId <= 0) return;

  const result = await fetchInReportsPageContext(tabId, SET_ACTIVE_PROJECT_ENDPOINT, {
    project_id: numericId,
  });
  if (!result) {
    throw new Error(REPORTS_FETCH_ERRORS.SCRIPT_FAILED);
  }
  if (!result.ok) {
    if (result.errorCode) throw new Error(result.errorCode);
    throw new Error(REPORTS_FETCH_ERRORS.SCRIPT_FAILED);
  }
}

async function fetchReportsAllPages(tabId, body) {
  const perPage = Number(body?.perPage) > 0 ? Number(body.perPage) : 500;
  const allRows = [];
  let currentPage = 1;
  let countAll = null;
  let lastResult = null;
  let lastData = null;

  while (currentPage <= 100) {
    const pageBody = { ...body, currentPage, perPage };
    const result = await fetchInReportsPageContext(tabId, REPORTS_ENDPOINT, pageBody);
    if (!result) {
      throw new Error(REPORTS_FETCH_ERRORS.SCRIPT_FAILED);
    }
    if (!result.ok && result.errorCode) {
      throw new Error(result.errorCode);
    }
    if (!result.ok) {
      throw new Error(REPORTS_FETCH_ERRORS.SCRIPT_FAILED);
    }

    const data = result.data && typeof result.data === "object" ? result.data : {};
    const pageRows = Array.isArray(data.rows) ? data.rows : [];
    const pageCountAll = Number(data.countAll ?? data.count_all);
    if (Number.isFinite(pageCountAll) && pageCountAll >= 0) {
      countAll = pageCountAll;
    }

    allRows.push(...pageRows);
    lastResult = result;
    lastData = data;

    if (!pageRows.length) break;
    if (pageRows.length < perPage) break;
    if (countAll != null && allRows.length >= countAll) break;

    currentPage += 1;
  }

  return {
    ...lastResult,
    data: {
      ...lastData,
      rows: allRows,
      countAll: countAll ?? allRows.length,
    },
  };
}

async function handleReportsFetch(payload) {
  const body = payload?.body || {};
  const { sessionCookie } = await resolveReportsAuthCookies();

  if (!sessionCookie?.value) {
    throw new Error(REPORTS_FETCH_ERRORS.SESSION_MISSING);
  }

  const reportsTab = await findReportsTab();
  if (reportsTab?.id) {
    try {
      await setActiveReportsProject(reportsTab.id, body.project_id);
      const result = await fetchReportsAllPages(reportsTab.id, body);
      if (!result) {
        throw new Error(REPORTS_FETCH_ERRORS.SCRIPT_FAILED);
      }
      if (!result.ok && result.errorCode) {
        throw new Error(result.errorCode);
      }
      return result;
    } catch (err) {
      if (String(err?.message || err).startsWith("REPORTS_")) {
        throw err;
      }
      throw new Error(REPORTS_FETCH_ERRORS.SCRIPT_FAILED);
    }
  }

  throw new Error(REPORTS_FETCH_ERRORS.TAB_REQUIRED);
}

// Список проектов и активный проект: GET /state/0 в контексте вкладки Reports.
async function handleReportsState() {
  const { sessionCookie } = await resolveReportsAuthCookies();
  if (!sessionCookie?.value) {
    throw new Error(REPORTS_FETCH_ERRORS.SESSION_MISSING);
  }

  const reportsTab = await findReportsTab();
  if (!reportsTab?.id) {
    throw new Error(REPORTS_FETCH_ERRORS.TAB_REQUIRED);
  }

  try {
    const result = await fetchInReportsPageContext(reportsTab.id, REPORTS_STATE_ENDPOINT, null, "GET");
    if (!result) {
      throw new Error(REPORTS_FETCH_ERRORS.SCRIPT_FAILED);
    }
    if (!result.ok && result.errorCode) {
      throw new Error(result.errorCode);
    }
    return result;
  } catch (err) {
    if (String(err?.message || err).startsWith("REPORTS_")) {
      throw err;
    }
    throw new Error(REPORTS_FETCH_ERRORS.SCRIPT_FAILED);
  }
}

function reportsErrorResponse(err) {
  const message = String(err?.message || err);
  return {
    ok: false,
    error: message,
    errorCode: message.startsWith("REPORTS_") ? message : undefined,
  };
}

function authErrorResponse(err, domain) {
  const raw = String(err?.message || err);
  return {
    ok: false,
    error: formatAuthFetchError(err, domain),
    errorCode: raw.startsWith("AUTH_") ? raw : undefined,
  };
}

async function handleAdminApiFetch(payload) {
  const domain = payload?.domain;
  const path = payload?.path;
  const method = payload?.method || "GET";
  const body = payload?.body ?? null;
  const options = payload?.options ?? {};
  return adminApiFetch(domain, path, method, body, options);
}

/** Недавно обработанные token → timestamp (защита от двойного вызова url + complete). */
const recentMagicLoginTokens = new Map();
const MAGIC_LOGIN_DEDUPE_MS = 60_000;

async function handleMagicLinkUrl(url) {
  const token = extractMagicLinkToken(url);
  if (!token) return;

  const now = Date.now();
  const lastUsed = recentMagicLoginTokens.get(token);
  if (lastUsed != null && now - lastUsed < MAGIC_LOGIN_DEDUPE_MS) return;
  recentMagicLoginTokens.set(token, now);

  let domain;
  try {
    domain = new URL(url).hostname;
  } catch {
    return;
  }

  const domains = await getDomains();
  if (!domains.includes(domain)) return;

  // Перехват только при активном входе через расширение — иначе съедаем
  // одноразовый token раньше, чем админка успеет его принять в браузере.
  if (!(await isAwaitingMagicLink(domain))) return;

  try {
    const result = await magicLogin(domain, token);
    if (result?.ok) {
      await clearAwaitingMagicLink(domain);
    }
  } catch {
    /* user can retry manually from popup */
  }
}

async function maybeHandleMagicLinkTab(tab) {
  if (!tab?.url) return;
  await handleMagicLinkUrl(tab.url);
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    maybeInjectTab(tab);
    maybeHandleMagicLinkTab(tab);
    return;
  }
  if (changeInfo.url) {
    maybeHandleMagicLinkTab({ ...tab, url: changeInfo.url });
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.DOMAINS);
  const domains = stored[STORAGE_KEYS.DOMAINS];
  if (!Array.isArray(domains) || domains.length === 0) {
    await chrome.storage.local.set({
      [STORAGE_KEYS.DOMAINS]: [DEFAULT_DOMAIN],
    });
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg?.action) return;

  if (msg.action === "PH_REPORTS_FETCH") {
    handleReportsFetch(msg.payload)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse(reportsErrorResponse(err)));
    return true;
  }

  if (msg.action === "PH_REPORTS_STATE") {
    handleReportsState()
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse(reportsErrorResponse(err)));
    return true;
  }

  if (msg.action === "PH_ADMIN_API_FETCH") {
    handleAdminApiFetch(msg.payload)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse(authErrorResponse(err, msg.payload?.domain)));
    return true;
  }

  if (msg.action === "PH_AUTH_STATUS") {
    getAuthStatus(msg.payload?.domain, { force: Boolean(msg.payload?.force) })
      .then((status) => sendResponse({ ok: true, ...status }))
      .catch((err) => sendResponse(authErrorResponse(err, msg.payload?.domain)));
    return true;
  }

  if (msg.action === "PH_AUTH_SEND_MAGIC_LINK") {
    sendMagicLoginInstructions(msg.payload?.domain, msg.payload?.email)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse(authErrorResponse(err, msg.payload?.domain)));
    return true;
  }

  if (msg.action === "PH_AUTH_MAGIC_LOGIN") {
    magicLogin(msg.payload?.domain, msg.payload?.token)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse(authErrorResponse(err, msg.payload?.domain)));
    return true;
  }

  if (msg.action === "PH_AUTH_VERIFY_OTP") {
    verifyOtp(msg.payload?.domain, msg.payload?.otp)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse(authErrorResponse(err, msg.payload?.domain)));
    return true;
  }

  if (msg.action === "PH_AUTH_LOGOUT") {
    logoutAdmin(msg.payload?.domain)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse(authErrorResponse(err, msg.payload?.domain)));
    return true;
  }
});
