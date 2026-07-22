import { STORAGE_KEYS } from "./constants.js";
import {
  AUTH_FETCH_ERRORS,
  adminTabUrl,
  clearAwaitingMagicLink,
  clearPendingOtpFlow,
  extractMagicLinkToken,
  formatAuthFetchError,
  awaitingMagicLinkStorageKey,
  pendingOtpStorageKey,
  sendAuthMessage,
  setAwaitingMagicLink,
} from "./auth.js";

const $ = (id) => document.getElementById(id);

function isValidAdminUser(user) {
  return user && typeof user === "object" && (user.id != null || user.email);
}

function isAuthenticatedStatus(status) {
  if (!status?.authenticated) return false;
  return isValidAdminUser(status.user) || Boolean(status.email);
}

/** @type {{ domain: string, onComplete: (ok: boolean) => void } | null} */
let pending = null;
let mounted = false;
let refreshTimer = null;
let skipStorageRefreshUntil = 0;
/** @type {Map<string, number>} */
const lastStatusFetchByDomain = new Map();
/** @type {Map<string, object>} */
const lastStatusByDomain = new Map();

const STATUS_FETCH_MIN_INTERVAL_MS = 2500;

export function isAuthError(err) {
  const msg = String(err?.message || err).toLowerCase();
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

export function isAuthModalOpen() {
  const overlay = $("auth-modal-overlay");
  return overlay != null && !overlay.classList.contains("chains-modal-overlay--hidden");
}

function setOpenAdminButtonVisible(visible) {
  const btn = $("btn-auth-open-admin");
  if (!btn) return;
  btn.hidden = !visible;
}

function shouldOfferOpenAdmin(result) {
  const code = String(result?.errorCode || "");
  const text = String(result?.error || result?.message || result || "");
  return (
    code === AUTH_FETCH_ERRORS.TAB_REQUIRED ||
    code === AUTH_FETCH_ERRORS.SSL_ERROR ||
    code === AUTH_FETCH_ERRORS.TAB_ERROR_PAGE ||
    /сертификат|вкладк|страниц.*ошибк|error page|tab_required|tab_error_page|ssl/i.test(text)
  );
}

function setStatusLine(text, tone = "idle", options = {}) {
  const el = $("auth-modal-status");
  if (!el) return;
  el.textContent = text;
  el.className = `auth-modal-status auth-modal-status--${tone}`;
  setOpenAdminButtonVisible(Boolean(options.showOpenAdmin));
}

function setStepperActive(step) {
  for (const item of document.querySelectorAll(".auth-stepper__item")) {
    const n = Number(item.dataset.step);
    item.classList.toggle("auth-stepper__item--active", n === step);
    item.classList.toggle("auth-stepper__item--done", n < step);
  }
}

function showStepPanel(step) {
  $("auth-step-email")?.classList.toggle("auth-modal-step--hidden", step !== 1);
  $("auth-step-token")?.classList.toggle("auth-modal-step--hidden", step !== 2);
  $("auth-step-otp")?.classList.toggle("auth-modal-step--hidden", step !== 3);
  setStepperActive(step);
}

function setModalMessage(text) {
  const el = $("auth-modal-message");
  if (!el) return;
  if (!text) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.textContent = text;
}

function formatAuthModalError(err, domain) {
  if (err && typeof err === "object" && err.error) {
    return {
      message: String(err.error),
      showOpenAdmin: shouldOfferOpenAdmin(err),
    };
  }
  return {
    message: formatAuthFetchError(err, domain),
    showOpenAdmin: shouldOfferOpenAdmin(err),
  };
}

async function openAdminTab() {
  const domain = pending?.domain;
  if (!domain) return;
  const url = adminTabUrl(domain) || `https://${domain}/`;
  await chrome.tabs.create({ url });
  setStatusLine(
    "Вкладка админки открыта. Примите сертификат (если браузер спросит), затем повторите шаг входа.",
    "pending",
    { showOpenAdmin: true }
  );
}

function openOverlay() {
  const overlay = $("auth-modal-overlay");
  overlay?.classList.remove("chains-modal-overlay--hidden");
  overlay?.setAttribute("aria-hidden", "false");
}

function closeOverlay() {
  const overlay = $("auth-modal-overlay");
  overlay?.classList.add("chains-modal-overlay--hidden");
  overlay?.setAttribute("aria-hidden", "true");
}

function finish(ok) {
  const domain = pending?.domain;
  const callback = pending?.onComplete;
  pending = null;
  closeOverlay();
  if (domain) void clearAwaitingMagicLink(domain);
  callback?.(ok);
}

async function fetchAuthStatus(domain, options = {}) {
  const normalizedDomain = String(domain || "").trim();
  const now = Date.now();
  const lastFetch = lastStatusFetchByDomain.get(normalizedDomain) ?? 0;
  if (now - lastFetch < STATUS_FETCH_MIN_INTERVAL_MS && !options.force) {
    const cached = lastStatusByDomain.get(normalizedDomain);
    if (cached) return { ...cached, throttled: true };
    return {
      domain: normalizedDomain,
      authenticated: false,
      pendingOtp: false,
      awaitingMagicLink: false,
      throttled: true,
    };
  }
  lastStatusFetchByDomain.set(normalizedDomain, now);

  try {
    const response = await sendAuthMessage("PH_AUTH_STATUS", {
      domain: normalizedDomain,
      force: Boolean(options.force),
    });
    if (response?.ok === false) {
      const failed = {
        domain: normalizedDomain,
        authenticated: false,
        pendingOtp: false,
        awaitingMagicLink: false,
        error: response.error,
        errorCode: response.errorCode,
        cached: response.cached,
      };
      lastStatusByDomain.set(normalizedDomain, failed);
      return failed;
    }
    if (response?.domain && response.domain !== normalizedDomain) {
      const mismatch = {
        domain: normalizedDomain,
        authenticated: false,
        pendingOtp: false,
        awaitingMagicLink: false,
        error: "Ответ проверки входа не совпадает с доменом",
      };
      lastStatusByDomain.set(normalizedDomain, mismatch);
      return mismatch;
    }
    lastStatusByDomain.set(normalizedDomain, response);
    return response;
  } catch (err) {
    const message = String(err?.message || err);
    if (message === "AUTH_MESSAGE_TIMEOUT") {
      return {
        domain: normalizedDomain,
        authenticated: false,
        pendingOtp: false,
        awaitingMagicLink: false,
        error: "Превышено время ожидания проверки входа — откройте админку в браузере",
        errorCode: AUTH_FETCH_ERRORS.TAB_REQUIRED,
      };
    }
    return {
      domain: normalizedDomain,
      authenticated: false,
      pendingOtp: false,
      awaitingMagicLink: false,
      error: "Не удалось проверить статус входа",
    };
  }
}

function scheduleRefreshModalState() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    void refreshModalState();
  }, 450);
}

async function refreshModalState() {
  if (!pending?.domain) return;

  const status = await fetchAuthStatus(pending.domain, { force: true });
  if (status?.throttled) return;
  const domainLabel = pending.domain;

  if (status?.authenticated) {
    setStatusLine(`Вход выполнен${status.email ? ` (${status.email})` : ""}`, "ok");
    finish(isAuthenticatedStatus(status));
    return;
  }

  if (status?.pendingOtp) {
    setStatusLine("Magic link принят — введите OTP из письма", "pending");
    showStepPanel(3);
    $("auth-otp")?.focus();
    return;
  }

  if (status?.awaitingMagicLink) {
    setStatusLine("Письмо отправлено. Откройте ссылку из email или вставьте token вручную.", "pending");
    showStepPanel(2);
    return;
  }

  if (status?.error && !status?.authenticated) {
    const formatted = formatAuthModalError(status, domainLabel);
    setStatusLine(formatted.message, "error", { showOpenAdmin: formatted.showOpenAdmin });
    return;
  }

  const emailSent = Boolean($("auth-email")?.value?.trim());
  if (emailSent) {
    setStatusLine("Письмо отправлено. Откройте ссылку из email или вставьте token вручную.", "pending");
    showStepPanel(2);
    return;
  }

  setStatusLine(`Шаг 1: отправьте magic link на email (${domainLabel})`, "idle");
  showStepPanel(1);
}

function onStorageChanged(changes, area) {
  if (area !== "local" || !pending?.domain) return;
  if (Date.now() < skipStorageRefreshUntil) return;
  const domain = pending.domain;
  const domainAuthChanged =
    changes[STORAGE_KEYS.AUTH_SESSIONS] ||
    changes[pendingOtpStorageKey(domain)] ||
    changes[awaitingMagicLinkStorageKey(domain)];
  if (domainAuthChanged) {
    scheduleRefreshModalState();
  }
}

function reportAuthStepError(err, domain, fallbackMessage) {
  const formatted = formatAuthModalError(err, domain);
  setStatusLine(formatted.message || fallbackMessage, "error", {
    showOpenAdmin: formatted.showOpenAdmin,
  });
  skipStorageRefreshUntil = Date.now() + 4000;
}

async function sendMagicLink() {
  const domain = pending?.domain;
  const email = $("auth-email")?.value?.trim();
  if (!domain) return;
  if (!email) {
    setStatusLine("Укажите email", "error");
    return;
  }

  setStatusLine("Отправка magic link…", "pending");
  let result;
  try {
    result = await sendAuthMessage("PH_AUTH_SEND_MAGIC_LINK", { domain, email });
  } catch (err) {
    reportAuthStepError(err, domain, "Не удалось отправить magic link");
    return;
  }
  if (!result?.ok) {
    reportAuthStepError(result, domain, "Не удалось отправить magic link");
    return;
  }

  await setAwaitingMagicLink(domain);
  setStatusLine("Письмо отправлено. Откройте ссылку из email или вставьте token ниже.", "pending");
  showStepPanel(2);
  $("auth-token")?.focus();
}

async function submitMagicLogin() {
  const domain = pending?.domain;
  const raw = $("auth-token")?.value?.trim();
  const token = (raw && extractMagicLinkToken(raw)) || raw;
  if (!domain || !token) {
    setStatusLine("Вставьте token из magic link", "error");
    return;
  }

  setStatusLine("Подтверждение magic link…", "pending");
  let result;
  try {
    result = await sendAuthMessage("PH_AUTH_MAGIC_LOGIN", { domain, token });
  } catch (err) {
    reportAuthStepError(err, domain, "Magic login не удался");
    return;
  }
  if (!result?.ok) {
    reportAuthStepError(result, domain, "Magic login не удался");
    return;
  }

  $("auth-token").value = "";
  await clearAwaitingMagicLink(domain);
  setStatusLine("Magic link принят — введите OTP", "pending");
  showStepPanel(3);
  $("auth-otp")?.focus();
  await refreshModalState();
}

async function submitOtp() {
  const domain = pending?.domain;
  const otp = $("auth-otp")?.value?.trim();
  if (!domain || !otp) {
    setStatusLine("Укажите OTP-код", "error");
    return;
  }

  setStatusLine("Проверка OTP…", "pending");
  let result;
  try {
    result = await sendAuthMessage("PH_AUTH_VERIFY_OTP", { domain, otp });
  } catch (err) {
    reportAuthStepError(err, domain, "OTP не принят");
    return;
  }
  if (!result?.ok) {
    reportAuthStepError(result, domain, "OTP не принят");
    return;
  }

  const authStatus = result.authStatus;
  if (authStatus?.authenticated) {
    $("auth-otp").value = "";
    setStatusLine(`Вход выполнен${authStatus.email ? ` (${authStatus.email})` : ""}`, "ok");
    finish(isAuthenticatedStatus(authStatus));
    return;
  }

  if (authStatus?.error) {
    reportAuthStepError(authStatus, domain, "OTP принят, но проверка сессии не удалась");
    return;
  }

  $("auth-otp").value = "";
  await refreshModalState();
}

function cancelAuth() {
  finish(false);
}

function resetAuthFormFields() {
  $("auth-email").value = "";
  $("auth-token").value = "";
  $("auth-otp").value = "";
  setOpenAdminButtonVisible(false);
  setModalMessage("");
}

/**
 * Сброс модалки при смене домена (не завершает вход на прежнем домене в storage).
 * @param {string} newDomain
 */
export function resetAuthModalForDomainSwitch(newDomain) {
  const normalizedDomain = String(newDomain || "").trim();
  if (!isAuthModalOpen() || !pending?.domain) return;
  if (pending.domain === normalizedDomain) return;

  const prevCallback = pending.onComplete;
  pending = null;
  resetAuthFormFields();
  closeOverlay();
  prevCallback?.(false);
}

export function formatDomainAuthLabel(status) {
  if (!status) return "нет входа";
  if (status.authenticated) return status.email ? `вход: ${status.email}` : "вход выполнен";
  if (status.pendingOtp) return "ожидание OTP";
  if (status.awaitingMagicLink) return "ожидание magic link";
  if (status.error) return "ошибка входа";
  return "нет входа";
}

/**
 * @param {string} domain
 * @returns {Promise<{ authenticated: boolean, pendingOtp: boolean, awaitingMagicLink: boolean, email?: string | null, error?: string }>}
 */
export async function queryDomainAuthStatus(domain) {
  return fetchAuthStatus(String(domain || "").trim(), { force: true });
}

export function mountAuthModal() {
  if (mounted) return;
  mounted = true;

  $("btn-auth-send-magic-link")?.addEventListener("click", () => void sendMagicLink());
  $("btn-auth-magic-login")?.addEventListener("click", () => void submitMagicLogin());
  $("btn-auth-verify-otp")?.addEventListener("click", () => void submitOtp());
  $("btn-auth-open-admin")?.addEventListener("click", () => void openAdminTab());
  $("btn-cancel-auth-modal")?.addEventListener("click", cancelAuth);
  $("btn-close-auth-modal")?.addEventListener("click", cancelAuth);

  $("auth-email")?.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      void sendMagicLink();
    }
  });

  $("auth-token")?.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      void submitMagicLogin();
    }
  });

  $("auth-otp")?.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      void submitOtp();
    }
  });

  $("auth-modal-overlay")?.addEventListener("click", (ev) => {
    if (ev.target.id === "auth-modal-overlay") cancelAuth();
  });

  chrome.storage.onChanged.addListener(onStorageChanged);
}

/**
 * Показывает модал входа, если пользователь не авторизован.
 * @param {string} domain
 * @param {{ message?: string }} [options]
 * @returns {Promise<boolean>}
 */
export async function ensureAuthenticated(domain, options = {}) {
  const normalizedDomain = String(domain || "").trim();
  if (!normalizedDomain) return false;

  if (isAuthModalOpen() && pending?.domain && pending.domain !== normalizedDomain) {
    resetAuthModalForDomainSwitch(normalizedDomain);
  }

  const status = await fetchAuthStatus(normalizedDomain, { force: true });
  if (isAuthenticatedStatus(status)) return true;

  if (isAuthModalOpen() && pending?.domain === normalizedDomain) {
    return new Promise((resolve) => {
      const prev = pending?.onComplete;
      pending = {
        domain: normalizedDomain,
        onComplete(ok) {
          prev?.(ok);
          resolve(ok);
        },
      };
    });
  }

  return new Promise((resolve) => {
    pending = { domain: normalizedDomain, onComplete: resolve };

    void (async () => {
      if (!status?.pendingOtp) {
        await clearPendingOtpFlow(normalizedDomain);
      }

      $("auth-modal-domain").textContent = normalizedDomain;
      setModalMessage(options.message || "Для работы с API нужен вход в админку");
      resetAuthFormFields();
      $("auth-email").value = status?.email || "";
      skipStorageRefreshUntil = 0;
      lastStatusFetchByDomain.delete(normalizedDomain);

      openOverlay();
      await refreshModalState();
    })();
  });
}
