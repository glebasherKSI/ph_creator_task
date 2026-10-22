import { describe, expect, it } from "vitest";

import { frontTitleKey, mergeLocales, normalizeFrontTitles } from "@/lib/front-titles";

describe("front-titles", () => {
  it("frontTitleKey: без регистра и пробелов по краям", () => {
    expect(frontTitleKey("  Default_Deposit_task1 ")).toBe("default_deposit_task1");
    expect(frontTitleKey(null)).toBe("");
  });

  it("normalizeFrontTitles: только заполненные, коды в нижнем регистре", () => {
    expect(normalizeFrontTitles({ RU: " Пополняемся ", en: "", de: null, fr: "  " })).toEqual({
      ru: "Пополняемся",
    });
    expect(normalizeFrontTitles(null)).toEqual({});
  });

  it("mergeLocales: словарь поверх текущих, пустые локали — в missing", () => {
    const merged = mergeLocales(
      { ru: "Старое", pt: "Só um restinho", de: "" },
      { ru: "На донышке", en: "Running on Empty" },
      ["de", "en", "pt", "ru"],
    );
    expect(merged.locales).toEqual({
      ru: "На донышке",
      en: "Running on Empty",
      pt: "Só um restinho",
    });
    expect(merged.missing).toEqual(["de"]);
    expect(merged.changed).toBe(true);
  });

  it("mergeLocales: ничего не поменялось — changed false", () => {
    const merged = mergeLocales({ ru: "Раз" }, { ru: "Раз" }, ["ru"]);
    expect(merged.changed).toBe(false);
    expect(merged.missing).toEqual([]);
  });
});
