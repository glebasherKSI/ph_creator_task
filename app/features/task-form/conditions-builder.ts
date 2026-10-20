/**
 * Чистая логика редактора условий таргетинга (замена conditions-builder.js без DOM).
 * Модель: список `ConditionItem` (id для UI, name, value) ↔ API-массив `[{ <name>: <value> }]`.
 * Нормализация значений виджетов (money_range, duration, теги, …) — тоже здесь; UI в ConditionsBuilder.tsx.
 */
import {
  getAllConditions,
  isConditionDuplicable,
  type ConditionDefinition,
  type OptionRef,
  type ParsedConditionsSchema,
} from "@/lib/conditions-schema";
import { conditionLabel } from "@/lib/labels-ru";
import type { Condition } from "@/lib/types";

/** Типы виджетов, для которых есть UI-редактор; остальные — JSON. */
export const HANDLED_WIDGET_TYPES: ReadonlySet<string> = new Set([
  "boolean_checkboxes",
  "tags_extended",
  "select",
  "gamification_task",
  "groups",
  "payment",
  "bet",
  "boolean",
  "boolean_tags",
  "countries_with_lists",
  "string",
  "number",
]);

export interface ConditionItem {
  id: string;
  name: string;
  value: unknown;
}

/** Опция списка заданий из каталога (принимаем и `{value,label}` ради совместимости). */
export interface TaskOption {
  id?: string | number;
  name?: string;
  value?: string | number;
  label?: string;
}

/** Опция для MultiCombobox. */
export interface ComboOption {
  value: string;
  label: string;
}

export const MONEY_RANGE_TYPES: ReadonlyArray<OptionRef> = [
  { id: "min", name: "Мин" },
  { id: "max", name: "Макс" },
  { id: "range", name: "Диапазон" },
];

export const NUMBER_TYPES: ReadonlyArray<OptionRef> = MONEY_RANGE_TYPES;

export const BOOLEAN_TYPES: ReadonlyArray<OptionRef> = [
  { id: "enabled", name: "Истинно" },
  { id: "disabled", name: "Ложно" },
];

export const INCLUDE_EXCLUDE_TYPES: ReadonlyArray<OptionRef> = [
  { id: "enabled", name: "Включая" },
  { id: "disabled", name: "Исключая" },
];

export const LIST_LOGIC_TYPES: ReadonlyArray<OptionRef> = [
  { id: "and", name: "И" },
  { id: "or", name: "Или" },
];

export const DURATION_PERIODS: ReadonlyArray<OptionRef> = [
  { id: "day", name: "Дней" },
  { id: "week", name: "Недель" },
  { id: "month", name: "Месяц(ев)" },
  { id: "lifetime", name: "За все время" },
  { id: "between", name: "В промежутке" },
];

export const EXISTENCE_TYPES: ReadonlyArray<OptionRef> = [
  { id: "any", name: "Любой" },
  { id: "last", name: "Последний" },
  { id: "first", name: "Первый" },
];

export const PAYMENT_STATUSES: ReadonlyArray<OptionRef> = [
  { id: "any", name: "Любой" },
  { id: "successful", name: "Успешный" },
  { id: "unsuccessful", name: "Неудачный" },
];

/** Максимум условий в списке выбора (как в старом пикере). */
export const PICKER_LIMIT = 80;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

let idSeq = 0;

/** Уникальный id элемента на время жизни модуля (не сбрасывается — id не должны повторяться между рендерами). */
export function createConditionId(): string {
  idSeq += 1;
  return `c${idSeq}`;
}

/** API-массив conditions → элементы редактора; мусор (не объекты) пропускается. */
export function parseConditionsArray(conditions: unknown): ConditionItem[] {
  if (!Array.isArray(conditions)) return [];
  const items: ConditionItem[] = [];
  for (const entry of conditions) {
    if (!isRecord(entry)) continue;
    for (const [name, value] of Object.entries(entry)) {
      items.push({ id: createConditionId(), name, value });
    }
  }
  return items;
}

/** Элементы редактора → API-массив `[{ name: value }]`. */
export function serializeConditions(items: ReadonlyArray<ConditionItem>): Condition[] {
  return items.map((item) => ({ [item.name]: item.value }));
}

/**
 * Пересобирает элементы из нового `value`, сохраняя id прежних элементов:
 * для каждого условия берётся первый ещё не использованный прежний элемент с тем же name.
 */
export function reconcileConditionItems(
  prev: ReadonlyArray<ConditionItem>,
  conditions: unknown,
): ConditionItem[] {
  const parsed = parseConditionsArray(conditions);
  const used = new Set<string>();
  return parsed.map((item) => {
    const match = prev.find((p) => p.name === item.name && !used.has(p.id));
    if (!match) return item;
    used.add(match.id);
    return { id: match.id, name: item.name, value: item.value };
  });
}

export function defaultValueForDef(def: ConditionDefinition | null | undefined): unknown {
  if (!def) return {};
  if (def.value != null) return cloneJson(def.value);
  return {};
}

function cloneJson(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

export function isHandledWidget(def: ConditionDefinition | null | undefined): boolean {
  return HANDLED_WIDGET_TYPES.has(def?.type || "");
}

/** Подпись типа в шапке карточки: `type` или `type (расширенное)`. */
export function widgetTypeHint(def: ConditionDefinition | null | undefined): string {
  const type = def?.type || "неизвестный";
  return isHandledWidget(def) ? type : `${type} (расширенное)`;
}

/** Можно ли добавить условие: ещё нет в списке или оно повторяемое. */
export function canAddCondition(
  items: ReadonlyArray<ConditionItem>,
  name: string,
  duplicable: Set<string> | null | undefined,
): boolean {
  if (!items.some((item) => item.name === name)) return true;
  return isConditionDuplicable(name, duplicable);
}

/** Условия схемы по поисковому запросу (label / name / русская подпись), первые PICKER_LIMIT. */
export function filterPickerConditions(
  schema: ParsedConditionsSchema | null | undefined,
  query: string,
): ConditionDefinition[] {
  const q = query.trim().toLowerCase();
  const all = getAllConditions(schema);
  const filtered = q
    ? all.filter(
        (def) =>
          def.label.toLowerCase().includes(q) ||
          def.name.toLowerCase().includes(q) ||
          conditionLabel(def.name, def).toLowerCase().includes(q),
      )
    : all;
  return filtered.slice(0, PICKER_LIMIT);
}

/** Подпись условия в списке; для повторов — `Label (N)`. */
export function conditionInstanceLabel(
  items: ReadonlyArray<ConditionItem>,
  item: ConditionItem,
  def: ConditionDefinition | null | undefined,
): string {
  const base = conditionLabel(item.name, def);
  const sameName = items.filter((entry) => entry.name === item.name);
  if (sameName.length <= 1) return base;
  const index = sameName.findIndex((entry) => entry.id === item.id) + 1;
  return `${base} (${index})`;
}

/** Текст строки статуса схемы — как в старом билдере. */
export function schemaStatusText(
  schema: ParsedConditionsSchema | null,
  duplicable: Set<string> | null,
  loading: boolean,
  error: string | null | undefined,
): string {
  if (loading) return "Загрузка схемы условий…";
  if (error) return `Схема не загружена: ${error}`;
  if (!schema) return "Схема не загружена";
  return `Схема: ${schema.conditions.length} условий, ${schema.widgetTypes.size} типов виджетов, ${duplicable?.size ?? 0} повторяемых (${schema.source})`;
}

/* ---------- значения виджетов ---------- */

/** Список collection ({id,name}) → опции combobox ({value,label}). */
export function toComboOptions(collection: unknown): ComboOption[] {
  if (!Array.isArray(collection)) return [];
  return collection
    .filter((item): item is Record<string, unknown> => isRecord(item) && item.id != null)
    .map((item) => ({ value: String(item.id), label: String(item.name ?? item.id) }));
}

/** Список опций из `def.extra[key]` (availablePeriods, availableGameCategories, …). */
export function extraOptionList(
  def: ConditionDefinition | null | undefined,
  key: string,
): OptionRef[] | undefined {
  const raw = def?.extra?.[key];
  if (!Array.isArray(raw)) return undefined;
  return raw
    .filter((item): item is Record<string, unknown> => isRecord(item) && item.id != null)
    .map((item) => ({ id: String(item.id), name: String(item.name ?? item.id) }));
}

/** `select` с множественным выбором: флаг `multiple` схемы лежит в `extra`. */
export function isMultipleSelect(def: ConditionDefinition | null | undefined): boolean {
  return Boolean(def?.extra?.multiple);
}

/** Значение `select multiple` → массив строк (одиночное значение оборачивается). */
export function selectMultiValue(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [value].filter(Boolean);
  return list.map(String);
}

export function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

/** `"1, 2;3 4"` → `["1","2","3","4"]`. */
export function parseTagsInput(raw: unknown): string[] {
  return String(raw || "")
    .split(/[,;\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function formatTagsInput(list: unknown): string {
  return Array.isArray(list) ? list.join(", ") : "";
}

/** Значение `<input type="number">` → число или null (пусто / не число). */
export function numberInputValue(raw: string): number | null {
  if (raw === "") return null;
  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
}

/** Иммутабельный аналог старого `setNested`: `setNested(v, "money_range.type", "max")`. */
export function setNested(target: unknown, path: string, value: unknown): Record<string, unknown> {
  const parts = path.split(".");
  const key = parts[0] ?? "";
  const base = asRecord(target);
  if (parts.length <= 1) return { ...base, [key]: value };
  return { ...base, [key]: setNested(base[key], parts.slice(1).join("."), value) };
}

/** Поверхностный патч объекта-значения; не-объект заменяется на объект с патчем. */
export function patchValue(
  value: unknown,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  return { ...asRecord(value), ...patch };
}

export interface MoneyRangeView {
  type: string;
  min: string;
  max: string;
  excludeEnd: boolean;
}

/** Что показывать в полях money_range: min/max из list (range) или list[0] / min / max. */
export function moneyRangeView(value: unknown): MoneyRangeView {
  const v = asRecord(value);
  const type = v.type == null ? "min" : String(v.type);
  const list = Array.isArray(v.list) ? v.list : [];
  const min = type === "range" ? (list[0] ?? "") : (list[0] ?? v.min ?? "");
  const max = type === "range" ? (list[1] ?? "") : (v.max ?? "");
  return { type, min: String(min), max: String(max), excludeEnd: Boolean(v.exclude_end) };
}

/**
 * Патч поля money_range условия (как ввод в старом виджете): для `range` число пишется
 * в `list[0]`/`list[1]`, иначе `list = [String(val)]`; остальные поля — как есть.
 */
export function patchMoneyRange(
  value: unknown,
  field: "min" | "max" | "exclude_end" | "type",
  val: unknown,
): Record<string, unknown> {
  const current = asRecord(value);
  const money: Record<string, unknown> = { ...asRecord(current.money_range) };
  if (field === "min" || field === "max") {
    const type = money.type ?? "min";
    if (type === "range") {
      const list: unknown[] = Array.isArray(money.list) ? [...money.list] : [null, null];
      list[field === "min" ? 0 : 1] = val;
      money.list = list;
    } else {
      money.list = val == null ? [] : [String(val)];
    }
  } else {
    money[field] = val;
  }
  return { ...current, money_range: money };
}

/** Патч поля duration условия (`number`, `period`, `include_current_period`, …). */
export function patchDuration(
  value: unknown,
  field: string,
  val: unknown,
): Record<string, unknown> {
  const current = asRecord(value);
  return { ...current, duration: { ...asRecord(current.duration), [field]: val } };
}

export type JsonDraftResult = { ok: true; value: unknown } | { ok: false; error: string };

/** Разбор JSON-черновика; пустая строка → null (как в старом виджете). */
export function parseJsonDraft(text: string): JsonDraftResult {
  try {
    return { ok: true, value: JSON.parse(text || "null") };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/* ---------- gamification_task ---------- */

/** Внешний список заданий → формат collection ({id,name}); принимает {id,name} либо {value,label}. */
export function normalizeTaskOptions(taskOptions: unknown): OptionRef[] {
  if (!Array.isArray(taskOptions)) return [];
  const out: OptionRef[] = [];
  for (const item of taskOptions) {
    if (!isRecord(item)) continue;
    const id = item.id ?? item.value;
    if (id == null) continue;
    out.push({ id: String(id), name: String(item.name ?? item.label ?? id) });
  }
  return out;
}

/**
 * Актуальный список заданий: снимок из схемы (collection), поверх — live-каталог,
 * плюс выбранные id, которых нет ни там, ни там (подпись = id).
 */
export function resolveGamificationTaskOptions(
  def: ConditionDefinition | null | undefined,
  selectedIds: ReadonlyArray<string> | null | undefined,
  taskOptions: ReadonlyArray<TaskOption> | null | undefined,
): OptionRef[] {
  const byId = new Map<string, OptionRef>();
  for (const item of def?.collection || []) {
    byId.set(String(item.id), { id: String(item.id), name: String(item.name ?? item.id) });
  }
  for (const item of normalizeTaskOptions(taskOptions)) {
    byId.set(item.id, item);
  }
  for (const id of selectedIds || []) {
    const key = String(id);
    if (!byId.has(key)) byId.set(key, { id: key, name: key });
  }
  return [...byId.values()];
}

export function hasGamificationTaskOptions(
  def: ConditionDefinition | null | undefined,
  taskOptions: ReadonlyArray<TaskOption> | null | undefined,
): boolean {
  if ((def?.collection?.length || 0) > 0) return true;
  return normalizeTaskOptions(taskOptions).length > 0;
}
