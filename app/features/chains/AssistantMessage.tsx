/**
 * Сообщения ленты консультанта. memo + неизменные ссылки на сообщения из стора: оценка одного
 * ответа или набор вопроса не перерисовывают остальную ленту и не разбирают разметку заново.
 */
import { AlertTriangle, Check, Pencil, ThumbsDown, ThumbsUp } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";

import { AnimatedHeight } from "@/components/animated-height";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/auth/errors";
import { cn } from "@/lib/utils";

import {
  type AnswerFeedback,
  FEEDBACK_REASONS,
  formatFeedback,
  promptVersionLabel,
  rateAssistantAnswer,
} from "./assistant";
import { type ChatMessage, patchMessage, pushMessage } from "./assistant-store";
import { ChatMarkdown } from "./ChatMarkdown";

type FocusNode = (id: string) => void;

function ReasonChip({
  label,
  active,
  onToggle,
}: {
  label: string;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onToggle}
      className={cn(
        "cursor-pointer rounded-full px-2.5 py-1 text-caption ring-1 transition-[color,background-color,box-shadow,transform] duration-150 active:scale-95",
        active
          ? "bg-destructive/15 text-destructive ring-destructive/40"
          : "text-muted-foreground ring-border hover:bg-surface-2 hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

/** Отзыв к дизлайку. Состояние своё: набор текста не трогает ленту. */
function FeedbackForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial?: AnswerFeedback;
  onSubmit: (feedback: AnswerFeedback) => Promise<void>;
  onCancel: () => void;
}) {
  const [reasons, setReasons] = useState<string[]>(initial?.reasons ?? []);
  const [text, setText] = useState(initial?.text ?? "");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const empty = !reasons.length && !text.trim();

  useEffect(() => {
    textRef.current?.focus({ preventScroll: true });
    rootRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);

  const toggle = (reason: string) =>
    setReasons((prev) =>
      prev.includes(reason) ? prev.filter((item) => item !== reason) : [...prev, reason],
    );

  async function submit() {
    if (empty || sending) return;
    setSending(true);
    setError("");
    try {
      await onSubmit({ reasons, text: text.trim() });
    } catch (err) {
      setError(`Не сохранилось: ${errorMessage(err)}`);
      setSending(false);
    }
  }

  return (
    <div ref={rootRef} className="flex animate-fade-in flex-col gap-2.5 pt-2.5">
      <span className="text-caption font-medium text-foreground">Что не так с ответом?</span>
      <div className="flex flex-wrap gap-1.5">
        {FEEDBACK_REASONS.map((reason) => (
          <ReasonChip
            key={reason}
            label={reason}
            active={reasons.includes(reason)}
            onToggle={() => toggle(reason)}
          />
        ))}
      </div>
      <Textarea
        ref={textRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void submit();
          }
          if (e.key === "Escape") onCancel();
        }}
        maxLength={4000}
        placeholder="Как должно было быть? Необязательно"
        aria-label="Комментарий к ответу"
        className="min-h-14 text-subhead"
      />
      {error ? <p className="text-caption text-destructive">{error}</p> : null}
      <div className="flex items-center justify-end gap-2">
        <span className="mr-auto text-caption text-muted-foreground">Ctrl+Enter — отправить</span>
        <Button variant="ghost" size="sm" disabled={sending} onClick={onCancel}>
          Пропустить
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={empty || sending}
          onClick={() => void submit()}
          className="transition-transform active:scale-95"
        >
          {sending ? "Сохраняю…" : "Отправить"}
        </Button>
      </div>
    </div>
  );
}

function FeedbackSummary({ feedback, onEdit }: { feedback: AnswerFeedback; onEdit: () => void }) {
  const parts = [...feedback.reasons, ...(feedback.text ? [`«${feedback.text}»`] : [])];
  return (
    <div className="flex animate-fade-in items-start gap-1.5 pt-2 text-caption text-muted-foreground">
      <Check className="mt-px size-3.5 shrink-0 text-success" />
      <span className="min-w-0 flex-1">
        Отзыв сохранён: <span className="text-foreground/80">{parts.join(" · ")}</span>
      </span>
      <button
        type="button"
        onClick={onEdit}
        className="flex shrink-0 cursor-pointer items-center gap-1 transition-colors hover:text-foreground"
      >
        <Pencil className="size-3" /> изменить
      </button>
    </div>
  );
}

function RateButton({
  active,
  tone,
  label,
  onClick,
  children,
}: {
  active: boolean;
  tone: "success" | "destructive";
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className={cn(
        "transition-[color,background-color,transform] duration-150 active:scale-90",
        active && (tone === "success" ? "text-success" : "text-destructive"),
      )}
    >
      {children}
    </Button>
  );
}

const AssistantAnswer = memo(function AssistantAnswer({
  message,
  onFocusNode,
}: {
  message: ChatMessage;
  onFocusNode: FocusNode;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const { id, logId, rating, feedback } = message;

  async function rate(next: 1 | -1) {
    if (logId == null) return;
    // Повторный дизлайк — только открыть отзыв: оценка и комментарий уже на бэке.
    if (next === rating) {
      if (next === -1) setFormOpen((open) => !open);
      return;
    }
    // Оптимистично: интерфейс реагирует сразу, при ошибке оценка откатывается.
    patchMessage(id, { rating: next, feedback: undefined });
    setFormOpen(next === -1);
    try {
      await rateAssistantAnswer(logId, next);
    } catch (err) {
      patchMessage(id, { rating, feedback });
      setFormOpen(false);
      pushMessage({ role: "error", content: `Оценка не сохранена: ${errorMessage(err)}` });
    }
  }

  async function sendFeedback(next: AnswerFeedback) {
    await rateAssistantAnswer(logId!, -1, formatFeedback(next));
    patchMessage(id, { feedback: next });
    setFormOpen(false);
  }

  return (
    <div className="flex animate-message-in flex-col gap-2 rounded-lg rounded-bl-sm bg-surface-2/50 px-3 py-2.5 ring-1 ring-border">
      <ChatMarkdown text={message.content} onFocusNode={onFocusNode} />
      {message.unknownRefs?.length ? (
        <p className="flex items-start gap-1.5 text-caption text-destructive">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          Упомянуты задачи, которых нет в данных канвы:{" "}
          {message.unknownRefs.map((ref) => `#${ref}`).join(", ")} — проверьте ответ.
        </p>
      ) : null}
      <div className="-mx-1 -mb-1 border-t border-border/60 px-1 pt-1">
        <div className="-mx-1 flex items-center justify-between gap-2">
          {logId != null ? (
            <div className="flex items-center gap-1">
              <RateButton
                active={rating === 1}
                tone="success"
                label="Ответ по делу"
                onClick={() => void rate(1)}
              >
                <ThumbsUp />
              </RateButton>
              <RateButton
                active={rating === -1}
                tone="destructive"
                label="Ответ неверный — оставить отзыв"
                onClick={() => void rate(-1)}
              >
                <ThumbsDown />
              </RateButton>
            </div>
          ) : (
            <span />
          )}
          <span className="pr-1 text-caption text-muted-foreground">
            {promptVersionLabel(message.promptVersionId ?? null)}
          </span>
        </div>
        <AnimatedHeight>
          {formOpen ? (
            <FeedbackForm
              initial={feedback}
              onSubmit={sendFeedback}
              onCancel={() => setFormOpen(false)}
            />
          ) : rating === -1 && feedback ? (
            <FeedbackSummary feedback={feedback} onEdit={() => setFormOpen(true)} />
          ) : null}
        </AnimatedHeight>
      </div>
    </div>
  );
});

export const AssistantMessage = memo(function AssistantMessage({
  message,
  onFocusNode,
}: {
  message: ChatMessage;
  onFocusNode: FocusNode;
}) {
  switch (message.role) {
    case "user":
      return (
        <p className="ml-auto max-w-[85%] animate-message-in rounded-lg rounded-br-sm bg-primary/15 px-3 py-2 text-subhead whitespace-pre-wrap text-foreground">
          {message.content}
        </p>
      );
    case "error":
      return (
        <p className="flex animate-message-in items-start gap-1.5 rounded-lg bg-destructive/10 px-3 py-2 text-subhead whitespace-pre-wrap text-destructive">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {message.content}
        </p>
      );
    case "note":
      return (
        <p className="animate-message-in border-y border-border py-1.5 text-center text-caption text-muted-foreground">
          {message.content}
        </p>
      );
    case "assistant":
      return <AssistantAnswer message={message} onFocusNode={onFocusNode} />;
  }
});
