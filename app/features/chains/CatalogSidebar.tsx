/** Каталог задач домена: поиск, фильтр статуса, отметка и добавление на канву. */
import { useVirtualizer } from "@tanstack/react-virtual";
import { Crosshair, Loader2, Search } from "lucide-react";
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

import { type CatalogTask, useChainsStore } from "./store";

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

export function CatalogSidebar({
  onAdd,
  onFocusNode,
}: {
  onAdd: (ids: string[]) => Promise<void>;
  onFocusNode: (id: string) => void;
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
        {visible.length === 0 ? (
          <div className="py-6 text-center text-subhead text-muted-foreground">
            {loading ? (
              <Loader2 className="mx-auto size-5 animate-spin" />
            ) : order.length ? (
              "Ничего не найдено по фильтру"
            ) : (
              "Список пуст — загрузите задачи"
            )}
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

      <Button variant="primary" disabled={!toAdd.length || adding} onClick={() => void add()}>
        {adding ? <Loader2 className="animate-spin" /> : null}
        Добавить выбранные на канву{toAdd.length ? ` (${toAdd.length})` : ""}
      </Button>
    </aside>
  );
}
