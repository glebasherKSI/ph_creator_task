import { describe, expect, it } from "vitest";

import {
  buildTaskPayload,
  durationToForm,
  formToDurationMinutes,
  groupPlannerHints,
  parseNullableField,
  findBonusIdByPoints,
  findTagIdByName,
  tagRawFromForm,
  withPrerequisiteCondition,
  taskToFormValues,
} from "@/features/task-form/task-form";
import { validateTaskPayload } from "@/lib/task-schema";
import { buildCreatePayload } from "@/lib/tasks";

import * as legacyPanel from "legacy/copy-panel.js";

import taskInteractive from "../fixtures/har/task-interactive-1454.json";
import taskSequence from "../fixtures/har/task-sequence-1456.json";

const META_TAGS = [{ id: 20213, name: "test2202" }];

describe("task-form — задача → форма", () => {
  it("copy: имя с _copy, остальные поля из задачи", () => {
    const values = taskToFormValues(taskInteractive, { mode: "copy" });
    expect(values.name).toBe("test_copy");
    expect(values.sourceId).toBe("1454");
    expect(values.type).toBe("interactive");
    expect(values.tag).toBe("20213");
    expect(values.events).toEqual(["scheduler", "deposit"]);
    expect(values.schedule).toMatchObject({ period: "month", hours: [0], daysOfMonth: [1] });
    expect(values.availableFrom).toBe("2026-10-01T15:39");
    expect(values.duration).toBe("111");
    expect(values.infinite).toBe(false);
    expect(values.locales.ru).toBe("test");
    expect(values.locales.de).toBe("");
  });

  it("edit: имя как есть; sequence: без расписания", () => {
    expect(taskToFormValues(taskInteractive, { mode: "edit" }).name).toBe("test");
    const seq = taskToFormValues(taskSequence, { mode: "copy" });
    expect(seq.type).toBe("sequence");
    expect(seq.schedule.hours).toEqual([]);
    expect(seq.duration).toBe("1440");
  });
});

describe("task-form — форма → payload", () => {
  it("roundtrip обычной задачи совпадает с buildCreatePayload (кроме имени)", () => {
    const values = taskToFormValues(taskInteractive, { mode: "copy" });
    const payload = buildTaskPayload(values, taskInteractive, {
      metaTags: META_TAGS,
    }).gamification_task;
    // Как в старой форме: datetime-local теряет секунды, repeatable = есть событие scheduler.
    const expected = buildCreatePayload(taskInteractive, {
      name: "test_copy",
      available_from: "2026-10-01T15:39:00.000Z",
      available_till: "2026-10-31T15:39:00.000Z",
      repeatable: true,
    });
    expect(payload).toEqual(expected);
    expect(validateTaskPayload(payload)).toEqual([]);
  });

  it("roundtrip цепочки: пустые поля сохраняются, схема валидна", () => {
    const values = taskToFormValues(taskSequence, { mode: "edit" });
    const payload = buildTaskPayload(values, taskSequence, {
      metaTags: META_TAGS,
    }).gamification_task;
    expect(payload).toEqual(buildCreatePayload(taskSequence));
    expect(validateTaskPayload(payload)).toEqual([]);
  });

  it("смена типа на sequence очищает лишние поля", () => {
    const values = { ...taskToFormValues(taskInteractive, { mode: "copy" }), type: "sequence" };
    const payload = buildTaskPayload(values, taskInteractive, {
      metaTags: META_TAGS,
    }).gamification_task;
    expect(payload.events).toEqual([]);
    expect(payload.conditions).toEqual([]);
    expect(payload.cron).toBeNull();
    expect(payload.countries).toEqual([]);
    expect(validateTaskPayload(payload)).toEqual([]);
  });

  it("обязательные поля и валидация длительности", () => {
    const values = taskToFormValues(taskInteractive, { mode: "copy" });
    expect(() =>
      buildTaskPayload({ ...values, name: " " }, taskInteractive, { metaTags: null }),
    ).toThrow("name");
    expect(() =>
      buildTaskPayload({ ...values, duration: "", infinite: false }, taskInteractive, {
        metaTags: null,
      }),
    ).toThrow(/время жизни/i);
    expect(() => buildTaskPayload(values, null, { metaTags: null })).toThrow(/исходную/);
  });

  it("режим без meta: бонусы через parseNullableField, тег исходной задачи", () => {
    const values = {
      ...taskToFormValues(taskInteractive, { mode: "copy" }),
      mainBonusGroupId: "null",
      secondaryBonusGroupId: "42",
      tag: "999",
    };
    const payload = buildTaskPayload(values, taskInteractive, { metaTags: null }).gamification_task;
    expect(payload.main_bonus_group_id).toBeNull();
    expect(payload.secondary_bonus_group_id).toBe(42);
    expect(payload.tag_id).toBe(20213);
  });

  it("tagRawFromForm", () => {
    expect(tagRawFromForm("20213", META_TAGS)).toBe(JSON.stringify(META_TAGS[0]));
    expect(tagRawFromForm("5", META_TAGS)).toBe("5");
    expect(tagRawFromForm("", META_TAGS)).toBe("");
    expect(tagRawFromForm("5", null)).toBe("");
  });

  it("findTagIdByName", () => {
    expect(findTagIdByName("test2202", META_TAGS)).toBe("20213");
    expect(findTagIdByName(" TEST2202 ", META_TAGS)).toBe("20213");
    expect(findTagIdByName("gamification_s8", META_TAGS)).toBe("");
    expect(findTagIdByName("", META_TAGS)).toBe("");
  });

  it("findBonusIdByPoints", () => {
    const bonuses = [
      { id: "1:GAMIFICATION BONUS POINTS 1", title: "GAMIFICATION BONUS POINTS 1" },
      { id: "2:GAMIFICATION BONUS POINTS 10", title: "GAMIFICATION BONUS POINTS 10" },
    ];
    expect(findBonusIdByPoints(10, bonuses)).toBe("2:GAMIFICATION BONUS POINTS 10");
    expect(findBonusIdByPoints(1, bonuses)).toBe("1:GAMIFICATION BONUS POINTS 1");
    expect(findBonusIdByPoints(5, bonuses)).toBe("");
    expect(findBonusIdByPoints(null, bonuses)).toBe("");
  });

  it("withPrerequisiteCondition", () => {
    const options = [
      { id: "1365", name: "Сотня — и точка LOW SEASON 8" },
      { id: "1366", name: "Monday Challenge" },
    ];
    const base = [{ fraud: false }];
    const gt = (list: string[]) => ({
      gamification_tasks: { list, type: "enabled", extra_type: "or", only_completed: true },
    });
    expect(withPrerequisiteCondition(base, " monday challenge ", options)).toEqual([
      ...base,
      gt(["1366"]),
    ]);
    // Нет точного совпадения — условие с пустым списком.
    expect(withPrerequisiteCondition(base, "Monday", options)).toEqual([...base, gt([])]);
    expect(withPrerequisiteCondition(base, "", options)).toBeNull();
    expect(withPrerequisiteCondition([gt(["1"])], "Monday Challenge", options)).toBeNull();
  });
});

describe("task-form — хелперы (паритет с copy-panel.js)", () => {
  it.each([
    [111, false],
    [null, false],
    [0, true],
    [-5, false],
    ["abc", false],
  ])("durationToForm(%s, %s)", (minutes, infinite) => {
    expect(durationToForm(minutes, infinite)).toEqual(
      legacyPanel.durationToForm(minutes, infinite),
    );
  });

  it.each([
    ["111", false],
    ["1.6", false],
    ["", true],
  ])("formToDurationMinutes(%s, %s)", (value, infinite) => {
    expect(formToDurationMinutes(value, infinite)).toBe(
      legacyPanel.formToDurationMinutes(value, infinite),
    );
  });

  it.each(["", "null", "42", "-1", "abc", "1.5"])("parseNullableField(%s)", (raw) => {
    expect(parseNullableField(raw)).toBe(legacyPanel.parseNullableField(raw));
  });
});

describe("task-form — бриф из графика", () => {
  it("раскладывает секции и фильтрует малоценный остаток", () => {
    const view = groupPlannerHints({
      _plannerHints: {
        sections: {
          targeting: [{ title: "Таргетинг", body: ["Предшественник: wlc_reg"] }],
          actions: [
            { title: "Описания", body: ["Описание: x"] },
            { title: "Действия", body: ["deposit: unknown_field"] },
          ],
        },
        leftover: [
          { title: "Прочее", body: ["Порядок в пакете: 2"] },
          { title: "Прочее", body: ["some_unknown: value"] },
        ],
      },
    });
    expect(view.sections.targeting).toEqual({
      title: "Таргетинг",
      text: "Предшественник: wlc_reg",
    });
    expect(view.sections.actions).toEqual({
      title: "Бриф из графика",
      text: "Описания\nОписание: x\n\nДействия\ndeposit: unknown_field",
    });
    expect(view.sections.basic).toBeUndefined();
    expect(view.top).toEqual({ title: "Прочее", text: "some_unknown: value" });
  });

  it("без структуры — общий текст из _plannerNote", () => {
    expect(groupPlannerHints({ _plannerNote: "  note " })).toEqual({
      sections: {},
      top: { title: "Бриф из графика", text: "note" },
    });
    expect(groupPlannerHints({}).top).toBeNull();
  });
});
