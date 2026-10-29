import { describe, expect, it } from "vitest";

import {
  type BulkOp,
  applyBulkOps,
  bulkFieldDiffers,
  bulkOpFromTask,
  changedTaskKeys,
  defaultBulkOp,
  groupChanges,
  isBulkOpReady,
  restoreFields,
  summarizeConditions,
  summarizeField,
} from "@/features/chains/bulk-edit";

function task(extra: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: "T1",
    type: "interactive",
    priority: 1,
    hidden: false,
    events: ["deposit"],
    cron: null,
    repeatable: false,
    countries_matching_type: "countries",
    countries: ["RU"],
    countries_lists: [],
    available_from: "2026-11-01T00:00:00.000Z",
    available_till: "2026-11-30T23:59:00.000Z",
    infinite: true,
    duration: null,
    conditions: [
      { fraud: true },
      { groups: { type: "enabled", list: ["vip"] } },
      { gamification_tasks: { list: ["5"], type: "enabled", extra_type: "or" } },
    ],
    serialized_main_actions: [{ action: "deposit", requirements: { points_sum: 100 } }],
    ...extra,
  };
}

describe("массовая правка: простые поля", () => {
  it("приоритет и «было → стало»", () => {
    const result = applyBulkOps(task(), [{ field: "priority", value: 3 }]);
    expect(result.task.priority).toBe(3);
    expect(result.changes).toEqual([{ label: "Приоритет", before: "Низкий", after: "Высокий" }]);
  });

  it("целевые действия не трогаются", () => {
    const before = task();
    const result = applyBulkOps(before, [
      { field: "priority", value: 4 },
      { field: "hidden", value: true },
    ]);
    expect(result.task.serialized_main_actions).toBe(before.serialized_main_actions);
  });

  it("тег: id и объект тега", () => {
    const result = applyBulkOps(task(), [{ field: "tag", tag: { id: 7, name: "welcome" } }]);
    expect(result.task.tag_id).toBe(7);
    expect(result.task.tag).toMatchObject({ id: 7, name: "welcome" });
    expect(result.changes[0]).toEqual({ label: "Тег", before: "—", after: "welcome" });
  });

  it("время жизни: минуты или бессрочно", () => {
    expect(applyBulkOps(task(), [{ field: "duration", minutes: 360 }]).task).toMatchObject({
      infinite: false,
      duration: 360,
    });
    expect(
      applyBulkOps(task({ infinite: false, duration: 60 }), [{ field: "duration", minutes: null }])
        .task,
    ).toMatchObject({ infinite: true, duration: null });
  });
});

describe("массовая правка: списки", () => {
  it("события: добавить / убрать / заменить", () => {
    expect(
      applyBulkOps(task(), [{ field: "events", mode: "add", values: ["login", "deposit"] }]).task
        .events,
    ).toEqual(["deposit", "login"]);
    expect(
      applyBulkOps(task(), [{ field: "events", mode: "remove", values: ["deposit"] }]).task.events,
    ).toEqual([]);
    expect(
      applyBulkOps(task(), [{ field: "events", mode: "set", values: ["bet"] }]).task.events,
    ).toEqual(["bet"]);
  });

  it("убрали scheduler — расписание сбрасывается, как в форме", () => {
    const result = applyBulkOps(
      task({ events: ["scheduler"], cron: "0 9 * * *", repeatable: true }),
      [{ field: "events", mode: "remove", values: ["scheduler"] }],
    );
    expect(result.task).toMatchObject({ cron: null, repeatable: false });
  });

  it("расписание — только задачам с scheduler", () => {
    const op: BulkOp = { field: "schedule", cron: "0 10 * * *" };
    expect(applyBulkOps(task({ events: ["scheduler"] }), [op]).task).toMatchObject({
      cron: "0 10 * * *",
      repeatable: true,
    });
    const skipped = applyBulkOps(task(), [op]);
    expect(skipped.changes).toEqual([]);
    expect(skipped.notes[0]).toContain("scheduler");
  });

  it("страны: заменить целиком, добавить к тому же способу выбора", () => {
    const set = applyBulkOps(task(), [
      {
        field: "countries",
        mode: "set",
        value: { matchingType: "countries_lists", countries: [], countriesLists: ["tier1"] },
      },
    ]);
    expect(set.task).toMatchObject({
      countries_matching_type: "countries_lists",
      countries_lists: ["tier1"],
    });

    const add: BulkOp = {
      field: "countries",
      mode: "add",
      value: { matchingType: "countries", countries: ["KZ"], countriesLists: [] },
    };
    expect(applyBulkOps(task(), [add]).task.countries).toEqual(["RU", "KZ"]);
    const other = applyBulkOps(task({ countries_matching_type: "countries_lists" }), [add]);
    expect(other.changes).toEqual([]);
    expect(other.notes).toHaveLength(1);
    expect(applyBulkOps(task({ countries: ["all"] }), [add]).changes).toEqual([]);
  });
});

describe("массовая правка: таргетинг", () => {
  it("изменить существующее условие и добавить новое; связи не трогаются", () => {
    const result = applyBulkOps(task(), [
      {
        field: "conditions_upsert",
        onlyExisting: false,
        conditions: [
          { groups: { type: "enabled", list: ["vip", "gold"] } },
          { no_bonus: true },
          { gamification_tasks: { list: ["99"], type: "enabled", extra_type: "or" } },
        ],
      },
    ]);
    expect(result.task.conditions).toEqual([
      { fraud: true },
      { groups: { type: "enabled", list: ["vip", "gold"] } },
      { gamification_tasks: { list: ["5"], type: "enabled", extra_type: "or" } },
      { no_bonus: true },
    ]);
    expect(result.changes.map((c) => c.label)).toEqual([
      "Таргетинг: groups",
      "Таргетинг: no_bonus",
    ]);
  });

  it("«только изменить» не добавляет условие, которого нет", () => {
    const result = applyBulkOps(task(), [
      { field: "conditions_upsert", onlyExisting: true, conditions: [{ no_bonus: true }] },
    ]);
    expect(result.changes).toEqual([]);
    expect(result.notes[0]).toContain("no_bonus");
  });

  it("повторяемое условие добавляется ещё одной записью, дубль — нет", () => {
    const ctx = { duplicable: new Set(["groups"]) };
    const op: BulkOp = {
      field: "conditions_upsert",
      onlyExisting: false,
      conditions: [{ groups: { type: "disabled", list: ["bad"] } }],
    };
    const once = applyBulkOps(task(), [op], ctx).task;
    expect((once.conditions as unknown[]).length).toBe(4);
    expect((applyBulkOps(once, [op], ctx).task.conditions as unknown[]).length).toBe(4);
  });

  it("удалить условия по имени, кроме связей", () => {
    const result = applyBulkOps(task(), [
      { field: "conditions_remove", names: ["groups", "gamification_tasks"] },
    ]);
    expect(result.task.conditions).toEqual([
      { fraud: true },
      { gamification_tasks: { list: ["5"], type: "enabled", extra_type: "or" } },
    ]);
  });

  it("сводка условий: частота и разные значения", () => {
    const summary = summarizeConditions([
      task(),
      task({ conditions: [{ groups: { type: "enabled", list: ["gold"] } }] }),
    ]);
    expect(summary[0]).toMatchObject({ name: "groups", count: 2, variants: 2 });
    expect(summary.map((s) => s.name)).not.toContain("gamification_tasks");
  });
});

describe("массовая правка: цепочки, даты, проверки", () => {
  it("у цепочки поля таргетинга и дат не меняются", () => {
    const seq = task({
      type: "sequence",
      events: [],
      conditions: [],
      available_from: null,
      available_till: null,
    });
    const result = applyBulkOps(seq, [
      { field: "events", mode: "add", values: ["login"] },
      { field: "priority", value: 4 },
    ]);
    expect(result.task.events).toEqual([]);
    expect(result.task.priority).toBe(4);
    expect(result.notes[0]).toContain("цепочк");
  });

  it("сдвиг дат и ошибка «с» позже «до»", () => {
    const shifted = applyBulkOps(task(), [{ field: "shift_dates", minutes: 24 * 60 }]).task;
    expect(shifted.available_from).toBe("2026-11-02T00:00:00.000Z");
    expect(shifted.available_till).toBe("2026-12-01T23:59:00.000Z");

    const bad = applyBulkOps(task(), [
      { field: "available_from", value: "2026-12-15T00:00:00.000Z" },
    ]);
    expect(bad.errors).toHaveLength(1);
  });

  it("незаполненные операции не применяются", () => {
    expect(isBulkOpReady(defaultBulkOp("tag"))).toBe(false);
    expect(isBulkOpReady(defaultBulkOp("events"))).toBe(false);
    expect(isBulkOpReady(defaultBulkOp("priority"))).toBe(true);
    expect(applyBulkOps(task(), [defaultBulkOp("conditions_remove")]).changes).toEqual([]);
  });

  it("сводка значений поля", () => {
    const first = task();
    const summary = summarizeField([first, task(), task({ priority: 3 })], "priority");
    expect(summary.map(({ text, count }) => ({ text, count }))).toEqual([
      { text: "Низкий", count: 2 },
      { text: "Высокий", count: 1 },
    ]);
    expect(summary[0]!.sample).toBe(first);
  });

  it("откат: возвращаются только изменённые поля", () => {
    const before = task();
    const after = applyBulkOps(before, [{ field: "priority", value: 4 }]).task;
    const keys = changedTaskKeys(before, after);
    expect(keys).toEqual(["priority"]);
    const freshWithOtherEdit = { ...after, name: "Переименовали на бэке" };
    expect(restoreFields(freshWithOtherEdit, before, keys)).toMatchObject({
      priority: 1,
      name: "Переименовали на бэке",
    });
  });
});

describe("массовая правка: подсказки в окне", () => {
  it("«сделать у всех так»: операция из значения задачи", () => {
    const source = task({
      priority: 4,
      tag: { id: 3, name: "vip" },
      infinite: false,
      duration: 90,
    });
    expect(bulkOpFromTask("priority", source)).toEqual({ field: "priority", value: 4 });
    expect(bulkOpFromTask("tag", source)).toEqual({ field: "tag", tag: { id: 3, name: "vip" } });
    expect(bulkOpFromTask("duration", source)).toEqual({ field: "duration", minutes: 90 });
    expect(bulkOpFromTask("countries", source)).toMatchObject({
      mode: "set",
      value: { countries: ["RU"] },
    });
    expect(bulkOpFromTask("tag", task())).toBeNull();
    expect(bulkOpFromTask("shift_dates", source)).toBeNull();
    // Применение операции даёт ровно значение исходной задачи.
    const op = bulkOpFromTask("events", task({ events: ["login", "bet"] }))!;
    expect(applyBulkOps(task(), [op]).task.events).toEqual(["login", "bet"]);
  });

  it("поле с разными значениями у задач помечается", () => {
    const tasks = [task(), task({ priority: 3 })];
    expect(bulkFieldDiffers(tasks, "priority")).toBe(true);
    expect(bulkFieldDiffers(tasks, "hidden")).toBe(false);
    expect(
      bulkFieldDiffers([task(), task({ conditions: [{ fraud: true }] })], "conditions_upsert"),
    ).toBe(true);
    expect(bulkFieldDiffers([task()], "priority")).toBe(false);
  });

  it("итог предпросмотра: одинаковые «было → стало» схлопываются", () => {
    const op: BulkOp = { field: "priority", value: 4 };
    const lists = [task(), task(), task({ priority: 2 })].map((t) => applyBulkOps(t, [op]).changes);
    expect(groupChanges(lists)).toEqual([
      { label: "Приоритет", before: "Низкий", after: "Наивысший", count: 2 },
      { label: "Приоритет", before: "Средний", after: "Наивысший", count: 1 },
    ]);
  });
});
