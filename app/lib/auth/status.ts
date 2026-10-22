/**
 * Статус входа в админку и шаги авторизации (magic link → OTP → logout).
 * Только для background: опирается на adminApiFetch.
 */
import { ADMIN_API_PREFIX } from "../constants";
import { normalizeDomainOrEmpty } from "../domains";
import { adminApiFetch, type AdminFetchResult } from "./admin-fetch";
import { TRANSIENT_AUTH_ERRORS, errorMessage, formatAuthFetchError } from "./errors";
import {
  clearAwaitingMagicLink,
  clearPendingOtpFlow,
  clearStoredAuthSession,
  ensureBrowserSessionCookie,
  getStoredAuthSession,
  hasPendingOtpFlow,
  isAwaitingMagicLink,
  otpVerifyReferer,
  readBrowserSessionCookie,
  removeBrowserSessionCookie,
  saveStoredAuthSession,
  setPendingOtpFlow,
  syncSessionFromBrowser,
} from "./session-store";

export interface AdminUser {
  id?: number | string | null;
  email?: string | null;
  [key: string]: unknown;
}

export interface AuthStatus {
  domain: string;
  authenticated: boolean;
  pendingOtp: boolean;
  awaitingMagicLink: boolean;
  email: string | null;
  user?: AdminUser;
  error?: string;
  /** Ответ взят из кэша провала current_user (не «живой» отказ). */
  cached?: boolean;
}

export interface CurrentUserResult {
  ok: boolean;
  user?: AdminUser;
  result: AdminFetchResult | null;
  cached?: boolean;
}

const CURRENT_USER_FAIL_TTL_MS = 8000;
const currentUserFailureCache = new Map<string, { at: number; result: AdminFetchResult }>();

function isValidAdminUser(user: unknown): user is AdminUser {
  return (
    !!user &&
    typeof user === "object" &&
    ((user as AdminUser).id != null || Boolean((user as AdminUser).email))
  );
}

function shouldCacheCurrentUserFailure(error: unknown): boolean {
  return !TRANSIENT_AUTH_ERRORS.has(errorMessage(error));
}

export function clearCurrentUserFailureCache(domainInput: string): void {
  const domain = normalizeDomainOrEmpty(domainInput);
  if (domain) currentUserFailureCache.delete(domain);
}

export async function fetchCurrentUser(
  domainInput: string,
  options: { force?: boolean } = {},
): Promise<CurrentUserResult> {
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
    if (shouldCacheCurrentUserFailure(err)) {
      currentUserFailureCache.set(domain, {
        at: Date.now(),
        result: { ok: false, error: errorMessage(err) },
      });
    }
    throw err;
  }
}

/**
 * Проверяет, что сессия прошла OTP (API задач доступен).
 * current_user может отвечать и до OTP — этот probe отличает полный вход.
 */
async function probeFullAuth(domainInput: string): Promise<boolean> {
  try {
    const result = await adminApiFetch(
      domainInput,
      `${ADMIN_API_PREFIX}/gamification/tasks?limit=1&offset=0`,
      "GET",
      null,
      { skipCookieSync: true },
    );
    return Boolean(result.ok);
  } catch {
    return false;
  }
}

export async function getAuthStatus(
  domainInput: string,
  options: { force?: boolean } = {},
): Promise<AuthStatus> {
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

  const cookie = await readBrowserSessionCookie(domain);
  if (cookie?.value) {
    await saveStoredAuthSession(domain, { value: cookie.value });
  } else if (stored?.value) {
    await ensureBrowserSessionCookie(domain);
  }

  const hasSession = Boolean(cookie?.value || stored?.value);

  // current_user может ответить успешно ещё до прохождения OTP (см. probeFullAuth ниже).
  // Поэтому "не нужно перепроверять полный доступ" — это отдельный факт, который должен
  // быть явно подтверждён (verified === true) предыдущей успешной проверкой, а не просто
  // "мы ничего плохого не знаем". Иначе первая же проверка нового/чужого cookie (magic
  // link принят, OTP ещё не введён) отрапортует authenticated:true.
  const sessionChanged = Boolean(cookie?.value) && cookie?.value !== stored?.value;
  const otpIncomplete = pendingOtp || stored?.verified !== true || sessionChanged;

  if (hasSession) {
    try {
      const { ok, user, cached } = await fetchCurrentUser(domain, { force: options.force });
      if (ok && isValidAdminUser(user)) {
        const sessionValue = cookie?.value || stored?.value;
        const email = user.email ? String(user.email) : (stored?.email ?? null);
        const userId = user.id != null ? Number(user.id) : undefined;

        if (otpIncomplete) {
          const fullAuth = await probeFullAuth(domain);
          if (!fullAuth) {
            await saveStoredAuthSession(domain, {
              value: sessionValue,
              email,
              userId,
              verified: false,
            });
            return {
              domain,
              authenticated: false,
              pendingOtp: true,
              awaitingMagicLink: false,
              email,
              user,
            };
          }
          await clearPendingOtpFlow(domain);
        }

        await saveStoredAuthSession(domain, { value: sessionValue, email, userId, verified: true });
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
      }

      const cachedResult = cached ? currentUserFailureCache.get(domain)?.result : null;
      const fetchError = cachedResult?.error
        ? formatAuthFetchError(cachedResult.error, domain)
        : undefined;

      // Здесь current_user не ответил успешно — это либо реальный разлогин (нет смысла
      // предполагать OTP), либо действительно начатый magic-link flow (сам флаг pendingOtp).
      // Широкий otpIncomplete тут не подходит — иначе любой первый неудачный запрос
      // (истёкшая кука и т.п.) ошибочно покажет шаг OTP вместо формы входа.
      if (pendingOtp) {
        return {
          domain,
          authenticated: false,
          pendingOtp: true,
          awaitingMagicLink: false,
          email: stored?.email ?? null,
          error: fetchError,
          cached: Boolean(cached),
        };
      }

      return {
        domain,
        authenticated: false,
        pendingOtp: false,
        awaitingMagicLink,
        email: stored?.email ?? null,
        error: fetchError,
        cached: Boolean(cached),
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

  if (pendingOtp) {
    return {
      domain,
      authenticated: false,
      pendingOtp: true,
      awaitingMagicLink: false,
      email: stored?.email ?? null,
    };
  }

  return {
    domain,
    authenticated: false,
    pendingOtp: false,
    awaitingMagicLink,
    email: stored?.email ?? null,
  };
}

export async function sendMagicLoginInstructions(
  domainInput: string,
  email: string,
): Promise<AdminFetchResult> {
  const normalizedEmail = String(email || "").trim();
  if (!normalizedEmail) throw new Error("Укажите email");

  return adminApiFetch(
    domainInput,
    `${ADMIN_API_PREFIX}/auth/send_magic_login_instructions`,
    "POST",
    { email: normalizedEmail },
    { skipCookieSync: false },
  );
}

export async function magicLogin(domainInput: string, token: string): Promise<AdminFetchResult> {
  const normalizedToken = String(token || "").trim();
  if (!normalizedToken) throw new Error("Укажите token из magic link");

  const result = await adminApiFetch(domainInput, `${ADMIN_API_PREFIX}/auth/magic_login`, "POST", {
    token: normalizedToken,
  });

  await syncSessionFromBrowser(domainInput);
  if (result.ok) {
    await setPendingOtpFlow(domainInput);
    const cookie = await readBrowserSessionCookie(domainInput);
    if (cookie?.value) {
      await saveStoredAuthSession(domainInput, { value: cookie.value, verified: false });
    }
  } else {
    await clearPendingOtpFlow(domainInput);
  }
  return result;
}

export async function verifyOtp(
  domainInput: string,
  otpAttempt: string,
): Promise<AdminFetchResult & { authStatus: AuthStatus | null }> {
  const code = String(otpAttempt || "").trim();
  if (!code) throw new Error("Укажите OTP-код");

  const result = await adminApiFetch(
    domainInput,
    `${ADMIN_API_PREFIX}/otp/verify`,
    "POST",
    { otp_attempt: code },
    { refererPage: otpVerifyReferer(domainInput) },
  );

  await syncSessionFromBrowser(domainInput);

  if (!result.ok) {
    return { ...result, authStatus: null };
  }

  clearCurrentUserFailureCache(domainInput);
  const status = await getAuthStatus(domainInput, { force: true });
  return { ...result, authStatus: status };
}

export async function logoutAdmin(domainInput: string): Promise<{ ok: true }> {
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
