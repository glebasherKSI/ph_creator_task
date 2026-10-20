/**
 * Типизированные сообщения между страницами расширения, background и content-script.
 * Реестр действий — единственное место, где описаны payload и response каждого сообщения.
 */
import { browser, type Browser } from "wxt/browser";

import type { AdminFetchOptions, AdminFetchResult } from "./auth/admin-fetch";
import { AUTH_MESSAGE_TIMEOUT_MS, withTimeout } from "./auth/errors";
import type { AuthStatus } from "./auth/status";
import type { GraphicAuthPayload, GraphicFetchPayload, GraphicStatus } from "./graphic-api";
import type { ReportsFetchResult, ReportsStatus } from "./reports-fetch";

export interface ErrorResponse {
  ok: false;
  error: string;
  errorCode?: string;
}

export type AuthStatusResponse = ({ ok: true } & AuthStatus) | ErrorResponse;

/** Сообщения в background (browser.runtime.sendMessage). `type`, а не `interface` — ради индексной сигнатуры. */
export type MessageMap = {
  PH_AUTH_STATUS: {
    payload: { domain: string; force?: boolean };
    response: AuthStatusResponse;
  };
  PH_AUTH_SEND_MAGIC_LINK: {
    payload: { domain: string; email: string };
    response: AdminFetchResult | ErrorResponse;
  };
  PH_AUTH_MAGIC_LOGIN: {
    payload: { domain: string; token: string };
    response: AdminFetchResult | ErrorResponse;
  };
  PH_AUTH_VERIFY_OTP: {
    payload: { domain: string; otp: string };
    response: (AdminFetchResult & { authStatus: AuthStatus | null }) | ErrorResponse;
  };
  PH_AUTH_LOGOUT: {
    payload: { domain: string };
    response: { ok: true } | ErrorResponse;
  };
  PH_ADMIN_API_FETCH: {
    payload: {
      domain: string;
      path: string;
      method?: string;
      body?: unknown;
      options?: AdminFetchOptions;
    };
    response: AdminFetchResult | ErrorResponse;
  };
  PH_REPORTS_FETCH: {
    payload: { body?: Record<string, unknown> };
    response: ReportsFetchResult | ErrorResponse;
  };
  PH_REPORTS_STATE: {
    payload: undefined;
    response: ReportsFetchResult | ErrorResponse;
  };
  PH_REPORTS_STATUS: {
    payload: undefined;
    response: ReportsStatus | ErrorResponse;
  };
  PH_GRAPHIC_AUTH: {
    payload: GraphicAuthPayload;
    response: GraphicStatus | { ok: boolean; baseUrl?: string; error?: string };
  };
  PH_GRAPHIC_FETCH: {
    payload: GraphicFetchPayload;
    response: { ok: boolean; data?: unknown; error?: string };
  };
};

export type MessageAction = keyof MessageMap;

/** Сообщения во вкладку админки (browser.tabs.sendMessage → content-script). */
export type TabMessageMap = {
  PING: {
    payload: undefined;
    response: { ok: true; host: string; origin: string };
  };
  PH_API_FETCH: {
    payload: { path: string; method?: string; body?: unknown; headers?: Record<string, string> };
    response: TabApiResponse;
  };
};

export type TabMessageAction = keyof TabMessageMap;

export interface TabApiResponse {
  ok: boolean;
  status?: number;
  url?: string;
  data?: unknown;
  headers?: Record<string, string>;
  error?: string;
}

export interface RuntimeMessage<A extends string = string, P = unknown> {
  action: A;
  payload?: P;
}

export function isRuntimeMessage(value: unknown): value is RuntimeMessage {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { action?: unknown }).action === "string"
  );
}

// ---------------------------------------------------------------------------
// Отправка
// ---------------------------------------------------------------------------

/** RPC в background с таймаутом; при таймауте бросает Error с `timeoutMessage`. */
export function sendMessage<A extends MessageAction>(
  action: A,
  payload: MessageMap[A]["payload"],
  { timeoutMs = AUTH_MESSAGE_TIMEOUT_MS, timeoutMessage = "AUTH_MESSAGE_TIMEOUT" } = {},
): Promise<MessageMap[A]["response"]> {
  const message: RuntimeMessage<A, MessageMap[A]["payload"]> = { action, payload };
  return withTimeout(
    browser.runtime.sendMessage(message) as Promise<MessageMap[A]["response"]>,
    timeoutMs,
    timeoutMessage,
  );
}

/** Совместимость со старым именем: `sendAuthMessage(action, payload, timeoutMs)`. */
export function sendAuthMessage<A extends MessageAction>(
  action: A,
  payload: MessageMap[A]["payload"],
  timeoutMs: number = AUTH_MESSAGE_TIMEOUT_MS,
): Promise<MessageMap[A]["response"]> {
  return sendMessage(action, payload, { timeoutMs });
}

export function sendTabMessage<A extends TabMessageAction>(
  tabId: number,
  action: A,
  payload: TabMessageMap[A]["payload"],
): Promise<TabMessageMap[A]["response"]> {
  const message: RuntimeMessage<A, TabMessageMap[A]["payload"]> = { action, payload };
  return browser.tabs.sendMessage(tabId, message) as Promise<TabMessageMap[A]["response"]>;
}

// ---------------------------------------------------------------------------
// Приём (background / content-script)
// ---------------------------------------------------------------------------

type Sender = Browser.runtime.MessageSender;

export type MessageHandlers<M extends Record<string, { payload: unknown; response: unknown }>> = {
  [A in keyof M]?: (payload: M[A]["payload"], sender: Sender) => Promise<M[A]["response"]>;
};

export type MessageErrorMapper = (action: string, err: unknown, payload: unknown) => unknown;

type OnMessageListener = (
  message: unknown,
  sender: Sender,
  sendResponse: (response?: unknown) => void,
) => true | undefined;

const defaultErrorMapper: MessageErrorMapper = (_action, err) => ({
  ok: false,
  error: err instanceof Error ? err.message : String(err),
});

/**
 * Слушатель onMessage: по `action` вызывает обработчик, ответ или ошибку отдаёт в sendResponse.
 * Неизвестные действия игнорирует (возвращает undefined — канал не удерживается).
 */
export function createMessageRouter<
  M extends Record<string, { payload: unknown; response: unknown }>,
>(
  handlers: MessageHandlers<M>,
  mapError: MessageErrorMapper = defaultErrorMapper,
): OnMessageListener {
  return (message, sender, sendResponse) => {
    if (!isRuntimeMessage(message)) return undefined;
    const handler = handlers[message.action as keyof M];
    if (!handler) return undefined;
    Promise.resolve()
      .then(() => handler(message.payload as M[keyof M]["payload"], sender))
      .then((result) => sendResponse(result))
      .catch((err: unknown) => sendResponse(mapError(message.action, err, message.payload)));
    return true;
  };
}
