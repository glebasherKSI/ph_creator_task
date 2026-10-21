import { describe, expect, it } from "vitest";

import {
  buildPlannerBriefOverlay,
  getPlannerPhBackendId,
  getPlannerPrerequisiteId,
  mapPhTaskToPlannerImport,
  mapPlannerTaskToDraft,
  mergeBackendTaskWithPlannerBrief,
  mergeDefaultDraftConditions,
  orderPlannerTasksByChain,
} from "@/lib/graphic-task-map";
import { buildCreatePayload } from "@/lib/tasks";

import * as legacy from "legacy/graphic-task-map.js";
import * as legacyTasks from "legacy/tasks.js";

import { withoutV3Keys } from "../helpers";
import taskInteractive from "../fixtures/har/task-interactive-1454.json";
import taskWithLinks from "../fixtures/har/task-with-gamification-tasks-1366.json";

/** Задача планировщика в формате Graphic API (строки-поля действий, таргетинг, время). */
const PLANNER_TASK = {
  id: 101,
  package_id: 7,
  frontend_identifier: "wlc_dep_1",
  name_internal: "Первый депозит",
  name_backend: "WLC Deposit 1",
  name_frontend: { ru: "Сделай депозит", en: "Make a deposit", de: "" },
  task_type: "Interactive",
  player_consent_required: "true",
  countries: ["RU", "KZ"],
  category: "beginning",
  priority: "high",
  events: ["deposit", "scheduler"],
  notifications: ["main_bonus_issue"],
  time_availability: {
    available_from: "2026-10-01T00:00:00.000Z",
    available_till: "2026-10-31T00:00:00.000Z",
    duration_minutes: 1440,
    max_repetitions: 3,
  },
  cron: "0 0 * * *",
  main_actions: [
    {
      action: "deposit",
      conditions: [
        { key: "payments_count", value: "1" },
        { key: "points_sum", value: "10" },
      ],
      attributes: [
        { key: "min_points", value: "1,5" },
        { key: "payment_systems", value: "visa, mastercard" },
        { key: "unknown_field", value: "x" },
      ],
    },
  ],
  secondary_actions: [
    { action: "bet", conditions: [{ key: "bets_count", value: "5" }], attributes: [] },
    { action: "", conditions: [] },
  ],
  tag: "welcome",
  reward_points: 50,
  secondary_reward_points: "",
  description: "  Описание  ",
  condition_text: "Сделай депозит",
  button_text: { ru: "Пополнить" },
  targeting: {
    extra: "\n\nТолько новые игроки  ",
    prerequisite_task_id: 100,
    completed_task_ids: [90, 91],
    exclude_tags: ["vip"],
    groups: [],
    custom_rule: "x > 1",
  },
  sort_order: 2,
  ph_backend_id: "",
  conditions: [{ fraud: true }],
  some_unknown: "value",
  notification_channel: "push",
};

const PREREQ_TASK = { id: 100, frontend_identifier: "wlc_reg", name_backend: "Reg" };

const CONTEXT = { tasksById: new Map([[100, PREREQ_TASK]]) };

describe("graphic-task-map — паритет со старой реализацией", () => {
  it("mapPlannerTaskToDraft", () => {
    expect(mapPlannerTaskToDraft(PLANNER_TASK, CONTEXT)).toEqual(
      legacy.mapPlannerTaskToDraft(PLANNER_TASK, CONTEXT),
    );
  });

  it("mapPlannerTaskToDraft без контекста и с пустой задачей", () => {
    expect(mapPlannerTaskToDraft(PLANNER_TASK)).toEqual(legacy.mapPlannerTaskToDraft(PLANNER_TASK));
    expect(mapPlannerTaskToDraft({})).toEqual(legacy.mapPlannerTaskToDraft({}));
    expect(mapPlannerTaskToDraft(null)).toEqual(legacy.mapPlannerTaskToDraft(null));
  });

  it("buildPlannerBriefOverlay", () => {
    expect(buildPlannerBriefOverlay(PLANNER_TASK, CONTEXT)).toEqual(
      legacy.buildPlannerBriefOverlay(PLANNER_TASK, CONTEXT),
    );
  });

  it("mergeBackendTaskWithPlannerBrief", () => {
    expect(mergeBackendTaskWithPlannerBrief(taskInteractive, PLANNER_TASK, CONTEXT)).toEqual(
      legacy.mergeBackendTaskWithPlannerBrief(taskInteractive, PLANNER_TASK, CONTEXT),
    );
  });

  it("mergeDefaultDraftConditions", () => {
    for (const input of [undefined, [], [{ fraud: true }], [{ fraud: true }, {}, null, [1]]]) {
      expect(mergeDefaultDraftConditions(input)).toEqual(
        legacy.mergeDefaultDraftConditions?.(input) ?? mergeDefaultDraftConditions(input),
      );
    }
  });

  it("orderPlannerTasksByChain: предшественник раньше, цикл не зацикливает", () => {
    const tasks = [
      { id: 3, sort_order: 1, targeting: { prerequisite_task_id: 2 } },
      { id: 1, sort_order: 5 },
      { id: 2, sort_order: 2, targeting: { prerequisite_task_id: 1 } },
      { id: 4, sort_order: 0 },
      { id: 10, targeting: { prerequisite_task_id: 11 } },
      { id: 11, targeting: { prerequisite_task_id: 10 } },
    ];
    const ours = orderPlannerTasksByChain(tasks);
    expect(ours).toEqual(legacy.orderPlannerTasksByChain(tasks));
    expect(ours.map((o) => [o.task.id, o.depth])).toEqual([
      [4, 0],
      [1, 0],
      [11, 0], // цикл 10 → 11 → 10 рвётся на 11: он получает глубину 0
      [2, 1],
      [10, 1],
      [3, 2],
    ]);
  });

  it("getPlannerPhBackendId / getPlannerPrerequisiteId", () => {
    for (const task of [
      PLANNER_TASK,
      { id: 5, ph_backend_id: "1456", targeting: { prerequisite_task_id: 5 } },
      { id: 6, ph_backend_id: 0, prerequisite_task_id: "7" },
      {},
    ]) {
      expect(getPlannerPhBackendId(task)).toBe(legacy.getPlannerPhBackendId(task));
      expect(getPlannerPrerequisiteId(task)).toBe(legacy.getPlannerPrerequisiteId(task));
    }
  });
});

describe("graphic-task-map — содержимое", () => {
  it("черновик из графика превращается в тот же create payload, что и в старом коде", () => {
    const draft = mapPlannerTaskToDraft(PLANNER_TASK, CONTEXT);
    expect(withoutV3Keys(buildCreatePayload(draft))).toEqual(legacyTasks.buildCreatePayload(draft));
    const payload = buildCreatePayload(draft);
    // Служебные поля брифа не уходят на бэк.
    expect(payload).not.toHaveProperty("_plannerNote");
    expect(payload).not.toHaveProperty("_plannerHints");
    expect(payload.type).toBe("interactive");
    expect(payload.priority).toBe(1);
    expect(payload.countries).toEqual(["RU", "KZ"]);
    expect(payload.conditions).toEqual([
      { fraud: true },
      { no_bonus: false },
      { no_bonus_sport: false },
      { gambling_addict: false },
    ]);
  });

  it("бриф: предшественник по frontend_identifier, неизвестные поля — в «Прочее»", () => {
    const brief = buildPlannerBriefOverlay(PLANNER_TASK, CONTEXT);
    expect(brief._plannerNote).toContain("Предшественник: wlc_reg");
    expect(brief._plannerNote).toContain("targeting.custom_rule: x > 1");
    expect(brief._plannerNote).toContain("deposit: unknown_field");
    expect(brief._plannerHints.sections.notifications?.[0]?.body).toContain(
      "notification_channel: push",
    );
    expect(brief._plannerHints.leftover[0]?.body).toContain("some_unknown: value");
  });

  it("type: sequence из графика сохраняется", () => {
    expect(mapPlannerTaskToDraft({ task_type: "Sequence" }).type).toBe("sequence");
    expect(mapPlannerTaskToDraft({ task_type: "weird" }).type).toBe("interactive");
  });
});

describe("mapPhTaskToPlannerImport", () => {
  const task = taskWithLinks as unknown as Record<string, unknown>;

  it("переносит поля задачи ПХ в поля задания графика", () => {
    const item = mapPhTaskToPlannerImport(task, { headerColor: "teal" });
    expect(item).toMatchObject({
      ph_backend_id: "1366",
      prerequisite_ph_ids: ["1365", "1314"],
      frontend_identifier: "Default_sport_task8",
      name_backend: "Экспресс-вечеринка SEASON 7_v2",
      task_type: "interactive",
      priority: "low",
      player_consent_required: true,
      cron: "0 0 1 * *",
      color: "#14b8a6",
      countries: ["all"],
      category: "basic",
      tag: "gamification_s7",
      events: ["scheduler", "task_completed"],
      notifications: ["main_bonus_issue", "start"],
      reward_points: 20,
      secondary_reward_points: null,
      time_availability: {
        available_from: "2026-09-30T23:59:00.000Z",
        available_till: "2026-10-31T23:59:00.000Z",
        max_repetitions: 1,
        duration_minutes: 44640,
        infinite: false,
      },
      targeting: { groups: ["2396"], extra: "" },
    });
    expect(item.name_frontend.ru).toBe("Экспресс-вечеринка");
    expect(item.ph_snapshot).toEqual(task);
    expect(item.ph_snapshot).not.toBe(task);
  });

  it("действия: сравнения строкой, списки через запятую", () => {
    const [action] = mapPhTaskToPlannerImport(task).main_actions;
    const rows = [...action!.conditions, ...action!.attributes];
    expect(action!.action).toBe("sport_bet");
    expect(rows).toEqual(
      expect.arrayContaining([
        { key: "sport_bets_count", value: "3" },
        { key: "odd", value: ">= 1.5" },
        { key: "sport_bet_types", value: "express" },
      ]),
    );
  });

  it("туда и обратно: действия восстанавливаются в формат ПХ", () => {
    const draft = mapPlannerTaskToDraft(mapPhTaskToPlannerImport(task));
    expect(draft.serialized_main_actions).toEqual([
      {
        action: "sport_bet",
        requirements: { sport_bets_count: 3, sport_bet_points_sum: 3000 },
        conditions: {
          odd: { operator: ">=", value: "1.5" },
          min_bet_amount: 1000,
          sport_bet_types: ["express"],
        },
      },
    ]);
  });

  it("прочий таргетинг уходит текстом в extra, флаги по умолчанию — нет", () => {
    const item = mapPhTaskToPlannerImport({
      id: 1,
      conditions: [
        { fraud: false },
        { no_bonus: true },
        { groups: { list: ["5"], type: "disabled", extra_type: "or" } },
        { gamification_tasks: { list: ["9"], type: "disabled", extra_type: "or" } },
      ],
    });
    expect(item.targeting).toEqual({
      groups: [],
      extra: 'no_bonus: true\ngroups: {"list":["5"],"type":"disabled","extra_type":"or"}',
    });
    expect(item.prerequisite_ph_ids).toEqual([]);
  });

  it("бессрочная задача без длительности; неизвестные тип и приоритет не отправляются", () => {
    const item = mapPhTaskToPlannerImport({
      id: 2,
      type: "lottery",
      priority: 9,
      infinite: true,
      duration: 60,
    });
    expect(item.time_availability.duration_minutes).toBeNull();
    expect(item.time_availability.infinite).toBe(true);
    expect(item).not.toHaveProperty("task_type");
    expect(item).not.toHaveProperty("priority");
    expect(item).not.toHaveProperty("color");
  });

  it("списки объектов (игры) сводятся к id", () => {
    const [action] = mapPhTaskToPlannerImport({
      id: 3,
      serialized_main_actions: [
        { action: "bet", conditions: { games: [{ id: 7, name: "Book" }, { id: 8 }] } },
      ],
    }).main_actions;
    expect([...action!.conditions, ...action!.attributes]).toContainEqual({
      key: "games",
      value: "7, 8",
    });
  });
});
