import { STORAGE_KEYS, DEFAULT_DOMAIN } from "./constants.js";

export function normalizeDomain(input) {
  const trimmed = String(input || "").trim();
  if (!trimmed) return null;

  try {
    const url = trimmed.includes("://") ? new URL(trimmed) : new URL(`https://${trimmed}`);
    if (url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    if (!host) return null;
    return host;
  } catch {
    const host = trimmed
      .replace(/^https?:\/\//i, "")
      .split("/")[0]
      .split(":")[0]
      .toLowerCase();
    if (!host || !/^[a-z0-9.-]+$/i.test(host)) return null;
    return host;
  }
}

/** Для editor/chains: пустая строка вместо null при невалидном вводе. */
export function normalizeDomainOrEmpty(input) {
  return normalizeDomain(input) || "";
}

export function originPattern(host) {
  return `https://${host}/*`;
}

export function hostFromUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export function hostFromRequest(req) {
  if (req.host) {
    try {
      return new URL(req.host).hostname;
    } catch {
      return String(req.host).replace(/^https?:\/\//, "").split("/")[0];
    }
  }
  if (req.url) {
    try {
      return new URL(req.url).hostname;
    } catch {
      return "";
    }
  }
  return "";
}

export async function loadDomainsFromStorage() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.DOMAINS);
  return Array.isArray(stored[STORAGE_KEYS.DOMAINS]) ? [...stored[STORAGE_KEYS.DOMAINS]] : [];
}

export async function saveDomainsToStorage(domains) {
  await chrome.storage.local.set({ [STORAGE_KEYS.DOMAINS]: domains });
}

export async function ensureDefaultDomainsInStorage() {
  const domains = await loadDomainsFromStorage();
  if (domains.length > 0) return domains;
  const next = [DEFAULT_DOMAIN];
  await saveDomainsToStorage(next);
  return next;
}

export async function refreshDomainPermissions(domains) {
  const map = {};
  for (const host of domains) {
    map[host] = await chrome.permissions.contains({ origins: [originPattern(host)] });
  }
  return map;
}

export async function requestDomainPermission(host) {
  return chrome.permissions.request({ origins: [originPattern(host)] });
}

export async function removeDomainPermission(host) {
  try {
    const has = await chrome.permissions.contains({ origins: [originPattern(host)] });
    if (has) {
      await chrome.permissions.remove({ origins: [originPattern(host)] });
    }
  } catch {
    /* optional permission may not be removable */
  }
}

export function fillDomainSelect(selectEl, domains, selected = "") {
  selectEl.innerHTML = "";
  for (const domain of domains) {
    const opt = document.createElement("option");
    opt.value = domain;
    opt.textContent = domain;
    selectEl.appendChild(opt);
  }
  const value = selected || domains[0] || "";
  selectEl.value = value;
  return value;
}
