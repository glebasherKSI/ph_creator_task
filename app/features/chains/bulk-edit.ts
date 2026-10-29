/**
 * Массовая правка задач (чистая логика): список операций → новая задача + «было → стало».
 * Целевые действия не трогаются — они у каждой задачи свои. Связи (gamification_tasks)
 * тоже: они живут в рёбрах канвы. У цепочек (type: sequence) поля таргетинга, событий
 * и дат всегда пустые — такие операции к ним не применяются.
 */
import {
  type CountrySelectorValue,
  ALL_COUNTRIES,
  countrySelectorValueToTaskFields,
} from "@/features/task-form/country-selector";
import { SECTION_TITLES, type SectionId } from "@/features/task-form/task-form";
import { formatCardDateTime } from "@/lib/format";
import {
  categoryLabel,
  conditionLabel,
  eventLabel,
  notificationEventLabel,
  priorityLabel,
} from "@/lib/labels-ru";
import { cloneJson, isSequenceType, sanitizeTag } from "@/lib/tasks";
import type { Condition, TaskLike } from "@/lib/types";

export type ListMode = "set" | "add" | "remove";
export type DuplicatesMode = "replace" | "append";

export type BulkOp =
  | { field: "hidden"; value: boolean }
  | { field: "player_consent_required"; value: boolean }
  | { field: "category"; value: string | null }
  | { field: "priority"; value: number }
  | { field: "tag"; tag: { id: number | string; name: string } | null }
  | { field: "events"; mode: ListMode; values: string[] }
  | { field: "countries"; mode: ListMode; value: CountrySelectorValue }
  | {
      field: "conditions_upsert";
      conditions: Condition[];
      onlyExisting: boolean;
      /**
       * Повторяемые условия (группы и т. п.): replace — записи условия у задачи заменяются набором
       * из операции целиком, append (по умолчанию) — недостающие записи добавляются к имеющимся.
       */
      duplicates?: DuplicatesMode;
    }
  | { field: "conditions_remove"; names: string[] }
  | { field: "schedule"; cron: string | null }
  | { field: "available_from"; value: string | null }
  | { field: "available_till"; value: string | null }
  | { field: "shift_dates"; minutes: number }
  | { field: "max_repetitions"; value: number | null }
  | { field: "duration"; minutes: number | null }
  | { field: "main_bonus_group_id"; value: string | null }
  | { field: "secondary_bonus_group_id"; value: string | null }
  | { field: "notification_events"; mode: ListMode; values: string[] };

export type BulkFieldId = BulkOp["field"];

export interface BulkFieldDef {
  id: BulkFieldId;
  section: SectionId;
  label: string;
  /** Поле есть у цепочек (type: sequence). */
  sequence: boolean;
}

export const BULK_FIELDS: ReadonlyArray<BulkFieldDef> = [
  { id: "hidden", section: "basic", label: "Скрытая", sequence: true },
  { id: "player_consent_required", section: "basic", label: "Согласие игрока", sequence: true },
  { id: "countries", section: "basic", label: "Страны", sequence: false },
  { id: "category", section: "classification", label: "Кампания", sequence: false },
  { id: "priority", section: "classification", label: "Приоритет", sequence: true },
  { id: "tag", section: "classification", label: "Тег", sequence: true },
  { id: "events", section: "startup", label: "События запуска", sequence: false },
  {
    id: "conditions_upsert",
    section: "targeting",
    label: "Условия — добавить / изменить",
    sequence: false,
  },
  { id: "conditions_remove", section: "targeting", label: "Условия — удалить", sequence: false },
  { id: "schedule", section: "availability", label: "Расписание (cron)", sequence: false },
  { id: "available_from", section: "availability", label: "Доступно с", sequence: false },
  { id: "available_till", section: "availability", label: "Доступно до", sequence: false },
  { id: "shift_dates", section: "availability", label: "Сдвинуть даты", sequence: false },
  {
    id: "max_repetitions",
    section: "availability",
    label: "Сколько раз может быть получено",
    sequence: false,
  },
  { id: "duration", section: "availability", label: "Время жизни", sequence: true },
  {
    id: "main_bonus_group_id",
    section: "rewards",
    label: "Основная группа бонусов",
    sequence: true,
  },
  {
    id: "secondary_bonus_group_id",
    section: "rewards",
    label: "Доп. группа бонусов",
    sequence: true,
  },
  { id: "notification_events", section: "notifications", label: "Уведомления", sequence: true },
];

const FIELD_BY_ID = new Map(BULK_FIELDS.map((def) => [def.id, def]));

export function bulkFieldDef(id: BulkFieldId): BulkFieldDef {
  return FIELD_BY_ID.get(id)!;
}

export function bulkFieldTitle(id: BulkFieldId): string {
  const def = bulkFieldDef(id);
  return `${SECTION_TITLES[def.section]} · ${def.label}`;
}

/** Операция по умолчанию при выборе поля. */
export function defaultBulkOp(field: BulkFieldId): BulkOp {
  switch (field) {
    case "hidden":
    case "player_consent_required":
      return { field, value: false };
    case "category":
    case "available_from":
    case "available_till":
    case "max_repetitions":
    case "main_bonus_group_id":
    case "secondary_bonus_group_id":
      return { field, value: null };
    case "priority":
      return { field, value: 2 };
    case "tag":
      return { field, tag: null };
    case "events":
    case "notification_events":
      return { field, mode: "add", values: [] };
    case "countries":
      return {
        field,
        mode: "set",
        value: { matchingType: "countries", countries: [], countriesLists: [] },
      };
    case "conditions_upsert":
      return { field, conditions: [], onlyExisting: false };
    case "conditions_remove":
      return { field, names: [] };
    case "schedule":
      return { field, cron: null };
    case "shift_dates":
      return { field, minutes: 0 };
    case "duration":
      return { field, minutes: null };
  }
}

/** Операция заполнена настолько, что её можно применять. */
export function isBulkOpReady(op: BulkOp): boolean {
  switch (op.field) {
    case "tag":
      return op.tag != null;
    case "events":
    case "notification_events":
      return op.mode === "set" || op.values.length > 0;
    case "countries": {
      if (op.mode === "set") return true;
      const list =
        op.value.matchingType === "countries_lists" ? op.value.countriesLists : op.value.countries;
      return list.length > 0;
    }
    case "conditions_upsert":
      return withoutLinks(op.conditions).length > 0;
    case "conditions_remove":
      return op.names.length > 0;
    case "schedule":
      return Boolean(op.cron);
    case "shift_dates":
      return Number.isFinite(op.minutes) && op.minutes !== 0;
    default:
      return true;
  }
}

// ---------------------------------------------------------------------------
// Отображение значений
// ---------------------------------------------------------------------------

/** Поля задачи, которые видны в «было → стало» и в сводке. */
export const DISPLAY_KEYS = [
  "hidden",
  "player_consent_required",
  "countries",
  "category",
  "priority",
  "tag",
  "events",
  "cron",
  "available_from",
  "available_till",
  "max_repetitions",
  "duration",
  "main_bonus_group_id",
  "secondary_bonus_group_id",
  "notification_events",
] as const;

export type DisplayKey = (typeof DISPLAY_KEYS)[number];

export const DISPLAY_LABELS: Record<DisplayKey, string> = {
  hidden: "Скрытая",
  player_consent_required: "Согласие игрока",
  countries: "Страны",
  category: "Кампания",
  priority: "Приоритет",
  tag: "Тег",
  events: "События запуска",
  cron: "Расписание",
  available_from: "Доступно с",
  available_till: "Доступно до",
  max_repetitions: "Сколько раз",
  duration: "Время жизни",
  main_bonus_group_id: "Осн. бонусы",
  secondary_bonus_group_id: "Доп. бонусы",
  notification_events: "Уведомления",
};

/** Какие поля показывать в сводке текущих значений для операции. */
export const OP_DISPLAY_KEYS: Record<BulkFieldId, ReadonlyArray<DisplayKey>> = {
  hidden: ["hidden"],
  player_consent_required: ["player_consent_required"],
  countries: ["countries"],
  category: ["category"],
  priority: ["priority"],
  tag: ["tag"],
  events: ["events"],
  conditions_upsert: [],
  conditions_remove: [],
  schedule: ["cron"],
  available_from: ["available_from"],
  available_till: ["available_till"],
  shift_dates: ["available_from", "available_till"],
  max_repetitions: ["max_repetitions"],
  duration: ["duration"],
  main_bonus_group_id: ["main_bonus_group_id"],
  secondary_bonus_group_id: ["secondary_bonus_group_id"],
  notification_events: ["notification_events"],
};

export interface BulkContext {
  /** Подпись группы бонусов по id (из meta); нет — показывается id. */
  bonusTitle?: (id: string) => string | undefined;
  /** Условия, которые можно добавлять несколько раз (схема условий). */
  duplicable?: ReadonlySet<string> | null;
}

const EMPTY = "—";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function listText(values: string[], label: (key: string) => string = String): string {
  return values.length ? values.map(label).join(", ") : EMPTY;
}

export function describeField(task: TaskLike, key: DisplayKey, ctx: BulkContext = {}): string {
  switch (key) {
    case "hidden":
    case "player_consent_required":
      return task[key] === true ? "Да" : "Нет";
    case "countries": {
      if (task.countries_matching_type === "countries_lists") {
        const lists = stringList(task.countries_lists);
        return lists.length ? `Уровни: ${lists.join(", ")}` : EMPTY;
      }
      const codes = stringList(task.countries);
      return codes.includes(ALL_COUNTRIES) ? "Все страны" : listText(codes);
    }
    case "category":
      return task.category ? categoryLabel(String(task.category)) : EMPTY;
    case "priority":
      return task.priority == null ? EMPTY : priorityLabel(task.priority as number);
    case "tag": {
      const tag = isRecord(task.tag) ? task.tag : null;
      if (tag?.name) return String(tag.name);
      const id = tag?.id ?? task.tag_id;
      return id == null ? EMPTY : `#${String(id)}`;
    }
    case "events":
      return listText(stringList(task.events), eventLabel);
    case "notification_events":
      return listText(stringList(task.notification_events), notificationEventLabel);
    case "cron":
      return task.cron ? String(task.cron) : EMPTY;
    case "available_from":
    case "available_till":
      return formatCardDateTime(task[key] as string | null) ?? EMPTY;
    case "max_repetitions":
      return task.max_repetitions == null ? "без ограничений" : String(task.max_repetitions);
    case "duration":
      return task.infinite === true || task.duration == null
        ? "бессрочно"
        : `${String(task.duration)} мин`;
    case "main_bonus_group_id":
    case "secondary_bonus_group_id": {
      const id = task[key] == null ? "" : String(task[key]);
      return id ? (ctx.bonusTitle?.(id) ?? id) : EMPTY;
    }
  }
}

/** JSON с отсортированными ключами — чтобы сравнивать значения условий. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

const CONDITION_TEXT_LIMIT = 120;

export function describeConditionValue(value: unknown): string {
  if (value === undefined) return EMPTY;
  const text =
    typeof value === "boolean"
      ? value
        ? "да"
        : "нет"
      : (listConditionText(value) ?? stableJson(value));
  return text.length > CONDITION_TEXT_LIMIT ? `${text.slice(0, CONDITION_TEXT_LIMIT - 1)}…` : text;
}

/** Условие со списком (группы, теги, связи): «Включая: a, b · все». null — другая форма. */
export function listConditionText(value: unknown): string | null {
  if (!isRecord(value) || !Array.isArray(value.list)) return null;
  const head = value.type === "disabled" ? "Исключая" : "Включая";
  const items = value.list.map(String);
  const parts = [`${head}: ${items.length ? items.join(", ") : "—"}`];
  if (items.length > 1) parts.push(value.extra_type === "and" ? "все" : "любое");
  if (value.only_completed === true) parts.push("только выполненные");
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Условия таргетинга
// ---------------------------------------------------------------------------

export const LINKS_CONDITION = "gamification_tasks";

function conditionName(entry: Condition): string | null {
  const keys = Object.keys(entry ?? {});
  return keys.length ? keys[0]! : null;
}

/** Условия без блока связей — его меняют рёбра на канве. */
export function withoutLinks(conditions: ReadonlyArray<Condition>): Condition[] {
  return conditions.filter((entry) => {
    const name = conditionName(entry);
    return name != null && name !== LINKS_CONDITION;
  });
}

export function conditionList(task: TaskLike): Condition[] {
  return Array.isArray(task.conditions) ? (task.conditions as Condition[]).filter(isRecord) : [];
}

/** Значения условий задачи по имени (в порядке появления). */
export function conditionValues(conditions: Condition[]): Map<string, unknown[]> {
  const out = new Map<string, unknown[]>();
  for (const entry of conditions) {
    const name = conditionName(entry);
    if (!name) continue;
    out.set(name, [...(out.get(name) ?? []), entry[name]]);
  }
  return out;
}

function upsertConditions(
  conditions: Condition[],
  additions: Condition[],
  onlyExisting: boolean,
  duplicable: ReadonlySet<string> | null | undefined,
  notes: string[],
  duplicates: DuplicatesMode = "append",
): Condition[] {
  let next = conditions.map((entry) => ({ ...entry }));
  const list = withoutLinks(additions);
  const replacedSets = new Set<string>();
  for (const addition of list) {
    const name = conditionName(addition)!;
    const value = cloneJson(addition[name]);
    const existing = next.filter((entry) => conditionName(entry) === name);
    const label = conditionLabel(name);

    if (duplicable?.has(name) && duplicates === "replace") {
      // Набор целиком: все записи условия из операции встают на место первой имеющейся.
      if (replacedSets.has(name)) continue;
      replacedSets.add(name);
      const entries = list
        .filter((entry) => conditionName(entry) === name)
        .map((entry) => ({ [name]: cloneJson(entry[name]) }));
      if (!existing.length) {
        if (onlyExisting) notes.push(`нет условия «${label}» — не добавлено`);
        else next.push(...entries);
        continue;
      }
      let placed = false;
      next = next.flatMap((entry) => {
        if (conditionName(entry) !== name) return [entry];
        if (placed) return [];
        placed = true;
        return entries;
      });
      continue;
    }

    if (!existing.length) {
      if (onlyExisting) notes.push(`нет условия «${label}» — не добавлено`);
      else next.push({ [name]: value });
      continue;
    }
    if (duplicable?.has(name)) {
      // Повторяемое условие: новое значение — ещё одна запись, если такой ещё нет.
      if (existing.some((entry) => stableJson(entry[name]) === stableJson(value))) continue;
      if (onlyExisting) notes.push(`«${label}» повторяемое — добавлена ещё одна запись`);
      next.push({ [name]: value });
      continue;
    }
    let replaced = false;
    next = next.flatMap((entry) => {
      if (conditionName(entry) !== name) return [entry];
      if (replaced) return [];
      replaced = true;
      return [{ [name]: value }];
    });
  }
  return next;
}

export interface ConditionSummary {
  name: string;
  label: string;
  /** Во скольких задачах есть условие. */
  count: number;
  /** Разных наборов записей среди этих задач (у повторяемого условия записей может быть несколько). */
  variants: number;
  /** Самый частый набор записей — им заполняется редактор при «взять за основу». */
  common: unknown[];
}

/** Какие условия есть у задач выделения (без связей), по убыванию частоты. */
export function summarizeConditions(tasks: ReadonlyArray<TaskLike>): ConditionSummary[] {
  const byName = new Map<
    string,
    { count: number; sets: Map<string, { values: unknown[]; n: number }> }
  >();
  for (const task of tasks) {
    for (const [name, values] of conditionValues(withoutLinks(conditionList(task)))) {
      const entry = byName.get(name) ?? { count: 0, sets: new Map() };
      entry.count += 1;
      // Порядок записей не важен: [A, B] и [B, A] — один набор.
      const key = JSON.stringify(values.map(stableJson).sort());
      const seen = entry.sets.get(key);
      entry.sets.set(key, { values: seen?.values ?? values, n: (seen?.n ?? 0) + 1 });
      byName.set(name, entry);
    }
  }
  return [...byName]
    .map(([name, { count, sets }]) => {
      const common = [...sets.values()].sort((a, b) => b.n - a.n)[0]?.values ?? [];
      return { name, label: conditionLabel(name), count, variants: sets.size, common };
    })
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ru"));
}

// ---------------------------------------------------------------------------
// Сводка текущих значений
// ---------------------------------------------------------------------------

export interface ValueCount {
  text: string;
  count: number;
  /** Первая задача с этим значением — из неё берётся значение по клику на чип. */
  sample: TaskLike;
}

export function summarizeField(
  tasks: ReadonlyArray<TaskLike>,
  key: DisplayKey,
  ctx: BulkContext = {},
): ValueCount[] {
  const counts = new Map<string, ValueCount>();
  for (const task of tasks) {
    const text = describeField(task, key, ctx);
    const seen = counts.get(text);
    counts.set(text, { text, count: (seen?.count ?? 0) + 1, sample: seen?.sample ?? task });
  }
  return [...counts.values()].sort(
    (a, b) => b.count - a.count || a.text.localeCompare(b.text, "ru"),
  );
}

/**
 * Значения поля у задач расходятся — подсказка «здесь, возможно, ошибка».
 * Для таргетинга: какое-то условие есть не у всех или у всех разное.
 */
export function bulkFieldDiffers(
  tasks: ReadonlyArray<TaskLike>,
  field: BulkFieldId,
  ctx: BulkContext = {},
): boolean {
  if (tasks.length < 2) return false;
  if (field === "conditions_upsert" || field === "conditions_remove") {
    return summarizeConditions(tasks).some((c) => c.variants > 1 || c.count < tasks.length);
  }
  return OP_DISPLAY_KEYS[field].some((key) => summarizeField(tasks, key, ctx).length > 1);
}

/** Операция «сделать у всех как у этой задачи»; null — для поля так нельзя. */
export function bulkOpFromTask(field: BulkFieldId, task: TaskLike): BulkOp | null {
  switch (field) {
    case "hidden":
    case "player_consent_required":
      return { field, value: task[field] === true };
    case "category":
    case "available_from":
    case "available_till":
    case "main_bonus_group_id":
    case "secondary_bonus_group_id":
      return { field, value: task[field] == null ? null : String(task[field]) };
    case "priority":
      return { field, value: Number(task.priority ?? 0) };
    case "max_repetitions":
      return { field, value: task.max_repetitions == null ? null : Number(task.max_repetitions) };
    case "duration":
      return {
        field,
        minutes: task.infinite === true || task.duration == null ? null : Number(task.duration),
      };
    case "tag": {
      const tag = isRecord(task.tag) ? task.tag : null;
      const id = (tag?.id ?? task.tag_id) as number | string | null | undefined;
      return id == null ? null : { field, tag: { id, name: String(tag?.name ?? "") } };
    }
    case "events":
    case "notification_events":
      return { field, mode: "set", values: stringList(task[field]) };
    case "countries":
      return {
        field,
        mode: "set",
        value: {
          matchingType: String(task.countries_matching_type || "countries"),
          countries: stringList(task.countries),
          countriesLists: stringList(task.countries_lists),
        },
      };
    case "schedule":
      return task.cron ? { field, cron: String(task.cron) } : null;
    default:
      return null;
  }
}

export interface ChangeGroup extends FieldChange {
  /** У скольких задач такое же «было → стало». */
  count: number;
}

/** Одинаковые «было → стало» по всем задачам — итог над предпросмотром. */
export function groupChanges(lists: ReadonlyArray<ReadonlyArray<FieldChange>>): ChangeGroup[] {
  const groups = new Map<string, ChangeGroup>();
  for (const changes of lists) {
    for (const change of changes) {
      const key = `${change.label}\u0000${change.before}\u0000${change.after}`;
      const seen = groups.get(key);
      groups.set(key, { ...change, count: (seen?.count ?? 0) + 1 });
    }
  }
  return [...groups.values()].sort(
    (a, b) => a.label.localeCompare(b.label, "ru") || b.count - a.count,
  );
}

// ---------------------------------------------------------------------------
// Применение
// ---------------------------------------------------------------------------

export interface FieldChange {
  label: string;
  before: string;
  after: string;
}

export interface BulkResult {
  task: TaskLike;
  changes: FieldChange[];
  /** Операции, которые к задаче не применились, — почему. */
  notes: string[];
  /** Задачу в таком виде сохранять нельзя. */
  errors: string[];
}

function applyList(current: string[], mode: ListMode, values: string[]): string[] {
  if (mode === "set") return [...values];
  if (mode === "add") return [...current, ...values.filter((v) => !current.includes(v))];
  return current.filter((v) => !values.includes(v));
}

function shiftIso(iso: unknown, minutes: number): unknown {
  if (typeof iso !== "string" || !iso) return iso;
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return iso;
  return new Date(time + minutes * 60_000).toISOString();
}

function applyCountries(
  task: TaskLike,
  op: Extract<BulkOp, { field: "countries" }>,
  notes: string[],
): TaskLike {
  if (op.mode === "set") return { ...task, ...countrySelectorValueToTaskFields(op.value) };
  const byLists = op.value.matchingType === "countries_lists";
  const taskByLists = task.countries_matching_type === "countries_lists";
  if (byLists !== taskByLists) {
    notes.push(
      byLists
        ? "страны заданы списком стран, а не уровнями — не изменено"
        : "страны заданы уровнями — не изменено",
    );
    return task;
  }
  const key = byLists ? "countries_lists" : "countries";
  const current = stringList(task[key]);
  if (!byLists && current.includes(ALL_COUNTRIES)) {
    notes.push("у задачи «Все страны» — не изменено");
    return task;
  }
  const values = byLists ? op.value.countriesLists : op.value.countries;
  return { ...task, [key]: applyList(current, op.mode, values) };
}

function applyOne(task: TaskLike, op: BulkOp, ctx: BulkContext, notes: string[]): TaskLike {
  const def = bulkFieldDef(op.field);
  if (!def.sequence && isSequenceType(task.type)) {
    notes.push(`«${def.label}»: у цепочки этого поля нет`);
    return task;
  }
  switch (op.field) {
    case "hidden":
    case "player_consent_required":
    case "category":
    case "priority":
    case "available_from":
    case "available_till":
    case "max_repetitions":
    case "main_bonus_group_id":
    case "secondary_bonus_group_id":
      return { ...task, [op.field]: op.value };
    case "tag": {
      if (!op.tag) return task;
      const previous = isRecord(task.tag) && task.tag.id === op.tag.id ? task.tag : op.tag;
      return { ...task, tag_id: op.tag.id, tag: sanitizeTag({ ...previous, ...op.tag }) };
    }
    case "events": {
      const events = applyList(stringList(task.events), op.mode, op.values);
      const scheduler = events.includes("scheduler");
      // Как форма: расписание живёт только вместе с событием scheduler.
      if (scheduler && !task.cron) notes.push("добавлен scheduler — задайте расписание");
      return {
        ...task,
        events,
        repeatable: scheduler,
        cron: scheduler ? (task.cron ?? null) : null,
      };
    }
    case "notification_events":
      return {
        ...task,
        notification_events: applyList(stringList(task.notification_events), op.mode, op.values),
      };
    case "countries":
      return applyCountries(task, op, notes);
    case "conditions_upsert":
      return {
        ...task,
        conditions: upsertConditions(
          conditionList(task),
          op.conditions,
          op.onlyExisting,
          ctx.duplicable,
          notes,
          op.duplicates,
        ),
      };
    case "conditions_remove": {
      const names = new Set(op.names.filter((name) => name !== LINKS_CONDITION));
      return {
        ...task,
        conditions: conditionList(task).filter((entry) => !names.has(conditionName(entry) ?? "")),
      };
    }
    case "schedule":
      if (!stringList(task.events).includes("scheduler")) {
        notes.push("нет события scheduler — расписание не задано");
        return task;
      }
      return { ...task, cron: op.cron, repeatable: true };
    case "shift_dates":
      return {
        ...task,
        available_from: shiftIso(task.available_from, op.minutes),
        available_till: shiftIso(task.available_till, op.minutes),
      };
    case "duration":
      return op.minutes == null
        ? { ...task, infinite: true, duration: null }
        : { ...task, infinite: false, duration: op.minutes };
  }
}

function conditionChanges(before: TaskLike, after: TaskLike): FieldChange[] {
  const was = conditionValues(withoutLinks(conditionList(before)));
  const now = conditionValues(withoutLinks(conditionList(after)));
  const changes: FieldChange[] = [];
  for (const name of new Set([...was.keys(), ...now.keys()])) {
    const a = was.get(name) ?? [];
    const b = now.get(name) ?? [];
    if (stableJson(a) === stableJson(b)) continue;
    const text = (values: unknown[]) =>
      values.length ? values.map(describeConditionValue).join(" | ") : "нет";
    changes.push({ label: `Таргетинг: ${conditionLabel(name)}`, before: text(a), after: text(b) });
  }
  return changes;
}

function dateErrors(task: TaskLike): string[] {
  const from = typeof task.available_from === "string" ? Date.parse(task.available_from) : NaN;
  const till = typeof task.available_till === "string" ? Date.parse(task.available_till) : NaN;
  return from >= till ? ["«Доступно с» не раньше «Доступно до»"] : [];
}

export function applyBulkOps(
  task: TaskLike,
  ops: ReadonlyArray<BulkOp>,
  ctx: BulkContext = {},
): BulkResult {
  const notes: string[] = [];
  let next: TaskLike = { ...task };
  for (const op of ops) {
    if (isBulkOpReady(op)) next = applyOne(next, op, ctx, notes);
  }
  const changes: FieldChange[] = [];
  for (const key of DISPLAY_KEYS) {
    const before = describeField(task, key, ctx);
    const after = describeField(next, key, ctx);
    if (before !== after) changes.push({ label: DISPLAY_LABELS[key], before, after });
  }
  changes.push(...conditionChanges(task, next));
  return { task: next, changes, notes, errors: changes.length ? dateErrors(next) : [] };
}

/** Поля, которые операции действительно поменяли, — для отката. */
export function changedTaskKeys(before: TaskLike, after: TaskLike): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((key) => stableJson(before[key]) !== stableJson(after[key]));
}

/** Свежая задача с откатом указанных полей к снимку. */
export function restoreFields(
  task: TaskLike,
  snapshot: TaskLike,
  keys: ReadonlyArray<string>,
): TaskLike {
  const next: TaskLike = { ...task };
  for (const key of keys) next[key] = cloneJson(snapshot[key]);
  return next;
}
