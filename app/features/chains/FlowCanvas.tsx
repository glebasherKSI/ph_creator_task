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
  ReactFlow,
} from "@xyflow/react";
import { useCallback, useMemo, useState } from "react";

import { edgeKey } from "./graph";
import { useChainsStore } from "./store";
import { type TaskFlowNode, TaskNode } from "./TaskNode";
import { useTaskSheet } from "./TaskSheet";

const nodeTypes = { task: TaskNode };

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
  const [measured, setMeasured] = useState<Measured>({});

  const nodes = useMemo<TaskFlowNode[]>(() => {
    const incoming: Record<string, string[]> = {};
    const outgoing: Record<string, string[]> = {};
    for (const e of storeEdges) {
      (incoming[e.to] ??= []).push(e.from);
      (outgoing[e.from] ??= []).push(e.to);
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
        dirty: dirtyTargets.includes(task.id),
      },
    }));
  }, [canvas, storeEdges, catalog, dirtyTargets, selectedIds, measured]);

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

  const onNodesChange = useCallback<OnNodesChange<TaskFlowNode>>((changes) => {
    // Выделение копим за весь пакет изменений: рамка/Shift+клик дают несколько select сразу.
    let nextSelected: Set<string> | null = null;
    for (const change of changes) {
      const store = useChainsStore.getState();
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
      if (change.selected) store.selectEdge(parsed);
      else if (store.selectedEdge?.from === parsed.from && store.selectedEdge?.to === parsed.to)
        store.selectEdge(null);
    }
  }, []);

  const onConnect = useCallback<OnConnect>((connection) => {
    if (connection.source && connection.target)
      useChainsStore.getState().connect(connection.source, connection.target);
  }, []);

  // Delete убирает только рёбра: ноды снимаются через меню карточки или список.
  const onBeforeDelete = useCallback<OnBeforeDelete<TaskFlowNode, Edge>>(
    async ({ edges: toDelete }) => ({ nodes: [], edges: toDelete }),
    [],
  );

  const onEdgesDelete = useCallback((deleted: Edge[]) => {
    const store = useChainsStore.getState();
    for (const e of deleted) store.disconnect(e.source, e.target);
  }, []);

  const onPaneClick = useCallback(() => {
    const store = useChainsStore.getState();
    store.select(null);
    store.selectEdge(null);
  }, []);

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden rounded-lg bg-background ring-1 ring-border">
      <style>{FLOW_THEME}</style>
      <ReactFlow<TaskFlowNode, Edge>
        className="chains-flow"
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onBeforeDelete={onBeforeDelete}
        onEdgesDelete={onEdgesDelete}
        onNodeDragStop={() => void useChainsStore.getState().persistPositions()}
        onNodeClick={(_, node) => useChainsStore.getState().select(node.id)}
        onNodeDoubleClick={(_, node) => useTaskSheet.getState().open("edit", node.id)}
        onEdgeClick={(_, edge) =>
          useChainsStore.getState().selectEdge({ from: edge.source, to: edge.target })
        }
        onPaneClick={onPaneClick}
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
        {nodes.length ? <MiniMap pannable zoomable /> : null}
      </ReactFlow>
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
