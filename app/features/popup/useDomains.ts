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

import type { DomainAuthState } from "./labels";

export interface DomainsState {
  domains: string[];
  permissions: Record<string, boolean>;
  auth: Record<string, DomainAuthState | undefined>;
  status: string;
  loading: boolean;
  addDomain: (raw: string) => Promise<boolean>;
  addCurrentTab: () => Promise<void>;
  removeDomain: (host: string) => Promise<void>;
}

async function queryAuthStatuses(
  hosts: string[],
): Promise<Record<string, DomainAuthState | undefined>> {
  const entries = await Promise.all(
    hosts.map(async (host): Promise<[string, DomainAuthState | undefined]> => {
      try {
        const response = await sendMessage("PH_AUTH_STATUS", { domain: host });
        return [host, response?.ok !== false ? (response as DomainAuthState) : undefined];
      } catch {
        return [host, { authenticated: false, pendingOtp: false }];
      }
    }),
  );
  return Object.fromEntries(entries);
}

/** Домены админок, их host-permissions и статусы входа; следит за chrome.storage. */
export function useDomains(): DomainsState {
  const [domains, setDomains] = useState<string[]>([]);
  const [permissions, setPermissions] = useState<Record<string, boolean>>({});
  const [auth, setAuth] = useState<Record<string, DomainAuthState | undefined>>({});
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  // Актуальный список для обработчиков событий (storage.onChanged, клики) без замыканий на stale state.
  const domainsRef = useRef<string[]>([]);
  useEffect(() => {
    domainsRef.current = domains;
  }, [domains]);

  const refreshAuth = useCallback(async (hosts: string[]) => {
    setAuth(await queryAuthStatuses(hosts));
  }, []);

  const applyDomains = useCallback(
    async (next: string[]) => {
      setDomains(next);
      setPermissions(await refreshDomainPermissions(next));
      await refreshAuth(next);
    },
    [refreshAuth],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let list = await loadDomainsFromStorage();
      if (!list.length) list = await ensureDefaultDomainsInStorage();
      if (cancelled) return;
      await applyDomains(list);
      if (!cancelled) setLoading(false);
    })();

    const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area !== "local") return;
      const domainsChange = changes[STORAGE_KEYS.DOMAINS];
      if (domainsChange) {
        const next = Array.isArray(domainsChange.newValue)
          ? (domainsChange.newValue as string[])
          : [];
        void applyDomains(next);
        return;
      }
      const current = domainsRef.current;
      const authChanged =
        Boolean(changes[STORAGE_KEYS.AUTH_SESSIONS]) ||
        current.some(
          (host) =>
            changes[pendingOtpStorageKey(host)] || changes[awaitingMagicLinkStorageKey(host)],
        );
      if (authChanged) void refreshAuth(current);
    };
    browser.storage.onChanged.addListener(onChanged);
    return () => {
      cancelled = true;
      browser.storage.onChanged.removeListener(onChanged);
    };
  }, [applyDomains, refreshAuth]);

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
        await injectOnDomainTabs(host);
        setStatus(`Домен ${host} добавлен, доступ разрешён`);
      } else {
        setStatus(`Домен ${host} сохранён, но доступ не выдан — API из конструктора недоступен`);
      }
      await refreshAuth(next);
      return true;
    },
    [refreshAuth],
  );

  const removeDomain = useCallback(async (host: string) => {
    const next = domainsRef.current.filter((d) => d !== host);
    await saveDomainsToStorage(next);
    await removeDomainPermission(host);
    setDomains(next);
    setPermissions((prev) => {
      const copy = { ...prev };
      delete copy[host];
      return copy;
    });
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

  return { domains, permissions, auth, status, loading, addDomain, addCurrentTab, removeDomain };
}
