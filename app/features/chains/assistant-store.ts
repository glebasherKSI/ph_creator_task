/** Состояние чата консультанта и отправка вопроса — без UI, чтобы части панели не тянули друг друга. */
import { create } from "zustand";

import { errorMessage } from "@/lib/auth/errors";
import { loadConditionsSchema } from "@/lib/conditions-schema";
import { loadTaskMeta } from "@/lib/meta";

import {
  type AnswerFeedback,
  type AssistantTurn,
  CONTEXT_LIMIT,
  askCanvasAssistant,
  buildCanvasContext,
  contextSize,
} from "./assistant";
import { useChainsStore } from "./store";

export interface ChatMessage {
  id: number;
  /** note — служебная отметка в ленте (смена инструкций), модели не уходит. */
  role: "user" | "assistant" | "error" | "note";
  content: string;
  unknownRefs?: string[];
  logId?: number | null;
  rating?: 1 | -1;
  /** Отзыв к дизлайку, уже сохранённый на бэке. */
  feedback?: AnswerFeedback;
  promptVersionId?: number | null;
}

interface AssistantState {
  /** Панель должна быть открыта. */
  open: boolean;
  /** Панель в DOM: после закрытия остаётся, пока не доиграет анимация ухода. */
  shown: boolean;
  messages: ChatMessage[];
  pending: boolean;
  toggle: () => void;
  close: () => void;
  /** Анимация ухода закончилась — панель можно убрать из DOM. */
  exited: () => void;
  reset: () => void;
}

let nextId = 1;

export const useAssistantPanel = create<AssistantState>((set) => ({
  open: false,
  shown: false,
  messages: [],
  pending: false,
  toggle: () => set((s) => (s.open ? { open: false } : { open: true, shown: true })),
  close: () => set({ open: false }),
  exited: () => set((s) => (s.open ? {} : { shown: false })),
  reset: () => set({ messages: [] }),
}));

export function pushMessage(message: Omit<ChatMessage, "id">) {
  useAssistantPanel.setState((s) => ({ messages: [...s.messages, { ...message, id: nextId++ }] }));
}

/** Меняет одно сообщение; остальные сохраняют ссылки — memo-сообщения не перерисовываются. */
export function patchMessage(id: number, patch: Partial<ChatMessage>) {
  useAssistantPanel.setState((s) => ({
    messages: s.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)),
  }));
}

export async function askQuestion(question: string): Promise<void> {
  if (!question || useAssistantPanel.getState().pending) return;
  const store = useChainsStore.getState();
  if (!Object.keys(store.canvas).length) {
    pushMessage({
      role: "error",
      content: "На канве нет задач — консультанту не на что смотреть.",
    });
    return;
  }
  const history: AssistantTurn[] = useAssistantPanel
    .getState()
    .messages.filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as AssistantTurn["role"], content: m.content }));
  pushMessage({ role: "user", content: question });
  useAssistantPanel.setState({ pending: true });
  try {
    // Справочники — только ради подписей кодов; без них снимок всё равно точен.
    const [meta, conditionsSchema] = await Promise.all([
      loadTaskMeta(store.domain).catch(() => null),
      loadConditionsSchema(store.domain).catch(() => null),
    ]);
    const state = useChainsStore.getState();
    const context = buildCanvasContext(state, state.selectedIds, { meta, conditionsSchema });
    if (contextSize(context) > CONTEXT_LIMIT) {
      throw new Error("Канва слишком большая для консультанта — выделите задачи, о которых вопрос");
    }
    const reply = await askCanvasAssistant({ question, history, context, domain: store.domain });
    pushMessage({
      role: "assistant",
      content: reply.answer,
      unknownRefs: reply.unknown_refs,
      logId: reply.log_id,
      promptVersionId: reply.prompt_version_id,
    });
  } catch (err) {
    pushMessage({ role: "error", content: errorMessage(err) });
  } finally {
    useAssistantPanel.setState({ pending: false });
  }
}
