/**
 * Группы игроков админки → БД Promo Graphic: по ним график знает название группы и проект,
 * которому она принадлежит. Источник — условие «Группы» в схеме условий (conditions-schema).
 *
 * Весь список (сотни групп) не гоняется при каждой загрузке схемы:
 * - версия списка — sha256 канонического вида (groupsHash), тот же алгоритм на бэке
 *   (utils/promohub_groups_repo.py, groups_hash);
 * - последний отправленный список хранится локально по домену; совпала версия и проект —
 *   запроса нет (раз в сутки — только короткая проверка версии);
 * - изменилось — уходят только добавленные/переименованные и удалённые группы;
 * - бэк отвечает conflict (на сервере другая версия или локального снимка нет) — тогда весь список.
 * Синхронизация фоновая: без входа в график или при сбое сети только предупреждение в консоли.
 */
import { browser } from "wxt/browser";

import { errorMessage } from "./auth/errors";
import { GRAPHIC_GROUPS_KEY_PREFIX } from "./constants";
import { graphicApiPost } from "./graphic-api";
import { getGraphicProjectForDomain } from "./storage";

const SYNC_PATH = "/api/promohub-planner/groups/sync";
/** Совпадение с локальным снимком перепроверяется на бэке не чаще раза в сутки. */
export const GROUPS_RECHECK_MS = 24 * 60 * 60 * 1000;
const GROUP_ID_RE = /^[\x21-\x7e]{1,64}$/;
const GROUP_NAME_MAX = 255;
const LONE_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export interface GroupItem {
  id: string;
  name: string;
}

export interface GroupsSyncRecord {
  hash: string;
  projectCode: string;
  groups: Record<string, string>;
  checkedAt: number;
}

interface SyncResponse {
  status?: string;
}

/**
 * Список из схемы → id → название. Бэк хранит название как есть и считает по нему версию,
 * поэтому вся нормализация здесь: обрезка пробелов, битые суррогаты, не длиннее 255 символов.
 */
export function normalizeGroups(
  collection: ReadonlyArray<{ id: unknown; name: unknown }> | null | undefined,
): Map<string, string> {
  const groups = new Map<string, string>();
  for (const item of collection ?? []) {
    const id = String(item.id ?? "").trim();
    if (!GROUP_ID_RE.test(id)) continue;
    const name = String(item.name ?? "")
      .replace(LONE_SURROGATE_RE, "�")
      .trim();
    groups.set(id, Array.from(name).slice(0, GROUP_NAME_MAX).join(""));
  }
  return groups;
}

/** sha256 строк «id<TAB>название<LF>», отсортированных по id (id — ASCII). */
export async function groupsHash(groups: ReadonlyMap<string, string>): Promise<string> {
  const text = [...groups.keys()]
    .sort()
    .map((id) => `${id}\t${groups.get(id)}\n`)
    .join("");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Что отправить относительно прошлого снимка: новые и переименованные, пропавшие. */
export function diffGroups(
  prev: Readonly<Record<string, string>>,
  next: ReadonlyMap<string, string>,
): { upsert: GroupItem[]; remove: string[] } {
  const upsert: GroupItem[] = [];
  for (const [id, name] of next) {
    if (prev[id] !== name) upsert.push({ id, name });
  }
  const remove = Object.keys(prev).filter((id) => !next.has(id));
  return { upsert, remove };
}

function recordKey(domain: string): string {
  return `${GRAPHIC_GROUPS_KEY_PREFIX}${domain}`;
}

async function loadRecord(domain: string): Promise<GroupsSyncRecord | null> {
  const key = recordKey(domain);
  const value = (await browser.storage.local.get(key))[key] as GroupsSyncRecord | undefined;
  return value && typeof value.hash === "string" && value.groups ? value : null;
}

async function postSync(body: Record<string, unknown>): Promise<string> {
  const data = (await graphicApiPost(SYNC_PATH, body)) as SyncResponse | null;
  return String(data?.status ?? "");
}

async function runSync(
  domain: string,
  collection: ReadonlyArray<{ id: unknown; name: unknown }>,
): Promise<void> {
  const groups = normalizeGroups(collection);
  const [hash, projectCode, prev] = await Promise.all([
    groupsHash(groups),
    getGraphicProjectForDomain(domain),
    loadRecord(domain),
  ]);
  const now = Date.now();
  if (
    prev?.hash === hash &&
    prev.projectCode === projectCode &&
    now - prev.checkedAt < GROUPS_RECHECK_MS
  ) {
    return;
  }

  const base = { domain, project_code: projectCode || null, hash };
  // Без снимка — проба одной версией: другой пользователь мог уже отправить тот же список.
  let status = await postSync(
    prev ? { ...base, base_hash: prev.hash, ...diffGroups(prev.groups, groups) } : base,
  );
  if (status === "conflict") {
    const upsert = Array.from(groups, ([id, name]) => ({ id, name }));
    status = await postSync({ ...base, full: true, upsert });
  }
  if (status !== "applied" && status !== "unchanged") {
    throw new Error(`Неожиданный ответ синхронизации групп: ${status || "пусто"}`);
  }
  const record: GroupsSyncRecord = {
    hash,
    projectCode,
    groups: Object.fromEntries(groups),
    checkedAt: now,
  };
  await browser.storage.local.set({ [recordKey(domain)]: record });
}

const inflight = new Map<string, Promise<void>>();

/**
 * Фоновая синхронизация групп админки с графиком. Параллельный вызов для того же домена
 * ждёт уже идущий: следующая загрузка схемы досинхронизирует, если список успел измениться.
 */
export function syncGraphicGroups(
  domain: string,
  collection: ReadonlyArray<{ id: unknown; name: unknown }> | null | undefined,
): Promise<void> {
  const key = String(domain || "")
    .trim()
    .toLowerCase();
  if (!key || !collection) return Promise.resolve();
  const running = inflight.get(key);
  if (running) return running;
  const task = runSync(key, collection)
    .catch((err) => console.warn("[graphic-groups] не синхронизировано:", errorMessage(err)))
    .finally(() => inflight.delete(key));
  inflight.set(key, task);
  return task;
}
