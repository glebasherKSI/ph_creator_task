import { describe, expect, it } from "vitest";

import { STRIP_FROM_CREATE } from "@/lib/constants";
import {
  SEQUENCE_FIELD_OVERRIDES,
  buildCreatePayload,
  buildPatchPayload,
  extractTaskIdFromCreateResponse,
  getGamificationTasksCondition,
  normalizeGamificationTasksCondition,
  resolveCreatedTaskId,
  taskFromResponse,
  taskListFromResponse,
} from "@/lib/tasks";
import type { GamificationTask } from "@/lib/types";

// Старая реализация — эталон поведения до конца миграции (этап 9 удалит src/).
import * as legacy from "legacy/tasks.js";

import createInteractive from "../fixtures/har/create-interactive.request.json";
import createSequence from "../fixtures/har/create-sequence.request.json";
import taskInteractive from "../fixtures/har/task-interactive-1454.json";
import taskSequence from "../fixtures/har/task-sequence-1456.json";
import taskWithGt from "../fixtures/har/task-with-gamification-tasks-1366.json";
import taskWithoutOnlyCompleted from "../fixtures/har/task-without-only-completed-1365.json";

const FIXTURE_TASKS: Array<[string, GamificationTask]> = [
  ["interactive 1454", taskInteractive as GamificationTask],
  ["sequence 1456", taskSequence as GamificationTask],
  ["with gamification_tasks 1366", taskWithGt as GamificationTask],
  ["without only_completed 1365", taskWithoutOnlyCompleted as GamificationTask],
];

describe("buildCreatePayload — паритет со старой реализацией", () => {
  it.each(FIXTURE_TASKS)("%s: без overrides", (_name, task) => {
    expect(buildCreatePayload(task)).toEqual(legacy.buildCreatePayload(task));
  });

  it.each(FIXTURE_TASKS)("%s: с overrides формы", (_name, task) => {
    const overrides = {
      name: "copy",
      frontend_identifier: "copy_fi",
      hidden: true,
      priority: 4,
      __tagRaw: JSON.stringify({ id: 777, name: "tag", settings: {} }),
    };
    expect(buildCreatePayload(task, overrides)).toEqual(legacy.buildCreatePayload(task, overrides));
  });

  it("тег числом из формы", () => {
    const overrides = { __tagRaw: "20213" };
    expect(buildCreatePayload(taskInteractive, overrides)).toEqual(
      legacy.buildCreatePayload(taskInteractive, overrides),
    );
  });
});

describe("buildCreatePayload — содержимое", () => {
  it("не содержит полей из STRIP_FROM_CREATE и readonly-полей", () => {
    const payload = buildCreatePayload(taskInteractive);
    for (const key of Object.keys(payload)) {
      expect(STRIP_FROM_CREATE.has(key), key).toBe(false);
    }
    expect(payload).not.toHaveProperty("id");
    expect(payload).not.toHaveProperty("created_at");
  });

  it("покрывает поля админки, кроме известного отличия (manual_reward, cross_project, shared_projects)", () => {
    // Админка шлёт эти три поля, расширение — нет (и старое тоже). Бэк принимает оба варианта.
    // Решение, отправлять ли их, — этап 5 (TaskForm). Тест ловит любой новый дрейф.
    const KNOWN_MISSING = ["cross_project", "manual_reward", "shared_projects"];
    const payload = buildCreatePayload(taskInteractive);
    const missing = Object.keys(createInteractive.gamification_task)
      .filter((key) => !(key in payload))
      .sort();
    expect(missing).toEqual(KNOWN_MISSING);
  });

  it("цепочка: SEQUENCE_FIELD_OVERRIDES даёт те же значения, что админка", () => {
    const payload = buildCreatePayload(taskInteractive, {
      type: "sequence",
      ...SEQUENCE_FIELD_OVERRIDES,
    });
    const admin = createSequence.gamification_task;
    expect(payload.type).toBe("sequence");
    expect(payload.category).toBe(admin.category);
    expect(payload.conditions).toEqual(admin.conditions);
    expect(payload.countries).toEqual(admin.countries);
    expect(payload.countries_lists).toEqual(admin.countries_lists);
    expect(payload.cron).toBe(admin.cron);
    expect(payload.repeatable).toBe(admin.repeatable);
    expect(payload.events).toEqual([]);
    expect(payload.available_from).toBeNull();
    expect(payload.available_till).toBeNull();
    expect(payload.max_repetitions).toBeNull();
    expect(payload.countries_matching_type).toBeNull();
  });
});

describe("buildPatchPayload — паритет со старой реализацией", () => {
  it.each(FIXTURE_TASKS)("%s", (_name, task) => {
    const conditions = [{ gamification_tasks: { list: ["1"], type: "enabled", extra_type: "or" } }];
    expect(buildPatchPayload(task, conditions)).toEqual(legacy.buildPatchPayload(task, conditions));
  });
});

describe("gamification_tasks condition", () => {
  it("only_completed: true читается как true", () => {
    const gt = getGamificationTasksCondition(taskWithGt.conditions);
    expect(normalizeGamificationTasksCondition(gt).only_completed).toBe(true);
  });

  it("отсутствие only_completed читается как false (бэк не отдаёт false)", () => {
    const gt = getGamificationTasksCondition(taskWithoutOnlyCompleted.conditions);
    expect(gt).not.toBeNull();
    expect(gt).not.toHaveProperty("only_completed");
    expect(normalizeGamificationTasksCondition(gt).only_completed).toBe(false);
  });

  it("нормализует list в строки и дефолты", () => {
    expect(normalizeGamificationTasksCondition({ list: [1, "2"] as unknown as string[] })).toEqual({
      list: ["1", "2"],
      type: "enabled",
      extra_type: "or",
      only_completed: false,
    });
  });

  it("нет блока — null", () => {
    expect(getGamificationTasksCondition([{ fraud: false }])).toBeNull();
    expect(getGamificationTasksCondition(null)).toBeNull();
  });
});

describe("парсинг ответов", () => {
  it("taskListFromResponse: формат списка админки", () => {
    const list = taskListFromResponse({ gamification_tasks: [taskInteractive], pagination: {} });
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(1454);
  });

  it("taskFromResponse: обёртка и плоский объект", () => {
    expect(taskFromResponse({ gamification_task: taskSequence })?.id).toBe(1456);
    expect(taskFromResponse(taskSequence)?.id).toBe(1456);
    expect(taskFromResponse("200")).toBeNull();
  });

  it("extractTaskIdFromCreateResponse: тело 200 — не id, id из Location", () => {
    expect(extractTaskIdFromCreateResponse(200)).toBeNull();
    expect(extractTaskIdFromCreateResponse("200")).toBeNull();
    expect(
      extractTaskIdFromCreateResponse("200", {
        headers: { location: "/admin/api/gamification/tasks/1457" },
      }),
    ).toBe(1457);
  });

  it("resolveCreatedTaskId: ответ 200 → поиск по списку (как в HAR)", async () => {
    const apiFetch = async () => ({
      gamification_tasks: [taskInteractive, taskSequence],
    });
    const id = await resolveCreatedTaskId(apiFetch, createSequence, 200);
    expect(id).toBe(1456);
  });
});
