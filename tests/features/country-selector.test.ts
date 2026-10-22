import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  conditionValueToCountrySelector,
  countryLabel,
  countrySelectorToConditionValue,
  countrySelectorValueToTaskFields,
  enrichFromConditions,
  normalizeCountrySelectorValue,
  parseCountriesData,
  taskToCountrySelectorValue,
  type CountrySelectorValue,
} from "@/features/task-form/country-selector";
import { parseConditionsSchema } from "@/lib/conditions-schema";

import * as legacy from "legacy/country-selector.js";

type Converter = (...args: unknown[]) => unknown;

/**
 * conditionValueToCountrySelector / countrySelectorToConditionValue в старом коде —
 * внутренние функции conditions-builder.js (не экспортируются). Берём их исходник
 * текстом и исполняем: они чистые и ни от чего не зависят.
 */
function legacyFunction(name: string): Converter {
  const source = readFileSync(
    path.resolve(import.meta.dirname, "../../tests/legacy/shared/conditions-builder.js"),
    "utf8",
  ).replace(/\r\n/g, "\n");
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`legacy ${name} not found`);
  const end = source.indexOf("\n}\n", start);
  const body = source.slice(start, end + 2);
  return new Function(`${body}\nreturn ${name};`)() as Converter;
}

const legacyConditionToSelector = legacyFunction("conditionValueToCountrySelector");
const legacySelectorToCondition = legacyFunction("countrySelectorToConditionValue");

const FIXTURE = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../../public/test_primer/constant.json"), "utf8"),
) as unknown;

describe("parseCountriesData — паритет со старой реализацией", () => {
  const RAW_CASES: unknown[] = [
    null,
    undefined,
    "garbage",
    [],
    {},
    { constants: {} },
    { constants: { countries: { all: [] }, countries_lists: "nope" } },
    {
      constants: {
        countries: {
          all: [
            { code: "us", en: "United States", ru: "США" },
            { code: "de", en: "Germany" },
            { code: "", en: "Empty" },
            null,
            "str",
            { code: "fr" },
          ],
        },
        countries_lists: [
          "all",
          { id: "lvl1", name: "Level 1" },
          { value: "lvl2", label: "Level 2" },
          { id: "lvl3" },
          42,
          null,
          {},
        ],
      },
    },
    {
      countries: { all: [], allowed: [{ code: "ru", en: "Russia", ru: "Россия" }] },
      countries_lists: [{ id: 7, name: "Seven" }],
    },
    FIXTURE,
  ];

  it.each(RAW_CASES.map((raw, index) => [index, raw]))("case #%i", (_index, raw) => {
    expect(parseCountriesData(raw, "test")).toEqual(legacy.parseCountriesData(raw, "test"));
  });

  it("фикстура constant.json даёт непустые списки", () => {
    const data = parseCountriesData(FIXTURE, "fixture");
    expect(data.countries.length).toBeGreaterThan(100);
    expect(data.countriesLists.map((item) => item.id)).toContain("welcome_level_1");
    expect(data.source).toBe("fixture");
  });

  it("достаёт реальные языки проекта из constants.locales", () => {
    const data = parseCountriesData(FIXTURE, "fixture");
    expect(data.locales).toEqual(["en", "ru", "fr", "de", "pl", "ua"]);
  });

  it("locales: без поля — пустой список; дубликаты и регистр нормализуются", () => {
    expect(parseCountriesData({}, "x").locales).toEqual([]);
    expect(parseCountriesData({ locales: ["RU", "ru", " En ", "de"] }, "x").locales).toEqual([
      "ru",
      "en",
      "de",
    ]);
  });
});

describe("enrichFromConditions", () => {
  const schema = parseConditionsSchema({
    conditions: [
      {
        name: "profile_country",
        label: "Страна",
        type: "countries_with_lists",
        value: null,
        collection: [
          { id: "us", name: "США" },
          { id: "by", name: "Беларусь" },
        ],
        countriesLists: [{ id: "lvl1", name: "Уровень 1" }, { value: "lvl2" }, { name: "no id" }],
      },
    ],
  });

  it("дополняет пустые списки из схемы", () => {
    const data = enrichFromConditions(
      { countries: [], countriesLists: [], locales: [], source: "x" },
      schema,
    );
    expect(data.countries).toEqual([
      { code: "BY", en: "Беларусь", ru: "Беларусь" },
      { code: "US", en: "США", ru: "США" },
    ]);
    expect(data.countriesLists).toEqual([
      { id: "lvl1", label: "Уровень 1" },
      { id: "lvl2", label: "lvl2" },
    ]);
  });

  it("не трогает непустые списки и без схемы", () => {
    const data = parseCountriesData(FIXTURE, "api");
    expect(enrichFromConditions(data, schema)).toEqual(data);
    expect(enrichFromConditions(data, null)).toBe(data);
  });
});

describe("normalizeCountrySelectorValue (setValue → getValue старого компонента)", () => {
  it.each<[Partial<CountrySelectorValue> | null | undefined, CountrySelectorValue]>([
    [undefined, { matchingType: "countries", countries: [], countriesLists: [] }],
    [null, { matchingType: "countries", countries: [], countriesLists: [] }],
    [{ matchingType: "garbage" }, { matchingType: "countries", countries: [], countriesLists: [] }],
    [
      { matchingType: "countries_lists", countriesLists: ["lvl1", "lvl1", "lvl2"] },
      { matchingType: "countries_lists", countries: [], countriesLists: ["lvl1", "lvl2"] },
    ],
    [{ countries: ["all"] }, { matchingType: "countries", countries: ["all"], countriesLists: [] }],
    [
      { countries: ["ALL", " all "] },
      { matchingType: "countries", countries: ["all"], countriesLists: [] },
    ],
    [
      { countries: ["all", "us"] },
      { matchingType: "countries", countries: ["US"], countriesLists: [] },
    ],
    [
      { countries: [" us ", "DE", "", "us"] },
      { matchingType: "countries", countries: ["US", "DE"], countriesLists: [] },
    ],
  ])("%o", (input, expected) => {
    expect(normalizeCountrySelectorValue(input)).toEqual(expected);
  });
});

describe("конвертеры условие ↔ селектор — паритет со старой реализацией", () => {
  const CONDITION_VALUES: unknown[] = [
    undefined,
    null,
    "garbage",
    42,
    [],
    ["US"],
    {},
    { list: ["all"] },
    { matchingType: "countries", list: ["US", "DE"], type: "disabled" },
    { matchingType: "countries_lists", list: ["lvl1", 7] },
    { matchingType: "unknown", list: "nope" },
    { matchingType: "countries_lists", list: null },
  ];

  it.each(CONDITION_VALUES.map((raw, index) => [index, raw]))(
    "conditionValueToCountrySelector #%i",
    (_index, raw) => {
      expect(conditionValueToCountrySelector(raw)).toEqual(legacyConditionToSelector(raw));
    },
  );

  const SELECTOR_VALUES: Array<Partial<CountrySelectorValue>> = [
    {},
    { matchingType: "countries", countries: [], countriesLists: [] },
    { matchingType: "countries", countries: ["all"], countriesLists: ["lvl1"] },
    { matchingType: "countries", countries: ["US", "DE"] },
    { matchingType: "countries_lists", countries: ["US"], countriesLists: ["lvl1", "lvl2"] },
    { matchingType: "garbage", countries: ["FR"] },
  ];
  const CURRENT_VALUES: unknown[] = [
    undefined,
    null,
    "garbage",
    [],
    {},
    { type: "disabled", list: ["old"] },
    { type: 5 },
  ];

  it.each(
    SELECTOR_VALUES.flatMap((selector) =>
      CURRENT_VALUES.map((current) => [selector, current] as const),
    ),
  )("countrySelectorToConditionValue(%o, %o)", (selector, current) => {
    expect(countrySelectorToConditionValue(selector, current)).toEqual(
      legacySelectorToCondition(selector, current),
    );
  });

  it("roundtrip условие → селектор → условие", () => {
    for (const value of [
      { type: "enabled", matchingType: "countries", list: ["US", "DE"] },
      { type: "disabled", matchingType: "countries_lists", list: ["lvl1"] },
      { type: "enabled", matchingType: "countries", list: ["all"] },
    ]) {
      expect(
        countrySelectorToConditionValue(conditionValueToCountrySelector(value), value),
      ).toEqual(value);
    }
  });
});

describe("поля задачи ↔ селектор (как copy-panel)", () => {
  it("taskToCountrySelectorValue", () => {
    expect(taskToCountrySelectorValue({})).toEqual({
      matchingType: "countries",
      countries: [],
      countriesLists: [],
    });
    expect(
      taskToCountrySelectorValue({
        countries_matching_type: null,
        countries: ["US"],
        countries_lists: [1, "lvl2"],
      }),
    ).toEqual({ matchingType: "countries", countries: ["US"], countriesLists: ["1", "lvl2"] });
    expect(
      taskToCountrySelectorValue({ countries_matching_type: "countries_lists" }).matchingType,
    ).toBe("countries_lists");
  });

  it("countrySelectorValueToTaskFields", () => {
    expect(
      countrySelectorValueToTaskFields({
        matchingType: "countries_lists",
        countries: [],
        countriesLists: ["lvl1"],
      }),
    ).toEqual({
      countries_matching_type: "countries_lists",
      countries: [],
      countries_lists: ["lvl1"],
    });
    expect(
      countrySelectorValueToTaskFields({ matchingType: "", countries: ["all"], countriesLists: [] })
        .countries_matching_type,
    ).toBeUndefined();
  });
});

describe("countryLabel", () => {
  it("CODE - en - ru", () => {
    expect(countryLabel({ code: "US", en: "United States", ru: "США" })).toBe(
      "US - United States - США",
    );
  });
});
