// page-hook.js — патч fetch/XHR в main world.
// Перехватывает create / copy / edit / GET fetch задач PromoHub admin.
// Запросы расширения помечаются заголовком X-PH-Extension: 1.

(() => {
  if (window.__PH_PAGE_HOOK__) return;
  window.__PH_PAGE_HOOK__ = true;

  const EXT_HDR = "x-ph-extension";
  const TASK_API_PREFIX = "/admin/api/gamification/tasks";
  const COPY_ACTIONS = new Set(["copy", "duplicate", "clone", "fork", "replicate"]);
  const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH"]);

  function parseTaskPath(pathname) {
    const lower = String(pathname || "").toLowerCase();
    const prefix = TASK_API_PREFIX.toLowerCase();
    if (!lower.startsWith(prefix)) return null;

    const rest = pathname.slice(prefix.length);
    const parts = rest.split("/").filter(Boolean);
    const taskId = parts[0] && /^\d+$/.test(parts[0]) ? Number(parts[0]) : null;
    const subAction = parts[1] ? parts[1].toLowerCase() : null;

    return { taskId, subAction, parts };
  }

  function isTaskApiUrl(pathname) {
    return parseTaskPath(pathname) != null;
  }

  function parseCaptureMeta(method, url) {
    const m = String(method || "GET").toUpperCase();

    try {
      const u = new URL(url, location.origin);
      const parsed = parseTaskPath(u.pathname);
      if (!parsed) return null;

      const { taskId, subAction } = parsed;

      if (m === "GET") {
        if (subAction) return null;
        if (taskId) return { kind: "fetch_one", taskId };
        return { kind: "fetch_list", taskId: null };
      }

      if (!MUTATING_METHODS.has(m)) return null;

      if (m === "POST") {
        if (!taskId) {
          if (subAction && COPY_ACTIONS.has(subAction)) {
            return { kind: "copy", taskId: null };
          }
          return { kind: "create", taskId: null };
        }
        if (!subAction || COPY_ACTIONS.has(subAction)) {
          return { kind: "copy", taskId };
        }
        return { kind: "copy", taskId };
      }

      if ((m === "PUT" || m === "PATCH") && taskId) {
        if (subAction && COPY_ACTIONS.has(subAction)) {
          return { kind: "copy", taskId };
        }
        return { kind: "edit", taskId };
      }

      return null;
    } catch {
      return null;
    }
  }

  function logTaskApiRequest(method, url, meta) {
    try {
      const u = new URL(url, location.origin);
      if (!isTaskApiUrl(u.pathname)) return;
      const tag = meta ? `[${meta.kind}]` : "[skip]";
      console.log(`[PH Sniffer] ${tag} ${method} ${u.pathname}`);
    } catch {
      /* ignore */
    }
  }

  function hasExtensionHeader(headers) {
    if (!headers) return false;
    if (headers instanceof Headers) return headers.get(EXT_HDR) === "1";
    if (Array.isArray(headers)) {
      return headers.some(([k, v]) => String(k).toLowerCase() === EXT_HDR && String(v) === "1");
    }
    for (const [k, v] of Object.entries(headers)) {
      if (String(k).toLowerCase() === EXT_HDR && String(v) === "1") return true;
    }
    return false;
  }

  function parseJsonSafe(text) {
    if (text == null || text === "") return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  function emitCapture(detail) {
    document.dispatchEvent(new CustomEvent("ph-request-captured", { detail }));
  }

  function capture(meta, method, url, bodyText, status, responseText) {
    emitCapture({
      kind: meta.kind,
      method: String(method || "GET").toUpperCase(),
      url: String(url),
      taskId: meta.taskId,
      host: location.origin,
      capturedAt: new Date().toISOString(),
      status: status ?? null,
      requestBody: parseJsonSafe(bodyText),
      responseBody: parseJsonSafe(responseText),
    });
  }

  async function readFetchBody(init) {
    if (!init?.body) return null;
    if (typeof init.body === "string") return init.body;
    if (init.body instanceof URLSearchParams) return init.body.toString();
    try {
      return await new Response(init.body).text();
    } catch {
      return null;
    }
  }

  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    const url = typeof input === "string" ? input : input?.url || "";
    const method = (init?.method || input?.method || "GET").toUpperCase();
    const meta = parseCaptureMeta(method, url);
    logTaskApiRequest(method, url, meta);
    const skip = meta && hasExtensionHeader(init?.headers);
    const bodyText = meta && !skip ? await readFetchBody(init) : null;

    const res = await origFetch.apply(this, arguments);

    if (meta && !skip) {
      let responseText = null;
      try {
        responseText = await res.clone().text();
      } catch {
        responseText = null;
      }
      capture(meta, method, url, bodyText, res.status, responseText);
    }
    return res;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__phMethod = method;
    this.__phUrl = url;
    this.__phExt = false;
    return origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (String(name).toLowerCase() === EXT_HDR && String(value) === "1") {
      this.__phExt = true;
    }
    return origSetHeader.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function (body) {
    const meta = parseCaptureMeta(this.__phMethod, this.__phUrl);
    logTaskApiRequest(this.__phMethod, this.__phUrl, meta);

    let bodyText = null;
    if (meta && body != null) {
      if (typeof body === "string") bodyText = body;
      else if (body instanceof URLSearchParams) bodyText = body.toString();
    }

    if (meta && !this.__phExt) {
      this.addEventListener(
        "load",
        () => {
          capture(
            meta,
            this.__phMethod,
            this.__phUrl,
            bodyText,
            this.status,
            this.responseText
          );
        },
        { once: true }
      );
    }
    return origSend.apply(this, arguments);
  };

  window.dispatchEvent(new CustomEvent("ph-page-hook-ready"));
  document.dispatchEvent(new CustomEvent("ph-page-hook-ready"));
})();
