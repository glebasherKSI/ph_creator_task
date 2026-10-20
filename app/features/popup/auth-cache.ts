/**
 * Кэш статусов входа для мгновенного открытия popup.
 * Живёт в storage.session: сбрасывается вместе с браузером, не переживает перезапуск.
 */
import { browser } from "wxt/browser";

import type { DomainAuthState } from "./labels";

const KEY = "ph_popup_auth_cache";

export type AuthCache = Record<string, DomainAuthState>;

function sessionStorage() {
  // storage.session появился в MV3; в тестах/старых сборках может отсутствовать.
  return (browser.storage as { session?: typeof browser.storage.local }).session ?? null;
}

export async function readAuthCache(): Promise<AuthCache> {
  try {
    const stored = await sessionStorage()?.get(KEY);
    const value = stored?.[KEY];
    return value && typeof value === "object" && !Array.isArray(value) ? (value as AuthCache) : {};
  } catch {
    return {};
  }
}

export async function writeAuthCache(host: string, state: DomainAuthState): Promise<void> {
  try {
    const current = await readAuthCache();
    await sessionStorage()?.set({ [KEY]: { ...current, [host]: state } });
  } catch {
    /* кэш необязателен */
  }
}

export async function dropAuthCache(host: string): Promise<void> {
  try {
    const current = await readAuthCache();
    delete current[host];
    await sessionStorage()?.set({ [KEY]: current });
  } catch {
    /* кэш необязателен */
  }
}
