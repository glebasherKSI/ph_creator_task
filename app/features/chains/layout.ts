/** Автораскладка канвы по колонкам: предшественники слева, последователи справа. */
import type { CanvasEdge, CanvasTask } from "./graph";

export const CARD_W = 280;
export const CARD_MIN_H = 150;
export const VERTICAL_GAP = 32;
export const COL_GAP = 90;
export const GRID_START_X = 40;
export const GRID_START_Y = 40;

export interface Position {
  x: number;
  y: number;
}

export function columnX(col: number): number {
  return GRID_START_X + col * (CARD_W + COL_GAP);
}

/** Колонка = максимальная глубина по входящим рёбрам; циклы рвутся на нулевой колонке. */
export function assignColumns(ids: string[], edges: CanvasEdge[]): Map<string, number> {
  const idSet = new Set(ids);
  const parents = new Map<string, string[]>();
  for (const id of ids) parents.set(id, []);
  for (const edge of edges) {
    if (!idSet.has(edge.from) || !idSet.has(edge.to)) continue;
    parents.get(edge.to)!.push(edge.from);
  }

  const columns = new Map<string, number>();
  const visiting = new Set<string>();
  function resolve(id: string): number {
    const known = columns.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const incoming = parents.get(id) ?? [];
    const col = incoming.length ? Math.max(...incoming.map((p) => resolve(p) + 1)) : 0;
    columns.set(id, col);
    visiting.delete(id);
    return col;
  }
  for (const id of ids) resolve(id);
  return columns;
}

function overlapsVertical(ay: number, ah: number, by: number, bh: number): boolean {
  return ay < by + bh && ay + ah > by;
}

function findFreeY(
  occupied: ReadonlyArray<{ y: number; h: number }>,
  preferredY: number,
  h: number,
): number {
  let y = preferredY;
  for (let guard = 0; guard < 200; guard += 1) {
    const blockers = occupied.filter((r) => overlapsVertical(y, h, r.y, r.h));
    if (!blockers.length) return y;
    y = Math.max(...blockers.map((r) => r.y + r.h)) + VERTICAL_GAP;
  }
  return y;
}

export interface LayoutOptions {
  /** Переложить все карточки. */
  forceAll?: boolean;
  /** Переложить только эти (остальные — как есть). */
  onlyIds?: string[] | null;
  /** Эти не двигать. */
  fixedIds?: string[] | null;
  /** Измеренные высоты карточек; без них — CARD_MIN_H. */
  heights?: Record<string, number>;
}

/**
 * Позиции карточек после раскладки. Возвращает только изменившиеся задачи.
 * Внутри колонки — по возрастанию id; если двигаем не всех, ищем свободное место под соседями.
 */
export function layoutCanvasTasks(
  canvas: Record<string, CanvasTask>,
  edges: CanvasEdge[],
  { forceAll = false, onlyIds = null, fixedIds = null, heights = {} }: LayoutOptions = {},
): Record<string, Position> {
  const allIds = Object.keys(canvas);
  if (!allIds.length) return {};
  const columns = assignColumns(allIds, edges);
  const heightOf = (id: string) => heights[id] ?? CARD_MIN_H;

  const fixedSet = new Set(fixedIds ?? []);
  const onlySet = onlyIds ? new Set(onlyIds) : null;
  const moveSet = new Set(
    forceAll ? allIds : allIds.filter((id) => !fixedSet.has(id) && (!onlySet || onlySet.has(id))),
  );
  if (!moveSet.size) return {};

  const result: Record<string, Position> = {};
  const byColumn = new Map<number, string[]>();
  for (const id of moveSet) {
    const col = columns.get(id) ?? 0;
    (byColumn.get(col) ?? byColumn.set(col, []).get(col)!).push(id);
  }

  for (const [col, colIds] of [...byColumn.entries()].sort((a, b) => a[0] - b[0])) {
    const sorted = colIds.sort((a, b) => Number(a) - Number(b));
    const allInColumn = allIds.filter((id) => columns.get(id) === col);
    const allMoving = allInColumn.every((id) => moveSet.has(id));
    const x = columnX(col);

    if (allMoving) {
      let y = GRID_START_Y;
      for (const id of sorted) {
        result[id] = { x, y };
        y += heightOf(id) + VERTICAL_GAP;
      }
      continue;
    }

    const occupied = allInColumn
      .filter((id) => !moveSet.has(id))
      .map((id) => ({ y: canvas[id]!.y, h: heightOf(id) }));
    const step = CARD_MIN_H + VERTICAL_GAP;
    sorted.forEach((id, row) => {
      const h = heightOf(id);
      const y = findFreeY(occupied, GRID_START_Y + row * step, h);
      occupied.push({ y, h });
      result[id] = { x, y };
    });
  }
  return result;
}
