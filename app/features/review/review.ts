/**
 * Ревью задачи агента (чистая логика): что стоит в задаче сейчас против того, что сделал агент,
 * по секциям формы рядом с брифом из графика; правки человека — уроки для агента.
 */
import type { BulkContext } from "@/features/chains/bulk-edit";
import { buildCompareRows } from "@/features/chains/compare";
import {
  SECTION_IDS,
  SECTION_TITLES,
  type SectionId,
  groupPlannerHints,
} from "@/features/task-form/task-form";
import type { TaskLike } from "@/lib/types";

import type { AgentReviewItem, ReviewDiffEntry, ReviewStatus } from "./review-api";

const EMPTY = "—";

export interface ReviewRow {
  key: string;
  section: SectionId;
  label: string;
  /** Как сделал агент. */
  agent: string;
  /** Как сейчас в админке; null — задача не загружена. */
  current: string | null;
  changed: boolean;
}

/**
 * Задача, как её сохранил агент. Берём ответ админки после создания, а не payload: текущая задача
 * тоже читается из админки, и одинаковая нормализация не даст ложных расхождений.
 */
export function agentTaskOf(item: AgentReviewItem): TaskLike | null {
  return item.result ?? item.payload?.gamification_task ?? null;
}

function text(value: unknown): string {
  const s = String(value ?? "").trim();
  return s || EMPTY;
}

function localeCodes(tasks: ReadonlyArray<TaskLike>): string[] {
  const codes = new Set<string>();
  for (const task of tasks) {
    const locales = task.locales;
    if (locales && typeof locales === "object" && !Array.isArray(locales)) {
      for (const [code, title] of Object.entries(locales))
        if (String(title ?? "").trim()) codes.add(code);
    }
  }
  return [...codes].sort();
}

function localeOf(task: TaskLike, code: string): string {
  const locales = task.locales as Record<string, unknown> | undefined;
  return text(locales?.[code]);
}

export function buildReviewRows(
  agentTask: TaskLike,
  current: TaskLike | null,
  ctx: BulkContext = {},
): ReviewRow[] {
  const tasks = current ? [agentTask, current] : [agentTask];
  const row = (key: string, section: SectionId, label: string, values: string[]): ReviewRow => ({
    key,
    section,
    label,
    agent: values[0] ?? EMPTY,
    current: current ? (values[1] ?? EMPTY) : null,
    changed: current != null && values[0] !== values[1],
  });

  const rows: ReviewRow[] = [
    row(
      "name",
      "basic",
      "Название",
      tasks.map((t) => text(t.name)),
    ),
    row(
      "frontend_identifier",
      "basic",
      "ID для фронта",
      tasks.map((t) => text(t.frontend_identifier)),
    ),
    ...localeCodes(tasks).map((code) =>
      row(
        `locale:${code}`,
        "basic",
        `Название на фронте (${code})`,
        tasks.map((t) => localeOf(t, code)),
      ),
    ),
  ];
  for (const compare of buildCompareRows(tasks, ctx)) {
    if (compare.key === "locales") continue;
    rows.push(
      row(
        compare.key,
        compare.section,
        compare.label,
        compare.cells.map((c) => c.text),
      ),
    );
  }
  const order = (r: ReviewRow) => SECTION_IDS.indexOf(r.section);
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => order(a.r) - order(b.r) || a.i - b.i)
    .map(({ r }) => r);
}

/** Поля, которые человек поправил после агента. */
export function reviewDiff(rows: ReadonlyArray<ReviewRow>): ReviewDiffEntry[] {
  return rows
    .filter((r) => r.changed)
    .map((r) => ({
      key: r.key,
      label: r.label,
      section: SECTION_TITLES[r.section],
      agent: r.agent,
      human: r.current ?? EMPTY,
    }));
}

export interface BriefView {
  general: string | null;
  sections: Partial<Record<SectionId, string>>;
}

/** Бриф из графика по секциям формы — то, по чему агент заполнял задачу. */
export function briefOf(item: AgentReviewItem): BriefView {
  const hints = groupPlannerHints(item.draft);
  const sections: Partial<Record<SectionId, string>> = {};
  for (const id of SECTION_IDS) {
    const box = hints.sections[id];
    if (box?.text) sections[id] = box.text;
  }
  return { general: hints.top?.text ?? null, sections };
}

export interface ReviewSection {
  id: SectionId;
  title: string;
  brief: string | null;
  rows: ReviewRow[];
}

/** Секции в порядке формы: те, где есть поля или бриф. */
export function reviewSections(rows: ReadonlyArray<ReviewRow>, brief: BriefView): ReviewSection[] {
  return SECTION_IDS.map((id) => ({
    id,
    title: SECTION_TITLES[id],
    brief: brief.sections[id] ?? null,
    rows: rows.filter((r) => r.section === id),
  })).filter((s) => s.rows.length || s.brief);
}

/** Причины, по которым агент ошибся, — по ним разбираются ревью и пишутся уроки. */
export const REVIEW_REASONS = [
  "Не по брифу",
  "Выдумал значение",
  "Пропустил поле",
  "Не тот бонус",
  "Не те даты",
  "Не тот таргетинг",
  "Неверные действия",
  "Неверные названия",
] as const;

/** Итог ревью: отклонено, принято как есть или принято с правками человека. */
export function verdictStatus(
  diff: ReadonlyArray<ReviewDiffEntry>,
  rejected: boolean,
): ReviewStatus {
  if (rejected) return "rejected";
  return diff.length ? "fixed" : "approved";
}

export const VERDICT_LABELS: Record<ReviewStatus, string> = {
  approved: "Принято",
  fixed: "Принято с правками",
  rejected: "Отклонено",
};

const LESSON_VALUE_LIMIT = 80;

function clip(value: string): string {
  return value.length > LESSON_VALUE_LIMIT ? `${value.slice(0, LESSON_VALUE_LIMIT - 1)}…` : value;
}

/**
 * Черновик урока для агента из правок и комментария. Человек дописывает общее правило —
 * «почему», а не только «что»: пример с конкретными значениями агент получит и так.
 */
export function lessonDraft(
  diff: ReadonlyArray<ReviewDiffEntry>,
  comment: string,
  reasons: ReadonlyArray<string>,
): string {
  const parts: string[] = [];
  if (comment.trim()) parts.push(comment.trim());
  else if (reasons.length) parts.push(`${reasons.join(", ")}.`);
  const changes = diff
    .slice(0, 5)
    .map((d) => `${d.label}: не «${clip(d.agent)}», а «${clip(d.human)}»`);
  if (changes.length) parts.push(`${changes.join("; ")}.`);
  return parts.join(" ");
}
