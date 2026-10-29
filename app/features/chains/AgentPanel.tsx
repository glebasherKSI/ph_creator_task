/**
 * Панель агента: задание словами → агент смотрит черновики, правит их на канве и создаёт на бэке
 * в статусе «черновик». Лента показывает каждое действие; созданные задачи — сводкой внизу.
 */
import {
  AlertTriangle,
  Bot,
  Check,
  CircleStop,
  Loader2,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/features/auth/AuthModal";
import { cn } from "@/lib/utils";

import { type AgentEntry, runAgent, useAgentPanel } from "./agent-run";
import { ChatMarkdown } from "./ChatMarkdown";
import { useChainsStore } from "./store";

export { useAgentPanel } from "./agent-run";

type FocusNode = (id: string) => void;

const DEFAULT_GOAL =
  "Проверь локальные черновики на канве, доведи их по брифу из графика и создай на бэке в статусе черновик.";

const Entry = memo(function Entry({
  entry,
  onFocusNode,
}: {
  entry: AgentEntry;
  onFocusNode: FocusNode;
}) {
  switch (entry.kind) {
    case "goal":
      return (
        <p className="ml-auto max-w-[85%] animate-message-in rounded-lg rounded-br-sm bg-primary/15 px-3 py-2 text-subhead whitespace-pre-wrap text-foreground">
          {entry.text}
        </p>
      );
    case "thought":
      return (
        <p className="animate-message-in px-1 text-caption whitespace-pre-wrap text-muted-foreground">
          {entry.text}
        </p>
      );
    case "answer":
      return (
        <div className="animate-message-in rounded-lg rounded-bl-sm bg-surface-2/50 px-3 py-2.5 ring-1 ring-border">
          <ChatMarkdown text={entry.text} onFocusNode={onFocusNode} />
        </div>
      );
    case "error":
      return (
        <p className="flex animate-message-in items-start gap-1.5 rounded-lg bg-destructive/10 px-3 py-2 text-subhead whitespace-pre-wrap text-destructive">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {entry.text}
        </p>
      );
    case "note":
      return (
        <p className="animate-message-in border-y border-border py-1.5 text-center text-caption text-muted-foreground">
          {entry.text}
        </p>
      );
    case "tool":
      return (
        <div className="flex animate-message-in items-start gap-2 px-1 text-caption">
          {entry.status === "running" ? (
            <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-muted-foreground" />
          ) : entry.status === "ok" ? (
            <Check className="mt-0.5 size-3.5 shrink-0 text-success" />
          ) : (
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
          )}
          <span className="min-w-0 flex-1">
            {entry.taskId ? (
              <button
                type="button"
                onClick={() => onFocusNode(entry.taskId!)}
                className="cursor-pointer text-left text-foreground/90 hover:underline"
                title="Показать на канве"
              >
                {entry.text}
              </button>
            ) : (
              <span className="text-foreground/90">{entry.text}</span>
            )}
            {entry.detail ? (
              <span
                className={cn(
                  "block",
                  entry.status === "error" ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {entry.detail}
              </span>
            ) : null}
          </span>
        </div>
      );
  }
});

function CreatedSummary({ onFocusNode }: { onFocusNode: FocusNode }) {
  const created = useAgentPanel((s) => s.created);
  const running = useAgentPanel((s) => s.running);
  if (running || !created.length) return null;
  return (
    <div className="flex animate-message-in flex-col gap-1.5 rounded-lg bg-success/10 px-3 py-2.5 ring-1 ring-success/30">
      <span className="text-caption font-semibold text-success">
        Создано на бэке в статусе «черновик»: {created.length}
      </span>
      <ul className="flex flex-col gap-0.5">
        {created.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onFocusNode(item.id)}
              className="cursor-pointer text-left text-subhead hover:underline"
            >
              <span className="text-muted-foreground tabular-nums">#{item.id}</span> {item.name}
            </button>
          </li>
        ))}
      </ul>
      <span className="text-caption text-muted-foreground">
        Перед запуском их нужно проверить: агент мог ошибиться.
      </span>
    </div>
  );
}

function Thinking() {
  const running = useAgentPanel((s) => s.running);
  const busyTool = useAgentPanel((s) =>
    s.entries.some((e) => e.kind === "tool" && e.status === "running"),
  );
  if (!running || busyTool) return null;
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
      Думаю
    </div>
  );
}

function Feed({ onFocusNode }: { onFocusNode: FocusNode }) {
  const entries = useAgentPanel((s) => s.entries);
  const running = useAgentPanel((s) => s.running);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [entries.length, running]);

  return (
    <div role="log" className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-3">
      {!entries.length ? (
        <div className="flex animate-fade-in flex-col gap-2 text-subhead text-muted-foreground">
          <p>
            Агент делает то же, что вы: открывает пакет из графика, сверяет черновики с брифом,
            заполняет поля и создаёт задачи на бэке в статусе «черновик». Игрокам они не видны.
          </p>
          <p>
            Работает только с локальными карточками (пунктирная рамка). Задачи, которые уже есть на
            бэке, не трогает. Выделите черновики, чтобы ограничить его ими.
          </p>
        </div>
      ) : null}
      {entries.map((entry) => (
        <Entry key={entry.id} entry={entry} onFocusNode={onFocusNode} />
      ))}
      <Thinking />
      <CreatedSummary onFocusNode={onFocusNode} />
      <div ref={endRef} />
    </div>
  );
}

function Composer() {
  const running = useAgentPanel((s) => s.running);
  const stopRequested = useAgentPanel((s) => s.stopRequested);
  const drafts = useChainsStore(
    (s) => Object.values(s.canvas).filter((card) => card.localOnly).length,
  );
  const selectedDrafts = useChainsStore(
    (s) => s.selectedIds.filter((id) => s.canvas[id]?.localOnly).length,
  );
  const auth = useAuth();
  const [goal, setGoal] = useState("");

  function start(text: string) {
    if (!text.trim() || running) return;
    setGoal("");
    void runAgent({
      goal: text,
      ensureAuthenticated: (domain) =>
        auth.ensureAuthenticated(domain, {
          message: `Агенту нужен вход в ${domain}`,
        }),
    });
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border px-4 py-3">
      <Textarea
        value={goal}
        disabled={running}
        onChange={(e) => setGoal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            start(goal);
          }
        }}
        placeholder="Например: открой пакет «Хэллоуин» и создай черновики"
        aria-label="Задание агенту"
        className="min-h-16"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-caption text-muted-foreground tabular-nums">
          Черновиков на канве: {drafts}
          {selectedDrafts ? ` · выделено ${selectedDrafts}` : ""}
        </span>
        {running ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={stopRequested}
            onClick={() => useAgentPanel.getState().requestStop()}
            title="Агент остановится после текущего шага"
          >
            <CircleStop /> {stopRequested ? "Останавливаю…" : "Стоп"}
          </Button>
        ) : goal.trim() ? (
          <Button
            variant="primary"
            size="sm"
            onClick={() => start(goal)}
            className="transition-transform active:scale-95"
          >
            <Bot /> Запустить
          </Button>
        ) : (
          <Button
            variant="primary"
            size="sm"
            disabled={!drafts}
            onClick={() => start(DEFAULT_GOAL)}
            title={drafts ? DEFAULT_GOAL : "На канве нет локальных черновиков — откройте пакет"}
            className="transition-transform active:scale-95"
          >
            <Sparkles /> Создать черновики
          </Button>
        )}
      </div>
    </div>
  );
}

export function AgentPanel({ onFocusNode }: { onFocusNode: FocusNode }) {
  const open = useAgentPanel((s) => s.open);
  const shown = useAgentPanel((s) => s.shown);
  const running = useAgentPanel((s) => s.running);
  const hasEntries = useAgentPanel((s) => s.entries.length > 0);
  const domain = useChainsStore((s) => s.domain);

  // onFocusNode со страницы меняется при каждом её рендере — ленте отдаём стабильную обёртку.
  const focusRef = useRef(onFocusNode);
  useEffect(() => {
    focusRef.current = onFocusNode;
  });
  const focusNode = useCallback((id: string) => focusRef.current(id), []);

  // Лента относится к канве домена — при смене домена теряет смысл (идущий запуск не трогаем).
  useEffect(() => {
    useAgentPanel.getState().reset();
  }, [domain]);

  if (!shown) return null;

  return (
    <aside
      className={cn(
        "h-full min-h-0 w-(--panel-width) overflow-hidden rounded-lg bg-surface [--panel-width:24rem]",
        open ? "animate-panel-in" : "animate-panel-out",
      )}
      aria-label="Агент"
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget && !open) useAgentPanel.getState().exited();
      }}
    >
      <div
        className={cn(
          "flex h-full w-(--panel-width) flex-col",
          open ? "animate-panel-content-in" : "animate-panel-content-out",
        )}
      >
        <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-headline">Агент</h2>
            <p className="text-caption text-muted-foreground">
              Создаёт задачи из черновиков на бэке в статусе «черновик»
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Очистить ленту"
              title="Очистить ленту"
              disabled={!hasEntries || running}
              onClick={() => useAgentPanel.getState().reset()}
            >
              <RotateCcw />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Закрыть панель"
              title={running ? "Агент продолжит работу в фоне" : "Закрыть панель"}
              onClick={() => useAgentPanel.getState().close()}
            >
              <X />
            </Button>
          </div>
        </div>

        <Feed onFocusNode={focusNode} />
        <Composer />
      </div>
    </aside>
  );
}
