/**
 * Статистика задач: агрегация строк отчёта Reports по дням и по задачам.
 * Каждая метрика рисуется в своём мини-графике (small multiples): вовлечённость (0–100 %)
 * и оборот (~100 млн) нельзя класть на одну ось.
 */
import type { ReportRow } from "@/lib/reports";

export type SeriesType = "bar" | "line" | "area";

export interface StatsSeries {
  key: keyof StatsPoint;
  label: string;
  color: string;
  type: SeriesType;
  digits: number;
  suffix?: string;
  fixedMin?: number;
  fixedMax?: number;
}

/** Палитра под тёмную тему: различимые оттенки, акцент бренда — на успешности. */
export const SERIES: ReadonlyArray<StatsSeries> = [
  { key: "tasksCount", label: "Выдано заданий", color: "#5B9CF6", type: "bar", digits: 0 },
  { key: "tasksFinished", label: "Выполнено", color: "#34C759", type: "bar", digits: 0 },
  {
    key: "tasksFinishedPercent",
    label: "Успешность",
    color: "#FF7A1A",
    type: "line",
    digits: 1,
    suffix: "%",
    fixedMin: 0,
    fixedMax: 100,
  },
  { key: "depositsSum", label: "Сумма депозитов", color: "#30D5C8", type: "area", digits: 0 },
  { key: "depositsCount", label: "Количество депозитов", color: "#28C76F", type: "bar", digits: 0 },
  { key: "betsSum", label: "Оборот ставок", color: "#A78BFA", type: "area", digits: 0 },
];

export interface StatsPoint {
  period: string;
  tasksCount: number;
  tasksFinished: number;
  betsSum: number;
  betsCount: number;
  depositsSum: number;
  depositsCount: number;
  tasksFinishedPercent: number;
}

export interface StatsTotals {
  tasksCount: number;
  tasksFinished: number;
  depositsSum: number;
  depositsCount: number;
  betsSum: number;
  betsCount: number;
  completion: number;
}

export interface TaskStatsGroup {
  taskName: string;
  points: StatsPoint[];
  totals: StatsTotals;
}

export function parseIsoDate(value: unknown): Date | null {
  const raw = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [year, month, day] = raw.split("-").map(Number) as [number, number, number];
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateLabel(value: unknown): string {
  const date = parseIsoDate(value);
  if (!date) return String(value || "—");
  return new Intl.DateTimeFormat("ru-RU").format(date);
}

export function formatCompactDate(value: unknown): string {
  const date = parseIsoDate(value);
  if (!date) return String(value || "—");
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit" }).format(date);
}

export function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const normalized = String(value || "")
    .replace(/\s+/g, "")
    .replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Компактные подписи для осей/плиток: 98,6 млн вместо 98 641 183. */
export function formatCompact(value: unknown): string {
  const num = toNumber(value);
  const abs = Math.abs(num);
  const sign = num < 0 ? "-" : "";
  const trim = (v: number) => v.toFixed(1).replace(/\.0$/, "").replace(".", ",");
  if (abs >= 1e9) return `${sign}${trim(abs / 1e9)} млрд`;
  if (abs >= 1e6) return `${sign}${trim(abs / 1e6)} млн`;
  if (abs >= 1e3) return `${sign}${trim(abs / 1e3)} тыс`;
  return `${sign}${Math.round(abs)}`;
}

export function aggregateByPeriod(rows: ReadonlyArray<Partial<ReportRow>>): StatsPoint[] {
  const byPeriod = new Map<string, Omit<StatsPoint, "tasksFinishedPercent">>();
  for (const row of rows) {
    const period = String(row?.period || "").trim();
    if (!period) continue;
    const bucket = byPeriod.get(period) || {
      period,
      tasksCount: 0,
      tasksFinished: 0,
      betsSum: 0,
      betsCount: 0,
      depositsSum: 0,
      depositsCount: 0,
    };
    bucket.tasksCount += toNumber(row.tasksCount);
    bucket.tasksFinished += toNumber(row.tasksFinished);
    bucket.betsSum += toNumber(row.betsSum);
    bucket.betsCount += toNumber(row.betsCount);
    bucket.depositsSum += toNumber(row.depositsSum);
    bucket.depositsCount += toNumber(row.depositsCount);
    byPeriod.set(period, bucket);
  }

  return Array.from(byPeriod.values())
    .sort((a, b) => a.period.localeCompare(b.period))
    .map((point) => ({
      ...point,
      tasksFinishedPercent:
        point.tasksCount > 0 ? (point.tasksFinished / point.tasksCount) * 100 : 0,
    }));
}

export function computeTotals(points: ReadonlyArray<StatsPoint>): StatsTotals {
  const totals = points.reduce(
    (acc, point) => {
      acc.tasksCount += point.tasksCount;
      acc.tasksFinished += point.tasksFinished;
      acc.depositsSum += point.depositsSum;
      acc.depositsCount += point.depositsCount;
      acc.betsSum += point.betsSum;
      acc.betsCount += point.betsCount;
      return acc;
    },
    { tasksCount: 0, tasksFinished: 0, depositsSum: 0, depositsCount: 0, betsSum: 0, betsCount: 0 },
  );
  return {
    ...totals,
    completion: totals.tasksCount > 0 ? (totals.tasksFinished / totals.tasksCount) * 100 : 0,
  };
}

/** Строки отчёта → карточки по задачам; самые «рабочие» задания вперёд. */
export function groupStatsRowsByTask(
  rows: ReadonlyArray<Partial<ReportRow>> | null | undefined,
): TaskStatsGroup[] {
  const byTask = new Map<string, Partial<ReportRow>[]>();
  for (const row of rows || []) {
    const taskName = String(row?.name || "").trim() || "Без названия";
    const list = byTask.get(taskName) || [];
    list.push(row);
    byTask.set(taskName, list);
  }

  return Array.from(byTask.entries())
    .map(([taskName, taskRows]) => {
      const points = aggregateByPeriod(taskRows);
      return { taskName, points, totals: computeTotals(points) };
    })
    .filter((item) => item.points.length > 0)
    .sort(
      (a, b) =>
        b.totals.tasksFinished - a.totals.tasksFinished || b.totals.betsSum - a.totals.betsSum,
    );
}

export function seriesBounds(
  points: ReadonlyArray<StatsPoint>,
  series: StatsSeries,
): { min: number; max: number } {
  const values = points.map((point) => toNumber(point[series.key]));
  const min = series.fixedMin != null ? series.fixedMin : Math.min(0, ...values);
  let max = series.fixedMax != null ? series.fixedMax : Math.max(...values);
  if (!(max > min)) max = min + 1;
  return { min, max };
}

export function formatPercent(value: number, digits = 1): string {
  return `${value.toFixed(digits).replace(".", ",")}%`;
}
