import { describe, expect, it } from "vitest";

import * as ts from "@/lib/actions-schema";
import { parseConditionsSchema } from "@/lib/conditions-schema";

// Старая реализация — эталон поведения до конца миграции (этап 9 удалит src/).
import * as legacy from "legacy/actions-schema.js";

const tsModule = ts as Record<string, unknown>;
const legacyModule = legacy as Record<string, unknown>;

function isPlainData(value: unknown): boolean {
  return (
    Array.isArray(value) ||
    value instanceof Set ||
    (!!value && typeof value === "object" && !(value instanceof Map))
  );
}

function normalize(value: unknown): unknown {
  if (value instanceof Set) return [...value].sort();
  return value;
}

describe("экспорты — паритет со старой реализацией", () => {
  it("набор имён экспортов совпадает", () => {
    // Новое в v3: ключи API для полей формы (sport_bet: «Тип ставки» → `types`).
    const added = new Set(["apiFieldKey", "uiFieldKey", "renameActionKeysForApi"]);
    expect(
      Object.keys(tsModule)
        .filter((name) => !added.has(name))
        .sort(),
    ).toEqual(Object.keys(legacyModule).sort());
  });

  const dataExports = Object.keys(legacyModule).filter((name) => isPlainData(legacyModule[name]));

  it("есть константы для сравнения", () => {
    expect(dataExports.length).toBeGreaterThan(5);
  });

  it.each(dataExports)("%s deep-equal", (name) => {
    expect(normalize(tsModule[name])).toEqual(normalize(legacyModule[name]));
  });
});

const ACTION_FAMILIES = [...ts.ACTION_TYPES, "unknown_action", "", "  deposit  "];

describe("ключи полей и определения — паритет", () => {
  it.each(ACTION_FAMILIES)("getAllRequirementFieldKeys(%j)", (type) => {
    expect(ts.getAllRequirementFieldKeys(type)).toEqual(legacy.getAllRequirementFieldKeys(type));
  });

  it.each(ACTION_FAMILIES)("getActionDef / fields / handled (%j)", (type) => {
    expect(ts.getActionDef(type)).toEqual(legacy.getActionDef(type));
    expect(ts.getConditionFieldsForAction(type)).toEqual(legacy.getConditionFieldsForAction(type));
    expect(ts.getAttributeFieldsForAction(type)).toEqual(legacy.getAttributeFieldsForAction(type));
    expect(ts.isHandledActionType(type)).toEqual(legacy.isHandledActionType(type));
  });

  it("getAllActionTypes", () => {
    expect(ts.getAllActionTypes()).toEqual(legacy.getAllActionTypes());
  });

  const fieldKeys = [...Object.keys(ts.FIELD_DEFS), "duration", "foo_count", "bar_sum", "x", ""];

  it.each(fieldKeys)("getRequirementFieldDef / getFieldRole (%j)", (key) => {
    expect(ts.getRequirementFieldDef(key)).toEqual(legacy.getRequirementFieldDef(key));
    expect(ts.getFieldRole(key)).toEqual(legacy.getFieldRole(key));
    expect(ts.isComparisonFieldKey(key)).toEqual(legacy.isComparisonFieldKey(key));
  });

  it("getFieldRoleForAction / isRequirementFieldAllowed по всем парам", () => {
    for (const type of ACTION_FAMILIES) {
      for (const key of fieldKeys) {
        expect(ts.getFieldRoleForAction(type, key)).toEqual(
          legacy.getFieldRoleForAction(type, key),
        );
        expect(ts.isRequirementFieldAllowed(type, key)).toEqual(
          legacy.isRequirementFieldAllowed(type, key),
        );
      }
    }
  });

  it("filterFieldKeysForAction", () => {
    const keys = ["bets_count", "games", "payments_count", "min_points", "nope", "odd"];
    for (const type of ACTION_FAMILIES) {
      for (const role of ["", "condition", "attribute"] as const) {
        expect(ts.filterFieldKeysForAction(type, keys, role)).toEqual(
          legacy.filterFieldKeysForAction(type, keys, role),
        );
      }
      expect(ts.filterFieldKeysForAction(type, null)).toEqual(
        legacy.filterFieldKeysForAction(type, null),
      );
    }
  });
});

type Sample = [string, string, Record<string, unknown> | null];

const SAMPLES: Sample[] = [
  [
    "deposit: строки/запятая/массивы/duration/money_range",
    "deposit",
    {
      payments_count: "1",
      min_points: "1,5",
      max_points: "abc",
      payment_systems: ["a", "b"],
      duration: { value: "2", period: "days" },
      money_range: { min: "1", max: "10" },
      child_systems: [],
      points_sum: "  ",
    },
  ],
  [
    "deposit: money_range через min_points, duration без value",
    "deposit",
    { min_points: "5", duration: { value: "", period: "" }, money_range: {} },
  ],
  [
    "cashout: пустые значения",
    "cashout",
    { payments_count: null, min_points: "", payment_systems: [], extra_field: "x" },
  ],
  [
    "bet: comparison type/value, games строкой",
    "bet",
    {
      bets_count: "3",
      games: "a:b, c:d",
      win_coefficient: { type: "min", value: "1,5" },
      in_sequence: "true",
      min_bet_amount: "2,25",
      game_categories: [{ id: 7, name: "slots" }, "live", { value: "x" }, {}],
    },
  ],
  [
    "bet: comparison operator symbol, games объектами",
    "bet",
    {
      games: [{ id: "g1" }, { game_id: 2 }, { gameId: 3 }, { name: "n" }, "s", {}],
      win_coefficient: { operator: ">=", value: "1.5" },
      bet_type: "real",
      result: "win",
    },
  ],
  [
    "bet: comparison alias + list, пустой value",
    "bet",
    {
      win_coefficient: { operator: "gte", list: ["2"] },
      min_bet_amount: "",
      bets_count: "0",
    },
  ],
  [
    "bet: comparison без значения",
    "bet",
    { win_coefficient: { type: "gt", value: "  " }, odd: { operator: "<" } },
  ],
  [
    "sport_bet: odd с min/max, типы",
    "sport_bet",
    {
      sport_bets_count: "2",
      sport_bet_points_sum: "100",
      odd: { min: "1,7" },
      sport_bet_types: ["single", "express"],
      sport_types: [1, 2],
      result: "lose",
      min_bet_amount: "3",
    },
  ],
  [
    "sport_bet: odd неизвестный оператор",
    "sport_bet",
    { odd: { operator: "between", value: "2" } },
  ],
  [
    "user_update: required_attributes объектами и мусором",
    "user_update",
    { required_attributes: [{ id: "avatar" }, "city", "bogus", { value: "gender" }] },
  ],
  [
    "user_update: legacy boolean поля профиля",
    "user_update",
    { avatar: true, nickname: "1", city: 1, state: "false", other: "keep" },
  ],
  ["user_update: пусто", "user_update", { required_attributes: [] }],
  [
    "tournament: числа и id-массивы",
    "tournament",
    {
      tournaments_count: "2",
      tournament_ids: ["1", "x", 3, "4,5"],
      games_taken_min: "1,5",
      place_min: "1",
      place_max: "abc",
    },
  ],
  ["tournament: все id невалидны", "tournament", { tournament_ids: ["x"], tournaments_count: "" }],
  ["leaderboard", "leaderboard", { place_min: "1", place_max: "10", payments_count: "5" }],
  [
    "gamification_task",
    "gamification_task",
    { tasks_count: "4", statuses: ["activated"], extra: 1 },
  ],
  ["groups_update", "groups_update", { group_ids: ["10", 11, "z"] }],
  ["scratch_card", "scratch_card", { scratch_card_ids: [1, "2"] }],
  ["bonus_issue", "bonus_issue", { bonuses_count: "1", name: "N", dsl_tag: "" }],
  ["achievement", "achievement", { achievements_count: "7", extra: true }],
  ["unknown action", "unknown_action", { foo: "bar", odd: { type: "gt", value: "1" } }],
  ["null bag", "deposit", null],
];

/** Результат split старого кода — с ключами API, как теперь шлёт новый. */
function withApiKeys(type: string, split: { requirements: unknown; conditions: unknown }) {
  const { requirements, conditions } = ts.renameActionKeysForApi({ action: type, ...split });
  return { requirements, conditions };
}

describe("«Тип ставки» у sport_bet — ключ API `types`", () => {
  it("форма → API: sport_bet_types уходит как types", () => {
    expect(
      ts.splitActionFieldsForApi("sport_bet", { sport_bet_types: ["single", "express"] }),
    ).toEqual({ requirements: {}, conditions: { types: ["single", "express"] } });
  });

  it("API → форма: types и старый sport_bet_types читаются как «Тип ставки»", () => {
    expect(ts.mergeActionFieldsForUi("sport_bet", {}, { types: ["single"] })).toEqual({
      sport_bet_types: ["single"],
    });
    expect(ts.mergeActionFieldsForUi("sport_bet", {}, { sport_bet_types: ["express"] })).toEqual({
      sport_bet_types: ["express"],
    });
  });

  it("переименование не трогает остальные поля и другие действия", () => {
    expect(
      ts.renameActionKeysForApi({
        action: "sport_bet",
        requirements: { sport_bets_count: 1 },
        conditions: { sport_bet_types: ["express"], types: ["single"], sport_types: ["Football"] },
      }),
    ).toEqual({
      action: "sport_bet",
      requirements: { sport_bets_count: 1 },
      // Видимое в форме значение побеждает.
      conditions: { types: ["express"], sport_types: ["Football"] },
    });
    const bet = { action: "bet", conditions: { sport_bet_types: ["x"] } };
    expect(ts.renameActionKeysForApi(bet)).toBe(bet);
  });
});

describe("coerce*/split/merge — паритет на реалистичных входах", () => {
  it.each(SAMPLES)("%s", (_name, type, fields) => {
    expect(ts.coerceActionRequirements(type, fields)).toEqual(
      legacy.coerceActionRequirements(type, fields),
    );
    expect(ts.coerceActionConditions(type, fields)).toEqual(
      legacy.coerceActionConditions(type, fields),
    );
    // Сознательное отличие: старый код слал «Тип ставки» как sport_bet_types — бэк его не читает.
    expect(ts.splitActionFieldsForApi(type, fields)).toEqual(
      withApiKeys(type, legacy.splitActionFieldsForApi(type, fields)),
    );
    expect(ts.deriveVisibleFieldsFromRequirements(type, fields)).toEqual(
      legacy.deriveVisibleFieldsFromRequirements(type, fields),
    );

    const split = ts.splitActionFieldsForApi(type, fields);
    const legacySplit = legacy.splitActionFieldsForApi(type, fields);
    expect(ts.mergeActionFieldsForUi(type, split.requirements, split.conditions)).toEqual(
      legacy.mergeActionFieldsForUi(type, legacySplit.requirements, legacySplit.conditions),
    );
    // Все поля в обоих бакетах — проверяем fallback по роли.
    expect(ts.mergeActionFieldsForUi(type, fields, fields)).toEqual(
      legacy.mergeActionFieldsForUi(type, fields, fields),
    );

    for (const key of [...ts.getAllRequirementFieldKeys(type), "money_range", "duration"]) {
      expect(ts.hasRequirementValue(fields, key, type)).toEqual(
        legacy.hasRequirementValue(fields, key, type),
      );
    }
  });

  it("не-объектные входы", () => {
    for (const bad of [undefined, "str", 42, ["a"]]) {
      const anyBad = bad as unknown as Record<string, unknown>;
      expect(ts.coerceActionRequirements("bet", anyBad)).toEqual(
        legacy.coerceActionRequirements("bet", bad),
      );
      expect(ts.coerceActionConditions("bet", anyBad)).toEqual(
        legacy.coerceActionConditions("bet", bad),
      );
      expect(ts.splitActionFieldsForApi("bet", bad)).toEqual(
        legacy.splitActionFieldsForApi("bet", bad),
      );
      expect(ts.mergeActionFieldsForUi("bet", bad, bad)).toEqual(
        legacy.mergeActionFieldsForUi("bet", bad, bad),
      );
    }
  });
});

describe("comparison helpers — паритет", () => {
  const values: unknown[] = [
    null,
    "",
    "1,5",
    [],
    {},
    { type: "min", value: "1,5" },
    { type: ">=", value: 2 },
    { type: "equals", value: "3" },
    { type: "weird", value: "3" },
    { operator: ">", value: "" },
    { operator: "==", list: ["4", "5"] },
    { operator: "lte", value: null, list: [] },
    { operator: "", value: "1" },
    { min: "2" },
    { max: 3 },
    { value: 0 },
    { list: [null], min: "7" },
  ];

  it.each(values.map((v) => [JSON.stringify(v) ?? "undefined", v]))(
    "parseComparisonValue(%s)",
    (_label, value) => {
      expect(ts.parseComparisonValue(value)).toEqual(legacy.parseComparisonValue(value));
    },
  );

  it("buildComparisonValue / normalizeComparisonType", () => {
    const types = ["eq", "gte", "greater_than", "less_or_equal", "max", "=", "nope", "", null];
    const vals = ["1,5", "2", 3, "", null, "abc", 0];
    for (const type of types) {
      expect(ts.normalizeComparisonType(type)).toEqual(legacy.normalizeComparisonType(type));
      for (const val of vals) {
        expect(ts.buildComparisonValue(type, val)).toEqual(legacy.buildComparisonValue(type, val));
      }
    }
  });
});

describe("UI input helpers — паритет", () => {
  const inputs: Array<[string, unknown]> = [
    ["odd", { type: "min", value: "1,5" }],
    ["odd", { operator: ">", value: 2.75 }],
    ["win_coefficient", { operator: "<=", value: "abc" }],
    ["win_coefficient", { type: "gt", value: "" }],
    ["win_coefficient", {}],
    ["odd", "1,5"],
    ["bets_count", "3"],
    ["bets_count", 3],
    ["bets_count", null],
    ["bets_count", undefined],
    ["games", ["a", "b"]],
  ];

  it.each(inputs)("formatRequirementFieldInputValue(%s, %j)", (key, value) => {
    expect(ts.formatRequirementFieldInputValue(key, value)).toEqual(
      legacy.formatRequirementFieldInputValue(key, value),
    );
  });

  it("readRequirementFieldInputValue", () => {
    const raws = ["2,5", "", "abc", "3"];
    for (const [key, previous] of inputs) {
      for (const raw of raws) {
        expect(ts.readRequirementFieldInputValue(key, raw, previous)).toEqual(
          legacy.readRequirementFieldInputValue(key, raw, previous),
        );
      }
    }
  });
});

describe("buildActionFieldOptionsFromConditionsSchema — паритет", () => {
  const raw = {
    conditions: [
      {
        name: "cashout_payment_systems",
        label: "Cashout PS",
        type: "payment",
        value: null,
        paymentSystems: [
          { id: "ps1", name: "PS One" },
          { id: 2, name: null },
        ],
      },
      {
        name: "deposit_payment_systems",
        label: "Deposit PS",
        type: "payment",
        value: null,
        paymentSystems: [{ id: "dps", name: "Deposit PS" }],
      },
      {
        name: "groups",
        label: "Groups",
        type: "groups",
        value: [],
        collection: [
          { id: 1, name: "VIP" },
          { id: 2, name: "New" },
        ],
      },
      {
        name: "scratch",
        label: "Scratch",
        type: "scratch_cards",
        value: [],
        collection: [{ id: 9, name: "Coll" }],
        scratchCards: [{ id: 5, name: "Card" }],
      },
      {
        name: "bets",
        label: "Bets",
        type: "casino",
        value: null,
        availableGameCategories: [{ id: "slots", name: "Slots" }, { id: "live" }],
        availableTournaments: [{ id: 11, name: "T11" }],
      },
    ],
  };

  const rawFallbacks = {
    conditions: [
      {
        name: "x",
        label: "X",
        type: "other",
        value: null,
        availableGroups: [{ id: "g", name: "G" }],
        availableScratchCards: [{ id: "s", name: "S" }],
      },
      { name: "groups", label: "Groups", type: "groups", value: [], collection: [] },
    ],
  };

  it.each([
    ["полная схема", raw],
    ["fallback через available*", rawFallbacks],
    ["пустая схема", {}],
  ])("%s", (_name, input) => {
    const schema = parseConditionsSchema(input, "test");
    expect(ts.buildActionFieldOptionsFromConditionsSchema(schema)).toEqual(
      legacy.buildActionFieldOptionsFromConditionsSchema(schema),
    );
  });

  it("null schema", () => {
    expect(ts.buildActionFieldOptionsFromConditionsSchema(null)).toEqual(
      legacy.buildActionFieldOptionsFromConditionsSchema(null),
    );
  });
});
