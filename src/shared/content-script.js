import { CONTENT_SCRIPT_PATH } from "./constants.js";

export async function pingContent(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { action: "PING" });
  } catch {
    return null;
  }
}

export async function injectContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [CONTENT_SCRIPT_PATH],
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

/** Подключает content script к вкладке админки (для API конструктора). */
export async function ensureContentScriptReady(tabId) {
  const ping = await pingContent(tabId);
  if (ping?.ok) return true;
  await injectContentScript(tabId);
  return !!(await pingContent(tabId))?.ok;
}

export async function injectOnDomainTabs(host) {
  const tabs = await chrome.tabs.query({ url: `https://${host}/*` });
  for (const tab of tabs) {
    if (tab.id != null) {
      await ensureContentScriptReady(tab.id);
    }
  }
}
