/**
 * Задача планировщика Promo Graphic → черновик задачи PromoHub.
 * Поля формы маппятся напрямую; всё, что не ложится в форму, уходит в «бриф» (подсказки по секциям).
 */
import {
  coerceActionConditions,
  coerceActionRequirements,
  getAllRequirementFieldKeys,
  getFieldRoleForAction,
  getRequirementFieldDef,
  splitActionFieldsForApi,
} from "./actions-schema";
import { getGamificationTasksCondition, parseBonusPointsFromGroupId } from "./tasks";
import type { Condition, TaskAction, TaskLike } from "./types";

/** Задача из API планировщика. Поля известны частично; остальное — в бриф. */
export type PlannerTask = Record<string, unknown> & {
  id?: number | string;
  frontend_identifier?: string;
  name_internal?: string;
  name_backend?: string;
  name_frontend?: Record<string, unknown>;
  task_type?: string;
  sort_order?: number | string;
  ph_backend_id?: number | string | null;
  targeting?: Record<string, unknown>;
  main_actions?: unknown[];
  secondary_actions?: unknown[];
};

export type PlannerTasksById =
  Map<unknown, PlannerTask> | Record<string, PlannerTask> | null | undefined;

export interface PlannerContext {
  tasksById?: PlannerTasksById;
}

export interface PlannerHint {
  title: string;
  body: string[];
}

export interface PlannerHints {
  sections: Record<string, PlannerHint[]>;
  leftover: PlannerHint[];
  note: string;
}

export interface PlannerBriefOverlay {
  _plannerNote: string;
  _plannerHints: { sections: Record<string, PlannerHint[]>; leftover: PlannerHint[] };
  _plannerTaskId: number | string | null;
  _plannerPrerequisiteId: unknown;
}

const PLANNER_PRIORITY_TO_PH: Record<string, number> = {
  highest: 0,
  high: 1,
  medium: 2,
  low: 3,
  lowest: 4,
};

const TASK_TYPES: ReadonlySet<string> = new Set([
  "interactive",
  "informational",
  "achievement",
  "sequence",
]);

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

const COMPARISON_TEXT = /^(>=|<=|==|=|>|<)\s*(-?\d+(?:[.,]\d+)?)$/;

function coerceRowValue(value: unknown): unknown {
  if (Array.isArray(value)) return value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (text === "true") return true;
  if (text === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  // «>= 1.5» пишет mapPhTaskToPlannerImport — так сравнение переживает поездку через график.
  const comparison = COMPARISON_TEXT.exec(text);
  if (comparison) return { operator: comparison[1], value: comparison[2]!.replace(",", ".") };
  if (text.includes(",")) {
    return text
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  }
  return text;
}

/** Строки планировщика `[{ key, value }]` → объект. */
function rowsToObject(rows: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const row of asArray(rows)) {
    if (!row || typeof row !== "object") continue;
    const key = String((row as { key?: unknown }).key || "").trim();
    if (!key) continue;
    const value = coerceRowValue((row as { value?: unknown }).value);
    // Список из одного значения строка не отличит от скаляра — тип берём из схемы поля.
    const widget = getRequirementFieldDef(key)?.widget;
    const isList = widget === "multi_text" || widget === "multi_select";
    out[key] = isList && value !== "" && !Array.isArray(value) ? [String(value)] : value;
  }
  return out;
}

interface MappedAction {
  mapped: TaskAction;
  leftover: string[];
}

function mapActionItem(item: unknown): MappedAction | null {
  if (!item || typeof item !== "object") return null;
  const rec = item as Record<string, unknown>;
  const action = String(rec.action || "").trim();
  if (!action) return null;
  const fields = { ...rowsToObject(rec.conditions), ...rowsToObject(rec.attributes) };
  const allowed = new Set(getAllRequirementFieldKeys(action));
  const leftover = Object.keys(fields).filter((key) => !allowed.has(key));
  const split = splitActionFieldsForApi(action, fields);
  return {
    mapped: {
      action,
      requirements: coerceActionRequirements(action, split.requirements),
      conditions: coerceActionConditions(action, split.conditions),
    },
    leftover,
  };
}

function mapActionList(items: unknown): { mapped: TaskAction[]; leftoverNotes: string[] } {
  const mapped: TaskAction[] = [];
  const leftoverNotes: string[] = [];
  for (const item of asArray(items)) {
    const result = mapActionItem(item);
    if (!result) continue;
    mapped.push(result.mapped);
    if (result.leftover.length) {
      leftoverNotes.push(`${result.mapped.action}: ${result.leftover.join(", ")}`);
    }
  }
  return { mapped, leftoverNotes };
}

function mapPriority(raw: unknown): number {
  if (raw == null || raw === "") return 0;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const key = String(raw).trim().toLowerCase();
  const known = PLANNER_PRIORITY_TO_PH[key];
  if (known !== undefined) return known;
  const asNumber = Number(key);
  return Number.isFinite(asNumber) ? asNumber : 0;
}

function mapType(raw: unknown): string {
  const type = String(raw || "")
    .trim()
    .toLowerCase();
  return TASK_TYPES.has(type) ? type : "interactive";
}

function mapCountries(raw: unknown): {
  countries: string[];
  countries_matching_type: string;
  countries_lists: unknown[];
} {
  const list = asArray(raw)
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  if (!list.length) {
    return { countries: [], countries_matching_type: "countries", countries_lists: [] };
  }
  if (list.some((code) => code.toLowerCase() === "all")) {
    return { countries: ["all"], countries_matching_type: "countries", countries_lists: [] };
  }
  return { countries: list, countries_matching_type: "countries", countries_lists: [] };
}

function mapLocales(nameFrontend: unknown): Record<string, string> {
  const locales: Record<string, string> = {};
  for (const [code, value] of Object.entries(asObject(nameFrontend))) {
    const text = String(value || "").trim();
    if (text) locales[String(code).toLowerCase()] = text;
  }
  return locales;
}

function mapTime(task: PlannerTask) {
  const time = asObject(task.time_availability);
  const events = asArray(task.events).map(String);
  const duration = time.duration_minutes ?? time.duration ?? task.duration ?? null;
  const infinite = Boolean(time.infinite ?? task.infinite);
  const hasScheduler = events.includes("scheduler");
  return {
    available_from: time.available_from || task.available_from || null,
    available_till: time.available_till || task.available_till || null,
    max_repetitions: time.max_repetitions ?? task.max_repetitions ?? null,
    duration: infinite ? null : duration,
    infinite,
    repeatable: Boolean(task.repeatable) || hasScheduler,
    cron: task.cron ?? time.cron ?? null,
  };
}

function backendTaskName(task: PlannerTask): string {
  const fromBackend = String(task.name_backend ?? "").trim();
  if (fromBackend) return fromBackend;
  const fromInternal = String(task.name_internal ?? "").trim();
  if (fromInternal) return fromInternal;
  return "Задача";
}

/** Обязательные boolean-условия для новых черновиков из графика (не для ph_backend_id). */
const DEFAULT_DRAFT_CONDITION_FLAGS: ReadonlyArray<[string, boolean]> = [
  ["no_bonus", false],
  ["no_bonus_sport", false],
  ["fraud", false],
  ["gambling_addict", false],
];

/**
 * API-формат conditions: [{ no_bonus: false }, ...].
 * Уже присутствующие ключи не дублируются и не перезаписываются.
 */
export function mergeDefaultDraftConditions(existing: unknown): Condition[] {
  const out: Condition[] = [];
  const present = new Set<string>();

  for (const entry of asArray(existing)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const keys = Object.keys(entry);
    if (!keys.length) continue;
    out.push({ ...(entry as Condition) });
    for (const key of keys) present.add(key);
  }

  for (const [key, value] of DEFAULT_DRAFT_CONDITION_FLAGS) {
    if (present.has(key)) continue;
    out.push({ [key]: value });
  }
  return out;
}

const MAPPED_PLANNER_KEYS: ReadonlySet<string> = new Set([
  "id",
  "package_id",
  "created_at",
  "updated_at",
  "frontend_identifier",
  "name_internal",
  "name_backend",
  "name_frontend",
  "task_type",
  "player_consent_required",
  "countries",
  "category",
  "priority",
  "events",
  "notifications",
  "time_availability",
  "main_actions",
  "secondary_actions",
  "main_action",
  "repeatable",
  "cron",
  "duration",
  "duration_minutes",
  "infinite",
  "max_repetitions",
  "available_from",
  "available_till",
  "tag",
  "reward_points",
  "secondary_reward_points",
  "description",
  "description_cms",
  "description_detailed",
  "condition_text",
  "button_text",
  "targeting",
  "sort_order",
  "ph_backend_id",
  "conditions",
]);

const KNOWN_TARGETING_KEYS: ReadonlySet<string> = new Set([
  "extra",
  "completed_task_ids",
  "prerequisite_task_id",
  "exclude_tags",
  "groups",
]);

function isPresent(value: unknown): boolean {
  if (value == null || value === "") return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function formatHintValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map((item) => formatHintValue(item))
      .filter(Boolean)
      .join(", ");
  }
  if (value && typeof value === "object") {
    return Object.entries(value)
      .filter(([, nested]) => isPresent(nested))
      .map(([key, nested]) => `${key}: ${formatHintValue(nested)}`)
      .join("; ");
  }
  return String(value);
}

const PLANNER_HINT_SECTION_IDS: ReadonlySet<string> = new Set([
  "basic",
  "classification",
  "startup",
  "targeting",
  "availability",
  "actions",
  "rewards",
  "notifications",
]);

const PLANNER_HINT_NOTE_ORDER = [
  "targeting",
  "classification",
  "rewards",
  "basic",
  "startup",
  "availability",
  "actions",
  "notifications",
];

function sectionForUnmappedPlannerKey(key: string): string | null {
  const lower = String(key || "").toLowerCase();
  if (lower.startsWith("targeting.")) return "targeting";
  const k = lower.replace(/^targeting\./, "");
  if (/^(tag|tags|tag_id|category|priority)$/.test(k)) return "classification";
  if (/country|countries|geo/.test(k)) return "basic";
  if (/notif/.test(k)) return "notifications";
  if (/^(events?)$/.test(k) || k.startsWith("event")) return "startup";
  if (/available_|duration|infinite|cron|repeat|max_rep/.test(k)) return "availability";
  if (/action/.test(k)) return "actions";
  if (/reward|bonus|points/.test(k)) return "rewards";
  if (/description|condition_text/.test(k)) return "actions";
  if (/button_text|locale|name_/.test(k)) return "basic";
  return null;
}

function leftoverPlannerFields(
  task: PlannerTask,
  targeting: Record<string, unknown>,
): { bySection: Record<string, string[]>; leftover: string[] } {
  const bySection: Record<string, string[]> = {};
  const leftover: string[] = [];

  function push(sectionId: string | null, line: string) {
    if (sectionId && PLANNER_HINT_SECTION_IDS.has(sectionId)) {
      (bySection[sectionId] ??= []).push(line);
      return;
    }
    leftover.push(line);
  }

  for (const [key, value] of Object.entries(asObject(task))) {
    if (MAPPED_PLANNER_KEYS.has(key) || !isPresent(value)) continue;
    push(sectionForUnmappedPlannerKey(key), `${key}: ${formatHintValue(value)}`);
  }
  for (const [key, value] of Object.entries(targeting)) {
    if (KNOWN_TARGETING_KEYS.has(key) || !isPresent(value)) continue;
    push("targeting", `targeting.${key}: ${formatHintValue(value)}`);
  }
  return { bySection, leftover };
}

function lookupPlannerTask(tasksById: PlannerTasksById, id: unknown): PlannerTask | null {
  if (!tasksById || id == null || id === "") return null;
  if (tasksById instanceof Map) {
    return tasksById.get(id) || tasksById.get(String(id)) || tasksById.get(Number(id)) || null;
  }
  return tasksById[String(id)] || null;
}

function pushHint(target: PlannerHint[], title: string, bodyLines: unknown[]): void {
  const body = (bodyLines || [])
    .filter((line) => line != null && String(line).trim() !== "")
    .map(String);
  if (!body.length) return;
  target.push({ title, body });
}

function flattenPlannerHints(
  sections: Record<string, PlannerHint[]>,
  leftover: PlannerHint[],
): string {
  const lines: string[] = [];
  function dump(items: PlannerHint[] | undefined) {
    for (const item of items || []) {
      if (lines.length) lines.push("");
      if (item.title) lines.push(item.title);
      lines.push(...item.body);
    }
  }
  for (const id of PLANNER_HINT_NOTE_ORDER) dump(sections[id]);
  dump(leftover);
  return lines.join("\n").trim();
}

function buildPlannerHints(
  task: PlannerTask,
  leftoverNotes: string[],
  context: PlannerContext = {},
): PlannerHints {
  const targeting = asObject(task.targeting);
  const sections: Record<string, PlannerHint[]> = {};
  const leftover: PlannerHint[] = [];

  function add(sectionId: string, title: string, bodyLines: unknown[]) {
    pushHint((sections[sectionId] ??= []), title, bodyLines);
  }

  const targetingLines: string[] = [];
  const extra = String(targeting.extra ?? "")
    .replace(/^\n+/, "")
    .replace(/\s+$/g, "");
  if (extra) targetingLines.push(extra);

  const prereqId = targeting.prerequisite_task_id;
  const prereqFrontId = String(
    lookupPlannerTask(context.tasksById, prereqId)?.frontend_identifier || "",
  ).trim();
  if (prereqFrontId) targetingLines.push(`Предшественник: ${prereqFrontId}`);
  else if (isPresent(prereqId)) {
    targetingLines.push(`Предшественник: ${formatHintValue(prereqId)}`);
  }
  if (isPresent(asArray(targeting.completed_task_ids))) {
    targetingLines.push(`Выполненные задачи: ${formatHintValue(targeting.completed_task_ids)}`);
  }
  if (isPresent(asArray(targeting.exclude_tags))) {
    targetingLines.push(`Исключить теги: ${formatHintValue(targeting.exclude_tags)}`);
  }
  if (isPresent(asArray(targeting.groups))) {
    targetingLines.push(`Группы игроков: ${formatHintValue(targeting.groups)}`);
  }
  if (targetingLines.length) add("targeting", "Таргетинг", targetingLines);

  if (isPresent(task.tag)) {
    add("classification", "Тег", [formatHintValue(task.tag)]);
  }

  const rewardLines: string[] = [];
  if (isPresent(task.reward_points)) {
    rewardLines.push(`Основная награда: ${formatHintValue(task.reward_points)} pts`);
  }
  if (isPresent(task.secondary_reward_points)) {
    rewardLines.push(
      `Дополнительная награда: ${formatHintValue(task.secondary_reward_points)} pts`,
    );
  }
  if (rewardLines.length) add("rewards", "Награда", rewardLines);

  const textLines: string[] = [];
  if (isPresent(task.description)) {
    textLines.push(`Описание: ${String(task.description).trim()}`);
  }
  if (isPresent(task.description_cms)) {
    textLines.push(`CMS: ${String(task.description_cms).trim()}`);
  }
  if (isPresent(task.description_detailed)) {
    textLines.push(`Подробное описание: ${String(task.description_detailed).trim()}`);
  }
  if (isPresent(task.condition_text)) {
    textLines.push(`Условие для игрока: ${String(task.condition_text).trim()}`);
  }
  if (isPresent(task.button_text)) {
    textLines.push(`Текст кнопки: ${formatHintValue(task.button_text)}`);
  }
  // Описание и условие для игрока описывают, что сделать, — показываем у целевых действий.
  if (textLines.length) add("actions", "Описания", textLines);

  if (leftoverNotes.length) {
    add("actions", "Действия", [leftoverNotes.join("; ")]);
  }

  const unmapped = leftoverPlannerFields(task, targeting);
  for (const [sectionId, lines] of Object.entries(unmapped.bySection)) {
    add(sectionId, "Прочее", lines);
  }
  if (unmapped.leftover.length) {
    pushHint(leftover, "Прочее", unmapped.leftover);
  }

  return { sections, leftover, note: flattenPlannerHints(sections, leftover) };
}

/** id задачи на бэке PromoHub, если планировщик её уже создал. */
export function getPlannerPhBackendId(task: unknown): number | null {
  const raw = asObject(task).ph_backend_id;
  if (raw == null || raw === "") return null;
  const num = Number(raw);
  return Number.isInteger(num) && num > 0 ? num : null;
}

/** id задачи графика, после которой идёт эта (targeting.prerequisite_task_id). */
export function getPlannerPrerequisiteId(task: unknown): number | null {
  const source = asObject(task);
  const raw = asObject(source.targeting).prerequisite_task_id ?? source.prerequisite_task_id;
  if (raw == null || raw === "") return null;
  const num = Number(raw);
  return Number.isInteger(num) && num > 0 && num !== Number(source.id) ? num : null;
}

export interface OrderedPlannerTask {
  task: PlannerTask;
  depth: number;
}

/**
 * Порядок задач пакета по цепочкам графика: предшественник всегда раньше последователя
 * (тогда при создании на бэке его id уже известен). depth — колонка на канве.
 * Внутри колонки — рядом с предшественником, дальше по sort_order графика.
 */
export function orderPlannerTasksByChain(tasks: unknown): OrderedPlannerTask[] {
  const list = asArray(tasks).filter(
    (task): task is PlannerTask =>
      !!task && typeof task === "object" && (task as PlannerTask).id != null,
  );
  const byId = new Map(list.map((task) => [Number(task.id), task]));
  const indexOf = new Map(list.map((task, index) => [Number(task.id), index]));
  const sortKey = (task: PlannerTask) => {
    const order = Number(task.sort_order);
    return Number.isFinite(order) ? order : Number.MAX_SAFE_INTEGER;
  };

  const depthById = new Map<number, number>();
  function depthOf(task: PlannerTask, seen: Set<number> = new Set()): number {
    const id = Number(task.id);
    const known = depthById.get(id);
    if (known !== undefined) return known;
    const prereqId = getPlannerPrerequisiteId(task);
    const prereq = prereqId == null ? undefined : byId.get(prereqId);
    // Цикл в графике (A → B → A) — рвём на текущей задаче.
    const path = new Set(seen).add(id);
    const depth = prereq && !path.has(Number(prereq.id)) ? depthOf(prereq, path) + 1 : 0;
    depthById.set(id, depth);
    return depth;
  }
  for (const task of list) depthOf(task);

  const rowById = new Map<number, number>();
  const ordered: OrderedPlannerTask[] = [];
  const maxDepth = Math.max(0, ...depthById.values());
  for (let depth = 0; depth <= maxDepth; depth += 1) {
    const level = list
      .filter((task) => depthById.get(Number(task.id)) === depth)
      .sort((a, b) => {
        const parentA = rowById.get(getPlannerPrerequisiteId(a) ?? NaN) ?? -1;
        const parentB = rowById.get(getPlannerPrerequisiteId(b) ?? NaN) ?? -1;
        if (parentA !== parentB) return parentA - parentB;
        const orderDiff = sortKey(a) - sortKey(b);
        if (orderDiff) return orderDiff;
        return (indexOf.get(Number(a.id)) ?? 0) - (indexOf.get(Number(b.id)) ?? 0);
      });
    level.forEach((task, row) => {
      rowById.set(Number(task.id), row);
      ordered.push({ task, depth });
    });
  }
  return ordered;
}

/** Только бриф/мета планировщика — без полей формы PromoHub. */
export function buildPlannerBriefOverlay(
  task: unknown,
  context: PlannerContext = {},
): PlannerBriefOverlay {
  const source = asObject(task) as PlannerTask;
  const targeting = asObject(source.targeting);
  const main = mapActionList(source.main_actions);
  const secondary = mapActionList(source.secondary_actions);
  const leftoverNotes = [...main.leftoverNotes, ...secondary.leftoverNotes];
  const hints = buildPlannerHints(source, leftoverNotes, context);
  return {
    _plannerNote: hints.note,
    _plannerHints: { sections: hints.sections, leftover: hints.leftover },
    _plannerTaskId: source.id ?? null,
    _plannerPrerequisiteId: targeting.prerequisite_task_id ?? null,
  };
}

function clonePlain<T>(value: T): Record<string, unknown> {
  if (value == null || typeof value !== "object") return {};
  try {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  } catch {
    return { ...(value as Record<string, unknown>) };
  }
}

/** База = задача с бэка PromoHub; сверху только бриф из графика. */
export function mergeBackendTaskWithPlannerBrief(
  backendTask: unknown,
  graphicTask: unknown,
  context: PlannerContext = {},
): TaskLike {
  return { ...clonePlain(backendTask), ...buildPlannerBriefOverlay(graphicTask, context) };
}

/** Планировщик → тело локального черновика для формы и buildCreatePayload. */
export function mapPlannerTaskToDraft(task: unknown, context: PlannerContext = {}): TaskLike {
  const source = asObject(task) as PlannerTask;
  const events = asArray(source.events).map(String).filter(Boolean);
  const main = mapActionList(source.main_actions);
  const secondary = mapActionList(source.secondary_actions);
  const countries = mapCountries(source.countries);
  const time = mapTime(source);
  const brief = buildPlannerBriefOverlay(source, context);

  return {
    name: backendTaskName(source),
    frontend_identifier: String(source.frontend_identifier || "").trim(),
    type: mapType(source.task_type),
    player_consent_required: Boolean(source.player_consent_required),
    ...countries,
    category: String(source.category || "").trim() || undefined,
    priority: mapPriority(source.priority),
    events,
    notification_events: asArray(source.notifications).map(String).filter(Boolean),
    locales: mapLocales(source.name_frontend),
    ...time,
    serialized_main_actions: main.mapped,
    serialized_secondary_actions: secondary.mapped,
    main_actions_sequential: false,
    secondary_actions_sequential: false,
    main_bonus_group_id: null,
    secondary_bonus_group_id: null,
    conditions: mergeDefaultDraftConditions(source.conditions),
    hidden: false,
    state: "draft",
    filter_id: null,
    tag_id: null,
    ...brief,
  };
}

// ---------------------------------------------------------------------------
// Обратно: задача PromoHub → задание пакета графика (POST /packages/{id}/import)
// ---------------------------------------------------------------------------

const PH_PRIORITY_TO_PLANNER: Record<number, string> = Object.fromEntries(
  Object.entries(PLANNER_PRIORITY_TO_PH).map(([key, value]) => [value, key]),
);

/** Цвет шапки карточки на канве → CSS-цвет полоски задания в графике. */
export const HEADER_COLOR_HEX: Record<string, string> = {
  green: "#22c55e",
  orange: "#f97316",
  purple: "#8b5cf6",
  red: "#ef4444",
  teal: "#14b8a6",
  gray: "#6b7280",
  pink: "#ec4899",
  amber: "#f59e0b",
};

/** Строка действия графика: `{ key, value }`, значение — текст. */
interface PlannerFieldRow {
  key: string;
  value: string;
}

interface PlannerAction {
  action: string;
  conditions: PlannerFieldRow[];
  attributes: PlannerFieldRow[];
}

/** Задание для импорта: поля TaskBase графика + ключ и связи на стороне PromoHub. */
export interface PlannerImportItem {
  ph_backend_id: string;
  prerequisite_ph_ids: string[];
  ph_snapshot: TaskLike;
  frontend_identifier: string;
  name_backend: string;
  name_frontend: Record<string, string>;
  task_type?: string;
  priority?: string;
  hidden: boolean;
  player_consent_required: boolean;
  cron: string | null;
  color?: string;
  countries: string[];
  category: string | null;
  tag: string | null;
  events: string[];
  notifications: string[];
  reward_points: number | null;
  secondary_reward_points: number | null;
  time_availability: {
    available_from: string | null;
    available_till: string | null;
    max_repetitions: number | null;
    duration_minutes: number | null;
    infinite: boolean;
  };
  targeting: { groups: string[]; extra: string };
  main_actions: PlannerAction[];
  secondary_actions: PlannerAction[];
}

/** Элемент списка: игры и категории приходят объектами — график, как и форма, хранит их id. */
function listItemText(item: unknown): string {
  const obj = asObject(item);
  const id = obj.id ?? obj.value ?? obj.game_id ?? obj.name;
  return String(Object.keys(obj).length ? (id ?? "") : (item ?? "")).trim();
}

/**
 * Значение поля действия → текст строки графика. Сравнение — «>= 1.5» (его разбирает
 * coerceRowValue), прочие объекты — JSON: в графике видно, что там было.
 */
function rowValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(listItemText).filter(Boolean).join(", ");
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (obj.operator != null && obj.value != null && !Array.isArray(obj.value)) {
      return `${String(obj.operator).trim()} ${String(obj.value).trim()}`;
    }
    return JSON.stringify(value);
  }
  return value == null ? "" : String(value);
}

function toPlannerAction(item: TaskAction): PlannerAction | null {
  const action = String(item?.action ?? "").trim();
  if (!action) return null;
  const out: PlannerAction = { action, conditions: [], attributes: [] };
  const fields = { ...asObject(item.requirements), ...asObject(item.conditions) };
  for (const [key, value] of Object.entries(fields)) {
    const row = { key, value: rowValue(value) };
    if (!row.value) continue;
    if (getFieldRoleForAction(action, key) === "attribute") out.attributes.push(row);
    else out.conditions.push(row);
  }
  return out;
}

function toPlannerActions(items: unknown): PlannerAction[] {
  return asArray(items)
    .map((item) => toPlannerAction(item as TaskAction))
    .filter((item): item is PlannerAction => item !== null);
}

const DEFAULT_FLAG_KEYS: ReadonlySet<string> = new Set(
  DEFAULT_DRAFT_CONDITION_FLAGS.map(([key]) => key),
);

/**
 * Таргетинг PromoHub → поля графика. Включённые группы ложатся в groups, остальное,
 * кроме связей и выключенных флагов по умолчанию, — текстом в extra.
 */
function toPlannerTargeting(task: TaskLike): { groups: string[]; extra: string } {
  const groups: string[] = [];
  const extra: string[] = [];
  for (const entry of asArray(task.conditions)) {
    for (const [key, value] of Object.entries(asObject(entry))) {
      if (key === "gamification_tasks") continue;
      if (DEFAULT_FLAG_KEYS.has(key) && value === false) continue;
      const block = asObject(value);
      if (key === "groups" && block.type !== "disabled" && Array.isArray(block.list)) {
        groups.push(...block.list.map(String));
        continue;
      }
      extra.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  if (asArray(task.countries_lists).length) {
    extra.push(`countries_lists: ${JSON.stringify(task.countries_lists)}`);
  }
  return { groups, extra: extra.join("\n") };
}

function textOrNull(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function intOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? Math.trunc(num) : null;
}

/** Задача PromoHub → задание графика. headerColor — цвет карточки на канве. */
export function mapPhTaskToPlannerImport(
  task: TaskLike,
  options: { headerColor?: string } = {},
): PlannerImportItem {
  const type = String(task.type ?? "").trim();
  const priority = PH_PRIORITY_TO_PLANNER[Number(task.priority)];
  const infinite = Boolean(task.infinite);
  const color = options.headerColor ? HEADER_COLOR_HEX[options.headerColor] : undefined;
  const tag = asObject(task.tag);
  const links = getGamificationTasksCondition(task.conditions);

  return {
    ph_backend_id: String(task.id ?? "").trim(),
    prerequisite_ph_ids: links && links.type !== "disabled" ? asArray(links.list).map(String) : [],
    // Служебные _planner*-поля карточки с канвы в снимок не нужны — только сама задача ПХ.
    ph_snapshot: Object.fromEntries(
      Object.entries(clonePlain(task)).filter(([key]) => !key.startsWith("_")),
    ),
    frontend_identifier: String(task.frontend_identifier ?? "").trim(),
    name_backend: String(task.name ?? "").trim(),
    name_frontend: mapLocales(task.locales),
    ...(TASK_TYPES.has(type) ? { task_type: type } : {}),
    ...(priority ? { priority } : {}),
    hidden: Boolean(task.hidden),
    player_consent_required: Boolean(task.player_consent_required),
    cron: textOrNull(task.cron),
    ...(color ? { color } : {}),
    countries: asArray(task.countries).map(String).filter(Boolean),
    category: textOrNull(task.category),
    tag: textOrNull(tag.name),
    events: asArray(task.events).map(String).filter(Boolean),
    notifications: asArray(task.notification_events).map(String).filter(Boolean),
    reward_points: parseBonusPointsFromGroupId(task.main_bonus_group_id),
    secondary_reward_points: parseBonusPointsFromGroupId(task.secondary_bonus_group_id),
    time_availability: {
      available_from: textOrNull(task.available_from),
      available_till: textOrNull(task.available_till),
      max_repetitions: intOrNull(task.max_repetitions),
      duration_minutes: infinite ? null : intOrNull(task.duration),
      infinite,
    },
    targeting: toPlannerTargeting(task),
    main_actions: toPlannerActions(task.serialized_main_actions),
    secondary_actions: toPlannerActions(task.serialized_secondary_actions),
  };
}
