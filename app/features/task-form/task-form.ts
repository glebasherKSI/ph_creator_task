/**
 * Чистая логика формы задачи: задача с бэка ↔ значения формы ↔ payload для API.
 * Порт логики copy-panel.js (fillCopyForm / buildCopyPayload / applyPlannerHint) без DOM.
 */
import { datetimeLocalToIso, isoToDatetimeLocal } from "@/lib/format";
import type { MetaRef } from "@/lib/meta";
import {
  SEQUENCE_FIELD_OVERRIDES,
  type TaskOverrides,
  boolValue,
  buildCreatePayload,
  isSequenceType,
} from "@/lib/tasks";
import type { Condition, TaskAction, TaskLike, TaskPayloadEnvelope } from "@/lib/types";

import { type RepeatScheduleValue, scheduleFromCron, scheduleToCron } from "./repeat-schedule";

export const KNOWN_LOCALE_CODES = ["de", "en", "es", "fr", "it", "pt", "ru"] as const;

export type TaskFormMode = "copy" | "edit";

export interface TaskFormCountries {
  matchingType: string;
  countries: string[];
  countriesLists: string[];
}

export interface TaskFormActions {
  main: TaskAction[];
  secondary: TaskAction[];
  mainSequential: boolean;
  secondarySequential: boolean;
}

/** Значения формы — всё строками/массивами, как в полях ввода. */
export interface TaskFormValues {
  sourceId: string;
  name: string;
  frontendIdentifier: string;
  locales: Record<string, string>;
  hidden: boolean;
  type: string;
  playerConsentRequired: boolean;
  countries: TaskFormCountries;
  /** "" — не выбрано (в payload категория исходной задачи не перезаписывается). */
  category: string;
  priority: string;
  /** id тега строкой или "" — тогда остаётся тег исходной задачи. */
  tag: string;
  events: string[];
  conditions: Condition[];
  schedule: RepeatScheduleValue;
  availableFrom: string;
  availableTill: string;
  maxRepetitions: string;
  duration: string;
  infinite: boolean;
  actions: TaskFormActions;
  mainBonusGroupId: string;
  secondaryBonusGroupId: string;
  notificationEvents: string[];
}

export const SECTION_IDS = [
  "basic",
  "classification",
  "startup",
  "targeting",
  "availability",
  "actions",
  "rewards",
  "notifications",
] as const;

export type SectionId = (typeof SECTION_IDS)[number];

export const SECTION_TITLES: Record<SectionId, string> = {
  basic: "Основное",
  classification: "Классификация",
  startup: "Начало работы",
  targeting: "Таргетинг",
  availability: "Доступность по времени",
  actions: "Целевые действия",
  rewards: "Вознаграждение",
  notifications: "Уведомления",
};

/** Секции, которых нет у цепочек (type: "sequence"). */
export const SEQUENCE_HIDDEN_SECTIONS: ReadonlySet<SectionId> = new Set(["startup", "targeting"]);

export function eventsIncludeScheduler(events: ReadonlyArray<string>): boolean {
  return events.includes("scheduler");
}

export function parseNullableField(raw: unknown): string | number | null {
  const value = String(raw || "").trim();
  if (!value || value.toLowerCase() === "null") return null;
  if (/^-?\d+$/.test(value)) return Number(value);
  return value;
}

export function durationToForm(
  minutes: unknown,
  infinite: boolean,
): { value: string; infinite: boolean } {
  if (infinite || minutes == null) return { value: "", infinite: true };
  const total = Number(minutes);
  if (!Number.isFinite(total) || total < 0) return { value: "", infinite: false };
  return { value: String(total), infinite: false };
}

export function formToDurationMinutes(value: string, infinite: boolean): number | null {
  if (infinite) return null;
  const raw = String(value || "").trim();
  if (!raw) throw new Error("Укажите время жизни или включите «бессрочно»");
  const num = Number(raw);
  if (!Number.isFinite(num) || num < 0) {
    throw new Error("Время жизни должно быть неотрицательным числом минут");
  }
  return Math.round(num);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

export function emptyFormValues(): TaskFormValues {
  return {
    sourceId: "",
    name: "",
    frontendIdentifier: "",
    locales: {},
    hidden: false,
    type: "interactive",
    playerConsentRequired: false,
    countries: { matchingType: "countries", countries: [], countriesLists: [] },
    category: "",
    priority: "0",
    tag: "",
    events: [],
    conditions: [],
    schedule: scheduleFromCron(null),
    availableFrom: "",
    availableTill: "",
    maxRepetitions: "",
    duration: "",
    infinite: true,
    actions: { main: [], secondary: [], mainSequential: false, secondarySequential: false },
    mainBonusGroupId: "",
    secondaryBonusGroupId: "",
    notificationEvents: [],
  };
}

/** Задача с бэка (или черновик) → значения формы. Как fillCopyForm. */
export function taskToFormValues(task: TaskLike, { mode }: { mode: TaskFormMode }): TaskFormValues {
  const isEdit = mode === "edit";
  const keepNameAsIs = isEdit || task._plannerTaskId != null;
  const name = String(task.name ?? "");
  const events = Array.isArray(task.events)
    ? stringArray(task.events)
    : task.event
      ? [String(task.event)]
      : [];

  // Поля на случай, если языки проекта ещё не загружены (см. KNOWN_LOCALE_CODES), плюс
  // любые языки, реально заданные в задаче — даже если их нет в текущем списке проекта
  // (например, задача скопирована из проекта с другим набором языков), чтобы не терять данные.
  const locales: Record<string, string> = {};
  const sourceLocales = isRecord(task.locales) ? task.locales : {};
  const localeCodes = new Set<string>([...KNOWN_LOCALE_CODES, ...Object.keys(sourceLocales)]);
  for (const code of localeCodes) {
    locales[code] = sourceLocales[code] == null ? "" : String(sourceLocales[code]);
  }

  const tagId = (isRecord(task.tag) ? task.tag.id : undefined) ?? task.tag_id ?? null;
  const lifetime = durationToForm(task.duration, boolValue(task.infinite, task.duration == null));

  return {
    sourceId: task.id == null ? "" : String(task.id),
    name: keepNameAsIs ? name : name ? `${name}_copy` : "",
    frontendIdentifier: String(task.frontend_identifier ?? ""),
    locales,
    hidden: boolValue(task.hidden, false),
    type: String(task.type ?? ""),
    playerConsentRequired: boolValue(task.player_consent_required, false),
    countries: {
      matchingType: String(task.countries_matching_type || "countries"),
      countries: stringArray(task.countries),
      countriesLists: stringArray(task.countries_lists),
    },
    category: task.category == null ? "" : String(task.category),
    priority: task.priority == null ? "0" : String(task.priority),
    tag: tagId == null ? "" : String(tagId),
    events,
    conditions: Array.isArray(task.conditions) ? (task.conditions as Condition[]) : [],
    // Расписание заполняется только при событии scheduler — как в старой форме.
    schedule: scheduleFromCron(
      eventsIncludeScheduler(events) ? ((task.cron as string | null | undefined) ?? null) : null,
    ),
    availableFrom: isoToDatetimeLocal(task.available_from as string | null | undefined),
    availableTill: isoToDatetimeLocal(task.available_till as string | null | undefined),
    maxRepetitions: task.max_repetitions == null ? "" : String(task.max_repetitions),
    duration: lifetime.value,
    infinite: lifetime.infinite,
    actions: {
      main: Array.isArray(task.serialized_main_actions)
        ? (task.serialized_main_actions as TaskAction[])
        : [],
      secondary: Array.isArray(task.serialized_secondary_actions)
        ? (task.serialized_secondary_actions as TaskAction[])
        : [],
      mainSequential: boolValue(task.main_actions_sequential, false),
      secondarySequential: boolValue(task.secondary_actions_sequential, false),
    },
    mainBonusGroupId: task.main_bonus_group_id == null ? "" : String(task.main_bonus_group_id),
    secondaryBonusGroupId:
      task.secondary_bonus_group_id == null ? "" : String(task.secondary_bonus_group_id),
    notificationEvents: stringArray(task.notification_events),
  };
}

export interface PayloadContext {
  /** Справочник тегов загружен — значит селекты в режиме meta (пустое = null, как в админке). */
  metaTags: MetaRef[] | null;
}

/** Сырое значение тега для resolveTagFromInput: объект из справочника, иначе id строкой. */
export function tagRawFromForm(tag: string, metaTags: MetaRef[] | null): string {
  if (!metaTags) return "";
  const raw = String(tag || "").trim();
  if (!raw) return "";
  const tagId = Number(raw);
  const found = metaTags.find((item) => Number(item.id) === tagId);
  return found ? JSON.stringify(found) : raw;
}

function nullableSelect(value: string, metaMode: boolean): string | number | null {
  if (metaMode) {
    const raw = String(value ?? "").trim();
    return raw ? raw : null;
  }
  return parseNullableField(value);
}

/** Значения формы → overrides для buildCreatePayload. Как buildCopyPayload. */
export function formValuesToOverrides(
  values: TaskFormValues,
  { metaTags }: PayloadContext,
): TaskOverrides {
  const name = values.name.trim();
  const frontendIdentifier = values.frontendIdentifier.trim();
  if (!name) throw new Error("Поле name обязательно");
  if (!frontendIdentifier) throw new Error("Поле frontend_identifier обязательно");

  const metaMode = metaTags != null;
  const hasScheduler = eventsIncludeScheduler(values.events);
  const type = values.type.trim() || undefined;
  const category = values.category.trim() || undefined;

  // Отправляем все заполненные языки из формы — не только статический список: поля для
  // реальных языков проекта рендерятся динамически (см. TaskForm.tsx), а эта функция не
  // должна зависеть от того, какой именно набор там оказался.
  const locales: Record<string, string> = {};
  for (const [code, raw] of Object.entries(values.locales)) {
    const text = (raw ?? "").trim();
    if (text) locales[code] = text;
  }

  const overrides: TaskOverrides = {
    name,
    locales,
    frontend_identifier: frontendIdentifier,
    hidden: values.hidden,
    type,
    countries_matching_type: values.countries.matchingType || undefined,
    countries: values.countries.countries,
    countries_lists: values.countries.countriesLists,
    player_consent_required: values.playerConsentRequired,
    category,
    priority: Number(values.priority || 0),
    events: values.events,
    repeatable: hasScheduler,
    cron: hasScheduler ? scheduleToCron(values.schedule) : null,
    available_from: datetimeLocalToIso(values.availableFrom),
    available_till: datetimeLocalToIso(values.availableTill),
    max_repetitions: values.maxRepetitions.trim() ? Number(values.maxRepetitions) : null,
    infinite: values.infinite,
    duration: formToDurationMinutes(values.duration, values.infinite),
    main_actions_sequential: values.actions.mainSequential,
    secondary_actions_sequential: values.actions.secondarySequential,
    serialized_main_actions: values.actions.main,
    serialized_secondary_actions: values.actions.secondary,
    conditions: values.conditions,
    main_bonus_group_id: nullableSelect(values.mainBonusGroupId, metaMode),
    secondary_bonus_group_id: nullableSelect(values.secondaryBonusGroupId, metaMode),
    notification_events: values.notificationEvents,
    __tagRaw: tagRawFromForm(values.tag, metaTags),
  };

  if (isSequenceType(type)) {
    Object.assign(overrides, SEQUENCE_FIELD_OVERRIDES);
  }
  return overrides;
}

/** Полное тело запроса create/edit из формы поверх исходной задачи. */
export function buildTaskPayload(
  values: TaskFormValues,
  sourceTask: TaskLike | null | undefined,
  context: PayloadContext,
): TaskPayloadEnvelope {
  if (!sourceTask) throw new Error("Сначала выберите исходную задачу");
  return {
    gamification_task: buildCreatePayload(sourceTask, formValuesToOverrides(values, context)),
  };
}

// ---------------------------------------------------------------------------
// Бриф из графика (подсказки по секциям)
// ---------------------------------------------------------------------------

export interface HintItem {
  title?: string;
  body?: string[] | string;
}

export interface HintBox {
  title: string;
  text: string;
}

export interface PlannerHintsView {
  sections: Partial<Record<SectionId, HintBox>>;
  /** Общий бриф (остаток), показывается над формой. */
  top: HintBox | null;
}

function isLowValueLeftoverItem(item: HintItem | null | undefined): boolean {
  const title = String(item?.title || "").trim();
  const body = (Array.isArray(item?.body) ? item.body : [item?.body])
    .filter(Boolean)
    .join("\n")
    .trim();
  if (!body) return true;
  if ((title === "Прочее" || !title) && /^Порядок в пакете:\s*\S+$/.test(body)) return true;
  return false;
}

function hintBox(items: HintItem[], fallbackTitle: string): HintBox | null {
  if (!items.length) return null;
  const first = items[0];
  const title = items.length === 1 && first?.title ? first.title : fallbackTitle;
  const bodyParts = items.map((item) => {
    const body = Array.isArray(item.body) ? item.body.join("\n") : String(item.body || "");
    if (items.length > 1 && item.title && item.title !== title) {
      return `${item.title}\n${body}`.trim();
    }
    return body.trim();
  });
  return { title, text: bodyParts.filter(Boolean).join("\n\n") };
}

const HINT_TITLE = "Бриф из графика";

/** Бриф задачи из графика, разложенный по секциям формы. Как applyPlannerHint. */
export function groupPlannerHints(task: TaskLike | null | undefined): PlannerHintsView {
  const structured = isRecord(task?._plannerHints) ? task._plannerHints : null;
  const sectionMap = isRecord(structured?.sections) ? structured.sections : null;
  const sections: Partial<Record<SectionId, HintBox>> = {};

  for (const id of SECTION_IDS) {
    const items = sectionMap?.[id];
    const box = hintBox(Array.isArray(items) ? (items as HintItem[]) : [], HINT_TITLE);
    if (box) sections[id] = box;
  }

  if (sectionMap) {
    const leftover = (Array.isArray(structured?.leftover) ? structured.leftover : []).filter(
      (item) => !isLowValueLeftoverItem(item as HintItem),
    ) as HintItem[];
    return { sections, top: hintBox(leftover, HINT_TITLE) };
  }

  const note = String(task?._plannerNote || "").trim();
  return { sections, top: note ? { title: HINT_TITLE, text: note } : null };
}
