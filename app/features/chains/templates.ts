/**
 * Шаблоны канвы — чистая часть: сериализация текущей канвы в `CanvasTemplate` (формат хранения
 * старого расширения), план раскладки шаблона на канву, восстановление рёбер и настроек,
 * сборка локальных черновиков для копирования на другой проект. Без chrome.* и React.
 */
import { normalizeTaskNameForMatch } from "@/lib/reports";
import type { CanvasLabel, CanvasPosition, CanvasTemplate, CanvasViewport } from "@/lib/storage";
import { cloneJson, normalizeGamificationTasksCondition } from "@/lib/tasks";
import type { GamificationTasksCondition, TaskLike } from "@/lib/types";

import {
  type CanvasEdge,
  type CanvasTask,
  type GraphState,
  type GtConfig,
  DEFAULT_GT_CONFIG,
  newLocalDraftId,
  syncConditionsFromEdges,
} from "./graph";
import { GRID_START_X, GRID_START_Y } from "./layout";
import { type CatalogTask, HEADER_COLORS } from "./store";

export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 2;

export interface FlowViewport {
  x: number;
  y: number;
  zoom: number;
}

export function newTemplateId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function formatTemplateDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function normalizeHeaderColorId(value: unknown): string | null {
  const id = String(value ?? "").trim();
  return id && HEADER_COLORS.some((c) => c.id === id) ? id : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Тело задачи для черновика: без служебных полей канвы. */
export function snapshotTaskBodyForDraft(task: TaskLike | null | undefined): TaskLike {
  const raw: TaskLike = isRecord(task) ? cloneJson(task) : {};
  for (const key of [
    "configuredOnBackend",
    "localOnly",
    "notSyncedWithBackend",
    "_full",
    "x",
    "y",
    "headerColor",
  ]) {
    delete raw[key];
  }
  return raw;
}

export function serializeCanvasTaskLayout(task: CanvasTask): CanvasPosition {
  const entry: CanvasPosition = { x: task.x, y: task.y };
  const colorId = normalizeHeaderColorId(task.headerColor);
  if (colorId) entry.headerColor = colorId;
  if (task.localOnly) {
    entry.localOnly = true;
    entry.configuredOnBackend = false;
  } else if (task.configuredOnBackend) {
    entry.configuredOnBackend = true;
  }
  return entry;
}

export function serializeTargetConfig(cfg: GtConfig): Partial<GamificationTasksCondition> {
  return { type: cfg.type, extra_type: cfg.extra_type, only_completed: cfg.only_completed };
}

/** Настройки связи из шаблона (там может лежать полный блок gamification_tasks со списком). */
export function gtConfigFromTemplate(raw: unknown): GtConfig {
  if (!isRecord(raw)) return { ...DEFAULT_GT_CONFIG };
  const normalized = normalizeGamificationTasksCondition(
    raw as Partial<GamificationTasksCondition>,
  );
  return {
    type: normalized.type,
    extra_type: normalized.extra_type,
    only_completed: normalized.only_completed,
  };
}

export interface TemplateSource {
  domain: string;
  canvas: Record<string, CanvasTask>;
  edges: CanvasEdge[];
  targetConfigs: Record<string, GtConfig>;
  labels: CanvasLabel[];
  viewport: CanvasViewport;
}

export interface SerializeTemplateOptions {
  existingId?: string | null;
  createdAt?: string | null;
  now?: string;
}

/** Текущая канва → шаблон. Тела локальных черновиков уходят в `taskBodies`. */
export function serializeCanvasTemplate(
  source: TemplateSource,
  name: string,
  {
    existingId = null,
    createdAt = null,
    now = new Date().toISOString(),
  }: SerializeTemplateOptions = {},
): CanvasTemplate {
  const canvas: Record<string, CanvasPosition> = {};
  const taskBodies: Record<string, TaskLike> = {};
  for (const [id, task] of Object.entries(source.canvas)) {
    canvas[id] = serializeCanvasTaskLayout(task);
    if (task.localOnly && task.full) taskBodies[id] = snapshotTaskBodyForDraft(task.full);
  }
  const targetConfigs: CanvasTemplate["targetConfigs"] = {};
  for (const [id, cfg] of Object.entries(source.targetConfigs)) {
    targetConfigs[id] = serializeTargetConfig(cfg);
  }
  const template: CanvasTemplate = {
    id: existingId || newTemplateId(),
    name: String(name ?? "").trim(),
    domain: source.domain,
    createdAt: createdAt || now,
    updatedAt: now,
    canvas,
    edges: source.edges.map((e) => ({ from: e.from, to: e.to })),
    targetConfigs,
    labels: source.labels.map(({ id, text, x, y }) => ({ id, text, x, y })),
    viewport: { ...source.viewport },
  };
  if (Object.keys(taskBodies).length) template.taskBodies = taskBodies;
  return template;
}

export function countTemplateTasks(template: CanvasTemplate | null | undefined): number {
  return isRecord(template?.canvas) ? Object.keys(template.canvas).length : 0;
}

export function countTemplateEdges(template: CanvasTemplate | null | undefined): number {
  return Array.isArray(template?.edges) ? template.edges.length : 0;
}

export function countTemplateLocalDrafts(template: CanvasTemplate | null | undefined): number {
  const bodies = isRecord(template?.taskBodies) ? template.taskBodies : {};
  const canvas = isRecord(template?.canvas) ? template.canvas : {};
  const ids = new Set([
    ...Object.keys(bodies),
    ...Object.keys(canvas).filter((id) => canvas[id]?.localOnly === true),
  ]);
  return ids.size;
}

/** Черновики шаблона (localOnly-задачи без реального id) с их именами из taskBodies. */
export function getTemplateDraftEntries(template: CanvasTemplate): { id: string; name: string }[] {
  const canvas = isRecord(template.canvas) ? template.canvas : {};
  const bodies = isRecord(template.taskBodies) ? template.taskBodies : {};
  const ids = new Set<string>([
    ...Object.keys(bodies),
    ...Object.keys(canvas).filter((id) => canvas[id]?.localOnly === true),
  ]);
  return [...ids].map((id) => ({ id, name: String(bodies[id]?.name ?? "").trim() }));
}

/**
 * Разбирает маркер сезона в конце имени задачи, например «Ивент, лутбоксы Season 3» →
 * `{ base: "Ивент, лутбоксы", season: 3 }`. Маркер должен идти самым последним словом в имени.
 */
export function parseTaskNameSeason(name: string): { base: string; season: number } | null {
  const raw = String(name ?? "").trim();
  const match = /^(.*?)\s*season\s*(\d+)\s*$/i.exec(raw);
  if (!match) return null;
  const base = match[1]!.trim();
  const season = Number(match[2]);
  if (!base || !Number.isFinite(season)) return null;
  return { base, season };
}

export type CatalogNameMatch =
  | { status: "unmatched" }
  | { status: "ambiguous" }
  | { status: "matched"; id: string; season?: number };

/** Ищет в каталоге домена задачу с точно таким же (нормализованным) именем. */
export function findCatalogMatchByName(
  name: string,
  catalog: Record<string, CatalogTask>,
): CatalogNameMatch {
  const target = normalizeTaskNameForMatch(name);
  if (!target) return { status: "unmatched" };
  const matches = Object.values(catalog).filter(
    (meta) => normalizeTaskNameForMatch(meta.name) === target,
  );
  if (!matches.length) return { status: "unmatched" };
  if (matches.length > 1) return { status: "ambiguous" };
  return { status: "matched", id: matches[0]!.id };
}

/**
 * Если имя черновика оканчивается на «… Season N» — ищет в каталоге задачи с тем же базовым
 * именем (без учёта номера сезона в самом черновике) и берёт ту, у которой номер сезона
 * максимальный (последний добавленный сезон). Если маркера сезона нет — обычное сравнение
 * по полному имени (findCatalogMatchByName).
 */
export function findCatalogMatchForDraftName(
  name: string,
  catalog: Record<string, CatalogTask>,
): CatalogNameMatch {
  const seasonInfo = parseTaskNameSeason(name);
  if (!seasonInfo) return findCatalogMatchByName(name, catalog);

  const targetBase = normalizeTaskNameForMatch(seasonInfo.base);
  if (!targetBase) return { status: "unmatched" };

  const bySeason = new Map<number, string[]>();
  for (const meta of Object.values(catalog)) {
    const metaSeasonInfo = parseTaskNameSeason(meta.name);
    if (!metaSeasonInfo) continue;
    if (normalizeTaskNameForMatch(metaSeasonInfo.base) !== targetBase) continue;
    const list = bySeason.get(metaSeasonInfo.season) ?? [];
    list.push(meta.id);
    bySeason.set(metaSeasonInfo.season, list);
  }

  if (!bySeason.size) return { status: "unmatched" };

  const maxSeason = Math.max(...bySeason.keys());
  const candidates = bySeason.get(maxSeason)!;
  if (candidates.length > 1) return { status: "ambiguous" };
  return { status: "matched", id: candidates[0]!, season: maxSeason };
}

export interface TemplateDraftMatch {
  oldId: string;
  newId: string;
  name: string;
  season: number | null;
}

export interface TemplateDraftMatchResult {
  matched: TemplateDraftMatch[];
  ambiguous: { id: string; name: string }[];
  unmatched: { id: string; name: string }[];
}

/**
 * Сопоставляет локальные черновики шаблона с уже созданными на бэке задачами по имени
 * (с учётом маркера «Season N» — см. findCatalogMatchForDraftName).
 * Возвращает matched (можно заменить), ambiguous (несколько кандидатов) и unmatched.
 */
export function buildTemplateDraftMatches(
  template: CanvasTemplate,
  catalog: Record<string, CatalogTask>,
): TemplateDraftMatchResult {
  const canvas = isRecord(template.canvas) ? template.canvas : {};
  const drafts = getTemplateDraftEntries(template);
  const matched: TemplateDraftMatch[] = [];
  const ambiguous: { id: string; name: string }[] = [];
  const unmatched: { id: string; name: string }[] = [];
  const usedTargets = new Set<string>();

  for (const draft of drafts) {
    if (!draft.name) {
      unmatched.push(draft);
      continue;
    }
    const result = findCatalogMatchForDraftName(draft.name, catalog);
    if (result.status !== "matched") {
      if (result.status === "ambiguous") ambiguous.push(draft);
      else unmatched.push(draft);
      continue;
    }
    // На канве уже есть карточка с этим реальным id — заменять черновик им нельзя (коллизия id).
    if ((canvas[result.id] && result.id !== draft.id) || usedTargets.has(result.id)) {
      unmatched.push(draft);
      continue;
    }
    usedTargets.add(result.id);
    matched.push({
      oldId: draft.id,
      newId: result.id,
      name: draft.name,
      season: result.season ?? null,
    });
  }

  return { matched, ambiguous, unmatched };
}

/** Возвращает копию шаблона, в которой указанные черновики заменены реальными id задач. */
export function applyTemplateDraftMatches(
  template: CanvasTemplate,
  matches: TemplateDraftMatch[],
): CanvasTemplate {
  if (!matches.length) return template;
  const idMap = new Map(matches.map((m) => [m.oldId, m.newId]));

  const canvas: Record<string, CanvasPosition> = {};
  for (const [id, layout] of Object.entries(template.canvas ?? {})) {
    const newId = idMap.get(id);
    if (!newId) {
      canvas[id] = layout;
      continue;
    }
    const next = { ...layout };
    delete next.localOnly;
    delete next.configuredOnBackend;
    canvas[newId] = next;
  }

  const taskBodies: Record<string, TaskLike> = {};
  for (const [id, body] of Object.entries(template.taskBodies ?? {})) {
    if (!idMap.has(id)) taskBodies[id] = body;
  }

  const edges = (Array.isArray(template.edges) ? template.edges : []).map((e) => ({
    from: idMap.get(e.from) ?? e.from,
    to: idMap.get(e.to) ?? e.to,
  }));

  const targetConfigs: CanvasTemplate["targetConfigs"] = {};
  for (const [id, cfg] of Object.entries(template.targetConfigs ?? {})) {
    targetConfigs[idMap.get(id) ?? id] = cfg;
  }

  const next: CanvasTemplate = {
    ...template,
    canvas,
    edges,
    targetConfigs,
    updatedAt: new Date().toISOString(),
  };
  if (Object.keys(taskBodies).length) next.taskBodies = taskBodies;
  else delete next.taskBodies;
  return next;
}

/** Подпись шаблона в списках: «Имя (N задач)». */
export function templateOptionLabel(template: CanvasTemplate): string {
  return `${template.name} (${countTemplateTasks(template)} задач)`;
}

/** Строка меты в списке загрузки: задачи · связи · черновики · дата. */
export function templateMetaLine(template: CanvasTemplate): string {
  const drafts = countTemplateLocalDrafts(template);
  const draftNote = drafts ? ` · ${drafts} черновик.` : "";
  return `${countTemplateTasks(template)} задач · ${countTemplateEdges(template)} связей${draftNote} · ${formatTemplateDate(template.updatedAt || template.createdAt)}`;
}

export function buildTemplateSaveToastMessage(
  name: string,
  isUpdate: boolean,
  taskCount: number,
  dirtyCount: number,
): string {
  let message = isUpdate ? `Шаблон «${name}» обновлён` : `Шаблон «${name}» сохранён`;
  if (taskCount > 0) message += ` (${taskCount} задач)`;
  if (dirtyCount) message += ". Несохранённые изменения данных задач в шаблон не входят";
  return message;
}

export function buildLoadTemplateConfirmMessage(
  template: CanvasTemplate,
  { dirtyCount, canvasCount }: { dirtyCount: number; canvasCount: number },
): string {
  const parts = [`Загрузить шаблон «${template.name}» (${countTemplateTasks(template)} задач)?`];
  parts.push("Текущая канва будет заменена.");
  if (dirtyCount) {
    parts.push(
      `Внимание: у ${dirtyCount} задач есть несохранённые изменения — они будут потеряны.`,
    );
  } else if (canvasCount) {
    parts.push(`С канвы будет снято ${canvasCount} задач.`);
  }
  return parts.join("\n");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** viewport шаблона (`scale`) → viewport React Flow (`zoom`); null — в шаблоне нет viewport. */
export function flowViewportFromTemplate(raw: unknown): FlowViewport | null {
  if (!isRecord(raw)) return null;
  return {
    x: Number(raw.x) || 0,
    y: Number(raw.y) || 0,
    zoom: clamp(Number(raw.scale) || 1, MIN_ZOOM, MAX_ZOOM),
  };
}

export function templateViewportFromFlow(viewport: FlowViewport): CanvasViewport {
  return { x: viewport.x, y: viewport.y, scale: viewport.zoom };
}

export interface TemplateCanvasPlan {
  /** Карточки для канвы: из каталога (conditions ещё не загружены) и черновики (full = тело). */
  placed: Record<string, CanvasTask>;
  catalogIds: string[];
  draftIds: string[];
  /** Нет ни в каталоге, ни в taskBodies — пропускаются. */
  missing: string[];
}

function finiteOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Чистый план: какие карточки появятся на канве при загрузке шаблона с данным каталогом. */
export function planTemplateCanvas(
  template: CanvasTemplate,
  catalog: Record<string, CatalogTask>,
): TemplateCanvasPlan {
  const positions = isRecord(template.canvas) ? template.canvas : {};
  const bodies = isRecord(template.taskBodies) ? template.taskBodies : {};
  const plan: TemplateCanvasPlan = { placed: {}, catalogIds: [], draftIds: [], missing: [] };

  for (const id of Object.keys(positions)) {
    const layout = positions[id] ?? ({} as CanvasPosition);
    const body = bodies[id];
    const isLocal = layout.localOnly === true || !!body;
    const headerColor = normalizeHeaderColorId(layout.headerColor);

    if (isLocal && body) {
      const full = cloneJson(body);
      plan.placed[id] = {
        id,
        name: String(full.name || "(локальный черновик)"),
        frontend_identifier: String(full.frontend_identifier || ""),
        conditions: Array.isArray(full.conditions)
          ? (full.conditions as CanvasTask["conditions"])
          : [],
        full,
        x: finiteOr(layout.x, GRID_START_X),
        y: finiteOr(layout.y, GRID_START_Y),
        localOnly: true,
        ...(headerColor ? { headerColor } : {}),
      };
      plan.draftIds.push(id);
      continue;
    }

    const meta = isLocal ? undefined : catalog[id];
    if (!meta) {
      plan.missing.push(id);
      continue;
    }
    plan.placed[id] = {
      id,
      name: meta.name,
      frontend_identifier: meta.frontend_identifier,
      conditions: null,
      full: null,
      x: finiteOr(layout.x, GRID_START_X),
      y: finiteOr(layout.y, GRID_START_Y),
      ...(headerColor ? { headerColor } : {}),
      ...(layout.configuredOnBackend === true ? { configuredOnBackend: true } : {}),
    };
    plan.catalogIds.push(id);
  }
  return plan;
}

/** Id задач шаблона, которые должны быть в каталоге (не черновики). */
export function templateCatalogIds(template: CanvasTemplate): string[] {
  const positions = isRecord(template.canvas) ? template.canvas : {};
  const bodies = isRecord(template.taskBodies) ? template.taskBodies : {};
  return Object.keys(positions).filter((id) => positions[id]?.localOnly !== true && !bodies[id]);
}

/**
 * Рёбра и настройки связей из шаблона поверх канвы (только между карточками на ней),
 * локальные conditions пересобираются из рёбер. Грязными цели не помечаются — как в legacy.
 */
export function restoreGraphFromTemplate(state: GraphState, template: CanvasTemplate): GraphState {
  const edges: CanvasEdge[] = [];
  for (const edge of Array.isArray(template.edges) ? template.edges : []) {
    const from = String(edge.from);
    const to = String(edge.to);
    if (from === to || !state.canvas[from] || !state.canvas[to]) continue;
    if (!edges.some((e) => e.from === from && e.to === to)) edges.push({ from, to });
  }
  const targetConfigs: Record<string, GtConfig> = {};
  const savedConfigs = isRecord(template.targetConfigs) ? template.targetConfigs : {};
  for (const [id, cfg] of Object.entries(savedConfigs)) {
    if (!state.canvas[id]) continue;
    targetConfigs[id] = gtConfigFromTemplate(cfg);
  }
  let next: GraphState = { ...state, edges, targetConfigs };
  for (const id of Object.keys(next.canvas)) next = syncConditionsFromEdges(next, id);
  return next;
}

export interface DraftTemplateOptions {
  targetDomain: string;
  sourceDomain: string;
  now?: string;
  newTemplateId?: () => string;
  newDraftId?: () => string;
}

/** Копия одной задачи на другой проект: шаблон с одним локальным черновиком. */
export function buildLocalDraftTemplateFromTask(
  taskId: string,
  body: TaskLike,
  fallbackName: string,
  {
    targetDomain,
    sourceDomain,
    now = new Date().toISOString(),
    newTemplateId: makeTemplateId = newTemplateId,
    newDraftId = newLocalDraftId,
  }: DraftTemplateOptions,
): CanvasTemplate {
  const draftId = newDraftId();
  const sourceName = String(body.name || fallbackName || "").trim();
  const name = sourceName
    ? `Черновик: ${sourceName}`
    : `Черновик с ${sourceDomain || "источника"} (#${taskId})`;
  return {
    id: makeTemplateId(),
    name,
    domain: targetDomain,
    sourceDomain: sourceDomain || "",
    sourceTaskId: String(taskId),
    isLocalDraftTemplate: true,
    createdAt: now,
    updatedAt: now,
    canvas: {
      [draftId]: { x: GRID_START_X, y: GRID_START_Y, localOnly: true, configuredOnBackend: false },
    },
    taskBodies: { [draftId]: snapshotTaskBodyForDraft(body) },
    edges: [],
    targetConfigs: {},
    labels: [],
    viewport: { x: 0, y: 0, scale: 1 },
  };
}

/**
 * Копия шаблона на другой проект: все задачи становятся локальными черновиками с новыми id,
 * рёбра, настройки связей (включая list) и подписи переносятся с переназначением id.
 */
export function buildLocalDraftTemplateFromSourceTemplate(
  sourceTemplate: CanvasTemplate,
  bodies: Record<string, TaskLike>,
  {
    targetDomain,
    sourceDomain,
    now = new Date().toISOString(),
    newTemplateId: makeTemplateId = newTemplateId,
    newDraftId = newLocalDraftId,
  }: DraftTemplateOptions,
): CanvasTemplate {
  const srcCanvas = isRecord(sourceTemplate.canvas) ? sourceTemplate.canvas : {};
  const idMap = new Map<string, string>();
  for (const oldId of Object.keys(bodies)) idMap.set(String(oldId), newDraftId());

  const canvas: Record<string, CanvasPosition> = {};
  const taskBodies: Record<string, TaskLike> = {};
  for (const [oldId, body] of Object.entries(bodies)) {
    const newId = idMap.get(String(oldId))!;
    const layout = srcCanvas[oldId] ?? ({} as CanvasPosition);
    const entry: CanvasPosition = {
      x: finiteOr(layout.x, GRID_START_X),
      y: finiteOr(layout.y, GRID_START_Y),
      localOnly: true,
      configuredOnBackend: false,
    };
    const colorId = normalizeHeaderColorId(layout.headerColor);
    if (colorId) entry.headerColor = colorId;
    canvas[newId] = entry;
    taskBodies[newId] = body;
  }

  const edges: CanvasEdge[] = [];
  for (const edge of Array.isArray(sourceTemplate.edges) ? sourceTemplate.edges : []) {
    const from = idMap.get(String(edge.from));
    const to = idMap.get(String(edge.to));
    if (!from || !to || from === to) continue;
    edges.push({ from, to });
  }

  const targetConfigs: CanvasTemplate["targetConfigs"] = {};
  const srcConfigs = isRecord(sourceTemplate.targetConfigs) ? sourceTemplate.targetConfigs : {};
  for (const [oldId, cfg] of Object.entries(srcConfigs)) {
    const newId = idMap.get(String(oldId));
    if (!newId || !isRecord(cfg)) continue;
    const next: Partial<GamificationTasksCondition> = {
      ...DEFAULT_GT_CONFIG,
      ...(cfg as Partial<GamificationTasksCondition>),
    };
    if (Array.isArray(next.list)) {
      next.list = next.list
        .map((ref) => idMap.get(String(ref)))
        .filter((ref): ref is string => !!ref);
    }
    targetConfigs[newId] = next;
  }

  const labels = Array.isArray(sourceTemplate.labels)
    ? sourceTemplate.labels.map((label) => ({ ...label }))
    : [];

  const sourceName = String(sourceTemplate.name || "").trim();
  return {
    id: makeTemplateId(),
    name: sourceName
      ? `Черновик: ${sourceName}`
      : `Черновик шаблона с ${sourceDomain || "источника"}`,
    domain: targetDomain,
    sourceDomain: sourceDomain || "",
    sourceTemplateId: sourceTemplate.id ? String(sourceTemplate.id) : "",
    isLocalDraftTemplate: true,
    createdAt: now,
    updatedAt: now,
    canvas,
    taskBodies,
    edges,
    targetConfigs,
    labels,
    viewport: isRecord(sourceTemplate.viewport)
      ? { ...sourceTemplate.viewport }
      : { x: 0, y: 0, scale: 1 },
  };
}
