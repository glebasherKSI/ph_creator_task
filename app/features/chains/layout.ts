/**
 * Автораскладка канвы: колонки — глубина цепочки (предшественники слева), ряды — дорожки.
 * Каждая цепочка идёт по своей дорожке, поэтому её связи — прямые горизонтальные линии.
 */
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

/** Сколько одиночных карточек (без связей) в ряду нижнего блока, не меньше. */
const LOOSE_MIN_PER_ROW = 4;

/**
 * Полная раскладка дорожками.
 * - Основной родитель задачи — тот, чья цепочка до неё длиннее (самая правая колонка).
 * - Продолжение родителя на его дорожке — ребёнок с самой длинной цепочкой дальше.
 * - Остальные дети начинают свои дорожки сразу под дорожкой родителя.
 * - Карточки дорожки центрируются по вертикали: ручки связей в центре, линии прямые.
 * - Задачи без связей — сеткой отдельным блоком внизу.
 */
export function layoutLanes(
  ids: string[],
  edges: CanvasEdge[],
  heightOf: (id: string) => number,
): Record<string, Position> {
  const byId = (a: string, b: string) => Number(a) - Number(b) || a.localeCompare(b);
  const columns = assignColumns(ids, edges);
  const col = (id: string) => columns.get(id) ?? 0;

  // Только рёбра «вперёд» — без обратных рёбер циклов граф ацикличен.
  const children = new Map<string, string[]>(ids.map((id) => [id, []]));
  const parents = new Map<string, string[]>(ids.map((id) => [id, []]));
  const linked = new Set<string>();
  for (const { from, to } of edges) {
    if (!children.has(from) || !children.has(to) || from === to) continue;
    linked.add(from).add(to);
    if (col(to) <= col(from) || children.get(from)!.includes(to)) continue;
    children.get(from)!.push(to);
    parents.get(to)!.push(from);
  }

  // Длина цепочки от задачи вправо (в карточках).
  const tailMemo = new Map<string, number>();
  const tail = (id: string): number => {
    const known = tailMemo.get(id);
    if (known !== undefined) return known;
    const value = 1 + Math.max(0, ...children.get(id)!.map(tail));
    tailMemo.set(id, value);
    return value;
  };

  const primaryParent = new Map<string, string>();
  for (const id of ids) {
    const list = parents.get(id)!;
    if (!list.length) continue;
    const best = [...list].sort((a, b) => col(b) - col(a) || byId(a, b))[0]!;
    primaryParent.set(id, best);
  }

  const continuation = new Map<string, string>();
  const branchHeads = new Map<string, string[]>();
  for (const id of ids) {
    const own = children.get(id)!.filter((c) => primaryParent.get(c) === id);
    own.sort((a, b) => tail(b) - tail(a) || byId(a, b));
    if (own[0]) continuation.set(id, own[0]);
    branchHeads.set(id, own.slice(1));
  }

  const lane = (head: string): string[] => {
    const nodes = [head];
    for (let next = continuation.get(head); next; next = continuation.get(next)) nodes.push(next);
    return nodes;
  };

  const result: Record<string, Position> = {};
  let y = GRID_START_Y;
  const placeRow = (row: string[]) => {
    const rowH = Math.max(...row.map(heightOf));
    return { rowH, top: y };
  };
  const placeLane = (head: string) => {
    const nodes = lane(head);
    const { rowH, top } = placeRow(nodes);
    for (const id of nodes) {
      result[id] = { x: columnX(col(id)), y: top + Math.round((rowH - heightOf(id)) / 2) };
    }
    y += rowH + VERTICAL_GAP;
    // Ответвления — под своей дорожкой: от ранних колонок к поздним, длинные первыми.
    const branches = nodes
      .flatMap((id) => branchHeads.get(id)!)
      .sort((a, b) => col(a) - col(b) || tail(b) - tail(a) || byId(a, b));
    for (const branch of branches) placeLane(branch);
  };

  const roots = ids
    .filter((id) => linked.has(id) && !primaryParent.has(id))
    .sort((a, b) => tail(b) - tail(a) || byId(a, b));
  for (const root of roots) placeLane(root);

  const loose = ids.filter((id) => !linked.has(id)).sort(byId);
  const maxCol = Math.max(0, ...ids.filter((id) => linked.has(id)).map(col));
  const perRow = Math.max(LOOSE_MIN_PER_ROW, maxCol + 1);
  for (let i = 0; i < loose.length; i += perRow) {
    const row = loose.slice(i, i + perRow);
    const { rowH, top } = placeRow(row);
    row.forEach((id, index) => {
      result[id] = { x: columnX(index), y: top };
    });
    y += rowH + VERTICAL_GAP;
  }
  return result;
}

/**
 * Раскладка дорожками только `ids` (связи — между ними): блок встаёт на место
 * левого верхнего угла выделения, остальные карточки не двигаются.
 */
export function layoutSelection(
  canvas: Record<string, CanvasTask>,
  edges: CanvasEdge[],
  ids: string[],
  heights: Record<string, number> = {},
): Record<string, Position> {
  const present = ids.filter((id) => canvas[id]);
  if (!present.length) return {};
  const lanes = layoutLanes(present, edges, (id) => heights[id] ?? CARD_MIN_H);
  const dx = Math.min(...present.map((id) => canvas[id]!.x)) - GRID_START_X;
  const dy = Math.min(...present.map((id) => canvas[id]!.y)) - GRID_START_Y;
  const result: Record<string, Position> = {};
  for (const [id, pos] of Object.entries(lanes)) result[id] = { x: pos.x + dx, y: pos.y + dy };
  return result;
}

/** Измеренные React Flow высоты карточек (для раскладки без наложений). */
export function measuredHeights(
  nodes: ReadonlyArray<{ id: string; measured?: { height?: number } }>,
): Record<string, number> {
  const heights: Record<string, number> = {};
  for (const node of nodes) if (node.measured?.height) heights[node.id] = node.measured.height;
  return heights;
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
  if (moveSet.size === allIds.length) return layoutLanes(allIds, edges, heightOf);

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
