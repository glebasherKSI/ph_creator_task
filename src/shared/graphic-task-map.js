import {
  coerceActionConditions,
  coerceActionRequirements,
  getAllRequirementFieldKeys,
  splitActionFieldsForApi,
} from "./actions-schema.js";

const PLANNER_PRIORITY_TO_PH = {
  highest: 0,
  high: 1,
  medium: 2,
  low: 3,
  lowest: 4,
};

const TASK_TYPES = new Set(["interactive", "informational", "achievement"]);

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function coerceRowValue(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (text === "true") return true;
  if (text === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  if (text.includes(",")) return text.split(",").map((part) => part.trim()).filter(Boolean);
  return text;
}

function rowsToObject(rows) {
  const out = {};
  for (const row of asArray(rows)) {
    if (!row || typeof row !== "object") continue;
    const key = String(row.key || "").trim();
    if (!key) continue;
    out[key] = coerceRowValue(row.value);
  }
  return out;
}

function mapActionItem(item) {
  if (!item || typeof item !== "object") return null;
  const action = String(item.action || "").trim();
  if (!action) return null;
  const fields = { ...rowsToObject(item.conditions), ...rowsToObject(item.attributes) };
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

function mapActionList(items) {
  const mapped = [];
  const leftoverNotes = [];
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

function mapPriority(raw) {
  if (raw == null || raw === "") return 0;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const key = String(raw).trim().toLowerCase();
  if (key in PLANNER_PRIORITY_TO_PH) return PLANNER_PRIORITY_TO_PH[key];
  const asNumber = Number(key);
  return Number.isFinite(asNumber) ? asNumber : 0;
}

function mapType(raw) {
  const type = String(raw || "").trim().toLowerCase();
  return TASK_TYPES.has(type) ? type : "interactive";
}

function mapCountries(raw) {
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

function mapLocales(nameFrontend) {
  const source = asObject(nameFrontend);
  const locales = {};
  for (const [code, value] of Object.entries(source)) {
    const text = String(value || "").trim();
    if (text) locales[String(code).toLowerCase()] = text;
  }
  return locales;
}

function mapTime(task) {
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

function backendTaskName(task) {
  const fromBackend = String(task.name_backend ?? "").trim();
  if (fromBackend) return fromBackend;
  const fromInternal = String(task.name_internal ?? "").trim();
  if (fromInternal) return fromInternal;
  return "Задача";
}

/** Обязательные boolean-условия для новых черновиков из графика (не для ph_backend_id). */
const DEFAULT_DRAFT_CONDITION_FLAGS = [
  ["no_bonus", false],
  ["no_bonus_sport", false],
  ["fraud", false],
  ["gambling_addict", false],
];

/**
 * API-формат conditions: [{ no_bonus: false }, ...].
 * Уже присутствующие ключи не дублируются и не перезаписываются.
 * @param {unknown} existing
 * @returns {object[]}
 */
function mergeDefaultDraftConditions(existing) {
  const out = [];
  const present = new Set();

  for (const entry of asArray(existing)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const keys = Object.keys(entry);
    if (!keys.length) continue;
    out.push({ ...entry });
    for (const key of keys) present.add(key);
  }

  for (const [key, value] of DEFAULT_DRAFT_CONDITION_FLAGS) {
    if (present.has(key)) continue;
    out.push({ [key]: value });
  }
  return out;
}

const MAPPED_PLANNER_KEYS = new Set([
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

const KNOWN_TARGETING_KEYS = new Set([
  "extra",
  "completed_task_ids",
  "prerequisite_task_id",
  "exclude_tags",
  "groups",
]);

function isPresent(value) {
  if (value == null || value === "") return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function formatHintValue(value) {
  if (Array.isArray(value)) return value.map((item) => formatHintValue(item)).filter(Boolean).join(", ");
  if (value && typeof value === "object") {
    return Object.entries(value)
      .filter(([, nested]) => isPresent(nested))
      .map(([key, nested]) => `${key}: ${formatHintValue(nested)}`)
      .join("; ");
  }
  return String(value);
}

const PLANNER_HINT_SECTION_IDS = new Set([
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

function sectionForUnmappedPlannerKey(key) {
  const raw = String(key || "");
  const lower = raw.toLowerCase();
  if (lower.startsWith("targeting.")) return "targeting";
  const k = lower.replace(/^targeting\./, "");
  if (/^(tag|tags|tag_id|category|priority)$/.test(k)) return "classification";
  if (/country|countries|geo/.test(k)) return "basic";
  if (/notif/.test(k)) return "notifications";
  if (/^(events?)$/.test(k) || k.startsWith("event")) return "startup";
  if (/available_|duration|infinite|cron|repeat|max_rep/.test(k)) return "availability";
  if (/action/.test(k)) return "actions";
  if (/reward|bonus|points/.test(k)) return "rewards";
  if (/description|button_text|condition_text|locale|name_/.test(k)) return "basic";
  return null;
}

function leftoverPlannerFields(task, targeting) {
  const bySection = {};
  const leftover = [];

  function push(sectionId, line) {
    if (sectionId && PLANNER_HINT_SECTION_IDS.has(sectionId)) {
      if (!bySection[sectionId]) bySection[sectionId] = [];
      bySection[sectionId].push(line);
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

function lookupPlannerTask(tasksById, id) {
  if (!tasksById || id == null || id === "") return null;
  if (typeof tasksById.get === "function") {
    return tasksById.get(id) || tasksById.get(String(id)) || tasksById.get(Number(id)) || null;
  }
  return tasksById[id] || tasksById[String(id)] || null;
}

function pushHint(target, title, bodyLines) {
  const body = (bodyLines || []).filter((line) => line != null && String(line).trim() !== "");
  if (!body.length) return;
  target.push({ title, body });
}

function flattenPlannerHints(sections, leftover) {
  const lines = [];
  function dump(items) {
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

function buildPlannerHints(task, leftoverNotes, context = {}) {
  const targeting = asObject(task.targeting);
  const sections = {};
  const leftover = [];

  function add(sectionId, title, bodyLines) {
    if (!sections[sectionId]) sections[sectionId] = [];
    pushHint(sections[sectionId], title, bodyLines);
  }

  const targetingLines = [];
  const extra = String(targeting.extra ?? "").replace(/^\n+/, "").replace(/\s+$/g, "");
  if (extra) targetingLines.push(extra);

  const prereqId = targeting.prerequisite_task_id;
  const prereqFrontId = String(
    lookupPlannerTask(context.tasksById, prereqId)?.frontend_identifier || ""
  ).trim();
  if (prereqFrontId) targetingLines.push(`Предшественник: ${prereqFrontId}`);
  else if (isPresent(prereqId)) targetingLines.push(`Предшественник: ${formatHintValue(prereqId)}`);
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

  const rewardLines = [];
  if (isPresent(task.reward_points)) {
    rewardLines.push(`Основная награда: ${formatHintValue(task.reward_points)} pts`);
  }
  if (isPresent(task.secondary_reward_points)) {
    rewardLines.push(`Дополнительная награда: ${formatHintValue(task.secondary_reward_points)} pts`);
  }
  if (rewardLines.length) add("rewards", "Награда", rewardLines);

  const textLines = [];
  if (isPresent(task.description)) textLines.push(`Описание: ${String(task.description).trim()}`);
  if (isPresent(task.description_cms)) textLines.push(`CMS: ${String(task.description_cms).trim()}`);
  if (isPresent(task.description_detailed)) {
    textLines.push(`Подробное описание: ${String(task.description_detailed).trim()}`);
  }
  if (isPresent(task.condition_text)) {
    textLines.push(`Условие для игрока: ${String(task.condition_text).trim()}`);
  }
  if (isPresent(task.button_text)) textLines.push(`Текст кнопки: ${formatHintValue(task.button_text)}`);
  if (textLines.length) add("basic", "Описания", textLines);

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

  return {
    sections,
    leftover,
    note: flattenPlannerHints(sections, leftover),
  };
}

/**
 * @param {object} task
 * @returns {number|null}
 */
export function getPlannerPhBackendId(task) {
  const raw = asObject(task).ph_backend_id;
  if (raw == null || raw === "") return null;
  const num = Number(raw);
  return Number.isInteger(num) && num > 0 ? num : null;
}

/**
 * Только бриф/мета планировщика — без полей формы PromoHub.
 * @param {object} task
 * @param {{ tasksById?: Map<*, object>|Record<string, object> }} [context]
 */
export function buildPlannerBriefOverlay(task, context = {}) {
  const source = asObject(task);
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

/**
 * База = задача с бэка PromoHub; сверху только бриф из графика.
 * @param {object} backendTask
 * @param {object} graphicTask
 * @param {{ tasksById?: Map<*, object>|Record<string, object> }} [context]
 */
export function mergeBackendTaskWithPlannerBrief(backendTask, graphicTask, context = {}) {
  const base = clonePlain(backendTask);
  return {
    ...base,
    ...buildPlannerBriefOverlay(graphicTask, context),
  };
}

function clonePlain(value) {
  if (value == null || typeof value !== "object") return {};
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return { ...value };
  }
}

/**
 * Планировщик → тело локального черновика для fillFromTask / buildCreatePayload.
 * @param {object} task
 * @param {{ tasksById?: Map<*, object>|Record<string, object> }} [context]
 * @returns {object}
 */
export function mapPlannerTaskToDraft(task, context = {}) {
  const source = asObject(task);
  const targeting = asObject(source.targeting);
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
