import { describe, expect, it } from "vitest";

import {
  buildPlannerBriefOverlay,
  getPlannerPhBackendId,
  getPlannerPrerequisiteId,
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
