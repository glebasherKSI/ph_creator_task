import { useCallback, useEffect, useState } from "react";
import { browser } from "wxt/browser";

import { sendMessage } from "@/lib/messaging";
import { REPORTS_ORIGIN } from "@/lib/reports";
import type { ReportsStatus } from "@/lib/reports-fetch";

export interface ReportsState {
  status: ReportsStatus | null;
  error: string;
  refresh: () => Promise<void>;
  /** Открывает вкладку Reports или переключается на уже открытую. */
  openTab: () => Promise<void>;
}

/** Готовность Reports: сессия (cookie) и открытая вкладка — проверяет background. */
export function useReports(): ReportsState {
  const [status, setStatus] = useState<ReportsStatus | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(
    () =>
      sendMessage("PH_REPORTS_STATUS", undefined, { timeoutMs: 5_000 }).then(
        (response) => {
          if (response?.ok) {
            setStatus(response);
            setError("");
          } else {
            setError(response?.error || "Не удалось проверить Reports");
          }
        },
        (err: unknown) => setError((err as Error)?.message || String(err)),
      ),
    [],
  );

  useEffect(() => {
    void refresh();
    // Открыли/закрыли вкладку Reports — обновляем без переоткрытия popup.
    const onRemoved = () => void refresh();
    const onUpdated = (_id: number, change: { status?: string }, tab: { url?: string }) => {
      if (change.status === "complete" && tab.url?.startsWith(REPORTS_ORIGIN)) void refresh();
    };
    browser.tabs.onRemoved.addListener(onRemoved);
    browser.tabs.onUpdated.addListener(onUpdated);
    return () => {
      browser.tabs.onRemoved.removeListener(onRemoved);
      browser.tabs.onUpdated.removeListener(onUpdated);
    };
  }, [refresh]);

  const knownTabId = status?.tabId ?? null;
  const openTab = useCallback(async () => {
    if (knownTabId != null) {
      try {
        const tab = await browser.tabs.update(knownTabId, { active: true });
        if (tab?.windowId != null) await browser.windows.update(tab.windowId, { focused: true });
        return;
      } catch {
        /* вкладка могла закрыться — откроем новую */
      }
    }
    await browser.tabs.create({ url: `${REPORTS_ORIGIN}/` });
  }, [knownTabId]);

  return { status, error, refresh, openTab };
}
