/** Каталог задач домена: поиск, фильтр статуса, отметка и добавление на канву. */
import { useVirtualizer } from "@tanstack/react-virtual";
import { Check, Crosshair, Loader2, Search } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { typeLabel } from "@/lib/labels-ru";
import { isSequenceType } from "@/lib/tasks";
import { cn } from "@/lib/utils";

import { type CatalogProgress, type CatalogTask, useChainsStore } from "./store";

type StatusFilter = "all" | "active" | "draft";

const ROW_HEIGHT = 74;

function stateVariant(state: string): "success" | "muted" | "neutral" {
  if (state === "active") return "success";
  if (state === "draft") return "muted";
  return "neutral";
}

function matches(task: CatalogTask, query: string, status: StatusFilter): boolean {
  if (status !== "all" && task.state !== status) return false;
  if (!query) return true;
  return (
    task.id.includes(query) ||
    task.name.toLowerCase().includes(query) ||
    task.frontend_identifier.toLowerCase().includes(query)
  );
}

function CatalogRow({
  task,
  checked,
  onCanvas,
  onToggle,
  onFocus,
}: {
  task: CatalogTask;
  checked: boolean;
  onCanvas: boolean;
  onToggle: () => void;
  onFocus: () => void;
}) {
  return (
    <div
      className={cn(
        "flex h-full items-center gap-2.5 rounded-md bg-surface-2/35 py-2 pr-1.5 pl-2.5 ring-1 transition-colors",
        onCanvas
          ? "ring-primary/40"
          : checked
            ? "bg-surface-2/60 ring-border"
            : "ring-border/60 hover:bg-surface-2/60 hover:ring-border",
      )}
    >
      <Checkbox
        checked={checked}
        disabled={onCanvas}
        onCheckedChange={onToggle}
        aria-label={`Выбрать задачу #${task.id}`}
      />
      <button
        type="button"
        onClick={onCanvas ? onFocus : onToggle}
        className="flex min-w-0 flex-1 cursor-pointer flex-col gap-1 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <div className="flex items-center gap-2">
          <span className="shrink-0 font-mono text-caption text-muted-foreground">#{task.id}</span>
          <span className="min-w-0 flex-1 truncate text-subhead font-medium">
            {task.name || "(без названия)"}
          </span>
          <Badge variant={stateVariant(task.state)} className="shrink-0">
            {task.state}
          </Badge>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate font-mono text-caption text-muted-foreground">
            {task.frontend_identifier || "—"}
          </span>
          {isSequenceType(task.type) ? (
            <Badge variant="muted" className="shrink-0">
              {typeLabel("sequence")}
            </Badge>
          ) : null}
          {onCanvas ? (
            <Badge variant="accent-outline" className="shrink-0">
              на канве
            </Badge>
          ) : null}
        </div>
      </button>
      {onCanvas ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Показать #${task.id} на канве`}
          title="Показать на канве"
          onClick={onFocus}
        >
          <Crosshair />
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Полоса прогресса загрузки каталога: проверка входа (бегущая) → страницы (по pagination.count).
 * Всегда в разметке: появляется и исчезает плавно (высота через grid-rows 0fr↔1fr + прозрачность);
 * при исчезновении показывает последнее состояние, дотянутое до 100 %.
 */
function CatalogProgressBar() {
  const progress = useChainsStore((s) => s.catalogProgress);
  const loaded = useChainsStore((s) => s.catalogOrder.length);
  const [shown, setShown] = useState<CatalogProgress | null>(progress);
  // «Состояние из прошлого рендера»: запоминаем последний непустой прогресс без эффектов.
  if (progress && progress !== shown) setShown(progress);

  const open = progress != null;
  const view = progress ?? shown;
  const known = view?.phase === "loading" && view.total ? view.total : null;
  const scanned = !open && known ? known : (view?.scanned ?? 0);
  const percent = known ? Math.min(100, Math.round((scanned / known) * 100)) : null;
  const label = !view
    ? ""
    : !open
      ? `Загружено · в каталоге ${loaded}`
      : view.phase === "auth"
        ? "Проверяю вход в админку…"
        : known
          ? `Просмотрено ${Math.min(scanned, known)} из ${known} · в каталоге ${loaded}`
          : `Загружаю задачи… в каталоге ${loaded}`;

  return (
    <div
      aria-hidden={!open}
      className={cn(
        "-mb-3 grid transition-[grid-template-rows,opacity,margin] duration-300 ease-out",
        open ? "mb-0 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
      )}
    >
      <div className="min-h-0 overflow-hidden">
        <div
          className="flex flex-col gap-1.5 pb-0.5"
          role="progressbar"
          aria-valuenow={percent ?? undefined}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Загрузка задач"
        >
          <div className="flex items-center justify-between gap-2 text-caption">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              {open ? (
                <Loader2 className="size-3.5 animate-spin text-primary" />
              ) : (
                <Check className="size-3.5 text-success" />
              )}
              {label}
            </span>
            {percent != null ? (
              <span className="font-semibold text-primary tabular-nums">{percent}%</span>
            ) : null}
          </div>
          <div className="relative h-1.5 overflow-hidden rounded-full bg-surface-2">
            {percent != null ? (
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
                style={{ width: `${percent}%` }}
              />
            ) : (
              <div className="absolute inset-y-0 w-1/3 animate-[progress-indeterminate_1.2s_ease-in-out_infinite] rounded-full bg-primary" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Заглушки строк, пока список пуст и идёт загрузка. */
function CatalogSkeleton() {
  return (
    <div className="flex flex-col gap-1.5" aria-hidden="true">
      {Array.from({ length: 8 }, (_, i) => (
        <div
          key={i}
          className="flex h-[68px] items-center gap-2.5 rounded-md bg-surface-2/35 px-2.5 ring-1 ring-border/60"
        >
          <div className="size-4 rounded-[4px] bg-surface-2" />
          <div className="flex flex-1 flex-col gap-2">
            <div className="flex items-center gap-2">
              <div className="h-2.5 w-10 animate-pulse rounded bg-surface-2" />
              <div
                className="h-3 flex-1 animate-pulse rounded bg-surface-2"
                style={{ maxWidth: `${55 + ((i * 17) % 35)}%` }}
              />
              <div className="h-4 w-12 animate-pulse rounded-chip bg-surface-2" />
            </div>
            <div className="h-2.5 w-24 animate-pulse rounded bg-surface-2" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function CatalogSidebar({
  onAdd,
  onFocusNode,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
}: {
  onAdd: (ids: string[]) => Promise<void>;
  onFocusNode: (id: string) => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
}) {
  const catalog = useChainsStore((s) => s.catalog);
  const order = useChainsStore((s) => s.catalogOrder);
  const canvasIds = useChainsStore(useShallow((s) => Object.keys(s.canvas)));
  const loading = useChainsStore((s) => s.catalogLoading);
  const error = useChainsStore((s) => s.catalogError);
  const hidden = useChainsStore((s) => s.catalogHidden);

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set());
  const [adding, setAdding] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const onCanvas = useMemo(() => new Set(canvasIds), [canvasIds]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return order.filter((id) => {
      const task = catalog[id];
      return task ? matches(task, q, status) : false;
    });
  }, [catalog, order, query, status]);

  // Отмеченные, которые ещё есть в каталоге и не на канве (каталог мог перезагрузиться).
  const toAdd = useMemo(
    () => [...checked].filter((id) => catalog[id] && !onCanvas.has(id)),
    [checked, catalog, onCanvas],
  );

  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function checkVisible(on: boolean) {
    setChecked((prev) => {
      const next = new Set(prev);
      for (const id of visible) {
        if (onCanvas.has(id)) continue;
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  async function add() {
    if (!toAdd.length) return;
    setAdding(true);
    try {
      await onAdd(toAdd);
      setChecked(new Set());
    } finally {
      setAdding(false);
    }
  }

  return (
    <aside className="flex h-full min-h-0 flex-col gap-3 rounded-lg bg-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-headline">Задачи</div>
        <span className="text-caption text-muted-foreground tabular-nums">
          {visible.length} из {order.length}
          {hidden ? `, скрыто ${hidden}` : ""}
          {" · "}на канве {canvasIds.length}
        </span>
      </div>

      <CatalogProgressBar />

      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="name, id, frontend_identifier"
          className="h-9 pl-8"
          aria-label="Поиск задач"
        />
      </div>

      <div className="flex items-center justify-between gap-2">
        <Segmented<StatusFilter>
          size="sm"
          value={status}
          onValueChange={setStatus}
          options={[
            { value: "all", label: "Все" },
            { value: "active", label: "Активные" },
            { value: "draft", label: "Черновики" },
          ]}
          aria-label="Фильтр по статусу"
        />
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => checkVisible(true)}>
            Все
          </Button>
          <Button variant="ghost" size="sm" onClick={() => checkVisible(false)}>
            Снять
          </Button>
        </div>
      </div>

      {error ? <p className="text-caption text-destructive">{error}</p> : null}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {visible.length === 0 && loading ? (
          <CatalogSkeleton />
        ) : visible.length === 0 ? (
          <div className="py-6 text-center text-subhead text-muted-foreground">
            {order.length ? "Ничего не найдено по фильтру" : "Список пуст — загрузите задачи"}
          </div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((item) => {
              const id = visible[item.index]!;
              const task = catalog[id]!;
              return (
                <div
                  key={id}
                  className="pb-1.5"
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: item.size,
                    transform: `translateY(${item.start}px)`,
                  }}
                >
                  <CatalogRow
                    task={task}
                    checked={checked.has(id)}
                    onCanvas={onCanvas.has(id)}
                    onToggle={() => toggle(id)}
                    onFocus={() => onFocusNode(id)}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {hasMore && onLoadMore && !loadingMore ? (
        <Button variant="ghost" size="sm" disabled={loadingMore} onClick={onLoadMore}>
          {loadingMore ? <Loader2 className="animate-spin" /> : null}
          Загрузить ещё задачи
        </Button>
      ) : null}
      <Button variant="primary" disabled={!toAdd.length || adding} onClick={() => void add()}>
        {adding ? <Loader2 className="animate-spin" /> : null}
        Добавить выбранные на канву{toAdd.length ? ` (${toAdd.length})` : ""}
      </Button>
    </aside>
  );
}
