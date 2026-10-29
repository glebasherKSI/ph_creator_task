/**
 * Шаги агента через бэк Promo Graphic: он добавляет инструкции и передаёт историю в OpenRouter.
 * Формат сообщений — OpenAI chat completions с tools; инструменты выполняет расширение.
 */
import { graphicApiPost, graphicApiPut } from "@/lib/graphic-api";

const STEP_TIMEOUT_MS = 150_000;

export interface AgentToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type AgentMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: AgentToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface AgentToolDef {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface AgentStepReply {
  message: Extract<AgentMessage, { role: "assistant" }>;
  model: string;
  finish_reason: string | null;
}

export async function agentStep(request: {
  run_id: string;
  domain: string;
  goal: string;
  messages: AgentMessage[];
  tools: AgentToolDef[];
}): Promise<AgentStepReply> {
  const data = (await graphicApiPost(
    "/api/promohub-planner/agent/step",
    request,
    STEP_TIMEOUT_MS,
  )) as Partial<AgentStepReply> | null;
  if (data?.message?.role !== "assistant") throw new Error("Агент не вернул ответ");
  return {
    message: {
      role: "assistant",
      content: data.message.content ?? null,
      ...(data.message.tool_calls?.length ? { tool_calls: data.message.tool_calls } : {}),
    },
    model: String(data.model ?? ""),
    finish_reason: data.finish_reason ?? null,
  };
}

export type AgentRunStatus = "done" | "stopped" | "failed";

/** Итог запуска в журнал графика; сбой записи работу не прерывает. */
export async function finishAgentRun(
  runId: string,
  status: AgentRunStatus,
  summary: string | null,
  error: string | null = null,
): Promise<void> {
  try {
    await graphicApiPut(`/api/promohub-planner/agent/runs/${encodeURIComponent(runId)}`, {
      status,
      summary,
      error,
    });
  } catch (err) {
    console.warn("[agent] итог запуска не записан:", err);
  }
}
