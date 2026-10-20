/** Подписи статусов в popup (чистые функции, без chrome.*). */
import type { GraphicUser } from "@/lib/graphic-api";

export interface DomainAuthState {
  authenticated?: boolean;
  pendingOtp?: boolean;
  awaitingMagicLink?: boolean;
  email?: string | null;
}

export type DomainAuthTone = "ok" | "pending" | "none";

export function domainAuthTone(auth: DomainAuthState | undefined): DomainAuthTone {
  if (auth?.authenticated) return "ok";
  if (auth?.pendingOtp || auth?.awaitingMagicLink) return "pending";
  return "none";
}

export function formatAuthLabel(auth: DomainAuthState | undefined): string {
  if (auth?.authenticated) return "вход";
  if (auth?.pendingOtp) return "otp";
  if (auth?.awaitingMagicLink) return "link";
  return "нет";
}

export function formatAuthTitle(auth: DomainAuthState | undefined): string {
  if (auth?.authenticated) {
    return auth.email ? `Вход выполнен (${auth.email})` : "Вход выполнен";
  }
  if (auth?.pendingOtp) return "Magic link принят — ожидание OTP";
  if (auth?.awaitingMagicLink) return "Ожидание magic link";
  return "Вход не выполнен";
}

export function graphicUserLabel(user: GraphicUser | null | undefined): string {
  if (!user || typeof user !== "object") return "";
  return String(user.username || user.email || user.login || "").trim();
}

export function graphicHostLabel(baseUrl: string | null | undefined): string {
  try {
    return new URL(String(baseUrl)).host;
  } catch {
    return String(baseUrl || "");
  }
}

/** Сервер недоступен — стоит сразу раскрыть поле с адресом. */
export function isGraphicConnectivityError(message: string): boolean {
  return /fetch|network|сервер|адрес|url/i.test(message);
}
