import {
  STORAGE_KEYS,
  DEFAULT_MAX_REQUESTS,
  LAYOUT_KEY_PREFIX,
  MAX_CANVAS_TEMPLATES_PER_DOMAIN,
} from "./constants.js";

export async function getMaxRequests() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.MAX_REQUESTS);
  const n = Number(stored[STORAGE_KEYS.MAX_REQUESTS]);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_REQUESTS;
  return Math.min(Math.floor(n), 5000);
}

export async function loadCapturedRequests() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.REQUESTS);
  return Array.isArray(stored[STORAGE_KEYS.REQUESTS]) ? stored[STORAGE_KEYS.REQUESTS] : [];
}

export async function isCaptureEnabled() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.CAPTURE_ENABLED);
  return stored[STORAGE_KEYS.CAPTURE_ENABLED] !== false;
}

export function normalizeCaptureEntry(raw) {
  if (!raw || typeof raw !== "object") return null;
  const kind = raw.kind;
  if (!kind) return null;
  return {
    id: raw.id || `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    kind,
    method: raw.method || "GET",
    url: raw.url || "",
    host: raw.host || null,
    status: raw.status ?? null,
    requestBody: raw.requestBody ?? null,
    responseBody: raw.responseBody ?? null,
    capturedAt: raw.capturedAt || new Date().toISOString(),
    taskId: raw.taskId ?? null,
  };
}

export function chainsLayoutKey(domain) {
  return `${LAYOUT_KEY_PREFIX}${domain}`;
}

export async function loadChainsLayout(domain) {
  const key = chainsLayoutKey(domain);
  const stored = await chrome.storage.local.get(key);
  return stored[key] && typeof stored[key] === "object" ? stored[key] : { positions: {} };
}

export async function saveChainsLayout(domain, positions) {
  const key = chainsLayoutKey(domain);
  await chrome.storage.local.set({ [key]: { positions } });
}

async function readStorageValue(key) {
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    const stored = await chrome.storage.local.get(key);
    return stored[key];
  }
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

async function writeStorageValue(key, value) {
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    await chrome.storage.local.set({ [key]: value });
    return;
  }
  localStorage.setItem(key, JSON.stringify(value));
}

export async function loadCanvasTemplatesStore() {
  const stored = await readStorageValue(STORAGE_KEYS.CANVAS_TEMPLATES);
  return stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
}

export async function saveCanvasTemplatesStore(store) {
  await writeStorageValue(STORAGE_KEYS.CANVAS_TEMPLATES, store);
}

export async function getDomainCanvasTemplates(domain) {
  const store = await loadCanvasTemplatesStore();
  return Array.isArray(store[domain]) ? [...store[domain]] : [];
}

export async function upsertDomainCanvasTemplate(domain, template) {
  const store = await loadCanvasTemplatesStore();
  const list = Array.isArray(store[domain]) ? [...store[domain]] : [];
  const idx = list.findIndex((item) => item.id === template.id);
  const nameIdx = list.findIndex((item) => item.name === template.name && item.id !== template.id);

  if (idx >= 0) {
    list[idx] = template;
  } else if (nameIdx >= 0) {
    list[nameIdx] = template;
  } else {
    if (list.length >= MAX_CANVAS_TEMPLATES_PER_DOMAIN) {
      throw new Error(`Достигнут лимит: ${MAX_CANVAS_TEMPLATES_PER_DOMAIN} шаблонов на домен`);
    }
    list.push(template);
  }

  list.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  store[domain] = list;
  await saveCanvasTemplatesStore(store);
  return template;
}

export async function deleteDomainCanvasTemplate(domain, templateId) {
  const store = await loadCanvasTemplatesStore();
  const list = Array.isArray(store[domain]) ? store[domain] : [];
  const next = list.filter((item) => item.id !== templateId);
  if (next.length === list.length) return false;
  if (next.length) store[domain] = next;
  else delete store[domain];
  await saveCanvasTemplatesStore(store);
  return true;
}
