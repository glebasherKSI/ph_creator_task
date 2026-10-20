/**
 * Fetch к admin API из service worker.
 * Для *.private и при открытой вкладке админки — через tab context (executeScript, MAIN world),
 * иначе напрямую из service worker с откатом на вкладку при SSL-ошибке.
 * Только для background: использует tabs/scripting.
 */
import { browser, type Browser } from "wxt/browser";

import { ADMIN_AUTH_LOCALE } from "../constants";
import { hostFromUrl, normalizeDomainOrEmpty } from "../domains";
import {
  AUTH_FETCH_ERRORS,
  isChromeErrorPageUrl,
  isSslOrNetworkError,
  isTabErrorPageExecuteScriptError,
  withTimeout,
} from "./errors";
import {
  adminApiUrl,
  ensureBrowserSessionCookie,
  hasDomainHostPermission,
  isPrivateAdminDomain,
  syncSessionFromBrowser,
} from "./session-store";

export interface AdminFetchResult {
  ok: boolean;
  status?: number;
  url?: string;
  data?: unknown;
  headers?: Record<string, string>;
  error?: string;
}

export interface AdminFetchOptions {
  referer?: string | null;
  refererPage?: string | null;
  locale?: string | null;
  skipCookieSync?: boolean;
}

type Tab = Browser.tabs.Tab;

/** Сколько ждём ответа от «пустого» скрипта во вкладке, прежде чем считать её замороженной. */
const TAB_PING_TIMEOUT_MS = 3_000;
const TAB_LOAD_TIMEOUT_MS = 15_000;
/** Один reload на вкладку при параллельных запросах. */
const inflightTabWakeups = new Map<number, Promise<void>>();

/**
 * Вкладка пригодна для tab-context fetch: https URL, не chrome-error, не discarded.
 * Self-signed («Не защищено») — нормально; loading не отбрасываем (ранжируем ниже complete).
 */
function isAdminTabUsable(tab: Tab | null | undefined): boolean {
  if (!tab?.id) return false;
  const url = String(tab.url || "");
  if (!url.startsWith("https://")) return false;
  if (isChromeErrorPageUrl(url)) return false;
  if (tab.discarded) return false;
  return true;
}

function adminTabRank(tab: Tab): number {
  let score = 0;
  if (!isChromeErrorPageUrl(tab.url)) score += 1000;
  if (isAdminTabUsable(tab)) score += 100;
  if (tab.active) score += 50;
  if (String(tab.url || "").includes("/admin")) score += 25;
  if (tab.status === "complete") score += 10;
  return score;
}

async function queryAdminDomainTabs(domain: string): Promise<Tab[]> {
  const byPattern = await browser.tabs.query({ url: `https://${domain}/*` });
  const seen = new Set(byPattern.map((tab) => tab.id));
  const merged = [...byPattern];

  const httpsTabs = await browser.tabs.query({ url: "https://*/*" });
  for (const tab of httpsTabs) {
    if (seen.has(tab.id)) continue;
    if (tab.url && hostFromUrl(tab.url) === domain) {
      merged.push(tab);
      seen.add(tab.id);
    }
  }
  return merged;
}

export async function findAdminTab(domain: string): Promise<Tab | null> {
  const tabs = await queryAdminDomainTabs(domain);
  if (!tabs.length) return null;
  const sorted = [...tabs].sort((a, b) => adminTabRank(b) - adminTabRank(a));
  return sorted[0] ?? null;
}

async function pingTab(tabId: number): Promise<boolean> {
  try {
    await withTimeout(
      browser.scripting.executeScript({ target: { tabId }, world: "MAIN", func: () => true }),
      TAB_PING_TIMEOUT_MS,
    );
    return true;
  } catch (err) {
    if (isTabErrorPageExecuteScriptError(err)) {
      throw new Error(AUTH_FETCH_ERRORS.TAB_ERROR_PAGE, { cause: err });
    }
    return false;
  }
}

function waitForTabComplete(
  tabId: number,
  timeoutMs: number,
  { checkCurrent = true }: { checkCurrent?: boolean } = {},
): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      browser.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    };
    const onUpdated = (id: number, changeInfo: { status?: string }) => {
      if (id === tabId && changeInfo.status === "complete") done();
    };
    const timer = setTimeout(done, timeoutMs);
    browser.tabs.onUpdated.addListener(onUpdated);
    if (!checkCurrent) return;
    browser.tabs.get(tabId).then((tab) => {
      if (tab.status === "complete" && !tab.discarded) done();
    }, done);
  });
}

/** Перезагружает зависшую/выгруженную вкладку админки (раньше это делали руками). */
async function wakeAdminTab(tabId: number): Promise<void> {
  let wakeup = inflightTabWakeups.get(tabId);
  if (!wakeup) {
    wakeup = (async () => {
      // Слушатель ставим до reload: старый статус «complete» не должен засчитаться.
      const loaded = waitForTabComplete(tabId, TAB_LOAD_TIMEOUT_MS, { checkCurrent: false });
      try {
        await browser.tabs.reload(tabId);
      } catch {
        throw new Error(AUTH_FETCH_ERRORS.TAB_REQUIRED);
      }
      await loaded;
      if (!(await pingTab(tabId))) {
        throw new Error(AUTH_FETCH_ERRORS.TAB_UNRESPONSIVE);
      }
    })().finally(() => inflightTabWakeups.delete(tabId));
    inflightTabWakeups.set(tabId, wakeup);
  }
  await wakeup;
}

async function validateAdminTab(tabId: number): Promise<Tab> {
  let tab: Tab;
  try {
    tab = await browser.tabs.get(tabId);
  } catch {
    throw new Error(AUTH_FETCH_ERRORS.TAB_REQUIRED);
  }

  const url = String(tab.url || "");
  if (!url || isChromeErrorPageUrl(url)) {
    throw new Error(AUTH_FETCH_ERRORS.TAB_ERROR_PAGE);
  }

  // Фоновая вкладка может быть выгружена (Memory Saver) или заморожена Chrome —
  // тогда executeScript висит, пока пользователь сам не откроет/обновит вкладку.
  const frozen = (tab as Tab & { frozen?: boolean }).frozen;
  if (tab.discarded || frozen) {
    await wakeAdminTab(tabId);
  } else if (tab.status && tab.status !== "complete") {
    await waitForTabComplete(tabId, TAB_LOAD_TIMEOUT_MS);
  } else if (!(await pingTab(tabId))) {
    await wakeAdminTab(tabId);
  }

  try {
    tab = await browser.tabs.get(tabId);
  } catch {
    throw new Error(AUTH_FETCH_ERRORS.TAB_REQUIRED);
  }
  if (isChromeErrorPageUrl(tab.url)) {
    throw new Error(AUTH_FETCH_ERRORS.TAB_ERROR_PAGE);
  }

  // Не даём Chrome снова выгрузить вкладку, через которую идут запросы.
  if (tab.autoDiscardable !== false) {
    browser.tabs.update(tabId, { autoDiscardable: false }).catch(() => {});
  }
  return tab;
}

/** Аргументы executeScript должны быть JSON-сериализуемыми; undefined — нет. */
function serializeScriptArgs<T extends unknown[]>(...args: T): T {
  return args.map((arg) => (arg === undefined ? null : arg)) as T;
}

/**
 * Выполняется ВНУТРИ страницы админки (MAIN world): fetch с её cookie.
 * Если задан refererPage — fetch идёт из невидимого iframe с этим URL,
 * чтобы Rails увидел нужный Referer (например, для OTP verify).
 */
async function pageContextFetch(
  endpoint: string,
  httpMethod: string,
  requestBody: string | null,
  requestHeaders: Record<string, string>,
  refererPageUrl: string | null,
): Promise<AdminFetchResult> {
  let execWindow: Window = window;
  let refererFrame: HTMLIFrameElement | null = null;

  try {
    if (refererPageUrl) {
      refererFrame = document.createElement("iframe");
      refererFrame.style.cssText =
        "position:fixed;width:0;height:0;border:0;opacity:0;pointer-events:none";
      refererFrame.src = refererPageUrl;
      document.documentElement.appendChild(refererFrame);
      const frame = refererFrame;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("referer iframe timeout")), 15000);
        frame.addEventListener(
          "load",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
        frame.addEventListener(
          "error",
          () => {
            clearTimeout(timer);
            reject(new Error("referer iframe error"));
          },
          { once: true },
        );
      });
      if (refererFrame.contentWindow) execWindow = refererFrame.contentWindow;
    }

    const normalizedMethod = String(httpMethod || "GET").toUpperCase();
    const hasBody =
      normalizedMethod !== "GET" && normalizedMethod !== "HEAD" && requestBody != null;
    const requestInit: RequestInit = {
      method: normalizedMethod,
      credentials: "include",
      headers: { ...requestHeaders },
    };
    if (hasBody) requestInit.body = requestBody;

    const response = await execWindow.fetch(endpoint, requestInit);
    const text = await response.text();
    let data: unknown = text;
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (contentType.includes("application/json")) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    const responseHeaders: Record<string, string> = {};
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
      error: String((err as Error)?.message || err),
    };
  } finally {
    refererFrame?.remove();
  }
}

async function fetchInAdminPageContext(
  tabId: number,
  url: string,
  method: string,
  body: string | null,
  headers: Record<string, string>,
  refererPage: string | null,
): Promise<AdminFetchResult | undefined> {
  try {
    const [scriptResult] = await browser.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: pageContextFetch,
      args: serializeScriptArgs(url, method, body, headers, refererPage),
    });
    return scriptResult?.result as AdminFetchResult | undefined;
  } catch (err) {
    if (isTabErrorPageExecuteScriptError(err)) {
      throw new Error(AUTH_FETCH_ERRORS.TAB_ERROR_PAGE, { cause: err });
    }
    throw err;
  }
}

async function adminApiFetchViaTab(
  domain: string,
  url: string,
  httpMethod: string,
  headers: Record<string, string>,
  fetchBody: string | null,
  options: AdminFetchOptions & { tabId?: number },
): Promise<AdminFetchResult> {
  const tabId = options.tabId ?? (await findAdminTab(domain))?.id;
  if (!tabId) throw new Error(AUTH_FETCH_ERRORS.TAB_REQUIRED);

  await validateAdminTab(tabId);

  const refererPage = options.refererPage || options.referer || null;
  const result = await fetchInAdminPageContext(
    tabId,
    url,
    httpMethod,
    fetchBody,
    headers,
    refererPage,
  );
  if (!result) throw new Error(AUTH_FETCH_ERRORS.SCRIPT_FAILED);
  if (!result.ok && result.error && result.status == null && isSslOrNetworkError(result.error)) {
    throw new Error(AUTH_FETCH_ERRORS.SSL_ERROR);
  }

  if (!options.skipCookieSync) {
    await syncSessionFromBrowser(domain);
  }
  return result;
}

function parseResponseBody(response: Response, text: string): unknown {
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

function collectResponseHeaders(response: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  return headers;
}

async function adminApiFetchViaServiceWorker(
  url: string,
  httpMethod: string,
  headers: Record<string, string>,
  fetchBody: string | null,
): Promise<AdminFetchResult> {
  const response = await fetch(url, {
    method: httpMethod,
    credentials: "include",
    headers,
    body: fetchBody,
  });
  const text = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    url: response.url || url,
    data: parseResponseBody(response, text),
    headers: collectResponseHeaders(response),
    error: response.ok ? undefined : `HTTP ${response.status}`,
  };
}

type Transport = { mode: "tab"; tabId: number } | { mode: "service_worker" };

async function resolveAdminApiTransport(domain: string): Promise<Transport> {
  const tab = await findAdminTab(domain);
  if (tab?.id) return { mode: "tab", tabId: tab.id };
  if (isPrivateAdminDomain(domain)) {
    throw new Error(AUTH_FETCH_ERRORS.TAB_REQUIRED);
  }
  return { mode: "service_worker" };
}

export async function adminApiFetch(
  domainInput: string,
  path: string,
  method = "GET",
  body: unknown = null,
  options: AdminFetchOptions = {},
): Promise<AdminFetchResult> {
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
  const headers: Record<string, string> = {
    Accept: "application/json, text/plain, */*",
    "X-PH-Extension": "1",
  };

  let fetchBody: string | null = null;
  if (body != null && httpMethod !== "GET" && httpMethod !== "HEAD") {
    headers["Content-Type"] = "application/json";
    fetchBody = JSON.stringify(body);
  }

  const tabOptions: AdminFetchOptions = {
    ...options,
    refererPage: options.refererPage || options.referer || null,
  };

  const transport = await resolveAdminApiTransport(domain);
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
