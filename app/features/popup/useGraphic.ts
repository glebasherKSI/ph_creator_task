import { useCallback, useEffect, useState } from "react";
import { browser } from "wxt/browser";

import { STORAGE_KEYS } from "@/lib/constants";
import {
  GRAPHIC_DEFAULT_BASE_URL,
  type GraphicStatus,
  graphicLoginFromPage,
  graphicLogoutFromPage,
  graphicStatusFromPage,
} from "@/lib/graphic-api";

export interface GraphicState {
  status: GraphicStatus | null;
  busy: boolean;
  error: string;
  login: (login: string, password: string, baseUrl: string) => Promise<boolean>;
  logout: () => Promise<void>;
}

const OFFLINE: GraphicStatus = {
  ok: true,
  authenticated: false,
  user: null,
  baseUrl: GRAPHIC_DEFAULT_BASE_URL,
};

/** Сессия Promo Graphic: статус из background, вход/выход, реакция на storage. */
export function useGraphic(): GraphicState {
  const [status, setStatus] = useState<GraphicStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // setState только в колбэках промиса — так эффект не вызывает setState синхронно.
  const refresh = useCallback(
    () => graphicStatusFromPage().then(setStatus, () => setStatus(OFFLINE)),
    [],
  );

  useEffect(() => {
    void refresh();
    const onChanged = (changes: Record<string, unknown>, area: string) => {
      if (area !== "local") return;
      if (changes[STORAGE_KEYS.GRAPHIC_AUTH] || changes[STORAGE_KEYS.GRAPHIC_BASE_URL]) {
        void refresh();
      }
    };
    browser.storage.onChanged.addListener(onChanged);
    return () => browser.storage.onChanged.removeListener(onChanged);
  }, [refresh]);

  const login = useCallback(async (loginValue: string, password: string, baseUrl: string) => {
    setBusy(true);
    setError("");
    try {
      setStatus(await graphicLoginFromPage(loginValue, password, baseUrl));
      return true;
    } catch (err) {
      setError((err as Error)?.message || String(err));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      setStatus(await graphicLogoutFromPage());
      setError("");
    } catch (err) {
      setError((err as Error)?.message || String(err));
    }
  }, []);

  return { status, busy, error, login, logout };
}
