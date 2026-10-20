/**
 * Service worker: авторизация в админках, прокси admin API, Reports, Graphic API,
 * инъекция content-script во вкладки доменов, перехват magic link.
 */
import { browser, type Browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";

import {
  adminApiFetch,
  clearAwaitingMagicLink,
  extractMagicLinkToken,
  formatAuthFetchError,
  getAuthStatus,
  isAwaitingMagicLink,
  logoutAdmin,
  magicLogin,
  sendMagicLoginInstructions,
  verifyOtp,
} from "@/lib/auth";
import { DEFAULT_DOMAIN, STORAGE_KEYS } from "@/lib/constants";
import { ensureContentScriptReady } from "@/lib/content-script";
import { hostFromUrl, loadDomainsFromStorage, originPattern } from "@/lib/domains";
import { handleGraphicAuthMessage, handleGraphicFetchMessage } from "@/lib/graphic-api";
import { createMessageRouter, type ErrorResponse, type MessageMap } from "@/lib/messaging";
import {
  getReportsStatus,
  handleReportsFetch,
  handleReportsState,
  reportsErrorResponse,
} from "@/lib/reports-fetch";

type Tab = Browser.tabs.Tab;

async function hasOriginPermission(host: string): Promise<boolean> {
  return browser.permissions.contains({ origins: [originPattern(host)] });
}

/** Content-script нужен только во вкладках доменов из списка пользователя с выданным permission. */
async function maybeInjectTab(tab: Tab | undefined): Promise<void> {
  if (!tab?.id || !tab.url?.startsWith("https://")) return;
  const host = hostFromUrl(tab.url);
  if (!host) return;

  const domains = await loadDomainsFromStorage();
  if (!domains.includes(host)) return;
  if (!(await hasOriginPermission(host))) return;

  await ensureContentScriptReady(tab.id);
}

/** Недавно обработанные token → timestamp (защита от двойного вызова url + complete). */
const recentMagicLoginTokens = new Map<string, number>();
const MAGIC_LOGIN_DEDUPE_MS = 60_000;

async function handleMagicLinkUrl(url: string): Promise<void> {
  const token = extractMagicLinkToken(url);
  if (!token) return;

  const now = Date.now();
  const lastUsed = recentMagicLoginTokens.get(token);
  if (lastUsed != null && now - lastUsed < MAGIC_LOGIN_DEDUPE_MS) return;
  recentMagicLoginTokens.set(token, now);

  const domain = hostFromUrl(url);
  if (!domain) return;

  const domains = await loadDomainsFromStorage();
  if (!domains.includes(domain)) return;

  // Перехват только при активном входе через расширение — иначе съедаем
  // одноразовый token раньше, чем админка успеет его принять в браузере.
  if (!(await isAwaitingMagicLink(domain))) return;

  try {
    const result = await magicLogin(domain, token);
    if (result?.ok) await clearAwaitingMagicLink(domain);
  } catch {
    /* user can retry manually from popup */
  }
}

function authErrorResponse(err: unknown, domain?: string): ErrorResponse {
  const raw = String((err as Error)?.message || err);
  return {
    ok: false,
    error: formatAuthFetchError(err, domain),
    errorCode: raw.startsWith("AUTH_") ? raw : undefined,
  };
}

function graphicErrorResponse(err: unknown): ErrorResponse {
  return { ok: false, error: String((err as Error)?.message || err) };
}

/** Ошибка → ответ в формате, который ждёт страница (по семейству действия). */
function mapMessageError(action: string, err: unknown, payload: unknown): unknown {
  if (action.startsWith("PH_REPORTS_")) return reportsErrorResponse(err);
  if (action.startsWith("PH_GRAPHIC_")) return graphicErrorResponse(err);
  const domain = (payload as { domain?: string } | undefined)?.domain;
  return authErrorResponse(err, domain);
}

export default defineBackground(() => {
  browser.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (changeInfo.status === "complete") {
      void maybeInjectTab(tab);
      if (tab.url) void handleMagicLinkUrl(tab.url);
      return;
    }
    if (changeInfo.url) void handleMagicLinkUrl(changeInfo.url);
  });

  browser.runtime.onInstalled.addListener(async () => {
    const stored = await browser.storage.local.get(STORAGE_KEYS.DOMAINS);
    const domains = stored[STORAGE_KEYS.DOMAINS];
    if (!Array.isArray(domains) || domains.length === 0) {
      await browser.storage.local.set({ [STORAGE_KEYS.DOMAINS]: [DEFAULT_DOMAIN] });
    }
  });

  browser.runtime.onMessage.addListener(
    createMessageRouter<MessageMap>(
      {
        PH_REPORTS_FETCH: (payload) => handleReportsFetch(payload),
        PH_REPORTS_STATE: () => handleReportsState(),
        PH_REPORTS_STATUS: () => getReportsStatus(),
        PH_ADMIN_API_FETCH: (payload) =>
          adminApiFetch(
            payload.domain,
            payload.path,
            payload.method || "GET",
            payload.body ?? null,
            payload.options ?? {},
          ),
        PH_AUTH_STATUS: async (payload) => ({
          ok: true,
          ...(await getAuthStatus(payload.domain, { force: Boolean(payload.force) })),
        }),
        PH_AUTH_SEND_MAGIC_LINK: (payload) =>
          sendMagicLoginInstructions(payload.domain, payload.email),
        PH_AUTH_MAGIC_LOGIN: (payload) => magicLogin(payload.domain, payload.token),
        PH_AUTH_VERIFY_OTP: (payload) => verifyOtp(payload.domain, payload.otp),
        PH_AUTH_LOGOUT: (payload) => logoutAdmin(payload.domain),
        PH_GRAPHIC_AUTH: (payload) => handleGraphicAuthMessage(payload),
        PH_GRAPHIC_FETCH: (payload) => handleGraphicFetchMessage(payload),
      },
      mapMessageError,
    ),
  );
});
