/**
 * Сравнение выделенных задач (чистая логика): строки — параметры, столбцы — задачи.
 * Ячейка, отличная от большинства, — кандидат в ошибку; у неё есть операция массовой
 * правки «сделать у всех так» (кроме типа, локалей и целевых действий — их только смотрим).
 */
import { SECTION_TITLES, type SectionId } from "@/features/task-form/task-form";
import { actionTypeLabel, conditionLabel, typeLabel } from "@/lib/labels-ru";
import type { TaskAction, TaskLike } from "@/lib/types";

import { actionFieldLabel, actionFields, describeActionValue } from "./action-text";
import {
  type BulkContext,
  type BulkFieldId,
  type BulkOp,
  type DisplayKey,
  DISPLAY_LABELS,
  bulkOpFromTask,
  conditionList,
  conditionValues,
  describeConditionValue,
  describeField,
  withoutLinks,
} from "./bulk-edit";

export interface CompareCell {
  text: string;
  /** Операция «сделать у всех как в этой ячейке»; null — массово не правится. */
  fix: BulkOp | null;
}

export interface CompareRow {
  key: string;
  section: SectionId;
  label: string;
  cells: CompareCell[];
  /** Самое частое значение строки. */
  majority: string;
  /** Разных значений в строке. */
  variants: number;
}

const EMPTY = "—";
/** Условия нет у задачи — не путать со значением «нет» (false). */
const ABSENT = "не задано";

/** Поля задачи по секциям формы и операция массовой правки для каждого. */
const FIELD_ROWS: ReadonlyArray<{ key: DisplayKey; section: SectionId; field: BulkFieldId }> = [
  { key: "hidden", section: "basic", field: "hidden" },
  { key: "player_consent_required", section: "basic", field: "player_consent_required" },
  { key: "countries", section: "basic", field: "countries" },
  { key: "category", section: "classification", field: "category" },
  { key: "priority", section: "classification", field: "priority" },
  { key: "tag", section: "classification", field: "tag" },
  { key: "events", section: "startup", field: "events" },
  { key: "cron", section: "availability", field: "schedule" },
  { key: "available_from", section: "availability", field: "available_from" },
  { key: "available_till", section: "availability", field: "available_till" },
  { key: "max_repetitions", section: "availability", field: "max_repetitions" },
  { key: "duration", section: "availability", field: "duration" },
  { key: "main_bonus_group_id", section: "rewards", field: "main_bonus_group_id" },
  { key: "secondary_bonus_group_id", section: "rewards", field: "secondary_bonus_group_id" },
  { key: "notification_events", section: "notifications", field: "notification_events" },
];

const SECTION_ORDER: ReadonlyArray<SectionId> = [
  "basic",
  "classification",
  "startup",
  "targeting",
  "availability",
  "actions",
  "rewards",
  "notifications",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

type ActionBlock = "serialized_main_actions" | "serialized_secondary_actions";

/**
 * Целевые действия по полям: строка «тип действия» и строка на каждое заполненное поле
 * («Депозит · Сумма платежей») — так видно, какое именно поле отличается. У кого такого
 * действия или поля нет — «нет».
 */
function actionRows(
  tasks: ReadonlyArray<TaskLike>,
  block: ActionBlock,
  title: string,
): CompareRow[] {
  const lists = tasks.map((t) => (Array.isArray(t[block]) ? (t[block] as TaskAction[]) : []));
  const rows: CompareRow[] = [
    makeRow(
      block,
      "actions",
      title,
      lists.map((list) => ({
        text: list.length
          ? list.map((a) => actionTypeLabel(String(a?.action ?? "?"))).join(", ")
          : EMPTY,
        fix: null,
      })),
    ),
  ];
  const numbered = lists.some((list) => list.length > 1);
  // Порядок полей — как они встречаются у задач; ключ: позиция, тип действия, поле.
  const fields = new Map<string, { index: number; action: string; key: string }>();
  for (const list of lists) {
    list.forEach((action, index) => {
      for (const [key] of actionFields(action)) {
        const id = `${index}|${action.action}|${key}`;
        if (!fields.has(id)) fields.set(id, { index, action: String(action.action), key });
      }
    });
  }
  for (const [id, { index, action, key }] of fields) {
    const label = actionFieldLabel(key);
    const prefix = `${numbered ? `${index + 1}. ` : ""}${actionTypeLabel(action)}`;
    const cells = lists.map((list): CompareCell => {
      const item = list[index];
      const value =
        item?.action === action ? actionFields(item).find(([k]) => k === key)?.[1] : undefined;
      return {
        text: value === undefined ? ABSENT : describeActionValue(key, value),
        fix: null,
      };
    });
    rows.push(makeRow(`${block}:${id}`, "actions", `${prefix} · ${label}`, cells));
  }
  return rows;
}

function localesText(task: TaskLike): string {
  const locales = isRecord(task.locales) ? task.locales : {};
  const filled = Object.keys(locales)
    .filter((code) => String(locales[code] ?? "").trim())
    .sort();
  return filled.length ? filled.join(", ") : EMPTY;
}

function makeRow(key: string, section: SectionId, label: string, cells: CompareCell[]): CompareRow {
  const counts = new Map<string, number>();
  for (const cell of cells) counts.set(cell.text, (counts.get(cell.text) ?? 0) + 1);
  const majority = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? EMPTY;
  return { key, section, label, cells, majority, variants: counts.size };
}

export function buildCompareRows(
  tasks: ReadonlyArray<TaskLike>,
  ctx: BulkContext = {},
): CompareRow[] {
  const rows: CompareRow[] = [];
  const readOnly = (text: string): CompareCell => ({ text, fix: null });

  rows.push(
    makeRow(
      "type",
      "basic",
      "Тип",
      tasks.map((t) => readOnly(t.type ? typeLabel(String(t.type)) : EMPTY)),
    ),
  );
  rows.push(
    makeRow(
      "locales",
      "basic",
      "Заполненные локали",
      tasks.map((t) => readOnly(localesText(t))),
    ),
  );

  for (const { key, section, field } of FIELD_ROWS) {
    rows.push(
      makeRow(
        key,
        section,
        DISPLAY_LABELS[key],
        tasks.map((t) => ({ text: describeField(t, key, ctx), fix: bulkOpFromTask(field, t) })),
      ),
    );
  }

  // Таргетинг: строка на каждое условие, которое есть хотя бы у одной задачи.
  const perTask = tasks.map((t) => conditionValues(withoutLinks(conditionList(t))));
  const names = [...new Set(perTask.flatMap((m) => [...m.keys()]))].sort((a, b) =>
    conditionLabel(a).localeCompare(conditionLabel(b), "ru"),
  );
  for (const name of names) {
    const cells = perTask.map((values): CompareCell => {
      const list = values.get(name) ?? [];
      if (!list.length) return { text: ABSENT, fix: { field: "conditions_remove", names: [name] } };
      return {
        text: list.map(describeConditionValue).join(" | "),
        // Все записи задачи целиком: у повторяемого условия (группы) их может быть несколько.
        fix: {
          field: "conditions_upsert",
          conditions: list.map((value) => ({ [name]: value })),
          onlyExisting: false,
          duplicates: "replace",
        },
      };
    });
    rows.push(makeRow(`condition:${name}`, "targeting", conditionLabel(name), cells));
  }

  rows.push(...actionRows(tasks, "serialized_main_actions", "Основные действия"));
  rows.push(...actionRows(tasks, "serialized_secondary_actions", "Доп. действия"));

  const order = (row: CompareRow) => SECTION_ORDER.indexOf(row.section);
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => order(a.row) - order(b.row) || a.i - b.i)
    .map(({ row }) => row);
}

export interface CompareSection {
  id: SectionId;
  title: string;
  rows: CompareRow[];
}

/** Строки по секциям; onlyDiffs — только строки, где у задач по-разному. */
export function groupCompareRows(
  rows: ReadonlyArray<CompareRow>,
  onlyDiffs: boolean,
): CompareSection[] {
  const sections: CompareSection[] = [];
  for (const row of rows) {
    if (onlyDiffs && row.variants < 2) continue;
    const last = sections[sections.length - 1];
    if (last?.id === row.section) last.rows.push(row);
    else sections.push({ id: row.section, title: SECTION_TITLES[row.section], rows: [row] });
  }
  return sections;
}
