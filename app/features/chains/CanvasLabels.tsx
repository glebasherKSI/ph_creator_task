/**
 * Подписи на канве как ноды React Flow второго типа (`type: "label"`): перетаскивание и зум
 * бесплатно. Двойной клик — правка (Enter/blur — принять, Escape — отменить), × или Delete —
 * удалить. Плюс контекстное меню пустой области канвы («Добавить подпись») и хук добавления.
 */
import { type Node, type NodeProps, useReactFlow, useStoreApi } from "@xyflow/react";
import { Tag, X } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import type { CanvasLabel } from "@/lib/storage";
import { cn } from "@/lib/utils";

import { LABEL_MAX_LENGTH, useLabelsStore } from "./labels-store";
import { useChainsStore } from "./store";

export type LabelNodeData = { label: CanvasLabel };
export type LabelFlowNode = Node<LabelNodeData, "label">;

const NODE_PREFIX = "label:";

export function labelNodeId(labelId: string): string {
  return `${NODE_PREFIX}${labelId}`;
}

/** Id подписи из id ноды; null — это не нода подписи. */
export function parseLabelNodeId(nodeId: string): string | null {
  return nodeId.startsWith(NODE_PREFIX) ? nodeId.slice(NODE_PREFIX.length) : null;
}

/** Подписи из store → ноды React Flow (позиция и выделение — из labels-store). */
export function useLabelNodes(): LabelFlowNode[] {
  const labels = useLabelsStore((s) => s.labels);
  const selectedLabelId = useLabelsStore((s) => s.selectedLabelId);
  return useMemo(
    () =>
      labels.map((label) => ({
        id: labelNodeId(label.id),
        type: "label" as const,
        position: { x: label.x, y: label.y },
        selected: label.id === selectedLabelId,
        draggable: true,
        connectable: false,
        data: { label },
      })),
    [labels, selectedLabelId],
  );
}

export const LabelNode = memo(function LabelNode({ data, selected }: NodeProps<LabelFlowNode>) {
  const { label } = data;
  // null — не редактируется; строка — черновик текста в поле ввода.
  const [draft, setDraft] = useState<string | null>(null);

  function commit() {
    if (draft == null) return;
    useLabelsStore.getState().update(label.id, { text: draft });
    setDraft(null);
  }

  return (
    <div
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (draft == null) setDraft(label.text);
      }}
      className={cn(
        "group flex items-center gap-1.5 rounded-md border bg-surface-2 py-1 pr-1 pl-2.5 text-subhead text-foreground",
        selected ? "border-primary" : "border-transparent",
      )}
    >
      <Tag className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      {draft != null ? (
        <input
          ref={(el) => {
            el?.focus();
            el?.select();
          }}
          type="text"
          value={draft}
          maxLength={LABEL_MAX_LENGTH}
          aria-label="Текст подписи"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setDraft(null);
            }
          }}
          className="nodrag nopan w-56 rounded-chip bg-input px-1.5 py-0.5 text-subhead text-foreground outline-none"
        />
      ) : (
        <span className="max-w-[32rem] whitespace-pre-wrap">{label.text}</span>
      )}
      <button
        type="button"
        aria-label="Удалить подпись"
        title="Удалить подпись"
        onClick={(e) => {
          e.stopPropagation();
          useLabelsStore.getState().remove(label.id);
          useChainsStore.getState().setStatus("Подпись удалена");
        }}
        className={cn(
          "nodrag inline-flex size-5 cursor-pointer items-center justify-center rounded-chip text-muted-foreground transition-colors hover:bg-surface hover:text-foreground",
          !selected && "opacity-0 group-hover:opacity-100",
        )}
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
});

/** Добавляет подпись: в точке экрана (контекстное меню) или в центре видимой области. */
export function useAddLabel(): (screen?: { x: number; y: number }) => void {
  const rf = useReactFlow();
  const storeApi = useStoreApi();
  return useCallback(
    (screen) => {
      let point: { x: number; y: number };
      if (screen) {
        point = rf.screenToFlowPosition(screen);
      } else {
        const { width, height, transform } = storeApi.getState();
        const [tx, ty, zoom] = transform;
        point = { x: (width / 2 - tx) / zoom, y: (height / 2 - ty) / zoom };
      }
      useLabelsStore.getState().add(point.x, point.y);
      const chains = useChainsStore.getState();
      chains.select(null);
      chains.selectEdge(null);
      chains.setStatus("Подпись добавлена — перетащите или дважды кликните для редактирования");
    },
    [rf, storeApi],
  );
}

const MENU_W = 200;
const MENU_H = 48;

/** Контекстное меню пустой области канвы (правый клик). */
export function PaneContextMenu({
  x,
  y,
  onAddLabel,
  onClose,
}: {
  x: number;
  y: number;
  onAddLabel: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest("[data-pane-menu]")) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  return createPortal(
    <div
      data-pane-menu
      role="menu"
      aria-label="Действия с канвой"
      style={{
        left: Math.min(x, window.innerWidth - MENU_W - 8),
        top: Math.min(y, window.innerHeight - MENU_H - 8),
        width: MENU_W,
      }}
      className="fixed z-50 rounded-md bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-border"
    >
      <button
        type="button"
        role="menuitem"
        className="flex w-full cursor-pointer items-center gap-2 rounded-chip px-2 py-1.5 text-left text-subhead text-foreground hover:bg-surface-2"
        onClick={() => {
          onAddLabel();
          onClose();
        }}
      >
        <Tag className="size-4 text-muted-foreground" /> Добавить подпись
      </button>
    </div>,
    document.body,
  );
}
