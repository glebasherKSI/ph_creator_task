import { describe, expect, it } from "vitest";

import {
  buildCron,
  parseCron,
  scheduleFromCron,
  scheduleToCron,
} from "@/features/task-form/repeat-schedule";

import * as legacy from "legacy/repeat-schedule.js";

const CRONS = [
  null,
  "",
  "0 0 1 * *",
  "0 9,18 * * 1,5",
  "0 12 * * *",
  "0 12 15,30 * *",
  "*/5 * * * *",
  "0 12 * *",
  "0 25 * * *",
  "0 12 1 * 1",
  "0 * * * *",
];

describe("repeat-schedule — паритет со старой реализацией", () => {
  it.each(CRONS)("parseCron(%s)", (cron) => {
    expect(parseCron(cron)).toEqual(legacy.parseCron(cron));
  });

  const BUILD_CASES: Array<Parameters<typeof buildCron>[0]> = [
    { period: "day", hours: [9] },
    { period: "day", hours: [] },
    { period: "week", hours: [18, 9], daysOfWeek: [5, 1] },
    { period: "week", hours: [9], daysOfWeek: [] },
    { period: "month", hours: [0], daysOfMonth: [30, 15, 99] },
    { period: "month", hours: [0], daysOfMonth: [] },
  ];

  it.each(BUILD_CASES)("buildCron(%o)", (state) => {
    expect(buildCron(state)).toBe(legacy.buildCron(state));
  });
});

describe("schedule value", () => {
  it("roundtrip cron → value → cron", () => {
    for (const cron of ["0 0 1 * *", "0 9,18 * * 1,5", "0 12 * * *"]) {
      expect(scheduleToCron(scheduleFromCron(cron))).toBe(cron);
    }
  });

  it("нераспознанный cron уходит в fallback и возвращается как есть", () => {
    const value = scheduleFromCron("*/5 * * * *");
    expect(value.fallback).toBe("*/5 * * * *");
    expect(scheduleToCron(value)).toBe("*/5 * * * *");
    expect(scheduleToCron({ ...value, fallback: "  " })).toBeNull();
  });

  it("пустое расписание — cron null", () => {
    expect(scheduleToCron(scheduleFromCron(null))).toBeNull();
  });
});
