import { escapeHtml, formatJsonStrict } from "./format.js";
import {
  ACTION_TYPES,
  COMPARISON_OPERATORS,
  coerceActionRequirements,
  coerceActionConditions,
  deriveVisibleFieldsFromRequirements,
  filterFieldKeysForAction,
  formatRequirementFieldInputValue,
  getActionDef,
  getAttributeFieldsForAction,
  getConditionFieldsForAction,
  getRequirementFieldDef,
  isHandledActionType,
  isRequirementFieldAllowed,
  mergeActionFieldsForUi,
  parseComparisonValue,
  buildComparisonValue,
  readRequirementFieldInputValue,
  splitActionFieldsForApi,
} from "./actions-schema.js";
import { actionTypeLabel } from "./labels-ru.js";
import { resolveGamesByIds, searchGames } from "./games-api.js";
import { mountMultiCombobox } from "./multi-combobox.js";

/**
 * @typedef {{ action: string, requirements: Record<string, unknown>, conditions: Record<string, unknown> }} ActionItem
 * @typedef {ActionItem & { _visibleConditions?: string[], _visibleAttributes?: string[] }} InternalActionItem
 */

/**
 * @param {unknown} value
 * @returns {InternalActionItem[]}
 */
export function parseActionsArray(value) {
  if (!Array.isArray(value)) return [];
  const items = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const action = String(entry.action || "").trim();
    if (!action) continue;
    const rawRequirements = deepClone(
      entry.requirements && typeof entry.requirements === "object" ? entry.requirements : {}
    );
    const rawConditions = deepClone(
      entry.conditions && typeof entry.conditions === "object" ? entry.conditions : {}
    );
    const requirements = mergeActionFieldsForUi(action, rawRequirements, rawConditions);
    const item = {
      action,
      requirements: pickRequirementsForAction(action, requirements),
      conditions: deepClone(rawConditions),
    };
    const visible = deriveVisibleFieldsFromRequirements(action, requirements);
    item._visibleConditions = visible.conditions;
    item._visibleAttributes = visible.attributes;
    items.push(item);
  }
  return items;
}

function deepClone(value) {
  if (value == null) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function pickRequirementsForAction(actionType, requirements) {
  const source = requirements && typeof requirements === "object" ? requirements : {};
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [key, val] of Object.entries(source)) {
    if (isRequirementFieldAllowed(actionType, key)) out[key] = val;
  }
  return out;
}

function defaultActionItem(actionType = "bet") {
  return {
    action: actionType,
    requirements: {},
    conditions: {},
    _visibleConditions: [],
    _visibleAttributes: [],
  };
}

function toPublicActionItem(item) {
  const split = splitActionFieldsForApi(item.action, cleanRequirements(item.requirements));
  return {
    action: item.action,
    requirements: coerceActionRequirements(item.action, split.requirements),
    conditions: coerceActionConditions(item.action, cleanRequirements(split.conditions)),
  };
}

function parseMultiText(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) throw new Error("Ожидается JSON-массив");
    return parsed;
  }
  return trimmed
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatMultiText(value) {
  if (value == null) return "";
  if (Array.isArray(value)) {
    if (!value.length) return "";
    return value.every((item) => typeof item === "string" || typeof item === "number")
      ? value.join(", ")
      : formatJsonStrict(value);
  }
  return String(value);
}

function cleanRequirements(req) {
  const out = {};
  for (const [key, val] of Object.entries(req || {})) {
    if (val == null) continue;
    if (typeof val === "string" && !val.trim()) continue;
    if (Array.isArray(val) && !val.length) continue;
    if (typeof val === "object" && !Array.isArray(val) && !Object.keys(val).length) continue;
    out[key] = val;
  }
  return out;
}

function isRemoteOptionsField(def) {
  return !!def?.remoteOptions || def?.optionsKey === "games" || def?.key === "games";
}

function normalizeMultiSelectValue(current) {
  return Array.isArray(current)
    ? current
        .map((item) => {
          if (item && typeof item === "object" && !Array.isArray(item)) {
            return String(item.id ?? item.value ?? item.name ?? "");
          }
          return String(item);
        })
        .filter(Boolean)
    : [];
}

function mountRemoteGamesCombobox(mount, def, current, onFieldChange, domain) {
  const value = normalizeMultiSelectValue(current);
  const instance = mountMultiCombobox(mount, {
    options: value.map((id) => ({ value: id, label: id })),
    value,
    placeholder: def.label,
    searchPlaceholder: "Поиск игры…",
    remoteSearch: true,
    minSearchLength: 2,
    searchDebounceMs: 300,
    onChange: () => onFieldChange?.(),
    onSearch: async (query) => {
      const results = await searchGames(domain, query);
      return results.map((item) => ({ value: item.id, label: item.label }));
    },
  });

  if (domain && value.length) {
    void resolveGamesByIds(domain, value)
      .then((resolved) => {
        if (!mount.__combobox) return;
        mount.__combobox.setOptions(
          resolved.map((item) => ({ value: item.id, label: item.label }))
        );
        mount.__combobox.setValue(value);
      })
      .catch(() => {
        /* keep raw ids as labels */
      });
  }

  return instance;
}

function resolveFieldOptions(fieldDef, fieldOptions) {
  if (!fieldDef) return [];
  const externalKey = fieldDef.optionsKey || fieldDef.key;
  const external = fieldOptions[externalKey];
  if (Array.isArray(external) && external.length) {
    return external.map((item) => ({
      value: String(item.id),
      label: String(item.label ?? item.id),
    }));
  }
  if (fieldDef.options?.length) {
    return fieldDef.options.map((item) => ({ value: String(item.id), label: String(item.label) }));
  }
  return [];
}

function renderSelectControl(def, current) {
  let body = `<option value="">—</option>`;
  for (const opt of def.options || []) {
    const selected = String(current) === String(opt.id) ? " selected" : "";
    body += `<option value="${escapeHtml(opt.id)}"${selected}>${escapeHtml(opt.label)}</option>`;
  }
  return `<select class="actions-builder__select" data-req-field="${escapeHtml(def.key)}">${body}</select>`;
}

function renderStringControl(def, current) {
  const value = formatRequirementFieldInputValue(def.key, current);
  return `<input class="actions-builder__input" type="text" data-req-field="${escapeHtml(def.key)}" value="${escapeHtml(value)}" />`;
}

function renderNumberControl(def, current) {
  const value = current == null ? "" : String(current);
  return `<input class="actions-builder__input" type="number" min="0" step="1" data-req-field="${escapeHtml(def.key)}" value="${escapeHtml(value)}" />`;
}

function renderBooleanControl(def, current) {
  const checked = !!current;
  return `<label class="actions-builder__checkbox-inline"><input type="checkbox" data-req-field="${escapeHtml(def.key)}"${checked ? " checked" : ""} /><span>Да</span></label>`;
}

function renderMultiTextControl(def, current) {
  return `<input class="actions-builder__input" type="text" data-req-field="${escapeHtml(def.key)}" value="${escapeHtml(formatMultiText(current))}" placeholder="${escapeHtml(def.hint || "через запятую")}" />`;
}

function renderMultiSelectControl(def, fieldOptions, current) {
  if (isRemoteOptionsField(def)) {
    return `<div class="actions-builder__combobox-mount" data-multi-combobox-field="${escapeHtml(def.key)}" data-remote-options="1"></div>`;
  }
  const options = resolveFieldOptions(def, fieldOptions);
  if (!options.length) {
    return renderMultiTextControl(def, current);
  }
  return `<div class="actions-builder__combobox-mount" data-multi-combobox-field="${escapeHtml(def.key)}"></div>`;
}

function renderDurationControl(def, current) {
  const obj = current && typeof current === "object" && !Array.isArray(current) ? current : {};
  const value = obj.value == null ? "" : String(obj.value);
  const period = obj.period == null ? "" : String(obj.period);
  let periodOptions = `<option value="">—</option>`;
  for (const opt of def.options || []) {
    const selected = period === opt.id ? " selected" : "";
    periodOptions += `<option value="${escapeHtml(opt.id)}"${selected}>${escapeHtml(opt.label)}</option>`;
  }
  return `
    <div class="actions-builder__duration-row" data-composite-field="duration">
      <input class="actions-builder__input" type="text" data-duration-part="value" value="${escapeHtml(value)}" placeholder="Значение" />
      <select class="actions-builder__select" data-duration-part="period">${periodOptions}</select>
    </div>
  `;
}

function renderMoneyRangeControl(def, current, actionType, requirements) {
  let min = "";
  let max = "";
  if (current && typeof current === "object" && !Array.isArray(current)) {
    min = current.min == null ? "" : String(current.min);
    max = current.max == null ? "" : String(current.max);
  } else if (actionType === "deposit" || actionType === "cashout") {
    min = requirements?.min_points == null ? "" : String(requirements.min_points);
    max = requirements?.max_points == null ? "" : String(requirements.max_points);
  } else if (actionType === "bet" && requirements?.min_bet_amount != null) {
    min = String(requirements.min_bet_amount);
  }
  return `
    <div class="actions-builder__money-row" data-composite-field="money_range">
      <input class="actions-builder__input" type="text" data-money-part="min" value="${escapeHtml(min)}" placeholder="Мин." />
      <span class="actions-builder__range-sep">—</span>
      <input class="actions-builder__input" type="text" data-money-part="max" value="${escapeHtml(max)}" placeholder="Макс." />
    </div>
  `;
}

function comparisonOperatorTitle(op) {
  return op.label ? `${op.symbol} ${op.label}` : op.symbol;
}

function renderComparisonControl(def, current) {
  const { type } = parseComparisonValue(current);
  const selectedOp = COMPARISON_OPERATORS.find((op) => op.id === type) || COMPARISON_OPERATORS[0];
  const options = COMPARISON_OPERATORS.map((op) => {
    const selected = type === op.id ? " selected" : "";
    const title = comparisonOperatorTitle(op);
    return `<option value="${escapeHtml(op.id)}" title="${escapeHtml(title)}"${selected}>${escapeHtml(op.symbol)}</option>`;
  }).join("");
  const valStr = formatRequirementFieldInputValue(def.key, current);
  return `
    <div class="actions-builder__comparison-row" data-composite-field="comparison" data-comparison-key="${escapeHtml(def.key)}">
      <select class="actions-builder__select actions-builder__comparison-op" data-comparison-part="type" title="${escapeHtml(comparisonOperatorTitle(selectedOp))}">${options}</select>
      <input class="actions-builder__input" type="text" inputmode="decimal" data-comparison-part="value" value="${escapeHtml(valStr)}" placeholder="Значение" />
    </div>
  `;
}

function renderFieldControl(def, requirements, actionType, fieldOptions) {
  const current = requirements?.[def.key];
  switch (def.widget) {
    case "select":
      return renderSelectControl(def, current);
    case "boolean":
      return renderBooleanControl(def, current);
    case "multi_select":
      return renderMultiSelectControl(def, fieldOptions, current);
    case "multi_text":
      return renderMultiTextControl(def, current);
    case "duration":
      return renderDurationControl(def, current);
    case "money_range": {
      const rangeVal =
        current ||
        (actionType !== "bet" &&
        (requirements?.min_points != null || requirements?.max_points != null)
          ? { min: requirements?.min_points, max: requirements?.max_points }
          : actionType === "bet" && requirements?.min_bet_amount != null
            ? { min: requirements?.min_bet_amount, max: "" }
            : {});
      return renderMoneyRangeControl(def, rangeVal, actionType, requirements);
    }
    case "number":
      return renderNumberControl(def, current);
    case "comparison":
      return renderComparisonControl(def, current);
    default:
      return renderStringControl(def, current);
  }
}

function renderReqRow(def, requirements, actionType, fieldOptions) {
  return `
    <div class="actions-builder__req-row" data-req-row data-req-key="${escapeHtml(def.key)}">
      <span class="actions-builder__req-label">${escapeHtml(def.label)}</span>
      <div class="actions-builder__req-control">
        ${renderFieldControl(def, requirements, actionType, fieldOptions)}
      </div>
      <button type="button" class="actions-builder__req-remove" data-remove-req-field="${escapeHtml(def.key)}" title="Удалить" aria-label="Удалить ${escapeHtml(def.label)}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>
      </button>
    </div>
  `;
}

function renderAddFieldSelect(role, actionType, visibleKeys) {
  const fields =
    role === "condition"
      ? getConditionFieldsForAction(actionType)
      : getAttributeFieldsForAction(actionType);
  const available = fields.filter((f) => !visibleKeys.includes(f.key));
  if (!available.length) {
    return `<span class="actions-builder__add-empty">Все поля добавлены</span>`;
  }
  const label = role === "condition" ? "Добавить условие" : "Добавить атрибут";
  const options = available
    .map((f) => `<option value="${escapeHtml(f.key)}">${escapeHtml(f.label)}</option>`)
    .join("");
  return `
    <select class="actions-builder__add-select" data-add-req-field="${role}">
      <option value="">${escapeHtml(label)}</option>
      ${options}
    </select>
  `;
}

function renderRequirementsPanel(item, fieldOptions) {
  const def = getActionDef(item.action);
  if (!def?.handled) {
    return `
      <div class="actions-builder__fallback-note">Тип «${escapeHtml(actionTypeLabel(item.action))}» — без настраиваемых параметров в schema</div>
    `;
  }

  const visibleConditions = filterFieldKeysForAction(
    item.action,
    item._visibleConditions || [],
    "condition"
  );
  const visibleAttributes = filterFieldKeysForAction(
    item.action,
    item._visibleAttributes || [],
    "attribute"
  );

  const conditionRows = visibleConditions
    .map((key) => getRequirementFieldDef(key))
    .filter(Boolean)
    .map((fieldDef) => renderReqRow(fieldDef, item.requirements, item.action, fieldOptions))
    .join("");

  const attributeRows = visibleAttributes
    .map((key) => getRequirementFieldDef(key))
    .filter(Boolean)
    .map((fieldDef) => renderReqRow(fieldDef, item.requirements, item.action, fieldOptions))
    .join("");

  return `
    <div class="actions-builder__req-columns">
      <section class="actions-builder__req-col">
        <header class="actions-builder__req-col-head">
          <span class="actions-builder__req-col-title">Условия</span>
          ${renderAddFieldSelect("condition", item.action, visibleConditions)}
        </header>
        <div class="actions-builder__req-list" data-req-list="condition">
          ${conditionRows || `<div class="actions-builder__req-list-empty">Нет условий</div>`}
        </div>
      </section>
      <section class="actions-builder__req-col">
        <header class="actions-builder__req-col-head">
          <span class="actions-builder__req-col-title">Атрибуты</span>
          ${renderAddFieldSelect("attribute", item.action, visibleAttributes)}
        </header>
        <div class="actions-builder__req-list" data-req-list="attribute">
          ${attributeRows || `<div class="actions-builder__req-list-empty">Нет атрибутов</div>`}
        </div>
      </section>
    </div>
  `;
}

function readRequirementsFromCard(cardEl, actionType) {
  const def = getActionDef(actionType);
  if (!def?.handled) return {};

  /** @type {Record<string, unknown>} */
  const req = {};

  for (const input of cardEl.querySelectorAll("[data-req-field]")) {
    const key = input.getAttribute("data-req-field");
    if (!key || !isRequirementFieldAllowed(actionType, key)) continue;
    const fieldDef = getRequirementFieldDef(key);
    if (input.type === "checkbox") {
      if (input.checked) req[key] = true;
      continue;
    }
    const raw = input.value.trim();
    if (!raw) continue;
    if (fieldDef?.widget === "number") {
      const num = Number(raw);
      if (Number.isFinite(num)) req[key] = num;
      continue;
    }
    if (fieldDef?.widget === "multi_text" || fieldDef?.widget === "multi_select") {
      if (input.tagName === "INPUT") {
        req[key] = parseMultiText(raw);
      }
      continue;
    }
    req[key] = readRequirementFieldInputValue(key, raw, cardEl.__reqValues?.[key]);
  }

  for (const mount of cardEl.querySelectorAll("[data-multi-combobox-field]")) {
    const key = mount.getAttribute("data-multi-combobox-field");
    const instance = mount.__combobox;
    if (!key || !instance || !isRequirementFieldAllowed(actionType, key)) continue;
    const values = instance.getValue();
    if (values.length) req[key] = values;
  }

  const durationEl = cardEl.querySelector('[data-composite-field="duration"]');
  if (durationEl) {
    const value = durationEl.querySelector('[data-duration-part="value"]')?.value.trim() || "";
    const period = durationEl.querySelector('[data-duration-part="period"]')?.value.trim() || "";
    if (value || period) {
      req.duration = {};
      if (value) req.duration.value = value;
      if (period) req.duration.period = period;
    }
  }

  const moneyEl = cardEl.querySelector('[data-composite-field="money_range"]');
  if (moneyEl) {
    const min = moneyEl.querySelector('[data-money-part="min"]')?.value.trim() || "";
    const max = moneyEl.querySelector('[data-money-part="max"]')?.value.trim() || "";
    if (min || max) {
      req.money_range = {};
      if (min) req.money_range.min = min;
      if (max) req.money_range.max = max;
    }
    if (actionType === "deposit" || actionType === "cashout") {
      if (min) req.min_points = min;
      if (max) req.max_points = max;
    }
    if (actionType === "bet" && min) {
      req.min_bet_amount = min;
    }
  }

  for (const compEl of cardEl.querySelectorAll('[data-composite-field="comparison"]')) {
    const key = compEl.getAttribute("data-comparison-key");
    if (!key || !isRequirementFieldAllowed(actionType, key)) continue;
    const type = compEl.querySelector('[data-comparison-part="type"]')?.value || "min";
    const raw = compEl.querySelector('[data-comparison-part="value"]')?.value.trim() || "";
    if (!raw) continue;
    const built = buildComparisonValue(type, raw);
    if (built) req[key] = built;
  }

  return cleanRequirements(req);
}

function deleteRequirementKey(requirements, key, actionType) {
  const next = { ...requirements };
  delete next[key];
  if (key === "money_range") {
    if (actionType === "deposit" || actionType === "cashout") {
      delete next.min_points;
      delete next.max_points;
    }
    if (actionType === "bet") {
      delete next.min_bet_amount;
    }
  }
  return next;
}

function mountCardComboboxes(cardEl, requirements, fieldOptions, onFieldChange, domain) {
  destroyCardComboboxes(cardEl);
  for (const mount of cardEl.querySelectorAll("[data-multi-combobox-field]")) {
    const key = mount.getAttribute("data-multi-combobox-field");
    const def = getRequirementFieldDef(key);
    if (!def) continue;
    const current = requirements?.[key];

    if (isRemoteOptionsField(def)) {
      mount.__combobox = mountRemoteGamesCombobox(mount, def, current, onFieldChange, domain);
      continue;
    }

    const options = resolveFieldOptions(def, fieldOptions);
    if (!options.length) continue;
    const value = normalizeMultiSelectValue(current);
    mount.__combobox = mountMultiCombobox(mount, {
      options,
      value,
      placeholder: def.label,
      searchPlaceholder: "Поиск…",
      onChange: () => onFieldChange?.(),
    });
  }
}

function destroyCardComboboxes(cardEl) {
  for (const mount of cardEl.querySelectorAll("[data-multi-combobox-field]")) {
    mount.__combobox?.destroy?.();
    mount.__combobox = null;
  }
}

function renderActionCard(item, index, blockId, fieldOptions) {
  const typeOptions = ACTION_TYPES.map((type) => {
    const selected = type === item.action ? " selected" : "";
    const label = actionTypeLabel(type);
    return `<option value="${escapeHtml(type)}"${selected}>${escapeHtml(label)}</option>`;
  }).join("");

  return `
    <article class="actions-builder__card" data-action-card data-block="${escapeHtml(blockId)}" data-index="${index}">
      <header class="actions-builder__card-head">
        <span class="actions-builder__card-index">#${index + 1}</span>
        <div class="actions-builder__card-type-wrap">
          <label class="actions-builder__field">
            <span class="actions-builder__label">Тип действия</span>
            <select class="actions-builder__select" data-action-type>${typeOptions}</select>
          </label>
        </div>
        <button type="button" class="actions-builder__card-delete" data-remove-action>Удалить</button>
      </header>
      <div class="actions-builder__card-body">
        ${renderRequirementsPanel(item, fieldOptions)}
      </div>
    </article>
  `;
}

function renderBlock(blockId, title, items, sequential, fieldOptions) {
  const cards =
    items.length > 0
      ? items.map((item, idx) => renderActionCard(item, idx, blockId, fieldOptions)).join("")
      : `<div class="actions-builder__empty">Нет действий — нажмите «Добавить действие»</div>`;

  return `
    <section class="actions-builder__block" data-actions-block="${escapeHtml(blockId)}">
      <div class="actions-builder__block-head">
        <div class="actions-builder__block-title">${escapeHtml(title)}</div>
        <div class="actions-builder__block-meta">
          <label class="actions-builder__sequential">
            <input type="checkbox" data-sequential="${escapeHtml(blockId)}"${sequential ? " checked" : ""} />
            <span>Выполнять по порядку</span>
          </label>
          <button type="button" class="actions-builder__btn actions-builder__btn--primary" data-add-action="${escapeHtml(blockId)}">
            Добавить действие
          </button>
        </div>
      </div>
      <div class="actions-builder__block-body" data-block-list="${escapeHtml(blockId)}">${cards}</div>
    </section>
  `;
}

/**
 * @param {HTMLElement | null} container
 * @param {{
 *   mainValue?: unknown,
 *   secondaryValue?: unknown,
 *   mainSequential?: boolean,
 *   secondarySequential?: boolean,
 *   fieldOptions?: Record<string, Array<{ id: string, label: string }>>,
 *   domain?: string,
 *   onChange?: (state: { main: ActionItem[], secondary: ActionItem[], mainSequential: boolean, secondarySequential: boolean }) => void
 * }} options
 */
export function mountActionsBuilder(container, options = {}) {
  if (!container) {
    return {
      getValue: () => ({ main: [], secondary: [], mainSequential: false, secondarySequential: false }),
      setValue: () => {},
      setFieldOptions: () => {},
      setDomain: () => {},
      getMainActions: () => [],
      getSecondaryActions: () => [],
      getSequentialFlags: () => ({ mainSequential: false, secondarySequential: false }),
    };
  }

  const shell = container;
  shell.classList.add("actions-builder");

  let mainItems = parseActionsArray(options.mainValue);
  let secondaryItems = parseActionsArray(options.secondaryValue);
  let mainSequential = !!options.mainSequential;
  let secondarySequential = !!options.secondarySequential;
  /** @type {Record<string, Array<{ id: string, label: string }>>} */
  let fieldOptions = { ...(options.fieldOptions || {}) };
  let domain = String(options.domain || "").trim();

  const onChange = typeof options.onChange === "function" ? options.onChange : () => {};

  function getSequentialFlags() {
    return {
      mainSequential: !!shell.querySelector('[data-sequential="main"]')?.checked,
      secondarySequential: !!shell.querySelector('[data-sequential="secondary"]')?.checked,
    };
  }

  function syncItemsFromUi() {
    for (const blockId of ["main", "secondary"]) {
      const list = blockId === "main" ? mainItems : secondaryItems;
      const listEl = shell.querySelector(`[data-block-list="${blockId}"]`);
      if (!listEl) continue;
      const cards = listEl.querySelectorAll("[data-action-card]");
      cards.forEach((card, index) => {
        const item = list[index];
        if (!item) return;
        item.action = card.querySelector("[data-action-type]")?.value || item.action;
        const fromDom = readRequirementsFromCard(card, item.action);
        const visibleKeys = new Set([
          ...(item._visibleConditions || []),
          ...(item._visibleAttributes || []),
        ]);
        const preserved = {};
        for (const [key, val] of Object.entries(item.requirements || {})) {
          if (!visibleKeys.has(key) && isRequirementFieldAllowed(item.action, key)) {
            preserved[key] = val;
          }
        }
        item.requirements = pickRequirementsForAction(
          item.action,
          cleanRequirements({ ...preserved, ...fromDom })
        );
      });
    }
  }

  function readItemsFromUi() {
    syncItemsFromUi();
    return {
      main: mainItems.map(toPublicActionItem),
      secondary: secondaryItems.map(toPublicActionItem),
    };
  }

  function getValue() {
    const flags = getSequentialFlags();
    const blocks = readItemsFromUi();
    return {
      main: blocks.main,
      secondary: blocks.secondary,
      mainSequential: flags.mainSequential,
      secondarySequential: flags.secondarySequential,
    };
  }

  function emitChange() {
    try {
      onChange(getValue());
    } catch {
      /* invalid intermediate state */
    }
  }

  function setValue({ main, secondary, mainSequential: mainSeq, secondarySequential: secSeq } = {}) {
    if (main !== undefined) mainItems = parseActionsArray(main);
    if (secondary !== undefined) secondaryItems = parseActionsArray(secondary);
    if (mainSeq !== undefined) mainSequential = !!mainSeq;
    if (secSeq !== undefined) secondarySequential = !!secSeq;
    render();
  }

  function setFieldOptions(next) {
    fieldOptions = { ...fieldOptions, ...(next || {}) };
    render();
  }

  function setDomain(next) {
    domain = String(next || "").trim();
    render();
  }

  function getMainActions() {
    return deepClone(getValue().main);
  }

  function getSecondaryActions() {
    return deepClone(getValue().secondary);
  }

  function addAction(blockId) {
    const list = blockId === "main" ? mainItems : secondaryItems;
    list.push(defaultActionItem("bet"));
    render();
    emitChange();
  }

  function removeAction(blockId, index) {
    const list = blockId === "main" ? mainItems : secondaryItems;
    list.splice(index, 1);
    render();
    emitChange();
  }

  function changeActionType(blockId, index, newType) {
    const list = blockId === "main" ? mainItems : secondaryItems;
    const item = list[index];
    if (!item) return;
    syncItemsFromUi();
    const allowed = new Set(
      [...getConditionFieldsForAction(newType), ...getAttributeFieldsForAction(newType)].map((f) => f.key)
    );
    const nextReq = {};
    for (const [key, val] of Object.entries(item.requirements || {})) {
      if (allowed.has(key)) nextReq[key] = val;
    }
    item.action = newType;
    item.requirements = pickRequirementsForAction(newType, nextReq);
    const visible = deriveVisibleFieldsFromRequirements(newType, item.requirements);
    item._visibleConditions = visible.conditions;
    item._visibleAttributes = visible.attributes;
    render();
    emitChange();
  }

  function addVisibleField(blockId, index, role, fieldKey) {
    const list = blockId === "main" ? mainItems : secondaryItems;
    const item = list[index];
    if (!item) return;
    syncItemsFromUi();
    if (!isRequirementFieldAllowed(item.action, fieldKey)) return;
    const target = role === "condition" ? "_visibleConditions" : "_visibleAttributes";
    if (!filterFieldKeysForAction(item.action, [fieldKey], role).length) return;
    const visible = [...(item[target] || [])];
    if (!visible.includes(fieldKey)) visible.push(fieldKey);
    item[target] = visible;
    render();
    emitChange();
  }

  function removeVisibleField(blockId, index, fieldKey) {
    const list = blockId === "main" ? mainItems : secondaryItems;
    const item = list[index];
    if (!item) return;
    syncItemsFromUi();
    item._visibleConditions = (item._visibleConditions || []).filter((k) => k !== fieldKey);
    item._visibleAttributes = (item._visibleAttributes || []).filter((k) => k !== fieldKey);
    item.requirements = deleteRequirementKey(item.requirements, fieldKey, item.action);
    render();
    emitChange();
  }

  function render() {
    shell.innerHTML = `
      <div class="actions-builder__ui-wrap">
        ${renderBlock("main", "Основной блок", mainItems, mainSequential, fieldOptions)}
        ${renderBlock("secondary", "Дополнительный блок", secondaryItems, secondarySequential, fieldOptions)}
      </div>
    `;
    bindEvents();
  }

  function bindCardInputs(card) {
    const blockId = card.getAttribute("data-block") || "main";
    const index = Number(card.getAttribute("data-index"));
    const list = blockId === "main" ? mainItems : secondaryItems;
    const item = list[index];
    card.__reqValues = item?.requirements ? { ...item.requirements } : {};

    card.querySelector("[data-action-type]")?.addEventListener("change", (ev) => {
      changeActionType(blockId, index, ev.target.value);
    });

    const emit = () => {
      try {
        const list = blockId === "main" ? mainItems : secondaryItems;
        const item = list[index];
        if (!item) return;
        item.requirements = readRequirementsFromCard(card, item.action);
        emitChange();
      } catch {
        /* typing */
      }
    };

    for (const el of card.querySelectorAll("input, select, textarea")) {
      const eventName = el.tagName === "TEXTAREA" || el.type === "text" ? "input" : "change";
      el.addEventListener(eventName, emit);
    }

    for (const select of card.querySelectorAll("[data-add-req-field]")) {
      select.addEventListener("change", () => {
        const fieldKey = select.value;
        if (!fieldKey) return;
        const role = select.getAttribute("data-add-req-field");
        addVisibleField(blockId, index, role, fieldKey);
      });
    }

    for (const btn of card.querySelectorAll("[data-remove-req-field]")) {
      btn.addEventListener("click", () => {
        const fieldKey = btn.getAttribute("data-remove-req-field");
        if (!fieldKey) return;
        removeVisibleField(blockId, index, fieldKey);
      });
    }

    if (item) {
      mountCardComboboxes(card, item.requirements, fieldOptions, emit, domain);
    }
  }

  function bindEvents() {
    for (const btn of shell.querySelectorAll("[data-add-action]")) {
      btn.addEventListener("click", () => addAction(btn.getAttribute("data-add-action")));
    }

    for (const btn of shell.querySelectorAll("[data-remove-action]")) {
      btn.addEventListener("click", () => {
        const card = btn.closest("[data-action-card]");
        if (!card) return;
        removeAction(card.getAttribute("data-block") || "main", Number(card.getAttribute("data-index")));
      });
    }

    for (const cb of shell.querySelectorAll("[data-sequential]")) {
      cb.addEventListener("change", emitChange);
    }

    for (const card of shell.querySelectorAll("[data-action-card]")) {
      bindCardInputs(card);
    }
  }

  render();

  return {
    getValue,
    setValue,
    setFieldOptions,
    setDomain,
    getMainActions,
    getSecondaryActions,
    getSequentialFlags,
  };
}

export {
  isHandledActionType,
  getActionDef,
  getAllActionTypes,
  getConditionFieldsForAction,
  getAttributeFieldsForAction,
  getFieldRole,
  getFieldRoleForAction,
  isRequirementFieldAllowed,
  filterFieldKeysForAction,
  coerceActionRequirements,
  mergeActionFieldsForUi,
  splitActionFieldsForApi,
} from "./actions-schema.js";
