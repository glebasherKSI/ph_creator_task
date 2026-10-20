/**
 * Сообщения между страницами расширения и background.
 * Полный типизированный реестр действий заполняется на этапе 3 (перенос background.js);
 * здесь — транспорт с таймаутом, общий для popup/страниц.
 */
import { browser } from "wxt/browser";

import { AUTH_MESSAGE_TIMEOUT_MS, withTimeout } from "./auth/errors";

export interface RuntimeMessage<TPayload = unknown> {
  action: string;
  payload?: TPayload;
}

/** RPC в background с таймаутом; при таймауте бросает Error("AUTH_MESSAGE_TIMEOUT"). */
export function sendAuthMessage<TResponse = unknown, TPayload = unknown>(
  action: string,
  payload?: TPayload,
  timeoutMs: number = AUTH_MESSAGE_TIMEOUT_MS,
): Promise<TResponse> {
  const message: RuntimeMessage<TPayload> = { action, payload };
  return withTimeout(
    browser.runtime.sendMessage(message) as Promise<TResponse>,
    timeoutMs,
    "AUTH_MESSAGE_TIMEOUT",
  );
}
