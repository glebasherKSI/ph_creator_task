import { escapeHtml, formatJsonStrict } from "./format.js";
import {
  getAllConditions,
  getConditionDef,
  isConditionDuplicable,
  loadConditionsSchema,
  loadDuplicableOptions,
} from "./conditions-schema.js";
import { conditionLabel, setConditionsLabelSchema } from "./labels-ru.js";
import { loadCountriesData, mountCountrySelector } from "./country-selector.js";
import { mountMultiCombobox } from "./multi-combobox.js";

/** Доп. опции для типов условий (например, список заданий gamification_task). */
let externalTaskOptions = [];

const HANDLED_WIDGET_TYPES = new Set([
  "boolean_checkboxes",
  "tags_extended",
  "select",
  "gamification_task",
  "groups",
  "payment",
  "bet",
  "boolean",
  "boolean_tags",
  "countries_with_lists",
  "string",
  "number",
]);

/**
 * @typedef {{ id: string, name: string, value: unknown }} ConditionItem
 */

let parseIdSeq = 0;

function createConditionId() {
  parseIdSeq += 1;
  return `c${parseIdSeq}`;
}

/**
 * @param {unknown} conditions
 * @returns {ConditionItem[]}
 */
export function parseConditionsArray(conditions) {
  parseIdSeq = 0;
  if (!Array.isArray(conditions)) return [];
  const items = [];
  for (const entry of conditions) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    for (const [name, value] of Object.entries(entry)) {
      items.push({ id: createConditionId(), name, value: deepClone(value) });
    }
  }
  return items;
}

/**
 * @param {ConditionItem[]} items
 * @returns {object[]}
 */
export function serializeConditionsArray(items) {
  return items.map((item) => ({ [item.name]: deepClone(item.value) }));
}

function deepClone(value) {
  if (value == null) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function defaultValueForDef(def) {
  if (!def) return {};
  if (def.value != null) return deepClone(def.value);
  return {};
}

function optionLabel(options, id, fallback = id) {
  const found = options?.find((item) => item.id === String(id));
  return found?.name ?? fallback;
}

function renderToggleGroup(name, options, current, onChange) {
  if (!options?.length) return "";
  const buttons = options
    .map((opt) => {
      const active = String(current) === String(opt.id) ? " conditions-builder__toggle-btn--active" : "";
      return `<button type="button" class="conditions-builder__toggle-btn${active}" data-toggle-id="${escapeHtml(opt.id)}">${escapeHtml(opt.name)}</button>`;
    })
    .join("");
  return `<div class="conditions-builder__toggle-group" data-toggle-field="${escapeHtml(name)}">${buttons}</div>`;
}

function bindToggleGroup(root, onChange) {
  for (const group of root.querySelectorAll(".conditions-builder__toggle-group")) {
    const field = group.getAttribute("data-toggle-field");
    for (const btn of group.querySelectorAll(".conditions-builder__toggle-btn")) {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-toggle-id");
        for (const sibling of group.querySelectorAll(".conditions-builder__toggle-btn")) {
          sibling.classList.toggle("conditions-builder__toggle-btn--active", sibling === btn);
        }
        onChange(field, id);
      });
    }
  }
}

function renderSelectField(label, name, options, current, { multiple = false, nullable = false } = {}) {
  const multipleAttr = multiple ? " multiple" : "";
  const className = multiple
    ? "conditions-builder__select conditions-builder__select--multi"
    : "conditions-builder__select";
  let body = "";
  if (nullable && !multiple) {
    body += `<option value="">—</option>`;
  }
  const currentSet = multiple
    ? new Set((Array.isArray(current) ? current : []).map(String))
    : null;
  for (const opt of options || []) {
    const selected = multiple
      ? currentSet.has(String(opt.id))
        ? " selected"
        : ""
      : String(current) === String(opt.id)
        ? " selected"
        : "";
    body += `<option value="${escapeHtml(opt.id)}"${selected}>${escapeHtml(opt.name)}</option>`;
  }
  return `
    <label class="conditions-builder__field${multiple ? " conditions-builder__field--wide" : ""}">
      <span class="conditions-builder__label">${escapeHtml(label)}</span>
      <select class="${className}" data-field="${escapeHtml(name)}"${multipleAttr}>${body}</select>
    </label>
  `;
}

/**
 * Преобразует collection условия ({id,name}) в опции combobox ({value,label}).
 * @param {Array<{ id: string, name: string }>} [collection]
 * @returns {{ value: string, label: string }[]}
 */
function toComboOptions(collection) {
  if (!Array.isArray(collection)) return [];
  return collection
    .filter((item) => item && item.id != null)
    .map((item) => ({
      value: String(item.id),
      label: String(item.name ?? item.id),
    }));
}

/**
 * Плейсхолдер для multi-combobox. Сам combobox монтируется в bindWidgetBody.
 * @param {string} label
 * @param {string} field
 */
function renderMultiComboboxField(label, field) {
  return `
    <label class="conditions-builder__field conditions-builder__field--wide">
      <span class="conditions-builder__label">${escapeHtml(label)}</span>
      <div class="conditions-builder__combobox" data-multi-combobox-field="${escapeHtml(field)}"></div>
    </label>
  `;
}

function bindSelectFields(root, onFieldChange) {
  for (const select of root.querySelectorAll("select[data-field]")) {
    select.addEventListener("change", () => {
      const field = select.getAttribute("data-field");
      if (select.multiple) {
        const values = Array.from(select.selectedOptions).map((opt) => opt.value);
        onFieldChange(field, values);
        return;
      }
      const raw = select.value;
      onFieldChange(field, raw === "" ? null : raw);
    });
  }
}

function bindInputFields(root, onFieldChange) {
  for (const input of root.querySelectorAll("input[data-field], textarea[data-field]")) {
    const eventName = input.tagName === "TEXTAREA" || input.type === "text" ? "input" : "change";
    input.addEventListener(eventName, () => {
      const field = input.getAttribute("data-field");
      if (input.type === "checkbox") {
        onFieldChange(field, input.checked);
        return;
      }
      if (input.type === "number") {
        const num = input.value === "" ? null : Number(input.value);
        onFieldChange(field, Number.isFinite(num) ? num : null);
        return;
      }
      onFieldChange(field, input.value);
    });
  }
}

function bindCheckboxList(root, onListChange) {
  for (const wrap of root.querySelectorAll("[data-checkbox-list]")) {
    for (const input of wrap.querySelectorAll('input[type="checkbox"]')) {
      input.addEventListener("change", () => {
        const checked = Array.from(wrap.querySelectorAll('input[type="checkbox"]:checked')).map(
          (el) => el.value
        );
        onListChange(checked);
      });
    }
  }
}

function renderCheckboxList(collection, list) {
  const selected = new Set((Array.isArray(list) ? list : []).map(String));
  const items = (collection || [])
    .map(
      (opt) => `
      <label class="conditions-builder__checkbox-label">
        <input type="checkbox" value="${escapeHtml(opt.id)}" ${selected.has(String(opt.id)) ? "checked" : ""} />
        ${escapeHtml(opt.name)}
      </label>
    `
    )
    .join("");
  return `<div class="conditions-builder__checkboxes" data-checkbox-list="1">${items}</div>`;
}

function renderTagsInput(label, list) {
  const raw = Array.isArray(list) ? list.join(", ") : "";
  return `
    <label class="conditions-builder__field conditions-builder__field--wide">
      <span class="conditions-builder__label">${escapeHtml(label)}</span>
      <input class="conditions-builder__input" type="text" data-field="list" value="${escapeHtml(raw)}" placeholder="ID через запятую" />
    </label>
  `;
}

function parseTagsInput(raw) {
  return String(raw || "")
    .split(/[,;\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Значение условия profile_country → формат country-selector.
 * @param {unknown} value
 */
function conditionValueToCountrySelector(value) {
  const v = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const matchingType = v.matchingType === "countries_lists" ? "countries_lists" : "countries";
  const list = Array.isArray(v.list) ? v.list.map(String) : [];
  if (matchingType === "countries_lists") {
    return { matchingType, countries: [], countriesLists: list };
  }
  return { matchingType, countries: list, countriesLists: [] };
}

/**
 * Формат country-selector → payload условия (type, list, matchingType).
 * @param {{ matchingType?: string, countries?: string[], countriesLists?: string[] }} selectorValue
 * @param {unknown} currentValue
 */
function countrySelectorToConditionValue(selectorValue, currentValue) {
  const v = currentValue && typeof currentValue === "object" && !Array.isArray(currentValue) ? currentValue : {};
  const matchingType =
    selectorValue.matchingType === "countries_lists" ? "countries_lists" : "countries";
  const list =
    matchingType === "countries_lists"
      ? (selectorValue.countriesLists || []).map(String)
      : (selectorValue.countries || []).map(String);
  return {
    type: v.type ?? "enabled",
    matchingType,
    list,
  };
}

function renderMoneyRange(value = {}) {
  const type = value.type ?? "min";
  const types = [
    { id: "min", name: "Мин" },
    { id: "max", name: "Макс" },
    { id: "range", name: "Диапазон" },
  ];
  const list = Array.isArray(value.list) ? value.list : [];
  const minVal = type === "range" ? (list[0] ?? "") : list[0] ?? value.min ?? "";
  const maxVal = type === "range" ? (list[1] ?? "") : value.max ?? "";
  return `
    <div class="conditions-builder__row">
      <div class="conditions-builder__field">
        <span class="conditions-builder__label">Количество / сумма</span>
        ${renderToggleGroup("money_range.type", types, type, () => {})}
      </div>
      <label class="conditions-builder__field">
        <span class="conditions-builder__label">${type === "range" ? "От" : "Значение"}</span>
        <input class="conditions-builder__input" type="number" data-field="money_range.min" value="${escapeHtml(String(minVal))}" />
      </label>
      ${
        type === "range"
          ? `
      <label class="conditions-builder__field">
        <span class="conditions-builder__label">До</span>
        <input class="conditions-builder__input" type="number" data-field="money_range.max" value="${escapeHtml(String(maxVal))}" />
      </label>`
          : ""
      }
      <label class="conditions-builder__field conditions-builder__field--checkbox">
        <span class="conditions-builder__label">&nbsp;</span>
        <label class="conditions-builder__checkbox-label">
          <input type="checkbox" data-field="money_range.exclude_end" ${value.exclude_end ? "checked" : ""} />
          Исключить конец диапазона
        </label>
      </label>
    </div>
  `;
}

function renderDuration(value = {}, availablePeriods) {
  const periods =
    availablePeriods?.length > 0
      ? availablePeriods
      : [
          { id: "day", name: "Дней" },
          { id: "week", name: "Недель" },
          { id: "month", name: "Месяц(ев)" },
          { id: "lifetime", name: "За все время" },
          { id: "between", name: "В промежутке" },
        ];
  return `
    <div class="conditions-builder__row">
      ${renderSelectField("Период", "duration.period", periods, value.period ?? "lifetime")}
      <label class="conditions-builder__field">
        <span class="conditions-builder__label">Число</span>
        <input class="conditions-builder__input" type="number" data-field="duration.number" value="${escapeHtml(String(value.number ?? 1))}" min="0" />
      </label>
      <label class="conditions-builder__field conditions-builder__field--checkbox">
        <span class="conditions-builder__label">&nbsp;</span>
        <label class="conditions-builder__checkbox-label">
          <input type="checkbox" data-field="duration.include_current_period" ${value.include_current_period ? "checked" : ""} />
          Включая текущий период
        </label>
      </label>
    </div>
  `;
}

function renderWidgetBody(def, value, onUpdate, taskOptionsCtx) {
  const widgetType = def?.type || "unknown";
  const v = value && typeof value === "object" && !Array.isArray(value) ? value : {};

  if (widgetType === "boolean") {
    return `
      <label class="conditions-builder__checkbox-label">
        <input type="checkbox" data-field="value" ${value ? "checked" : ""} />
        ${escapeHtml(def.label)}
      </label>
    `;
  }

  if (widgetType === "string") {
    return `
      <label class="conditions-builder__field conditions-builder__field--wide">
        <span class="conditions-builder__label">Значение</span>
        <input class="conditions-builder__input" type="text" data-field="value" value="${escapeHtml(String(value ?? ""))}" />
      </label>
    `;
  }

  if (widgetType === "number") {
    const types = def.availableTypes || [
      { id: "min", name: "Мин" },
      { id: "max", name: "Макс" },
      { id: "range", name: "Диапазон" },
    ];
    return `
      <div class="conditions-builder__row">
        <div class="conditions-builder__field">
          <span class="conditions-builder__label">Тип</span>
          ${renderToggleGroup("type", types, v.type ?? types[0]?.id, () => {})}
        </div>
        <label class="conditions-builder__field">
          <span class="conditions-builder__label">Значение</span>
          <input class="conditions-builder__input" type="number" data-field="min" value="${escapeHtml(String(v.min ?? 0))}" />
        </label>
        ${
          v.type === "range"
            ? `
        <label class="conditions-builder__field">
          <span class="conditions-builder__label">До</span>
          <input class="conditions-builder__input" type="number" data-field="max" value="${escapeHtml(String(v.max ?? 0))}" />
        </label>`
            : ""
        }
      </div>
    `;
  }

  if (widgetType === "boolean_checkboxes" || widgetType === "boolean_tags") {
    const types = def.availableTypes || [
      { id: "enabled", name: "Истинно" },
      { id: "disabled", name: "Ложно" },
    ];
    return `
      <div class="conditions-builder__row">
        <div class="conditions-builder__field">
          <span class="conditions-builder__label">Тип</span>
          ${renderToggleGroup("type", types, v.type ?? "enabled", () => {})}
        </div>
      </div>
      ${
        def.collection?.length
          ? `
      <div class="conditions-builder__field conditions-builder__field--wide">
        <span class="conditions-builder__label">Список</span>
        ${renderCheckboxList(def.collection, v.list)}
      </div>`
          : ""
      }
      <label class="conditions-builder__checkbox-label">
        <input type="checkbox" data-field="only_completed" ${v.only_completed ? "checked" : ""} />
        Только выполненные
      </label>
    `;
  }

  if (widgetType === "select") {
    const collection = def.collection || [];
    if (def.multiple) {
      return renderMultiComboboxField(def.label, "value");
    }
    return renderSelectField(def.label, "value", collection, value ?? "", { nullable: true });
  }

  if (widgetType === "tags_extended" || def.name === "user_id") {
    const types = def.availableTypes || [
      { id: "enabled", name: "Включая" },
      { id: "disabled", name: "Исключая" },
    ];
    const listField = def.collection?.length
      ? renderMultiComboboxField("Список", "list")
      : renderTagsInput("ID (через запятую)", v.list);
    return `
      <div class="conditions-builder__row">
        <div class="conditions-builder__field">
          <span class="conditions-builder__label">Тип</span>
          ${renderToggleGroup("type", types, v.type ?? "enabled", () => {})}
        </div>
        ${listField}
      </div>
    `;
  }

  if (widgetType === "gamification_task" || widgetType === "groups") {
    const types = def.availableTypes || [
      { id: "enabled", name: "Включая" },
      { id: "disabled", name: "Исключая" },
    ];
    const extraTypes = def.availableExtraTypes || [
      { id: "and", name: "И" },
      { id: "or", name: "Или" },
    ];
    const hasCollection =
      widgetType === "groups"
        ? (def.collection?.length || 0) > 0
        : hasGamificationTaskOptions(def, taskOptionsCtx);
    const listControl = hasCollection
      ? renderMultiComboboxField(widgetType === "groups" ? "Группы" : "Задания", "list")
      : renderTagsInput(widgetType === "groups" ? "ID групп" : "ID заданий", v.list);
    return `
      <div class="conditions-builder__row">
        <div class="conditions-builder__field">
          <span class="conditions-builder__label">Тип</span>
          ${renderToggleGroup("type", types, v.type ?? "enabled", () => {})}
        </div>
        <div class="conditions-builder__field">
          <span class="conditions-builder__label">Логика списка</span>
          ${renderToggleGroup("extra_type", extraTypes, v.extra_type ?? "or", () => {})}
        </div>
      </div>
      ${listControl}
      ${
        widgetType === "gamification_task"
          ? `
      <label class="conditions-builder__checkbox-label">
        <input type="checkbox" data-field="only_completed" ${v.only_completed !== false ? "checked" : ""} />
        Только выполненные
      </label>`
          : ""
      }
    `;
  }

  if (widgetType === "payment") {
    const existenceTypes = def.extra?.availableExistenceTypes || [
      { id: "any", name: "Любой" },
      { id: "last", name: "Последний" },
      { id: "first", name: "Первый" },
    ];
    const statusTypes = def.extra?.availablePaymentStatuses || [
      { id: "any", name: "Любой" },
      { id: "successful", name: "Успешный" },
      { id: "unsuccessful", name: "Неудачный" },
    ];
    const periodTypes = def.extra?.availablePeriodTypes;
    return `
      <div class="conditions-builder__row">
        ${renderSelectField("Наличие", "existence", existenceTypes, v.existence ?? "any")}
        ${renderSelectField("Статус", "status", statusTypes, v.status ?? "any")}
      </div>
      ${renderDuration(v.duration || {}, periodTypes)}
      <div class="conditions-builder__field conditions-builder__field--wide">
        <span class="conditions-builder__label">Диапазон суммы</span>
        ${renderMoneyRange(v.money_range || {})}
      </div>
    `;
  }

  if (widgetType === "bet") {
    const gameCategories = def.extra?.availableGameCategories;
    const betTypes = def.extra?.availableBetTypes;
    return `
      ${renderDuration(v.duration || {}, def.extra?.availablePeriods)}
      <div class="conditions-builder__field conditions-builder__field--wide">
        <span class="conditions-builder__label">Количество / сумма ставок</span>
        ${renderMoneyRange(v.money_range || {})}
      </div>
      ${gameCategories?.length ? renderMultiComboboxField("Категории игр", "game_categories") : ""}
      ${
        betTypes?.length
          ? renderSelectField("Тип ставки", "bet_type", betTypes, v.bet_type ?? "", { nullable: true })
          : ""
      }
    `;
  }

  if (widgetType === "countries_with_lists") {
    const types = def.availableTypes || [
      { id: "enabled", name: "Включая" },
      { id: "disabled", name: "Исключая" },
    ];
    return `
      <div class="conditions-builder__row">
        <div class="conditions-builder__field">
          <span class="conditions-builder__label">Тип</span>
          ${renderToggleGroup("type", types, v.type ?? "enabled", () => {})}
        </div>
      </div>
      <div class="conditions-builder__country-selector-mount" data-country-selector-mount></div>
    `;
  }

  return `
    <p class="conditions-builder__fallback-note">Тип «${escapeHtml(widgetType)}» — расширенное редактирование значения.</p>
    <textarea class="conditions-builder__textarea" data-field="__json">${escapeHtml(formatJsonStrict(value))}</textarea>
  `;
}

function bindWidgetBody(cardEl, def, getValue, setValue, getDomain, taskOptionsCtx) {
  const widgetType = def?.type || "unknown";

  function patchValue(patch) {
    setValue({ ...deepClone(getValue()), ...patch });
  }

  function patchNested(path, val) {
    const next = deepClone(getValue());
    setNested(next, path, val);
    setValue(next);
  }

  bindToggleGroup(cardEl, (field, id) => {
    if (field.includes(".")) {
      patchNested(field, id);
      render();
      return;
    }
    patchValue({ [field]: id });
    if (field === "type" && widgetType === "number") {
      render();
    }
    if (field === "money_range.type") {
      render();
    }
  });

  bindSelectFields(cardEl, (field, val) => {
    if (field === "value" && widgetType === "select") {
      setValue(val);
      return;
    }
    patchValue({ [field]: val });
  });

  bindInputFields(cardEl, (field, val) => {
    if (field === "value" && (widgetType === "boolean" || widgetType === "string")) {
      setValue(val);
      return;
    }
    if (field === "list" && (widgetType === "tags_extended" || def.name === "user_id")) {
      patchValue({ list: parseTagsInput(val) });
      return;
    }
    if (field === "__json") {
      try {
        setValue(JSON.parse(val || "null"));
      } catch {
        /* ignore while typing */
      }
      return;
    }
    if (field.startsWith("money_range.")) {
      const current = deepClone(getValue());
      const money = current.money_range && typeof current.money_range === "object" ? current.money_range : {};
      const sub = field.split(".")[1];
      if (sub === "min" || sub === "max") {
        const type = money.type ?? "min";
        if (type === "range") {
          const list = Array.isArray(money.list) ? [...money.list] : [null, null];
          list[sub === "min" ? 0 : 1] = val;
          money.list = list;
        } else {
          money.list = val == null ? [] : [String(val)];
        }
      } else {
        money[sub] = val;
      }
      patchValue({ money_range: money });
      return;
    }
    if (field.startsWith("duration.")) {
      const current = deepClone(getValue());
      const duration = current.duration && typeof current.duration === "object" ? current.duration : {};
      duration[field.split(".")[1]] = val;
      patchValue({ duration });
      return;
    }
    patchValue({ [field]: val });
  });

  bindCheckboxList(cardEl, (list) => patchValue({ list }));

  function buildMultiComboboxConfig(field) {
    const value = getValue();
    const v = value && typeof value === "object" && !Array.isArray(value) ? value : {};

    if (field === "value" && widgetType === "select") {
      const current = (Array.isArray(value) ? value : [value].filter(Boolean)).map(String);
      return {
        options: toComboOptions(def.collection),
        value: current,
        placeholder: "Выберите…",
        onChange: (values) => setValue(values),
      };
    }

    if (field === "list") {
      const selectedIds = (Array.isArray(v.list) ? v.list : []).map(String);
      const collection =
        widgetType === "gamification_task"
          ? resolveGamificationTaskOptions(def, selectedIds, taskOptionsCtx)
          : def.collection;
      const placeholder =
        widgetType === "groups"
          ? "Выберите группы…"
          : widgetType === "gamification_task"
            ? "Выберите задания…"
            : "Выберите…";
      return {
        options: toComboOptions(collection),
        value: selectedIds,
        placeholder,
        onChange: (values) => patchValue({ list: values }),
      };
    }

    if (field === "game_categories") {
      return {
        options: toComboOptions(def.extra?.availableGameCategories),
        value: (Array.isArray(v.game_categories) ? v.game_categories : []).map(String),
        placeholder: "Выберите категории…",
        onChange: (values) => patchValue({ game_categories: values }),
      };
    }

    return null;
  }

  function mountComboboxes() {
    destroyCardComboboxes(cardEl);
    cardEl.__comboboxes = [];
    for (const mountEl of cardEl.querySelectorAll("[data-multi-combobox-field]")) {
      const field = mountEl.getAttribute("data-multi-combobox-field");
      const config = buildMultiComboboxConfig(field);
      if (!config) continue;
      const instance = mountMultiCombobox(mountEl, {
        options: config.options,
        value: config.value,
        placeholder: config.placeholder,
        searchPlaceholder: "Поиск…",
        onChange: config.onChange,
      });
      cardEl.__comboboxes.push(instance);
    }
  }

  function mountCountrySelectorWidget() {
    destroyCardCountrySelectors(cardEl);
    if (widgetType !== "countries_with_lists") return;

    const mountEl = cardEl.querySelector("[data-country-selector-mount]");
    if (!mountEl) return;

    const instance = mountCountrySelector(mountEl, {
      ...conditionValueToCountrySelector(getValue()),
      onChange: () => {
        setValue(countrySelectorToConditionValue(instance.getValue(), getValue()));
      },
    });
    cardEl.__countrySelector = instance;

    const domain = typeof getDomain === "function" ? String(getDomain() || "").trim() : "";
    instance.setMode("loading");
    void loadCountriesData(domain)
      .then((data) => {
        if (cardEl.__countrySelector !== instance) return;
        instance.setData(data);
        instance.setMode("ui");
        instance.setValue(conditionValueToCountrySelector(getValue()));
      })
      .catch(() => {
        if (cardEl.__countrySelector !== instance) return;
        instance.setMode("fallback");
        instance.setValue(conditionValueToCountrySelector(getValue()));
      });
  }

  mountComboboxes();
  mountCountrySelectorWidget();

  function render() {
    const body = cardEl.querySelector(".conditions-builder__card-body");
    if (!body) return;
    destroyCardComboboxes(cardEl);
    destroyCardCountrySelectors(cardEl);
    const value = getValue();
    body.innerHTML = renderWidgetBody(def, value, undefined, taskOptionsCtx);
    bindWidgetBody(cardEl, def, getValue, setValue, getDomain, taskOptionsCtx);
  }

  if (widgetType === "number" || widgetType === "bet" || widgetType === "payment") {
    const moneyTypeField = cardEl.querySelector('[data-toggle-field="money_range.type"]');
    if (moneyTypeField) {
      /* re-render handled in toggle */
    }
  }
}

/**
 * Нормализует внешний список заданий в формат collection ({id,name}).
 * Принимает {id,name} либо {value,label}.
 * @param {Array<{ id?: string, name?: string, value?: string, label?: string }>} [taskOptions]
 * @returns {Array<{ id: string, name: string }>}
 */
function normalizeTaskOptions(taskOptions) {
  if (!Array.isArray(taskOptions)) return [];
  return taskOptions
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const id = item.id ?? item.value;
      if (id == null) return null;
      return { id: String(id), name: String(item.name ?? item.label ?? id) };
    })
    .filter(Boolean);
}

/**
 * @typedef {{ getTaskOptions?: () => Array<{ id?: string, name?: string, value?: string, label?: string }>, externalOptions?: Array<{ id: string, name: string }> }} TaskOptionsContext
 */

/**
 * Актуальный список заданий: live-источник (каталог) перекрывает снимок из схемы.
 * @param {import('./conditions-schema.js').ConditionDefinition | null | undefined} def
 * @param {string[]} [selectedIds]
 * @param {TaskOptionsContext} [ctx]
 * @returns {Array<{ id: string, name: string }>}
 */
function resolveGamificationTaskOptions(def, selectedIds, ctx = {}) {
  const fromLive =
    typeof ctx.getTaskOptions === "function"
      ? normalizeTaskOptions(ctx.getTaskOptions())
      : ctx.externalOptions?.length
        ? ctx.externalOptions
        : [];

  const byId = new Map();
  for (const item of def?.collection || []) {
    byId.set(String(item.id), { id: String(item.id), name: String(item.name ?? item.id) });
  }
  for (const item of fromLive) {
    byId.set(String(item.id), item);
  }
  for (const id of selectedIds || []) {
    const key = String(id);
    if (!byId.has(key)) byId.set(key, { id: key, name: key });
  }
  return [...byId.values()];
}

/**
 * @param {import('./conditions-schema.js').ConditionDefinition | null | undefined} def
 * @param {TaskOptionsContext} [ctx]
 */
function hasGamificationTaskOptions(def, ctx = {}) {
  if ((def?.collection?.length || 0) > 0) return true;
  const fromLive =
    typeof ctx.getTaskOptions === "function"
      ? normalizeTaskOptions(ctx.getTaskOptions())
      : ctx.externalOptions?.length
        ? ctx.externalOptions
        : [];
  return fromLive.length > 0;
}

function destroyCardComboboxes(cardEl) {
  if (!cardEl || !Array.isArray(cardEl.__comboboxes)) return;
  for (const instance of cardEl.__comboboxes) {
    instance?.destroy?.();
  }
  cardEl.__comboboxes = [];
}

function destroyCardCountrySelectors(cardEl) {
  if (!cardEl) return;
  cardEl.__countrySelector?.destroy?.();
  cardEl.__countrySelector = null;
}

function setNested(obj, path, value) {
  const parts = path.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    if (!cur[key] || typeof cur[key] !== "object") cur[key] = {};
    cur = cur[key];
  }
  cur[parts[parts.length - 1]] = value;
}

/**
 * @param {HTMLElement} container
 * @param {{
 *   value?: unknown[],
 *   onChange?: (conditions: object[]) => void,
 *   domain?: string,
 *   getDomain?: () => string,
 *   meta?: import('./meta.js').ParsedTaskMeta | null,
 *   taskMeta?: import('./meta.js').ParsedTaskMeta | null,
 *   taskOptions?: Array<{ id?: string, name?: string, value?: string, label?: string }>,
 *   getTaskOptions?: () => Array<{ id?: string, name?: string, value?: string, label?: string }>,
 * }} options
 */
export function mountConditionsBuilder(container, options = {}) {
  externalTaskOptions = normalizeTaskOptions(options.taskOptions);
  let getTaskOptionsFn =
    typeof options.getTaskOptions === "function" ? options.getTaskOptions : null;

  function getTaskOptionsContext() {
    return {
      getTaskOptions: getTaskOptionsFn ?? undefined,
      externalOptions: externalTaskOptions,
    };
  }

  /** @type {ConditionItem[]} */
  let items = parseConditionsArray(options.value);
  let selectedId = items[0]?.id ?? null;
  let pickerOpen = false;
  let pickerQuery = "";
  /** @type {import('./conditions-schema.js').ParsedConditionsSchema | null} */
  let schema = null;
  /** @type {Set<string>} */
  let duplicableOptions = new Set();
  let schemaStatus = { loading: true, error: false, text: "Загрузка схемы условий…" };
  let loadToken = 0;

  const shell = document.createElement("div");
  shell.className = "conditions-builder";
  container.innerHTML = "";
  container.appendChild(shell);

  function resolveDomain() {
    if (typeof options.getDomain === "function") {
      return String(options.getDomain() || "").trim();
    }
    return String(options.domain || "").trim();
  }

  function emitChange() {
    options.onChange?.(serializeConditionsArray(items));
  }

  function getValue() {
    return serializeConditionsArray(items);
  }

  function setValue(conditions) {
    items = parseConditionsArray(conditions);
    if (!items.some((item) => item.id === selectedId)) {
      selectedId = items[0]?.id ?? null;
    }
    render();
    emitChange();
  }

  function getItemById(id) {
    return items.find((item) => item.id === id) ?? null;
  }

  function hasConditionName(name) {
    return items.some((item) => item.name === name);
  }

  function canAddConditionName(name) {
    if (!hasConditionName(name)) return true;
    return isConditionDuplicable(name, duplicableOptions);
  }

  function setItemValue(id, value) {
    const item = getItemById(id);
    if (!item) return;
    item.value = value;
    emitChange();
  }

  function removeItem(id) {
    items = items.filter((item) => item.id !== id);
    if (selectedId === id) selectedId = items[0]?.id ?? null;
    render();
    emitChange();
  }

  function addItem(name) {
    if (!canAddConditionName(name)) return;
    const def = getConditionDef(schema, name);
    const item = { id: createConditionId(), name, value: defaultValueForDef(def) };
    items.push(item);
    selectedId = item.id;
    pickerOpen = false;
    pickerQuery = "";
    render();
    emitChange();
  }

  function availableToAdd() {
    const activeUnique = new Set(
      items
        .filter((item) => !isConditionDuplicable(item.name, duplicableOptions))
        .map((item) => item.name)
    );
    const all = getAllConditions(schema);
    const q = pickerQuery.trim().toLowerCase();
    return all.filter((def) => {
      if (activeUnique.has(def.name)) return false;
      if (!q) return true;
      return def.label.toLowerCase().includes(q) || def.name.toLowerCase().includes(q) || conditionLabel(def.name, def).toLowerCase().includes(q);
    });
  }

  function conditionInstanceLabel(item) {
    const def = getConditionDef(schema, item.name);
    const base = conditionLabel(item.name, def);
    const sameName = items.filter((entry) => entry.name === item.name);
    if (sameName.length <= 1) return base;
    const index = sameName.findIndex((entry) => entry.id === item.id) + 1;
    return `${base} (${index})`;
  }

  function renderStatus() {
    const cls = [
      "conditions-builder__status",
      schemaStatus.loading ? "conditions-builder__status--loading" : "",
      schemaStatus.error ? "conditions-builder__status--error" : "",
    ]
      .filter(Boolean)
      .join(" ");
    return `<div class="${cls}"><span class="conditions-builder__spinner" aria-hidden="true"></span>${escapeHtml(schemaStatus.text)}</div>`;
  }

  function renderPicker() {
    const available = availableToAdd().slice(0, 80);
    const list = available.length
      ? available
          .map(
            (def) => `
          <li>
            <button type="button" class="conditions-builder__picker-item" data-add-condition="${escapeHtml(def.name)}">
              ${escapeHtml(conditionLabel(def.name, def))}
              <small>${escapeHtml(def.name)} · ${escapeHtml(def.type)}</small>
            </button>
          </li>
        `
          )
          .join("")
      : `<li class="conditions-builder__empty-hint">${pickerQuery ? "Ничего не найдено" : "Все условия уже добавлены"}</li>`;

    return `
      <div class="conditions-builder__picker">
        <button type="button" class="conditions-builder__btn conditions-builder__btn--primary" data-action="toggle-picker">
          Добавить условие
        </button>
        <div class="conditions-builder__picker-popover${pickerOpen ? "" : " conditions-builder__picker-popover--hidden"}">
          <div class="conditions-builder__picker-search">
            <input class="conditions-builder__input" type="search" placeholder="Поиск по названию…" data-picker-search value="${escapeHtml(pickerQuery)}" />
          </div>
          <ul class="conditions-builder__picker-list">${list}</ul>
        </div>
      </div>
    `;
  }

  function renderActiveList() {
    if (!items.length) {
      return `<div class="conditions-builder__empty-hint">Нет активных условий</div>`;
    }
    return `<ul class="conditions-builder__active-list">
      ${items
        .map((item) => {
          const selected = item.id === selectedId ? " conditions-builder__active-item--selected" : "";
          return `
          <li>
            <button type="button" class="conditions-builder__active-item${selected}" data-select-condition="${escapeHtml(item.id)}">
              <span class="conditions-builder__active-item-name">${escapeHtml(conditionInstanceLabel(item))}</span>
              <span class="conditions-builder__active-item-key">${escapeHtml(item.name)}</span>
            </button>
          </li>`;
        })
        .join("")}
    </ul>`;
  }

  function renderCards() {
    if (!items.length) {
      return `<div class="conditions-builder__empty-hint">Добавьте условие из списка слева</div>`;
    }
    return items
      .map((item) => {
        const def = getConditionDef(schema, item.name);
        const highlight = item.id === selectedId ? " conditions-builder__card--highlight" : "";
        const handled = HANDLED_WIDGET_TYPES.has(def?.type || "");
        const typeHint = handled ? def?.type : `${def?.type || "неизвестный"} (расширенное)`;
        return `
        <article class="conditions-builder__card${highlight}" data-condition-card="${escapeHtml(item.id)}">
          <header class="conditions-builder__card-head">
            <div>
              <div class="conditions-builder__card-title">${escapeHtml(conditionInstanceLabel(item))}</div>
              <div class="conditions-builder__card-key">${escapeHtml(item.name)} · ${escapeHtml(typeHint)}</div>
            </div>
            <button type="button" class="conditions-builder__card-delete" data-remove-condition="${escapeHtml(item.id)}">Удалить</button>
          </header>
          <div class="conditions-builder__card-body">
            ${renderWidgetBody(def, item.value, undefined, getTaskOptionsContext())}
          </div>
        </article>`;
      })
      .join("");
  }

  function render() {
    for (const card of shell.querySelectorAll("[data-condition-card]")) {
      destroyCardComboboxes(card);
      destroyCardCountrySelectors(card);
    }
    shell.innerHTML = `
      <div class="conditions-builder__toolbar">
        ${renderStatus()}
        ${renderPicker()}
      </div>
      <div class="conditions-builder__ui-wrap">
        <div class="conditions-builder__layout">
          <aside class="conditions-builder__sidebar">
            <div class="conditions-builder__sidebar-title">Активные условия (${items.length})</div>
            ${renderActiveList()}
          </aside>
          <div class="conditions-builder__main">${renderCards()}</div>
        </div>
      </div>
    `;

    bindEvents();
    for (const card of shell.querySelectorAll("[data-condition-card]")) {
      const id = card.getAttribute("data-condition-card");
      const item = getItemById(id);
      const def = getConditionDef(schema, item?.name);
      bindWidgetBody(
        card,
        def,
        () => getItemById(id)?.value,
        (value) => setItemValue(id, value),
        resolveDomain,
        getTaskOptionsContext()
      );
    }
  }

  function bindEvents() {
    shell.querySelector('[data-action="toggle-picker"]')?.addEventListener("click", () => {
      pickerOpen = !pickerOpen;
      render();
      if (pickerOpen) {
        shell.querySelector("[data-picker-search]")?.focus();
      }
    });

    shell.querySelector("[data-picker-search]")?.addEventListener("input", (ev) => {
      pickerQuery = ev.target.value;
      render();
      const input = shell.querySelector("[data-picker-search]");
      if (input) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
    });

    for (const btn of shell.querySelectorAll("[data-add-condition]")) {
      btn.addEventListener("click", () => addItem(btn.getAttribute("data-add-condition")));
    }

    for (const btn of shell.querySelectorAll("[data-select-condition]")) {
      btn.addEventListener("click", () => {
        selectedId = btn.getAttribute("data-select-condition");
        render();
        const card = shell.querySelector(`[data-condition-card="${CSS.escape(selectedId)}"]`);
        card?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
    }

    for (const btn of shell.querySelectorAll("[data-remove-condition]")) {
      btn.addEventListener("click", () => removeItem(btn.getAttribute("data-remove-condition")));
    }

    if (pickerOpen) {
      const closeOnOutside = (ev) => {
        if (!shell.contains(ev.target)) {
          pickerOpen = false;
          document.removeEventListener("click", closeOnOutside);
          render();
        }
      };
      setTimeout(() => document.addEventListener("click", closeOnOutside), 0);
    }
  }

  async function loadSchema(domainInput) {
    const token = ++loadToken;
    schemaStatus = { loading: true, error: false, text: "Загрузка схемы условий…" };
    render();
    try {
      const [nextSchema, nextDuplicable] = await Promise.all([
        loadConditionsSchema(domainInput),
        loadDuplicableOptions(domainInput),
      ]);
      if (token !== loadToken) return nextSchema;
      schema = nextSchema;
      duplicableOptions = nextDuplicable;
      setConditionsLabelSchema(schema);
      const count = schema.conditions.length;
      const types = schema.widgetTypes.size;
      const dupCount = duplicableOptions.size;
      schemaStatus = {
        loading: false,
        error: false,
        text: `Схема: ${count} условий, ${types} типов виджетов, ${dupCount} повторяемых (${schema.source})`,
      };
      render();
      return schema;
    } catch (err) {
      if (token !== loadToken) return null;
      schemaStatus = {
        loading: false,
        error: true,
        text: `Схема не загружена: ${err?.message || err}`,
      };
      render();
      return null;
    }
  }

  render();
  void loadSchema(resolveDomain());

  return {
    getValue,
    setValue,
    loadSchema,
    getSchema: () => schema,
    setTaskOptions: (taskOptions) => {
      externalTaskOptions = normalizeTaskOptions(taskOptions);
      render();
    },
    setGetTaskOptions: (fn) => {
      getTaskOptionsFn = typeof fn === "function" ? fn : null;
      render();
    },
    refreshTaskOptions: () => {
      render();
    },
    destroy: () => {
      for (const card of shell.querySelectorAll("[data-condition-card]")) {
        destroyCardComboboxes(card);
        destroyCardCountrySelectors(card);
      }
      container.innerHTML = "";
    },
  };
}

export { HANDLED_WIDGET_TYPES };
