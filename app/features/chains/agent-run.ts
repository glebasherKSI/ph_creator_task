/**
 * Запуск агента: шаг модели → инструменты в расширении → следующий шаг, пока модель не ответит текстом.
 * Лента для панели — без UI, чтобы панель и цикл не тянули друг друга.
 */
import { create } from "zustand";

import { loadCountriesData } from "@/features/task-form/country-selector";
import { errorMessage } from "@/lib/auth/errors";
import { loadConditionsSchema } from "@/lib/conditions-schema";
import { loadTaskMeta } from "@/lib/meta";

import { type AgentMessage, type AgentRunStatus, agentStep, finishAgentRun } from "./agent-api";
import {
  type AgentContext,
  type CreatedByAgent,
  AGENT_TOOLS,
  describeToolCall,
  runAgentTool,
} from "./agent-tools";
import { useChainsStore } from "./store";

/** Предел шагов: пакет из 10–15 задач укладывается с запасом, зацикливание — нет. */
export const MAX_STEPS = 80;
/** Ответ инструмента в историю — справочник условий не должен съесть окно модели. */
const TOOL_RESULT_LIMIT = 40_000;

export type AgentEntry =
  | { id: number; kind: "goal" | "thought" | "answer" | "error" | "note"; text: string }
  | {
      id: number;
      kind: "tool";
      text: string;
      status: "running" | "ok" | "error";
      detail?: string;
      /** Задача, на которую можно перейти из ленты (создана или правится). */
      taskId?: string;
    };

type NewEntry = AgentEntry extends infer E ? (E extends AgentEntry ? Omit<E, "id"> : never) : never;

interface AgentPanelState {
  open: boolean;
  /** Панель в DOM: после закрытия остаётся, пока не доиграет анимация ухода. */
  shown: boolean;
  running: boolean;
  stopRequested: boolean;
  entries: AgentEntry[];
  /** Созданные за последний запуск — сводка под лентой. */
  created: CreatedByAgent[];
  toggle: () => void;
  close: () => void;
  exited: () => void;
  reset: () => void;
  requestStop: () => void;
}

let nextId = 1;

export const useAgentPanel = create<AgentPanelState>((set) => ({
  open: false,
  shown: false,
  running: false,
  stopRequested: false,
  entries: [],
  created: [],
  toggle: () => set((s) => (s.open ? { open: false } : { open: true, shown: true })),
  close: () => set({ open: false }),
  exited: () => set((s) => (s.open ? {} : { shown: false })),
  reset: () => set((s) => (s.running ? {} : { entries: [], created: [] })),
  requestStop: () => set((s) => (s.running ? { stopRequested: true } : {})),
}));

function push(entry: NewEntry): number {
  const id = nextId++;
  useAgentPanel.setState((s) => ({ entries: [...s.entries, { ...entry, id } as AgentEntry] }));
  return id;
}

function patchTool(id: number, patch: Partial<Extract<AgentEntry, { kind: "tool" }>>) {
  useAgentPanel.setState((s) => ({
    entries: s.entries.map((e) => (e.id === id && e.kind === "tool" ? { ...e, ...patch } : e)),
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function parseToolArgs(raw: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw || "{}");
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

export function toolResultText(result: unknown): string {
  const text = JSON.stringify(result ?? null);
  return text.length > TOOL_RESULT_LIMIT
    ? `${text.slice(0, TOOL_RESULT_LIMIT)}… [обрезано: уточните запрос]`
    : text;
}

/** Итог вызова для ленты: успех, отказ инструмента или ошибка схемы. */
export function toolOutcome(
  name: string,
  result: unknown,
): Pick<Extract<AgentEntry, { kind: "tool" }>, "status" | "detail" | "taskId"> {
  if (!isRecord(result)) return { status: "ok" };
  if (Array.isArray(result.errors) && result.errors.length && result.ok === false) {
    return { status: "error", detail: result.errors.map(String).join("; ") };
  }
  if (name === "create_draft_on_backend" && result.ph_backend_id) {
    const id = String(result.ph_backend_id);
    return { status: "ok", detail: `Создана #${id} (черновик)`, taskId: id };
  }
  if (typeof result.warning === "string") return { status: "error", detail: result.warning };
  if (Array.isArray(result.rejected) && result.rejected.length) {
    return { status: "error", detail: result.rejected.map(String).join("; ") };
  }
  return { status: "ok" };
}

function firstMessage(goal: string, ctx: AgentContext): string {
  const scope = ctx.scope
    ? `только выделенные черновики: ${[...ctx.scope].join(", ")}`
    : "все локальные черновики на канве";
  return [
    `Задача от пользователя: ${goal}`,
    `Админка PromoHub: ${ctx.domain}. Сегодня ${new Date().toISOString().slice(0, 10)}.`,
    `Область работы: ${scope}.`,
  ].join("\n");
}

function newRunId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function runAgent({
  goal,
  ensureAuthenticated,
}: {
  goal: string;
  ensureAuthenticated: AgentContext["ensureAuthenticated"];
}): Promise<void> {
  const text = goal.trim();
  if (!text || useAgentPanel.getState().running) return;
  const store = useChainsStore.getState();
  const domain = store.domain;
  push({ kind: "goal", text });
  if (!domain) {
    push({ kind: "error", text: "Не выбран домен админки PromoHub" });
    return;
  }

  const selectedDrafts = store.selectedIds.filter((id) => store.canvas[id]?.localOnly);
  const runId = newRunId();
  useAgentPanel.setState({ running: true, stopRequested: false, created: [] });
  if (selectedDrafts.length) {
    push({
      kind: "note",
      text: `Работаю только с выделенными черновиками: ${selectedDrafts.length}`,
    });
  }

  let status: AgentRunStatus = "failed";
  let summary: string | null = null;
  let error: string | null = null;
  try {
    // Справочники — для подстановок (тег, бонусы) и ответов get_reference; без них агент скажет, чего нет.
    const [meta, conditionsSchema, countries] = await Promise.all([
      loadTaskMeta(domain).catch(() => null),
      loadConditionsSchema(domain).catch(() => null),
      loadCountriesData(domain).catch(() => null),
    ]);
    const ctx: AgentContext = {
      runId,
      domain,
      refs: { meta, conditionsSchema, countries },
      scope: selectedDrafts.length ? new Set(selectedDrafts) : null,
      ensureAuthenticated,
      onCreated: (entry) => useAgentPanel.setState((s) => ({ created: [...s.created, entry] })),
    };
    const messages: AgentMessage[] = [{ role: "user", content: firstMessage(text, ctx) }];

    for (let step = 0; ; step++) {
      if (useAgentPanel.getState().stopRequested) {
        status = "stopped";
        push({ kind: "note", text: "Остановлено по запросу" });
        break;
      }
      if (step >= MAX_STEPS) {
        error = `Агент не уложился в ${MAX_STEPS} шагов`;
        push({ kind: "error", text: `${error} — остановлен` });
        break;
      }
      const reply = await agentStep({
        run_id: runId,
        domain,
        goal: text,
        messages: [...messages],
        tools: AGENT_TOOLS,
      });
      messages.push(reply.message);
      const calls = reply.message.tool_calls ?? [];
      if (!calls.length) {
        summary = reply.message.content ?? "";
        push({ kind: "answer", text: summary || "Готово" });
        status = "done";
        break;
      }
      if (reply.message.content) push({ kind: "thought", text: reply.message.content });

      // На каждый вызов — ответ в историю, иначе следующий шаг модель не примет.
      for (const call of calls) {
        const name = call.function.name;
        const args = parseToolArgs(call.function.arguments);
        const entryId = push({
          kind: "tool",
          text: describeToolCall(name, args ?? {}),
          status: "running",
          ...(typeof args?.id === "string" ? { taskId: args.id } : {}),
        });
        let result: unknown;
        if (!args) {
          result = { error: "Аргументы — не объект JSON" };
          patchTool(entryId, { status: "error", detail: "Модель прислала неверные аргументы" });
        } else {
          try {
            result = await runAgentTool(ctx, name, args);
            const outcome = toolOutcome(name, result);
            patchTool(entryId, {
              ...outcome,
              // Черновик после создания получил настоящий id — ссылка ведёт на него.
              taskId: outcome.taskId ?? (typeof args.id === "string" ? args.id : undefined),
            });
          } catch (err) {
            result = { error: errorMessage(err) };
            patchTool(entryId, { status: "error", detail: errorMessage(err) });
          }
        }
        messages.push({ role: "tool", tool_call_id: call.id, content: toolResultText(result) });
      }
    }
  } catch (err) {
    error = errorMessage(err);
    push({ kind: "error", text: error });
  } finally {
    useAgentPanel.setState({ running: false, stopRequested: false });
    void finishAgentRun(runId, status, summary, error);
  }
}
