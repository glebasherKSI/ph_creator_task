import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  getConditionDef,
  parseConditionsSchema,
  parseDuplicableOptions,
} from "@/lib/conditions-schema";
import { formatGameId, parseGamesOptions } from "@/lib/games-api";
import { formatGraphicError, normalizeGraphicBaseUrl, withGraphicQuery } from "@/lib/graphic-api";
import {
  buildReportsPayload,
  computeMetrics,
  extractReportCountAll,
  extractReportsProjects,
  formatReportsFetchError,
  inferProjectIdFromDomain,
  normalizeReportRows,
  reportTaskNamesMatch,
} from "@/lib/reports";

import * as legacyConditions from "legacy/conditions-schema.js";
import * as legacyGames from "legacy/games-api.js";
import * as legacyReports from "legacy/reports.js";

const ROOT = path.resolve(import.meta.dirname, "../..");
const readJson = (rel: string) => JSON.parse(readFileSync(path.join(ROOT, rel), "utf8"));

describe("conditions-schema", () => {
  it("parseConditionsSchema на реальной фикстуре — паритет и ключевые виджеты", () => {
    const raw = readJson("public/test_primer/conditions.json");
    const ours = parseConditionsSchema(raw, "fixture");
    const theirs = legacyConditions.parseConditionsSchema(raw, "fixture");
    expect(ours.conditions).toEqual(theirs.conditions);
    expect([...ours.widgetTypes.entries()]).toEqual([...theirs.widgetTypes.entries()]);
    expect(ours.conditions.length).toBeGreaterThan(50);
    const gt = getConditionDef(ours, "gamification_tasks");
    expect(gt?.type).toBe("gamification_task");
  });

  it("parseDuplicableOptions на реальной фикстуре", () => {
    const raw = readJson("public/test_primer/constant.json");
    const ours = parseDuplicableOptions(raw);
    const theirs = legacyConditions.parseDuplicableOptions(raw);
    expect([...ours].sort()).toEqual([...theirs].sort());
    expect(ours.size).toBeGreaterThan(0);
  });

  it("parseConditionsSchema: мусор и дефолты", () => {
    const schema = parseConditionsSchema({
      conditions: [null, { label: "no name" }, { name: "x" }],
    });
    expect(schema.conditions).toEqual([
      {
        name: "x",
        label: "x",
        type: "unknown",
        value: undefined,
        collection: undefined,
        availableTypes: undefined,
        availableExtraTypes: undefined,
        extra: {},
      },
    ]);
    expect(parseConditionsSchema(null).conditions).toEqual([]);
  });
});

describe("reports", () => {
  const NOW = new Date(2026, 9, 20, 12, 0, 0);

  it("buildReportsPayload: 14 дней по умолчанию, project_id только валидный", () => {
    const payload = buildReportsPayload({ now: NOW, projectId: "13" });
    expect(payload.period).toEqual({ type: "date_range", from: "2026-10-07", to: "2026-10-20" });
    expect(payload.filters.date_range).toEqual({ start: "2026-10-07", end: "2026-10-20" });
    expect(payload.project_id).toBe("13");
    expect(buildReportsPayload({ now: NOW, projectId: "abc" })).not.toHaveProperty("project_id");
    const explicit = buildReportsPayload({ from: "2026-01-01", to: "2026-01-31", now: NOW });
    expect(legacyReports.buildReportsPayload({ from: "2026-01-01", to: "2026-01-31" })).toEqual(
      explicit,
    );
  });

  it("normalizeReportRows + computeMetrics — паритет", () => {
    const response = {
      countAll: "3",
      rows: [
        {
          project_id: 13,
          name: "  Task  A ",
          period: "2026-10-01",
          tasks_count: "10",
          tasks_finished: "4",
          deposits_sum: "1 000,5",
          bets_count: 8,
          deposits_count: 2,
        },
        { name: "Task B", period: "2026-10-02", tasks_count: 5, tasks_finished: "50%" },
        null,
      ],
    };
    const rows = normalizeReportRows(response);
    expect(rows).toEqual(legacyReports.normalizeReportRows(response));
    expect(rows[0]?.depositsSum).toBe(1000.5);
    const metrics = computeMetrics(rows, { from: "2026-10-01", to: "2026-10-03" });
    expect(metrics).toEqual(
      legacyReports.computeMetrics(rows, { from: "2026-10-01", to: "2026-10-03" }),
    );
    expect(metrics.daysCount).toBe(3);
    expect(metrics.uniqueTasks).toBe(2);
    expect(metrics.completionRate).toBeCloseTo((54 / 15) * 100);
    expect(extractReportCountAll(response)).toBe(3);
  });

  it("extractReportsProjects / inferProjectIdFromDomain / reportTaskNamesMatch", () => {
    const state = {
      projects: [{ id: "2", name: "Б" }, { id: 1, name: "А" }, { id: "x" }],
      active_project_id: 2,
    };
    expect(extractReportsProjects(state)).toEqual({
      projects: [
        { id: "1", name: "А" },
        { id: "2", name: "Б" },
      ],
      activeProjectId: "2",
    });
    expect(inferProjectIdFromDomain("admin.crimson.lex.prd.maxbit.private")).toBe("13");
    expect(inferProjectIdFromDomain("admin.other.lex.x")).toBe("13");
    expect(inferProjectIdFromDomain("admin.other")).toBe("");
    expect(reportTaskNamesMatch("Task A (Копия)", "task  a")).toBe(true);
    expect(reportTaskNamesMatch("", "x")).toBe(false);
  });

  it("formatReportsFetchError", () => {
    expect(formatReportsFetchError("REPORTS_XSRF_MISSING")).toMatch(/XSRF/);
    expect(formatReportsFetchError(new Error("HTTP 500"))).toMatch(/500/);
    expect(formatReportsFetchError("")).toBe("Не удалось загрузить отчёт из Reports.");
  });
});

describe("graphic-api helpers", () => {
  it("normalizeGraphicBaseUrl", () => {
    expect(normalizeGraphicBaseUrl("")).toBe("http://127.0.0.1:8000");
    expect(normalizeGraphicBaseUrl("graphic.local:9000/path")).toBe("http://graphic.local:9000");
    expect(normalizeGraphicBaseUrl("ftp://x")).toBe("http://127.0.0.1:8000");
  });

  it("formatGraphicError", () => {
    expect(formatGraphicError(422, { detail: [{ msg: "a" }, "b"] })).toBe("HTTP 422: a; b");
    expect(formatGraphicError(500, null)).toBe("HTTP 500");
    expect(formatGraphicError(undefined, "x")).toBe("x");
    expect(formatGraphicError(undefined, null)).toBe("Ошибка Graphic API");
  });

  it("withGraphicQuery", () => {
    expect(withGraphicQuery("/api/x", { a: 1, b: "", c: null, d: "y z" })).toBe("/api/x?a=1&d=y+z");
    expect(withGraphicQuery("/api/x", null)).toBe("/api/x");
  });
});

describe("games-api", () => {
  it("parseGamesOptions / formatGameId — паритет", () => {
    const raw = {
      game_specs: [
        { producer: "netent", identifier: "starburst", title: "Starburst" },
        { id: "pragmatic:gates", name: "Gates" },
        { identifier: "solo" },
        { producer: "netent", identifier: "starburst", title: "Dup" },
        null,
      ],
    };
    expect(parseGamesOptions(raw)).toEqual(legacyGames.parseGamesOptions(raw));
    expect(parseGamesOptions(raw)).toEqual([
      { id: "netent:starburst", label: "Starburst" },
      { id: "pragmatic:gates", label: "Gates" },
      { id: "solo", label: "solo" },
    ]);
    expect(formatGameId({})).toBe("");
    expect(parseGamesOptions({ data: { items: [{ id: "a:b" }] } })).toEqual([
      { id: "a:b", label: "a:b" },
    ]);
  });
});
