/**
 * Инструменты агента — обёртки над теми же функциями, что вызывает интерфейс: открыть пакет,
 * посмотреть и поправить черновик, сохранить его на бэк. Агенту доступны только локальные черновики
 * (карточки local_…, которых ещё нет на бэке); на бэк они уходят в статусе draft.
 */
import { toApiAction, toEditorFields } from "@/features/task-form/actions-builder";
import type { CountriesData } from "@/features/task-form/country-selector";
import { SECTION_TITLES, groupPlannerHints } from "@/features/task-form/task-form";
import { ACTION_TYPES, getActionDef } from "@/lib/actions-schema";
import { errorMessage } from "@/lib/auth/errors";
import type { ParsedConditionsSchema } from "@/lib/conditions-schema";
import { graphicApiGet } from "@/lib/graphic-api";
import {
  actionTypeLabel,
  categoryLabel,
  eventLabel,
  notificationEventLabel,
  priorityLabel,
  typeLabel,
} from "@/lib/labels-ru";
import type { ParsedTaskMeta } from "@/lib/meta";
import { createTask } from "@/lib/task-api";
import { logTaskEvent } from "@/lib/task-events";
import { SEQUENCE_TASK_TYPE } from "@/lib/constants";
import { getGamificationTasksCondition } from "@/lib/tasks";
import type { Condition, TaskAction, TaskLike } from "@/lib/types";

import type { AgentToolDef } from "./agent-api";
import { applyDraftCreated, buildDraftPayload } from "./draft-pipeline";
import { type GraphState, mergeGamificationTasks } from "./graph";
import { extractPackages, packageSubtitle } from "./packages";
import { openPackageOnCanvas } from "./packages-actions";
import { useChainsStore } from "./store";

export interface AgentRefs {
  meta: ParsedTaskMeta | null;
  conditionsSchema: ParsedConditionsSchema | null;
  countries: CountriesData | null;
}

export interface CreatedByAgent {
  localId: string;
  id: string;
  name: string;
}

export interface AgentContext {
  runId: string;
  domain: string;
  refs: AgentRefs;
  /** Черновики, с которыми можно работать (выделенные); null — все локальные на канве. */
  scope: Set<string> | null;
  ensureAuthenticated: (domain: string) => Promise<boolean>;
  onCreated: (entry: CreatedByAgent) => void;
}

/** Ошибка, которую агент должен прочитать и учесть, — уходит ему текстом. */
export class ToolError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Без null, пустых строк, списков и объектов — false и 0 остаются. */
export function compactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map(compactValue).filter((item) => item !== undefined);
    return items.length ? items : undefined;
  }
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const next = compactValue(item);
      if (next !== undefined) out[key] = next;
    }
    return Object.keys(out).length ? out : undefined;
  }
  if (value === null || value === undefined || value === "") return undefined;
  return value;
}

// ---------------------------------------------------------------------------
// Черновик глазами агента
// ---------------------------------------------------------------------------

/** Поля задачи, которые агент может менять; связи (gamification_tasks) — только стрелками канвы. */
export const EDITABLE_FIELDS = [
  "name",
  "frontend_identifier",
  "locales",
  "hidden",
  "type",
  "player_consent_required",
  "manual_reward",
  "countries",
  "countries_lists",
  "countries_matching_type",
  "category",
  "priority",
  "tag_id",
  "events",
  "cron",
  "available_from",
  "available_till",
  "max_repetitions",
  "duration",
  "infinite",
  "conditions",
  "serialized_main_actions",
  "serialized_secondary_actions",
  "main_actions_sequential",
  "secondary_actions_sequential",
  "main_bonus_group_id",
  "secondary_bonus_group_id",
  "notification_events",
] as const;

const EDITABLE = new Set<string>(EDITABLE_FIELDS);
const ACTION_KEYS = new Set(["serialized_main_actions", "serialized_secondary_actions"]);
/** Служебное в payload — агенту только шум. */
const HIDDEN_PAYLOAD_KEYS = new Set(["tag", "cross_project", "shared_projects", "filter_id"]);

export interface AgentAction {
  action: string;
  label: string;
  fields: Record<string, unknown>;
}

export function actionsForAgent(list: unknown): AgentAction[] {
  return (Array.isArray(list) ? list : []).filter(isRecord).map((item) => {
    const action = item as unknown as TaskAction;
    return {
      action: String(action.action ?? ""),
      label: actionTypeLabel(String(action.action ?? "")),
      fields: toEditorFields(action),
    };
  });
}

/** Поля задачи, как они уйдут на бэк: действия — плоскими полями, как в форме. */
export function fieldsForAgent(task: TaskLike): Record<string, unknown> {
  const plain: Record<string, unknown> = {};
  const actions: Record<string, AgentAction[]> = {};
  for (const [key, value] of Object.entries(task)) {
    if (key.startsWith("_") || HIDDEN_PAYLOAD_KEYS.has(key)) continue;
    if (ACTION_KEYS.has(key)) {
      const list = actionsForAgent(value);
      if (list.length) actions[key] = list;
    } else {
      plain[key] = value;
    }
  }
  // Действия — без сжатия: пустые fields у действия значат «без условий», это тоже ответ.
  return { ...((compactValue(plain) as Record<string, unknown>) ?? {}), ...actions };
}

/** Бриф из графика: тексты по секциям формы и то, что маппинг не перенёс в поля. */
export function briefForAgent(task: TaskLike): Record<string, unknown> {
  const hints = groupPlannerHints(task);
  const sections: Record<string, string> = {};
  for (const [id, box] of Object.entries(hints.sections)) {
    if (box?.text) sections[SECTION_TITLES[id as keyof typeof SECTION_TITLES]] = box.text;
  }
  return (
    (compactValue({
      planner_task_id: task._plannerTaskId,
      general: hints.top?.text,
      sections,
      tag: task._plannerTag,
      reward_points: task._plannerRewardPoints,
      secondary_reward_points: task._plannerSecondaryRewardPoints,
      prerequisite_name: task._plannerPrerequisiteName,
    }) as Record<string, unknown>) ?? {}
  );
}

/** Чего не хватает черновику по сравнению с брифом — подсказки, не ошибки схемы. */
export function draftWarnings(task: TaskLike, source: TaskLike, linked: boolean): string[] {
  const out: string[] = [];
  const sequence = task.type === SEQUENCE_TASK_TYPE;
  const main = Array.isArray(task.serialized_main_actions) ? task.serialized_main_actions : [];
  if (!main.length) out.push("Нет целевых действий в основном блоке");
  if (source._plannerRewardPoints != null && !task.main_bonus_group_id) {
    out.push(
      `В брифе награда ${String(source._plannerRewardPoints)} pts, а основная группа бонусов не выбрана`,
    );
  }
  if (source._plannerSecondaryRewardPoints != null && !task.secondary_bonus_group_id) {
    out.push(
      `В брифе доп. награда ${String(source._plannerSecondaryRewardPoints)} pts, а доп. группа бонусов не выбрана`,
    );
  }
  if (source._plannerTag && task.tag_id == null) {
    out.push(`В брифе тег «${String(source._plannerTag)}», а тег не выбран`);
  }
  if (!sequence && !task.available_from) out.push("Не задана дата начала (available_from)");
  if (!sequence && !task.available_till) out.push("Не задана дата окончания (available_till)");
  const locales = isRecord(task.locales) ? Object.values(task.locales) : [];
  if (!locales.some((title) => String(title ?? "").trim())) {
    out.push("Нет названий на фронте (locales)");
  }
  if (source._plannerPrerequisiteId != null && !linked) {
    out.push("В графике у задачи есть предшественник, а связи на канве нет");
  }
  return out;
}

export interface DraftPatchResult {
  full: TaskLike;
  conditions: Condition[];
  changed: string[];
  rejected: string[];
}

/**
 * Правка тела черновика. Действия приходят плоскими полями ({action, fields}) и собираются так же,
 * как в форме; условие связей (gamification_tasks) остаётся прежним — его задают стрелки.
 */
export function applyDraftPatch(
  full: TaskLike,
  cardConditions: Condition[] | null,
  fields: Record<string, unknown>,
): DraftPatchResult {
  const next: TaskLike = { ...full };
  const changed: string[] = [];
  const rejected: string[] = [];
  const gt = getGamificationTasksCondition(cardConditions ?? full.conditions);
  let conditions = cardConditions ?? (Array.isArray(full.conditions) ? full.conditions : []);

  for (const [key, value] of Object.entries(fields)) {
    if (!EDITABLE.has(key)) {
      rejected.push(`${key}: поле нельзя менять`);
      continue;
    }
    if (ACTION_KEYS.has(key)) {
      if (!Array.isArray(value)) {
        rejected.push(`${key}: нужен список действий`);
        continue;
      }
      const actions: TaskAction[] = [];
      const bad = value.filter((item) => {
        const type = String(isRecord(item) ? (item.action ?? "") : "");
        if (!ACTION_TYPES.includes(type)) return true;
        actions.push(toApiAction(type, isRecord(item.fields) ? item.fields : {}));
        return false;
      });
      if (bad.length) {
        rejected.push(`${key}: неизвестный тип действия — смотрите get_reference("actions")`);
        continue;
      }
      next[key] = actions;
    } else if (key === "conditions") {
      if (!Array.isArray(value) || !value.every(isRecord)) {
        rejected.push("conditions: нужен список объектов {<условие>: <значение>}");
        continue;
      }
      const own = (value as Condition[]).filter((item) => !item.gamification_tasks);
      next.conditions = own;
      conditions = mergeGamificationTasks(own, gt);
    } else if (key === "locales") {
      if (!isRecord(value)) {
        rejected.push("locales: нужен объект {код языка: название}");
        continue;
      }
      next.locales = { ...(isRecord(full.locales) ? full.locales : {}), ...value };
    } else {
      next[key] = value;
    }
    changed.push(key);
  }
  return { full: next, conditions, changed, rejected };
}

// ---------------------------------------------------------------------------
// Канва
// ---------------------------------------------------------------------------

function draftIds(state: GraphState, ctx: AgentContext): string[] {
  return Object.values(state.canvas)
    .filter((card) => card.localOnly && card.full && (!ctx.scope || ctx.scope.has(card.id)))
    .map((card) => card.id);
}

function predecessors(state: GraphState, id: string): string[] {
  return state.edges.filter((edge) => edge.to === id).map((edge) => edge.from);
}

function cardLabel(state: GraphState, id: string) {
  const card = state.canvas[id];
  return { id, name: card?.name ?? "", on_backend: card ? !card.localOnly : null };
}

function requireDraft(ctx: AgentContext, id: unknown): string {
  const key = String(id ?? "");
  const card = useChainsStore.getState().canvas[key];
  if (!card) throw new ToolError(`На канве нет задачи ${key}`);
  if (!card.localOnly) {
    throw new ToolError(`Задача ${key} уже на бэке — агент меняет только локальные черновики`);
  }
  if (ctx.scope && !ctx.scope.has(key)) {
    throw new ToolError(`Черновик ${key} не выделен — пользователь ограничил работу выделенными`);
  }
  if (!card.full) throw new ToolError(`У черновика ${key} нет тела задачи`);
  return key;
}

function draftCheck(ctx: AgentContext, id: string) {
  const state = useChainsStore.getState();
  const built = buildDraftPayload(state, id, ctx.refs);
  if (!built) throw new ToolError(`${id} — не локальный черновик`);
  const task = built.payload.gamification_task;
  const linked = predecessors(state, id).length > 0;
  return {
    built,
    validation: {
      errors: built.errors,
      warnings: draftWarnings(task, built.task, linked),
    },
  };
}

function listDrafts(ctx: AgentContext) {
  const state = useChainsStore.getState();
  const drafts = draftIds(state, ctx).map((id) => {
    const { built, validation } = draftCheck(ctx, id);
    return compactValue({
      id,
      name: state.canvas[id]?.name,
      type: built.payload.gamification_task.type,
      planner_task_id: built.task._plannerTaskId,
      predecessors: predecessors(state, id).map((from) => cardLabel(state, from)),
      errors: validation.errors,
      warnings: validation.warnings,
    });
  });
  return {
    drafts,
    scope: ctx.scope ? "только выделенные черновики" : "все локальные черновики на канве",
    on_backend_on_canvas: Object.values(state.canvas).filter((card) => !card.localOnly).length,
  };
}

function getDraft(ctx: AgentContext, args: Record<string, unknown>) {
  const id = requireDraft(ctx, args.id);
  const state = useChainsStore.getState();
  const { built, validation } = draftCheck(ctx, id);
  return {
    id,
    fields: fieldsForAgent(built.payload.gamification_task),
    brief: briefForAgent(built.task),
    links: {
      predecessors: predecessors(state, id).map((from) => cardLabel(state, from)),
      followers: state.edges
        .filter((edge) => edge.from === id)
        .map((edge) => cardLabel(state, edge.to)),
    },
    validation,
  };
}

function updateDraft(ctx: AgentContext, args: Record<string, unknown>) {
  const id = requireDraft(ctx, args.id);
  if (!isRecord(args.fields) || !Object.keys(args.fields).length) {
    throw new ToolError("fields — объект с полями, которые нужно поменять");
  }
  const card = useChainsStore.getState().canvas[id]!;
  const patch = applyDraftPatch(card.full!, card.conditions, args.fields);
  if (patch.changed.length) {
    useChainsStore.setState((s) => {
      const current = s.canvas[id];
      if (!current) return {};
      return {
        canvas: {
          ...s.canvas,
          [id]: {
            ...current,
            full: patch.full,
            conditions: patch.conditions,
            name: String(patch.full.name ?? current.name),
            frontend_identifier: String(patch.full.frontend_identifier ?? ""),
          },
        },
      };
    });
  }
  const { validation } = draftCheck(ctx, id);
  return { id, changed: patch.changed, rejected: patch.rejected, validation };
}

async function createDraftOnBackend(ctx: AgentContext, args: Record<string, unknown>) {
  const id = requireDraft(ctx, args.id);
  const notes = String(args.notes ?? "").trim();
  const state = useChainsStore.getState();
  const pending = predecessors(state, id).filter(
    (from) => state.canvas[from]?.localOnly && (!ctx.scope || ctx.scope.has(from)),
  );
  if (pending.length) {
    throw new ToolError(
      `Сначала создайте предшественников (${pending.join(", ")}) — тогда связь сразу уйдёт на бэк`,
    );
  }
  const { built } = draftCheck(ctx, id);
  if (built.errors.length) return { ok: false, errors: built.errors };

  const plannerTaskId = (built.task._plannerTaskId as number | string | null | undefined) ?? null;
  const event = {
    source: "agent" as const,
    domain: ctx.domain,
    planner_task_id: plannerTaskId,
    draft: built.task,
    payload: built.payload,
    agent_run_id: ctx.runId,
    notes: notes || undefined,
  };
  let created: Awaited<ReturnType<typeof createTask>>;
  try {
    created = await createTask(ctx.domain, built.payload);
  } catch (err) {
    void logTaskEvent({ ...event, event: "create_failed", error: errorMessage(err) });
    throw err;
  }
  const name = String(built.payload.gamification_task.name ?? "");
  if (created.newId == null || !created.task) {
    return {
      ok: true,
      warning:
        "Задача создана, но id не найден. Не создавай её повторно — человек найдёт её в админке.",
    };
  }
  void logTaskEvent({
    ...event,
    event: "created",
    ph_backend_id: created.newId,
    result: created.task,
  });
  applyDraftCreated(created.task, id, plannerTaskId);
  ctx.onCreated({ localId: id, id: String(created.newId), name });
  return { ok: true, ph_backend_id: String(created.newId), name, state: "draft" };
}

// ---------------------------------------------------------------------------
// Пакеты графика
// ---------------------------------------------------------------------------

async function listPackages(args: Record<string, unknown>) {
  const status = typeof args.status === "string" ? args.status : "ready";
  const packages = extractPackages(
    await graphicApiGet("/api/promohub-planner/packages", { status }),
  );
  return {
    packages: packages.slice(0, 50).map((pkg) =>
      compactValue({
        id: pkg.id,
        name: pkg.name,
        status: pkg.status,
        tasks: pkg.task_count,
        about: packageSubtitle(pkg),
      }),
    ),
  };
}

async function openPackage(ctx: AgentContext, args: Record<string, unknown>) {
  const packageId = Number(args.package_id);
  if (!Number.isInteger(packageId) || packageId <= 0) throw new ToolError("Нужен package_id");
  const result = await openPackageOnCanvas(
    { id: packageId },
    { ensureAuthenticated: ctx.ensureAuthenticated },
  );
  // Открытые по просьбе пользователя черновики — тоже в работе агента.
  for (const id of result.placedDrafts) ctx.scope?.add(id);
  return {
    package: result.packageName,
    new_drafts: result.placedDrafts.length,
    already_on_backend: result.placedBackend.length,
    links_from_graphic: result.linked,
    load_errors: result.loadErrors,
    unresolved_links: result.unresolved,
  };
}

// ---------------------------------------------------------------------------
// Справочники
// ---------------------------------------------------------------------------

function labeled<T extends string | number>(values: T[], label: (value: T) => string) {
  return values.map((value) => ({ id: value, label: label(value) }));
}

function getReference(ctx: AgentContext, args: Record<string, unknown>) {
  const kind = String(args.kind ?? "");
  const name = String(args.name ?? "").trim();
  const { meta, conditionsSchema, countries } = ctx.refs;
  const need = <T>(value: T | null, what: string): T => {
    if (!value) throw new ToolError(`Справочник «${what}» не загрузился — поле не заполнять`);
    return value;
  };
  switch (kind) {
    case "tags":
      return { tags: need(meta, "теги").tags };
    case "bonus_groups":
      return {
        bonus_groups: need(meta, "группы бонусов").bonuses,
        note: "Число pts в конце названия группы — награда в поинтах (100 поинтов = 1 евро)",
      };
    case "task_fields": {
      const m = need(meta, "поля задачи");
      return {
        types: labeled(m.types, typeLabel),
        categories: labeled(m.categories, categoryLabel),
        priorities: labeled(m.priorities, priorityLabel),
        events: labeled(m.events, eventLabel),
        notification_events: labeled(m.notification_events, notificationEventLabel),
      };
    }
    case "conditions": {
      const schema = need(conditionsSchema, "условия таргетинга");
      if (!name) {
        return {
          conditions: schema.conditions.map((def) => ({
            name: def.name,
            label: def.label,
            type: def.type,
          })),
          note: 'Подробности и формат значения — get_reference({kind: "conditions", name})',
        };
      }
      const def = schema.byName.get(name);
      if (!def) throw new ToolError(`Условия ${name} нет в справочнике`);
      return compactValue({
        name: def.name,
        label: def.label,
        type: def.type,
        default_value: def.value,
        options: def.collection?.slice(0, 150),
        options_total: def.collection?.length,
        types: def.availableTypes,
        extra_types: def.availableExtraTypes,
        format: `В conditions задачи — элемент {"${def.name}": <значение как default_value>}`,
      });
    }
    case "actions": {
      if (!name)
        return { actions: ACTION_TYPES.map((type) => ({ type, label: actionTypeLabel(type) })) };
      const def = getActionDef(name);
      if (!def || !ACTION_TYPES.includes(name)) throw new ToolError(`Нет действия ${name}`);
      const fields = [...def.conditionFields, ...def.attributeFields].map((field) =>
        compactValue({
          key: field.key,
          label: field.label,
          widget: field.widget,
          hint: field.hint,
          options: field.remoteOptions ? undefined : field.options,
        }),
      );
      return {
        type: def.type,
        label: def.label,
        fields,
        note: "Суммы в поинтах: 100 поинтов = 1 евро",
      };
    }
    case "countries": {
      const data = need(countries, "страны");
      return {
        countries: data.countries.map((c) => ({ code: c.code, name: c.ru || c.en })),
        countries_lists: data.countriesLists,
      };
    }
    default:
      throw new ToolError(
        "kind: tags | bonus_groups | task_fields | conditions | actions | countries",
      );
  }
}

// ---------------------------------------------------------------------------
// Описания для модели и диспетчер
// ---------------------------------------------------------------------------

const ID_PARAM = { type: "string", description: "id черновика на канве (local_…)" };

function tool(
  name: string,
  description: string,
  properties: Record<string, unknown> = {},
  required: string[] = [],
): AgentToolDef {
  return {
    type: "function",
    function: {
      name,
      description,
      parameters: { type: "object", properties, required, additionalProperties: false },
    },
  };
}

export const AGENT_TOOLS: AgentToolDef[] = [
  tool(
    "list_drafts",
    "Локальные черновики на канве (ещё не созданы на бэке): название, связи, ошибки схемы и чего не хватает по брифу.",
  ),
  tool(
    "get_draft",
    "Черновик целиком: fields — как поля уйдут на бэк (действия плоскими полями), brief — что написал автор пакета в графике, links — связи на канве, validation — ошибки и подсказки.",
    { id: ID_PARAM },
    ["id"],
  ),
  tool(
    "update_draft",
    "Поменять поля черновика на канве (на бэк ничего не уходит). Ключи — как в fields из get_draft. " +
      "serialized_main_actions / serialized_secondary_actions — список {action, fields} целиком; " +
      "conditions — список {<условие>: <значение>} целиком, связи gamification_tasks сохраняются сами; " +
      "locales — объект {код языка: название}, дополняет имеющиеся. Возвращает validation после правки.",
    {
      id: ID_PARAM,
      fields: {
        type: "object",
        description: `Поля для замены. Можно: ${EDITABLE_FIELDS.join(", ")}`,
      },
    },
    ["id", "fields"],
  ),
  tool(
    "create_draft_on_backend",
    "Создать черновик в админке PromoHub в статусе «черновик» (игрокам не виден). Только при пустом validation.errors. " +
      "Предшественников создавай раньше последователей. После создания у задачи будет числовой id.",
    {
      id: ID_PARAM,
      notes: {
        type: "string",
        description:
          "Для проверяющего: что заполнено или исправлено и почему, в чём нет уверенности",
      },
    },
    ["id", "notes"],
  ),
  tool(
    "get_reference",
    "Справочники PromoHub: tags, bonus_groups, task_fields (типы, кампании, приоритеты, события, уведомления), " +
      "conditions (условия таргетинга; с name — формат значения и варианты), actions (типы действий; с name — поля), countries.",
    {
      kind: {
        type: "string",
        enum: ["tags", "bonus_groups", "task_fields", "conditions", "actions", "countries"],
      },
      name: { type: "string", description: "Для conditions и actions — код условия или действия" },
    },
    ["kind"],
  ),
  tool("list_packages", "Пакеты задач в Promo Graphic.", {
    status: {
      type: "string",
      enum: ["ready", "draft", "archived", ""],
      description: "По умолчанию ready; пустая строка — все",
    },
  }),
  tool(
    "open_package",
    "Открыть пакет на канве: новые задачи станут локальными черновиками, уже созданные — подтянутся с бэка.",
    { package_id: { type: "integer" } },
    ["package_id"],
  ),
];

export async function runAgentTool(
  ctx: AgentContext,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case "list_drafts":
      return listDrafts(ctx);
    case "get_draft":
      return getDraft(ctx, args);
    case "update_draft":
      return updateDraft(ctx, args);
    case "create_draft_on_backend":
      return createDraftOnBackend(ctx, args);
    case "get_reference":
      return getReference(ctx, args);
    case "list_packages":
      return listPackages(args);
    case "open_package":
      return openPackage(ctx, args);
    default:
      throw new ToolError(`Нет инструмента ${name}`);
  }
}

/** Строка ленты для человека: что агент сейчас делает. */
export function describeToolCall(name: string, args: Record<string, unknown>): string {
  const state = useChainsStore.getState();
  const draft = () => {
    const id = String(args.id ?? "");
    const title = state.canvas[id]?.name;
    return title ? `«${title}»` : id;
  };
  switch (name) {
    case "list_drafts":
      return "Смотрю черновики на канве";
    case "get_draft":
      return `Изучаю ${draft()}`;
    case "update_draft":
      return `Правлю ${draft()}: ${Object.keys(isRecord(args.fields) ? args.fields : {}).join(", ")}`;
    case "create_draft_on_backend":
      return `Создаю на бэке ${draft()}`;
    case "get_reference":
      return `Справочник: ${String(args.kind ?? "")}${args.name ? ` · ${String(args.name)}` : ""}`;
    case "list_packages":
      return "Смотрю пакеты в графике";
    case "open_package":
      return `Открываю пакет #${String(args.package_id ?? "")}`;
    default:
      return name;
  }
}
