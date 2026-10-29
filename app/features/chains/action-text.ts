/**
 * Целевые действия понятным языком: «points_sum: 1000» → «Сумма платежей — 10 €».
 * Подписи полей и варианты — из той же схемы, что у формы (actions-schema).
 * Денежные поля хранятся в поинтах: 100 поинтов = 1 €.
 */
import { getRequirementFieldDef, uiFieldKey } from "@/lib/actions-schema";
import { actionTypeLabel } from "@/lib/labels-ru";
import type { TaskAction } from "@/lib/types";

const POINTS_SUFFIX = /\s*\(в поинтах\)\s*$/i;
/** Поинтов в одном евро. */
export const POINTS_PER_EURO = 100;

/**
 * Денежные поля действий (в поинтах). Явным списком: «Минимальный размер платежа»
 * и диапазон суммы тоже в поинтах, хотя в подписи схемы этого не сказано.
 */
const MONEY_FIELDS: ReadonlySet<string> = new Set([
  "points_sum",
  "min_points",
  "max_points",
  "bet_points_sum",
  "sport_bet_points_sum",
  "min_bet_amount",
  "bonuses_points_sum",
  "money_range",
]);

export function isMoneyField(key: string): boolean {
  return MONEY_FIELDS.has(key);
}

/** Сколько элементов списка показывать до «и ещё N». */
const LIST_LIMIT = 4;

const OPERATOR_TEXT: Record<string, string> = {
  ">=": "от",
  ">": "больше",
  "<=": "до",
  "<": "меньше",
  "=": "ровно",
  "==": "ровно",
};

const PERIOD_FORMS: Record<string, [string, string, string]> = {
  hours: ["час", "часа", "часов"],
  days: ["день", "дня", "дней"],
  weeks: ["неделя", "недели", "недель"],
  months: ["месяц", "месяца", "месяцев"],
  years: ["год", "года", "лет"],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function plural(n: number, [one, few, many]: [string, string, string]): string {
  const mod10 = Math.abs(n) % 10;
  const mod100 = Math.abs(n) % 100;
  if (!Number.isInteger(n)) return few;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

const NUMBER = /^-?\d+(?:[.,]\d+)?$/;

/** «1000» → «1 000», «1.5» → «1,5»; не число — как есть. */
export function formatActionNumber(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!NUMBER.test(text)) return text;
  return Number(text.replace(",", ".")).toLocaleString("ru-RU", { maximumFractionDigits: 6 });
}

function listText(items: unknown[], optionLabel: (id: string) => string): string {
  const names = items
    .map((item) =>
      isRecord(item) ? String(item.name ?? item.title ?? item.id ?? "") : optionLabel(String(item)),
    )
    .filter(Boolean);
  if (names.length <= LIST_LIMIT) return names.join(", ");
  return `${names.slice(0, LIST_LIMIT - 1).join(", ")} и ещё ${names.length - LIST_LIMIT + 1}`;
}

/** Поинты → «10 €», «1,5 €»; не число — как есть. */
export function formatEuro(points: unknown): string {
  const text = String(points ?? "").trim();
  if (!NUMBER.test(text)) return text;
  const euros = Number(text.replace(",", ".")) / POINTS_PER_EURO;
  return `${euros.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} €`;
}

/** Значение поля действия текстом; денежные поля — в евро. */
export function describeActionValue(key: string, value: unknown): string {
  const def = getRequirementFieldDef(key);
  const optionLabel = (id: string) => def?.options?.find((o) => o.id === id)?.label ?? id;
  const money = isMoneyField(key);
  const amount = (raw: unknown) => (money ? formatEuro(raw) : formatActionNumber(raw));
  // В диапазоне «€» один раз в конце: «от 1 до 5 €».
  const bare = (raw: unknown) => amount(raw).replace(/\s€$/, "");

  if (Array.isArray(value)) return listText(value, optionLabel);
  if (typeof value === "boolean") return value ? "да" : "нет";
  if (isRecord(value)) {
    if (value.operator != null && value.value != null) {
      const op = OPERATOR_TEXT[String(value.operator).trim()] ?? String(value.operator);
      return `${op} ${amount(value.value)}`.trim();
    }
    if (value.period != null && value.value != null) {
      const n = Number(value.value);
      const forms = PERIOD_FORMS[String(value.period)];
      return forms && Number.isFinite(n)
        ? `${formatActionNumber(n)} ${plural(n, forms)}`
        : `${String(value.value)} ${String(value.period)}`;
    }
    if (value.min != null || value.max != null) {
      const parts = [
        value.min != null ? `от ${bare(value.min)}` : "",
        value.max != null ? `до ${bare(value.max)}` : "",
      ].filter(Boolean);
      return `${parts.join(" ")}${money ? " €" : ""}`;
    }
    return Object.entries(value)
      .map(([k, v]) => `${k}: ${String(v)}`)
      .join(", ");
  }
  const text = String(value ?? "");
  if (def?.options) return optionLabel(text);
  return amount(text);
}

/** Подпись поля действия без «(в поинтах)» — значение и так показывается в евро. */
export function actionFieldLabel(key: string): string {
  return (getRequirementFieldDef(key)?.label ?? key).replace(POINTS_SUFFIX, "");
}

function isFilled(value: unknown): boolean {
  if (value == null || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/** Заполненные поля действия по порядку (requirements, затем conditions), в ключах формы. */
export function actionFields(action: TaskAction | null | undefined): Array<[string, unknown]> {
  const type = String(action?.action ?? "");
  const fields = { ...(action?.requirements ?? {}), ...(action?.conditions ?? {}) };
  // Ключи API (`types`) → ключи формы: у них подписи и варианты из схемы.
  return Object.entries(fields)
    .filter(([, value]) => isFilled(value))
    .map(([key, value]): [string, unknown] => [uiFieldKey(type, key), value]);
}

/** Одно действие текстом: «Депозит: сумма платежей — 10 €, …». */
export function describeAction(action: TaskAction): string {
  const name = actionTypeLabel(String(action?.action ?? "?"));
  const parts = actionFields(action).map(([key, value]) => {
    return `${actionFieldLabel(key).toLowerCase()} — ${describeActionValue(key, value)}`;
  });
  return parts.length ? `${name}: ${parts.join(", ")}` : name;
}
