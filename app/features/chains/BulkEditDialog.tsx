/**
 * Модалка массовой правки выделенных задач — три шага:
 * «Изменения» (поля слева, операции справа) → «Проверка» (итог и «было → стало» по задачам)
 * → «Готово» (прогресс, результат, «Откатить»). Целевые действия не меняются.
 */
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CircleDot,
  ListChecks,
  Loader2,
  Minus,
  RotateCcw,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { AnimatedHeight } from "@/components/animated-height";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { useCountriesData } from "@/features/task-form/CountrySelector";
import { useConditionsSchema, useTaskMeta } from "@/features/task-form/hooks";
import { SECTION_IDS, SECTION_TITLES } from "@/features/task-form/task-form";
import type { TaskLike } from "@/lib/types";
import { cn } from "@/lib/utils";

import {
  type BulkContext,
  type BulkFieldId,
  type BulkOp,
  type BulkResult,
  BULK_FIELDS,
  applyBulkOps,
  bulkFieldDef,
  bulkFieldDiffers,
  defaultBulkOp,
  groupChanges,
  isBulkOpReady,
} from "./bulk-edit";
import { type BulkRow, applyBulkEdit, revertBulkEdit, useBulkEdit } from "./bulk-edit-run";
import { type BulkRefs, BulkOpEditor, CurrentValues } from "./BulkOpEditor";
import { useChainsStore } from "./store";

type Step = "edit" | "review" | "result";

const STEPS: ReadonlyArray<{ id: Step; label: string }> = [
  { id: "edit", label: "Изменения" },
  { id: "review", label: "Проверка" },
  { id: "result", label: "Готово" },
];

/** Секции формы в порядке формы; целевых действий в массовой правке нет. */
const PICKER_SECTIONS = SECTION_IDS.filter((id) => id !== "actions").map((id) => ({
  id,
  title: SECTION_TITLES[id],
  fields: BULK_FIELDS.filter((f) => f.section === id),
}));

interface PreviewItem {
  id: string;
  name: string;
  draft: boolean;
  result: BulkResult | null;
  loadError?: string;
}

type ReviewFilter = "changed" | "same" | "problems";

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

/** «1 задача», «3 задачи», «5 задач». */
const tasksWord = (n: number) => `${n} ${plural(n, "задача", "задачи", "задач")}`;
/** «1 задачу», «3 задачи», «5 задач» — после «изменит», «применить к». */
const tasksWordAcc = (n: number) => `${n} ${plural(n, "задачу", "задачи", "задач")}`;
/** «у 1 задачи», «у 5 задач». */
const tasksWordGen = (n: number) => `${n} ${plural(n, "задачи", "задач", "задач")}`;

// ---------------------------------------------------------------------------
// Степпер
// ---------------------------------------------------------------------------

function Stepper({ step }: { step: Step }) {
  const index = STEPS.findIndex((s) => s.id === step);
  return (
    <ol className="flex items-center gap-2" aria-label="Шаги">
      {STEPS.map((s, i) => {
        const done = i < index;
        const current = i === index;
        return (
          <li
            key={s.id}
            className="flex items-center gap-2"
            aria-current={current ? "step" : undefined}
          >
            {i > 0 ? (
              <span
                className={cn(
                  "h-px w-6 transition-colors duration-300",
                  done || current ? "bg-primary" : "bg-border",
                )}
              />
            ) : null}
            <span
              className={cn(
                "flex size-5 items-center justify-center rounded-full text-caption font-semibold tabular-nums transition-colors duration-300",
                done && "bg-primary text-primary-foreground",
                current && "bg-primary/20 text-primary ring-1 ring-primary",
                !done && !current && "bg-surface-2 text-muted-foreground",
              )}
            >
              {done ? <Check className="size-3" /> : i + 1}
            </span>
            <span
              className={cn(
                "text-subhead transition-colors duration-300",
                current ? "font-semibold text-foreground" : "text-muted-foreground",
              )}
            >
              {s.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Шаг 1: поля и операции
// ---------------------------------------------------------------------------

function FieldPicker({
  activeFields,
  tasks,
  ctx,
  disabled,
  onPick,
}: {
  activeFields: ReadonlySet<BulkFieldId>;
  tasks: TaskLike[];
  ctx: BulkContext;
  disabled: boolean;
  onPick: (field: BulkFieldId) => void;
}) {
  const differs = useMemo(
    () => new Set(BULK_FIELDS.filter((f) => bulkFieldDiffers(tasks, f.id, ctx)).map((f) => f.id)),
    [tasks, ctx],
  );
  return (
    <nav aria-label="Поля" className="flex flex-col gap-3 py-3 pr-2 pl-3">
      {PICKER_SECTIONS.map((section) => (
        <div key={section.id} className="flex flex-col gap-0.5">
          <span className="px-2 pb-0.5 text-caption font-semibold tracking-wide text-muted-foreground uppercase">
            {section.title}
          </span>
          {section.fields.map((field) => {
            const active = activeFields.has(field.id);
            return (
              <button
                key={field.id}
                type="button"
                disabled={disabled}
                aria-pressed={active}
                onClick={() => onPick(field.id)}
                className={cn(
                  "flex min-h-7 cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left text-subhead transition-colors duration-150",
                  "focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
                  active
                    ? "bg-primary/15 text-foreground"
                    : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{field.label}</span>
                {active ? (
                  <Check className="size-3.5 shrink-0 text-primary" aria-label="добавлено" />
                ) : differs.has(field.id) ? (
                  <CircleDot
                    className="size-3 shrink-0 text-primary"
                    aria-label="у задач по-разному"
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      ))}
      <p className="flex items-center gap-1.5 px-2 text-caption text-muted-foreground">
        <CircleDot className="size-3 shrink-0 text-primary" /> у задач по-разному
      </p>
    </nav>
  );
}

function OpCard({
  op,
  tasks,
  ctx,
  refs,
  affected,
  highlight,
  onChange,
  onRemove,
}: {
  op: BulkOp;
  tasks: TaskLike[];
  ctx: BulkContext;
  refs: BulkRefs;
  affected: number;
  highlight: boolean;
  onChange: (op: BulkOp) => void;
  onRemove: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const def = bulkFieldDef(op.field);
  const ready = isBulkOpReady(op);

  useEffect(() => {
    if (highlight) ref.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [highlight]);

  return (
    <div
      ref={ref}
      className={cn(
        "flex animate-message-in flex-col gap-2.5 rounded-lg bg-surface-2/40 p-3.5 ring-1 transition-shadow duration-300",
        highlight ? "ring-2 ring-primary" : "ring-border",
      )}
    >
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="text-caption text-muted-foreground">{SECTION_TITLES[def.section]}</span>
          <span className="text-headline font-semibold">{def.label}</span>
        </div>
        <span
          className={cn(
            "ml-auto shrink-0 rounded-chip px-2 py-0.5 text-caption tabular-nums transition-colors duration-200",
            ready && affected ? "bg-success/15 text-success" : "bg-surface-2 text-muted-foreground",
          )}
        >
          {!ready
            ? "заполните значение"
            : affected
              ? `изменит ${tasksWordAcc(affected)}`
              : "уже так у всех"}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Убрать «${def.label}»`}
          title="Убрать это изменение"
          onClick={onRemove}
        >
          <Trash2 />
        </Button>
      </div>
      <CurrentValues op={op} tasks={tasks} ctx={ctx} onPick={onChange} />
      <BulkOpEditor op={op} onChange={onChange} tasks={tasks} refs={refs} />
    </div>
  );
}

function EmptyOps() {
  return (
    <div className="flex h-full animate-fade-in flex-col items-center justify-center gap-2 px-6 text-center">
      <ListChecks className="size-8 text-muted-foreground/60" />
      <p className="text-headline">Что поменять?</p>
      <p className="max-w-sm text-subhead text-muted-foreground">
        Выберите поле слева — покажу, какие значения сейчас стоят у задач, и что поменяется. Точкой
        отмечены поля, где у задач значения расходятся.
      </p>
    </div>
  );
}

function LoadingOps({ done, total }: { done: number; total: number }) {
  const percent = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex flex-col gap-3 p-4" role="progressbar" aria-valuenow={percent}>
      <div className="flex items-center gap-2 text-subhead text-muted-foreground">
        <Loader2 className="size-4 animate-spin text-primary" />
        Загружаю задачи: {done} из {total}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
      {[0, 1].map((i) => (
        <div key={i} className="h-24 animate-pulse rounded-lg bg-surface-2/60" />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Шаг 2: проверка
// ---------------------------------------------------------------------------

function BeforeAfter({ before, after }: { before: string; after: string }) {
  return (
    <>
      <span className="break-all text-muted-foreground line-through decoration-muted-foreground/60">
        {before}
      </span>
      <ArrowRight className="size-3 shrink-0 self-center text-muted-foreground" />
      <span className="font-medium break-all">{after}</span>
    </>
  );
}

function ChangeList({ changes }: { changes: BulkRow["changes"] }) {
  return (
    <ul className="flex flex-col gap-0.5 text-caption">
      {changes.map((c, i) => (
        <li key={i} className="flex flex-wrap items-baseline gap-x-1.5">
          <span className="text-muted-foreground">{c.label}:</span>
          <BeforeAfter before={c.before} after={c.after} />
        </li>
      ))}
    </ul>
  );
}

function isApplicable(item: PreviewItem): boolean {
  return Boolean(item.result?.changes.length && !item.result.errors.length);
}

function ReviewStep({
  preview,
  excluded,
  setExcluded,
}: {
  preview: PreviewItem[];
  excluded: Set<string>;
  setExcluded: (next: Set<string>) => void;
}) {
  const changed = preview.filter(isApplicable);
  const problems = preview.filter((p) => !p.result || p.result.errors.length);
  const same = preview.filter(
    (p) => p.result && !p.result.changes.length && !p.result.errors.length,
  );
  const [filter, setFilter] = useState<ReviewFilter>(changed.length ? "changed" : "problems");
  const included = changed.filter((p) => !excluded.has(p.id));
  const groups = groupChanges(included.map((p) => p.result!.changes));
  const list = filter === "changed" ? changed : filter === "same" ? same : problems;

  function toggle(id: string, include: boolean) {
    const next = new Set(excluded);
    if (include) next.delete(id);
    else next.add(id);
    setExcluded(next);
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <section className="flex flex-col gap-2 rounded-lg bg-surface-2/40 p-3.5 ring-1 ring-border">
        <h3 className="text-subhead font-semibold">
          {included.length
            ? `Что изменится у ${tasksWordGen(included.length)}`
            : "Ни одна задача не выбрана"}
        </h3>
        {groups.length ? (
          <ul className="flex flex-col gap-1 text-subhead">
            {groups.map((g, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-1.5">
                <span className="text-muted-foreground">{g.label}:</span>
                <BeforeAfter before={g.before} after={g.after} />
                <span className="ml-auto shrink-0 rounded-chip bg-surface-2 px-1.5 text-caption text-muted-foreground tabular-nums">
                  {tasksWord(g.count)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-subhead text-muted-foreground">Отметьте задачи ниже.</p>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          size="sm"
          value={filter}
          onValueChange={setFilter}
          options={[
            { value: "changed", label: `Изменятся · ${changed.length}` },
            { value: "same", label: `Без изменений · ${same.length}` },
            { value: "problems", label: `Проблемы · ${problems.length}` },
          ]}
          aria-label="Какие задачи показать"
        />
        {filter === "changed" && changed.length > 1 ? (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() =>
              setExcluded(
                included.length === changed.length ? new Set(changed.map((p) => p.id)) : new Set(),
              )
            }
          >
            {included.length === changed.length ? "Снять все" : "Выбрать все"}
          </Button>
        ) : null}
      </div>

      <AnimatedHeight>
        {list.length ? (
          <ul key={filter} className="flex animate-fade-in flex-col gap-1.5">
            {list.map((item) => {
              const applicable = isApplicable(item);
              const on = applicable && !excluded.has(item.id);
              return (
                <li
                  key={item.id}
                  className={cn(
                    "flex gap-2.5 rounded-md bg-surface-2/40 px-3 py-2 transition-opacity duration-200",
                    applicable && !on && "opacity-55",
                  )}
                >
                  {applicable ? (
                    <Checkbox
                      className="mt-0.5"
                      checked={on}
                      onCheckedChange={(c) => toggle(item.id, c === true)}
                      aria-label={`Применить к «${item.name}»`}
                    />
                  ) : null}
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="truncate text-subhead">
                      <span className="font-mono text-muted-foreground">#{item.id}</span>{" "}
                      {item.name}
                      {item.draft ? (
                        <span className="ml-1.5 rounded-chip bg-surface-2 px-1.5 text-caption text-muted-foreground">
                          черновик
                        </span>
                      ) : null}
                    </span>
                    {!item.result ? (
                      <span className="flex items-center gap-1 text-caption text-destructive">
                        <AlertTriangle className="size-3.5" /> Не загрузилась:{" "}
                        {item.loadError ?? "нет данных"}
                      </span>
                    ) : (
                      <>
                        {item.result.changes.length ? (
                          <ChangeList changes={item.result.changes} />
                        ) : null}
                        {item.result.errors.map((err) => (
                          <span
                            key={err}
                            className="flex items-center gap-1 text-caption text-destructive"
                          >
                            <AlertTriangle className="size-3.5" /> {err}
                          </span>
                        ))}
                        {item.result.notes.map((note) => (
                          <span key={note} className="text-caption text-muted-foreground">
                            {note}
                          </span>
                        ))}
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p
            key={filter}
            className="animate-fade-in py-6 text-center text-subhead text-muted-foreground"
          >
            {filter === "problems" ? "Проблем нет" : "Таких задач нет"}
          </p>
        )}
      </AnimatedHeight>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Шаг 3: результат
// ---------------------------------------------------------------------------

const OUTCOME_VIEW: Record<
  BulkRow["outcome"],
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    tone: string;
    order: number;
  }
> = {
  error: { label: "Ошибка", icon: X, tone: "text-destructive", order: 0 },
  updated: { label: "Изменено", icon: Check, tone: "text-success", order: 1 },
  reverted: { label: "Откатено", icon: Undo2, tone: "text-primary", order: 2 },
  skipped: { label: "Пропущено", icon: Minus, tone: "text-muted-foreground", order: 3 },
  unchanged: { label: "Без изменений", icon: Minus, tone: "text-muted-foreground", order: 4 },
};

const COUNTERS: ReadonlyArray<BulkRow["outcome"]> = ["updated", "unchanged", "skipped", "error"];

function ResultStep({
  rows,
  total,
  running,
  reverting,
}: {
  rows: BulkRow[];
  total: number;
  running: boolean;
  reverting: boolean;
}) {
  const percent = total ? Math.round((rows.length / total) * 100) : 0;
  const sorted = [...rows].sort(
    (a, b) => OUTCOME_VIEW[a.outcome].order - OUTCOME_VIEW[b.outcome].order,
  );
  const reverted = rows.filter((r) => r.outcome === "reverted").length;
  return (
    <div className="flex flex-col gap-4 p-4">
      {running ? (
        <div
          className="flex flex-col gap-2"
          role="progressbar"
          aria-valuenow={reverting ? undefined : percent}
        >
          <div className="flex items-center gap-2 text-subhead">
            <Loader2 className="size-4 animate-spin text-primary" />
            {reverting ? "Откатываю изменения…" : `Сохраняю: ${rows.length} из ${total}`}
            {!reverting ? (
              <span className="ml-auto font-semibold text-primary tabular-nums">{percent}%</span>
            ) : null}
          </div>
          <div className="relative h-2 overflow-hidden rounded-full bg-surface-2">
            {reverting ? (
              <div className="absolute inset-y-0 w-1/3 animate-[progress-indeterminate_1.2s_ease-in-out_infinite] rounded-full bg-primary" />
            ) : (
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
                style={{ width: `${percent}%` }}
              />
            )}
          </div>
        </div>
      ) : reverted ? (
        <p className="flex animate-fade-in items-center gap-1.5 text-subhead text-primary">
          <Undo2 className="size-4" /> Откатено: {tasksWord(reverted)} — значения вернулись к
          прежним
        </p>
      ) : (
        <div className="grid animate-fade-in grid-cols-4 gap-2">
          {COUNTERS.map((id) => {
            const view = OUTCOME_VIEW[id];
            const Icon = view.icon;
            const count = rows.filter((r) => r.outcome === id).length;
            return (
              <div
                key={id}
                className={cn(
                  "flex flex-col gap-1 rounded-md bg-surface-2/50 p-2.5 ring-1 ring-border",
                  !count && "opacity-50",
                )}
              >
                <span className={cn("flex items-center gap-1 text-caption", view.tone)}>
                  <Icon className="size-3.5" /> {view.label}
                </span>
                <span className="text-title-2 tabular-nums">{count}</span>
              </div>
            );
          })}
        </div>
      )}

      <ul className="flex flex-col gap-1.5">
        {sorted.map((row) => {
          const view = OUTCOME_VIEW[row.outcome];
          const Icon = view.icon;
          return (
            <li
              key={row.id}
              className="flex animate-message-in flex-col gap-1 rounded-md bg-surface-2/40 px-3 py-2"
            >
              <div className="flex items-center gap-2 text-subhead">
                <span className="min-w-0 truncate">
                  <span className="font-mono text-muted-foreground">#{row.id}</span> {row.name}
                </span>
                <span
                  className={cn("ml-auto flex shrink-0 items-center gap-1 text-caption", view.tone)}
                >
                  <Icon className="size-3.5" /> {view.label}
                </span>
              </div>
              {row.changes.length && row.outcome !== "reverted" ? (
                <ChangeList changes={row.changes} />
              ) : null}
              {row.message ? (
                <span
                  className={cn(
                    "text-caption",
                    row.outcome === "error" ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  {row.message}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Модалка
// ---------------------------------------------------------------------------

interface OpEntry {
  uid: number;
  op: BulkOp;
}

let nextUid = 1;

export function BulkEditDialog() {
  const { open, phase, ids, tasks, loadErrors, rows, snapshots, seed, close, show } = useBulkEdit();
  const domain = useChainsStore((s) => s.domain);
  const canvas = useChainsStore((s) => s.canvas);
  const meta = useTaskMeta(domain);
  const schema = useConditionsSchema(domain);
  const countries = useCountriesData(domain);
  const refs: BulkRefs = { meta, schema, countries };

  const [ops, setOps] = useState<OpEntry[]>([]);
  const [step, setStep] = useState<"edit" | "review">("edit");
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [highlight, setHighlight] = useState<number | null>(null);

  const running = phase === "applying" || phase === "reverting";
  const shownStep: Step =
    phase === "applying" || phase === "done" || phase === "reverting" ? "result" : step;
  const loadedTasks = useMemo(
    () => ids.map((id) => tasks[id]).filter(Boolean) as TaskLike[],
    [ids, tasks],
  );

  const ctx = useMemo<BulkContext>(() => {
    const bonuses = new Map((meta.data?.bonuses ?? []).map((b) => [b.id, b.title]));
    return { bonusTitle: (id) => bonuses.get(id), duplicable: schema.duplicable };
  }, [meta.data, schema.duplicable]);

  const readyOps = useMemo(() => ops.map((e) => e.op).filter(isBulkOpReady), [ops]);
  const preview = useMemo<PreviewItem[]>(
    () =>
      ids.map((id) => {
        const task = tasks[id];
        return {
          id,
          name: canvas[id]?.name || `#${id}`,
          draft: Boolean(canvas[id]?.localOnly),
          result: task ? applyBulkOps(task, readyOps, ctx) : null,
          loadError: loadErrors[id],
        };
      }),
    [ids, tasks, canvas, readyOps, ctx, loadErrors],
  );
  /** Сколько задач меняет каждая операция сама по себе — для бейджа на карточке. */
  const affectedByOp = useMemo(() => {
    const out = new Map<number, number>();
    for (const { uid, op } of ops) {
      if (!isBulkOpReady(op)) continue;
      out.set(uid, loadedTasks.filter((t) => applyBulkOps(t, [op], ctx).changes.length).length);
    }
    return out;
  }, [ops, loadedTasks, ctx]);

  const applicable = preview.filter(isApplicable);
  const toApply = applicable.filter((p) => !excluded.has(p.id));
  const problemCount = preview.filter((p) => !p.result || p.result.errors.length).length;

  // Окно открыли с готовыми операциями (из сравнения) — они становятся карточками.
  // Новая заготовка распознаётся по ссылке прямо в рендере, без эффекта.
  const [seenSeed, setSeenSeed] = useState<BulkOp[]>(seed);
  if (seed !== seenSeed) {
    setSeenSeed(seed);
    if (seed.length) {
      // Заготовка заменяет весь список; отрицательные uid не пересекаются с nextUid.
      const entries = seed.map((op, i) => ({ uid: -(i + 1), op }));
      setOps(entries);
      setHighlight(entries[0]!.uid);
    }
  }

  // Подсветка карточки после выбора поля гаснет сама.
  useEffect(() => {
    if (highlight == null) return;
    const timer = setTimeout(() => setHighlight(null), 1200);
    return () => clearTimeout(timer);
  }, [highlight]);

  function reset() {
    setOps([]);
    setStep("edit");
    setExcluded(new Set());
    setHighlight(null);
  }

  function requestClose() {
    if (running) return;
    const unsaved = phase !== "done" && ops.some((e) => isBulkOpReady(e.op));
    if (unsaved && !window.confirm("Закрыть без применения? Настроенные изменения пропадут.")) {
      return;
    }
    close();
    reset();
  }

  function pickField(field: BulkFieldId) {
    const existing = ops.find((e) => e.op.field === field);
    if (existing) {
      setHighlight(existing.uid);
      return;
    }
    const uid = nextUid++;
    setOps((list) => [...list, { uid, op: defaultBulkOp(field) }]);
    setHighlight(uid);
  }

  function apply() {
    const skip = new Set(ids.filter((id) => !toApply.some((p) => p.id === id)));
    void applyBulkEdit(readyOps, ctx, skip);
  }

  function editMore() {
    reset();
    show(ids, { onClose: useBulkEdit.getState().onClose });
  }

  const canReview = phase === "edit" && applicable.length > 0;
  const blockedReason =
    phase === "loading"
      ? "Задачи ещё загружаются"
      : !ops.length
        ? "Выберите поле слева"
        : !readyOps.length
          ? "Заполните значение изменения"
          : !applicable.length
            ? "Ни у одной задачи ничего не поменяется"
            : "";

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    if (shownStep === "edit" && canReview) setStep("review");
    else if (shownStep === "review" && toApply.length) apply();
  }

  const footerStatus =
    shownStep === "edit"
      ? blockedReason ||
        `Изменится ${tasksWord(applicable.length)} из ${ids.length}${problemCount ? ` · с проблемами: ${problemCount}` : ""}`
      : shownStep === "review"
        ? `Будет сохранено: ${tasksWord(toApply.length)}`
        : running
          ? "Не закрывайте окно до конца сохранения"
          : Object.keys(snapshots).length
            ? "Если что-то не так — можно откатить"
            : "";

  return (
    <Dialog open={open} onOpenChange={(next) => !next && requestClose()}>
      <DialogContent
        className="h-[min(88vh,880px)] max-w-5xl gap-0 overflow-hidden p-0"
        showClose={!running}
        onEscapeKeyDown={(e) => {
          e.preventDefault();
          requestClose();
        }}
        onPointerDownOutside={(e) => e.preventDefault()}
        onKeyDown={onKeyDown}
      >
        <header className="flex flex-col gap-3 border-b border-border px-5 pt-4 pb-3">
          <div className="flex flex-col gap-0.5 pr-8">
            <DialogTitle>Массовая правка · {tasksWord(ids.length)}</DialogTitle>
            <DialogDescription>
              Всё, кроме целевых действий. Перед сохранением каждая задача заново берётся с бэка;
              черновики меняются на канве.
            </DialogDescription>
          </div>
          <Stepper step={shownStep} />
        </header>

        <div className="min-h-0 flex-1">
          {shownStep === "edit" ? (
            <div key="edit" className="grid h-full animate-fade-in grid-cols-[216px_1fr]">
              <div className="overflow-y-auto border-r border-border">
                <FieldPicker
                  activeFields={new Set(ops.map((e) => e.op.field))}
                  tasks={loadedTasks}
                  ctx={ctx}
                  disabled={phase === "loading"}
                  onPick={pickField}
                />
              </div>
              <div className="overflow-y-auto">
                {phase === "loading" ? (
                  <LoadingOps
                    done={Object.keys(tasks).length + Object.keys(loadErrors).length}
                    total={ids.length}
                  />
                ) : ops.length ? (
                  <div className="flex flex-col gap-3 p-4">
                    {ops.map((entry) => (
                      <OpCard
                        key={entry.uid}
                        op={entry.op}
                        tasks={loadedTasks}
                        ctx={ctx}
                        refs={refs}
                        affected={affectedByOp.get(entry.uid) ?? 0}
                        highlight={highlight === entry.uid}
                        onChange={(op) =>
                          setOps((list) =>
                            list.map((e) => (e.uid === entry.uid ? { ...e, op } : e)),
                          )
                        }
                        onRemove={() => setOps((list) => list.filter((e) => e.uid !== entry.uid))}
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyOps />
                )}
              </div>
            </div>
          ) : shownStep === "review" ? (
            <div key="review" className="h-full animate-fade-in overflow-y-auto">
              <ReviewStep preview={preview} excluded={excluded} setExcluded={setExcluded} />
            </div>
          ) : (
            <div key="result" className="h-full animate-fade-in overflow-y-auto">
              <ResultStep
                rows={rows}
                total={toApply.length}
                running={running}
                reverting={phase === "reverting"}
              />
            </div>
          )}
        </div>

        <footer className="flex items-center gap-2 border-t border-border bg-surface px-5 py-3">
          <span
            className="min-w-0 flex-1 truncate text-caption text-muted-foreground"
            aria-live="polite"
          >
            {footerStatus}
          </span>
          {shownStep === "edit" ? (
            <>
              <Button variant="ghost" onClick={requestClose}>
                Отмена
              </Button>
              <Button
                variant="primary"
                disabled={!canReview}
                title={blockedReason || "Ctrl+Enter"}
                onClick={() => setStep("review")}
              >
                Проверить <ArrowRight />
              </Button>
            </>
          ) : shownStep === "review" ? (
            <>
              <Button variant="ghost" onClick={() => setStep("edit")}>
                <ArrowLeft /> К изменениям
              </Button>
              <Button
                variant="primary"
                disabled={!toApply.length}
                title="Ctrl+Enter"
                onClick={apply}
              >
                <Check /> Применить к {tasksWordAcc(toApply.length)}
              </Button>
            </>
          ) : (
            <>
              {phase === "done" && Object.keys(snapshots).length ? (
                <Button variant="outline" onClick={() => void revertBulkEdit()}>
                  <Undo2 /> Откатить
                </Button>
              ) : null}
              {phase === "done" ? (
                <Button variant="ghost" onClick={editMore}>
                  <RotateCcw /> Ещё правка
                </Button>
              ) : null}
              <Button variant="primary" disabled={running} onClick={requestClose}>
                {running ? "Подождите…" : "Готово"}
              </Button>
            </>
          )}
        </footer>
      </DialogContent>
    </Dialog>
  );
}
