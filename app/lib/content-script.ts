/** Инъекция content-script во вкладки админки (для API-запросов через cookie вкладки). */
import { browser } from "wxt/browser";

import { CONTENT_SCRIPT_PATH } from "./constants";
import { sendTabMessage, type TabMessageMap } from "./messaging";

export async function pingContent(
  tabId: number,
): Promise<TabMessageMap["PING"]["response"] | null> {
  try {
    return await sendTabMessage(tabId, "PING", undefined);
  } catch {
    return null;
  }
}

export async function injectContentScript(
  tabId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await browser.scripting.executeScript({ target: { tabId }, files: [CONTENT_SCRIPT_PATH] });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String((err as Error)?.message || err) };
  }
}

/** Подключает content-script к вкладке, если его там ещё нет. */
export async function ensureContentScriptReady(tabId: number): Promise<boolean> {
  const ping = await pingContent(tabId);
  if (ping?.ok) return true;
  await injectContentScript(tabId);
  return Boolean((await pingContent(tabId))?.ok);
}

export async function injectOnDomainTabs(host: string): Promise<void> {
  const tabs = await browser.tabs.query({ url: `https://${host}/*` });
  for (const tab of tabs) {
    if (tab.id != null) await ensureContentScriptReady(tab.id);
  }
}
