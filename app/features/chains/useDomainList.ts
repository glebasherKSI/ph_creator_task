/** Домены админок из storage с выбранным доменом; следит за изменениями из popup. */
import { useCallback, useEffect, useState } from "react";
import { browser } from "wxt/browser";

import { STORAGE_KEYS } from "@/lib/constants";
import { loadDomainsFromStorage, normalizeDomainOrEmpty } from "@/lib/domains";

const LAST_DOMAIN_KEY = "ph_last_domain";

function readLastDomain(): string {
  try {
    return localStorage.getItem(LAST_DOMAIN_KEY) || "";
  } catch {
    return "";
  }
}

export function useDomainList(): {
  domains: string[];
  domain: string;
  setDomain: (next: string) => void;
  loaded: boolean;
} {
  const [domains, setDomains] = useState<string[] | null>(null);
  const [chosen, setChosen] = useState<string>(readLastDomain);

  useEffect(() => {
    void loadDomainsFromStorage().then(setDomains);
    const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area !== "local") return;
      const change = changes[STORAGE_KEYS.DOMAINS];
      if (change) setDomains(Array.isArray(change.newValue) ? (change.newValue as string[]) : []);
    };
    browser.storage.onChanged.addListener(onChanged);
    return () => browser.storage.onChanged.removeListener(onChanged);
  }, []);

  const list = domains ?? [];
  // Выбранный домен — производное: последний выбранный, если он ещё в списке, иначе первый.
  const domain = list.includes(chosen) ? chosen : (list[0] ?? "");

  const setDomain = useCallback((next: string) => {
    const normalized = normalizeDomainOrEmpty(next);
    setChosen(normalized);
    try {
      localStorage.setItem(LAST_DOMAIN_KEY, normalized);
    } catch {
      /* необязательно */
    }
  }, []);

  return { domains: list, domain, setDomain, loaded: domains !== null };
}
