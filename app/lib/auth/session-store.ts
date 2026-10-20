import { browser } from "wxt/browser";

import {
  ADMIN_API_PREFIX,
  ADMIN_AUTH_LOCALE,
  ADMIN_SESSION_COOKIE,
  STORAGE_KEYS,
} from "../constants";
import { normalizeDomainOrEmpty, originPattern } from "../domains";

/** Сохранённая сессия админки по домену (значение cookie + кто вошёл). */
export interface AuthSessionRecord {
  value?: string;
  email?: string | null;
  userId?: number;
  updatedAt?: number;
  /** false — magic link пройден, OTP ещё нет. */
  verified?: boolean;
}

export type AuthSessionsStore = Record<string, AuthSessionRecord>;

const MAGIC_LINK_PATH_RE = /\/admin\/-\/auth\/magic-login(?:\?|$)/;
const PENDING_OTP_KEY_PREFIX = "ph_auth_pending_otp_";
const AWAITING_MAGIC_LINK_PREFIX = "ph_auth_awaiting_magic_link_";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Сессии в chrome.storage.local
// ---------------------------------------------------------------------------

export async function loadAuthSessionsStore(): Promise<AuthSessionsStore> {
  const stored = await browser.storage.local.get(STORAGE_KEYS.AUTH_SESSIONS);
  const raw = stored[STORAGE_KEYS.AUTH_SESSIONS];
  return isRecord(raw) ? { ...(raw as AuthSessionsStore) } : {};
}

export async function saveAuthSessionsStore(store: AuthSessionsStore): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEYS.AUTH_SESSIONS]: store });
}

export async function getStoredAuthSession(domainInput: string): Promise<AuthSessionRecord | null> {
  const domain = normalizeDomainOrEmpty(domainInput);
  if (!domain) return null;
  const store = await loadAuthSessionsStore();
  const record = store[domain];
  return record?.value ? { ...record } : null;
}

export async function saveStoredAuthSession(
  domainInput: string,
  record: AuthSessionRecord,
): Promise<void> {
  const domain = normalizeDomainOrEmpty(domainInput);
  if (!domain || !record?.value) return;
  const store = await loadAuthSessionsStore();
  const prev = store[domain];
  const next: AuthSessionRecord = {
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

export async function clearStoredAuthSession(domainInput: string): Promise<void> {
  const domain = normalizeDomainOrEmpty(domainInput);
  if (!domain) return;
  const store = await loadAuthSessionsStore();
  if (!store[domain]) return;
  delete store[domain];
  await saveAuthSessionsStore(store);
}

// ---------------------------------------------------------------------------
// URL-хелперы админки
// ---------------------------------------------------------------------------

export function adminOrigin(domainInput: string | null | undefined): string {
  const domain = normalizeDomainOrEmpty(domainInput);
  return domain ? `https://${domain}` : "";
}

export function adminApiUrl(
  domainInput: string,
  path: string,
  locale: string | null = ADMIN_AUTH_LOCALE,
): string {
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

export function otpVerifyReferer(domainInput: string): string {
  const origin = adminOrigin(domainInput);
  return origin ? `${origin}/admin/-/otp/verify` : "";
}

export function isPrivateAdminDomain(domainInput: string): boolean {
  return normalizeDomainOrEmpty(domainInput).endsWith(".private");
}

export function adminTabUrl(domainInput: string): string {
  const origin = adminOrigin(domainInput);
  return origin ? `${origin}/` : "";
}

export function extractMagicLinkToken(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!MAGIC_LINK_PATH_RE.test(parsed.pathname)) return null;
    const token = parsed.searchParams.get("token");
    return token ? String(token).trim() : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Флаги незавершённого входа (pending OTP / ожидание magic link)
// ---------------------------------------------------------------------------

export function pendingOtpStorageKey(domainInput: string): string {
  const domain = normalizeDomainOrEmpty(domainInput);
  return domain ? `${PENDING_OTP_KEY_PREFIX}${domain}` : "";
}

export function awaitingMagicLinkStorageKey(domainInput: string): string {
  const domain = normalizeDomainOrEmpty(domainInput);
  return domain ? `${AWAITING_MAGIC_LINK_PREFIX}${domain}` : "";
}

export async function hasPendingOtpFlow(domainInput: string): Promise<boolean> {
  const key = pendingOtpStorageKey(domainInput);
  if (!key) return false;
  const stored = await browser.storage.local.get(key);
  const record = stored[key];
  return isRecord(record) && record.magicLoginOk === true;
}

export async function setPendingOtpFlow(domainInput: string): Promise<void> {
  const domain = normalizeDomainOrEmpty(domainInput);
  if (!domain) return;
  await browser.storage.local.set({
    [pendingOtpStorageKey(domain)]: { domain, updatedAt: Date.now(), magicLoginOk: true },
  });
}

export async function clearPendingOtpFlow(domainInput: string): Promise<void> {
  const key = pendingOtpStorageKey(domainInput);
  if (!key) return;
  await browser.storage.local.remove(key);
}

/** Расширение ждёт magic link (письмо отправлено из auth-модалки). */
export async function isAwaitingMagicLink(domainInput: string): Promise<boolean> {
  const key = awaitingMagicLinkStorageKey(domainInput);
  if (!key) return false;
  const stored = await browser.storage.local.get(key);
  return Boolean(stored[key]);
}

export async function setAwaitingMagicLink(domainInput: string): Promise<void> {
  const domain = normalizeDomainOrEmpty(domainInput);
  if (!domain) return;
  await browser.storage.local.set({
    [awaitingMagicLinkStorageKey(domain)]: { domain, updatedAt: Date.now() },
  });
}

export async function clearAwaitingMagicLink(domainInput: string): Promise<void> {
  const key = awaitingMagicLinkStorageKey(domainInput);
  if (!key) return;
  await browser.storage.local.remove(key);
}

// ---------------------------------------------------------------------------
// Cookie сессии в браузере
// ---------------------------------------------------------------------------

export async function readBrowserSessionCookie(domainInput: string) {
  const origin = adminOrigin(domainInput);
  if (!origin) return null;
  return browser.cookies.get({ url: `${origin}/`, name: ADMIN_SESSION_COOKIE });
}

export async function writeBrowserSessionCookie(
  domainInput: string,
  value: string,
): Promise<boolean> {
  const origin = adminOrigin(domainInput);
  if (!origin || !value) return false;
  await browser.cookies.set({
    url: `${origin}/`,
    name: ADMIN_SESSION_COOKIE,
    value,
    secure: true,
    httpOnly: true,
    sameSite: "lax",
  });
  return true;
}

export async function removeBrowserSessionCookie(domainInput: string): Promise<void> {
  const origin = adminOrigin(domainInput);
  if (!origin) return;
  const existing = await readBrowserSessionCookie(domainInput);
  if (!existing) return;
  await browser.cookies.remove({ url: `${origin}/`, name: ADMIN_SESSION_COOKIE });
}

/** Живая cookie браузера → сохранённая сессия. Возвращает значение cookie. */
export async function syncSessionFromBrowser(domainInput: string): Promise<string | null> {
  const cookie = await readBrowserSessionCookie(domainInput);
  if (!cookie?.value) return null;
  const domain = normalizeDomainOrEmpty(domainInput);
  if (!domain) return null;
  await saveStoredAuthSession(domainInput, { value: cookie.value });
  return cookie.value;
}

/**
 * Живую cookie браузера не трогаем: Rails перевыпускает _casino_session,
 * и запись сохранённого (старого) значения затирала бы актуальную сессию.
 */
export async function ensureBrowserSessionCookie(domainInput: string): Promise<boolean> {
  const existing = await readBrowserSessionCookie(domainInput);
  if (existing?.value) return true;
  const stored = await getStoredAuthSession(domainInput);
  if (!stored?.value) return false;
  await writeBrowserSessionCookie(domainInput, stored.value);
  return true;
}

export async function hasDomainHostPermission(domainInput: string): Promise<boolean> {
  const domain = normalizeDomainOrEmpty(domainInput);
  if (!domain) return false;
  return browser.permissions.contains({ origins: [originPattern(domain)] });
}
