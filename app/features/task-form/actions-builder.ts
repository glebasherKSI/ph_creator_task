/**
 * Чистая логика редактора целевых действий (замена actions-builder.js без DOM).
 * Схема полей и коэрция живут в `@/lib/actions-schema`; здесь только модель редактора:
 * API-действие ↔ плоский UI-объект полей, видимые поля, композитные виджеты.
 */
import {
  coerceActionConditions,
  coerceActionRequirements,
  deriveVisibleFieldsFromRequirements,
  filterFieldKeysForAction,
  getAttributeFieldsForAction,
  getConditionFieldsForAction,
  isRequirementFieldAllowed,
  mergeActionFieldsForUi,
  splitActionFieldsForApi,
  type FieldOption,
  type FieldRole,
  type RequirementFieldDef,
  type VisibleFields,
} from "@/lib/actions-schema";
import { formatJsonStrict } from "@/lib/format";
import type { TaskAction } from "@/lib/types";

export type BlockId = "main" | "secondary";

/** Тип действия для новой карточки — как в старом билдере. */
export const DEFAULT_ACTION_TYPE = "bet";

/** Плоский объект полей действия (условия + атрибуты вместе), как в UI старого билдера. */
export type ActionFields = Record<string, unknown>;

/** Разобранное входящее действие: UI-поля и видимые по значениям поля. */
export interface ParsedAction {
  action: string;
  requirements: ActionFields;
  visible: VisibleFields;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function deepClone<T>(value: T): T {
  if (value == null) return value;
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

/** Оставляет только поля, разрешённые схемой для типа действия. */
export function pickRequirementsForAction(actionType: string, fields: unknown): ActionFields {
  const out: ActionFields = {};
  if (!isRecord(fields)) return out;
  for (const [key, val] of Object.entries(fields)) {
    if (isRequirementFieldAllowed(actionType, key)) out[key] = val;
  }
  return out;
}

/** Убирает пустые значения: null, пустые строки/массивы/объекты. */
export function cleanRequirements(fields: unknown): ActionFields {
  const out: ActionFields = {};
  if (!isRecord(fields)) return out;
  for (const [key, val] of Object.entries(fields)) {
    if (val == null) continue;
    if (typeof val === "string" && !val.trim()) continue;
    if (Array.isArray(val) && !val.length) continue;
    if (isRecord(val) && !Object.keys(val).length) continue;
    out[key] = val;
  }
  return out;
}

/** Паритет с legacy `parseActionsArray`: фильтрует мусор, объединяет requirements/conditions. */
export function parseActionsArray(value: unknown): ParsedAction[] {
  if (!Array.isArray(value)) return [];
  const items: ParsedAction[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const action = String(entry.action ?? "").trim();
    if (!action) continue;
    const rawRequirements = deepClone(isRecord(entry.requirements) ? entry.requirements : {});
    const rawConditions = deepClone(isRecord(entry.conditions) ? entry.conditions : {});
    const merged = mergeActionFieldsForUi(action, rawRequirements, rawConditions);
    items.push({
      action,
      requirements: pickRequirementsForAction(action, merged),
      visible: deriveVisibleFieldsFromRequirements(action, merged),
    });
  }
  return items;
}

export function createEmptyAction(actionType: string = DEFAULT_ACTION_TYPE): TaskAction {
  return { action: actionType, requirements: {}, conditions: {} };
}

/** API-действие → плоские UI-поля (условия и атрибуты вместе). */
export function toEditorFields(action: TaskAction): ActionFields {
  const merged = mergeActionFieldsForUi(action.action, action.requirements, action.conditions);
  return pickRequirementsForAction(action.action, merged);
}

/** Плоские UI-поля → API-действие (как legacy `toPublicActionItem`). */
export function toApiAction(actionType: string, fields: ActionFields): TaskAction {
  const split = splitActionFieldsForApi(actionType, cleanRequirements(fields));
  return {
    action: actionType,
    requirements: coerceActionRequirements(actionType, split.requirements),
    conditions: coerceActionConditions(actionType, cleanRequirements(split.conditions)),
  };
}

/** Произвольный вход (ответ API, черновик) → нормализованные API-действия. */
export function normalizeActions(value: unknown): TaskAction[] {
  return parseActionsArray(value).map((item) => toApiAction(item.action, item.requirements));
}

/** Смена типа действия: сохраняем только поля, разрешённые для нового типа. */
export function retargetFields(fields: ActionFields, nextType: string): ActionFields {
  const allowed = new Set(
    [...getConditionFieldsForAction(nextType), ...getAttributeFieldsForAction(nextType)].map(
      (f) => f.key,
    ),
  );
  const next: ActionFields = {};
  for (const [key, val] of Object.entries(fields)) {
    if (allowed.has(key)) next[key] = val;
  }
  return pickRequirementsForAction(nextType, next);
}

/** Удаляет поле вместе с зависимыми ключами money_range (min_points / min_bet_amount). */
export function deleteFieldKey(
  fields: ActionFields,
  key: string,
  actionType: string,
): ActionFields {
  const next = { ...fields };
  delete next[key];
  if (key === "money_range") {
    if (actionType === "deposit" || actionType === "cashout") {
      delete next.min_points;
      delete next.max_points;
    }
    if (actionType === "bet") delete next.min_bet_amount;
  }
  return next;
}

/** Значения виджета money_range: сам объект или его legacy-дубли в плоских полях. */
export function moneyRangeInputs(
  actionType: string,
  fields: ActionFields,
): { min: string; max: string } {
  const current = fields.money_range;
  const str = (v: unknown) => (v == null ? "" : String(v));
  if (isRecord(current)) return { min: str(current.min), max: str(current.max) };
  if (actionType === "deposit" || actionType === "cashout") {
    return { min: str(fields.min_points), max: str(fields.max_points) };
  }
  if (actionType === "bet" && fields.min_bet_amount != null) {
    return { min: str(fields.min_bet_amount), max: "" };
  }
  return { min: "", max: "" };
}

/** Запись money_range: как legacy, дублирует min/max в min_points / max_points / min_bet_amount. */
export function setMoneyRange(
  fields: ActionFields,
  actionType: string,
  range: { min: string; max: string },
): ActionFields {
  const min = range.min.trim();
  const max = range.max.trim();
  const next = deleteFieldKey(fields, "money_range", actionType);
  if (min || max) {
    const obj: Record<string, string> = {};
    if (min) obj.min = min;
    if (max) obj.max = max;
    next.money_range = obj;
  }
  if (actionType === "deposit" || actionType === "cashout") {
    if (min) next.min_points = min;
    if (max) next.max_points = max;
  }
  if (actionType === "bet" && min) next.min_bet_amount = min;
  return next;
}

/** Запись duration `{ value, period }`; пустые части опускаются, пустой объект — удаление. */
export function setDuration(
  fields: ActionFields,
  part: { value: string; period: string },
): ActionFields {
  const value = part.value.trim();
  const period = part.period.trim();
  const next = { ...fields };
  if (!value && !period) {
    delete next.duration;
    return next;
  }
  const obj: Record<string, string> = {};
  if (value) obj.value = value;
  if (period) obj.period = period;
  next.duration = obj;
  return next;
}

/**
 * Видимые поля роли: по значениям (как при загрузке) плюс добавленные пользователем,
 * в порядке схемы для первых и в порядке добавления для вторых.
 */
export function visibleFieldKeys(
  actionType: string,
  fields: ActionFields,
  role: FieldRole,
  extra: readonly string[],
): string[] {
  const derived = deriveVisibleFieldsFromRequirements(actionType, fields);
  const base = role === "condition" ? derived.conditions : derived.attributes;
  const added = filterFieldKeysForAction(
    actionType,
    extra.filter((key) => !base.includes(key)),
    role,
  );
  return [...base, ...added];
}

/** Текст multi_text → массив: JSON-массив или список через запятую. Бросает на битом JSON. */
export function parseMultiText(raw: string): unknown[] | undefined {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("[")) {
    const parsed: unknown = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) throw new Error("Ожидается JSON-массив");
    return parsed;
  }
  return trimmed
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function formatMultiText(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) {
    if (!value.length) return "";
    return value.every((item) => typeof item === "string" || typeof item === "number")
      ? value.join(", ")
      : formatJsonStrict(value);
  }
  return String(value);
}

/** Значение multi_select → массив строковых id (объекты `{ id | value | name }` разворачиваются). */
export function normalizeMultiSelectValue(current: unknown): string[] {
  if (current == null || current === "") return [];
  const items: unknown[] = Array.isArray(current) ? current : [current];
  return items
    .map((item) =>
      isRecord(item) ? String(item.id ?? item.value ?? item.name ?? "") : String(item),
    )
    .filter(Boolean);
}

export function isRemoteOptionsField(def: RequirementFieldDef): boolean {
  return !!def.remoteOptions || def.optionsKey === "games" || def.key === "games";
}

export interface SelectOption {
  value: string;
  label: string;
}

/** Опции поля: внешние (из conditions schema) приоритетнее встроенных в FIELD_DEFS. */
export function resolveFieldOptions(
  def: RequirementFieldDef,
  fieldOptions: Record<string, FieldOption[]>,
): SelectOption[] {
  const external = fieldOptions[def.optionsKey ?? def.key];
  if (external?.length) {
    return external.map((item) => ({
      value: String(item.id),
      label: String(item.label ?? item.id),
    }));
  }
  if (def.options?.length) {
    return def.options.map((item) => ({ value: String(item.id), label: String(item.label) }));
  }
  return [];
}
