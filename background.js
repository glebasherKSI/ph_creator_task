import {
  STORAGE_KEYS,
  DEFAULT_DOMAIN,
  CONTENT_SCRIPT_PATH,
} from "./src/shared/constants.js";
import { hostFromUrl, originPattern, loadDomainsFromStorage } from "./src/shared/domains.js";
import {
  REPORTS_ENDPOINT,
  REPORTS_ORIGIN,
  REPORTS_FETCH_ERRORS,
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

async function fetchInReportsPageContext(tabId, body) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async (endpoint, requestBody) => {
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

        const response = await fetch(endpoint, {
          method: "POST",
          credentials: "include",
          headers: {
            Accept: "application/json, text/plain, */*",
            "Content-Type": "application/json",
            "X-XSRF-TOKEN": xsrfToken,
          },
          body: JSON.stringify(requestBody || {}),
        });

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
    args: [REPORTS_ENDPOINT, body],
  });

  return result;
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
      const result = await fetchInReportsPageContext(reportsTab.id, body);
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

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  maybeInjectTab(tab);
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
  if (msg.action !== "PH_REPORTS_FETCH") return;

  handleReportsFetch(msg.payload)
    .then((result) => sendResponse(result))
    .catch((err) =>
      sendResponse({
        ok: false,
        error: String(err?.message || err),
        errorCode: String(err?.message || err).startsWith("REPORTS_")
          ? String(err?.message || err)
          : undefined,
      })
    );
  return true;
});
