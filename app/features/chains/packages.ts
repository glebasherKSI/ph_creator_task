/** Пакеты Promo Graphic: подписи, раскладка задач пакета на канве (чистая логика). */
import {
  type OrderedPlannerTask,
  type PlannerTask,
  getPlannerPhBackendId,
  getPlannerPrerequisiteId,
  orderPlannerTasksByChain,
} from "@/lib/graphic-task-map";
import { formatCardDate } from "@/lib/format";

import { CARD_MIN_H, CARD_W, COL_GAP, GRID_START_X, GRID_START_Y, VERTICAL_GAP } from "./layout";

export interface GraphicPackage {
  id: number | string;
  name?: string;
  project_code?: string;
  kind?: string;
  status?: string;
  available_from?: string | null;
  available_till?: string | null;
  task_count?: number;
  tasks?: PlannerTask[];
}

export type PackageStatusFilter = "ready" | "" | "draft" | "archived";

export const PACKAGE_STATUS_OPTIONS: ReadonlyArray<{ value: PackageStatusFilter; label: string }> =
  [
    { value: "ready", label: "Готово для бэка" },
    { value: "", label: "Все" },
    { value: "draft", label: "Черновик" },
    { value: "archived", label: "Архив" },
  ];

export function packageKindLabel(kind: unknown): string {
  if (kind === "seasonal") return "Сезонные";
  if (kind === "permanent") return "Постоянные";
  return kind ? String(kind) : "—";
}

export function packageStatusLabel(status: unknown): string {
  if (status === "ready") return "Готово";
  if (status === "draft") return "Черновик";
  if (status === "archived") return "Архив";
  return status ? String(status) : "—";
}

export function formatPackageDates(pkg: GraphicPackage): string {
  const from = formatCardDate(pkg.available_from) || "—";
  const till = formatCardDate(pkg.available_till) || "—";
  return `${from} → ${till}`;
}

export function packageSubtitle(pkg: GraphicPackage): string {
  return [
    pkg.project_code || "—",
    packageKindLabel(pkg.kind),
    packageStatusLabel(pkg.status),
    formatPackageDates(pkg),
    `${pkg.task_count ?? 0} задач`,
  ].join(" · ");
}

export function extractPackages(data: unknown): GraphicPackage[] {
  const list = (data as { packages?: unknown } | null)?.packages;
  return Array.isArray(list) ? (list as GraphicPackage[]) : [];
}

export function extractPackageTasks(data: unknown): PlannerTask[] {
  const list = (data as { tasks?: unknown } | null)?.tasks;
  return Array.isArray(list) ? (list as PlannerTask[]) : [];
}

/** Начало стопки новых карточек — под самой нижней карточкой канвы. */
export function nextStackOrigin(
  canvas: Record<string, { y: number }>,
  heights: Record<string, number> = {},
): { x: number; y: number } {
  let y = GRID_START_Y;
  for (const [id, task] of Object.entries(canvas)) {
    const bottom = task.y + (heights[id] ?? CARD_MIN_H) + VERTICAL_GAP;
    if (Number.isFinite(bottom) && bottom > y) y = bottom;
  }
  return { x: GRID_START_X, y };
}

export interface PlannedPlacement {
  task: PlannerTask;
  depth: number;
  x: number;
  y: number;
  /** id на бэке, если планировщик уже создал задачу. */
  phBackendId: number | null;
}

/** Порядок и позиции задач пакета: предшественники левее, колонки по глубине цепочки. */
export function planPackagePlacement(
  tasks: PlannerTask[],
  origin: { x: number; y: number },
): PlannedPlacement[] {
  const ordered: OrderedPlannerTask[] = orderPlannerTasksByChain(tasks);
  const rowsByDepth = new Map<number, number>();
  return ordered.map(({ task, depth }) => {
    const row = rowsByDepth.get(depth) ?? 0;
    rowsByDepth.set(depth, row + 1);
    return {
      task,
      depth,
      x: origin.x + depth * (CARD_W + COL_GAP),
      y: origin.y + row * (CARD_MIN_H + VERTICAL_GAP),
      phBackendId: getPlannerPhBackendId(task),
    };
  });
}

export interface PlannerLink {
  /** id карточки-цели на канве. */
  targetId: string;
  /** planner id предшественника. */
  prereqPlannerId: number;
  targetLabel: string;
  /** Цикл в графике — связь не переносится. */
  cycle: boolean;
}

export function plannerTaskLabel(task: PlannerTask | null | undefined, fallback: string): string {
  return String(task?.name_backend || task?.name_internal || fallback);
}

/** Связи «предшественник → задача» из графика для задач, попавших на канву. */
export function collectPlannerLinks(
  placements: ReadonlyArray<PlannedPlacement>,
  canvasIdByPlannerId: ReadonlyMap<number, string>,
): PlannerLink[] {
  const depthByPlannerId = new Map(placements.map((p) => [Number(p.task.id), p.depth]));
  const links: PlannerLink[] = [];
  for (const { task, depth } of placements) {
    const prereqId = getPlannerPrerequisiteId(task);
    if (prereqId == null) continue;
    const targetId = canvasIdByPlannerId.get(Number(task.id));
    if (!targetId) continue;
    const prereqDepth = depthByPlannerId.get(prereqId);
    links.push({
      targetId,
      prereqPlannerId: prereqId,
      targetLabel: plannerTaskLabel(task, `#${task.id}`),
      cycle: prereqDepth != null && prereqDepth >= depth,
    });
  }
  return links;
}
