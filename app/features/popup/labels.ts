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

export type ReportsReadiness = "ready" | "no-session" | "no-tab" | "unknown";

export function reportsReadiness(
  status: { sessionPresent: boolean; tabOpen: boolean } | null | undefined,
): ReportsReadiness {
  if (!status) return "unknown";
  if (!status.sessionPresent) return "no-session";
  if (!status.tabOpen) return "no-tab";
  return "ready";
}

export function reportsHostLabel(origin: string | null | undefined): string {
  return graphicHostLabel(origin || "https://reports.maxbit.private");
}

/** Тон точки в строке статусов popup. */
export function graphicTone(status: { authenticated: boolean } | null | undefined) {
  if (!status) return "unknown" as const;
  return status.authenticated ? ("ok" as const) : ("none" as const);
}

export function backendTone(
  auth: Record<string, DomainAuthState | undefined>,
  domains: string[],
): "ok" | "pending" | "none" | "unknown" {
  if (!domains.length) return "none";
  const tones = domains.map((host) => domainAuthTone(auth[host]));
  if (tones.every((t) => t === "ok")) return "ok";
  if (tones.some((t) => t === "ok" || t === "pending")) return "pending";
  if (domains.every((host) => auth[host] === undefined)) return "unknown";
  return "none";
}

export function reportsTone(readiness: ReportsReadiness): "ok" | "pending" | "none" | "unknown" {
  if (readiness === "ready") return "ok";
  if (readiness === "unknown") return "unknown";
  if (readiness === "no-tab") return "pending";
  return "none";
}
