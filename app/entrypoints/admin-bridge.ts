/**
 * Content-script вкладки админки PromoHub: мост для API-запросов конструктора
 * с cookie этой вкладки. В манифест не попадает — background инжектит его
 * только во вкладки доменов, добавленных пользователем (optional host permissions).
 */
import { browser } from "wxt/browser";
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";

import { createMessageRouter, type TabMessageMap } from "@/lib/messaging";

const LOADED_FLAG = "__PH_CONTENT_LOADED__";

function parseResponseByContentType(response: Response, text: string): unknown {
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

async function runTaskApiRequest(
  payload: TabMessageMap["PH_API_FETCH"]["payload"],
): Promise<TabMessageMap["PH_API_FETCH"]["response"]> {
  const method = String(payload?.method || "GET").toUpperCase();
  const path = String(payload?.path || "");
  const targetUrl = /^https?:\/\//i.test(path) ? path : new URL(path, location.origin).toString();

  const headers: Record<string, string> = {
    Accept: "application/json, text/plain, */*",
    "X-PH-Extension": "1",
    ...(payload?.headers || {}),
  };

  let body: string | undefined;
  if (payload?.body != null) {
    if (typeof payload.body === "string") {
      body = payload.body;
    } else {
      headers["Content-Type"] = headers["Content-Type"] || "application/json";
      body = JSON.stringify(payload.body);
    }
  }

  const response = await fetch(targetUrl, { method, credentials: "include", headers, body });
  const text = await response.text();
  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key.toLowerCase()] = value;
  });
  return {
    ok: response.ok,
    status: response.status,
    url: response.url || targetUrl,
    data: parseResponseByContentType(response, text),
    headers: responseHeaders,
  };
}

// Unlisted-скрипт: попадает в сборку файлом, но не в манифест — никаких content_scripts и
// host_permissions. Background инжектит его сам (executeScript) только в разрешённые домены.
export default defineUnlistedScript({
  main() {
    const scope = window as unknown as Record<string, unknown>;
    if (scope[LOADED_FLAG]) return;
    scope[LOADED_FLAG] = true;

    browser.runtime.onMessage.addListener(
      createMessageRouter<TabMessageMap>({
        PING: async () => ({ ok: true, host: location.host, origin: location.origin }),
        PH_API_FETCH: (payload) => runTaskApiRequest(payload),
      }),
    );
  },
});
