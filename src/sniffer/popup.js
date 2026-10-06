import { STORAGE_KEYS } from "../shared/constants.js";
import {
  GRAPHIC_DEFAULT_BASE_URL,
  graphicLoginFromPage,
  graphicLogoutFromPage,
  graphicStatusFromPage,
} from "../shared/graphic-api.js";

import {

  normalizeDomain,

  loadDomainsFromStorage,

  saveDomainsToStorage,

  ensureDefaultDomainsInStorage,

  refreshDomainPermissions,

  requestDomainPermission,

  removeDomainPermission,

} from "../shared/domains.js";

import { injectOnDomainTabs } from "../shared/content-script.js";

import { sendAuthMessage, awaitingMagicLinkStorageKey, pendingOtpStorageKey } from "../shared/auth.js";



let domains = [];

let domainPermissions = {};

let authStatuses = {};



const $ = (id) => document.getElementById(id);



async function loadDomains() {

  domains = await loadDomainsFromStorage();

}



async function ensureDefaultDomains() {

  if (domains.length > 0) return;

  domains = await ensureDefaultDomainsInStorage();

}



async function saveDomains() {

  await saveDomainsToStorage(domains);

}



async function refreshPermissions() {

  domainPermissions = await refreshDomainPermissions(domains);

}



function setStatus(text) {

  const el = $("status");

  if (!text) {

    el.hidden = true;

    el.textContent = "";

    return;

  }

  el.hidden = false;

  el.textContent = text;

}



function formatAuthLabel(auth) {

  if (auth?.authenticated) return "вход";

  if (auth?.pendingOtp) return "otp";

  if (auth?.awaitingMagicLink) return "link";

  return "нет";

}



function formatAuthTitle(auth) {

  if (auth?.authenticated) {

    return auth.email ? `Вход выполнен (${auth.email})` : "Вход выполнен";

  }

  if (auth?.pendingOtp) return "Magic link принят — ожидание OTP";

  if (auth?.awaitingMagicLink) return "Ожидание magic link";

  return "Вход не выполнен";

}



function renderDomains() {

  const list = $("domain-list");

  if (!domains.length) {

    list.innerHTML = '<li class="domain-empty">Нет сохранённых админок</li>';

    return;

  }



  list.innerHTML = "";

  for (const host of domains) {

    const li = document.createElement("li");

    li.className = "domain-item";



    const granted = domainPermissions[host];

    const permClass = granted ? "domain-item__perm--ok" : "domain-item__perm--warn";

    const permTitle = granted

      ? "Доступ разрешён"

      : "Нет доступа — добавьте домен снова для запроса разрешения";

    const auth = authStatuses[host];

    const authClass = auth?.authenticated
      ? "domain-item__auth--ok"
      : auth?.pendingOtp || auth?.awaitingMagicLink
        ? "domain-item__auth--pending"
        : "";

    const authLabel = formatAuthLabel(auth);

    const authTitle = formatAuthTitle(auth);



    li.innerHTML = `

      <span class="domain-item__perm ${permClass}" title="${permTitle}"></span>

      <span class="domain-item__host">${host}</span>

      <span class="domain-item__auth ${authClass}" title="${authTitle}">${authLabel}</span>

      <button class="btn btn--icon js-remove-domain" type="button" title="Удалить" aria-label="Удалить ${host}">×</button>

    `;



    li.querySelector(".js-remove-domain").addEventListener("click", () => {

      removeDomain(host);

    });



    list.appendChild(li);

  }

}



async function refreshAuthStatuses() {

  authStatuses = {};

  await Promise.all(

    domains.map(async (host) => {

      try {

        const response = await sendAuthMessage("PH_AUTH_STATUS", { domain: host });

        if (response?.ok !== false) authStatuses[host] = response;

      } catch {

        authStatuses[host] = { authenticated: false, pendingOtp: false };

      }

    })

  );

  renderDomains();

}



async function addDomain(rawInput) {

  const host = normalizeDomain(rawInput);

  if (!host) {

    setStatus("Некорректный домен. Укажите host вида admin.example.com");

    return false;

  }

  if (domains.includes(host)) {

    setStatus(`Домен ${host} уже в списке`);

    return false;

  }



  const granted = await requestDomainPermission(host);

  domains.push(host);

  await saveDomains();

  domainPermissions[host] = granted;



  if (granted) {

    await injectOnDomainTabs(host);

    setStatus(`Домен ${host} добавлен, доступ разрешён`);

  } else {

    setStatus(`Домен ${host} сохранён, но доступ не выдан — API из конструктора недоступен`);

  }



  renderDomains();

  await refreshAuthStatuses();

  return true;

}



async function removeDomain(host) {

  domains = domains.filter((d) => d !== host);

  await saveDomains();

  await removeDomainPermission(host);

  delete domainPermissions[host];

  renderDomains();

  setStatus(`Домен ${host} удалён`);

}



async function addCurrentTabDomain() {

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.url) {

    setStatus("Не удалось определить текущую вкладку");

    return;

  }



  const host = normalizeDomain(tab.url);

  if (!host) {

    setStatus("Текущая вкладка не https-админка");

    return;

  }



  if (tab.url.startsWith("http://")) {

    setStatus("Поддерживаются только https-домены");

    return;

  }



  await addDomain(host);

}



async function openConstructor() {

  const url = chrome.runtime.getURL("src/chains/chains.html");

  await chrome.tabs.create({ url });

}



function graphicUserLabel(user) {
  if (!user || typeof user !== "object") return "";
  return String(user.username || user.email || user.login || "").trim();
}

function graphicHostLabel(baseUrl) {
  try {
    return new URL(baseUrl).host;
  } catch {
    return String(baseUrl || "");
  }
}

function setGraphicPopupError(text) {
  const el = $("graphic-popup-error");
  el.textContent = text || "";
  el.hidden = !text;
}

function applyGraphicPopupStatus(status) {
  const authenticated = Boolean(status?.authenticated);
  const baseUrl = status?.baseUrl || GRAPHIC_DEFAULT_BASE_URL;
  const host = graphicHostLabel(baseUrl);
  const name = graphicUserLabel(status?.user) || "Вход выполнен";

  const badge = $("graphic-popup-badge");
  badge.textContent = authenticated ? "Подключено" : "Не в сети";
  badge.classList.toggle("badge--ok", authenticated);

  $("graphic-popup-session").hidden = !authenticated;
  $("graphic-popup-login").hidden = authenticated;
  $("graphic-popup-user").textContent = name;
  $("graphic-popup-avatar").textContent = name.charAt(0).toUpperCase();
  $("graphic-popup-host").textContent = host;
  $("graphic-popup-server").textContent = host;

  const urlEl = $("graphic-popup-url");
  if (authenticated || !urlEl.value) urlEl.value = baseUrl;
}

async function refreshGraphicPopup() {
  const status = await graphicStatusFromPage();
  applyGraphicPopupStatus(status);
}

async function handleGraphicPopupLogin(ev) {
  ev?.preventDefault();
  const login = $("graphic-popup-login-input").value.trim();
  const password = $("graphic-popup-password").value;
  const baseUrl = $("graphic-popup-url").value.trim() || GRAPHIC_DEFAULT_BASE_URL;
  if (!login || !password) {
    setGraphicPopupError("Укажите логин и пароль");
    (login ? $("graphic-popup-password") : $("graphic-popup-login-input")).focus();
    return;
  }

  const btn = $("btn-graphic-popup-login");
  btn.disabled = true;
  btn.textContent = "Вхожу…";
  setGraphicPopupError("");
  try {
    const status = await graphicLoginFromPage(login, password, baseUrl);
    $("graphic-popup-password").value = "";
    applyGraphicPopupStatus(status);
  } catch (err) {
    const message = err?.message || String(err);
    setGraphicPopupError(message);
    // Сервер недоступен — сразу раскрываем поле с адресом.
    if (/fetch|network|сервер|адрес|url/i.test(message)) {
      $("graphic-popup-login").querySelector(".graphic-server").open = true;
    }
  } finally {
    btn.disabled = false;
    btn.textContent = "Войти";
  }
}

async function handleGraphicPopupLogout() {
  try {
    const status = await graphicLogoutFromPage();
    applyGraphicPopupStatus(status);
    setGraphicPopupError("");
  } catch (err) {
    setGraphicPopupError(err?.message || String(err));
  }
}

async function init() {

  const manifest = chrome.runtime.getManifest();

  $("app-version").textContent = `V${manifest.version}`;



  await loadDomains();

  await ensureDefaultDomains();

  await refreshPermissions();

  renderDomains();

  await refreshAuthStatuses();

  await refreshGraphicPopup();

}



$("btn-add-domain").addEventListener("click", async () => {

  const input = $("domain-input");

  const ok = await addDomain(input.value);

  if (ok) input.value = "";

});



$("domain-input").addEventListener("keydown", async (e) => {

  if (e.key !== "Enter") return;

  e.preventDefault();

  const input = $("domain-input");

  const ok = await addDomain(input.value);

  if (ok) input.value = "";

});



$("btn-add-tab").addEventListener("click", addCurrentTabDomain);

$("btn-open-constructor").addEventListener("click", openConstructor);

$("graphic-popup-login").addEventListener("submit", (ev) => void handleGraphicPopupLogin(ev));

$("btn-graphic-popup-logout").addEventListener("click", () => void handleGraphicPopupLogout());



chrome.storage.onChanged.addListener((changes, area) => {

  if (area !== "local") return;

  if (changes[STORAGE_KEYS.DOMAINS]) {

    domains = changes[STORAGE_KEYS.DOMAINS].newValue || [];

    refreshDomainPermissions(domains).then(async (map) => {

      domainPermissions = map;

      renderDomains();

      await refreshAuthStatuses();

    });

  }

  if (changes[STORAGE_KEYS.AUTH_SESSIONS]) {

    refreshAuthStatuses();

    return;

  }

  if (changes[STORAGE_KEYS.GRAPHIC_AUTH] || changes[STORAGE_KEYS.GRAPHIC_BASE_URL]) {
    void refreshGraphicPopup();
  }



  const authFlowChanged = domains.some(

    (host) => changes[pendingOtpStorageKey(host)] || changes[awaitingMagicLinkStorageKey(host)]

  );

  if (authFlowChanged) {

    refreshAuthStatuses();

  }

});



init();

