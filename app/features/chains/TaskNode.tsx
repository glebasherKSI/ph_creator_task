/**
 * Карточка задачи на канве (нода React Flow): шапка с id и бейджами, название,
 * мета-сетка, чипы входящих/исходящих связей и контекстное меню (правка, копия, цвет, убрать).
 */
import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { Calendar, Clock, Coins, Copy, Pencil, Trash2, X } from "lucide-react";
import { memo, useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCardDateTime } from "@/lib/format";
import { isSequenceType } from "@/lib/tasks";
import { cn } from "@/lib/utils";

import type { CanvasTask } from "./graph";
import { type CatalogTask, HEADER_COLORS, useChainsStore } from "./store";
import { useTaskSheet } from "./TaskSheet";

export type TaskNodeData = {
  task: CanvasTask;
  meta: CatalogTask | null;
  incoming: string[];
  outgoing: string[];
  dirty: boolean;
};

export type TaskFlowNode = Node<TaskNodeData, "task">;

/** Пресеты цвета шапки → классы по токенам (у фиолетового/бирюзового/розового/янтарного токенов нет). */
const HEADER_BG: Record<string, string> = {
  green: "bg-success/25",
  orange: "bg-primary/25",
  purple: "bg-violet-500/25",
  red: "bg-destructive/25",
  teal: "bg-teal-500/25",
  gray: "bg-muted-foreground/25",
  pink: "bg-pink-500/25",
  amber: "bg-amber-500/25",
};

const SWATCH_BG: Record<string, string> = {
  green: "bg-success",
  orange: "bg-primary",
  purple: "bg-violet-500",
  red: "bg-destructive",
  teal: "bg-teal-500",
  gray: "bg-muted-foreground",
  pink: "bg-pink-500",
  amber: "bg-amber-500",
};

/** Последнее число в main_bonus_group_id («…:Награда 5») — как parseBonusPointsFromGroupId в legacy. */
export function parseBonusPointsFromGroupId(groupId: unknown): number | null {
  if (!groupId || typeof groupId !== "string") return null;
  const parts = groupId.split(":");
  const namePart = (parts.length >= 2 ? parts[1]! : groupId).trim();
  const match = namePart.match(/(\d+)\s*$/);
  if (!match) return null;
  const points = Number(match[1]);
  return Number.isFinite(points) ? points : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function MetaField({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="inline-flex items-center gap-1 text-caption text-muted-foreground">
        <Icon className="size-3 shrink-0" />
        {label}
      </span>
      <span className="truncate text-subhead text-foreground tabular-nums">{value}</span>
    </div>
  );
}

function DepChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-chip bg-surface-2 px-1.5 py-0.5 font-mono text-caption text-foreground">
      {children}
    </span>
  );
}

const MENU_W = 224;
const MENU_H = 200;

function ContextMenu({
  x,
  y,
  task,
  onClose,
}: {
  x: number;
  y: number;
  task: CanvasTask;
  onClose: () => void;
}) {
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest("[data-task-menu]")) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  const store = useChainsStore.getState();
  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };
  const current = task.headerColor ?? "";

  const item =
    "flex w-full cursor-pointer items-center gap-2 rounded-chip px-2 py-1.5 text-left text-subhead text-foreground hover:bg-surface-2";

  return createPortal(
    <div
      data-task-menu
      role="menu"
      aria-label={`Действия с задачей #${task.id}`}
      style={{ left: x, top: y, width: MENU_W }}
      className="fixed z-50 rounded-md bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-border"
    >
      <button
        type="button"
        role="menuitem"
        className={item}
        onClick={run(() => useTaskSheet.getState().open("edit", task.id))}
      >
        <Pencil className="size-4 text-muted-foreground" /> Открыть (правка)
      </button>
      <button
        type="button"
        role="menuitem"
        className={item}
        onClick={run(() => useTaskSheet.getState().open("copy", task.id))}
      >
        <Copy className="size-4 text-muted-foreground" /> Создать копию…
      </button>

      <div className="my-1 border-t border-border" />
      <div className="px-2 pt-1 pb-0.5 text-caption text-muted-foreground">Цвет шапки</div>
      <div className="flex flex-wrap gap-1.5 px-2 pb-1.5" role="group" aria-label="Цвет шапки">
        <button
          type="button"
          role="menuitemradio"
          aria-checked={current === ""}
          aria-label="По умолчанию"
          title="По умолчанию"
          onClick={run(() => store.setHeaderColor(task.id, null))}
          className={cn(
            "size-5 cursor-pointer rounded-full border border-muted-foreground/60 bg-surface",
            current === "" && "ring-2 ring-primary ring-offset-1 ring-offset-popover",
          )}
        />
        {HEADER_COLORS.map((c) => (
          <button
            key={c.id}
            type="button"
            role="menuitemradio"
            aria-checked={current === c.id}
            aria-label={c.label}
            title={c.label}
            onClick={run(() => store.setHeaderColor(task.id, c.id))}
            className={cn(
              "size-5 cursor-pointer rounded-full",
              SWATCH_BG[c.id],
              current === c.id && "ring-2 ring-primary ring-offset-1 ring-offset-popover",
            )}
          />
        ))}
      </div>

      <div className="my-1 border-t border-border" />
      <button
        type="button"
        role="menuitem"
        className={cn(item, "text-destructive hover:text-destructive")}
        onClick={run(() => store.removeFromCanvas([task.id]))}
      >
        <Trash2 className="size-4" /> Убрать с канвы
      </button>
    </div>,
    document.body,
  );
}

export const TaskNode = memo(function TaskNode({ data, selected }: NodeProps<TaskFlowNode>) {
  const { task, meta, incoming, outgoing, dirty } = data;
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  const full = task.full;
  const sequence = isSequenceType(full?.type ?? meta?.type);
  const localOnly = task.localOnly === true;
  const from = formatCardDateTime(str(full?.available_from) ?? meta?.available_from);
  const till = formatCardDateTime(str(full?.available_till) ?? meta?.available_till);
  const duration = full?.duration;
  const lifetime =
    full?.infinite === true
      ? "бессрочно"
      : typeof duration === "number"
        ? `${duration} мин`
        : full
          ? "—"
          : "…";
  const points = parseBonusPointsFromGroupId(
    str(full?.main_bonus_group_id) ?? meta?.main_bonus_group_id,
  );
  const loadingDeps = task.conditions == null && !localOnly;

  function onContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    useChainsStore.getState().select(task.id);
    setMenu({
      x: Math.min(e.clientX, window.innerWidth - MENU_W - 8),
      y: Math.min(e.clientY, window.innerHeight - MENU_H - 8),
    });
  }

  return (
    <div
      onContextMenu={onContextMenu}
      onDoubleClick={() => useTaskSheet.getState().open("edit", task.id)}
      className={cn(
        "w-[280px] overflow-hidden rounded-lg border bg-surface transition-colors",
        selected ? "border-primary" : "border-transparent",
        localOnly && "border-dashed border-muted-foreground/50",
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        title="Вход"
        style={{ width: 12, height: 12, borderWidth: 2 }}
      />
      <Handle
        type="source"
        position={Position.Right}
        title="Выход — перетащите к цели"
        style={{ width: 12, height: 12, borderWidth: 2 }}
      />

      {/* Шапка: id + бейджи слева, убрать справа */}
      <div
        className={cn(
          "flex items-center justify-between gap-2 py-1.5 pr-1.5 pl-3",
          HEADER_BG[task.headerColor ?? ""] ?? "bg-black/25",
        )}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="font-mono text-caption text-muted-foreground">
            #{localOnly ? "черновик" : task.id}
          </span>
          {!localOnly && task.configuredOnBackend ? (
            <Badge variant="accent" title="Настроена на бэке">
              BE
            </Badge>
          ) : null}
          {sequence ? (
            <Badge variant="neutral" title="Задание-цепочка (type: sequence)">
              Цепочка
            </Badge>
          ) : null}
          {localOnly ? (
            <Badge variant="muted" title="Только локально — не синхронизирована с бэком">
              Только локально
            </Badge>
          ) : null}
          {dirty ? (
            <span
              role="img"
              aria-label="Изменения не сохранены"
              title="Изменения не сохранены"
              className="size-2 shrink-0 rounded-full bg-primary"
            />
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Убрать с канвы"
          title="Убрать с канвы"
          className="nodrag"
          onClick={(e) => {
            e.stopPropagation();
            useChainsStore.getState().removeFromCanvas([task.id]);
          }}
        >
          <X />
        </Button>
      </div>

      {/* Тело: название и frontend_identifier */}
      <div className="px-3 pt-3 pb-2.5">
        <div className="text-headline leading-tight">{task.name || "(без названия)"}</div>
        <div className="mt-1 truncate font-mono text-caption text-muted-foreground">
          {task.frontend_identifier || "—"}
        </div>
      </div>

      {/* Мета: подписанные поля в сетке 2×2 */}
      <div className="mx-3 border-t border-border" />
      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 px-3 py-3">
        <MetaField icon={Calendar} label="Старт" value={from ?? "—"} />
        <MetaField icon={Calendar} label="Конец" value={till ?? "—"} />
        <MetaField icon={Clock} label="Время жизни" value={lifetime} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="inline-flex items-center gap-1 text-caption text-muted-foreground">
            <Coins className="size-3 shrink-0" />
            Награда
          </span>
          <span>
            {points != null ? (
              <Badge variant="accent" className="px-2 text-subhead">
                {points} б.
              </Badge>
            ) : (
              <span className="text-subhead text-foreground">—</span>
            )}
          </span>
        </div>
      </div>

      {/* Связи */}
      <div className="mx-3 border-t border-border" />
      <div className="flex flex-col gap-1.5 px-3 py-2.5 text-caption">
        {loadingDeps ? (
          <span className="text-muted-foreground">Загрузка условий…</span>
        ) : !incoming.length && !outgoing.length ? (
          <span className="text-muted-foreground">Нет входящих связей</span>
        ) : (
          <>
            {incoming.length ? (
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-muted-foreground">Зависит от:</span>
                {incoming.map((id) => (
                  <DepChip key={id}>← #{id}</DepChip>
                ))}
              </div>
            ) : null}
            {outgoing.length ? (
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-muted-foreground">Требуется для:</span>
                {outgoing.map((id) => (
                  <DepChip key={id}>→ #{id}</DepChip>
                ))}
              </div>
            ) : null}
          </>
        )}
      </div>

      {menu ? <ContextMenu x={menu.x} y={menu.y} task={task} onClose={closeMenu} /> : null}
    </div>
  );
});
