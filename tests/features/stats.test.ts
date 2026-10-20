import { describe, expect, it } from "vitest";

import {
  aggregateByPeriod,
  computeTotals,
  formatCompact,
  groupStatsRowsByTask,
  seriesBounds,
  SERIES,
} from "@/features/stats/stats";

import type { ReportRow } from "@/lib/reports";

import * as legacy from "legacy/stats-charts.js";

const ROWS = [
  {
    name: "Task A",
    period: "2026-10-02",
    tasksCount: 10,
    tasksFinished: 4,
    betsSum: "1 000,5",
    betsCount: 3,
    depositsSum: 50,
    depositsCount: 1,
  },
  {
    name: "Task A",
    period: "2026-10-01",
    tasksCount: 5,
    tasksFinished: 5,
    betsSum: 0,
    betsCount: 0,
    depositsSum: 0,
    depositsCount: 0,
  },
  {
    name: "Task A",
    period: "2026-10-01",
    tasksCount: 1,
    tasksFinished: 0,
    betsSum: 10,
    betsCount: 1,
    depositsSum: 0,
    depositsCount: 0,
  },
  {
    name: " Task B ",
    period: "2026-10-01",
    tasksCount: 100,
    tasksFinished: 90,
    betsSum: 5,
    betsCount: 1,
    depositsSum: 1,
    depositsCount: 1,
  },
  { name: "", period: "2026-10-03", tasksCount: 1, tasksFinished: 1 },
  { name: "No period", period: "", tasksCount: 1 },
] as unknown as Partial<ReportRow>[];

describe("stats — паритет со старой реализацией", () => {
  it("groupStatsRowsByTask", () => {
    expect(groupStatsRowsByTask(ROWS)).toEqual(legacy.groupStatsRowsByTask(ROWS));
    expect(groupStatsRowsByTask(null)).toEqual([]);
  });

  it("порядок карточек: по выполнениям, потом по обороту", () => {
    const names = groupStatsRowsByTask(ROWS).map((g) => g.taskName);
    expect(names).toEqual(["Task B", "Task A", "Без названия"]);
  });

  it("aggregateByPeriod суммирует по дням и считает процент", () => {
    const points = aggregateByPeriod(ROWS.filter((r) => r.name === "Task A"));
    expect(points.map((p) => p.period)).toEqual(["2026-10-01", "2026-10-02"]);
    expect(points[0]).toMatchObject({ tasksCount: 6, tasksFinished: 5, betsSum: 10 });
    expect(points[1]?.tasksFinishedPercent).toBeCloseTo(40);
    expect(points[1]?.betsSum).toBe(1000.5);
  });

  it("computeTotals / seriesBounds", () => {
    const points = aggregateByPeriod(ROWS.filter((r) => r.name === "Task A"));
    const totals = computeTotals(points);
    expect(totals.tasksCount).toBe(16);
    expect(totals.completion).toBeCloseTo((9 / 16) * 100);
    expect(seriesBounds(points, SERIES[2]!)).toEqual({ min: 0, max: 100 });
    expect(seriesBounds(points, SERIES[0]!)).toEqual({ min: 0, max: 10 });
    expect(seriesBounds([], SERIES[0]!)).toEqual({ min: 0, max: 1 });
  });

  it("formatCompact", () => {
    expect(formatCompact(98641183)).toBe("98,6 млн");
    expect(formatCompact(1500)).toBe("1,5 тыс");
    expect(formatCompact(2000)).toBe("2 тыс");
    expect(formatCompact(-1.2e9)).toBe("-1,2 млрд");
    expect(formatCompact("12,4")).toBe("12");
    expect(formatCompact("x")).toBe("0");
  });
});
