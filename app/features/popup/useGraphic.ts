import { useCallback, useEffect, useState } from "react";
import { browser } from "wxt/browser";

import { STORAGE_KEYS } from "@/lib/constants";
import {
  type GraphicStatus,
  graphicLoginFromPage,
  graphicLogoutFromPage,
  loadGraphicAuth,
  loadGraphicBaseUrl,
} from "@/lib/graphic-api";

export interface GraphicState {
  status: GraphicStatus | null;
  busy: boolean;
  error: string;
  login: (login: string, password: string, baseUrl: string) => Promise<boolean>;
  logout: () => Promise<void>;
}

/** Статус Graphic — это два ключа storage; читаем их напрямую, без RPC в background. */
async function readGraphicStatus(): Promise<GraphicStatus> {
  const [auth, baseUrl] = await Promise.all([loadGraphicAuth(), loadGraphicBaseUrl()]);
  return {
    ok: true,
    authenticated: Boolean(auth?.access_token),
    user: auth?.user || null,
    baseUrl,
  };
}

/** Сессия Promo Graphic: статус из storage, вход/выход через background, реакция на storage. */
export function useGraphic(): GraphicState {
  const [status, setStatus] = useState<GraphicStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // setState только в колбэках промиса — так эффект не вызывает setState синхронно.
  const refresh = useCallback(() => readGraphicStatus().then(setStatus, () => undefined), []);

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
