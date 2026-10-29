/**
 * Вкладка «Ревью»: задачи, которые создал агент. Слева очередь, справа задача по секциям формы —
 * бриф из графика рядом с полями; что человек поправил после агента, видно сразу. Правка — тут же
 * формой задачи, вердикт с причинами и уроком для агента — внизу. J/K — по очереди.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Check,
  GraduationCap,
  LayoutGrid,
  Loader2,
  Pencil,
  RefreshCw,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/checkbox";
import { Segmented } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/features/auth/AuthModal";
import type { BulkContext } from "@/features/chains/bulk-edit";
import { ChatMarkdown } from "@/features/chains/ChatMarkdown";
import { useChainsStore } from "@/features/chains/store";
import { useTaskMeta } from "@/features/task-form/hooks";
import { TaskForm } from "@/features/task-form/TaskForm";
import { errorMessage } from "@/lib/auth/errors";
import { fetchTask, updateTask } from "@/lib/task-api";
import { logTaskEvent } from "@/lib/task-events";
import type { TaskLike, TaskPayloadEnvelope } from "@/lib/types";
import { cn } from "@/lib/utils";

import { LessonsDialog } from "./LessonsDialog";
import {
  type AgentReviewItem,
  type ReviewDiffEntry,
  type ReviewFilter,
  createAgentLesson,
  listAgentReviews,
  saveAgentReview,
} from "./review-api";
import {
  type ReviewSection,
  REVIEW_REASONS,
  VERDICT_LABELS,
  agentTaskOf,
  briefOf,
  buildReviewRows,
  isTargetingRow,
  lessonDraft,
  reviewDiff,
  reviewSections,
  verdictStatus,
} from "./review";

const EMPTY_VALUES = new Set(["—", "нет"]);
const NO_ITEMS: AgentReviewItem[] = [];

export function reviewQueryKey(domain: string, filter?: ReviewFilter) {
  return filter ? ["agent-reviews", domain, filter] : ["agent-reviews", domain];
}

/** Сколько задач агента ждут проверки — для подписи вкладки. */
export function usePendingReviews(domain: string): number {
  const query = useQuery({
    queryKey: reviewQueryKey(domain, "pending"),
    queryFn: () => listAgentReviews(domain, "pending"),
    enabled: !!domain,
    staleTime: 30_000,
    retry: false,
  });
  return query.data?.counts.pending ?? 0;
}

function formatWhen(value: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(value ?? "");
  return m ? `${m[3]}.${m[2]} ${m[4]}:${m[5]}` : "";
}

function itemName(item: AgentReviewItem): string {
  return String(agentTaskOf(item)?.name ?? item.draft?.name ?? `#${item.ph_backend_id ?? "?"}`);
}

function StatusBadge({ item }: { item: AgentReviewItem }) {
  if (!item.review_status) return <Badge variant="accent-outline">ждёт</Badge>;
  const variant =
    item.review_status === "rejected"
      ? "destructive"
      : item.review_status === "fixed"
        ? "neutral"
        : "success";
  return <Badge variant={variant}>{VERDICT_LABELS[item.review_status]}</Badge>;
}

// ---------------------------------------------------------------------------
// Очередь
// ---------------------------------------------------------------------------

function Queue({
  items,
  selectedId,
  onSelect,
}: {
  items: AgentReviewItem[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  return (
    <ul className="flex flex-col gap-1 p-2" role="listbox" aria-label="Задачи агента">
      {items.map((item) => {
        const active = item.id === selectedId;
        return (
          <li key={item.id}>
            <button
              type="button"
              role="option"
              aria-selected={active}
              onClick={() => onSelect(item.id)}
              className={cn(
                "flex w-full cursor-pointer flex-col gap-1 rounded-md px-3 py-2 text-left transition-colors",
                active ? "bg-primary/15 ring-1 ring-primary/40" : "hover:bg-surface-2",
              )}
            >
              <span className="flex items-start justify-between gap-2">
                <span className="line-clamp-2 text-subhead font-medium">{itemName(item)}</span>
                <StatusBadge item={item} />
              </span>
              <span className="text-caption text-muted-foreground tabular-nums">
                #{item.ph_backend_id} · {formatWhen(item.created_at)}
              </span>
              {item.notes ? (
                <span className="line-clamp-2 text-caption text-muted-foreground">
                  {item.notes}
                </span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Задача по секциям
// ---------------------------------------------------------------------------

function SectionCard({ section, hideEmpty }: { section: ReviewSection; hideEmpty: boolean }) {
  const rows = hideEmpty
    ? section.rows.filter(
        (r) =>
          isTargetingRow(r) ||
          r.changed ||
          !EMPTY_VALUES.has(r.current ?? r.agent) ||
          !EMPTY_VALUES.has(r.agent),
      )
    : section.rows;
  const changed = section.rows.filter((r) => r.changed).length;
  if (!rows.length && !section.brief) return null;
  return (
    <section className="overflow-hidden rounded-lg bg-surface ring-1 ring-border">
      <header className="flex items-center gap-2 border-b border-border px-4 py-2">
        <h3 className="text-subhead font-semibold">{section.title}</h3>
        {changed ? <Badge variant="accent">исправлено: {changed}</Badge> : null}
      </header>
      <div className="grid md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="border-b border-border bg-surface-2/40 px-4 py-3 md:border-r md:border-b-0">
          <span className="mb-1 block text-caption font-semibold text-muted-foreground">
            Бриф из графика
          </span>
          {section.brief ? (
            <p className="text-caption whitespace-pre-wrap">{section.brief}</p>
          ) : (
            <p className="text-caption text-muted-foreground">В брифе про это ничего нет</p>
          )}
        </div>
        <dl className="flex flex-col gap-1.5 px-4 py-3">
          {rows.map((row) => (
            <div key={row.key} className="grid grid-cols-[11rem_minmax(0,1fr)] gap-3 text-subhead">
              <dt className="text-muted-foreground">{row.label}</dt>
              <dd className="min-w-0 break-words">
                {row.changed ? (
                  <span className="flex flex-col gap-0.5">
                    <span
                      className="text-caption text-muted-foreground line-through"
                      title="Так сделал агент"
                    >
                      {row.agent}
                    </span>
                    <span
                      className="rounded bg-success/10 px-1 text-foreground"
                      title="Сейчас в админке"
                    >
                      {row.current}
                    </span>
                  </span>
                ) : (
                  (row.current ?? row.agent)
                )}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Вердикт
// ---------------------------------------------------------------------------

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
        "cursor-pointer rounded-chip px-2 py-1 text-caption ring-1 transition-colors",
        active
          ? "bg-primary/15 text-foreground ring-primary/50"
          : "text-muted-foreground ring-border hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

function VerdictPanel({
  item,
  diff,
  ready,
  onDone,
}: {
  item: AgentReviewItem;
  diff: ReviewDiffEntry[];
  /** Текущая задача загружена — правки посчитаны. */
  ready: boolean;
  onDone: () => void;
}) {
  const [reasons, setReasons] = useState<string[]>(item.review_reasons ?? []);
  const [comment, setComment] = useState(item.review_comment ?? "");
  const [lessonEdited, setLessonEdited] = useState<string | null>(null);
  const [lessonChoice, setLessonChoice] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<"accept" | "reject" | null>(null);
  const [error, setError] = useState("");

  const lesson = lessonEdited ?? lessonDraft(diff, comment, reasons);
  const hasFeedback = diff.length > 0 || comment.trim() !== "" || reasons.length > 0;
  const lessonOn = lessonChoice ?? hasFeedback;

  async function submit(rejected: boolean) {
    if (busy) return;
    setBusy(rejected ? "reject" : "accept");
    setError("");
    try {
      await saveAgentReview(item.id, {
        status: verdictStatus(diff, rejected),
        reasons,
        comment: comment.trim(),
        diff,
      });
      if (lessonOn && lesson.trim()) await createAgentLesson(lesson.trim(), item.id);
      toast.success(
        `${VERDICT_LABELS[verdictStatus(diff, rejected)]}${lessonOn && lesson.trim() ? " · урок сохранён" : ""}`,
      );
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className="flex flex-col gap-3 rounded-lg bg-surface p-4 ring-1 ring-border"
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          void submit(false);
        }
      }}
    >
      <div className="flex flex-col gap-1.5">
        <span className="text-caption font-semibold text-muted-foreground">
          Что агент сделал не так
        </span>
        <div className="flex flex-wrap gap-1.5">
          {REVIEW_REASONS.map((reason) => (
            <ReasonChip
              key={reason}
              label={reason}
              active={reasons.includes(reason)}
              onToggle={() =>
                setReasons((list) =>
                  list.includes(reason) ? list.filter((r) => r !== reason) : [...list, reason],
                )
              }
            />
          ))}
        </div>
      </div>
      <Textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Комментарий: что и почему нужно было сделать иначе"
        aria-label="Комментарий к ревью"
        className="min-h-14 text-subhead"
      />
      <div className="flex flex-col gap-1.5 rounded-md bg-surface-2/50 p-3">
        <CheckboxField
          checked={lessonOn}
          onCheckedChange={(v) => setLessonChoice(v === true)}
          label={
            <span className="flex items-center gap-1.5 text-subhead">
              <GraduationCap className="size-4" /> Урок для агента — он учтёт его в следующих
              задачах
            </span>
          }
        />
        {lessonOn ? (
          <Textarea
            value={lesson}
            onChange={(e) => setLessonEdited(e.target.value)}
            placeholder="Правило своими словами: «Группу бонусов выбирай по награде из брифа…»"
            aria-label="Текст урока"
            className="min-h-14 text-subhead"
          />
        ) : null}
        {lessonOn && lessonEdited == null && diff.length ? (
          <span className="text-caption text-muted-foreground">
            Черновик собран из правок — допишите общее правило, чтобы агент понял «почему»
          </span>
        ) : null}
      </div>
      {error ? <p className="text-caption text-destructive">{error}</p> : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="mr-auto text-caption text-muted-foreground">
          {!ready
            ? "Загружаю задачу из админки…"
            : diff.length
              ? `Вы поправили полей: ${diff.length} — они уйдут агенту как пример`
              : "Правок нет"}
          {" · Ctrl+Enter — принять"}
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={!!busy || !ready}
          onClick={() => void submit(true)}
          className="text-destructive hover:text-destructive"
          title="Задача не годится. В админке она останется черновиком — удалите её там, если не нужна"
        >
          {busy === "reject" ? <Loader2 className="animate-spin" /> : <X />} Отклонить
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={!!busy || !ready}
          onClick={() => void submit(false)}
          className="transition-transform active:scale-95"
        >
          {busy === "accept" ? <Loader2 className="animate-spin" /> : <Check />}
          {diff.length ? `Принять с правками (${diff.length})` : "Всё верно"}
        </Button>
      </div>
    </div>
  );
}

function ReviewedSummary({ item, onEdit }: { item: AgentReviewItem; onEdit: () => void }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-surface p-4 ring-1 ring-border">
      <div className="flex items-center gap-2">
        <StatusBadge item={item} />
        <span className="text-caption text-muted-foreground">
          {item.reviewer ?? "—"} · {formatWhen(item.reviewed_at)}
        </span>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={onEdit}>
          <Pencil /> Пересмотреть
        </Button>
      </div>
      {item.review_reasons.length ? (
        <p className="text-caption">Причины: {item.review_reasons.join(", ")}</p>
      ) : null}
      {item.review_comment ? (
        <p className="text-subhead whitespace-pre-wrap">{item.review_comment}</p>
      ) : null}
      {item.review_diff.length ? (
        <ul className="flex flex-col gap-0.5 text-caption">
          {item.review_diff.map((d) => (
            <li key={d.key}>
              <span className="text-muted-foreground">{d.label}:</span>{" "}
              <span className="line-through">{d.agent}</span>{" "}
              <ArrowRight className="inline size-3" /> {d.human}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Карточка задачи
// ---------------------------------------------------------------------------

function ReviewDetail({
  item,
  domain,
  onReviewed,
  onOpenOnCanvas,
}: {
  item: AgentReviewItem;
  domain: string;
  onReviewed: () => void;
  onOpenOnCanvas: (id: string) => void;
}) {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const meta = useTaskMeta(domain);
  const [fixOpen, setFixOpen] = useState(false);
  const [reReview, setReReview] = useState(false);
  const [hideEmpty, setHideEmpty] = useState(true);
  const taskId = item.ph_backend_id;
  const currentKey = ["review-task", domain, taskId];

  const current = useQuery({
    queryKey: currentKey,
    queryFn: () => fetchTask(domain, taskId!),
    enabled: !!taskId,
    staleTime: 0,
    retry: false,
  });

  const ctx = useMemo<BulkContext>(() => {
    const bonuses = new Map((meta.data?.bonuses ?? []).map((b) => [b.id, b.title]));
    return { bonusTitle: (id) => bonuses.get(id) };
  }, [meta.data]);

  const agentTask = agentTaskOf(item);
  const currentTask = (current.data as TaskLike | undefined) ?? null;
  const rows = agentTask ? buildReviewRows(agentTask, currentTask, ctx) : [];
  const diff = reviewDiff(rows);
  const brief = briefOf(item);
  const sections = reviewSections(rows, brief);
  const state = String(currentTask?.state ?? "").toLowerCase();

  async function saveFix(payload: TaskPayloadEnvelope): Promise<unknown> {
    if (!taskId) throw new Error("У задачи нет id");
    const { response, task } = await updateTask(domain, taskId, payload);
    void logTaskEvent({
      event: "updated",
      source: "edit",
      domain,
      ph_backend_id: taskId,
      planner_task_id: item.planner_task_id,
      draft: currentTask ?? undefined,
      payload,
      result: task,
    });
    if (task) {
      queryClient.setQueryData(currentKey, task);
      useChainsStore.getState().applyUpdatedTask(task);
    }
    toast.success(`Задача #${taskId} сохранена`);
    setFixOpen(false);
    return response;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-title-3">{itemName(item)}</h2>
          <p className="text-caption text-muted-foreground tabular-nums">
            #{taskId} · создана агентом {formatWhen(item.created_at)}
            {item.planner_task_id != null ? ` · задание графика #${item.planner_task_id}` : ""}
            {state ? ` · в админке: ${state}` : ""}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={!taskId}
          onClick={() => taskId && onOpenOnCanvas(taskId)}
          title="Добавить задачу на канву и показать связи"
        >
          <LayoutGrid /> На канве
        </Button>
        <Button
          variant={fixOpen ? "secondary" : "primary"}
          size="sm"
          disabled={!currentTask}
          onClick={() => setFixOpen((v) => !v)}
        >
          <Pencil /> {fixOpen ? "Скрыть форму" : "Поправить"}
        </Button>
      </div>

      {state && state !== "draft" ? (
        <p className="flex items-center gap-1.5 rounded-md bg-accent/15 px-3 py-2 text-caption">
          <AlertTriangle className="size-3.5 shrink-0" /> Задача уже не черновик ({state}) — её
          могли запустить до проверки.
        </p>
      ) : null}

      {item.notes ? (
        <div className="flex gap-2 rounded-lg bg-primary/10 px-4 py-3 ring-1 ring-primary/30">
          <Bot className="mt-0.5 size-4 shrink-0 text-primary" />
          <div className="min-w-0">
            <span className="block text-caption font-semibold">Пояснение агента</span>
            <p className="text-subhead whitespace-pre-wrap">{item.notes}</p>
          </div>
        </div>
      ) : null}

      {current.isError ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-caption text-destructive">
          <AlertTriangle className="size-3.5 shrink-0" />
          Не удалось загрузить задачу из админки: {errorMessage(current.error)}. Видно только то,
          что сделал агент.
          <Button
            variant="secondary"
            size="sm"
            className="ml-auto"
            onClick={() =>
              void auth
                .ensureAuthenticated(domain, { message: `Для ревью нужен вход в ${domain}` })
                .then(() => current.refetch())
            }
          >
            Войти и повторить
          </Button>
        </div>
      ) : null}

      {brief.general ? (
        <div className="rounded-lg bg-surface-2/40 px-4 py-3 ring-1 ring-border">
          <span className="mb-1 block text-caption font-semibold text-muted-foreground">
            Бриф из графика — общее
          </span>
          <p className="text-caption whitespace-pre-wrap">{brief.general}</p>
        </div>
      ) : null}

      {fixOpen && currentTask ? (
        <div className="rounded-lg bg-surface ring-1 ring-primary/40">
          <TaskForm
            mode="edit"
            domain={domain}
            sourceTask={currentTask}
            onSubmit={saveFix}
            showPreview={false}
            title={`Правка #${taskId}`}
            initialOpenSections={["basic", "actions", "rewards"]}
            sectionsStorageKey="ph.review.form.sections"
          />
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <span className="text-caption text-muted-foreground">
          {current.isLoading ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="size-3.5 animate-spin" /> Загружаю задачу из админки…
            </span>
          ) : currentTask ? (
            "Зачёркнуто — как сделал агент, зелёным — как сейчас в админке"
          ) : (
            "Значения — как сделал агент"
          )}
        </span>
        <CheckboxField
          checked={hideEmpty}
          onCheckedChange={(v) => setHideEmpty(v === true)}
          label={<span className="text-caption">Скрыть пустые поля</span>}
        />
      </div>

      {sections.map((section) => (
        <SectionCard key={section.id} section={section} hideEmpty={hideEmpty} />
      ))}

      {item.run_goal || item.run_summary ? (
        <details className="rounded-lg bg-surface px-4 py-3 ring-1 ring-border">
          <summary className="cursor-pointer text-caption font-semibold text-muted-foreground">
            Запуск агента{item.run_model ? ` · ${item.run_model}` : ""}
          </summary>
          {item.run_goal ? <p className="mt-2 text-subhead">Задание: {item.run_goal}</p> : null}
          {item.run_summary ? (
            <div className="mt-2">
              <ChatMarkdown text={item.run_summary} onFocusNode={() => {}} />
            </div>
          ) : null}
        </details>
      ) : null}

      <div className="sticky bottom-0 pb-1">
        {item.review_status && !reReview ? (
          <ReviewedSummary item={item} onEdit={() => setReReview(true)} />
        ) : (
          <VerdictPanel
            key={item.id}
            item={item}
            diff={diff}
            ready={!taskId || !current.isLoading}
            onDone={onReviewed}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Страница
// ---------------------------------------------------------------------------

export function ReviewPage({ onOpenOnCanvas }: { onOpenOnCanvas: (id: string) => void }) {
  const domain = useChainsStore((s) => s.domain);
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<ReviewFilter>("pending");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [lessonsOpen, setLessonsOpen] = useState(false);

  const list = useQuery({
    queryKey: reviewQueryKey(domain, filter),
    queryFn: () => listAgentReviews(domain, filter),
    enabled: !!domain,
    retry: false,
  });
  const items = list.data?.items ?? NO_ITEMS;
  const counts = list.data?.counts ?? { pending: 0, reviewed: 0 };
  const selected = items.find((i) => i.id === selectedId) ?? items[0] ?? null;
  const index = selected ? items.indexOf(selected) : -1;

  // J/K и стрелки — по очереди, если фокус не в поле ввода и не открыт диалог.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const step =
        e.key === "j" || e.key === "ArrowDown" ? 1 : e.key === "k" || e.key === "ArrowUp" ? -1 : 0;
      if (!step || !items.length) return;
      e.preventDefault();
      const next = items[Math.min(Math.max(index + step, 0), items.length - 1)];
      if (next) setSelectedId(next.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, index]);

  function reviewed() {
    // Следующая по очереди: проверенная уйдёт из «Ждут проверки».
    const next = items[index + 1] ?? items[index - 1] ?? null;
    setSelectedId(next?.id ?? null);
    void queryClient.invalidateQueries({ queryKey: reviewQueryKey(domain) });
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-headline">Ревью задач агента</h2>
        <Segmented<ReviewFilter>
          size="sm"
          value={filter}
          onValueChange={(v) => {
            setFilter(v);
            setSelectedId(null);
          }}
          options={[
            { value: "pending", label: `Ждут проверки (${counts.pending})` },
            { value: "reviewed", label: `Проверены (${counts.reviewed})` },
            { value: "all", label: "Все" },
          ]}
          aria-label="Какие задачи показать"
        />
        <span className="text-caption text-muted-foreground">J / K — следующая / предыдущая</span>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setLessonsOpen(true)}>
            <GraduationCap /> Уроки агента
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Обновить"
            title="Обновить"
            disabled={!domain || list.isFetching}
            onClick={() => void list.refetch()}
          >
            {list.isFetching ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          </Button>
        </div>
      </div>

      {!domain ? (
        <p className="text-subhead text-muted-foreground">Выберите домен админки.</p>
      ) : list.isError ? (
        <p className="flex items-center gap-1.5 text-subhead text-destructive">
          <AlertTriangle className="size-4 shrink-0" /> {errorMessage(list.error)}
          {/HTTP 40[13]/.test(errorMessage(list.error))
            ? " — нужен вход в Promo Graphic в окне расширения."
            : ""}
        </p>
      ) : list.isLoading ? (
        <p className="flex items-center gap-1.5 text-subhead text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Загружаю задачи агента…
        </p>
      ) : !items.length ? (
        <div className="flex flex-col gap-1 text-subhead text-muted-foreground">
          <p>{filter === "pending" ? "Все задачи агента проверены." : "Задач агента пока нет."}</p>
          <p>Агент создаёт их на вкладке «Канва» → кнопка «Агент».</p>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[20rem_minmax(0,1fr)] gap-3">
          <div className="min-h-0 overflow-y-auto rounded-lg bg-surface ring-1 ring-border">
            <Queue items={items} selectedId={selected?.id ?? null} onSelect={setSelectedId} />
          </div>
          <div className="min-h-0 overflow-y-auto pr-1">
            {selected ? (
              <ReviewDetail
                key={selected.id}
                item={selected}
                domain={domain}
                onReviewed={reviewed}
                onOpenOnCanvas={onOpenOnCanvas}
              />
            ) : null}
          </div>
        </div>
      )}

      {lessonsOpen ? <LessonsDialog onClose={() => setLessonsOpen(false)} /> : null}
    </div>
  );
}
