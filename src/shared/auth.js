import {
  STORAGE_KEYS,
  ADMIN_SESSION_COOKIE,
  ADMIN_API_PREFIX,
  ADMIN_AUTH_LOCALE,
} from "./constants.js";
import { hostFromUrl, normalizeDomainOrEmpty, originPattern } from "./domains.js";

const MAGIC_LINK_PATH_RE = /\/admin\/-\/auth\/magic-login(?:\?|$)/;

/** @typedef {{ value?: string, email?: string, userId?: number, updatedAt?: number, verified?: boolean }} AuthSessionRecord */

function sessionIsVerified(record) {
  if (!record?.value) return false;
  return Boolean(record.verified || record.email || record.userId);
}

/**
 * @returns {Promise<Record<string, AuthSessionRecord>>}
 */
export async function loadAuthSessionsStore() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.AUTH_SESSIONS);
  const raw = stored[STORAGE_KEYS.AUTH_SESSIONS];
  return raw && typeof raw === "object" && !Array.isArray(raw) ? { ...raw } : {};
}

/**
 * @param {Record<string, AuthSessionRecord>} store
 */
export async function saveAuthSessionsStore(store) {
  await chrome.storage.local.set({ [STORAGE_KEYS.AUTH_SESSIONS]: store });
}

/**
 * @param {string} domainInput
 * @returns {Promise<AuthSessionRecord | null>}
 */
export async function getStoredAuthSession(domainInput) {
  const domain = normalizeDomainOrEmpty(domainInput);
  if (!domain) return null;
  const store = await loadAuthSessionsStore();
  const record = store[domain];
  return record?.value ? { ...record } : null;
}

/**
 * @param {string} domainInput
 * @param {AuthSessionRecord} record
 */
export async function saveStoredAuthSession(domainInput, record) {
  const domain = normalizeDomainOrEmpty(domainInput);
  if (!domain || !record?.value) return;
  const store = await loadAuthSessionsStore();
  const prev = store[domain];
  const next = {
    ...prev,
    ...record,
    updatedAt: Date.now(),
  };
  if (
    prev?.value === next.value &&
    prev?.email === next.email &&
    prev?.userId === next.userId &&
    Boolean(prev?.verified) === Boolean(next.verified)
  ) {
    return;
  }
  store[domain] = next;
  await saveAuthSessionsStore(store);
}

/**
 * @param {string} domainInput
 */
export async function clearStoredAuthSession(domainInput) {
  const domain = normalizeDomainOrEmpty(domainInput);
  if (!domain) return;
  const store = await loadAuthSessionsStore();
  if (!store[domain]) return;
  delete store[domain];
  await saveAuthSessionsStore(store);
}

export function adminOrigin(domainInput) {
  const domain = normalizeDomainOrEmpty(domainInput);
  return domain ? `https://${domain}` : "";
}

export function adminApiUrl(domainInput, path, locale = ADMIN_AUTH_LOCALE) {
  const origin = adminOrigin(domainInput);
  if (!origin) return "";
  const normalizedPath = String(path || "").startsWith("/")
    ? String(path)
    : `${ADMIN_API_PREFIX}/${path}`;
  const url = new URL(normalizedPath, origin);
  if (locale && !url.searchParams.has("locale")) {
    url.searchParams.set("locale", locale);
  }
  return url.toString();
}

export function otpVerifyReferer(domainInput) {
  const origin = adminOrigin(domainInput);
  return origin ? `${origin}/admin/-/otp/verify` : "";
}

export function isPrivateAdminDomain(domainInput) {
  const domain = normalizeDomainOrEmpty(domainInput);
  return domain.endsWith(".private");
}

export function adminTabUrl(domainInput) {
  return adminOrigin(domainInput) ? `${adminOrigin(domainInput)}/` : "";
}

export const AUTH_MESSAGE_TIMEOUT_MS = 20_000;

export function withTimeout(promise, ms, message = "Превышено время ожидания") {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    Promise.resolve(promise)
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

function isValidAdminUser(user) {
  return user && typeof user === "object" && (user.id != null || user.email);
}

const CURRENT_USER_FAIL_TTL_MS = 8000;
const PENDING_OTP_KEY_PREFIX = "ph_auth_pending_otp_";
const AWAITING_MAGIC_LINK_PREFIX = "ph_auth_awaiting_magic_link_";
/** @type {Map<string, { at: number, result: unknown }>} */
const currentUserFailureCache = new Map();

function pendingOtpStorageKey(domainInput) {
  const domain = normalizeDomainOrEmpty(domainInput);
  return domain ? `${PENDING_OTP_KEY_PREFIX}${domain}` : "";
}

function awaitingMagicLinkStorageKey(domainInput) {
  const domain = normalizeDomainOrEmpty(domainInput);
  return domain ? `${AWAITING_MAGIC_LINK_PREFIX}${domain}` : "";
}

export { pendingOtpStorageKey, awaitingMagicLinkStorageKey };

/**
 * @param {string} domainInput
 * @returns {Promise<boolean>}
 */
export async function hasPendingOtpFlow(domainInput) {
  const key = pendingOtpStorageKey(domainInput);
  if (!key) return false;
  const stored = await chrome.storage.local.get(key);
  const record = stored[key];
  return record?.magicLoginOk === true;
}

/**
 * @param {string} domainInput
 */
export async function setPendingOtpFlow(domainInput) {
  const domain = normalizeDomainOrEmpty(domainInput);
  if (!domain) return;
  await chrome.storage.local.set({
    [pendingOtpStorageKey(domain)]: {
      domain,
      updatedAt: Date.now(),
      magicLoginOk: true,
    },
  });
}

/**
 * @param {string} domainInput
 */
export async function clearPendingOtpFlow(domainInput) {
  const key = pendingOtpStorageKey(domainInput);
  if (!key) return;
  await chrome.storage.local.remove(key);
}

/**
 * Расширение ждёт magic link (письмо отправлено из auth-модалки).
 * @param {string} domainInput
 * @returns {Promise<boolean>}
 */
export async function isAwaitingMagicLink(domainInput) {
  const key = awaitingMagicLinkStorageKey(domainInput);
  if (!key) return false;
  const stored = await chrome.storage.local.get(key);
  return Boolean(stored[key]);
}

/**
 * @param {string} domainInput
 */
export async function setAwaitingMagicLink(domainInput) {
  const domain = normalizeDomainOrEmpty(domainInput);
  if (!domain) return;
  await chrome.storage.local.set({
    [awaitingMagicLinkStorageKey(domain)]: {
      domain,
      updatedAt: Date.now(),
    },
  });
}

/**
 * @param {string} domainInput
 */
export async function clearAwaitingMagicLink(domainInput) {
  const key = awaitingMagicLinkStorageKey(domainInput);
  if (!key) return;
  await chrome.storage.local.remove(key);
}

export function clearCurrentUserFailureCache(domainInput) {
  const domain = normalizeDomainOrEmpty(domainInput);
  if (domain) currentUserFailureCache.delete(domain);
}

export function extractMagicLinkToken(url) {
  try {
    const parsed = new URL(url);
    if (!MAGIC_LINK_PATH_RE.test(parsed.pathname)) return null;
    const token = parsed.searchParams.get("token");
    return token ? String(token).trim() : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} domainInput
 */
export async function readBrowserSessionCookie(domainInput) {
  const origin = adminOrigin(domainInput);
  if (!origin) return null;
  return chrome.cookies.get({
    url: `${origin}/`,
    name: ADMIN_SESSION_COOKIE,
  });
}

/**
 * @param {string} domainInput
 * @param {string} value
 */
export async function writeBrowserSessionCookie(domainInput, value) {
  const origin = adminOrigin(domainInput);
  if (!origin || !value) return false;
  await chrome.cookies.set({
    url: `${origin}/`,
    name: ADMIN_SESSION_COOKIE,
    value,
    secure: true,
    httpOnly: true,
    sameSite: "lax",
  });
  return true;
}

/**
 * @param {string} domainInput
 */
export async function removeBrowserSessionCookie(domainInput) {
  const origin = adminOrigin(domainInput);
  if (!origin) return;
  const existing = await readBrowserSessionCookie(domainInput);
  if (!existing) return;
  await chrome.cookies.remove({
    url: `${origin}/`,
    name: ADMIN_SESSION_COOKIE,
  });
}

/**
 * @param {string} domainInput
 */
export async function syncSessionFromBrowser(domainInput, options = {}) {
  const cookie = await readBrowserSessionCookie(domainInput);
  if (!cookie?.value) return null;

  const domain = normalizeDomainOrEmpty(domainInput);
  if (!domain) return null;

  const existing = await getStoredAuthSession(domain);
  const inAuthFlow =
    options.force === true ||
    sessionIsVerified(existing) ||
    (await hasPendingOtpFlow(domain)) ||
    (await isAwaitingMagicLink(domain));

  if (!inAuthFlow) return cookie.value;

  await saveStoredAuthSession(domainInput, { value: cookie.value });
  return cookie.value;
}

/**
 * @param {string} domainInput
 */
export async function ensureBrowserSessionCookie(domainInput) {
  const stored = await getStoredAuthSession(domainInput);
  if (!stored?.value) return false;
  await writeBrowserSessionCookie(domainInput, stored.value);
  return true;
}

/**
 * @param {string} domainInput
 */
export async function hasDomainHostPermission(domainInput) {
  const domain = normalizeDomainOrEmpty(domainInput);
  if (!domain) return false;
  return chrome.permissions.contains({ origins: [originPattern(domain)] });
}

function parseResponseBody(response, text) {
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

function collectResponseHeaders(response) {
  const headers = {};
  response.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  return headers;
}

export const AUTH_FETCH_ERRORS = {
  TAB_REQUIRED: "AUTH_TAB_REQUIRED",
  SSL_ERROR: "AUTH_SSL_ERROR",
  SCRIPT_FAILED: "AUTH_SCRIPT_FAILED",
  TAB_ERROR_PAGE: "AUTH_TAB_ERROR_PAGE",
};

const TRANSIENT_AUTH_ERRORS = new Set([
  AUTH_FETCH_ERRORS.TAB_ERROR_PAGE,
  AUTH_FETCH_ERRORS.TAB_REQUIRED,
]);

function shouldCacheCurrentUserFailure(error) {
  const code = String(error?.message || error || "");
  return !TRANSIENT_AUTH_ERRORS.has(code);
}

function isChromeErrorPageUrl(url) {
  const normalized = String(url || "").toLowerCase();
  return (
    normalized.startsWith("chrome-error://") ||
    normalized.startsWith("chrome://") ||
    normalized.includes("chromewebdata")
  );
}

function isTabErrorPageExecuteScriptError(err) {
  return /showing error page/i.test(String(err?.message || err || ""));
}

/**
 * Вкладка пригодна для tab-context fetch: https URL, не chrome-error, не discarded.
 * Self-signed («Не защищено») — нормально; loading не отбрасываем (ранжируем ниже complete).
 * @param {chrome.tabs.Tab | null | undefined} tab
 */
function isAdminTabUsable(tab) {
  if (!tab?.id) return false;
  const url = String(tab.url || "");
  if (!url.startsWith("https://")) return false;
  if (isChromeErrorPageUrl(url)) return false;
  if (tab.discarded) return false;
  return true;
}

function adminTabRank(tab) {
  let score = 0;
  if (!isChromeErrorPageUrl(tab.url)) score += 1000;
  if (isAdminTabUsable(tab)) score += 100;
  if (tab.active) score += 50;
  if (String(tab.url || "").includes("/admin")) score += 25;
  if (tab.status === "complete") score += 10;
  return score;
}

async function queryAdminDomainTabs(domain) {
  const byPattern = await chrome.tabs.query({ url: `https://${domain}/*` });
  const seen = new Set(byPattern.map((tab) => tab.id));
  const merged = [...byPattern];

  const httpsTabs = await chrome.tabs.query({ url: "https://*/*" });
  for (const tab of httpsTabs) {
    if (seen.has(tab.id)) continue;
    if (hostFromUrl(tab.url) === domain) {
      merged.push(tab);
      seen.add(tab.id);
    }
  }

  return merged;
}

/**
 * @param {number} tabId
 */
async function validateAdminTab(tabId) {
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    throw new Error(AUTH_FETCH_ERRORS.TAB_REQUIRED);
  }

  const url = String(tab.url || "");
  if (!url || isChromeErrorPageUrl(url)) {
    throw new Error(AUTH_FETCH_ERRORS.TAB_ERROR_PAGE);
  }

  if (tab.status && tab.status !== "complete") {
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      throw new Error(AUTH_FETCH_ERRORS.TAB_REQUIRED);
    }
    if (isChromeErrorPageUrl(tab.url)) {
      throw new Error(AUTH_FETCH_ERRORS.TAB_ERROR_PAGE);
    }
  }

  return tab;
}

function isSslOrNetworkError(err) {
  const msg = String(err?.message || err || "");
  return /ERR_CERT|CERT_AUTHORITY|SSL|certificate|Failed to fetch|NetworkError|net::ERR/i.test(msg);
}

/** chrome.scripting.executeScript args must be JSON-serializable; undefined is not. */
function serializeScriptArgs(...args) {
  return args.map((arg) => (arg === undefined ? null : arg));
}

export function formatAuthFetchError(err, domainInput) {
  const raw = String(err?.message || err || "").trim();
  const code = raw.startsWith("AUTH_") ? raw : "";
  const domain = normalizeDomainOrEmpty(domainInput);
  const adminUrl = domain ? `https://${domain}` : "админку";

  const byCode = {
    [AUTH_FETCH_ERRORS.TAB_REQUIRED]:
      `Откройте ${adminUrl} в браузере (вкладка должна оставаться открытой), примите сертификат при первом заходе и повторите вход.`,
    [AUTH_FETCH_ERRORS.SSL_ERROR]:
      `Ошибка SSL-сертификата. Откройте ${adminUrl} в браузере, примите сертификат и повторите вход.`,
    [AUTH_FETCH_ERRORS.TAB_ERROR_PAGE]:
      `Вкладка админки показывает страницу ошибки (например, не принят SSL-сертификат). Откройте ${adminUrl} в браузере, примите сертификат, дождитесь загрузки страницы (не страницы ошибки) и повторите вход.`,
    [AUTH_FETCH_ERRORS.SCRIPT_FAILED]:
      `Не удалось выполнить запрос на вкладке админки. Обновите страницу ${adminUrl} и повторите попытку.`,
  };

  if (byCode[code]) return byCode[code];
  if (/unserializable/i.test(raw)) return byCode[AUTH_FETCH_ERRORS.SCRIPT_FAILED];
  if (isTabErrorPageExecuteScriptError(raw)) return byCode[AUTH_FETCH_ERRORS.TAB_ERROR_PAGE];
  if (/ERR_CERT|CERT_AUTHORITY|SSL|certificate/i.test(raw)) return byCode[AUTH_FETCH_ERRORS.SSL_ERROR];
  if (/Failed to fetch/i.test(raw)) {
    return `Не удалось подключиться к ${adminUrl}. Откройте админку в браузере, примите сертификат и повторите вход.`;
  }
  if (!raw) return "Не удалось выполнить запрос к админке.";
  return raw;
}

async function findAdminTab(domain) {
  const tabs = await queryAdminDomainTabs(domain);
  if (!tabs.length) return null;

  const sorted = [...tabs].sort((a, b) => adminTabRank(b) - adminTabRank(a));
  return sorted[0];
}

async function fetchInAdminPageContext(tabId, url, method, body, headers, refererPage) {
  let scriptResult;
  try {
    [scriptResult] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async (endpoint, httpMethod, requestBody, requestHeaders, refererPageUrl) => {
      /** @type {Window} */
      let execWindow = window;
      /** @type {HTMLIFrameElement | null} */
      let refererFrame = null;

      try {
        if (refererPageUrl) {
          refererFrame = document.createElement("iframe");
          refererFrame.style.cssText =
            "position:fixed;width:0;height:0;border:0;opacity:0;pointer-events:none";
          refererFrame.src = refererPageUrl;
          document.documentElement.appendChild(refererFrame);
          await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("referer iframe timeout")), 15000);
            refererFrame.addEventListener(
              "load",
              () => {
                clearTimeout(timer);
                resolve(undefined);
              },
              { once: true }
            );
            refererFrame.addEventListener(
              "error",
              () => {
                clearTimeout(timer);
                reject(new Error("referer iframe error"));
              },
              { once: true }
            );
          });
          if (refererFrame.contentWindow) execWindow = refererFrame.contentWindow;
        }

        const normalizedMethod = String(httpMethod || "GET").toUpperCase();
        const hasBody = normalizedMethod !== "GET" && normalizedMethod !== "HEAD" && requestBody != null;
        const requestInit = {
          method: normalizedMethod,
          credentials: "include",
          headers: { ...requestHeaders },
        };
        if (hasBody) requestInit.body = requestBody;

        const response = await execWindow.fetch(endpoint, requestInit);
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

        const responseHeaders = {};
        response.headers.forEach((value, key) => {
          responseHeaders[key.toLowerCase()] = value;
        });

        return {
          ok: response.ok,
          status: response.status,
          url: response.url || endpoint,
          data,
          headers: responseHeaders,
          error: response.ok ? undefined : `HTTP ${response.status}`,
        };
      } catch (err) {
        return {
          ok: false,
          error: String(err?.message || err),
        };
      } finally {
        refererFrame?.remove();
      }
    },
    args: serializeScriptArgs(url, method, body, headers, refererPage),
    });
  } catch (err) {
    if (isTabErrorPageExecuteScriptError(err)) {
      throw new Error(AUTH_FETCH_ERRORS.TAB_ERROR_PAGE);
    }
    throw err;
  }

  const result = scriptResult?.result;
  return result;
}

async function adminApiFetchViaTab(domain, url, httpMethod, headers, fetchBody, options) {
  const tabId = options.tabId ?? (await findAdminTab(domain))?.id;
  if (!tabId) throw new Error(AUTH_FETCH_ERRORS.TAB_REQUIRED);

  await validateAdminTab(tabId);

  const refererPage = options.refererPage || options.referer || null;
  const result = await fetchInAdminPageContext(tabId, url, httpMethod, fetchBody, headers, refererPage);
  if (!result) throw new Error(AUTH_FETCH_ERRORS.SCRIPT_FAILED);
  if (!result.ok && result.error && result.status == null && isSslOrNetworkError(result.error)) {
    throw new Error(AUTH_FETCH_ERRORS.SSL_ERROR);
  }

  if (!options.skipCookieSync) {
    await syncSessionFromBrowser(domain);
  }

  return result;
}

async function adminApiFetchViaServiceWorker(url, httpMethod, headers, fetchBody) {
  const response = await fetch(url, {
    method: httpMethod,
    credentials: "include",
    headers,
    body: fetchBody,
  });

  const text = await response.text();
  const data = parseResponseBody(response, text);
  const responseHeaders = collectResponseHeaders(response);

  return {
    ok: response.ok,
    status: response.status,
    url: response.url || url,
    data,
    headers: responseHeaders,
    error: response.ok ? undefined : `HTTP ${response.status}`,
  };
}

async function resolveAdminApiTransport(domain) {
  const tab = await findAdminTab(domain);
  if (tab?.id) {
    return { mode: "tab", tabId: tab.id };
  }
  if (isPrivateAdminDomain(domain)) {
    throw new Error(AUTH_FETCH_ERRORS.TAB_REQUIRED);
  }
  return { mode: "service_worker" };
}

/**
 * Fetch к admin API: для *.private и при открытой вкладке админки — через tab context;
 * иначе через service worker с fallback на вкладку при SSL-ошибке.
 * @param {string} domainInput
 * @param {string} path
 * @param {string} [method]
 * @param {unknown} [body]
 * @param {{ referer?: string, refererPage?: string, locale?: string, skipCookieSync?: boolean }} [options]
 */
export async function adminApiFetch(domainInput, path, method = "GET", body = null, options = {}) {
  const domain = normalizeDomainOrEmpty(domainInput);
  if (!domain) throw new Error("Домен не задан");

  const granted = await hasDomainHostPermission(domain);
  if (!granted) {
    throw new Error(`Нет host_permissions для https://${domain} — добавьте домен в popup`);
  }

  if (!options.skipCookieSync) {
    await ensureBrowserSessionCookie(domain);
  }

  const url = adminApiUrl(domain, path, options.locale ?? ADMIN_AUTH_LOCALE);
  const httpMethod = String(method || "GET").toUpperCase();
  const headers = {
    Accept: "application/json, text/plain, */*",
    "X-PH-Extension": "1",
  };

  let fetchBody = null;
  if (body != null && httpMethod !== "GET" && httpMethod !== "HEAD") {
    headers["Content-Type"] = "application/json";
    fetchBody = JSON.stringify(body);
  }

  const tabOptions = {
    ...options,
    refererPage: options.refererPage || options.referer || null,
  };

  let transport = await resolveAdminApiTransport(domain);

  if (transport.mode === "tab") {
    return adminApiFetchViaTab(domain, url, httpMethod, headers, fetchBody, {
      ...tabOptions,
      tabId: transport.tabId,
    });
  }

  try {
    const result = await adminApiFetchViaServiceWorker(url, httpMethod, headers, fetchBody);
    if (!options.skipCookieSync) {
      await syncSessionFromBrowser(domain);
    }
    return result;
  } catch (err) {
    if (!isSslOrNetworkError(err)) throw err;
    return adminApiFetchViaTab(domain, url, httpMethod, headers, fetchBody, tabOptions);
  }
}

/**
 * @param {string} domainInput
 * @param {{ force?: boolean }} [options]
 */
export async function fetchCurrentUser(domainInput, options = {}) {
  const domain = normalizeDomainOrEmpty(domainInput);
  if (!domain) return { ok: false, result: null };

  if (!options.force) {
    const cached = currentUserFailureCache.get(domain);
    if (cached && Date.now() - cached.at < CURRENT_USER_FAIL_TTL_MS) {
      return { ok: false, result: cached.result, cached: true };
    }
  }

  try {
    const result = await adminApiFetch(domainInput, `${ADMIN_API_PREFIX}/current_user`);
    if (!result.ok) {
      currentUserFailureCache.set(domain, { at: Date.now(), result });
      return { ok: false, result };
    }
    currentUserFailureCache.delete(domain);
    const user = result.data && typeof result.data === "object" ? result.data : null;
    if (!isValidAdminUser(user)) {
      currentUserFailureCache.set(domain, { at: Date.now(), result });
      return { ok: false, result };
    }
    return { ok: true, user, result };
  } catch (err) {
    const message = String(err?.message || err);
    if (shouldCacheCurrentUserFailure(err)) {
      currentUserFailureCache.set(domain, {
        at: Date.now(),
        result: { ok: false, error: message },
      });
    }
    throw err;
  }
}

/**
 * @param {string} domainInput
 * @param {{ force?: boolean }} [options]
 */
export async function getAuthStatus(domainInput, options = {}) {
  const domain = normalizeDomainOrEmpty(domainInput);
  if (!domain) {
    return {
      domain: "",
      authenticated: false,
      pendingOtp: false,
      awaitingMagicLink: false,
      email: null,
      error: "Домен не задан",
    };
  }

  const stored = await getStoredAuthSession(domain);
  const pendingOtp = await hasPendingOtpFlow(domain);
  const awaitingMagicLink = await isAwaitingMagicLink(domain);
  const verified = sessionIsVerified(stored);

  if (!verified && !pendingOtp) {
    return {
      domain,
      authenticated: false,
      pendingOtp: false,
      awaitingMagicLink,
      email: stored?.email ?? null,
    };
  }

  if (stored?.value) {
    await ensureBrowserSessionCookie(domain);
  }

  if (pendingOtp && !verified) {
    return {
      domain,
      authenticated: false,
      pendingOtp: true,
      awaitingMagicLink: false,
      email: stored?.email ?? null,
    };
  }

  try {
    const { ok, user, cached } = await fetchCurrentUser(domain, { force: options.force });
    if (!ok || !isValidAdminUser(user)) {
      const cachedResult = cached ? currentUserFailureCache.get(domain)?.result : null;
      const fetchError =
        cachedResult && typeof cachedResult === "object" && cachedResult.error
          ? formatAuthFetchError(cachedResult.error, domain)
          : undefined;
      return {
        domain,
        authenticated: false,
        pendingOtp: pendingOtp && Boolean(stored?.value),
        awaitingMagicLink: false,
        email: stored?.email ?? null,
        error: fetchError,
        cached: Boolean(cached),
      };
    }

    const cookie = await readBrowserSessionCookie(domain);
    const email = user.email ? String(user.email) : stored?.email ?? null;
    await saveStoredAuthSession(domain, {
      value: stored?.value || cookie?.value,
      email,
      userId: user.id != null ? Number(user.id) : undefined,
      verified: true,
    });

    await clearPendingOtpFlow(domain);
    await clearAwaitingMagicLink(domain);

    return {
      domain,
      authenticated: true,
      pendingOtp: false,
      awaitingMagicLink: false,
      email,
      user,
    };
  } catch (err) {
    return {
      domain,
      authenticated: false,
      pendingOtp: pendingOtp && Boolean(stored?.value),
      awaitingMagicLink: false,
      email: stored?.email ?? null,
      error: formatAuthFetchError(err, domain),
    };
  }
}

export async function sendMagicLoginInstructions(domainInput, email) {
  const normalizedEmail = String(email || "").trim();
  if (!normalizedEmail) throw new Error("Укажите email");

  return adminApiFetch(
    domainInput,
    `${ADMIN_API_PREFIX}/auth/send_magic_login_instructions`,
    "POST",
    { email: normalizedEmail },
    { skipCookieSync: false }
  );
}

export async function magicLogin(domainInput, token) {
  const normalizedToken = String(token || "").trim();
  if (!normalizedToken) throw new Error("Укажите token из magic link");

  const result = await adminApiFetch(
    domainInput,
    `${ADMIN_API_PREFIX}/auth/magic_login`,
    "POST",
    { token: normalizedToken }
  );

  await syncSessionFromBrowser(domainInput, { force: true });
  if (result.ok) {
    await setPendingOtpFlow(domainInput);
  } else {
    await clearPendingOtpFlow(domainInput);
  }
  return result;
}

export async function verifyOtp(domainInput, otpAttempt) {
  const code = String(otpAttempt || "").trim();
  if (!code) throw new Error("Укажите OTP-код");

  const result = await adminApiFetch(
    domainInput,
    `${ADMIN_API_PREFIX}/otp/verify`,
    "POST",
    { otp_attempt: code },
    { refererPage: otpVerifyReferer(domainInput) }
  );

  await syncSessionFromBrowser(domainInput, { force: true });

  if (!result.ok) {
    return { ...result, authStatus: null };
  }

  clearCurrentUserFailureCache(domainInput);
  const status = await getAuthStatus(domainInput, { force: true });
  return { ...result, authStatus: status };
}

export async function logoutAdmin(domainInput) {
  try {
    await adminApiFetch(domainInput, `${ADMIN_API_PREFIX}/auth/logout`, "GET");
  } catch {
    /* logout endpoint may fail if session already expired */
  }
  clearCurrentUserFailureCache(domainInput);
  await clearPendingOtpFlow(domainInput);
  await clearStoredAuthSession(domainInput);
  await removeBrowserSessionCookie(domainInput);
  return { ok: true };
}

/** Popup / pages: RPC через background. */
export function sendAuthMessage(action, payload, timeoutMs = AUTH_MESSAGE_TIMEOUT_MS) {
  return withTimeout(
    chrome.runtime.sendMessage({ action, payload }),
    timeoutMs,
    "AUTH_MESSAGE_TIMEOUT"
  );
}
