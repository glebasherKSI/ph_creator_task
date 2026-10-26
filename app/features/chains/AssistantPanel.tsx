/**
 * Панель консультанта: вопросы о задачах на канве. Каждый вопрос уходит со свежим снимком канвы
 * (с несохранёнными связями), ответ проверяется на ссылки на задачи, которых в снимке нет.
 * Поле ввода и лента — отдельные компоненты: набор текста не перерисовывает сообщения.
 */
import { RotateCcw, ScrollText, Send, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { promptVersionLabel } from "./assistant";
import { askQuestion, pushMessage, useAssistantPanel } from "./assistant-store";
import { AssistantMessage } from "./AssistantMessage";
import { AssistantPromptDialog } from "./AssistantPromptDialog";
import { useChainsStore } from "./store";

export { useAssistantPanel } from "./assistant-store";

function TypingIndicator() {
  return (
    <div
      className="flex animate-message-in items-center gap-2 self-start rounded-lg bg-surface-2/60 px-3 py-2 text-caption text-muted-foreground"
      role="status"
    >
      <span className="flex gap-1" aria-hidden>
        {[0, 160, 320].map((delay) => (
          <span
            key={delay}
            className="size-1.5 animate-typing-dot rounded-full bg-muted-foreground"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </span>
      Смотрю задачи
    </div>
  );
}

function MessageList({ onFocusNode }: { onFocusNode: (id: string) => void }) {
  const messages = useAssistantPanel((s) => s.messages);
  const pending = useAssistantPanel((s) => s.pending);
  const endRef = useRef<HTMLDivElement>(null);

  // Вниз — только когда добавилось сообщение или ждём ответ; оценка старого ответа ленту не дёргает.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages.length, pending]);

  return (
    <div role="log" className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
      {!messages.length ? (
        <p className="animate-fade-in text-subhead text-muted-foreground">
          Спросите о задачах на канве: что требуется для выполнения, какие связи, чем отличаются
          задачи, что не сохранено. Выделенные карточки — «эти задачи».
        </p>
      ) : null}
      {messages.map((m) => (
        <AssistantMessage key={m.id} message={m} onFocusNode={onFocusNode} />
      ))}
      {pending ? <TypingIndicator /> : null}
      <div ref={endRef} />
    </div>
  );
}

function Composer() {
  const pending = useAssistantPanel((s) => s.pending);
  const canvasSize = useChainsStore((s) => Object.keys(s.canvas).length);
  const selectedCount = useChainsStore((s) => s.selectedIds.length);
  const [draft, setDraft] = useState("");

  function send() {
    const question = draft.trim();
    if (!question || pending) return;
    setDraft("");
    void askQuestion(question);
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border px-4 py-3">
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
        placeholder="Вопрос по задачам на канве…"
        aria-label="Вопрос консультанту"
        className="min-h-16"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-caption text-muted-foreground tabular-nums">
          Видит {canvasSize} задач
          {selectedCount ? ` · в фокусе ${selectedCount}` : ""}
        </span>
        <Button
          variant="primary"
          size="sm"
          disabled={!draft.trim() || pending}
          onClick={send}
          className="transition-transform active:scale-95"
        >
          <Send /> Спросить
        </Button>
      </div>
    </div>
  );
}

export function AssistantPanel({ onFocusNode }: { onFocusNode: (id: string) => void }) {
  const open = useAssistantPanel((s) => s.open);
  const shown = useAssistantPanel((s) => s.shown);
  const hasMessages = useAssistantPanel((s) => s.messages.length > 0);
  const pending = useAssistantPanel((s) => s.pending);
  const domain = useChainsStore((s) => s.domain);
  const [promptOpen, setPromptOpen] = useState(false);

  // onFocusNode со страницы меняется при каждом её рендере — сообщениям отдаём стабильную обёртку,
  // иначе memo сообщений бесполезен.
  const focusRef = useRef(onFocusNode);
  useEffect(() => {
    focusRef.current = onFocusNode;
  });
  const focusNode = useCallback((id: string) => focusRef.current(id), []);

  // Ответы относятся к канве домена — при смене домена история теряет смысл.
  // Тело в скобках: эффект не должен ничего возвращать, иначе React примет результат за cleanup.
  useEffect(() => {
    useAssistantPanel.getState().reset();
  }, [domain]);

  if (!shown) return null;

  return (
    <aside
      className={cn(
        "h-full min-h-0 w-(--panel-width) overflow-hidden rounded-lg bg-surface [--panel-width:24rem]",
        open ? "animate-panel-in" : "animate-panel-out",
      )}
      aria-label="Консультант по задачам"
      onAnimationEnd={(e) => {
        // Анимации сообщений всплывают сюда же — реагируем только на свою.
        if (e.target === e.currentTarget && !open) useAssistantPanel.getState().exited();
      }}
    >
      {/* Содержимое фиксированной ширины: при анимации ширины текст не переносится заново.
          Сдвигается оно, а не панель, — сдвиг обрезается панелью и не выходит за окно. */}
      <div
        className={cn(
          "flex h-full w-(--panel-width) flex-col",
          open ? "animate-panel-content-in" : "animate-panel-content-out",
        )}
      >
        <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-headline">Консультант</h2>
            <p className="text-caption text-muted-foreground">
              Отвечает только по задачам на канве, ничего не меняет
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Инструкции консультанта"
              title="Инструкции консультанта"
              onClick={() => setPromptOpen(true)}
            >
              <ScrollText />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Очистить диалог"
              title="Очистить диалог"
              disabled={!hasMessages || pending}
              onClick={() => useAssistantPanel.getState().reset()}
            >
              <RotateCcw />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Закрыть панель"
              onClick={() => useAssistantPanel.getState().close()}
            >
              <X />
            </Button>
          </div>
        </div>

        <MessageList onFocusNode={focusNode} />
        <Composer />

        {promptOpen ? (
          <AssistantPromptDialog
            onClose={() => setPromptOpen(false)}
            onSaved={(version) =>
              pushMessage({
                role: "note",
                content: `Инструкции обновлены — ${promptVersionLabel(version.id)}${
                  version.comment ? ` («${version.comment}»)` : ""
                }. Следующие ответы — по ним.`,
              })
            }
          />
        ) : null}
      </div>
    </aside>
  );
}
