import { useCallback, useEffect, useRef, useState } from "react";
import { browser } from "wxt/browser";

import { awaitingMagicLinkStorageKey, pendingOtpStorageKey } from "@/lib/auth/session-store";
import { STORAGE_KEYS } from "@/lib/constants";
import { injectOnDomainTabs } from "@/lib/content-script";
import {
  ensureDefaultDomainsInStorage,
  loadDomainsFromStorage,
  normalizeDomain,
  refreshDomainPermissions,
  removeDomainPermission,
  requestDomainPermission,
  saveDomainsToStorage,
} from "@/lib/domains";
import { sendMessage } from "@/lib/messaging";

import { dropAuthCache, readAuthCache, writeAuthCache } from "./auth-cache";
import type { DomainAuthState } from "./labels";

export interface DomainsState {
  domains: string[];
  permissions: Record<string, boolean>;
  auth: Record<string, DomainAuthState | undefined>;
  /** Домены, для которых статус сейчас проверяется в background. */
  checking: Record<string, boolean>;
  status: string;
  loading: boolean;
  addDomain: (raw: string) => Promise<boolean>;
  addCurrentTab: () => Promise<void>;
  removeDomain: (host: string) => Promise<void>;
  refreshAuth: () => Promise<void>;
}

/** Проверка через вкладку админки может длиться секунды — popup не ждёт дольше этого. */
const AUTH_STATUS_TIMEOUT_MS = 8_000;

async function queryAuthStatus(host: string): Promise<DomainAuthState> {
  try {
    const response = await sendMessage(
      "PH_AUTH_STATUS",
      { domain: host },
      { timeoutMs: AUTH_STATUS_TIMEOUT_MS },
    );
    return response?.ok === false ? { authenticated: false } : (response as DomainAuthState);
  } catch {
    return { authenticated: false, pendingOtp: false };
  }
}

/**
 * Домены админок, их host-permissions и статусы входа.
 * Домены показываются сразу; permissions и статусы подтягиваются асинхронно,
 * статусы кэшируются на сессию браузера (auth-cache) для мгновенного открытия.
 */
export function useDomains(): DomainsState {
  const [domains, setDomains] = useState<string[]>([]);
  const [permissions, setPermissions] = useState<Record<string, boolean>>({});
  const [auth, setAuth] = useState<Record<string, DomainAuthState | undefined>>({});
  const [checking, setChecking] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);

  // Актуальный список для обработчиков событий без замыканий на stale state.
  const domainsRef = useRef<string[]>([]);
  useEffect(() => {
    domainsRef.current = domains;
  }, [domains]);

  const refreshAuthFor = useCallback(async (hosts: string[]) => {
    if (!hosts.length) return;
    setChecking((prev) => ({ ...prev, ...Object.fromEntries(hosts.map((h) => [h, true])) }));
    await Promise.all(
      hosts.map(async (host) => {
        const state = await queryAuthStatus(host);
        setAuth((prev) => ({ ...prev, [host]: state }));
        setChecking((prev) => ({ ...prev, [host]: false }));
        void writeAuthCache(host, state);
      }),
    );
  }, []);

  const applyDomains = useCallback(
    (next: string[]) => {
      setDomains(next);
      void refreshDomainPermissions(next).then(setPermissions);
      void refreshAuthFor(next);
    },
    [refreshAuthFor],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [cached, stored] = await Promise.all([readAuthCache(), loadDomainsFromStorage()]);
      if (cancelled) return;
      const list = stored.length ? stored : await ensureDefaultDomainsInStorage();
      if (cancelled) return;
      // Сначала показываем то, что знаем, потом проверяем.
      setAuth(cached);
      setLoading(false);
      applyDomains(list);
    })();

    const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area !== "local") return;
      const domainsChange = changes[STORAGE_KEYS.DOMAINS];
      if (domainsChange) {
        const next = Array.isArray(domainsChange.newValue)
          ? (domainsChange.newValue as string[])
          : [];
        applyDomains(next);
        return;
      }
      const current = domainsRef.current;
      const touched = current.filter(
        (host) => changes[pendingOtpStorageKey(host)] || changes[awaitingMagicLinkStorageKey(host)],
      );
      if (changes[STORAGE_KEYS.AUTH_SESSIONS]) void refreshAuthFor(current);
      else if (touched.length) void refreshAuthFor(touched);
    };
    browser.storage.onChanged.addListener(onChanged);
    return () => {
      cancelled = true;
      browser.storage.onChanged.removeListener(onChanged);
    };
  }, [applyDomains, refreshAuthFor]);

  const refreshAuth = useCallback(() => refreshAuthFor(domainsRef.current), [refreshAuthFor]);

  const addDomain = useCallback(
    async (raw: string): Promise<boolean> => {
      const host = normalizeDomain(raw);
      if (!host) {
        setStatus("Некорректный домен. Укажите host вида admin.example.com");
        return false;
      }
      if (domainsRef.current.includes(host)) {
        setStatus(`Домен ${host} уже в списке`);
        return false;
      }

      const granted = await requestDomainPermission(host);
      const next = [...domainsRef.current, host];
      await saveDomainsToStorage(next);
      setDomains(next);
      setPermissions((prev) => ({ ...prev, [host]: granted }));

      if (granted) {
        void injectOnDomainTabs(host);
        setStatus(`Домен ${host} добавлен, доступ разрешён`);
      } else {
        setStatus(`Домен ${host} сохранён, но доступ не выдан — API из конструктора недоступен`);
      }
      void refreshAuthFor([host]);
      return true;
    },
    [refreshAuthFor],
  );

  const removeDomain = useCallback(async (host: string) => {
    const next = domainsRef.current.filter((d) => d !== host);
    await saveDomainsToStorage(next);
    setDomains(next);
    setPermissions((prev) => {
      const copy = { ...prev };
      delete copy[host];
      return copy;
    });
    void removeDomainPermission(host);
    void dropAuthCache(host);
    setStatus(`Домен ${host} удалён`);
  }, []);

  const addCurrentTab = useCallback(async () => {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) {
      setStatus("Не удалось определить текущую вкладку");
      return;
    }
    if (tab.url.startsWith("http://")) {
      setStatus("Поддерживаются только https-домены");
      return;
    }
    const host = normalizeDomain(tab.url);
    if (!host) {
      setStatus("Текущая вкладка не https-админка");
      return;
    }
    await addDomain(host);
  }, [addDomain]);

  return {
    domains,
    permissions,
    auth,
    checking,
    status,
    loading,
    addDomain,
    addCurrentTab,
    removeDomain,
    refreshAuth,
  };
}
