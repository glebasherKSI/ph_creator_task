/** Каталог задач: поиск, фильтр статуса, виртуализированный список, «Загрузить ещё». */
import { useVirtualizer } from "@tanstack/react-virtual";
import { Loader2, Search } from "lucide-react";
import { useRef } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { typeLabel } from "@/lib/labels-ru";
import type { GamificationTask } from "@/lib/types";
import { cn } from "@/lib/utils";

import type { StatusFilter, TaskListState } from "./useTaskList";

const ROW_HEIGHT = 64;

function stateVariant(state: string): "success" | "muted" | "neutral" {
  if (state === "active") return "success";
  if (state === "draft") return "muted";
  return "neutral";
}

function TaskRow({
  task,
  active,
  onSelect,
}: {
  task: GamificationTask;
  active: boolean;
  onSelect: () => void;
}) {
  const state = String(task.state ?? "draft").toLowerCase();
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex h-full w-full cursor-pointer flex-col justify-center gap-1 rounded-md border px-3 text-left outline-none transition-colors",
        "focus-visible:ring-2 focus-visible:ring-ring/60",
        active ? "border-primary bg-surface-2" : "border-transparent hover:bg-surface-2/60",
      )}
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-caption text-muted-foreground">#{task.id}</span>
        <span className="min-w-0 flex-1 truncate text-subhead">
          {task.name || "(без названия)"}
        </span>
        <Badge variant={stateVariant(state)}>{state}</Badge>
      </div>
      <div className="flex items-center gap-2 text-caption text-muted-foreground">
        <span className="min-w-0 truncate font-mono">{task.frontend_identifier || "—"}</span>
        {task.type === "sequence" ? <Badge variant="neutral">{typeLabel("sequence")}</Badge> : null}
      </div>
    </button>
  );
}

export function TaskList({
  list,
  activeId,
  onSelect,
  onLoad,
  onLoadMore,
  disabled,
}: {
  list: TaskListState;
  activeId: number | string | null;
  onSelect: (task: GamificationTask) => void;
  onLoad: () => void;
  onLoadMore: () => void;
  disabled?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const rows = list.visible;
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  return (
    <aside className="flex h-full min-h-0 flex-col gap-3 rounded-lg bg-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-headline">Задачи</div>
        <Button variant="primary" size="sm" disabled={disabled || list.loading} onClick={onLoad}>
          {list.loading ? <Loader2 className="animate-spin" /> : null}
          Загрузить задачи
        </Button>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={list.query}
          onChange={(e) => list.setQuery(e.target.value)}
          placeholder="name, id, frontend_identifier"
          className="h-9 pl-8"
          aria-label="Поиск задач"
        />
      </div>

      <div className="flex items-center justify-between gap-2">
        <Segmented<StatusFilter>
          size="sm"
          value={list.statusFilter}
          onValueChange={list.setStatusFilter}
          options={[
            { value: "all", label: "Все" },
            { value: "active", label: "Активные" },
            { value: "draft", label: "Черновики" },
          ]}
          aria-label="Фильтр по статусу"
        />
        <span className="text-caption text-muted-foreground tabular-nums">
          {rows.length} из {list.tasks.length}
          {list.hidden ? `, скрыто ${list.hidden}` : ""}
        </span>
      </div>

      {list.error ? <p className="text-caption text-destructive">{list.error}</p> : null}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <div className="py-6 text-center text-subhead text-muted-foreground">
            {list.tasks.length ? "Ничего не найдено по фильтру" : "Список пуст — загрузите задачи"}
          </div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((item) => {
              const task = rows[item.index]!;
              return (
                <div
                  key={String(task.id)}
                  className="pb-1"
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: item.size,
                    transform: `translateY(${item.start}px)`,
                  }}
                >
                  <TaskRow
                    task={task}
                    active={activeId != null && String(activeId) === String(task.id)}
                    onSelect={() => onSelect(task)}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-caption text-muted-foreground">offset: {list.offset}</span>
        <Button
          variant="secondary"
          size="sm"
          disabled={!list.hasMore || list.loading}
          onClick={onLoadMore}
        >
          Загрузить ещё
        </Button>
      </div>
    </aside>
  );
}
