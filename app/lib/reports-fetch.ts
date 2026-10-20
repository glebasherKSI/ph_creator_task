/**
 * Загрузка отчётов Reports из service worker: запросы идут в контексте открытой вкладки
 * reports.maxbit.private (нужны её cookie и XSRF-токен). Только background.
 */
import { browser } from "wxt/browser";

import {
  REPORTS_ENDPOINT,
  REPORTS_FETCH_ERRORS,
  REPORTS_ORIGIN,
  REPORTS_STATE_ENDPOINT,
  SET_ACTIVE_PROJECT_ENDPOINT,
} from "./reports";

export interface ReportsFetchResult {
  ok: boolean;
  status?: number;
  url?: string;
  data?: unknown;
  headers?: Record<string, string>;
  error?: string;
  errorCode?: string;
}

type ReportsBody = Record<string, unknown>;

async function resolveReportsAuthCookies() {
  const targetUrl = `${REPORTS_ORIGIN}/`;
  const [xsrfCookie, sessionCookie] = await Promise.all([
    browser.cookies.get({ url: targetUrl, name: "XSRF-TOKEN" }),
    browser.cookies.get({ url: targetUrl, name: "reports_session" }),
  ]);
  return { xsrfCookie, sessionCookie };
}

async function findReportsTab() {
  const tabs = await browser.tabs.query({ url: `${REPORTS_ORIGIN}/*` });
  if (!tabs.length) return null;
  return tabs.find((tab) => tab.active) || tabs[0] || null;
}

/** Выполняется ВНУТРИ страницы Reports (MAIN world): fetch с её cookie и XSRF-токеном. */
async function reportsPageFetch(
  endpoint: string,
  requestBody: unknown,
  httpMethod: string,
): Promise<ReportsFetchResult> {
  const getCookieValue = (name: string): string => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
    return match?.[1] ? decodeURIComponent(match[1]) : "";
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
    const headers: Record<string, string> = {
      Accept: "application/json, text/plain, */*",
      "X-XSRF-TOKEN": xsrfToken,
    };
    const requestInit: RequestInit = { method, credentials: "include", headers };
    if (hasBody) {
      headers["Content-Type"] = "application/json";
      requestInit.body = JSON.stringify(requestBody || {});
    }

    const response = await fetch(endpoint, requestInit);
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
    return { ok: false, error: String((err as Error)?.message || err) };
  }
}

async function fetchInReportsPageContext(
  tabId: number,
  endpoint: string,
  body: unknown,
  method = "POST",
): Promise<ReportsFetchResult | undefined> {
  const [scriptResult] = await browser.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: reportsPageFetch,
    args: [endpoint, body ?? null, method ?? "POST"],
  });
  return scriptResult?.result as ReportsFetchResult | undefined;
}

function throwIfFailed(result: ReportsFetchResult | undefined): ReportsFetchResult {
  if (!result) throw new Error(REPORTS_FETCH_ERRORS.SCRIPT_FAILED);
  if (!result.ok && result.errorCode) throw new Error(result.errorCode);
  if (!result.ok) throw new Error(REPORTS_FETCH_ERRORS.SCRIPT_FAILED);
  return result;
}

/**
 * Reports фильтрует данные по «активному проекту», который хранится в серверной
 * сессии, а не берётся из тела запроса отчёта. UI Reports переключает его через
 * POST /set-active-project { project_id }. Повторяем этот вызов, чтобы выбирать
 * проект целиком из расширения (иначе отчёт возвращает агрегат --ALL--).
 */
async function setActiveReportsProject(tabId: number, projectId: unknown): Promise<void> {
  const numericId = Number(String(projectId ?? "").trim());
  if (!Number.isInteger(numericId) || numericId <= 0) return;
  throwIfFailed(
    await fetchInReportsPageContext(tabId, SET_ACTIVE_PROJECT_ENDPOINT, { project_id: numericId }),
  );
}

export type ReportsPageFetcher = (pageBody: ReportsBody) => Promise<ReportsFetchResult | undefined>;

/**
 * Собирает все страницы отчёта (perPage из тела, максимум 100 страниц)
 * в один результат с объединёнными rows и countAll.
 */
export async function collectReportsPages(
  body: ReportsBody,
  fetchPage: ReportsPageFetcher,
): Promise<ReportsFetchResult> {
  const perPage = Number(body.perPage) > 0 ? Number(body.perPage) : 500;
  const allRows: unknown[] = [];
  let currentPage = 1;
  let countAll: number | null = null;
  let lastResult: ReportsFetchResult | null = null;
  let lastData: Record<string, unknown> = {};

  while (currentPage <= 100) {
    const result = throwIfFailed(await fetchPage({ ...body, currentPage, perPage }));
    const data =
      result.data && typeof result.data === "object"
        ? (result.data as Record<string, unknown>)
        : {};
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
    ok: lastResult?.ok ?? true,
    data: { ...lastData, rows: allRows, countAll: countAll ?? allRows.length },
  };
}

function rethrowAsReportsError(err: unknown): never {
  if (String((err as Error)?.message || err).startsWith("REPORTS_")) throw err;
  throw new Error(REPORTS_FETCH_ERRORS.SCRIPT_FAILED, { cause: err });
}

export async function handleReportsFetch(payload: {
  body?: ReportsBody;
}): Promise<ReportsFetchResult> {
  const body = payload?.body || {};
  const { sessionCookie } = await resolveReportsAuthCookies();
  if (!sessionCookie?.value) throw new Error(REPORTS_FETCH_ERRORS.SESSION_MISSING);

  const reportsTab = await findReportsTab();
  if (!reportsTab?.id) throw new Error(REPORTS_FETCH_ERRORS.TAB_REQUIRED);
  const tabId = reportsTab.id;

  try {
    await setActiveReportsProject(tabId, body.project_id);
    return await collectReportsPages(body, (pageBody) =>
      fetchInReportsPageContext(tabId, REPORTS_ENDPOINT, pageBody),
    );
  } catch (err) {
    rethrowAsReportsError(err);
  }
}

/** Список проектов и активный проект: GET /state/0 в контексте вкладки Reports. */
export async function handleReportsState(): Promise<ReportsFetchResult> {
  const { sessionCookie } = await resolveReportsAuthCookies();
  if (!sessionCookie?.value) throw new Error(REPORTS_FETCH_ERRORS.SESSION_MISSING);

  const reportsTab = await findReportsTab();
  if (!reportsTab?.id) throw new Error(REPORTS_FETCH_ERRORS.TAB_REQUIRED);

  try {
    const result = await fetchInReportsPageContext(
      reportsTab.id,
      REPORTS_STATE_ENDPOINT,
      null,
      "GET",
    );
    if (!result) throw new Error(REPORTS_FETCH_ERRORS.SCRIPT_FAILED);
    if (!result.ok && result.errorCode) throw new Error(result.errorCode);
    return result;
  } catch (err) {
    rethrowAsReportsError(err);
  }
}

export interface ReportsStatus {
  ok: true;
  origin: string;
  /** Cookie reports_session есть — пользователь залогинен в Reports. */
  sessionPresent: boolean;
  xsrfPresent: boolean;
  /** Открыта вкладка Reports — через неё идут запросы. */
  tabOpen: boolean;
  tabId: number | null;
}

/** Быстрая проверка готовности Reports: cookies + вкладка, без сетевых запросов. */
export async function getReportsStatus(): Promise<ReportsStatus> {
  const [{ xsrfCookie, sessionCookie }, tab] = await Promise.all([
    resolveReportsAuthCookies(),
    findReportsTab(),
  ]);
  return {
    ok: true,
    origin: REPORTS_ORIGIN,
    sessionPresent: Boolean(sessionCookie?.value),
    xsrfPresent: Boolean(xsrfCookie?.value),
    tabOpen: Boolean(tab?.id),
    tabId: tab?.id ?? null,
  };
}

export function reportsErrorResponse(err: unknown): ReportsFetchResult {
  const message = String((err as Error)?.message || err);
  return {
    ok: false,
    error: message,
    errorCode: message.startsWith("REPORTS_") ? message : undefined,
  };
}
