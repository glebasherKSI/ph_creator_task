import { describe, expect, it } from "vitest";

import {
  cleanRequirements,
  createEmptyAction,
  deleteFieldKey,
  formatMultiText,
  moneyRangeInputs,
  normalizeActions,
  normalizeMultiSelectValue,
  parseActionsArray,
  parseMultiText,
  resolveFieldOptions,
  retargetFields,
  setDuration,
  setMoneyRange,
  toApiAction,
  toEditorFields,
  visibleFieldKeys,
} from "@/features/task-form/actions-builder";
import { getRequirementFieldDef } from "@/lib/actions-schema";
import type { TaskAction } from "@/lib/types";

import * as legacy from "legacy/actions-builder.js";

const DEPOSIT: TaskAction = {
  action: "deposit",
  requirements: { payments_count: "1", points_sum: "100" },
  conditions: { min_points: 10, max_points: 500, payment_systems: ["cards", "crypto"] },
};

const BET: TaskAction = {
  action: "bet",
  requirements: { bets_count: "5" },
  conditions: {
    bet_type: "real",
    games: ["netent:starburst", { id: "pragmatic:gates" }],
    win_coefficient: { operator: ">=", value: "1.5" },
    in_sequence: true,
  },
};

const USER_UPDATE: TaskAction = {
  action: "user_update",
  requirements: { nickname: true, avatar: "1" },
  conditions: {},
};

const INCOMING: unknown[] = [
  DEPOSIT,
  BET,
  USER_UPDATE,
  { action: "tournament", requirements: { tournaments_count: "3", tournament_ids: ["7", "x"] } },
  { action: "app_login" },
  {
    action: "sport_bet",
    conditions: { odd: { type: "gt", value: 2 }, sport_bet_types: ["single"] },
  },
  { action: "  " },
  null,
  "bet",
  { requirements: { bets_count: 1 } },
  { action: "bet", requirements: null, conditions: [1, 2] },
];

function legacyParsed(value: unknown) {
  return (legacy.parseActionsArray(value) as Array<Record<string, unknown>>).map((item) => ({
    action: item.action,
    requirements: item.requirements,
    visible: { conditions: item._visibleConditions, attributes: item._visibleAttributes },
  }));
}

describe("parseActionsArray — паритет со старой реализацией", () => {
  it("разбирает смешанный массив как legacy", () => {
    expect(parseActionsArray(INCOMING)).toEqual(legacyParsed(INCOMING));
  });

  it.each([undefined, null, {}, "x", []])("не-массив %s → []", (value) => {
    expect(parseActionsArray(value)).toEqual(legacyParsed(value));
    expect(parseActionsArray(value)).toEqual([]);
  });

  it("не мутирует входные объекты", () => {
    const input = structuredClone(INCOMING);
    parseActionsArray(input);
    expect(input).toEqual(INCOMING);
  });
});

describe("модель редактора ↔ API", () => {
  it("roundtrip deposit: редактор → API совпадает с входом", () => {
    expect(toApiAction("deposit", toEditorFields(DEPOSIT))).toEqual(DEPOSIT);
  });

  it("roundtrip bet: игры нормализуются к id, сравнение остаётся { operator, value }", () => {
    expect(toApiAction("bet", toEditorFields(BET))).toEqual({
      action: "bet",
      requirements: { bets_count: "5" },
      conditions: {
        bet_type: "real",
        games: ["netent:starburst", "pragmatic:gates"],
        win_coefficient: { operator: ">=", value: "1.5" },
        in_sequence: true,
      },
    });
  });

  it("normalizeActions = legacy setValue()+getValue() без правок в UI", () => {
    const expected = legacyParsed(INCOMING).map((item) =>
      toApiAction(item.action as string, item.requirements as Record<string, unknown>),
    );
    expect(normalizeActions(INCOMING)).toEqual(expected);
    expect(normalizeActions(INCOMING).map((a) => a.action)).toEqual([
      "deposit",
      "bet",
      "user_update",
      "tournament",
      "app_login",
      "sport_bet",
      "bet",
    ]);
  });

  it("user_update: legacy boolean-поля профиля сворачиваются в required_attributes", () => {
    expect(toApiAction("user_update", toEditorFields(USER_UPDATE))).toEqual({
      action: "user_update",
      requirements: { required_attributes: ["avatar", "nickname"] },
      conditions: {},
    });
  });

  it("коэрция чисел и списков id только в bucket requirements, как в legacy", () => {
    expect(
      toApiAction("tournament", {
        tournaments_count: "3",
        games_taken_min: "2,5",
        place_min: "2,5",
        tournament_ids: ["7", "x"],
      }),
    ).toEqual({
      action: "tournament",
      requirements: { tournaments_count: 3, games_taken_min: 2.5 },
      conditions: { place_min: "2,5", tournament_ids: ["7", "x"] },
    });
    expect(toApiAction("groups_update", { group_ids: ["7", "x"] })).toEqual({
      action: "groups_update",
      requirements: { group_ids: [7] },
      conditions: {},
    });
  });

  it("десятичная запятая: сравнение уходит в API с точкой, текстовые поля — как есть", () => {
    expect(toApiAction("sport_bet", { odd: { type: "gt", value: "1,5" } }).conditions).toEqual({
      odd: { operator: ">", value: "1.5" },
    });
    // min_points — атрибут (bucket conditions): схема его не коэрцит, как и legacy.
    expect(toApiAction("deposit", { min_points: "1,5" }).conditions).toEqual({ min_points: "1,5" });
  });

  it("пустые и неразрешённые поля не попадают в API", () => {
    const api = toApiAction("bet", {
      bets_count: "  ",
      games: [],
      bet_type: "",
      odd: {},
      payments_count: "1",
      in_sequence: true,
    });
    expect(api).toEqual({ action: "bet", requirements: {}, conditions: { in_sequence: true } });
  });

  it("createEmptyAction — bet без полей", () => {
    expect(createEmptyAction()).toEqual({ action: "bet", requirements: {}, conditions: {} });
    expect(createEmptyAction("deposit").action).toBe("deposit");
  });
});

describe("правки полей", () => {
  it("retargetFields оставляет только поля нового типа", () => {
    const fields = toEditorFields(DEPOSIT);
    expect(retargetFields(fields, "cashout")).toEqual(fields);
    expect(retargetFields(fields, "bet")).toEqual({});
    expect(retargetFields({ min_bet_amount: "1", result: "win", odd: 1 }, "sport_bet")).toEqual({
      min_bet_amount: "1",
      result: "win",
      odd: 1,
    });
  });

  it("deleteFieldKey убирает money_range вместе с дублями", () => {
    const fields = { money_range: { min: "1" }, min_points: "1", max_points: "2", x: 1 };
    expect(deleteFieldKey(fields, "money_range", "deposit")).toEqual({ x: 1 });
    expect(deleteFieldKey({ money_range: {}, min_bet_amount: "1" }, "money_range", "bet")).toEqual(
      {},
    );
    expect(deleteFieldKey(fields, "x", "deposit")).toEqual({
      money_range: { min: "1" },
      min_points: "1",
      max_points: "2",
    });
  });

  it("money_range: чтение из дублей и запись с дублями (как readRequirementsFromCard)", () => {
    expect(moneyRangeInputs("deposit", { min_points: 10, max_points: 20 })).toEqual({
      min: "10",
      max: "20",
    });
    expect(moneyRangeInputs("bet", { min_bet_amount: 5 })).toEqual({ min: "5", max: "" });
    expect(moneyRangeInputs("deposit", { money_range: { min: 1 } })).toEqual({ min: "1", max: "" });
    expect(moneyRangeInputs("bet", {})).toEqual({ min: "", max: "" });

    expect(setMoneyRange({}, "deposit", { min: " 10 ", max: "" })).toEqual({
      money_range: { min: "10" },
      min_points: "10",
    });
    expect(setMoneyRange({ min_points: "10" }, "cashout", { min: "", max: "" })).toEqual({});
    expect(setMoneyRange({}, "bet", { min: "1", max: "2" })).toEqual({
      money_range: { min: "1", max: "2" },
      min_bet_amount: "1",
    });
  });

  it("setDuration: пустые части опускаются", () => {
    expect(setDuration({}, { value: "5", period: "" })).toEqual({ duration: { value: "5" } });
    expect(setDuration({}, { value: "", period: "days" })).toEqual({
      duration: { period: "days" },
    });
    expect(setDuration({ duration: { value: "1" } }, { value: " ", period: "" })).toEqual({});
  });

  it("visibleFieldKeys: по значениям в порядке схемы + добавленные вручную", () => {
    const fields = toEditorFields(BET);
    expect(visibleFieldKeys("bet", fields, "condition", [])).toEqual(["bets_count"]);
    expect(visibleFieldKeys("bet", fields, "attribute", [])).toEqual([
      "bet_type",
      "games",
      "win_coefficient",
      "in_sequence",
    ]);
    expect(visibleFieldKeys("bet", fields, "condition", ["bet_points_sum", "bets_count"])).toEqual([
      "bets_count",
      "bet_points_sum",
    ]);
    // чужие и неразрешённые ключи игнорируются
    expect(visibleFieldKeys("bet", {}, "attribute", ["payments_count", "games", "nope"])).toEqual([
      "games",
    ]);
    expect(visibleFieldKeys("app_login", {}, "condition", ["bets_count"])).toEqual([]);
  });
});

describe("текстовые и списочные значения", () => {
  it("parseMultiText: список через запятую или JSON-массив", () => {
    expect(parseMultiText("")).toBeUndefined();
    expect(parseMultiText(" a, b ,,c ")).toEqual(["a", "b", "c"]);
    expect(parseMultiText('[1, "x"]')).toEqual([1, "x"]);
    expect(() => parseMultiText("[1,")).toThrow();
    expect(() => parseMultiText("[]x")).toThrow();
  });

  it("formatMultiText", () => {
    expect(formatMultiText(null)).toBe("");
    expect(formatMultiText([])).toBe("");
    expect(formatMultiText(["a", 1])).toBe("a, 1");
    expect(formatMultiText([{ id: 1 }])).toBe('[\n  {\n    "id": 1\n  }\n]');
    expect(formatMultiText("x")).toBe("x");
  });

  it("normalizeMultiSelectValue", () => {
    expect(normalizeMultiSelectValue(undefined)).toEqual([]);
    expect(normalizeMultiSelectValue("")).toEqual([]);
    expect(normalizeMultiSelectValue("a")).toEqual(["a"]);
    expect(normalizeMultiSelectValue([1, { id: "b" }, { value: "c" }, { name: "d" }, {}])).toEqual([
      "1",
      "b",
      "c",
      "d",
    ]);
  });

  it("cleanRequirements убирает пустое", () => {
    expect(cleanRequirements({ a: null, b: " ", c: [], d: {}, e: 0, f: false, g: "x" })).toEqual({
      e: 0,
      f: false,
      g: "x",
    });
    expect(cleanRequirements(null)).toEqual({});
  });

  it("resolveFieldOptions: внешние опции приоритетнее встроенных", () => {
    const statuses = getRequirementFieldDef("statuses")!;
    expect(resolveFieldOptions(statuses, {})).toEqual([
      { value: "activated", label: "Принятые" },
      { value: "finished", label: "Выполненные" },
    ]);
    expect(resolveFieldOptions(statuses, { statuses: [{ id: "x", label: "X" }] })).toEqual([
      { value: "x", label: "X" },
    ]);
    const systems = getRequirementFieldDef("payment_systems")!;
    expect(resolveFieldOptions(systems, {})).toEqual([]);
    expect(
      resolveFieldOptions(systems, { payment_systems: [{ id: "1", label: "Карта" }] }),
    ).toEqual([{ value: "1", label: "Карта" }]);
  });
});
