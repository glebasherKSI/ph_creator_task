/**
 * Сравнение выделенных задач таблицей: строки — параметры по секциям формы, столбцы — задачи.
 * Ячейка, отличная от большинства, подсвечена; клик по ней открывает массовую правку
 * «сделать у всех так», после правки окно сравнения возвращается со свежими данными.
 */
import { CheckCircle2, Loader2, Maximize2, Minimize2, Wand2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { useTaskMeta } from "@/features/task-form/hooks";
import type { TaskLike } from "@/lib/types";
import { cn } from "@/lib/utils";

import type { BulkContext, BulkOp } from "./bulk-edit";
import { useBulkEdit } from "./bulk-edit-run";
import { type CompareRow, buildCompareRows, groupCompareRows } from "./compare";
import { useChainsStore } from "./store";

interface CompareState {
  open: boolean;
  ids: string[];
  show: (ids: string[]) => void;
  close: () => void;
  remove: (id: string) => void;
}

export const useCompare = create<CompareState>((set) => ({
  open: false,
  ids: [],
  show: (ids) => set({ open: true, ids: ids.filter((id) => useChainsStore.getState().canvas[id]) }),
  close: () => set({ open: false }),
  remove: (id) => set((s) => ({ ids: s.ids.filter((x) => x !== id) })),
}));

const CONCURRENCY = 4;

/** Догружает полные задачи, которых ещё нет на канве; ошибки — по id. */
function useFullTasks(ids: string[], open: boolean): Record<string, string> {
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const missing = ids.filter((id) => !useChainsStore.getState().canvas[id]?.full);
    let cursor = 0;
    const lane = async () => {
      while (cursor < missing.length && !cancelled) {
        const id = missing[cursor++]!;
        try {
          const full = await useChainsStore.getState().ensureFull(id);
          if (!full) throw new Error("нет данных");
        } catch (err) {
          if (!cancelled) {
            setErrors((e) => ({ ...e, [id]: err instanceof Error ? err.message : String(err) }));
          }
        }
      }
    };
    void Promise.all(Array.from({ length: Math.min(CONCURRENCY, missing.length) }, lane));
    return () => {
      cancelled = true;
    };
  }, [ids, open]);
  return errors;
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

/** Размер окна и ширина колонок — запоминаются между открытиями (только в этом браузере). */
interface CompareLayout {
  full: boolean;
  /** Размер, растянутый мышью; null — по умолчанию. */
  size: { w: number; h: number } | null;
  compact: boolean;
}

const LAYOUT_KEY = "ph.compare.layout";
const DEFAULT_LAYOUT: CompareLayout = { full: false, size: null, compact: false };
const MIN_W = 640;
const MIN_H = 420;
/** Отступ окна от краёв экрана. */
const EDGE = 16;

function readLayout(): CompareLayout {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    return raw
      ? { ...DEFAULT_LAYOUT, ...(JSON.parse(raw) as Partial<CompareLayout>) }
      : DEFAULT_LAYOUT;
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function writeLayout(layout: CompareLayout): void {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // Хранилище недоступно — размер просто не запомнится.
  }
}

function clampSize(w: number, h: number): { w: number; h: number } {
  return {
    w: Math.round(Math.min(Math.max(w, MIN_W), window.innerWidth - EDGE * 2)),
    h: Math.round(Math.min(Math.max(h, MIN_H), window.innerHeight - EDGE * 2)),
  };
}

function Cell({
  text,
  odd,
  fixable,
  compact,
  onFix,
}: {
  text: string;
  odd: boolean;
  fixable: boolean;
  compact: boolean;
  onFix: () => void;
}) {
  const body = <span className="line-clamp-4 break-words whitespace-pre-line">{text}</span>;
  const base = cn(
    "block w-full rounded-md text-left transition-colors duration-150",
    compact ? "px-1.5 py-1 text-caption" : "px-2 py-1.5 text-subhead",
    odd ? "bg-primary/12 text-primary ring-1 ring-primary/40" : "text-foreground",
  );
  if (!fixable) {
    return (
      <div className={base} title={text}>
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onFix}
      title={`${text}\n\nНажмите — сделать у всех так`}
      className={cn(
        base,
        "group/cell relative cursor-pointer hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
        odd && "hover:bg-primary/20",
      )}
    >
      {body}
      <Wand2
        aria-hidden
        className="absolute top-1.5 right-1.5 size-3.5 opacity-0 transition-opacity duration-150 group-hover/cell:opacity-70 group-focus-visible/cell:opacity-70"
      />
    </button>
  );
}

export function CompareDialog() {
  const { open, ids, close, remove } = useCompare();
  const canvas = useChainsStore((s) => s.canvas);
  const domain = useChainsStore((s) => s.domain);
  const meta = useTaskMeta(domain);
  const errors = useFullTasks(ids, open);
  const [onlyDiffs, setOnlyDiffs] = useState(true);
  const [layout, setLayoutState] = useState<CompareLayout>(readLayout);
  const [resizing, setResizing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  function setLayout(next: CompareLayout) {
    setLayoutState(next);
    writeLayout(next);
  }

  /**
   * Растягивание за уголок. Окно стоит по центру, поэтому растёт в обе стороны:
   * сдвиг мыши на N пикселей меняет размер на 2N.
   */
  function startResize(e: React.PointerEvent<HTMLDivElement>) {
    const box = contentRef.current?.getBoundingClientRect();
    if (!box || e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const start = { x: e.clientX, y: e.clientY, w: box.width, h: box.height };
    let size = clampSize(start.w, start.h);
    setResizing(true);
    const onMove = (ev: PointerEvent) => {
      size = clampSize(start.w + (ev.clientX - start.x) * 2, start.h + (ev.clientY - start.y) * 2);
      setLayoutState((l) => ({ ...l, full: false, size }));
    };
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      setResizing(false);
      setLayoutState((l) => {
        const next = { ...l, full: false, size };
        writeLayout(next);
        return next;
      });
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  }

  const columns = ids.map((id) => ({
    id,
    name: canvas[id]?.name || `#${id}`,
    task: canvas[id]?.full ?? null,
  }));
  const loaded = columns.filter((c) => c.task);
  const pending = columns.filter((c) => !c.task && !errors[c.id]);

  const ctx = useMemo<BulkContext>(() => {
    const bonuses = new Map((meta.data?.bonuses ?? []).map((b) => [b.id, b.title]));
    return { bonusTitle: (id) => bonuses.get(id) };
  }, [meta.data]);

  // Пересчёт дешёвый (десятки задач × десятки строк) — свежие данные после правки сразу видны.
  const rows = buildCompareRows(
    loaded.map((c) => c.task as TaskLike),
    ctx,
  );
  const diffCount = rows.filter((r) => r.variants > 1).length;
  const sections = groupCompareRows(rows, onlyDiffs);

  function fix(op: BulkOp) {
    const taskIds = loaded.map((c) => c.id);
    close();
    useBulkEdit.getState().show(taskIds, {
      seed: [op],
      onClose: () => useCompare.getState().show(taskIds),
    });
  }

  function cellOdd(row: CompareRow, text: string): boolean {
    return row.variants > 1 && text !== row.majority;
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent
        ref={contentRef}
        className={cn(
          "max-w-none gap-0 overflow-hidden p-0 transition-[width,height] duration-200 ease-out",
          resizing && "transition-none select-none",
          layout.full
            ? "h-[calc(100vh-32px)] w-[calc(100vw-32px)]"
            : !layout.size && "h-[min(90vh,900px)] w-[min(96vw,1440px)]",
        )}
        style={
          !layout.full && layout.size
            ? {
                width: `min(${layout.size.w}px, calc(100vw - ${EDGE * 2}px))`,
                height: `min(${layout.size.h}px, calc(100vh - ${EDGE * 2}px))`,
              }
            : undefined
        }
      >
        <button
          type="button"
          onClick={() => setLayout({ ...layout, full: !layout.full })}
          aria-label={layout.full ? "Свернуть окно" : "Развернуть на весь экран"}
          title={layout.full ? "Свернуть окно" : "Развернуть на весь экран"}
          className="absolute top-3 right-10 z-10 cursor-pointer rounded-chip p-1 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
        >
          {layout.full ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        </button>
        <header className="flex flex-col gap-3 border-b border-border px-5 pt-4 pb-3">
          <div className="flex flex-col gap-0.5 pr-16">
            <DialogTitle>
              Сравнение · {ids.length} {plural(ids.length, "задача", "задачи", "задач")}
            </DialogTitle>
            <DialogDescription>
              Оранжевым — значение, которое отличается от большинства. Клик по ячейке — сделать у
              всех так (откроется массовая правка с предпросмотром).
            </DialogDescription>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Segmented
              size="sm"
              value={onlyDiffs ? "diff" : "all"}
              onValueChange={(v) => setOnlyDiffs(v === "diff")}
              options={[
                { value: "diff", label: `Только различия · ${diffCount}` },
                { value: "all", label: `Все параметры · ${rows.length}` },
              ]}
              aria-label="Какие параметры показать"
            />
            <Segmented
              size="sm"
              value={layout.compact ? "compact" : "wide"}
              onValueChange={(v) => setLayout({ ...layout, compact: v === "compact" })}
              options={[
                { value: "compact", label: "Узкие колонки" },
                { value: "wide", label: "Широкие" },
              ]}
              aria-label="Ширина колонок"
            />
            {pending.length ? (
              <span
                className="flex items-center gap-1.5 text-caption text-muted-foreground"
                aria-live="polite"
              >
                <Loader2 className="size-3.5 animate-spin text-primary" />
                Загружаю задачи: {loaded.length} из {ids.length}
              </span>
            ) : diffCount ? (
              <span className="text-caption text-primary" aria-live="polite">
                Расходятся {diffCount} {plural(diffCount, "параметр", "параметра", "параметров")}
              </span>
            ) : null}
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-auto">
          {!loaded.length ? (
            <div className="flex h-full items-center justify-center gap-2 text-subhead text-muted-foreground">
              <Loader2 className="size-4 animate-spin text-primary" /> Загружаю задачи…
            </div>
          ) : onlyDiffs && !sections.length && !pending.length ? (
            <div className="flex h-full animate-fade-in flex-col items-center justify-center gap-2 text-center">
              <CheckCircle2 className="size-9 text-success" />
              <p className="text-headline">Все параметры совпадают</p>
              <p className="text-subhead text-muted-foreground">
                Отличаются только название, frontend_identifier и тексты локалей.
              </p>
            </div>
          ) : (
            <table className="animate-fade-in border-separate border-spacing-0 text-left">
              <thead>
                <tr>
                  <th
                    className={cn(
                      "sticky top-0 left-0 z-30 border-r border-b border-border bg-surface px-3 py-2 text-caption font-semibold text-muted-foreground",
                      layout.compact ? "w-44 min-w-44" : "w-56 min-w-56",
                    )}
                  >
                    Параметр
                  </th>
                  {loaded.map((col) => (
                    <th
                      key={col.id}
                      scope="col"
                      className={cn(
                        "sticky top-0 z-20 border-b border-border bg-surface px-2 py-2 align-top font-normal",
                        layout.compact ? "w-40 min-w-40" : "w-52 min-w-52",
                      )}
                    >
                      <div className="flex items-start gap-1">
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="font-mono text-caption text-muted-foreground">
                            #{col.id}
                          </span>
                          <span
                            className={cn(
                              "line-clamp-2 font-semibold",
                              layout.compact ? "text-caption" : "text-subhead",
                            )}
                            title={col.name}
                          >
                            {col.name}
                          </span>
                        </div>
                        {loaded.length > 2 ? (
                          <button
                            type="button"
                            onClick={() => remove(col.id)}
                            aria-label={`Убрать «${col.name}» из сравнения`}
                            title="Убрать из сравнения"
                            className="shrink-0 cursor-pointer rounded-chip p-0.5 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
                          >
                            <X className="size-3.5" />
                          </button>
                        ) : null}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sections.map((section) => (
                  <SectionRows
                    key={section.id}
                    title={section.title}
                    rows={section.rows}
                    colSpan={loaded.length + 1}
                    cellOdd={cellOdd}
                    compact={layout.compact}
                    onFix={fix}
                  />
                ))}
              </tbody>
            </table>
          )}
          {Object.keys(errors).length ? (
            <p className="px-5 py-3 text-caption text-destructive">
              Не загрузились:{" "}
              {Object.entries(errors)
                .map(([id, err]) => `#${id} (${err})`)
                .join(", ")}
            </p>
          ) : null}
        </div>
        {!layout.full ? (
          <div
            role="separator"
            aria-label="Потяните, чтобы изменить размер окна"
            title="Потяните, чтобы изменить размер · двойной клик — размер по умолчанию"
            onPointerDown={startResize}
            onDoubleClick={() => setLayout({ ...layout, size: null })}
            className="absolute right-0 bottom-0 z-40 flex size-5 cursor-nwse-resize touch-none items-end justify-end p-1 text-muted-foreground/60 transition-colors hover:text-foreground"
          >
            <svg viewBox="0 0 10 10" className="size-2.5" aria-hidden>
              <path
                d="M9 1 1 9M9 5 5 9"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function SectionRows({
  title,
  rows,
  colSpan,
  cellOdd,
  compact,
  onFix,
}: {
  title: string;
  rows: CompareRow[];
  colSpan: number;
  cellOdd: (row: CompareRow, text: string) => boolean;
  compact: boolean;
  onFix: (op: BulkOp) => void;
}) {
  return (
    <>
      <tr>
        <td colSpan={colSpan} className="border-b border-border bg-surface-2/60 p-0">
          <span className="sticky left-0 inline-block px-3 py-1 text-caption font-semibold tracking-wide text-muted-foreground uppercase">
            {title}
          </span>
        </td>
      </tr>
      {rows.map((row) => (
        <tr key={row.key} className="group/row">
          <th
            scope="row"
            className="sticky left-0 z-10 border-r border-b border-border bg-surface px-3 py-1.5 align-top font-normal transition-colors group-hover/row:bg-surface-2"
          >
            <span className={cn("block", compact ? "text-caption" : "text-subhead")}>
              {row.label}
            </span>
            {row.variants > 1 ? (
              <span className="text-caption text-primary">
                {row.variants} {plural(row.variants, "вариант", "варианта", "вариантов")}
              </span>
            ) : null}
          </th>
          {row.cells.map((cell, i) => (
            <td
              key={i}
              className="border-b border-border px-1 py-1 align-top transition-colors group-hover/row:bg-surface-2/40"
            >
              <Cell
                text={cell.text}
                odd={cellOdd(row, cell.text)}
                fixable={Boolean(cell.fix) && row.variants > 1}
                compact={compact}
                onFix={() => cell.fix && onFix(cell.fix)}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
