import { describe, expect, it } from "vitest";

import {
  actionFieldLabel,
  describeAction,
  describeActionValue,
  formatActionNumber,
  formatEuro,
} from "@/features/chains/action-text";

describe("целевые действия понятным языком", () => {
  it("подписи полей из схемы формы, без «(в поинтах)»", () => {
    expect(actionFieldLabel("points_sum")).toBe("Сумма платежей");
    expect(actionFieldLabel("min_bet_amount")).toBe("Минимальный размер ставки");
    expect(actionFieldLabel("payments_count")).toBe("Количество платежей");
    expect(actionFieldLabel("unknown_field")).toBe("unknown_field");
  });

  it("суммы в поинтах показываются в евро: 100 поинтов = 1 €", () => {
    expect(formatEuro(3000)).toBe("30 €");
    expect(formatEuro("150")).toBe("1,5 €");
    expect(formatEuro(123456)).toBe("1 234,56 €");
    expect(describeActionValue("points_sum", 1000)).toBe("10 €");
    // «Минимальный размер платежа» — тоже поинты, хотя в подписи схемы этого нет.
    expect(describeActionValue("min_points", 1500)).toBe("15 €");
    expect(describeActionValue("min_bet_amount", "50")).toBe("0,5 €");
    expect(describeActionValue("money_range", { min: 100, max: 500 })).toBe("от 1 до 5 €");
    expect(describeActionValue("money_range", { min: 1000 })).toBe("от 10 €");
    // Количество — не деньги.
    expect(describeActionValue("payments_count", 2)).toBe("2");
  });

  it("числа, сравнения, периоды, диапазоны, варианты и списки", () => {
    expect(formatActionNumber("1000")).toBe("1 000");
    expect(formatActionNumber("1,5")).toBe("1,5");
    expect(describeActionValue("odd", { operator: ">=", value: 1.5 })).toBe("от 1,5");
    expect(describeActionValue("duration", { value: 7, period: "days" })).toBe("7 дней");
    expect(describeActionValue("duration", { value: 1, period: "weeks" })).toBe("1 неделя");
    expect(describeActionValue("bet_type", "real")).toBe("На реальные деньги");
    expect(describeActionValue("sport_bet_types", ["single", "express"])).toBe("Ординар, Экспресс");
    expect(describeActionValue("games", [1, 2, 3, 4, 5, 6])).toBe("1, 2, 3 и ещё 3");
    expect(describeActionValue("games", [{ id: 9, name: "Book of Ra" }])).toBe("Book of Ra");
    expect(describeActionValue("in_sequence", true)).toBe("да");
  });

  it("действие целиком", () => {
    expect(
      describeAction({ action: "deposit", requirements: { payments_count: 1, min_points: 1000 } }),
    ).toBe("Депозит: количество платежей — 1, минимальный размер платежа — 10 €");
    expect(describeAction({ action: "deposit" })).toBe("Депозит");
  });

  it("ключ API `types` у sport_bet показывается как «Тип ставки»", () => {
    expect(
      describeAction({ action: "sport_bet", conditions: { types: ["single", "express"] } }),
    ).toBe("Ставки на спорт: тип ставки — Ординар, Экспресс");
  });
});
