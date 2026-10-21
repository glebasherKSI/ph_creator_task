import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  HANDLED_WIDGET_TYPES,
  canAddCondition,
  conditionInstanceLabel,
  defaultValueForDef,
  extraOptionList,
  filterPickerConditions,
  formatTagsInput,
  hasGamificationTaskOptions,
  isHandledWidget,
  isMultipleSelect,
  moneyRangeView,
  normalizeTaskOptions,
  numberInputValue,
  parseConditionsArray,
  parseJsonDraft,
  parseTagsInput,
  patchDuration,
  patchMoneyRange,
  patchValue,
  reconcileConditionItems,
  resolveGamificationTaskOptions,
  schemaStatusText,
  selectMultiValue,
  serializeConditions,
  setNested,
  toComboOptions,
  widgetTypeHint,
  type ConditionItem,
} from "@/features/task-form/conditions-builder";
import { getConditionDef, parseConditionsSchema } from "@/lib/conditions-schema";

import * as legacy from "legacy/conditions-builder.js";

import taskWithGamificationTasks from "../fixtures/har/task-with-gamification-tasks-1366.json";
import taskWithoutOnlyCompleted from "../fixtures/har/task-without-only-completed-1365.json";

type AnyFn = (...args: unknown[]) => unknown;

const LEGACY_SOURCE = readFileSync(
  path.resolve(import.meta.dirname, "../../tests/legacy/shared/conditions-builder.js"),
  "utf8",
).replace(/\r\n/g, "\n");

/**
 * Внутренние (неэкспортируемые) функции старого билдера: берём их исходник текстом
 * и исполняем. `deps` — другие внутренние функции, от которых зависит нужная.
 */
function legacyFunction(name: string, deps: string[] = []): AnyFn {
  const bodies = [...deps, name].map((fn) => {
    const start = LEGACY_SOURCE.indexOf(`function ${fn}(`);
    if (start < 0) throw new Error(`legacy ${fn} not found`);
    const end = LEGACY_SOURCE.indexOf("\n}\n", start);
    return LEGACY_SOURCE.slice(start, end + 2);
  });
  return new Function(`${bodies.join("\n")}\nreturn ${name};`)() as AnyFn;
}

const legacyDefaultValueForDef = legacyFunction("defaultValueForDef", ["deepClone"]);
const legacyParseTagsInput = legacyFunction("parseTagsInput");
const legacySetNested = legacyFunction("setNested");
const legacyNormalizeTaskOptions = legacyFunction("normalizeTaskOptions");
const legacyResolveTaskOptions = legacyFunction("resolveGamificationTaskOptions", [
  "normalizeTaskOptions",
]);
const legacyHasTaskOptions = legacyFunction("hasGamificationTaskOptions", ["normalizeTaskOptions"]);
const legacyToComboOptions = legacyFunction("toComboOptions");

const FIXTURE_SCHEMA = parseConditionsSchema(
  JSON.parse(
    readFileSync(
      path.resolve(import.meta.dirname, "../../public/test_primer/conditions.json"),
      "utf8",
    ),
  ),
  "fixture",
);

const HAR_CONDITIONS = taskWithGamificationTasks.conditions as unknown[];
const HAR_CONDITIONS_1365 = taskWithoutOnlyCompleted.conditions as unknown[];

const stripIds = (items: ConditionItem[]) => items.map(({ name, value }) => ({ name, value }));

describe("HANDLED_WIDGET_TYPES", () => {
  it("совпадает со старым набором", () => {
    expect([...HANDLED_WIDGET_TYPES].sort()).toEqual(
      [...(legacy.HANDLED_WIDGET_TYPES as Set<string>)].sort(),
    );
  });

  it("isHandledWidget / widgetTypeHint", () => {
    expect(isHandledWidget(getConditionDef(FIXTURE_SCHEMA, "gamification_tasks"))).toBe(true);
    expect(isHandledWidget(getConditionDef(FIXTURE_SCHEMA, "balance"))).toBe(false);
    expect(isHandledWidget(null)).toBe(false);
    expect(widgetTypeHint(getConditionDef(FIXTURE_SCHEMA, "fraud"))).toBe("boolean");
    expect(widgetTypeHint(getConditionDef(FIXTURE_SCHEMA, "balance"))).toBe(
      "money_extended (расширенное)",
    );
    expect(widgetTypeHint(null)).toBe("неизвестный (расширенное)");
  });
});

describe("parseConditionsArray / serializeConditions", () => {
  const CASES: unknown[] = [
    null,
    undefined,
    "garbage",
    {},
    [],
    [null, 1, "x", [], [{ a: 1 }]],
    [{ fraud: false }, { deposit: { existence: "any" } }, {}],
    [{ a: 1, b: 2 }, { a: 3 }],
    HAR_CONDITIONS,
    HAR_CONDITIONS_1365,
  ];

  it.each(CASES.map((raw, index) => [index, raw]))(
    "паритет со старым разбором (без id) #%i",
    (_index, raw) => {
      const ours = parseConditionsArray(raw);
      const theirs = legacy.parseConditionsArray(raw) as ConditionItem[];
      expect(stripIds(ours)).toEqual(stripIds(theirs));
      expect(serializeConditions(ours)).toEqual(legacy.serializeConditionsArray(theirs));
    },
  );

  it("roundtrip на HAR-фикстуре", () => {
    const items = parseConditionsArray(HAR_CONDITIONS);
    expect(items.map((item) => item.name)).toEqual([
      "fraud",
      "no_bonus",
      "no_bonus_sport",
      "gambling_addict",
      "groups",
      "gamification_tasks",
    ]);
    expect(serializeConditions(items)).toEqual(HAR_CONDITIONS);
    expect(items[5]?.value).toEqual({
      list: ["1365", "1314"],
      type: "enabled",
      extra_type: "or",
      only_completed: true,
    });
  });

  it("id уникальны и не повторяются между разборами", () => {
    const a = parseConditionsArray(HAR_CONDITIONS);
    const b = parseConditionsArray(HAR_CONDITIONS);
    const ids = [...a, ...b].map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^c\d+$/);
  });

  it("объект с несколькими ключами даёт несколько элементов", () => {
    expect(stripIds(parseConditionsArray([{ a: 1, b: 2 }]))).toEqual([
      { name: "a", value: 1 },
      { name: "b", value: 2 },
    ]);
  });
});

describe("reconcileConditionItems — сохранение id", () => {
  const prev = parseConditionsArray([{ a: 1 }, { b: 2 }, { b: 3 }, { c: 4 }]);
  const idOf = (name: string, nth = 0) => prev.filter((p) => p.name === name)[nth]?.id;

  it("тот же состав — те же id, новые значения", () => {
    const next = reconcileConditionItems(prev, [{ a: 10 }, { b: 2 }, { b: 30 }, { c: 4 }]);
    expect(next.map((item) => item.id)).toEqual(prev.map((item) => item.id));
    expect(next[0]?.value).toBe(10);
    expect(next[2]?.value).toBe(30);
  });

  it("удаление в середине не меняет id остальных", () => {
    const next = reconcileConditionItems(prev, [{ a: 1 }, { b: 3 }, { c: 4 }]);
    expect(next.map((item) => item.id)).toEqual([idOf("a"), idOf("b", 0), idOf("c")]);
  });

  it("новое условие получает новый id, повторы — по порядку", () => {
    const next = reconcileConditionItems(prev, [{ z: 0 }, { b: 2 }, { b: 3 }, { b: 9 }]);
    expect(next[0]?.id).not.toEqual(expect.arrayContaining(prev.map((p) => p.id)));
    expect(prev.map((p) => p.id)).not.toContain(next[0]?.id);
    expect(next[1]?.id).toBe(idOf("b", 0));
    expect(next[2]?.id).toBe(idOf("b", 1));
    expect(prev.map((p) => p.id)).not.toContain(next[3]?.id);
  });

  it("мусор → пусто", () => {
    expect(reconcileConditionItems(prev, "garbage")).toEqual([]);
  });
});

describe("defaultValueForDef — паритет", () => {
  const DEFS = [
    null,
    undefined,
    getConditionDef(FIXTURE_SCHEMA, "gamification_tasks"),
    getConditionDef(FIXTURE_SCHEMA, "fraud"),
    getConditionDef(FIXTURE_SCHEMA, "gender"),
    getConditionDef(FIXTURE_SCHEMA, "deposit"),
    getConditionDef(FIXTURE_SCHEMA, "profile_country"),
    { name: "x", label: "x", type: "boolean", value: null, extra: {} },
  ];

  it.each(DEFS.map((def, index) => [index, def]))("def #%i", (_index, def) => {
    expect(defaultValueForDef(def)).toEqual(legacyDefaultValueForDef(def));
  });

  it("копия, а не ссылка на значение схемы", () => {
    const def = getConditionDef(FIXTURE_SCHEMA, "gamification_tasks");
    const value = defaultValueForDef(def);
    expect(value).toEqual(def?.value);
    expect(value).not.toBe(def?.value);
  });
});

describe("parseTagsInput / formatTagsInput", () => {
  it.each(["", null, undefined, "1", "1, 2;3 4", "  a ,, b  ", ",;,", "12\n34\t56"])(
    "паритет: %j",
    (raw) => {
      expect(parseTagsInput(raw)).toEqual(legacyParseTagsInput(raw));
    },
  );

  it("formatTagsInput", () => {
    expect(formatTagsInput(["1", "2"])).toBe("1, 2");
    expect(formatTagsInput("nope")).toBe("");
    expect(parseTagsInput(formatTagsInput(["a", "b"]))).toEqual(["a", "b"]);
  });
});

describe("setNested — паритет (иммутабельно)", () => {
  it.each<[unknown, string, unknown]>([
    [{}, "money_range.type", "max"],
    [{ money_range: { type: "min", list: ["1"] } }, "money_range.type", "range"],
    [{ money_range: "garbage" }, "money_range.type", "min"],
    [{ duration: { period: "day" } }, "duration.number", 5],
    [{}, "a.b.c", 1],
    [{ a: 1 }, "a", 2],
  ])("%j · %s", (target, p, val) => {
    const legacyTarget = JSON.parse(JSON.stringify(target)) as Record<string, unknown>;
    legacySetNested(legacyTarget, p, val);
    const before = JSON.stringify(target);
    expect(setNested(target, p, val)).toEqual(legacyTarget);
    expect(JSON.stringify(target)).toBe(before);
  });
});

describe("patchValue / patchMoneyRange / patchDuration", () => {
  it("patchValue: не-объект заменяется объектом", () => {
    expect(patchValue({ a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 });
    expect(patchValue(true, { type: "min" })).toEqual({ type: "min" });
    expect(patchValue(null, {})).toEqual({});
  });

  it("money_range min/max для range пишутся в list", () => {
    const value = { money_range: { type: "range", list: [] } };
    const next = patchMoneyRange(value, "min", 10);
    expect(next).toEqual({ money_range: { type: "range", list: [10] } });
    expect(patchMoneyRange(next, "max", 20)).toEqual({
      money_range: { type: "range", list: [10, 20] },
    });
    expect(patchMoneyRange({ money_range: { type: "range" } }, "max", 7)).toEqual({
      money_range: { type: "range", list: [null, 7] },
    });
  });

  it("money_range min для min/max — list = [String(val)], null → []", () => {
    expect(patchMoneyRange({ money_range: { type: "min" } }, "min", 5)).toEqual({
      money_range: { type: "min", list: ["5"] },
    });
    expect(patchMoneyRange({}, "min", 5)).toEqual({ money_range: { list: ["5"] } });
    expect(patchMoneyRange({ money_range: { list: ["5"] } }, "min", null)).toEqual({
      money_range: { list: [] },
    });
  });

  it("money_range exclude_end/type — как есть; исходное не мутируется", () => {
    const value = { existence: "any", money_range: { type: "min", list: ["1"] } };
    const next = patchMoneyRange(value, "exclude_end", true);
    expect(next).toEqual({
      existence: "any",
      money_range: { type: "min", list: ["1"], exclude_end: true },
    });
    expect(value.money_range).toEqual({ type: "min", list: ["1"] });
  });

  it("patchDuration", () => {
    expect(patchDuration({ duration: { period: "day" } }, "number", 3)).toEqual({
      duration: { period: "day", number: 3 },
    });
    expect(patchDuration({ duration: "garbage" }, "period", "week")).toEqual({
      duration: { period: "week" },
    });
    expect(patchDuration(undefined, "include_current_period", true)).toEqual({
      duration: { include_current_period: true },
    });
  });

  it("moneyRangeView", () => {
    expect(moneyRangeView(undefined)).toEqual({ type: "min", min: "", max: "", excludeEnd: false });
    expect(moneyRangeView({ type: "range", list: [1, 2], exclude_end: true })).toEqual({
      type: "range",
      min: "1",
      max: "2",
      excludeEnd: true,
    });
    expect(moneyRangeView({ type: "max", list: [], max: 9 })).toEqual({
      type: "max",
      min: "",
      max: "9",
      excludeEnd: false,
    });
    expect(moneyRangeView({ type: "", list: ["3"] })).toMatchObject({ type: "", min: "3" });
  });
});

describe("canAddCondition", () => {
  const items = parseConditionsArray([{ fraud: false }, { groups: {} }]);

  it("без списка повторяемых — только отсутствующие", () => {
    expect(canAddCondition(items, "deposit", null)).toBe(true);
    expect(canAddCondition(items, "fraud", null)).toBe(false);
    expect(canAddCondition(items, "fraud", new Set())).toBe(false);
  });

  it("повторяемое можно добавить снова", () => {
    const duplicable = new Set(["groups"]);
    expect(canAddCondition(items, "groups", duplicable)).toBe(true);
    expect(canAddCondition(items, "fraud", duplicable)).toBe(false);
    expect(canAddCondition([], "fraud", duplicable)).toBe(true);
  });
});

describe("gamification_task — список заданий", () => {
  const def = getConditionDef(FIXTURE_SCHEMA, "gamification_tasks");
  const defWithCollection = {
    ...def!,
    collection: [
      { id: "1", name: "Первое" },
      { id: "2", name: "Второе" },
    ],
  };
  const TASK_OPTIONS_CASES: unknown[] = [
    undefined,
    null,
    [],
    "garbage",
    [{ id: 2, name: "Второе (live)" }, { value: "3", label: "Третье" }, null, {}, { id: 4 }],
  ];
  const SELECTED_CASES: Array<string[] | undefined> = [undefined, [], ["2", "99"]];

  it.each(TASK_OPTIONS_CASES.map((opts, index) => [index, opts]))(
    "normalizeTaskOptions паритет #%i",
    (_index, opts) => {
      expect(normalizeTaskOptions(opts)).toEqual(legacyNormalizeTaskOptions(opts));
    },
  );

  it.each(
    [def, defWithCollection, null].flatMap((d) =>
      TASK_OPTIONS_CASES.flatMap((opts) => SELECTED_CASES.map((sel) => [d, opts, sel] as const)),
    ),
  )("resolve/has паритет (%o, %o, %o)", (d, opts, sel) => {
    const ctx = { externalOptions: legacyNormalizeTaskOptions(opts) };
    expect(resolveGamificationTaskOptions(d, sel, opts as never)).toEqual(
      legacyResolveTaskOptions(d, sel, ctx),
    );
    expect(hasGamificationTaskOptions(d, opts as never)).toBe(legacyHasTaskOptions(d, ctx));
    // Live-источник (getTaskOptions) в старом коде — тот же список.
    expect(resolveGamificationTaskOptions(d, sel, opts as never)).toEqual(
      legacyResolveTaskOptions(d, sel, { getTaskOptions: () => opts }),
    );
  });

  it("live-каталог перекрывает снимок схемы, выбранные без имени — подпись = id", () => {
    expect(
      resolveGamificationTaskOptions(
        defWithCollection,
        ["2", "99"],
        [{ id: "2", name: "Второе (live)" }],
      ),
    ).toEqual([
      { id: "1", name: "Первое" },
      { id: "2", name: "Второе (live)" },
      { id: "99", name: "99" },
    ]);
    const defNoCollection = { ...def!, collection: [] };
    expect(hasGamificationTaskOptions(defNoCollection, [])).toBe(false);
    expect(hasGamificationTaskOptions(defNoCollection, [{ id: 1, name: "x" }])).toBe(true);
    expect(hasGamificationTaskOptions(defWithCollection, [])).toBe(true);
  });
});

describe("опции виджетов", () => {
  it("toComboOptions паритет", () => {
    for (const raw of [
      undefined,
      "x",
      [],
      [{ id: 1, name: "One" }, { id: "2" }, { name: "no id" }, null],
    ]) {
      expect(toComboOptions(raw)).toEqual(legacyToComboOptions(raw));
    }
  });

  it("extraOptionList читает списки из extra", () => {
    const deposit = getConditionDef(FIXTURE_SCHEMA, "deposit");
    expect(extraOptionList(deposit, "availableExistenceTypes")).toEqual([
      { id: "any", name: "Любой" },
      { id: "last", name: "Последний" },
      { id: "first", name: "Первый" },
    ]);
    expect(extraOptionList(deposit, "nope")).toBeUndefined();
    expect(extraOptionList(null, "x")).toBeUndefined();
    const bets = getConditionDef(FIXTURE_SCHEMA, "bets_count");
    expect(extraOptionList(bets, "availablePeriods")?.map((o) => o.id)).toContain("hour");
  });

  it("isMultipleSelect / selectMultiValue", () => {
    expect(isMultipleSelect(getConditionDef(FIXTURE_SCHEMA, "gender"))).toBe(false);
    expect(
      isMultipleSelect({
        name: "x",
        label: "x",
        type: "select",
        value: null,
        extra: { multiple: true },
      }),
    ).toBe(true);
    expect(selectMultiValue(["a", 1])).toEqual(["a", "1"]);
    expect(selectMultiValue("m")).toEqual(["m"]);
    expect(selectMultiValue("")).toEqual([]);
    expect(selectMultiValue(null)).toEqual([]);
  });

  it("numberInputValue", () => {
    expect(numberInputValue("")).toBeNull();
    expect(numberInputValue("abc")).toBeNull();
    expect(numberInputValue("12.5")).toBe(12.5);
    expect(numberInputValue("-3")).toBe(-3);
  });

  it("parseJsonDraft", () => {
    expect(parseJsonDraft("")).toEqual({ ok: true, value: null });
    expect(parseJsonDraft('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    expect(parseJsonDraft("{")).toMatchObject({ ok: false });
  });
});

describe("пикер и подписи", () => {
  it("filterPickerConditions ищет по label / name, максимум 80", () => {
    expect(filterPickerConditions(null, "")).toEqual([]);
    expect(filterPickerConditions(FIXTURE_SCHEMA, "").length).toBe(80);
    expect(filterPickerConditions(FIXTURE_SCHEMA, "gamification").map((d) => d.name)).toEqual([
      "gamification_tasks",
    ]);
    expect(filterPickerConditions(FIXTURE_SCHEMA, "ПОЛ").map((d) => d.name)).toContain("gender");
    expect(filterPickerConditions(FIXTURE_SCHEMA, "zzz-nope")).toEqual([]);
  });

  it("conditionInstanceLabel нумерует повторы", () => {
    const items = parseConditionsArray([{ groups: {} }, { fraud: false }, { groups: {} }]);
    const def = getConditionDef(FIXTURE_SCHEMA, "groups");
    expect(conditionInstanceLabel(items, items[0]!, def)).toBe(`${def!.label} (1)`);
    expect(conditionInstanceLabel(items, items[2]!, def)).toBe(`${def!.label} (2)`);
    expect(conditionInstanceLabel(items, items[1]!, null)).toBe("fraud");
  });

  it("schemaStatusText", () => {
    expect(schemaStatusText(null, null, true, null)).toBe("Загрузка схемы условий…");
    expect(schemaStatusText(null, null, false, "boom")).toBe("Схема не загружена: boom");
    expect(schemaStatusText(null, null, false, null)).toBe("Схема не загружена");
    expect(schemaStatusText(FIXTURE_SCHEMA, new Set(["groups"]), false, null)).toBe(
      `Схема: ${FIXTURE_SCHEMA.conditions.length} условий, ${FIXTURE_SCHEMA.widgetTypes.size} типов виджетов, 1 повторяемых (fixture)`,
    );
  });
});
