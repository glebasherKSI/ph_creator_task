// Шим `chrome` для витрины, открытой как обычная страница (статический сервер, скриншоты).
// Внутри расширения chrome.runtime.id есть — шим ничего не делает.
// Обычный <script> до модульных: иначе общий чанк с wxt/browser выполнится раньше.
(function () {
  if (globalThis.chrome && globalThis.chrome.runtime && globalThis.chrome.runtime.id) return;
  var noopEvent = { addListener: function () {}, removeListener: function () {} };
  var emptyStorage = {
    get: function () {
      return Promise.resolve({});
    },
    set: function () {
      return Promise.resolve();
    },
    remove: function () {
      return Promise.resolve();
    },
  };
  globalThis.chrome = {
    runtime: {
      id: "showcase-dev",
      getURL: function (path) {
        return new URL(String(path).replace(/^\//, ""), location.href).toString();
      },
      getManifest: function () {
        return { version: "dev" };
      },
      sendMessage: function () {
        return Promise.resolve(undefined);
      },
      onMessage: noopEvent,
    },
    storage: { local: emptyStorage, session: emptyStorage, onChanged: noopEvent },
    tabs: {
      query: function () {
        return Promise.resolve([]);
      },
      create: function () {
        return Promise.resolve(undefined);
      },
      onRemoved: noopEvent,
      onUpdated: noopEvent,
    },
    permissions: {
      contains: function () {
        return Promise.resolve(false);
      },
      request: function () {
        return Promise.resolve(false);
      },
      remove: function () {
        return Promise.resolve();
      },
    },
    cookies: {
      get: function () {
        return Promise.resolve(null);
      },
      set: function () {
        return Promise.resolve(null);
      },
      remove: function () {
        return Promise.resolve(null);
      },
    },
  };
})();
