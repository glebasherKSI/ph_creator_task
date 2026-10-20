/** Cron расписания задач: разбор и сборка упрощённого формата «0 H D * W». */

export type RepeatPeriod = "day" | "week" | "month";

export const REPEAT_PERIODS: ReadonlyArray<{ id: RepeatPeriod; label: string }> = [
  { id: "day", label: "День" },
  { id: "week", label: "Неделя" },
  { id: "month", label: "Месяц" },
];

export const DAY_OF_WEEK_OPTIONS = [
  { value: "1", label: "Понедельник" },
  { value: "2", label: "Вторник" },
  { value: "3", label: "Среда" },
  { value: "4", label: "Четверг" },
  { value: "5", label: "Пятница" },
  { value: "6", label: "Суббота" },
  { value: "7", label: "Воскресенье" },
];

export const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => ({
  value: String(hour),
  label: `${hour}:00`,
}));

export const MONTH_DAY_OPTIONS = Array.from({ length: 31 }, (_, index) => ({
  value: String(index + 1),
  label: String(index + 1),
}));

export interface ParsedCron {
  ok: boolean;
  period: RepeatPeriod;
  hours: number[];
  daysOfMonth: number[];
  daysOfWeek: number[];
  raw?: string;
}

function parseCronNumberList(raw: string): number[] {
  const trimmed = String(raw || "").trim();
  if (!trimmed || trimmed === "*") return [];
  return trimmed
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((num) => Number.isInteger(num));
}

function formatCronNumberList(values: number[]): string {
  return [...values]
    .sort((a, b) => a - b)
    .map(String)
    .join(",");
}

const EMPTY = (raw?: string): ParsedCron => ({
  ok: false,
  period: "day",
  hours: [],
  daysOfMonth: [],
  daysOfWeek: [],
  raw,
});

export function parseCron(cron: string | null | undefined): ParsedCron {
  const raw = cron == null ? "" : String(cron).trim();
  if (!raw) return { ok: true, period: "day", hours: [], daysOfMonth: [], daysOfWeek: [] };

  const parts = raw.split(/\s+/);
  if (parts.length !== 5) return EMPTY(raw);

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];
  const isSimpleList = (value: string) => /^[\d,*]+$/.test(value);
  if (
    minute !== "0" ||
    month !== "*" ||
    !isSimpleList(hour) ||
    !isSimpleList(dayOfMonth) ||
    !isSimpleList(dayOfWeek)
  ) {
    return EMPTY(raw);
  }

  const hours = parseCronNumberList(hour).filter((value) => value >= 0 && value <= 23);
  if (hour !== "*" && !hours.length) return EMPTY(raw);
  const daysOfMonth = parseCronNumberList(dayOfMonth).filter((value) => value >= 1 && value <= 31);
  const daysOfWeek = parseCronNumberList(dayOfWeek).filter((value) => value >= 1 && value <= 7);

  if (dayOfWeek !== "*" && daysOfWeek.length) {
    return { ok: true, period: "week", hours, daysOfMonth: [], daysOfWeek };
  }
  if (dayOfMonth !== "*" && daysOfMonth.length) {
    return { ok: true, period: "month", hours, daysOfMonth, daysOfWeek: [] };
  }
  if (dayOfMonth === "*" && dayOfWeek === "*") {
    return { ok: true, period: "day", hours, daysOfMonth: [], daysOfWeek: [] };
  }
  return { ok: false, period: "day", hours, daysOfMonth, daysOfWeek, raw };
}

export function buildCron({
  period,
  hours,
  daysOfMonth = [],
  daysOfWeek = [],
}: {
  period: RepeatPeriod;
  hours: number[];
  daysOfMonth?: number[];
  daysOfWeek?: number[];
}): string | null {
  const normalizedHours = [...hours]
    .filter((value) => Number.isInteger(value) && value >= 0 && value <= 23)
    .sort((a, b) => a - b);
  if (!normalizedHours.length) return null;
  const hourPart = formatCronNumberList(normalizedHours);

  if (period === "week") {
    const days = [...daysOfWeek]
      .filter((value) => Number.isInteger(value) && value >= 1 && value <= 7)
      .sort((a, b) => a - b);
    if (!days.length) return null;
    return `0 ${hourPart} * * ${formatCronNumberList(days)}`;
  }
  if (period === "month") {
    const days = [...daysOfMonth]
      .filter((value) => Number.isInteger(value) && value >= 1 && value <= 31)
      .sort((a, b) => a - b);
    if (!days.length) return null;
    return `0 ${hourPart} ${formatCronNumberList(days)} * *`;
  }
  return `0 ${hourPart} * * *`;
}

/** Состояние виджета расписания; `fallback` — cron, который не удалось разобрать. */
export interface RepeatScheduleValue {
  period: RepeatPeriod;
  hours: number[];
  daysOfMonth: number[];
  daysOfWeek: number[];
  fallback: string | null;
}

export function scheduleFromCron(cron: string | null | undefined): RepeatScheduleValue {
  const parsed = parseCron(cron);
  if (!parsed.ok) {
    return {
      period: "day",
      hours: [],
      daysOfMonth: [],
      daysOfWeek: [],
      fallback: parsed.raw || "",
    };
  }
  return {
    period: parsed.period,
    hours: parsed.hours,
    daysOfMonth: parsed.daysOfMonth,
    daysOfWeek: parsed.daysOfWeek,
    fallback: null,
  };
}

export function scheduleToCron(value: RepeatScheduleValue): string | null {
  if (value.fallback != null) return value.fallback.trim() || null;
  return buildCron(value);
}
