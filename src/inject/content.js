// content.js — мост для API-запросов конструктора (cookies вкладки админки).

(() => {
  if (window.__PH_CONTENT_LOADED__) return;
  window.__PH_CONTENT_LOADED__ = true;

  function parseResponseByContentType(response, text) {
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

  async function runTaskApiRequest(payload) {
    const method = String(payload?.method || "GET").toUpperCase();
    const path = String(payload?.path || "");
    const targetUrl = /^https?:\/\//i.test(path) ? path : new URL(path, location.origin).toString();

    const headers = {
      Accept: "application/json, text/plain, */*",
      "X-PH-Extension": "1",
      ...(payload?.headers || {}),
    };

    let body;
    if (payload?.body != null) {
      if (typeof payload.body === "string") {
        body = payload.body;
      } else {
        headers["Content-Type"] = headers["Content-Type"] || "application/json";
        body = JSON.stringify(payload.body);
      }
    }

    const response = await fetch(targetUrl, {
      method,
      credentials: "include",
      headers,
      body,
    });
    const text = await response.text();
    const data = parseResponseByContentType(response, text);
    const responseHeaders = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key.toLowerCase()] = value;
    });
    return {
      ok: response.ok,
      status: response.status,
      url: response.url || targetUrl,
      data,
      headers: responseHeaders,
    };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg?.action) return;

    switch (msg.action) {
      case "PING":
        sendResponse({
          ok: true,
          host: location.host,
          origin: location.origin,
        });
        return;

      case "PH_API_FETCH":
        runTaskApiRequest(msg.payload)
          .then((result) => sendResponse(result))
          .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
        return true;

      default:
        return;
    }
  });
})();
