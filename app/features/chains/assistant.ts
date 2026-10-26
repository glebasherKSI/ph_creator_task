/**
 * Консультант по задачам канвы: снимок канвы → бэк Promo Graphic (OpenRouter) → ответ.
 * Агент только читает и знает ровно то, что в снимке: задачи с текущими (в т.ч. несохранёнными)
 * связями, стрелки канвы и глоссарий — подписи кодов из тех же справочников, что видит форма.
 */
import { getRequirementFieldDef } from "@/lib/actions-schema";
import { type ParsedConditionsSchema, getConditionDef } from "@/lib/conditions-schema";
import { graphicApiGet, graphicApiPost, graphicApiPut } from "@/lib/graphic-api";
import {
  actionTypeLabel,
  categoryLabel,
  eventLabel,
  notificationEventLabel,
  priorityLabel,
  typeLabel,
} from "@/lib/labels-ru";
import type { ParsedTaskMeta } from "@/lib/meta";
import { getGamificationTasksCondition } from "@/lib/tasks";
import type { TaskLike } from "@/lib/types";

import { type GraphState, DEFAULT_GT_CONFIG } from "./graph";

/** Бэк принимает до 300 тыс. символов; запас — на history и обёртку запроса. */
export const CONTEXT_LIMIT = 250_000;
const ASK_TIMEOUT_MS = 120_000;

/** Поля задачи — подписи из формы задачи. */
const TASK_FIELD_LABELS: Record<string, string> = {
  name: "Название",
  locales: "Названия на фронте по языкам",
  frontend_identifier: "ID для фронта",
  hidden: "Скрытое",
  manual_reward: "Ручное получение награды",
  type: "Тип",
  player_consent_required: "Согласие игрока",
  countries: "Страны",
  category: "Кампания",
  priority: "Приоритет",
  tag_id: "Тег",
  events: "События запуска",
  cron: "Расписание (cron)",
  available_from: "Доступно с",
  available_till: "Доступно до",
  max_repetitions: "Сколько раз может быть получено",
  duration: "Время жизни (в минутах)",
  infinite: "Бессрочно",
  conditions: "Таргетинг: условия показа задачи игроку",
  serialized_main_actions: "Основной блок целевых действий",
  serialized_secondary_actions: "Дополнительный блок целевых действий",
  main_actions_sequential: "Основной блок: выполнять по порядку",
  secondary_actions_sequential: "Дополнительный блок: выполнять по порядку",
  main_bonus_group_id: "Основная группа бонусов",
  secondary_bonus_group_id: "Доп. группа бонусов",
  notification_events: "Уведомления",
  state: "Статус задачи на бэке",
};

const NOTES = [
  "Условие gamification_tasks в conditions — связь с другими задачами: list — id задач; " +
    "type: enabled = «Включая», disabled = «Исключая»; extra_type: and = «И», or = «Или» (логика списка); " +
    "only_completed = «Только выполненные». На канве это стрелка от задачи из list к этой задаче (links).",
  "Поля _planner* — данные из пакета Promo Graphic, которые ещё не перенесены в поля задачи (бриф черновика).",
  "Пустые поля из снимка убраны: если поля нет — оно не задано.",
];

/** Служебные поля, которые ничего не говорят о настройке задачи. */
const DROP_KEYS = new Set(["created_at", "updated_at"]);

export interface AssistantRefs {
  meta?: ParsedTaskMeta | null;
  conditionsSchema?: ParsedConditionsSchema | null;
}

export type CanvasSnapshotState = Pick<
  GraphState,
  "canvas" | "edges" | "targetConfigs" | "dirtyTargets"
>;

export interface CanvasContext {
  tasks: Record<string, unknown>[];
  links: Record<string, unknown>[];
  off_canvas_ids: string[];
  focus_ids: string[];
  glossary: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Без null, пустых строк, пустых списков и объектов — false и 0 остаются. */
export function compactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map(compactValue).filter((item) => item !== undefined);
    return items.length ? items : undefined;
  }
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (DROP_KEYS.has(key)) continue;
      const next = compactValue(item);
      if (next !== undefined) out[key] = next;
    }
    return Object.keys(out).length ? out : undefined;
  }
  if (value === null || value === undefined || value === "") return undefined;
  return value;
}

function taskBody(state: CanvasSnapshotState, id: string): TaskLike {
  const card = state.canvas[id]!;
  const full: TaskLike = card.full ?? {
    name: card.name,
    frontend_identifier: card.frontend_identifier,
  };
  // Связи — с канвы: там и несохранённые изменения.
  return { ...full, conditions: card.conditions ?? full.conditions };
}

function canvasFlags(state: CanvasSnapshotState, id: string) {
  return {
    id,
    on_backend: state.canvas[id]?.localOnly !== true,
    unsaved_links: state.dirtyTargets.includes(id),
  };
}

function actionsOf(task: TaskLike): Record<string, unknown>[] {
  return [task.serialized_main_actions, task.serialized_secondary_actions]
    .flatMap((list) => (Array.isArray(list) ? list : []))
    .filter(isRecord);
}

/** Подписи только тех кодов, что встречаются на канве; код без подписи не попадает. */
function buildGlossary(tasks: TaskLike[], refs: AssistantRefs): Record<string, unknown> {
  const sections: Record<string, Record<string, unknown>> = {
    task_types: {},
    categories: {},
    priorities: {},
    events: {},
    notification_events: {},
    actions: {},
    action_fields: {},
    conditions: {},
    bonus_groups: {},
    tags: {},
    filters: {},
  };
  const put = (section: string, code: unknown, label: unknown) => {
    const key = String(code ?? "");
    if (key && label != null && String(label) !== key) sections[section]![key] = label;
  };
  const byId = <T extends { id: number | string }>(list: T[] | undefined, id: unknown) =>
    list?.find((item) => String(item.id) === String(id));

  for (const task of tasks) {
    put("task_types", task.type, typeLabel(String(task.type ?? "")));
    put("categories", task.category, categoryLabel(String(task.category ?? "")));
    if (task.priority != null)
      put("priorities", task.priority, priorityLabel(task.priority as number));
    for (const code of Array.isArray(task.events) ? task.events : []) {
      put("events", code, eventLabel(String(code)));
    }
    for (const code of Array.isArray(task.notification_events) ? task.notification_events : []) {
      put("notification_events", code, notificationEventLabel(String(code)));
    }
    for (const action of actionsOf(task)) {
      put("actions", action.action, actionTypeLabel(String(action.action ?? "")));
      for (const key of [
        ...Object.keys(isRecord(action.requirements) ? action.requirements : {}),
        ...Object.keys(isRecord(action.conditions) ? action.conditions : {}),
      ]) {
        const def = getRequirementFieldDef(key);
        if (!def) continue;
        put(
          "action_fields",
          key,
          def.options?.length
            ? {
                label: def.label,
                options: Object.fromEntries(def.options.map((o) => [o.id, o.label])),
              }
            : def.label,
        );
      }
    }
    for (const condition of Array.isArray(task.conditions) ? task.conditions : []) {
      if (!isRecord(condition)) continue;
      for (const name of Object.keys(condition)) {
        put("conditions", name, getConditionDef(refs.conditionsSchema, name)?.label);
      }
    }
    for (const key of ["main_bonus_group_id", "secondary_bonus_group_id"]) {
      put("bonus_groups", task[key], byId(refs.meta?.bonuses, task[key])?.title);
    }
    put("tags", task.tag_id, byId(refs.meta?.tags, task.tag_id)?.name);
    put("filters", task.filter_id, byId(refs.meta?.filters, task.filter_id)?.name);
  }

  const glossary: Record<string, unknown> = { task_fields: TASK_FIELD_LABELS, notes: NOTES };
  for (const [name, entries] of Object.entries(sections)) {
    if (Object.keys(entries).length) glossary[name] = entries;
  }
  return glossary;
}

/**
 * Снимок канвы для консультанта. Если полный снимок больше CONTEXT_LIMIT, выделенные задачи
 * остаются полными, остальные — кратко (detail: "index"), и агент знает, чего у него нет.
 */
export function buildCanvasContext(
  state: CanvasSnapshotState,
  focusIds: string[],
  refs: AssistantRefs = {},
): CanvasContext {
  const ids = Object.keys(state.canvas);
  const onCanvas = new Set(ids);
  const bodies = new Map(ids.map((id) => [id, taskBody(state, id)]));

  const offCanvas = new Set<string>();
  for (const body of bodies.values()) {
    const gt = getGamificationTasksCondition(body.conditions);
    for (const ref of Array.isArray(gt?.list) ? gt.list : []) {
      if (!onCanvas.has(String(ref))) offCanvas.add(String(ref));
    }
  }

  const fullTask = (id: string) => ({
    ...canvasFlags(state, id),
    ...(compactValue(bodies.get(id)) as Record<string, unknown>),
    id,
  });
  const indexTask = (id: string) => {
    const body = bodies.get(id)!;
    return compactValue({
      ...canvasFlags(state, id),
      detail: "index",
      name: body.name,
      type: body.type,
      state: body.state,
      available_from: body.available_from,
      available_till: body.available_till,
    }) as Record<string, unknown>;
  };

  const focus = focusIds.filter((id) => onCanvas.has(id));
  const base = {
    links: state.edges.map((edge) => ({
      ...edge,
      ...(state.targetConfigs[edge.to] ?? DEFAULT_GT_CONFIG),
    })),
    off_canvas_ids: [...offCanvas],
    focus_ids: focus,
    glossary: buildGlossary([...bodies.values()], refs),
  };
  const full: CanvasContext = { tasks: ids.map(fullTask), ...base };
  if (JSON.stringify(full).length <= CONTEXT_LIMIT || !focus.length) return full;
  const keep = new Set(focus);
  return { tasks: ids.map((id) => (keep.has(id) ? fullTask(id) : indexTask(id))), ...base };
}

export function contextSize(context: CanvasContext): number {
  return JSON.stringify(context).length;
}

export interface AssistantTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AssistantReply {
  answer: string;
  model: string;
  /** #id из ответа, которых нет в снимке, — признак выдумки. */
  unknown_refs: string[];
  log_id: number | null;
  /** Версия инструкций, по которой дан ответ; null — встроенные. */
  prompt_version_id: number | null;
}

export async function askCanvasAssistant(opts: {
  question: string;
  history: AssistantTurn[];
  context: CanvasContext;
  domain: string;
}): Promise<AssistantReply> {
  const data = (await graphicApiPost(
    "/api/promohub-planner/assistant/ask",
    opts,
    ASK_TIMEOUT_MS,
  )) as Partial<AssistantReply> | null;
  if (!data?.answer) throw new Error("Консультант не вернул ответ");
  return {
    answer: data.answer,
    model: String(data.model ?? ""),
    unknown_refs: Array.isArray(data.unknown_refs) ? data.unknown_refs.map(String) : [],
    log_id: typeof data.log_id === "number" ? data.log_id : null,
    prompt_version_id: typeof data.prompt_version_id === "number" ? data.prompt_version_id : null,
  };
}

export interface AssistantPromptVersion {
  /** null — встроенные инструкции (в БД ещё нет версий). */
  id: number | null;
  content: string;
  comment: string | null;
  author: string | null;
  created_at: string | null;
}

export interface AssistantPromptState {
  current: AssistantPromptVersion;
  /** Встроенный текст из кода бэка — для отката к исходному. */
  default: string;
  /** Сохранённые версии, новые первыми. */
  versions: AssistantPromptVersion[];
}

const PROMPT_PATH = "/api/promohub-planner/assistant/prompt";

export async function loadAssistantPrompt(): Promise<AssistantPromptState> {
  return (await graphicApiGet(PROMPT_PATH)) as AssistantPromptState;
}

/** Новая версия инструкций; консультант берёт её со следующего вопроса. */
export async function saveAssistantPrompt(
  content: string,
  comment: string,
): Promise<AssistantPromptState> {
  return (await graphicApiPut(PROMPT_PATH, { content, comment })) as AssistantPromptState;
}

export function promptVersionLabel(id: number | null): string {
  return id == null ? "встроенные инструкции" : `инструкции №${id}`;
}

/** Оценка ответа; comment перезаписывает прежний (null — без отзыва). */
export async function rateAssistantAnswer(
  logId: number,
  rating: 1 | -1,
  comment: string | null = null,
): Promise<void> {
  await graphicApiPut(`/api/promohub-planner/assistant/answers/${logId}/rating`, {
    rating,
    comment,
  });
}

/** Причины дизлайка — по ним потом группируются плохие ответы при разборе. */
export const FEEDBACK_REASONS = [
  "Выдумал данные",
  "Не нашёл то, что есть на канве",
  "Неверно понял настройку",
  "Не ответил на вопрос",
  "Плохо оформлено",
] as const;

export interface AnswerFeedback {
  reasons: string[];
  text: string;
}

/** Отзыв → rating_comment: читается человеком и разбирается по префиксам строк. */
export function formatFeedback({ reasons, text }: AnswerFeedback): string | null {
  const lines: string[] = [];
  if (reasons.length) lines.push(`Причины: ${reasons.join("; ")}`);
  if (text.trim()) lines.push(`Комментарий: ${text.trim()}`);
  return lines.length ? lines.join("\n") : null;
}
