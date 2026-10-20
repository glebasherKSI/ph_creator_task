import { normalizeDomainOrEmpty } from "../domains";

export const AUTH_FETCH_ERRORS = {
  TAB_REQUIRED: "AUTH_TAB_REQUIRED",
  SSL_ERROR: "AUTH_SSL_ERROR",
  SCRIPT_FAILED: "AUTH_SCRIPT_FAILED",
  TAB_ERROR_PAGE: "AUTH_TAB_ERROR_PAGE",
  TAB_UNRESPONSIVE: "AUTH_TAB_UNRESPONSIVE",
} as const;

export type AuthFetchErrorCode = (typeof AUTH_FETCH_ERRORS)[keyof typeof AUTH_FETCH_ERRORS];

/** Ошибки, после которых не кэшируем провал current_user: вкладка может «ожить». */
export const TRANSIENT_AUTH_ERRORS: ReadonlySet<string> = new Set([
  AUTH_FETCH_ERRORS.TAB_ERROR_PAGE,
  AUTH_FETCH_ERRORS.TAB_REQUIRED,
  AUTH_FETCH_ERRORS.TAB_UNRESPONSIVE,
]);

export const AUTH_MESSAGE_TIMEOUT_MS = 20_000;

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) return String(err.message);
  return String(err ?? "");
}

export function withTimeout<T>(
  promise: Promise<T> | T,
  ms: number,
  message = "Превышено время ожидания",
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    Promise.resolve(promise)
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err: unknown) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

export function isTabErrorPageExecuteScriptError(err: unknown): boolean {
  return /showing error page/i.test(errorMessage(err));
}

export function isSslOrNetworkError(err: unknown): boolean {
  return /ERR_CERT|CERT_AUTHORITY|SSL|certificate|Failed to fetch|NetworkError|net::ERR/i.test(
    errorMessage(err),
  );
}

export function isChromeErrorPageUrl(url: unknown): boolean {
  const normalized = String(url || "").toLowerCase();
  return (
    normalized.startsWith("chrome-error://") ||
    normalized.startsWith("chrome://") ||
    normalized.includes("chromewebdata")
  );
}

/** Человекочитаемое сообщение по коду AUTH_* или сырой ошибке fetch. */
export function formatAuthFetchError(err: unknown, domainInput?: string): string {
  const raw = errorMessage(err).trim();
  const code = raw.startsWith("AUTH_") ? raw : "";
  const domain = normalizeDomainOrEmpty(domainInput);
  const adminUrl = domain ? `https://${domain}` : "админку";

  const byCode: Record<string, string> = {
    [AUTH_FETCH_ERRORS.TAB_REQUIRED]: `Откройте ${adminUrl} в браузере (вкладка должна оставаться открытой), примите сертификат при первом заходе и повторите вход.`,
    [AUTH_FETCH_ERRORS.SSL_ERROR]: `Ошибка SSL-сертификата. Откройте ${adminUrl} в браузере, примите сертификат и повторите вход.`,
    [AUTH_FETCH_ERRORS.TAB_ERROR_PAGE]: `Вкладка админки показывает страницу ошибки (например, не принят SSL-сертификат). Откройте ${adminUrl} в браузере, примите сертификат, дождитесь загрузки страницы (не страницы ошибки) и повторите вход.`,
    [AUTH_FETCH_ERRORS.SCRIPT_FAILED]: `Не удалось выполнить запрос на вкладке админки. Обновите страницу ${adminUrl} и повторите попытку.`,
    [AUTH_FETCH_ERRORS.TAB_UNRESPONSIVE]: `Вкладка ${adminUrl} не отвечает даже после перезагрузки. Откройте её, дождитесь загрузки и повторите попытку.`,
  };

  const known = byCode[code];
  if (known) return known;
  if (/unserializable/i.test(raw)) return byCode[AUTH_FETCH_ERRORS.SCRIPT_FAILED]!;
  if (isTabErrorPageExecuteScriptError(raw)) return byCode[AUTH_FETCH_ERRORS.TAB_ERROR_PAGE]!;
  if (/ERR_CERT|CERT_AUTHORITY|SSL|certificate/i.test(raw)) {
    return byCode[AUTH_FETCH_ERRORS.SSL_ERROR]!;
  }
  if (/Failed to fetch/i.test(raw)) {
    return `Не удалось подключиться к ${adminUrl}. Откройте админку в браузере, примите сертификат и повторите вход.`;
  }
  if (!raw) return "Не удалось выполнить запрос к админке.";
  return raw;
}
