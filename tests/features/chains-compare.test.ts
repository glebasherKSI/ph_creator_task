import { describe, expect, it } from "vitest";

import { applyBulkOps } from "@/features/chains/bulk-edit";
import { buildCompareRows, groupCompareRows } from "@/features/chains/compare";

function task(extra: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: "T",
    type: "interactive",
    priority: 1,
    hidden: false,
    locales: { ru: "Задание", en: "Task" },
    events: ["deposit"],
    countries_matching_type: "countries",
    countries: ["RU"],
    infinite: true,
    conditions: [{ fraud: true }, { gamification_tasks: { list: ["5"], type: "enabled" } }],
    serialized_main_actions: [{ action: "deposit", requirements: { points_sum: 100 } }],
    ...extra,
  };
}

const row = (rows: ReturnType<typeof buildCompareRows>, key: string) =>
  rows.find((r) => r.key === key)!;

describe("сравнение задач", () => {
  it("строка на параметр: значения по задачам, большинство и число вариантов", () => {
    const rows = buildCompareRows([task(), task(), task({ priority: 3 })]);
    const priority = row(rows, "priority");
    expect(priority.cells.map((c) => c.text)).toEqual(["Низкий", "Низкий", "Высокий"]);
    expect(priority.majority).toBe("Низкий");
    expect(priority.variants).toBe(2);
    expect(row(rows, "hidden").variants).toBe(1);
  });

  it("клик по ячейке — операция «сделать у всех так», которая даёт это значение", () => {
    const tasks = [task(), task({ priority: 3 })];
    const fix = row(buildCompareRows(tasks), "priority").cells[1]!.fix!;
    expect(fix).toEqual({ field: "priority", value: 3 });
    expect(applyBulkOps(tasks[0]!, [fix]).task.priority).toBe(3);
  });

  it("таргетинг: строка на условие, «не задано» у задач без него; связи не сравниваются", () => {
    const tasks = [task(), task({ conditions: [{ fraud: true }, { no_bonus: true }] })];
    const rows = buildCompareRows(tasks);
    expect(rows.some((r) => r.key === "condition:gamification_tasks")).toBe(false);
    const noBonus = row(rows, "condition:no_bonus");
    expect(noBonus.cells.map((c) => c.text)).toEqual(["не задано", "да"]);
    // «не задано» — удалить условие у всех, «да» — добавить всем.
    expect(applyBulkOps(tasks[1]!, [noBonus.cells[0]!.fix!]).task.conditions).toEqual([
      { fraud: true },
    ]);
    expect(applyBulkOps(tasks[0]!, [noBonus.cells[1]!.fix!]).task.conditions).toContainEqual({
      no_bonus: true,
    });
  });

  it("повторяемое условие: ячейка с двумя записями выравнивает набор целиком", () => {
    const a = { groups: { type: "enabled", list: ["ph_low"] } };
    const b = { groups: { type: "enabled", list: ["AB_354_VAR1"] } };
    const tasks = [task({ conditions: [a, b] }), task({ conditions: [a] })];
    const groups = row(buildCompareRows(tasks), "condition:groups");
    const fix = groups.cells[0]!.fix!;
    expect(fix).toMatchObject({ field: "conditions_upsert", duplicates: "replace" });
    const ctx = { duplicable: new Set(["groups"]) };
    expect(applyBulkOps(tasks[1]!, [fix], ctx).task.conditions).toEqual([a, b]);
    expect(applyBulkOps(tasks[0]!, [groups.cells[1]!.fix!], ctx).task.conditions).toEqual([a]);
  });

  it("тип, локали и целевые действия только для просмотра", () => {
    const rows = buildCompareRows([task(), task({ locales: { ru: "Задание", en: "" } })]);
    const locales = row(rows, "locales");
    expect(locales.cells.map((c) => c.text)).toEqual(["en, ru", "ru"]);
    expect(locales.cells.every((c) => c.fix === null)).toBe(true);
    expect(row(rows, "serialized_main_actions").cells[0]!.fix).toBeNull();
    expect(row(rows, "type").cells[0]!.fix).toBeNull();
  });

  it("целевые действия: строка на поле, понятным языком", () => {
    const rows = buildCompareRows([
      task(),
      task({
        serialized_main_actions: [
          { action: "deposit", requirements: { points_sum: 1500, payments_count: 2 } },
        ],
      }),
    ]);
    expect(row(rows, "serialized_main_actions").cells.map((c) => c.text)).toEqual([
      "Депозит",
      "Депозит",
    ]);
    const sum = rows.find((r) => r.label === "Депозит · Сумма платежей")!;
    expect(sum.cells.map((c) => c.text)).toEqual(["1 €", "15 €"]);
    const count = rows.find((r) => r.label === "Депозит · Количество платежей")!;
    expect(count.cells.map((c) => c.text)).toEqual(["не задано", "2"]);
    expect(sum.cells[0]!.fix).toBeNull();
  });

  it("секции по порядку формы; «только различия» скрывает совпадающие строки", () => {
    const rows = buildCompareRows([task(), task({ priority: 3, events: ["login"] })]);
    const all = groupCompareRows(rows, false);
    expect(all.map((s) => s.id)).toEqual([
      "basic",
      "classification",
      "startup",
      "targeting",
      "availability",
      "actions",
      "rewards",
      "notifications",
    ]);
    const diffs = groupCompareRows(rows, true);
    expect(diffs.flatMap((s) => s.rows.map((r) => r.key))).toEqual(["priority", "events"]);
  });
});
