/**
 * Статическая schema action builder из exports/panel_schema_extracted.json (actionBuilder)
 * + подписи из gamification_tasks.target_actions (panel_backend.js i18n ru).
 */

import { getConditionDef } from "./conditions-schema";
import type { ParsedConditionsSchema } from "./conditions-schema";
import { formatDecimalForApi, formatDecimalForUi, parseDecimalFromUi } from "./format";

export type FieldWidgetType =
  | "string"
  | "number"
  | "boolean"
  | "select"
  | "multi_text"
  | "multi_select"
  | "duration"
  | "money_range"
  | "comparison";

export type FieldRole = "condition" | "attribute";

export interface FieldOption {
  id: string;
  label: string;
}

export interface RequirementFieldDef {
  key: string;
  label: string;
  widget: FieldWidgetType;
  role: FieldRole;
  options?: FieldOption[];
  hint?: string;
  /** Ключ внешних options (payment_systems, game_categories). */
  optionsKey?: string;
  remoteOptions?: boolean;
}

export interface ActionDef {
  type: string;
  label: string;
  requirementFields: string[];
  conditionFields: RequirementFieldDef[];
  attributeFields: RequirementFieldDef[];
  handled: boolean;
}

export interface ComparisonOperator {
  id: string;
  label: string;
  symbol: string;
}

export interface ParsedComparisonValue {
  type: string;
  value: unknown;
}

export interface ActionFieldsSplit {
  requirements: Record<string, unknown>;
  conditions: Record<string, unknown>;
}

export interface VisibleFields {
  conditions: string[];
  attributes: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export const ACTION_TYPES: readonly string[] = [
  "achievement",
  "app_login",
  "bet",
  "bonus_issue",
  "cashout",
  "deposit",
  "email_confirmation",
  "gamification_task",
  "groups_update",
  "leaderboard",
  "phone_confirmation",
  "scratch_card",
  "sport_bet",
  "tournament",
  "two_factor",
  "user_update",
];

export const ACTION_LABELS: Record<string, string> = {
  achievement: "Достижения",
  app_login: "Логин из мобильного приложения",
  bet: "Ставки казино",
  bonus_issue: "Получение бонуса",
  cashout: "Вывод средств",
  deposit: "Депозит",
  email_confirmation: "Подтверждение email",
  gamification_task: "Задания",
  groups_update: "Присвоение группы",
  leaderboard: "Попасть в лидерборд",
  phone_confirmation: "Подтверждение телефона",
  scratch_card: "Скретч-карта",
  sport_bet: "Ставки на спорт",
  tournament: "Участие в турнире",
  two_factor: "Включение 2FA",
  user_update: "Заполнение профиля",
};

/** Поля requirements по action type (из extracted schema). */
export const REQUIREMENT_FIELDS_BY_ACTION: Record<string, string[]> = {
  achievement: ["achievements_count"],
  bet: [
    "bets_count",
    "bet_points_sum",
    "bet_type",
    "games",
    "game_categories",
    "min_bet_amount",
    "result",
    "win_coefficient",
    "in_sequence",
  ],
  deposit: [
    "payments_count",
    "points_sum",
    "min_points",
    "max_points",
    "payment_systems",
    "child_systems",
  ],
  cashout: [
    "payments_count",
    "points_sum",
    "min_points",
    "max_points",
    "payment_systems",
    "child_systems",
  ],
  bonus_issue: ["bonuses_count", "bonuses_points_sum", "name", "dsl_tag"],
  gamification_task: ["tasks_count", "statuses"],
  groups_update: ["group_ids"],
  scratch_card: ["scratch_card_ids"],
  leaderboard: ["place_min", "place_max"],
  sport_bet: [
    "sport_bets_count",
    "sport_bet_points_sum",
    "min_bet_amount",
    "odd",
    "result",
    "sport_bet_types",
    "sport_types",
  ],
  user_update: ["required_attributes"],
  tournament: ["tournaments_count", "tournament_ids", "games_taken_min", "place_min", "place_max"],
};

/** Доп. общие поля (duration, money_range) — в админке для deposit. */
export const MVP_EXTRA_FIELDS_BY_ACTION: Record<string, string[]> = {
  deposit: ["duration", "money_range"],
};

/** Action types с полной schema requirements в UI. */
export const HANDLED_ACTION_TYPES: Set<string> = new Set(Object.keys(REQUIREMENT_FIELDS_BY_ACTION));

/**
 * Явное разделение полей на условия/атрибуты по action type (как в админке).
 * Источник: requirementFieldsByAction + роли из FIELD_DEFS / MVP extras.
 */
export const CONDITION_FIELD_KEYS_BY_ACTION: Record<string, string[]> = {
  achievement: ["achievements_count"],
  bet: ["bets_count", "bet_points_sum"],
  deposit: ["payments_count", "points_sum"],
  cashout: ["payments_count", "points_sum"],
  bonus_issue: ["bonuses_count", "bonuses_points_sum"],
  gamification_task: ["tasks_count"],
  groups_update: ["group_ids"],
  scratch_card: ["scratch_card_ids"],
  leaderboard: [],
  sport_bet: ["sport_bets_count", "sport_bet_points_sum"],
  user_update: ["required_attributes"],
  tournament: ["tournaments_count", "games_taken_min"],
};

export const ATTRIBUTE_FIELD_KEYS_BY_ACTION: Record<string, string[]> = {
  achievement: [],
  bet: [
    "bet_type",
    "games",
    "game_categories",
    "min_bet_amount",
    "result",
    "win_coefficient",
    "in_sequence",
  ],
  deposit: ["min_points", "max_points", "payment_systems", "child_systems"],
  cashout: ["min_points", "max_points", "payment_systems", "child_systems"],
  bonus_issue: ["name", "dsl_tag"],
  gamification_task: ["statuses"],
  groups_update: [],
  scratch_card: [],
  leaderboard: ["place_min", "place_max"],
  sport_bet: ["min_bet_amount", "odd", "result", "sport_bet_types", "sport_types"],
  user_update: [],
  tournament: ["tournament_ids", "place_min", "place_max"],
};

/** Ключи профиля — опции multi-select `required_attributes` для user_update. */
export const USER_UPDATE_PROFILE_ATTRIBUTE_KEYS: readonly string[] = [
  "avatar",
  "nickname",
  "full_name",
  "date_of_birth",
  "gender",
  "country",
  "city",
  "state",
];

const USER_UPDATE_PROFILE_ATTRIBUTE_SET = new Set(USER_UPDATE_PROFILE_ATTRIBUTE_KEYS);

const USER_UPDATE_PROFILE_ATTRIBUTE_OPTIONS: FieldOption[] = [
  { id: "avatar", label: "Аватар" },
  { id: "nickname", label: "Никнейм" },
  { id: "full_name", label: "ФИО" },
  { id: "date_of_birth", label: "Дата рождения" },
  { id: "gender", label: "Пол" },
  { id: "country", label: "Страна" },
  { id: "city", label: "Город" },
  { id: "state", label: "Область" },
];

const DURATION_PERIODS: FieldOption[] = [
  { id: "hours", label: "Часы" },
  { id: "days", label: "Дни" },
  { id: "weeks", label: "Недели" },
  { id: "months", label: "Месяцы" },
  { id: "years", label: "Годы" },
];

const FIELD_DEFS: Record<string, RequirementFieldDef> = {
  bets_count: {
    key: "bets_count",
    label: "Количество ставок",
    widget: "string",
    role: "condition",
  },
  bet_points_sum: {
    key: "bet_points_sum",
    label: "Сумма ставок (в поинтах)",
    widget: "string",
    role: "condition",
  },
  bet_type: {
    key: "bet_type",
    label: "Вид ставки",
    widget: "select",
    role: "attribute",
    options: [
      { id: "real", label: "На реальные деньги" },
      { id: "bonus", label: "На бонусные деньги" },
    ],
  },
  games: {
    key: "games",
    label: "Игры",
    widget: "multi_select",
    role: "attribute",
    hint: "Поиск по названию или ID",
    optionsKey: "games",
    remoteOptions: true,
  },
  game_categories: {
    key: "game_categories",
    label: "Категории игр",
    widget: "multi_select",
    role: "attribute",
    optionsKey: "game_categories",
  },
  min_bet_amount: {
    key: "min_bet_amount",
    label: "Минимальный размер ставки (в поинтах)",
    widget: "string",
    role: "attribute",
  },
  result: {
    key: "result",
    label: "Результат ставки",
    widget: "select",
    role: "attribute",
    options: [
      { id: "win", label: "Выигрышная" },
      { id: "lose", label: "Проигрышная" },
    ],
  },
  win_coefficient: {
    key: "win_coefficient",
    label: "Коэффициент выигрыша",
    widget: "comparison",
    role: "attribute",
  },
  in_sequence: { key: "in_sequence", label: "Подряд", widget: "boolean", role: "attribute" },
  payments_count: {
    key: "payments_count",
    label: "Количество платежей",
    widget: "string",
    role: "condition",
  },
  points_sum: {
    key: "points_sum",
    label: "Сумма платежей (в поинтах)",
    widget: "string",
    role: "condition",
  },
  min_points: {
    key: "min_points",
    label: "Минимальный размер платежа",
    widget: "string",
    role: "attribute",
  },
  max_points: {
    key: "max_points",
    label: "Максимальный размер платежа",
    widget: "string",
    role: "attribute",
  },
  payment_systems: {
    key: "payment_systems",
    label: "Платежные системы",
    widget: "multi_select",
    role: "attribute",
    optionsKey: "payment_systems",
  },
  child_systems: {
    key: "child_systems",
    label: "Дочерние системы",
    widget: "multi_select",
    role: "attribute",
    optionsKey: "child_systems",
    hint: "ID дочерних систем",
  },
  sport_bets_count: {
    key: "sport_bets_count",
    label: "Количество ставок",
    widget: "string",
    role: "condition",
  },
  sport_bet_points_sum: {
    key: "sport_bet_points_sum",
    label: "Сумма ставок (в поинтах)",
    widget: "string",
    role: "condition",
  },
  odd: { key: "odd", label: "Коэффициент ставки", widget: "comparison", role: "attribute" },
  sport_bet_types: {
    key: "sport_bet_types",
    label: "Тип ставки",
    widget: "multi_select",
    role: "attribute",
    options: [
      { id: "single", label: "Ординар" },
      { id: "express", label: "Экспресс" },
      { id: "system", label: "Система" },
    ],
  },
  sport_types: {
    key: "sport_types",
    label: "Дисциплина",
    widget: "multi_select",
    role: "attribute",
    optionsKey: "sport_types",
    hint: "ID дисциплин",
  },
  achievements_count: {
    key: "achievements_count",
    label: "Количество достижений",
    widget: "string",
    role: "condition",
  },
  bonuses_count: {
    key: "bonuses_count",
    label: "Количество бонусов",
    widget: "string",
    role: "condition",
  },
  bonuses_points_sum: {
    key: "bonuses_points_sum",
    label: "Сумма бонусов (в поинтах)",
    widget: "string",
    role: "condition",
  },
  name: { key: "name", label: "Название бонуса", widget: "string", role: "attribute" },
  dsl_tag: { key: "dsl_tag", label: "DSL-тэг", widget: "string", role: "attribute" },
  tasks_count: { key: "tasks_count", label: "Количество", widget: "string", role: "condition" },
  statuses: {
    key: "statuses",
    label: "Статус",
    widget: "multi_select",
    role: "attribute",
    options: [
      { id: "activated", label: "Принятые" },
      { id: "finished", label: "Выполненные" },
    ],
  },
  required_attributes: {
    key: "required_attributes",
    label: "Атрибуты для заполнения",
    widget: "multi_select",
    role: "condition",
    options: USER_UPDATE_PROFILE_ATTRIBUTE_OPTIONS,
  },
  duration: {
    key: "duration",
    label: "Продолжительность",
    widget: "duration",
    role: "condition",
    hint: "Объект { value, period }",
  },
  money_range: {
    key: "money_range",
    label: "Диапазон суммы",
    widget: "money_range",
    role: "condition",
    hint: "Объект { min, max } в поинтах",
  },
  tournaments_count: {
    key: "tournaments_count",
    label: "Количество турниров",
    widget: "number",
    role: "condition",
  },
  tournament_ids: {
    key: "tournament_ids",
    label: "Турниры",
    widget: "multi_select",
    role: "attribute",
    optionsKey: "tournaments",
    hint: "ID турниров",
  },
  games_taken_min: {
    key: "games_taken_min",
    label: "Мин. количество ставок",
    widget: "number",
    role: "condition",
  },
  place_min: {
    key: "place_min",
    label: "Минимальное место",
    widget: "number",
    role: "attribute",
  },
  place_max: {
    key: "place_max",
    label: "Максимальное место",
    widget: "number",
    role: "attribute",
  },
  group_ids: {
    key: "group_ids",
    label: "Группы",
    widget: "multi_select",
    role: "condition",
    optionsKey: "groups",
    hint: "ID групп",
  },
  scratch_card_ids: {
    key: "scratch_card_ids",
    label: "Скретч-карты",
    widget: "multi_select",
    role: "condition",
    optionsKey: "scratch_cards",
    hint: "ID скретч-карт",
  },
};

/** Явные роли для полей вне FIELD_DEFS (по суффиксам). */
const CONDITION_SUFFIXES = /_(count|sum)$/;
const CONDITION_KEYS = new Set(["duration", "money_range", "games_taken_min"]);

export function getFieldRole(key: string): FieldRole {
  const def = FIELD_DEFS[key];
  if (def?.role) return def.role;
  if (CONDITION_KEYS.has(key) || CONDITION_SUFFIXES.test(key)) return "condition";
  return "attribute";
}

export function getFieldRoleForAction(actionType: string, key: string): FieldRole | null {
  const type = String(actionType || "").trim();
  const fieldKey = String(key || "").trim();
  if (!type || !fieldKey) return null;
  if ((CONDITION_FIELD_KEYS_BY_ACTION[type] || []).includes(fieldKey)) return "condition";
  if ((ATTRIBUTE_FIELD_KEYS_BY_ACTION[type] || []).includes(fieldKey)) return "attribute";
  return null;
}

export function getAllRequirementFieldKeys(actionType: string): string[] {
  const type = String(actionType || "").trim();
  const conditionKeys = CONDITION_FIELD_KEYS_BY_ACTION[type] || [];
  const attributeKeys = ATTRIBUTE_FIELD_KEYS_BY_ACTION[type] || [];
  return [...new Set([...conditionKeys, ...attributeKeys])];
}

export function isRequirementFieldAllowed(actionType: string, key: string): boolean {
  const type = String(actionType || "").trim();
  const fieldKey = String(key || "").trim();
  if (!type || !fieldKey) return false;
  return getAllRequirementFieldKeys(type).includes(fieldKey);
}

export function filterFieldKeysForAction(
  actionType: string,
  keys: string[] | null | undefined,
  role: FieldRole | "" = "",
): string[] {
  const type = String(actionType || "").trim();
  const allowed =
    role === "condition"
      ? CONDITION_FIELD_KEYS_BY_ACTION[type] || []
      : role === "attribute"
        ? ATTRIBUTE_FIELD_KEYS_BY_ACTION[type] || []
        : getAllRequirementFieldKeys(type);
  const allowedSet = new Set(allowed);
  return (keys || []).filter((key) => allowedSet.has(key));
}

function isFieldDef(def: RequirementFieldDef | null): def is RequirementFieldDef {
  return Boolean(def);
}

export function getConditionFieldsForAction(actionType: string): RequirementFieldDef[] {
  const type = String(actionType || "").trim();
  return (CONDITION_FIELD_KEYS_BY_ACTION[type] || [])
    .map((key) => getRequirementFieldDef(key))
    .filter(isFieldDef);
}

export function getAttributeFieldsForAction(actionType: string): RequirementFieldDef[] {
  const type = String(actionType || "").trim();
  return (ATTRIBUTE_FIELD_KEYS_BY_ACTION[type] || [])
    .map((key) => getRequirementFieldDef(key))
    .filter(isFieldDef);
}

export function getActionDef(actionType: string): ActionDef | null {
  const type = String(actionType || "").trim();
  if (!type) return null;

  const requirementFields = getAllRequirementFieldKeys(type);

  return {
    type,
    label: ACTION_LABELS[type] || type,
    requirementFields,
    conditionFields: getConditionFieldsForAction(type),
    attributeFields: getAttributeFieldsForAction(type),
    handled: HANDLED_ACTION_TYPES.has(type),
  };
}

export function getAllActionTypes(): ActionDef[] {
  return ACTION_TYPES.map((type) => getActionDef(type)).filter((def): def is ActionDef =>
    Boolean(def),
  );
}

export function getRequirementFieldDef(key: string): RequirementFieldDef | null {
  if (key === "duration") {
    return { ...(FIELD_DEFS.duration as RequirementFieldDef), options: DURATION_PERIODS };
  }
  const def = FIELD_DEFS[key];
  return def ? { ...def } : null;
}

export function isHandledActionType(actionType: string): boolean {
  return HANDLED_ACTION_TYPES.has(String(actionType || "").trim());
}

function coerceToFiniteNumber(value: unknown): number | undefined {
  return parseDecimalFromUi(value);
}

/**
 * Приводит числовые поля requirements к number (бэкенд валидирует type: number).
 */
export function coerceActionRequirements(
  actionType: string,
  requirements: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const type = String(actionType || "").trim();
  const source: Record<string, unknown> =
    requirements && typeof requirements === "object" ? { ...requirements } : {};
  const keys = getAllRequirementFieldKeys(type);
  const out: Record<string, unknown> = { ...source };

  for (const key of keys) {
    if (!(key in out)) continue;
    const fieldDef = getRequirementFieldDef(key);
    if (fieldDef?.widget === "number") {
      const num = coerceToFiniteNumber(out[key]);
      if (num === undefined) delete out[key];
      else out[key] = num;
      continue;
    }
    const list = out[key];
    if (
      (key === "tournament_ids" || key === "group_ids" || key === "scratch_card_ids") &&
      Array.isArray(list)
    ) {
      const nums = list
        .map((item: unknown) => coerceToFiniteNumber(item))
        .filter((item): item is number => item !== undefined);
      out[key] = nums;
      if (!nums.length) delete out[key];
    }
  }

  if (isRecord(out.duration)) {
    const duration: Record<string, unknown> = { ...out.duration };
    const value = coerceToFiniteNumber(duration.value);
    if (value === undefined) delete duration.value;
    else duration.value = value;
    out.duration = duration;
  }

  if (isRecord(out.money_range)) {
    const range: Record<string, unknown> = { ...out.money_range };
    for (const part of ["min", "max"]) {
      const num = coerceToFiniteNumber(range[part]);
      if (num === undefined) delete range[part];
      else range[part] = num;
    }
    out.money_range = range;
  }

  if (type === "deposit" || type === "cashout") {
    for (const key of ["min_points", "max_points"]) {
      if (!(key in out)) continue;
      const num = coerceToFiniteNumber(out[key]);
      if (num === undefined) delete out[key];
      else out[key] = num;
    }
  }

  if (type === "bet" && "min_bet_amount" in out) {
    const num = coerceToFiniteNumber(out.min_bet_amount);
    if (num === undefined) delete out.min_bet_amount;
    else out.min_bet_amount = num;
  }

  for (const key of keys) {
    if (!isComparisonFieldKey(key) || !(key in out)) continue;
    const parsed = parseComparisonValue(out[key]);
    const built = buildComparisonValue(parsed.type, parsed.value);
    if (built) out[key] = built;
    else delete out[key];
  }

  if (type === "user_update") {
    for (const key of USER_UPDATE_PROFILE_ATTRIBUTE_KEYS) {
      delete out[key];
    }
    if ("required_attributes" in out) {
      const attrs = normalizeRequiredAttributesValue(out.required_attributes);
      if (attrs.length) out.required_attributes = attrs;
      else delete out.required_attributes;
    }
  }

  return out;
}

/**
 * Приводит conditions к API-формату (user_update.required_attributes и т.д.).
 */
export function coerceActionConditions(
  actionType: string,
  conditions: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const type = String(actionType || "").trim();
  const source: Record<string, unknown> =
    conditions && typeof conditions === "object" ? { ...conditions } : {};

  if (type === "user_update") {
    const cond: Record<string, unknown> = { ...source };
    delete cond.required_attributes;
    for (const key of USER_UPDATE_PROFILE_ATTRIBUTE_KEYS) {
      delete cond[key];
    }
    return cond;
  }

  for (const key of COMPARISON_FIELD_KEYS) {
    if (!(key in source)) continue;
    const built = normalizeComparisonFieldForApi(source[key]);
    if (built) source[key] = built;
    else delete source[key];
  }

  return source;
}

/** Элемент списка из schema ({ id, name }) → опция select. Как в legacy: падает на null-элементе. */
function optionFromRef(item: unknown): FieldOption {
  const ref = item as { id?: unknown; name?: unknown };
  return { id: String(ref.id), label: String(ref.name ?? ref.id) };
}

/**
 * Опции select/multi из conditions schema (payment_systems, game_categories).
 */
export function buildActionFieldOptionsFromConditionsSchema(
  schema: ParsedConditionsSchema | null | undefined,
): Record<string, FieldOption[]> {
  const out: Record<string, FieldOption[]> = {};
  if (!schema) return out;

  for (const condName of ["deposit_payment_systems", "cashout_payment_systems"]) {
    const def = getConditionDef(schema, condName);
    const systems = def?.extra?.paymentSystems;
    if (Array.isArray(systems) && systems.length) {
      out.payment_systems = systems.map(optionFromRef);
      break;
    }
  }

  for (const cond of schema.conditions || []) {
    const cats = cond.extra?.availableGameCategories;
    if (Array.isArray(cats) && cats.length && !out.game_categories) {
      out.game_categories = cats.map(optionFromRef);
    }
    const tournaments = cond.extra?.availableTournaments;
    if (Array.isArray(tournaments) && tournaments.length && !out.tournaments) {
      out.tournaments = tournaments.map(optionFromRef);
    }
    if (!out.groups) {
      const groups: unknown =
        (cond.type === "groups" && cond.collection) || cond.extra?.availableGroups;
      if (Array.isArray(groups) && groups.length) {
        out.groups = groups.map(optionFromRef);
      }
    }
    if (!out.scratch_cards) {
      const cards: unknown =
        (cond.type === "scratch_cards" && (cond.extra?.scratchCards || cond.collection)) ||
        cond.extra?.availableScratchCards;
      if (Array.isArray(cards) && cards.length) {
        out.scratch_cards = cards.map(optionFromRef);
      }
    }
  }

  return out;
}

export const COMPARISON_FIELD_KEYS: readonly string[] = ["odd", "win_coefficient"];

/**
 * Операторы сравнения (как в админке).
 * UI хранит внутренний `type` (eq/gt/lt/min/max); API — `{ operator, value }`.
 */
export const COMPARISON_OPERATORS: readonly ComparisonOperator[] = [
  { id: "eq", label: "равно", symbol: "=" },
  { id: "gt", label: "больше", symbol: ">" },
  { id: "lt", label: "меньше", symbol: "<" },
  { id: "min", label: "больше или равно", symbol: ">=" },
  { id: "max", label: "меньше или равно", symbol: "<=" },
];

const COMPARISON_TYPE_ALIASES: Record<string, string> = {
  eq: "eq",
  equals: "eq",
  gt: "gt",
  greater_than: "gt",
  lt: "lt",
  less_than: "lt",
  min: "min",
  gte: "min",
  greater_than_or_equal: "min",
  greater_or_equal: "min",
  max: "max",
  lte: "max",
  less_than_or_equal: "max",
  less_or_equal: "max",
};

const COMPARISON_OPERATOR_SYMBOL_TO_TYPE: Record<string, string> = {
  "=": "eq",
  "==": "eq",
  ">": "gt",
  "<": "lt",
  ">=": "min",
  "<=": "max",
};

const COMPARISON_TYPE_TO_OPERATOR: Record<string, string> = {
  eq: "=",
  gt: ">",
  lt: "<",
  min: ">=",
  max: "<=",
};

export function isComparisonFieldKey(key: string): boolean {
  return COMPARISON_FIELD_KEYS.includes(key);
}

export function normalizeComparisonType(rawType: unknown): string {
  const key = String(rawType ?? "").trim();
  return COMPARISON_TYPE_ALIASES[key] || key;
}

export function parseComparisonValue(value: unknown): ParsedComparisonValue {
  if (!isRecord(value)) {
    return { type: "min", value: "" };
  }
  const obj = value;
  if (obj.operator != null) {
    const operatorKey = String(obj.operator).trim();
    const type =
      COMPARISON_OPERATOR_SYMBOL_TO_TYPE[operatorKey] ||
      normalizeComparisonType(operatorKey) ||
      "min";
    const extracted = obj.value ?? (Array.isArray(obj.list) ? obj.list[0] : undefined);
    return { type, value: extracted == null ? "" : extracted };
  }
  const rawType = String(obj.type ?? "min").trim();
  const type =
    COMPARISON_OPERATOR_SYMBOL_TO_TYPE[rawType] || normalizeComparisonType(rawType) || "min";
  const extracted =
    obj.value ?? (Array.isArray(obj.list) ? obj.list[0] : undefined) ?? obj.min ?? obj.max;
  return { type, value: extracted == null ? "" : extracted };
}

export function buildComparisonValue(
  type: unknown,
  value: unknown,
): Record<string, unknown> | undefined {
  const normalizedType = normalizeComparisonType(type) || "min";
  if (!COMPARISON_OPERATORS.some((op) => op.id === normalizedType)) return undefined;
  const operator = COMPARISON_TYPE_TO_OPERATOR[normalizedType];
  if (!operator) return undefined;
  const formatted = formatDecimalForApi(value);
  if (formatted === undefined) return undefined;
  return { operator, value: formatted };
}

function normalizeComparisonFieldForApi(value: unknown): Record<string, unknown> | undefined {
  const parsed = parseComparisonValue(value);
  return buildComparisonValue(parsed.type, parsed.value);
}

function isComparisonObject(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).length > 0;
}

function hasComparisonFieldValue(value: unknown): boolean {
  if (!isComparisonObject(value)) return false;
  const parsed = parseComparisonValue(value);
  if (parsed.value === "" || parsed.value == null) return false;
  if (typeof parsed.value === "string" && !parsed.value.trim()) return false;
  return true;
}

function normalizeGameCategoriesValue(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value
    .map((item: unknown) => {
      if (isRecord(item)) {
        return String(item.id ?? item.value ?? item.name ?? "");
      }
      return String(item);
    })
    .filter(Boolean);
}

function normalizeGamesValue(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item: unknown) => {
      if (isRecord(item)) {
        return String(item.id ?? item.value ?? item.game_id ?? item.gameId ?? item.name ?? "");
      }
      return String(item);
    })
    .filter(Boolean);
}

function normalizeRequiredAttributesValue(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item: unknown) => {
      if (isRecord(item)) {
        return String(item.id ?? item.value ?? item.name ?? "");
      }
      return String(item);
    })
    .filter((id) => USER_UPDATE_PROFILE_ATTRIBUTE_SET.has(id));
}

/**
 * Собирает `required_attributes` из массива и legacy boolean-полей профиля.
 */
function extractUserUpdateRequiredAttributes(
  requirements: Record<string, unknown> | null | undefined,
  conditions: Record<string, unknown> | null | undefined,
): string[] {
  const attrs = new Set<string>();
  const req: Record<string, unknown> =
    requirements && typeof requirements === "object" ? requirements : {};
  const cond: Record<string, unknown> =
    conditions && typeof conditions === "object" ? conditions : {};

  const arraySource =
    "required_attributes" in req
      ? req.required_attributes
      : "required_attributes" in cond
        ? cond.required_attributes
        : undefined;
  for (const id of normalizeRequiredAttributesValue(arraySource)) {
    attrs.add(id);
  }

  for (const source of [req, cond]) {
    for (const key of USER_UPDATE_PROFILE_ATTRIBUTE_KEYS) {
      const val = source[key];
      if (val === true || val === 1 || val === "true" || val === "1") {
        attrs.add(key);
      }
    }
  }

  return USER_UPDATE_PROFILE_ATTRIBUTE_KEYS.filter((key) => attrs.has(key));
}

function normalizeUserUpdateApiPayload(
  requirements: Record<string, unknown>,
  conditions: Record<string, unknown>,
): ActionFieldsSplit {
  const attrs = extractUserUpdateRequiredAttributes(requirements, conditions);
  const req: Record<string, unknown> = {};
  const cond: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(requirements || {})) {
    if (USER_UPDATE_PROFILE_ATTRIBUTE_SET.has(key) || key === "required_attributes") continue;
    req[key] = val;
  }
  for (const [key, val] of Object.entries(conditions || {})) {
    if (USER_UPDATE_PROFILE_ATTRIBUTE_SET.has(key) || key === "required_attributes") continue;
    cond[key] = val;
  }
  if (attrs.length) req.required_attributes = attrs;
  return { requirements: req, conditions: cond };
}

function isLegacyUserUpdateProfileBoolean(
  requirements: Record<string, unknown> | null | undefined,
  key: string,
): boolean {
  if (!USER_UPDATE_PROFILE_ATTRIBUTE_SET.has(key)) return false;
  const val = requirements?.[key];
  return val === true || val === 1 || val === "true" || val === "1";
}

/**
 * Объединяет API `requirements` (условия) и `conditions` (атрибуты) в единый объект для UI.
 */
export function mergeActionFieldsForUi(
  actionType: string,
  requirements: unknown,
  conditions: unknown,
): Record<string, unknown> {
  const type = String(actionType || "").trim();
  const req: Record<string, unknown> = isRecord(requirements) ? requirements : {};
  const cond: Record<string, unknown> = isRecord(conditions) ? conditions : {};
  const allowed = new Set(getAllRequirementFieldKeys(type));
  const merged: Record<string, unknown> = {};

  for (const key of allowed) {
    const role = getFieldRoleForAction(type, key);
    if (!role) continue;
    const primary = role === "condition" ? req : cond;
    const fallback = role === "condition" ? cond : req;
    const val = key in primary ? primary[key] : fallback[key];
    if (val === undefined) continue;
    if (key === "game_categories") {
      merged[key] = normalizeGameCategoriesValue(val);
      continue;
    }
    if (key === "games") {
      merged[key] = normalizeGamesValue(val);
      continue;
    }
    merged[key] = val;
  }

  if (type === "user_update") {
    const attrs = extractUserUpdateRequiredAttributes(req, cond);
    if (attrs.length) return { required_attributes: attrs };
    return {};
  }

  return merged;
}

/**
 * Делит UI-объект обратно на API `requirements` (условия) и `conditions` (атрибуты).
 */
export function splitActionFieldsForApi(actionType: string, fields: unknown): ActionFieldsSplit {
  const type = String(actionType || "").trim();
  const source: Record<string, unknown> = isRecord(fields) ? fields : {};
  const allowed = new Set(getAllRequirementFieldKeys(type));
  const requirements: Record<string, unknown> = {};
  const conditions: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(source)) {
    if (!allowed.has(key)) continue;
    if (!hasRequirementValue(source, key, type)) continue;
    const role = getFieldRoleForAction(type, key);
    if (!role) continue;
    const bucket = role === "condition" ? requirements : conditions;
    if (key === "game_categories") {
      bucket[key] = normalizeGameCategoriesValue(val);
    } else if (key === "games") {
      bucket[key] = normalizeGamesValue(val);
    } else if (isComparisonFieldKey(key)) {
      const built = normalizeComparisonFieldForApi(val);
      if (built) bucket[key] = built;
    } else {
      bucket[key] = val;
    }
  }

  if (type === "user_update") {
    return normalizeUserUpdateApiPayload(requirements, conditions);
  }

  return { requirements, conditions };
}

export function formatRequirementFieldInputValue(key: string, value: unknown): string {
  if (isComparisonFieldKey(key) && isComparisonObject(value)) {
    const extracted = parseComparisonValue(value).value;
    if (extracted == null || extracted === "") return "";
    const num = coerceToFiniteNumber(extracted);
    return num === undefined ? String(extracted) : formatDecimalForUi(num);
  }
  return value == null ? "" : String(value);
}

export function readRequirementFieldInputValue(
  key: string,
  raw: string,
  previous: unknown,
): unknown {
  if (isComparisonFieldKey(key) && isComparisonObject(previous)) {
    const parsed = parseComparisonValue(previous);
    return buildComparisonValue(parsed.type, raw) ?? previous;
  }
  if (isComparisonFieldKey(key)) {
    return buildComparisonValue("min", raw) ?? raw;
  }
  return raw;
}

export function hasRequirementValue(
  requirements: Record<string, unknown> | null | undefined,
  key: string,
  actionType = "",
): boolean {
  const val = requirements?.[key];
  if (
    key === "required_attributes" &&
    actionType === "user_update" &&
    !normalizeRequiredAttributesValue(val).length
  ) {
    return USER_UPDATE_PROFILE_ATTRIBUTE_KEYS.some((profileKey) =>
      isLegacyUserUpdateProfileBoolean(requirements, profileKey),
    );
  }
  if (isComparisonFieldKey(key)) {
    return hasComparisonFieldValue(val);
  }
  if (key === "money_range") {
    if (isRecord(val) && (val.min || val.max)) {
      return true;
    }
    if (
      (actionType === "deposit" || actionType === "cashout") &&
      (requirements?.min_points || requirements?.max_points)
    ) {
      return true;
    }
    return false;
  }
  if (key === "duration") {
    return !!(isRecord(val) && (val.value || val.period));
  }
  if (val == null) return false;
  if (typeof val === "string" && !val.trim()) return false;
  if (Array.isArray(val) && !val.length) return false;
  if (typeof val === "object" && !Array.isArray(val) && !Object.keys(val).length) return false;
  return true;
}

export function deriveVisibleFieldsFromRequirements(
  actionType: string,
  requirements: Record<string, unknown> | null | undefined,
): VisibleFields {
  const def = getActionDef(actionType);
  if (!def?.handled) {
    return { conditions: [], attributes: [] };
  }
  return {
    conditions: filterFieldKeysForAction(
      actionType,
      def.conditionFields
        .map((f) => f.key)
        .filter((key) => hasRequirementValue(requirements, key, actionType)),
      "condition",
    ),
    attributes: filterFieldKeysForAction(
      actionType,
      def.attributeFields
        .map((f) => f.key)
        .filter((key) => hasRequirementValue(requirements, key, actionType)),
      "attribute",
    ),
  };
}

export { DURATION_PERIODS, FIELD_DEFS };
