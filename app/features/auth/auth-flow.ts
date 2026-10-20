/**
 * Логика входа в админку (magic link → OTP) без React и DOM.
 * Порт src/shared/auth-modal.js: статус домена с троттлингом, шаги входа поверх background-RPC,
 * флаги незавершённого входа в storage. Модалка (AuthModal.tsx) только рисует состояние отсюда.
 */
import { AUTH_FETCH_ERRORS, formatAuthFetchError } from "@/lib/auth/errors";
import {
  adminTabUrl,
  clearAwaitingMagicLink,
  extractMagicLinkToken,
  setAwaitingMagicLink,
} from "@/lib/auth/session-store";
import type { AdminUser, AuthStatus } from "@/lib/auth/status";
import { sendMessage } from "@/lib/messaging";

// ---------------------------------------------------------------------------
// Типы
// ---------------------------------------------------------------------------

/** Шаг модалки: email → magic link (ссылка из письма или token вручную) → OTP. */
export type AuthStep = "email" | "magic-link" | "otp";

export const AUTH_STEPS: ReadonlyArray<{ step: AuthStep; label: string }> = [
  { step: "email", label: "Email" },
  { step: "magic-link", label: "Magic link" },
  { step: "otp", label: "OTP" },
];

export type StatusTone = "idle" | "pending" | "error" | "ok";

export interface StatusLine {
  text: string;
  tone: StatusTone;
  /** Показать кнопку «Открыть админку в браузере» (SSL / нужна вкладка). */
  showOpenAdmin: boolean;
}

/** Статус входа домена на стороне страницы: ответ background либо синтезированный провал. */
export interface DomainAuthStatus {
  domain: string;
  authenticated: boolean;
  pendingOtp: boolean;
  awaitingMagicLink: boolean;
  email?: string | null;
  user?: AdminUser;
  error?: string;
  errorCode?: string;
  cached?: boolean;
  /** Ответ взят из локального кэша — запрос к background не делался. */
  throttled?: boolean;
}

/** Провал шага входа: текст для строки статуса и нужна ли кнопка «Открыть админку». */
export interface AuthStepFailure {
  ok: false;
  message: string;
  showOpenAdmin: boolean;
}

/** Результат шага входа для модалки. */
export type AuthStepResult = { ok: true } | AuthStepFailure;

export type OtpStepResult = { ok: true; authStatus: AuthStatus } | AuthStepFailure;

export interface ModalErrorInfo {
  message: string;
  showOpenAdmin: boolean;
}

// ---------------------------------------------------------------------------
// Предикаты и подписи
// ---------------------------------------------------------------------------

function isValidAdminUser(user: unknown): user is AdminUser {
  return (
    !!user &&
    typeof user === "object" &&
    ((user as AdminUser).id != null || Boolean((user as AdminUser).email))
  );
}

type StatusLike = Partial<
  Pick<DomainAuthStatus, "authenticated" | "pendingOtp" | "user" | "email">
>;

/** Полный вход: authenticated, OTP пройден, есть пользователь или email. */
export function isAuthenticatedStatus(status: StatusLike | null | undefined): boolean {
  if (!status?.authenticated || status.pendingOtp) return false;
  return isValidAdminUser(status.user) || Boolean(status.email);
}

export function isDomainAuthenticated(status: StatusLike | null | undefined): boolean {
  if (status?.pendingOtp) return false;
  return isAuthenticatedStatus(status);
}

/** Ошибка API, после которой имеет смысл показать модалку входа. */
export function isAuthError(err: unknown): boolean {
  const msg = String(
    (err as { message?: unknown } | null | undefined)?.message || err,
  ).toLowerCase();
  return (
    msg.includes("403") ||
    msg.includes("401") ||
    msg.includes("не подтвержден") ||
    msg.includes("войдите") ||
    msg.includes("вход") ||
    msg.includes("авториз") ||
    msg.includes("magic link") ||
    msg.includes("otp") ||
    msg.includes("auth_") ||
    msg.includes("превышено время") ||
    msg.includes("host_permissions")
  );
}

export function formatDomainAuthLabel(
  status:
    | Partial<
        Pick<
          DomainAuthStatus,
          "authenticated" | "pendingOtp" | "awaitingMagicLink" | "email" | "error"
        >
      >
    | null
    | undefined,
  options: { forIndicator?: boolean } = {},
): string {
  const forIndicator = Boolean(options.forIndicator);
  if (!status) return "нет входа";
  if (status.authenticated) return status.email ? `вход: ${status.email}` : "вход выполнен";
  if (status.pendingOtp) return "ожидание OTP";
  if (status.awaitingMagicLink) return "ожидание magic link";
  if (status.error && !forIndicator) return "ошибка входа";
  return "нет входа";
}

/** Ошибка, при которой стоит предложить открыть админку во вкладке (сертификат, нужна вкладка). */
export function shouldOfferOpenAdmin(result: unknown): boolean {
  const record = result && typeof result === "object" ? (result as Record<string, unknown>) : null;
  const code = String(record?.errorCode || "");
  const text = String(
    record?.error || record?.message || (typeof result === "string" ? result : ""),
  );
  return (
    code === AUTH_FETCH_ERRORS.TAB_REQUIRED ||
    code === AUTH_FETCH_ERRORS.SSL_ERROR ||
    code === AUTH_FETCH_ERRORS.TAB_ERROR_PAGE ||
    /сертификат|вкладк|страниц.*ошибк|error page|tab_required|tab_error_page|ssl/i.test(text)
  );
}

/** Сообщение для строки статуса модалки: `error` ответа как есть, иначе formatAuthFetchError. */
export function formatAuthModalError(err: unknown, domain: string): ModalErrorInfo {
  const record = err && typeof err === "object" ? (err as { error?: unknown }) : null;
  if (record?.error) {
    return { message: String(record.error), showOpenAdmin: shouldOfferOpenAdmin(err) };
  }
  return { message: formatAuthFetchError(err, domain), showOpenAdmin: shouldOfferOpenAdmin(err) };
}

/** Есть ли у ошибки/ответа текст — иначе показываем запасное сообщение шага, а не «[object Object]». */
function hasErrorText(err: unknown): boolean {
  if (err instanceof Error || typeof err === "string") return Boolean(err);
  if (!err || typeof err !== "object") return false;
  const record = err as { error?: unknown; message?: unknown };
  return Boolean(record.error || record.message);
}

function stepError(err: unknown, domain: string, fallbackMessage: string): AuthStepFailure {
  const formatted = formatAuthModalError(err, domain);
  return {
    ok: false,
    message: (hasErrorText(err) && formatted.message) || fallbackMessage,
    showOpenAdmin: formatted.showOpenAdmin,
  };
}

/** URL вкладки админки для кнопки «Открыть админку в браузере». */
export function adminTabUrlFor(domain: string): string {
  return adminTabUrl(domain) || `https://${domain}/`;
}

// ---------------------------------------------------------------------------
// Статус домена (с троттлингом запросов к background)
// ---------------------------------------------------------------------------

export const STATUS_FETCH_MIN_INTERVAL_MS = 2500;

const lastStatusFetchByDomain = new Map<string, number>();
const lastStatusByDomain = new Map<string, DomainAuthStatus>();

/** Сброс кэша статусов (тесты). */
export function resetAuthStatusCache(): void {
  lastStatusFetchByDomain.clear();
  lastStatusByDomain.clear();
}

/** Следующий запрос статуса домена не будет троттлиться (модалка только что открылась). */
export function forgetStatusFetchTime(domain: string): void {
  lastStatusFetchByDomain.delete(String(domain || "").trim());
}

function failedStatus(domain: string, extra: Partial<DomainAuthStatus>): DomainAuthStatus {
  return {
    domain,
    authenticated: false,
    pendingOtp: false,
    awaitingMagicLink: false,
    ...extra,
  };
}

function rememberStatus(domain: string, status: DomainAuthStatus): DomainAuthStatus {
  lastStatusByDomain.set(domain, status);
  return status;
}

/**
 * Статус входа домена через background. Повторные запросы чаще раза в 2.5 с отдают
 * последний известный статус с `throttled: true`, если не задан `force`.
 */
export async function queryDomainAuthStatus(
  domain: string,
  options: { force?: boolean } = {},
): Promise<DomainAuthStatus> {
  const normalizedDomain = String(domain || "").trim();
  const now = Date.now();
  const lastFetch = lastStatusFetchByDomain.get(normalizedDomain) ?? 0;
  if (now - lastFetch < STATUS_FETCH_MIN_INTERVAL_MS && !options.force) {
    const cached = lastStatusByDomain.get(normalizedDomain);
    if (cached) return { ...cached, throttled: true };
    return failedStatus(normalizedDomain, { throttled: true });
  }
  lastStatusFetchByDomain.set(normalizedDomain, now);

  try {
    const response = await sendMessage("PH_AUTH_STATUS", {
      domain: normalizedDomain,
      force: Boolean(options.force),
    });
    if (!response) {
      return rememberStatus(
        normalizedDomain,
        failedStatus(normalizedDomain, { error: "Не удалось проверить статус входа" }),
      );
    }
    if (response.ok === false) {
      return rememberStatus(
        normalizedDomain,
        failedStatus(normalizedDomain, { error: response.error, errorCode: response.errorCode }),
      );
    }
    if (response.domain && response.domain !== normalizedDomain) {
      return rememberStatus(
        normalizedDomain,
        failedStatus(normalizedDomain, { error: "Ответ проверки входа не совпадает с доменом" }),
      );
    }
    const { ok: _ok, ...status } = response;
    return rememberStatus(normalizedDomain, { ...status, domain: normalizedDomain });
  } catch (err) {
    const message = String((err as { message?: unknown } | null)?.message || err);
    if (message === "AUTH_MESSAGE_TIMEOUT") {
      return rememberStatus(
        normalizedDomain,
        failedStatus(normalizedDomain, {
          error: "Превышено время ожидания проверки входа — откройте админку в браузере",
          errorCode: AUTH_FETCH_ERRORS.TAB_REQUIRED,
        }),
      );
    }
    return rememberStatus(
      normalizedDomain,
      failedStatus(normalizedDomain, { error: "Не удалось проверить статус входа" }),
    );
  }
}

// ---------------------------------------------------------------------------
// Шаги входа
// ---------------------------------------------------------------------------

/** Шаг 1: письмо с magic link. После успеха ставит флаг «ждём magic link» для background. */
export async function sendMagicLink(domain: string, emailInput: string): Promise<AuthStepResult> {
  const email = String(emailInput || "").trim();
  if (!domain || !email) return { ok: false, message: "Укажите email", showOpenAdmin: false };

  let result;
  try {
    result = await sendMessage("PH_AUTH_SEND_MAGIC_LINK", { domain, email });
  } catch (err) {
    return stepError(err, domain, "Не удалось отправить magic link");
  }
  if (!result?.ok) return stepError(result, domain, "Не удалось отправить magic link");

  await setAwaitingMagicLink(domain);
  return { ok: true };
}

/** Token из поля: принимает и полный URL magic link, и голый token. */
export function parseMagicLinkToken(rawInput: string): string {
  const raw = String(rawInput || "").trim();
  if (!raw) return "";
  return extractMagicLinkToken(raw) || raw;
}

/** Шаг 2 (вручную): подтверждение magic link по token. После успеха снимает флаг ожидания. */
export async function submitMagicLogin(domain: string, rawToken: string): Promise<AuthStepResult> {
  const token = parseMagicLinkToken(rawToken);
  if (!domain || !token) {
    return { ok: false, message: "Вставьте token из magic link", showOpenAdmin: false };
  }

  let result;
  try {
    result = await sendMessage("PH_AUTH_MAGIC_LOGIN", { domain, token });
  } catch (err) {
    return stepError(err, domain, "Magic login не удался");
  }
  if (!result?.ok) return stepError(result, domain, "Magic login не удался");

  await clearAwaitingMagicLink(domain);
  return { ok: true };
}

/**
 * Шаг 3: OTP. `ok: true` только если background подтвердил полный вход;
 * «OTP принят, но вход не подтверждён» и ошибки проверки сессии — `ok: false`.
 */
export async function submitOtp(domain: string, otpInput: string): Promise<OtpStepResult> {
  const otp = String(otpInput || "").trim();
  if (!domain || !otp) return { ok: false, message: "Укажите OTP-код", showOpenAdmin: false };

  let result;
  try {
    result = await sendMessage("PH_AUTH_VERIFY_OTP", { domain, otp });
  } catch (err) {
    return stepError(err, domain, "OTP не принят");
  }
  if (!result?.ok) return stepError(result, domain, "OTP не принят");

  const authStatus = result.authStatus;
  if (authStatus?.authenticated) return { ok: true, authStatus };
  if (authStatus?.error) {
    return stepError(authStatus, domain, "OTP принят, но проверка сессии не удалась");
  }
  return {
    ok: false,
    message: "OTP принят, но вход не подтверждён — повторите попытку",
    showOpenAdmin: false,
  };
}

// ---------------------------------------------------------------------------
// Состояние модалки при открытии
// ---------------------------------------------------------------------------

export interface InitialModalView {
  step: AuthStep;
  status: StatusLine;
  message: string;
  email: string;
  /** Magic link уже принят (pendingOtp) — шаг token пропущен. */
  submittedMagicLogin: boolean;
}

export function emailStepStatus(domain: string): StatusLine {
  return {
    text: `Шаг 1: отправьте magic link на email (${domain})`,
    tone: "idle",
    showOpenAdmin: false,
  };
}

export const MAGIC_LINK_SENT_STATUS: StatusLine = {
  text: "Письмо отправлено. Откройте ссылку из email или вставьте token ниже.",
  tone: "pending",
  showOpenAdmin: false,
};

export const MAGIC_LINK_ACCEPTED_STATUS: StatusLine = {
  text: "Magic link принят — введите OTP из письма",
  tone: "pending",
  showOpenAdmin: false,
};

export const MAGIC_LOGIN_SUBMITTED_STATUS: StatusLine = {
  text: "Magic link принят — введите OTP",
  tone: "pending",
  showOpenAdmin: false,
};

export const ADMIN_TAB_OPENED_STATUS: StatusLine = {
  text: "Вкладка админки открыта. Примите сертификат (если браузер спросит), затем повторите шаг входа.",
  tone: "pending",
  showOpenAdmin: true,
};

export function authenticatedStatusLine(email: string | null | undefined): StatusLine {
  return { text: `Вход выполнен${email ? ` (${email})` : ""}`, tone: "ok", showOpenAdmin: false };
}

/** С какого шага и с какой подписью открыть модалку по текущему статусу домена. */
export function initialModalView(
  domain: string,
  status: DomainAuthStatus | null | undefined,
  options: { message?: string } = {},
): InitialModalView {
  const pendingOtp = Boolean(status?.pendingOtp);
  const message =
    options.message ||
    (pendingOtp
      ? "Завершите вход — введите OTP из письма"
      : "Для работы с API нужен вход в админку");
  const email = status?.email || "";

  if (pendingOtp) {
    return {
      step: "otp",
      status: MAGIC_LINK_ACCEPTED_STATUS,
      message,
      email,
      submittedMagicLogin: true,
    };
  }

  if (status?.error && !status.authenticated) {
    const formatted = formatAuthModalError(status, domain);
    return {
      step: "email",
      status: { text: formatted.message, tone: "error", showOpenAdmin: formatted.showOpenAdmin },
      message,
      email,
      submittedMagicLogin: false,
    };
  }

  return {
    step: "email",
    status: emailStepStatus(domain),
    message,
    email,
    submittedMagicLogin: false,
  };
}
