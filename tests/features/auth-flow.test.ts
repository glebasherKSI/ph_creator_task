import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import {
  formatAuthModalError,
  formatDomainAuthLabel,
  initialModalView,
  isAuthError,
  isAuthenticatedStatus,
  isDomainAuthenticated,
  parseMagicLinkToken,
  queryDomainAuthStatus,
  resetAuthStatusCache,
  sendMagicLink,
  shouldOfferOpenAdmin,
  submitMagicLogin,
  submitOtp,
} from "@/features/auth/auth-flow";
import { AUTH_FETCH_ERRORS } from "@/lib/auth/errors";
import { isAwaitingMagicLink, setAwaitingMagicLink } from "@/lib/auth/session-store";
import type { AuthStatus } from "@/lib/auth/status";
import { type MessageHandlers, type MessageMap, createMessageRouter } from "@/lib/messaging";

import * as legacy from "legacy/auth-modal.js";

const DOMAIN = "admin.example.com";

function authed(overrides: Partial<AuthStatus> = {}): AuthStatus {
  return {
    domain: DOMAIN,
    authenticated: true,
    pendingOtp: false,
    awaitingMagicLink: false,
    email: "user@example.com",
    user: { id: 7, email: "user@example.com" },
    ...overrides,
  };
}

function anonymous(overrides: Partial<AuthStatus> = {}): AuthStatus {
  return {
    domain: DOMAIN,
    authenticated: false,
    pendingOtp: false,
    awaitingMagicLink: false,
    email: null,
    ...overrides,
  };
}

/** Эмулирует background: типизированные обработчики поверх fake-browser. */
function mockBackground(handlers: MessageHandlers<MessageMap>) {
  fakeBrowser.runtime.onMessage.addListener(createMessageRouter<MessageMap>(handlers));
}

beforeEach(() => {
  fakeBrowser.reset();
  resetAuthStatusCache();
});

describe("queryDomainAuthStatus", () => {
  it("возвращает статус background; isDomainAuthenticated учитывает pendingOtp", async () => {
    const handler = vi.fn(async () => ({ ok: true as const, ...authed() }));
    mockBackground({ PH_AUTH_STATUS: handler });

    const status = await queryDomainAuthStatus(` ${DOMAIN} `, { force: true });
    expect(handler).toHaveBeenCalledWith({ domain: DOMAIN, force: true }, expect.anything());
    expect(status).toMatchObject({
      domain: DOMAIN,
      authenticated: true,
      email: "user@example.com",
    });
    expect(status).not.toHaveProperty("ok");
    expect(isDomainAuthenticated(status)).toBe(true);
    expect(isAuthenticatedStatus(status)).toBe(true);

    expect(isDomainAuthenticated(authed({ pendingOtp: true }))).toBe(false);
    expect(isDomainAuthenticated(authed({ email: null, user: undefined }))).toBe(false);
    expect(isDomainAuthenticated(authed({ email: null, user: { id: 1 } }))).toBe(true);
    expect(isDomainAuthenticated(anonymous())).toBe(false);
    expect(isDomainAuthenticated(null)).toBe(false);
  });

  it("троттлит повторные запросы и отдаёт кэш с throttled; force обходит", async () => {
    const handler = vi.fn(async () => ({ ok: true as const, ...anonymous() }));
    mockBackground({ PH_AUTH_STATUS: handler });

    await queryDomainAuthStatus(DOMAIN);
    const cached = await queryDomainAuthStatus(DOMAIN);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(cached).toMatchObject({ domain: DOMAIN, authenticated: false, throttled: true });

    await queryDomainAuthStatus(DOMAIN, { force: true });
    expect(handler).toHaveBeenCalledTimes(2);

    const other = await queryDomainAuthStatus("other.example.com");
    expect(handler).toHaveBeenCalledTimes(3);
    expect(other.throttled).toBeUndefined();
  });

  it("ошибка background → статус с error/errorCode", async () => {
    mockBackground({
      PH_AUTH_STATUS: async () => ({
        ok: false,
        error: "Откройте админку",
        errorCode: AUTH_FETCH_ERRORS.TAB_REQUIRED,
      }),
    });
    const status = await queryDomainAuthStatus(DOMAIN, { force: true });
    expect(status).toEqual({
      domain: DOMAIN,
      authenticated: false,
      pendingOtp: false,
      awaitingMagicLink: false,
      error: "Откройте админку",
      errorCode: AUTH_FETCH_ERRORS.TAB_REQUIRED,
    });
    expect(formatDomainAuthLabel(status)).toBe("ошибка входа");
  });

  it("ответ про другой домен — ошибка несовпадения", async () => {
    mockBackground({
      PH_AUTH_STATUS: async () => ({ ok: true, ...authed({ domain: "evil.example.com" }) }),
    });
    const status = await queryDomainAuthStatus(DOMAIN, { force: true });
    expect(status.authenticated).toBe(false);
    expect(status.error).toBe("Ответ проверки входа не совпадает с доменом");
  });

  it("таймаут RPC → TAB_REQUIRED с подсказкой открыть админку", async () => {
    vi.useFakeTimers();
    try {
      fakeBrowser.runtime.onMessage.addListener(() => true); // background молчит
      const promise = queryDomainAuthStatus(DOMAIN, { force: true });
      await vi.advanceTimersByTimeAsync(20_000);
      const status = await promise;
      expect(status.errorCode).toBe(AUTH_FETCH_ERRORS.TAB_REQUIRED);
      expect(status.error).toContain("Превышено время ожидания");
      expect(shouldOfferOpenAdmin(status)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("sendMagicLink", () => {
  it("успех: письмо отправлено, флаг ожидания magic link выставлен", async () => {
    const handler = vi.fn(async () => ({ ok: true }));
    mockBackground({ PH_AUTH_SEND_MAGIC_LINK: handler });

    expect(await isAwaitingMagicLink(DOMAIN)).toBe(false);
    const result = await sendMagicLink(DOMAIN, " user@example.com ");
    expect(result).toEqual({ ok: true });
    expect(handler).toHaveBeenCalledWith(
      { domain: DOMAIN, email: "user@example.com" },
      expect.anything(),
    );
    expect(await isAwaitingMagicLink(DOMAIN)).toBe(true);
  });

  it("пустой email — без запроса", async () => {
    const handler = vi.fn(async () => ({ ok: true }));
    mockBackground({ PH_AUTH_SEND_MAGIC_LINK: handler });
    expect(await sendMagicLink(DOMAIN, "  ")).toEqual({
      ok: false,
      message: "Укажите email",
      showOpenAdmin: false,
    });
    expect(handler).not.toHaveBeenCalled();
    expect(await isAwaitingMagicLink(DOMAIN)).toBe(false);
  });

  it("ошибка background (SSL) — сообщение как есть и кнопка «Открыть админку»", async () => {
    mockBackground({
      PH_AUTH_SEND_MAGIC_LINK: async () => ({
        ok: false,
        error: "Ошибка SSL-сертификата.",
        errorCode: AUTH_FETCH_ERRORS.SSL_ERROR,
      }),
    });
    expect(await sendMagicLink(DOMAIN, "user@example.com")).toEqual({
      ok: false,
      message: "Ошибка SSL-сертификата.",
      showOpenAdmin: true,
    });
    expect(await isAwaitingMagicLink(DOMAIN)).toBe(false);
  });

  it("ответ без ok и без текста — запасное сообщение", async () => {
    mockBackground({ PH_AUTH_SEND_MAGIC_LINK: async () => ({ ok: false }) as never });
    expect(await sendMagicLink(DOMAIN, "user@example.com")).toMatchObject({
      ok: false,
      message: "Не удалось отправить magic link",
    });
  });
});

describe("submitMagicLogin", () => {
  it("успех: token из URL, флаг ожидания снят", async () => {
    const handler = vi.fn(async () => ({ ok: true }));
    mockBackground({ PH_AUTH_MAGIC_LOGIN: handler });
    await setAwaitingMagicLink(DOMAIN);

    const url = `https://${DOMAIN}/admin/-/auth/magic-login?token=-BLvXB5CpiL8jxHJFQks`;
    expect(await submitMagicLogin(DOMAIN, url)).toEqual({ ok: true });
    expect(handler).toHaveBeenCalledWith(
      { domain: DOMAIN, token: "-BLvXB5CpiL8jxHJFQks" },
      expect.anything(),
    );
    expect(await isAwaitingMagicLink(DOMAIN)).toBe(false);
  });

  it("голый token передаётся как есть; пустой — ошибка без запроса", async () => {
    const handler = vi.fn(async () => ({ ok: true }));
    mockBackground({ PH_AUTH_MAGIC_LOGIN: handler });

    expect(parseMagicLinkToken(" abc ")).toBe("abc");
    expect(parseMagicLinkToken("https://x.test/other?token=zzz")).toBe(
      "https://x.test/other?token=zzz",
    );
    await submitMagicLogin(DOMAIN, " abc ");
    expect(handler).toHaveBeenLastCalledWith({ domain: DOMAIN, token: "abc" }, expect.anything());

    expect(await submitMagicLogin(DOMAIN, "")).toEqual({
      ok: false,
      message: "Вставьте token из magic link",
      showOpenAdmin: false,
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("провал: флаг ожидания остаётся, сообщение из ответа", async () => {
    mockBackground({
      PH_AUTH_MAGIC_LOGIN: async () => ({ ok: false, status: 422, error: "Token истёк" }),
    });
    await setAwaitingMagicLink(DOMAIN);
    expect(await submitMagicLogin(DOMAIN, "abc")).toEqual({
      ok: false,
      message: "Token истёк",
      showOpenAdmin: false,
    });
    expect(await isAwaitingMagicLink(DOMAIN)).toBe(true);
  });

  it("исключение в background → formatAuthFetchError", async () => {
    mockBackground({
      PH_AUTH_MAGIC_LOGIN: async () => {
        throw new Error("Failed to fetch");
      },
    });
    const result = await submitMagicLogin(DOMAIN, "abc");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe("Failed to fetch");
      expect(result.showOpenAdmin).toBe(false);
    }
  });
});

describe("submitOtp", () => {
  it("успех → authStatus с выполненным входом", async () => {
    const handler = vi.fn(async () => ({ ok: true, status: 200, authStatus: authed() }));
    mockBackground({ PH_AUTH_VERIFY_OTP: handler });

    const result = await submitOtp(DOMAIN, " 094855 ");
    expect(handler).toHaveBeenCalledWith({ domain: DOMAIN, otp: "094855" }, expect.anything());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(isAuthenticatedStatus(result.authStatus)).toBe(true);
      expect(result.authStatus.email).toBe("user@example.com");
    }
  });

  it("пустой код — ошибка без запроса", async () => {
    const handler = vi.fn(async () => ({ ok: true, authStatus: authed() }));
    mockBackground({ PH_AUTH_VERIFY_OTP: handler });
    expect(await submitOtp(DOMAIN, "")).toEqual({
      ok: false,
      message: "Укажите OTP-код",
      showOpenAdmin: false,
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("OTP отклонён / сессия не подтверждена / проверка сессии упала", async () => {
    mockBackground({
      PH_AUTH_VERIFY_OTP: async () => ({ ok: false, status: 401, error: "Неверный код" }),
    });
    expect(await submitOtp(DOMAIN, "1")).toMatchObject({ ok: false, message: "Неверный код" });

    fakeBrowser.reset();
    mockBackground({ PH_AUTH_VERIFY_OTP: async () => ({ ok: true, authStatus: null }) });
    expect(await submitOtp(DOMAIN, "1")).toEqual({
      ok: false,
      message: "OTP принят, но вход не подтверждён — повторите попытку",
      showOpenAdmin: false,
    });

    fakeBrowser.reset();
    mockBackground({
      PH_AUTH_VERIFY_OTP: async () => ({
        ok: true,
        authStatus: anonymous({ error: "Вкладка админки показывает страницу ошибки" }),
      }),
    });
    expect(await submitOtp(DOMAIN, "1")).toEqual({
      ok: false,
      message: "Вкладка админки показывает страницу ошибки",
      showOpenAdmin: true,
    });
  });
});

describe("ошибки и подписи", () => {
  it("formatAuthModalError: error ответа как есть, иначе formatAuthFetchError по коду", () => {
    expect(formatAuthModalError({ ok: false, error: "Текст" }, DOMAIN)).toEqual({
      message: "Текст",
      showOpenAdmin: false,
    });
    const byCode = formatAuthModalError(new Error(AUTH_FETCH_ERRORS.TAB_REQUIRED), DOMAIN);
    expect(byCode.message).toContain(`https://${DOMAIN}`);
    expect(byCode.showOpenAdmin).toBe(true);
    expect(formatAuthModalError(new Error("AUTH_MESSAGE_TIMEOUT"), DOMAIN)).toEqual({
      message: "AUTH_MESSAGE_TIMEOUT",
      showOpenAdmin: false,
    });
  });

  it("shouldOfferOpenAdmin: по коду и по тексту", () => {
    expect(shouldOfferOpenAdmin({ errorCode: AUTH_FETCH_ERRORS.TAB_ERROR_PAGE })).toBe(true);
    expect(shouldOfferOpenAdmin({ error: "примите сертификат" })).toBe(true);
    expect(shouldOfferOpenAdmin({ message: "откройте вкладку" })).toBe(true);
    expect(shouldOfferOpenAdmin("AUTH_TAB_REQUIRED")).toBe(true);
    expect(shouldOfferOpenAdmin({ error: "Неверный код" })).toBe(false);
    expect(shouldOfferOpenAdmin(null)).toBe(false);
  });

  const AUTH_ERRORS = [
    new Error("HTTP 403"),
    new Error("Ошибка 401"),
    new Error("Вы не подтверждены"),
    new Error("Требуется вход в админку"),
    new Error("AUTH_TAB_REQUIRED"),
    "magic link expired",
    { message: "Превышено время ожидания" },
    new Error("host_permissions missing"),
  ];
  const OTHER_ERRORS = [new Error("HTTP 500"), "Сервер недоступен", null, undefined, 42];

  it.each([...AUTH_ERRORS, ...OTHER_ERRORS])("isAuthError(%o) — паритет со старым кодом", (err) => {
    expect(isAuthError(err)).toBe(legacy.isAuthError(err));
  });
  it("isAuthError: распознаёт auth-ошибки и не трогает прочие", () => {
    for (const err of AUTH_ERRORS) expect(isAuthError(err)).toBe(true);
    for (const err of OTHER_ERRORS) expect(isAuthError(err)).toBe(false);
  });

  const LABEL_CASES = [
    null,
    authed(),
    authed({ email: null }),
    anonymous({ pendingOtp: true }),
    anonymous({ awaitingMagicLink: true }),
    anonymous({ error: "x" }),
    anonymous(),
  ];
  it.each(LABEL_CASES)("formatDomainAuthLabel(%o) — паритет", (status) => {
    expect(formatDomainAuthLabel(status)).toBe(legacy.formatDomainAuthLabel(status));
    expect(formatDomainAuthLabel(status, { forIndicator: true })).toBe(
      legacy.formatDomainAuthLabel(status, { forIndicator: true }),
    );
    expect(isDomainAuthenticated(status)).toBe(legacy.isDomainAuthenticated(status));
  });
  it("formatDomainAuthLabel: тексты", () => {
    expect(formatDomainAuthLabel(authed())).toBe("вход: user@example.com");
    expect(formatDomainAuthLabel(authed({ email: null }))).toBe("вход выполнен");
    expect(formatDomainAuthLabel(anonymous({ pendingOtp: true }))).toBe("ожидание OTP");
    expect(formatDomainAuthLabel(anonymous({ awaitingMagicLink: true }))).toBe(
      "ожидание magic link",
    );
    expect(formatDomainAuthLabel(anonymous({ error: "x" }))).toBe("ошибка входа");
    expect(formatDomainAuthLabel(anonymous({ error: "x" }), { forIndicator: true })).toBe(
      "нет входа",
    );
  });
});

describe("initialModalView", () => {
  it("pendingOtp → сразу шаг OTP", () => {
    const view = initialModalView(DOMAIN, anonymous({ pendingOtp: true, email: "u@x.test" }));
    expect(view).toMatchObject({
      step: "otp",
      submittedMagicLogin: true,
      email: "u@x.test",
      message: "Завершите вход — введите OTP из письма",
    });
    expect(view.status.text).toBe("Magic link принят — введите OTP из письма");
  });

  it("ошибка статуса → шаг email с текстом ошибки; свой message имеет приоритет", () => {
    const view = initialModalView(
      DOMAIN,
      { ...anonymous({ error: "Откройте админку" }), errorCode: AUTH_FETCH_ERRORS.TAB_REQUIRED },
      { message: "Для загрузки задач нужен вход в админку" },
    );
    expect(view.step).toBe("email");
    expect(view.status).toEqual({
      text: "Откройте админку",
      tone: "error",
      showOpenAdmin: true,
    });
    expect(view.message).toBe("Для загрузки задач нужен вход в админку");
  });

  it("нет входа → шаг email с подсказкой", () => {
    const view = initialModalView(DOMAIN, anonymous());
    expect(view.step).toBe("email");
    expect(view.status).toEqual({
      text: `Шаг 1: отправьте magic link на email (${DOMAIN})`,
      tone: "idle",
      showOpenAdmin: false,
    });
    expect(view.message).toBe("Для работы с API нужен вход в админку");
    expect(view.email).toBe("");
  });
});
