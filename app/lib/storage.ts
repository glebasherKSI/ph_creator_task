/** Перехваченные запросы, раскладки канвы и шаблоны канвы в chrome.storage.local. */
import { browser } from "wxt/browser";

import {
  DEFAULT_MAX_REQUESTS,
  LAYOUT_KEY_PREFIX,
  MAX_CANVAS_TEMPLATES_PER_DOMAIN,
  STORAGE_KEYS,
} from "./constants";
import type { GamificationTasksCondition, TaskLike } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Перехват запросов (sniffer)
// ---------------------------------------------------------------------------

export interface CaptureEntry {
  id: string;
  kind: string;
  method: string;
  url: string;
  host: string | null;
  status: number | null;
  requestBody: unknown;
  responseBody: unknown;
  capturedAt: string;
  taskId: number | string | null;
}

export async function getMaxRequests(): Promise<number> {
  const stored = await browser.storage.local.get(STORAGE_KEYS.MAX_REQUESTS);
  const n = Number(stored[STORAGE_KEYS.MAX_REQUESTS]);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_REQUESTS;
  return Math.min(Math.floor(n), 5000);
}

export async function loadCapturedRequests(): Promise<CaptureEntry[]> {
  const stored = await browser.storage.local.get(STORAGE_KEYS.REQUESTS);
  const value = stored[STORAGE_KEYS.REQUESTS];
  return Array.isArray(value) ? (value as CaptureEntry[]) : [];
}

export async function isCaptureEnabled(): Promise<boolean> {
  const stored = await browser.storage.local.get(STORAGE_KEYS.CAPTURE_ENABLED);
  return stored[STORAGE_KEYS.CAPTURE_ENABLED] !== false;
}

export function normalizeCaptureEntry(raw: unknown): CaptureEntry | null {
  if (!isRecord(raw)) return null;
  const kind = raw.kind;
  if (!kind) return null;
  return {
    id: String(raw.id || `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`),
    kind: String(kind),
    method: String(raw.method || "GET"),
    url: String(raw.url || ""),
    host: raw.host ? String(raw.host) : null,
    status: raw.status == null ? null : Number(raw.status),
    requestBody: raw.requestBody ?? null,
    responseBody: raw.responseBody ?? null,
    capturedAt: String(raw.capturedAt || new Date().toISOString()),
    taskId: (raw.taskId as number | string | null | undefined) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Раскладка канвы (позиции карточек) по домену
// ---------------------------------------------------------------------------

export interface CanvasPosition {
  x: number;
  y: number;
  headerColor?: string;
  localOnly?: boolean;
  configuredOnBackend?: boolean;
  [key: string]: unknown;
}

export interface ChainsLayout {
  positions: Record<string, CanvasPosition>;
  [key: string]: unknown;
}

export function chainsLayoutKey(domain: string): string {
  return `${LAYOUT_KEY_PREFIX}${domain}`;
}

export async function loadChainsLayout(domain: string): Promise<ChainsLayout> {
  const key = chainsLayoutKey(domain);
  const stored = await browser.storage.local.get(key);
  const value = stored[key];
  return isRecord(value) ? (value as ChainsLayout) : { positions: {} };
}

export async function saveChainsLayout(
  domain: string,
  positions: Record<string, CanvasPosition>,
): Promise<void> {
  await browser.storage.local.set({ [chainsLayoutKey(domain)]: { positions } });
}

// ---------------------------------------------------------------------------
// Шаблоны канвы по домену
// ---------------------------------------------------------------------------

export interface CanvasEdge {
  from: string;
  to: string;
}

export interface CanvasViewport {
  x: number;
  y: number;
  scale: number;
}

export interface CanvasLabel {
  id: string;
  x: number;
  y: number;
  text: string;
  [key: string]: unknown;
}

/** Формат хранения — как в старом расширении; менять только через явную миграцию. */
export interface CanvasTemplate {
  id: string;
  name: string;
  domain: string;
  createdAt: string;
  updatedAt: string;
  canvas: Record<string, CanvasPosition>;
  edges: CanvasEdge[];
  targetConfigs: Record<string, Partial<GamificationTasksCondition>>;
  labels: CanvasLabel[];
  viewport: CanvasViewport;
  /** Тела локальных черновиков (ещё не созданных на бэке). */
  taskBodies?: Record<string, TaskLike>;
  sourceDomain?: string;
  sourceTemplateId?: string;
  sourceTaskId?: string;
  isLocalDraftTemplate?: boolean;
}

export type CanvasTemplatesStore = Record<string, CanvasTemplate[]>;

export async function loadCanvasTemplatesStore(): Promise<CanvasTemplatesStore> {
  const stored = await browser.storage.local.get(STORAGE_KEYS.CANVAS_TEMPLATES);
  const value = stored[STORAGE_KEYS.CANVAS_TEMPLATES];
  return isRecord(value) ? (value as CanvasTemplatesStore) : {};
}

export async function saveCanvasTemplatesStore(store: CanvasTemplatesStore): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEYS.CANVAS_TEMPLATES]: store });
}

export async function getDomainCanvasTemplates(domain: string): Promise<CanvasTemplate[]> {
  const store = await loadCanvasTemplatesStore();
  const list = store[domain];
  return Array.isArray(list) ? [...list] : [];
}

/**
 * Добавляет или обновляет шаблон: по id, иначе по имени (перезапись одноимённого).
 * Новый шаблон сверх лимита — ошибка.
 */
export async function upsertDomainCanvasTemplate(
  domain: string,
  template: CanvasTemplate,
): Promise<CanvasTemplate> {
  const store = await loadCanvasTemplatesStore();
  const list = Array.isArray(store[domain]) ? [...store[domain]!] : [];
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

  list.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  store[domain] = list;
  await saveCanvasTemplatesStore(store);
  return template;
}

export async function deleteDomainCanvasTemplate(
  domain: string,
  templateId: string,
): Promise<boolean> {
  const store = await loadCanvasTemplatesStore();
  const list = Array.isArray(store[domain]) ? store[domain]! : [];
  const next = list.filter((item) => item.id !== templateId);
  if (next.length === list.length) return false;
  if (next.length) store[domain] = next;
  else delete store[domain];
  await saveCanvasTemplatesStore(store);
  return true;
}

// ---------------------------------------------------------------------------
// Проект Promo Graphic, выбранный для домена в «Отправить в пакет»
// ---------------------------------------------------------------------------

async function loadGraphicProjectsByDomain(): Promise<Record<string, string>> {
  const stored = await browser.storage.local.get(STORAGE_KEYS.GRAPHIC_PROJECT_BY_DOMAIN);
  const value = stored[STORAGE_KEYS.GRAPHIC_PROJECT_BY_DOMAIN];
  return isRecord(value) ? (value as Record<string, string>) : {};
}

export async function getGraphicProjectForDomain(domain: string): Promise<string> {
  const map = await loadGraphicProjectsByDomain();
  return typeof map[domain] === "string" ? map[domain] : "";
}

export async function setGraphicProjectForDomain(
  domain: string,
  projectCode: string,
): Promise<void> {
  if (!domain) return;
  const map = await loadGraphicProjectsByDomain();
  map[domain] = projectCode;
  await browser.storage.local.set({ [STORAGE_KEYS.GRAPHIC_PROJECT_BY_DOMAIN]: map });
}
