import { escapeHtml } from "./format.js";
import { mountMultiCombobox } from "./multi-combobox.js";

/** @typedef {"day" | "week" | "month"} RepeatPeriod */

export const REPEAT_PERIODS = [
  { id: "day", label: "День" },
  { id: "week", label: "Неделя" },
  { id: "month", label: "Месяц" },
];

const DAY_OF_WEEK_LABELS = [
  { id: "1", label: "Понедельник" },
  { id: "2", label: "Вторник" },
  { id: "3", label: "Среда" },
  { id: "4", label: "Четверг" },
  { id: "5", label: "Пятница" },
  { id: "6", label: "Суббота" },
  { id: "7", label: "Воскресенье" },
];

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => ({
  id: String(hour),
  label: `${hour}:00`,
}));

const MONTH_DAY_OPTIONS = Array.from({ length: 31 }, (_, index) => {
  const day = index + 1;
  return { id: String(day), label: String(day) };
});

/**
 * @param {string} raw
 * @returns {number[]}
 */
function parseCronNumberList(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed || trimmed === "*") return [];
  return trimmed
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((num) => Number.isInteger(num));
}

/**
 * @param {number[]} values
 * @returns {string}
 */
function formatCronNumberList(values) {
  return [...values]
    .sort((a, b) => a - b)
    .map(String)
    .join(",");
}

/**
 * @param {string | null | undefined} cron
 * @returns {{
 *   ok: boolean,
 *   period: RepeatPeriod,
 *   hours: number[],
 *   daysOfMonth: number[],
 *   daysOfWeek: number[],
 *   raw?: string
 * }}
 */
export function parseCron(cron) {
  const raw = cron == null ? "" : String(cron).trim();
  if (!raw) {
    return { ok: true, period: "day", hours: [], daysOfMonth: [], daysOfWeek: [] };
  }

  const parts = raw.split(/\s+/);
  if (parts.length !== 5) {
    return {
      ok: false,
      period: "day",
      hours: [],
      daysOfMonth: [],
      daysOfWeek: [],
      raw,
    };
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  const isSimpleList = (value) => /^[\d,*]+$/.test(value);
  if (
    minute !== "0" ||
    month !== "*" ||
    !isSimpleList(hour) ||
    !isSimpleList(dayOfMonth) ||
    !isSimpleList(dayOfWeek)
  ) {
    return {
      ok: false,
      period: "day",
      hours: [],
      daysOfMonth: [],
      daysOfWeek: [],
      raw,
    };
  }

  const hours = parseCronNumberList(hour).filter((value) => value >= 0 && value <= 23);
  if (hour !== "*" && !hours.length) {
    return {
      ok: false,
      period: "day",
      hours: [],
      daysOfMonth: [],
      daysOfWeek: [],
      raw,
    };
  }
  const daysOfMonth = parseCronNumberList(dayOfMonth).filter(
    (value) => value >= 1 && value <= 31
  );
  const daysOfWeek = parseCronNumberList(dayOfWeek).filter(
    (value) => value >= 1 && value <= 7
  );

  if (dayOfWeek !== "*" && daysOfWeek.length) {
    return { ok: true, period: "week", hours, daysOfMonth: [], daysOfWeek };
  }
  if (dayOfMonth !== "*" && daysOfMonth.length) {
    return { ok: true, period: "month", hours, daysOfMonth, daysOfWeek: [] };
  }
  if (dayOfMonth === "*" && dayOfWeek === "*") {
    return { ok: true, period: "day", hours, daysOfMonth: [], daysOfWeek: [] };
  }

  return {
    ok: false,
    period: "day",
    hours,
    daysOfMonth,
    daysOfWeek,
    raw,
  };
}

/**
 * @param {{
 *   period: RepeatPeriod,
 *   hours: number[],
 *   daysOfMonth?: number[],
 *   daysOfWeek?: number[]
 * }} state
 * @returns {string | null}
 */
export function buildCron({ period, hours, daysOfMonth = [], daysOfWeek = [] }) {
  const normalizedHours = [...hours]
    .filter((value) => Number.isInteger(value) && value >= 0 && value <= 23)
    .sort((a, b) => a - b);
  if (!normalizedHours.length) return null;

  const hourPart = formatCronNumberList(normalizedHours);

  if (period === "week") {
    const normalizedDays = [...daysOfWeek]
      .filter((value) => Number.isInteger(value) && value >= 1 && value <= 7)
      .sort((a, b) => a - b);
    if (!normalizedDays.length) return null;
    return `0 ${hourPart} * * ${formatCronNumberList(normalizedDays)}`;
  }

  if (period === "month") {
    const normalizedDays = [...daysOfMonth]
      .filter((value) => Number.isInteger(value) && value >= 1 && value <= 31)
      .sort((a, b) => a - b);
    if (!normalizedDays.length) return null;
    return `0 ${hourPart} ${formatCronNumberList(normalizedDays)} * *`;
  }

  return `0 ${hourPart} * * *`;
}

/**
 * @param {{ id: string, label: string }[]} options
 * @returns {{ value: string, label: string }[]}
 */
function toComboboxOptions(options) {
  return options.map((opt) => ({ value: String(opt.id), label: opt.label }));
}

/**
 * @param {string} mountId
 * @param {string} label
 */
function renderComboboxField(mountId, label) {
  return `
    <div class="repeat-schedule__field">
      <span class="repeat-schedule__label">${escapeHtml(label)}</span>
      <div id="${mountId}" class="repeat-schedule__combobox-mount"></div>
    </div>
  `;
}

/**
 * @param {{ getValue: () => string[] }} combobox
 * @returns {number[]}
 */
function readComboboxNumbers(combobox) {
  return combobox.getValue().map(Number).filter((value) => Number.isInteger(value));
}

/**
 * @param {{ setValue: (values: string[]) => void }} combobox
 * @param {number[]} values
 */
function setComboboxNumbers(combobox, values) {
  combobox.setValue((values || []).map(String));
}

/**
 * @param {HTMLElement} mountEl
 * @param {{ onChange?: () => void }} [options]
 */
export function mountRepeatSchedule(mountEl, options = {}) {
  const rootId = `repeat-schedule-${Math.random().toString(36).slice(2, 9)}`;
  const ids = {
    panel: `${rootId}-panel`,
    period: `${rootId}-period`,
    daysOfMonth: `${rootId}-days-of-month`,
    daysOfWeek: `${rootId}-days-of-week`,
    hours: `${rootId}-hours`,
    fallback: `${rootId}-fallback`,
    fallbackWrap: `${rootId}-fallback-wrap`,
  };

  mountEl.innerHTML = `
    <div class="repeat-schedule" data-repeat-schedule-root>
      <div id="${ids.panel}" class="repeat-schedule__panel">
        <div class="repeat-schedule__title">Повторение</div>
        <div class="repeat-schedule__grid">
          <label class="repeat-schedule__field">
            <span class="repeat-schedule__label">Период</span>
            <select id="${ids.period}" class="repeat-schedule__select">
              ${REPEAT_PERIODS.map(
                (item) => `<option value="${item.id}">${escapeHtml(item.label)}</option>`
              ).join("")}
            </select>
          </label>
          ${renderComboboxField(ids.hours, "Время")}
          <div id="${ids.daysOfWeek}" class="repeat-schedule__period-field repeat-schedule__period-field--hidden">
            ${renderComboboxField(`${ids.daysOfWeek}-mount`, "День недели")}
          </div>
          <div id="${ids.daysOfMonth}" class="repeat-schedule__period-field repeat-schedule__period-field--hidden">
            ${renderComboboxField(`${ids.daysOfMonth}-mount`, "День месяца")}
          </div>
        </div>
        <div id="${ids.fallbackWrap}" class="repeat-schedule__fallback repeat-schedule__fallback--hidden">
          <label class="repeat-schedule__field repeat-schedule__field--wide">
            <span class="repeat-schedule__label">Cron (не удалось разобрать)</span>
            <textarea id="${ids.fallback}" class="repeat-schedule__fallback-input" rows="2" placeholder="0 12 * * *"></textarea>
          </label>
        </div>
      </div>
    </div>
  `;

  const root = mountEl.querySelector("[data-repeat-schedule-root]");
  const periodEl = mountEl.querySelector(`#${ids.period}`);
  const daysOfMonthWrap = mountEl.querySelector(`#${ids.daysOfMonth}`);
  const daysOfWeekWrap = mountEl.querySelector(`#${ids.daysOfWeek}`);
  const fallbackWrap = mountEl.querySelector(`#${ids.fallbackWrap}`);
  const fallbackEl = mountEl.querySelector(`#${ids.fallback}`);

  let useFallback = false;

  function emitChange() {
    options.onChange?.();
  }

  const hoursCombobox = mountMultiCombobox(mountEl.querySelector(`#${ids.hours}`), {
    options: toComboboxOptions(HOUR_OPTIONS),
    placeholder: "Выберите время",
    searchPlaceholder: "Поиск…",
    onChange: emitChange,
  });

  const daysOfWeekCombobox = mountMultiCombobox(
    mountEl.querySelector(`#${ids.daysOfWeek}-mount`),
    {
      options: toComboboxOptions(DAY_OF_WEEK_LABELS),
      placeholder: "Выберите дни",
      searchPlaceholder: "Поиск…",
      onChange: emitChange,
    }
  );

  const daysOfMonthCombobox = mountMultiCombobox(
    mountEl.querySelector(`#${ids.daysOfMonth}-mount`),
    {
      options: toComboboxOptions(MONTH_DAY_OPTIONS),
      placeholder: "Выберите числа",
      searchPlaceholder: "Поиск…",
      onChange: emitChange,
    }
  );

  function syncPeriodFields() {
    const period = periodEl.value;
    daysOfMonthWrap?.classList.toggle(
      "repeat-schedule__period-field--hidden",
      period !== "month"
    );
    daysOfWeekWrap?.classList.toggle(
      "repeat-schedule__period-field--hidden",
      period !== "week"
    );
  }

  function setFallbackMode(enabled, raw = "") {
    useFallback = enabled;
    fallbackWrap?.classList.toggle("repeat-schedule__fallback--hidden", !enabled);
    if (enabled && raw) fallbackEl.value = raw;
  }

  function setValue({ cron = null } = {}) {
    const parsed = parseCron(cron);
    if (!parsed.ok) {
      setFallbackMode(true, parsed.raw || "");
      periodEl.value = "day";
      setComboboxNumbers(hoursCombobox, []);
      setComboboxNumbers(daysOfMonthCombobox, []);
      setComboboxNumbers(daysOfWeekCombobox, []);
      syncPeriodFields();
      return;
    }

    setFallbackMode(false);
    periodEl.value = parsed.period;
    setComboboxNumbers(hoursCombobox, parsed.hours);
    setComboboxNumbers(daysOfMonthCombobox, parsed.daysOfMonth);
    setComboboxNumbers(daysOfWeekCombobox, parsed.daysOfWeek);
    syncPeriodFields();
  }

  function getValue() {
    if (useFallback) {
      const raw = fallbackEl.value.trim();
      return { cron: raw || null };
    }

    const cron = buildCron({
      period: periodEl.value,
      hours: readComboboxNumbers(hoursCombobox),
      daysOfMonth: readComboboxNumbers(daysOfMonthCombobox),
      daysOfWeek: readComboboxNumbers(daysOfWeekCombobox),
    });
    return { cron };
  }

  periodEl.addEventListener("change", () => {
    syncPeriodFields();
    emitChange();
  });
  fallbackEl?.addEventListener("change", emitChange);
  fallbackEl?.addEventListener("input", emitChange);

  syncPeriodFields();

  return {
    root,
    setValue,
    getValue,
    setFallbackMode,
    destroy: () => {
      hoursCombobox.destroy();
      daysOfWeekCombobox.destroy();
      daysOfMonthCombobox.destroy();
      mountEl.innerHTML = "";
    },
  };
}
