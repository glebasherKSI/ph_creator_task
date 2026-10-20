import { browser } from "wxt/browser";

import { DEFAULT_DOMAIN, STORAGE_KEYS } from "./constants";

/** Хост админки из любого ввода: URL, host:port, host/path. Только https. */
export function normalizeDomain(input: unknown): string | null {
  const trimmed = String(input || "").trim();
  if (!trimmed) return null;

  try {
    const url = trimmed.includes("://") ? new URL(trimmed) : new URL(`https://${trimmed}`);
    if (url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    if (!host) return null;
    return host;
  } catch {
    const host = (trimmed.replace(/^https?:\/\//i, "").split("/")[0] ?? "")
      .split(":")[0]!
      .toLowerCase();
    if (!host || !/^[a-z0-9.-]+$/i.test(host)) return null;
    return host;
  }
}

/** Пустая строка вместо null при невалидном вводе. */
export function normalizeDomainOrEmpty(input: unknown): string {
  return normalizeDomain(input) || "";
}

export function originPattern(host: string): string {
  return `https://${host}/*`;
}

export function hostFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export function hostFromRequest(req: { host?: string | null; url?: string | null }): string {
  if (req.host) {
    try {
      return new URL(req.host).hostname;
    } catch {
      return (
        String(req.host)
          .replace(/^https?:\/\//, "")
          .split("/")[0] ?? ""
      );
    }
  }
  if (req.url) {
    try {
      return new URL(req.url).hostname;
    } catch {
      return "";
    }
  }
  return "";
}

export async function loadDomainsFromStorage(): Promise<string[]> {
  const stored = await browser.storage.local.get(STORAGE_KEYS.DOMAINS);
  const value = stored[STORAGE_KEYS.DOMAINS];
  return Array.isArray(value) ? [...(value as string[])] : [];
}

export async function saveDomainsToStorage(domains: string[]): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEYS.DOMAINS]: domains });
}

export async function ensureDefaultDomainsInStorage(): Promise<string[]> {
  const domains = await loadDomainsFromStorage();
  if (domains.length > 0) return domains;
  const next = [DEFAULT_DOMAIN];
  await saveDomainsToStorage(next);
  return next;
}

export async function refreshDomainPermissions(
  domains: string[],
): Promise<Record<string, boolean>> {
  const map: Record<string, boolean> = {};
  for (const host of domains) {
    map[host] = await browser.permissions.contains({ origins: [originPattern(host)] });
  }
  return map;
}

export async function requestDomainPermission(host: string): Promise<boolean> {
  return browser.permissions.request({ origins: [originPattern(host)] });
}

export async function removeDomainPermission(host: string): Promise<void> {
  try {
    const has = await browser.permissions.contains({ origins: [originPattern(host)] });
    if (has) {
      await browser.permissions.remove({ origins: [originPattern(host)] });
    }
  } catch {
    /* optional permission may not be removable */
  }
}
