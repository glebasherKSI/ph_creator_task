/**
 * Канва на React Flow. Ноды и рёбра — производные от useChainsStore (единственный источник правды):
 * позиции, выделение и связи уходят в store, локально хранятся только измеренные размеры нод.
 */
import {
  Background,
  BackgroundVariant,
  ConnectionLineType,
  Controls,
  type Edge,
  MarkerType,
  MiniMap,
  type OnBeforeDelete,
  type OnConnect,
  type OnEdgesChange,
  type OnNodesChange,
  type OnNodesDelete,
  ReactFlow,
} from "@xyflow/react";
import { Loader2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { cn } from "@/lib/utils";

import {
  type LabelFlowNode,
  LabelNode,
  PaneContextMenu,
  parseLabelNodeId,
  useAddLabel,
  useLabelNodes,
} from "./CanvasLabels";
import { conditionSources, edgeKey } from "./graph";
import { useLabelsStore } from "./labels-store";
import { type AddProgress, useChainsStore } from "./store";
import { type TaskFlowNode, TaskNode } from "./TaskNode";
import { useTaskSheet } from "./TaskSheet";

const nodeTypes = { task: TaskNode, label: LabelNode };

/**
 * Прогресс загрузки задач перед добавлением на канву. Всегда в разметке —
 * плавно появляется и исчезает; канва под ним затемняется и не принимает клики.
 */
function AddProgressOverlay() {
  const progress = useChainsStore((s) => s.addProgress);
  const [shown, setShown] = useState<AddProgress | null>(progress);
  // «Состояние из прошлого рендера»: при исчезновении показываем последний прогресс.
  if (progress && progress !== shown) setShown(progress);

  const open = progress != null;
  const view = progress ?? shown;
  const done = open ? (view?.done ?? 0) : (view?.total ?? 0);
  const total = view?.total ?? 0;
  const percent = total ? Math.round((done / total) * 100) : 0;

  return (
    <div
      aria-hidden={!open}
      className={cn(
        "absolute inset-0 z-20 flex items-center justify-center bg-background/60 backdrop-blur-[2px] transition-opacity duration-300 ease-out",
        open ? "opacity-100" : "pointer-events-none opacity-0",
      )}
    >
      <div
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Загрузка задач для канвы"
        className={cn(
          "flex w-80 flex-col gap-3 rounded-lg bg-surface p-4 shadow-xl ring-1 ring-border transition-transform duration-300 ease-out",
          open ? "scale-100" : "scale-95",
        )}
      >
        <div className="flex items-center gap-2">
          <Loader2 className="size-4 animate-spin text-primary" />
          <span className="text-headline">Загружаю задачи</span>
          <span className="ml-auto font-semibold text-primary tabular-nums">{percent}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
            style={{ width: `${percent}%` }}
          />
        </div>
        <div className="text-caption text-muted-foreground tabular-nums">
          {done} из {total} · затем добавлю на канву и выровняю
        </div>
      </div>
    </div>
  );
}

type CanvasFlowNode = TaskFlowNode | LabelFlowNode;

type Measured = Record<string, { width: number; height: number }>;

/** Тёмная тема React Flow через собственные переменные → токены дизайн-системы. */
const FLOW_THEME = `
.chains-flow.react-flow {
  --xy-background-color-default: var(--background);
  --xy-background-pattern-dots-color-default: color-mix(in srgb, var(--muted-foreground) 35%, transparent);
  --xy-edge-stroke-default: var(--muted-foreground);
  --xy-edge-stroke-width-default: 1.5;
  --xy-edge-stroke-selected-default: var(--primary);
  --xy-connectionline-stroke-default: var(--primary);
  --xy-connectionline-stroke-width-default: 2;
  --xy-handle-background-color-default: var(--primary);
  --xy-handle-border-color-default: var(--background);
  --xy-controls-button-background-color-default: var(--surface);
  --xy-controls-button-background-color-hover-default: var(--surface-2);
  --xy-controls-button-color-default: var(--foreground);
  --xy-controls-button-color-hover-default: var(--foreground);
  --xy-controls-button-border-color-default: var(--border);
  --xy-controls-box-shadow-default: none;
  --xy-minimap-background-color-default: var(--surface);
  --xy-minimap-mask-background-color-default: color-mix(in srgb, var(--background) 70%, transparent);
  --xy-minimap-mask-stroke-color-default: var(--border);
  --xy-minimap-node-background-color-default: var(--surface-2);
  --xy-minimap-node-stroke-color-default: var(--border);
  --xy-selection-background-color-default: color-mix(in srgb, var(--primary) 10%, transparent);
  --xy-selection-border-default: 1px solid var(--primary);
  --xy-attribution-background-color-default: transparent;
  --xy-node-boxshadow-selected-default: none;
  --xy-node-boxshadow-hover-default: none;
}
.chains-flow .react-flow__attribution a { color: var(--muted-foreground); }
.chains-flow .react-flow__minimap { border-radius: var(--radius-chip); overflow: hidden; }
.chains-flow .react-flow__controls { border-radius: var(--radius-chip); overflow: hidden; }
.chains-flow .react-flow__controls-button svg { fill: currentColor; }
.chains-flow .react-flow__handle { pointer-events: all; }
`;

function parseEdgeId(id: string): { from: string; to: string } | null {
  const idx = id.indexOf("->");
  if (idx < 0) return null;
  return { from: id.slice(0, idx), to: id.slice(idx + 2) };
}

export function FlowCanvas() {
  const canvas = useChainsStore((s) => s.canvas);
  const storeEdges = useChainsStore((s) => s.edges);
  const catalog = useChainsStore((s) => s.catalog);
  const dirtyTargets = useChainsStore((s) => s.dirtyTargets);
  const selectedIds = useChainsStore((s) => s.selectedIds);
  const selectedEdge = useChainsStore((s) => s.selectedEdge);
  const detachedDeps = useChainsStore((s) => s.detachedDeps);
  const [measured, setMeasured] = useState<Measured>({});
  const [paneMenu, setPaneMenu] = useState<{ x: number; y: number } | null>(null);
  const closePaneMenu = useCallback(() => setPaneMenu(null), []);
  const addLabel = useAddLabel();
  const labelNodes = useLabelNodes();

  const nodes = useMemo<TaskFlowNode[]>(() => {
    const incoming: Record<string, string[]> = {};
    const outgoing: Record<string, string[]> = {};
    const offIncoming: Record<string, string[]> = {};
    const offOutgoing: Record<string, string[]> = {};
    for (const e of storeEdges) {
      (incoming[e.to] ??= []).push(e.from);
      (outgoing[e.from] ??= []).push(e.to);
    }
    // Связи с задачами вне канвы: входящие — из своих conditions, исходящие — из памяти убранных.
    for (const task of Object.values(canvas)) {
      for (const from of conditionSources(task)) {
        if (!canvas[from]) (offIncoming[task.id] ??= []).push(from);
      }
    }
    for (const [to, sources] of Object.entries(detachedDeps)) {
      if (canvas[to]) continue;
      for (const from of sources) if (canvas[from]) (offOutgoing[from] ??= []).push(to);
    }
    return Object.values(canvas).map((task) => ({
      id: task.id,
      type: "task" as const,
      position: { x: task.x, y: task.y },
      selected: selectedIds.includes(task.id),
      measured: measured[task.id],
      data: {
        task,
        meta: catalog[task.id] ?? null,
        incoming: incoming[task.id] ?? [],
        outgoing: outgoing[task.id] ?? [],
        offIncoming: offIncoming[task.id] ?? [],
        offOutgoing: offOutgoing[task.id] ?? [],
        dirty: dirtyTargets.includes(task.id),
      },
    }));
  }, [canvas, storeEdges, catalog, dirtyTargets, selectedIds, measured, detachedDeps]);

  const allNodes = useMemo<CanvasFlowNode[]>(() => [...nodes, ...labelNodes], [nodes, labelNodes]);

  const edges = useMemo<Edge[]>(
    () =>
      storeEdges.map((e) => {
        const isSelected = selectedEdge?.from === e.from && selectedEdge?.to === e.to;
        const dirty = dirtyTargets.includes(e.to);
        const stroke = isSelected ? "var(--primary)" : "var(--muted-foreground)";
        return {
          id: edgeKey(e.from, e.to),
          source: e.from,
          target: e.to,
          type: "smoothstep",
          animated: false,
          selected: isSelected,
          markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: 18, height: 18 },
          style: {
            stroke,
            strokeWidth: isSelected ? 2.5 : 1.5,
            strokeDasharray: dirty ? "6 4" : undefined,
          },
        };
      }),
    [storeEdges, selectedEdge, dirtyTargets],
  );

  const onNodesChange = useCallback<OnNodesChange<CanvasFlowNode>>((changes) => {
    // Выделение копим за весь пакет изменений: рамка/Shift+клик дают несколько select сразу.
    let nextSelected: Set<string> | null = null;
    for (const change of changes) {
      const store = useChainsStore.getState();
      // Ноды подписей живут в labels-store: позиция и выделение уходят туда.
      const labelId = "id" in change ? parseLabelNodeId(change.id) : null;
      if (labelId) {
        const labels = useLabelsStore.getState();
        if (change.type === "position" && change.position) {
          labels.update(labelId, { x: change.position.x, y: change.position.y });
        } else if (change.type === "select") {
          if (change.selected) labels.select(labelId);
          else if (labels.selectedLabelId === labelId) labels.select(null);
        }
        continue;
      }
      if (change.type === "position" && change.position) {
        store.moveTask(change.id, change.position.x, change.position.y);
      } else if (change.type === "select") {
        nextSelected ??= new Set(store.selectedIds);
        if (change.selected) nextSelected.add(change.id);
        else nextSelected.delete(change.id);
      } else if (change.type === "dimensions" && change.dimensions) {
        const { width, height } = change.dimensions;
        setMeasured((prev) => {
          const known = prev[change.id];
          if (known && known.width === width && known.height === height) return prev;
          return { ...prev, [change.id]: { width, height } };
        });
      }
    }
    if (nextSelected) useChainsStore.getState().setSelectedIds([...nextSelected]);
  }, []);

  const onEdgesChange = useCallback<OnEdgesChange<Edge>>((changes) => {
    for (const change of changes) {
      if (change.type !== "select") continue;
      const store = useChainsStore.getState();
      const parsed = parseEdgeId(change.id);
      if (!parsed) continue;
      // Связь выбирается только кликом (onEdgeClick): рамка и множественное выделение
      // помечают и связи между карточками — их пропускаем.
      if (change.selected) continue;
      if (store.selectedEdge?.from === parsed.from && store.selectedEdge?.to === parsed.to)
        store.selectEdge(null);
    }
  }, []);

  const onConnect = useCallback<OnConnect>((connection) => {
    if (connection.source && connection.target)
      useChainsStore.getState().connect(connection.source, connection.target);
  }, []);

  // Delete убирает рёбра и подписи: карточки снимаются через меню карточки или список.
  const onBeforeDelete = useCallback<OnBeforeDelete<CanvasFlowNode, Edge>>(
    async ({ nodes: toDeleteNodes, edges: toDelete }) => ({
      nodes: toDeleteNodes.filter((n) => n.type === "label"),
      // Только явно выбранная связь: React Flow добавляет сюда и связи выделенных карточек.
      edges: toDelete.filter((e) => e.selected),
    }),
    [],
  );

  const onNodesDelete = useCallback<OnNodesDelete<CanvasFlowNode>>((deleted) => {
    const labels = useLabelsStore.getState();
    let removed = 0;
    for (const node of deleted) {
      const labelId = parseLabelNodeId(node.id);
      if (!labelId) continue;
      labels.remove(labelId);
      removed += 1;
    }
    if (removed) useChainsStore.getState().setStatus("Подпись удалена");
  }, []);

  const onEdgesDelete = useCallback((deleted: Edge[]) => {
    const store = useChainsStore.getState();
    for (const e of deleted) store.disconnect(e.source, e.target);
  }, []);

  const onPaneClick = useCallback(() => {
    const store = useChainsStore.getState();
    store.select(null);
    store.selectEdge(null);
    useLabelsStore.getState().select(null);
  }, []);

  return (
    // contain: strict — сотни карточек не участвуют в пересчёте раскладки остальной страницы
    // (открытие списков в панели задачи над канвой).
    <div className="relative h-full min-h-0 w-full overflow-hidden rounded-lg bg-background ring-1 ring-border [contain:strict]">
      <style>{FLOW_THEME}</style>
      <ReactFlow<CanvasFlowNode, Edge>
        className="chains-flow"
        nodes={allNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onBeforeDelete={onBeforeDelete}
        onNodesDelete={onNodesDelete}
        onEdgesDelete={onEdgesDelete}
        onNodeDragStop={(_, node) => {
          if (node.type !== "label") void useChainsStore.getState().persistPositions();
        }}
        onNodeClick={(_, node) => {
          if (node.type !== "label") useChainsStore.getState().select(node.id);
        }}
        onNodeDoubleClick={(_, node) => {
          if (node.type !== "label") useTaskSheet.getState().open("edit", node.id);
        }}
        onEdgeClick={(_, edge) =>
          useChainsStore.getState().selectEdge({ from: edge.source, to: edge.target })
        }
        onPaneClick={onPaneClick}
        onPaneContextMenu={(e) => {
          e.preventDefault();
          setPaneMenu({ x: e.clientX, y: e.clientY });
        }}
        connectionLineType={ConnectionLineType.SmoothStep}
        defaultEdgeOptions={{ type: "smoothstep" }}
        deleteKeyCode={["Delete", "Backspace"]}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        minZoom={0.2}
        maxZoom={2}
        colorMode="dark"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.5} />
        <Controls showInteractive={false} />
        {allNodes.length ? <MiniMap pannable zoomable /> : null}
      </ReactFlow>
      <AddProgressOverlay />
      {paneMenu ? (
        <PaneContextMenu
          x={paneMenu.x}
          y={paneMenu.y}
          onAddLabel={() => addLabel(paneMenu)}
          onClose={closePaneMenu}
        />
      ) : null}
      {nodes.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
          <p className="max-w-sm text-center text-subhead text-muted-foreground">
            Канва пуста. Отметьте задачи в списке слева и нажмите «Добавить выбранные на канву».
            Связь — перетащите «Выход» одной карточки на «Вход» другой.
          </p>
        </div>
      ) : null}
    </div>
  );
}
