import { describe, expect, it } from "vitest";

import { taskPayloadSchema, validateTaskPayload } from "@/lib/task-schema";
import { SEQUENCE_FIELD_OVERRIDES, buildCreatePayload } from "@/lib/tasks";

import createInteractive from "../fixtures/har/create-interactive.request.json";
import createSequence from "../fixtures/har/create-sequence.request.json";
import taskInteractive from "../fixtures/har/task-interactive-1454.json";
import taskSequence from "../fixtures/har/task-sequence-1456.json";

describe("taskPayloadSchema", () => {
  it("payload обычной задачи из buildCreatePayload валиден", () => {
    expect(validateTaskPayload(buildCreatePayload(taskInteractive))).toEqual([]);
  });

  it("payload цепочки из бэка валиден", () => {
    expect(validateTaskPayload(buildCreatePayload(taskSequence))).toEqual([]);
  });

  it("тело POST цепочки из HAR проходит правило sequence (duration у админки — строка)", () => {
    const payload = buildCreatePayload(createSequence.gamification_task);
    expect(validateTaskPayload(payload)).toEqual([
      "duration: Invalid input: expected number, received string",
    ]);
    expect(validateTaskPayload({ ...payload, duration: 1440 })).toEqual([]);
  });

  it("обычная задача, переключённая в sequence без очистки, — ошибки по каждому полю", () => {
    const payload = buildCreatePayload(taskInteractive, { type: "sequence" });
    const errors = validateTaskPayload(payload);
    expect(errors.some((e) => e.startsWith("events:"))).toBe(true);
    expect(errors.some((e) => e.startsWith("conditions:"))).toBe(true);
    expect(errors.some((e) => e.startsWith("countries:"))).toBe(true);
    expect(errors.some((e) => e.startsWith("category:"))).toBe(true);
    expect(errors.some((e) => e.startsWith("available_from:"))).toBe(true);
  });

  it("…а с SEQUENCE_FIELD_OVERRIDES — валидна", () => {
    const payload = buildCreatePayload(taskInteractive, {
      type: "sequence",
      ...SEQUENCE_FIELD_OVERRIDES,
    });
    expect(validateTaskPayload(payload)).toEqual([]);
  });

  it("обязательные name / frontend_identifier", () => {
    const payload = buildCreatePayload(taskInteractive, { name: "  ", frontend_identifier: "" });
    const errors = validateTaskPayload(payload);
    expect(errors).toContain("name: Поле name обязательно");
    expect(errors).toContain("frontend_identifier: Поле frontend_identifier обязательно");
  });

  it("тело POST админки (строки вместо чисел в max_repetitions) схема не принимает — это ожидаемо", () => {
    // Админка шлёт max_repetitions: "1"; расширение всегда шлёт число. Схема описывает расширение.
    const result = taskPayloadSchema.safeParse(
      buildCreatePayload(createInteractive.gamification_task),
    );
    expect(result.success).toBe(false);
  });
});
