import { datetimeLocalToIso, escapeHtml, isoToDatetimeLocal } from "./format.js";
import { mountActionsBuilder } from "./actions-builder.js";
import { buildActionFieldOptionsFromConditionsSchema } from "./actions-schema.js";
import { mountConditionsBuilder } from "./conditions-builder.js";
import { loadConditionsSchema } from "./conditions-schema.js";
import {
  DEFAULT_CATEGORIES,
  DEFAULT_PRIORITIES,
  DEFAULT_TASK_TYPES,
  loadTaskMeta,
} from "./meta.js";
import { loadCountriesData, mountCountrySelector } from "./country-selector.js";
import { mountRepeatSchedule } from "./repeat-schedule.js";
import { mountMultiCombobox } from "./multi-combobox.js";
import {
  categoryLabel,
  eventLabel,
  notificationEventLabel,
  priorityLabel,
  toLabeledOptions,
  typeLabel,
} from "./labels-ru.js";
import {
  boolValue,
  buildCreatePayload,
} from "./tasks.js";

const KNOWN_LOCALE_CODES = ["de", "en", "es", "fr", "it", "pt", "ru"];

const FIELD_IDS = {
  sourceId: "copy-source-id",
  name: "copy-task-name",
  frontendIdentifier: "copy-task-frontend-identifier",
  hidden: "copy-task-hidden",
  type: "copy-task-type",
  countrySelector: "copy-task-country-selector-mount",
  playerConsentRequired: "copy-task-player-consent-required",
  category: "copy-task-category",
  priority: "copy-task-priority",
  events: "copy-task-events",
  repeatSchedule: "copy-task-repeat-schedule-mount",
  availableFrom: "copy-task-available-from",
  availableTill: "copy-task-available-till",
  maxRepetitions: "copy-task-max-repetitions",
  duration: "copy-task-duration",
  infinite: "copy-task-infinite",
  actions: "copy-task-actions-mount",
  conditions: "copy-task-conditions",
  mainBonusGroupId: "copy-task-main-bonus-group-id",
  secondaryBonusGroupId: "copy-task-secondary-bonus-group-id",
  tags: "copy-task-tags",
  notificationEvents: "copy-task-notification-events",
};

const META_FIELD_KEYS = new Set([
  "type",
  "category",
  "priority",
  "tags",
  "events",
  "mainBonusGroupId",
  "secondaryBonusGroupId",
  "notificationEvents",
]);

const SECTIONS = [
  { id: "basic", title: "Основное", open: true },
  { id: "classification", title: "Классификация", open: false },
  { id: "startup", title: "Начало работы", open: false },
  { id: "targeting", title: "Таргетинг", open: false },
  { id: "availability", title: "Доступность по времени", open: false },
  { id: "actions", title: "Целевые действия", open: false },
  { id: "rewards", title: "Вознаграждение", open: false },
  { id: "notifications", title: "Уведомления", open: false },
];

const COMBOBOX_META_KEYS = new Set(["events", "notificationEvents"]);

const PANEL_MODES = {
  copy: {
    title: "Параметры копии",
    sourceIdLabel: "ID исходной задачи",
    submit: "Создать",
    submitting: "Создаю копию задачи...",
    previewStatus: "Payload собран, можно создавать копию",
  },
  edit: {
    title: "Параметры задачи",
    sourceIdLabel: "ID задачи",
    submit: "Сохранить",
    submitting: "Сохраняю изменения...",
    previewStatus: "Payload собран, можно сохранить",
  },
};

function field(root, key) {
  return root.querySelector(`#${FIELD_IDS[key]}`);
}

function getMetaState(root) {
  return root.__copyMetaState ?? { mode: "fallback", data: null };
}

function isMetaSelectMode(root) {
  return getMetaState(root).mode === "select";
}

function metaSlot(fieldKey, fallbackHtml) {
  return `<div class="copy-panel__meta-slot" data-meta-slot="${fieldKey}">${fallbackHtml}</div>`;
}

function localesBlockMarkup() {
  const fields = KNOWN_LOCALE_CODES.map(
    (code) => `
      <label class="copy-panel__field copy-panel__locales-field">
        <span class="copy-panel__field-label">${code}</span>
        <input type="text" data-locale-input="${code}" />
      </label>
    `
  ).join("");

  return `
    <details class="copy-panel__locales copy-panel__field--wide" open>
      <summary class="copy-panel__locales-summary">Названия по языкам</summary>
      <div class="copy-panel__locales-grid">${fields}</div>
    </details>
  `;
}

function textMetaField({ fieldKey, id, label, inputType = "text", placeholder = "", number = false }) {
  const type = number ? "number" : inputType;
  return `
    <label class="copy-panel__field">
      <span class="copy-panel__field-label">${label}</span>
      ${metaSlot(
        fieldKey,
        `<input id="${id}" type="${type}" class="copy-panel__meta-pending" placeholder="${escapeHtml(placeholder)}" disabled />`
      )}
    </label>
  `;
}

function sectionMarkup(section) {
  const openClass = section.open ? " copy-panel__section--open" : "";
  return `
    <section class="copy-panel__section${openClass}" data-section="${section.id}">
      <button class="copy-panel__section-header" type="button" aria-expanded="${section.open}">
        <span class="copy-panel__section-title">${section.title}</span>
        <span class="copy-panel__section-chevron" aria-hidden="true"></span>
      </button>
      <div class="copy-panel__section-body">
        ${sectionBodies[section.id] || ""}
      </div>
    </section>
  `;
}

const sectionBodies = {
  basic: `
    <label class="copy-panel__field">
      <span class="copy-panel__field-label">ID исходной задачи</span>
      <input id="${FIELD_IDS.sourceId}" type="text" readonly />
    </label>
    <div class="copy-panel__grid">
      <label class="copy-panel__field copy-panel__field--wide">
        <span class="copy-panel__field-label">Название (name) *</span>
        <input id="${FIELD_IDS.name}" type="text" />
      </label>
      ${localesBlockMarkup()}
      <label class="copy-panel__field">
        <span class="copy-panel__field-label">ID для фронта (frontend_identifier) *</span>
        <input id="${FIELD_IDS.frontendIdentifier}" type="text" />
      </label>
      <label class="copy-panel__field copy-panel__field--checkbox">
        <input id="${FIELD_IDS.hidden}" type="checkbox" />
        <span>Скрытое (hidden)</span>
      </label>
      ${textMetaField({
        fieldKey: "type",
        id: FIELD_IDS.type,
        label: "Тип",
        placeholder: "interactive",
      })}
      <label class="copy-panel__field">
        <span class="copy-panel__field-label">Согласие игрока</span>
        <select id="${FIELD_IDS.playerConsentRequired}" class="copy-panel__select">
          <option value="false">Нет</option>
          <option value="true">Да</option>
        </select>
      </label>
      <div class="copy-panel__field copy-panel__field--wide">
        <span class="copy-panel__field-label">Страны</span>
        <div id="${FIELD_IDS.countrySelector}" class="copy-panel__country-selector-mount"></div>
      </div>
    </div>
  `,
  classification: `
    <div class="copy-panel__grid">
      ${textMetaField({
        fieldKey: "category",
        id: FIELD_IDS.category,
        label: "Кампания",
        placeholder: "basic",
      })}
      ${textMetaField({
        fieldKey: "priority",
        id: FIELD_IDS.priority,
        label: "Приоритет",
        number: true,
      })}
      ${textMetaField({
        fieldKey: "tags",
        id: FIELD_IDS.tags,
        label: "Тег",
        placeholder: "—",
      })}
    </div>
  `,
  startup: `
    <label class="copy-panel__field copy-panel__field--wide">
      <span class="copy-panel__field-label">События запуска</span>
      ${metaSlot(
        "events",
        `<div id="${FIELD_IDS.events}" class="copy-panel__combobox-mount copy-panel__meta-pending"></div>`
      )}
    </label>
  `,
  targeting: `
    <p class="copy-panel__section-note">Условия показа задачи игроку. Добавляйте нужные условия из справочника.</p>
    <div class="copy-panel__field copy-panel__field--wide">
      <div id="${FIELD_IDS.conditions}" class="copy-panel__conditions-mount"></div>
    </div>
  `,
  availability: `
    <div class="copy-panel__grid">
      <div class="copy-panel__field copy-panel__field--wide">
        <div id="${FIELD_IDS.repeatSchedule}" class="copy-panel__repeat-schedule-mount"></div>
      </div>
      <label class="copy-panel__field">
        <span class="copy-panel__field-label">Доступно с</span>
        <input id="${FIELD_IDS.availableFrom}" type="datetime-local" step="60" />
      </label>
      <label class="copy-panel__field">
        <span class="copy-panel__field-label">Доступно до</span>
        <input id="${FIELD_IDS.availableTill}" type="datetime-local" step="60" />
      </label>
      <label class="copy-panel__field">
        <span class="copy-panel__field-label">Сколько раз может быть получено</span>
        <input id="${FIELD_IDS.maxRepetitions}" type="number" min="0" step="1" placeholder="не ограничено" />
      </label>
      <label class="copy-panel__field">
        <span class="copy-panel__field-label">Время жизни (в минутах)</span>
        <input id="${FIELD_IDS.duration}" type="number" min="0" step="1" placeholder="например 360" />
      </label>
      <label class="copy-panel__field copy-panel__field--checkbox">
        <input id="${FIELD_IDS.infinite}" type="checkbox" />
        <span>бессрочно</span>
      </label>
    </div>
  `,
  actions: `
    <p class="copy-panel__section-note">Основной и дополнительный блоки целевых действий, как в админке PromoHub.</p>
    <div class="copy-panel__field copy-panel__field--wide">
      <div id="${FIELD_IDS.actions}" class="copy-panel__actions-mount"></div>
    </div>
  `,
  rewards: `
    <div class="copy-panel__grid">
      ${textMetaField({
        fieldKey: "mainBonusGroupId",
        id: FIELD_IDS.mainBonusGroupId,
        label: "Основная группа бонусов (main_bonus_group_id)",
        placeholder: "gamification_award:...",
      })}
      ${textMetaField({
        fieldKey: "secondaryBonusGroupId",
        id: FIELD_IDS.secondaryBonusGroupId,
        label: "Доп. группа бонусов (secondary_bonus_group_id)",
        placeholder: "null",
      })}
    </div>
  `,
  notifications: `
    <label class="copy-panel__field copy-panel__field--wide">
      <span class="copy-panel__field-label">Уведомления</span>
      ${metaSlot(
        "notificationEvents",
        `<div id="${FIELD_IDS.notificationEvents}" class="copy-panel__combobox-mount copy-panel__meta-pending"></div>`
      )}
    </label>
  `,
};

function buildSelectHtml(id, options, { multiple = false, nullable = false, className = "copy-panel__select" } = {}) {
  const multipleAttr = multiple ? " multiple" : "";
  const sizeAttr = multiple ? ' size="6"' : "";
  let body = "";
  if (nullable && !multiple) {
    body += `<option value="">— не выбрано —</option>`;
  }
  body += options.join("");
  return `<select id="${id}" class="${className}"${multipleAttr}${sizeAttr}>${body}</select>`;
}

function optionHtml(value, label) {
  return `<option value="${escapeHtml(String(value))}">${escapeHtml(String(label))}</option>`;
}

function applyMetaSelects(root, meta) {
  root.__copyMetaState = { mode: "select", data: meta };

  replaceMetaSlot(root, "type", () =>
    buildSelectHtml(
      FIELD_IDS.type,
      meta.types.map((item) => optionHtml(item, typeLabel(item)))
    )
  );

  replaceMetaSlot(root, "category", () =>
    buildSelectHtml(
      FIELD_IDS.category,
      meta.categories.map((item) => optionHtml(item, categoryLabel(item))),
      { nullable: true }
    )
  );

  replaceMetaSlot(root, "priority", () =>
    buildSelectHtml(
      FIELD_IDS.priority,
      meta.priorities.map((item) => optionHtml(item, priorityLabel(item)))
    )
  );

  replaceMetaSlot(root, "tags", () =>
    buildSelectHtml(
      FIELD_IDS.tags,
      meta.tags.map((item) => optionHtml(item.id, item.name)),
      { nullable: true }
    )
  );

  replaceMetaSlot(root, "events", () =>
    `<div id="${FIELD_IDS.events}" class="copy-panel__combobox-mount"></div>`
  );
  mountEventsCombobox(root, meta);

  replaceMetaSlot(root, "mainBonusGroupId", () =>
    buildSelectHtml(
      FIELD_IDS.mainBonusGroupId,
      meta.bonuses.map((item) => optionHtml(item.id, item.title)),
      { nullable: true }
    )
  );

  replaceMetaSlot(root, "secondaryBonusGroupId", () =>
    buildSelectHtml(
      FIELD_IDS.secondaryBonusGroupId,
      meta.bonuses.map((item) => optionHtml(item.id, item.title)),
      { nullable: true }
    )
  );

  replaceMetaSlot(root, "notificationEvents", () =>
    `<div id="${FIELD_IDS.notificationEvents}" class="copy-panel__combobox-mount"></div>`
  );
  mountNotificationEventsCombobox(root, meta);

  for (const key of META_FIELD_KEYS) {
    const slot = root.querySelector(`[data-meta-slot="${key}"]`);
    slot?.classList.remove("copy-panel__meta-slot--loading");
  }
}

function mountEventsCombobox(root, meta) {
  const mount = field(root, "events");
  if (!mount) return;
  root.__eventsCombobox?.destroy?.();
  root.__eventsCombobox = mountMultiCombobox(mount, {
    options: toLabeledOptions(meta.events, eventLabel),
    placeholder: "Выберите события…",
    searchPlaceholder: "Поиск события…",
    onChange: () => syncRepeatScheduleVisibility(root),
  });
}

function mountNotificationEventsCombobox(root, meta) {
  const mount = field(root, "notificationEvents");
  if (!mount) return;
  root.__notificationEventsCombobox?.destroy?.();
  root.__notificationEventsCombobox = mountMultiCombobox(mount, {
    options: toLabeledOptions(meta.notification_events, notificationEventLabel),
    placeholder: "Выберите уведомления…",
    searchPlaceholder: "Поиск…",
  });
}

function metaFallbackMessage(text) {
  return `<p class="copy-panel__meta-fallback-msg">${escapeHtml(text)}</p>`;
}

function applyMetaFallback(root) {
  root.__copyMetaState = { mode: "fallback", data: null };
  root.__eventsCombobox?.destroy?.();
  root.__eventsCombobox = null;
  root.__notificationEventsCombobox?.destroy?.();
  root.__notificationEventsCombobox = null;

  replaceMetaSlot(root, "type", () =>
    buildSelectHtml(
      FIELD_IDS.type,
      DEFAULT_TASK_TYPES.map((item) => optionHtml(item, typeLabel(item)))
    )
  );

  replaceMetaSlot(root, "category", () =>
    buildSelectHtml(
      FIELD_IDS.category,
      DEFAULT_CATEGORIES.map((item) => optionHtml(item, categoryLabel(item))),
      { nullable: true }
    )
  );

  replaceMetaSlot(root, "priority", () =>
    buildSelectHtml(
      FIELD_IDS.priority,
      DEFAULT_PRIORITIES.map((item) => optionHtml(item, priorityLabel(item)))
    )
  );

  replaceMetaSlot(
    root,
    "tags",
    () => metaFallbackMessage("Справочник тегов не загружен — будет использован тег исходной задачи")
  );

  replaceMetaSlot(
    root,
    "events",
    () => metaFallbackMessage("Справочник не загружен — события запуска недоступны")
  );

  replaceMetaSlot(root, "mainBonusGroupId", () =>
    `<input id="${FIELD_IDS.mainBonusGroupId}" type="text" class="copy-panel__meta-pending" placeholder="gamification_award:..." />`
  );

  replaceMetaSlot(root, "secondaryBonusGroupId", () =>
    `<input id="${FIELD_IDS.secondaryBonusGroupId}" type="text" class="copy-panel__meta-pending" placeholder="null" />`
  );

  replaceMetaSlot(
    root,
    "notificationEvents",
    () => metaFallbackMessage("Справочник не загружен — уведомления недоступны")
  );

  for (const key of META_FIELD_KEYS) {
    const slot = root.querySelector(`[data-meta-slot="${key}"]`);
    if (!slot) continue;
    slot.classList.remove("copy-panel__meta-slot--loading");
    for (const el of slot.querySelectorAll(".copy-panel__meta-pending")) {
      el.disabled = false;
    }
  }
}

function replaceMetaSlot(root, fieldKey, renderHtml) {
  const slot = root.querySelector(`[data-meta-slot="${fieldKey}"]`);
  if (!slot) return;
  slot.innerHTML = renderHtml();
  slot.classList.remove("copy-panel__meta-slot--loading");
}

function setMetaFieldsLoading(root, loading) {
  for (const key of META_FIELD_KEYS) {
    const slot = root.querySelector(`[data-meta-slot="${key}"]`);
    if (!slot) continue;
    slot.classList.toggle("copy-panel__meta-slot--loading", loading);
    if (COMBOBOX_META_KEYS.has(key)) {
      if (key === "events") root.__eventsCombobox?.setDisabled(loading);
      if (key === "notificationEvents") root.__notificationEventsCombobox?.setDisabled(loading);
      continue;
    }
    for (const el of slot.querySelectorAll("input, textarea, select")) {
      el.disabled = loading;
    }
  }
}

function readTagRaw(root) {
  const metaState = getMetaState(root);
  if (metaState.mode !== "select") return "";
  const raw = field(root, "tags")?.value ?? "";
  if (!raw) return "";
  const tagId = Number(raw);
  const tag = metaState.data?.tags?.find((item) => Number(item.id) === tagId);
  if (tag) return JSON.stringify(tag);
  return raw;
}

function fillLocales(root, locales) {
  const data = locales && typeof locales === "object" && !Array.isArray(locales) ? locales : {};

  for (const code of KNOWN_LOCALE_CODES) {
    const input = root.querySelector(`[data-locale-input="${code}"]`);
    if (input) input.value = data[code] ?? "";
  }
}

function readLocales(root) {
  const locales = {};

  for (const code of KNOWN_LOCALE_CODES) {
    const value = root.querySelector(`[data-locale-input="${code}"]`)?.value.trim() ?? "";
    if (value) locales[code] = value;
  }

  return locales;
}

function readEvents(root) {
  if (root.__eventsCombobox) {
    return root.__eventsCombobox.getValue();
  }
  return [];
}

function readNotificationEvents(root) {
  if (root.__notificationEventsCombobox) {
    return root.__notificationEventsCombobox.getValue();
  }
  return [];
}

function readCountryFields(root) {
  if (root.__countrySelector) {
    return root.__countrySelector.getValue();
  }
  return { matchingType: "countries", countries: [], countriesLists: [] };
}

function readNullableSelect(root, key) {
  if (isMetaSelectMode(root)) {
    const raw = field(root, key)?.value ?? "";
    if (!raw) return null;
    return raw;
  }
  return parseNullableField(field(root, key)?.value);
}

function eventsIncludeScheduler(rootOrEvents) {
  const events = Array.isArray(rootOrEvents) ? rootOrEvents : readEvents(rootOrEvents);
  return events.includes("scheduler");
}

function syncRepeatScheduleVisibility(root) {
  const mount = field(root, "repeatSchedule");
  const fieldWrap = mount?.closest(".copy-panel__field");
  if (!fieldWrap) return;
  fieldWrap.classList.toggle("copy-panel__field--hidden", !eventsIncludeScheduler(root));
}

export function parseJsonInput(root, fieldKey, fallback) {
  const raw = field(root, fieldKey)?.value.trim() ?? "";
  if (!raw) return fallback;
  return JSON.parse(raw);
}

export function parseNullableField(raw) {
  const value = String(raw || "").trim();
  if (!value || value.toLowerCase() === "null") return null;
  if (/^-?\d+$/.test(value)) return Number(value);
  return value;
}

export { datetimeLocalToIso, isoToDatetimeLocal } from "./format.js";

export function durationToForm(minutes, infinite) {
  if (infinite || minutes == null) {
    return { value: "", infinite: true };
  }
  const total = Number(minutes);
  if (!Number.isFinite(total) || total < 0) {
    return { value: "", infinite: false };
  }
  return { value: String(total), infinite: false };
}

export function formToDurationMinutes(value, infinite) {
  if (infinite) return null;
  const raw = String(value || "").trim();
  if (!raw) throw new Error("Укажите время жизни или включите «бессрочно»");
  const num = Number(raw);
  if (!Number.isFinite(num) || num < 0) {
    throw new Error("Время жизни должно быть неотрицательным числом минут");
  }
  return Math.round(num);
}

export function fillCopyForm(root, task, { mode = "copy" } = {}) {
  const isEdit = mode === "edit";
  field(root, "sourceId").value = String(task.id ?? "");
  field(root, "name").value = isEdit ? task.name || "" : task.name ? `${task.name}_copy` : "";
  field(root, "frontendIdentifier").value = task.frontend_identifier || "";
  fillLocales(root, task.locales);
  field(root, "hidden").checked = boolValue(task.hidden, false);

  const typeEl = field(root, "type");
  if (typeEl) typeEl.value = task.type || "";

  const consentEl = field(root, "playerConsentRequired");
  if (consentEl) {
    consentEl.value = boolValue(task.player_consent_required, false) ? "true" : "false";
  }

  if (root.__countrySelector) {
    root.__countrySelector.setValue({
      matchingType: task.countries_matching_type || "countries",
      countries: task.countries || [],
      countriesLists: task.countries_lists || [],
    });
  }

  const categoryEl = field(root, "category");
  categoryEl.value = task.category || "";

  const priorityEl = field(root, "priority");
  priorityEl.value = task.priority == null ? "0" : String(task.priority);

  const tagId = task.tag?.id ?? task.tag_id ?? null;
  const tagsEl = field(root, "tags");
  if (tagsEl?.tagName === "SELECT") {
    tagsEl.value = tagId == null ? "" : String(tagId);
  }

  const events = Array.isArray(task.events) ? task.events : task.event ? [task.event] : [];
  if (root.__eventsCombobox) {
    root.__eventsCombobox.setValue(events);
  }

  if (root.__repeatSchedule && eventsIncludeScheduler(events)) {
    root.__repeatSchedule.setValue({ cron: task.cron ?? null });
  }
  syncRepeatScheduleVisibility(root);
  field(root, "availableFrom").value = isoToDatetimeLocal(task.available_from);
  field(root, "availableTill").value = isoToDatetimeLocal(task.available_till);
  field(root, "maxRepetitions").value =
    task.max_repetitions == null ? "" : String(task.max_repetitions);

  const lifetime = durationToForm(task.duration, boolValue(task.infinite, task.duration == null));
  field(root, "duration").value = lifetime.value;
  field(root, "infinite").checked = lifetime.infinite;

  if (root.__actionsBuilder) {
    root.__actionsBuilder.setValue({
      main: task.serialized_main_actions || [],
      secondary: task.serialized_secondary_actions || [],
      mainSequential: boolValue(task.main_actions_sequential, false),
      secondarySequential: boolValue(task.secondary_actions_sequential, false),
    });
  }
  if (root.__conditionsBuilder) {
    root.__conditionsBuilder.setValue(task.conditions || []);
  }

  const mainBonusEl = field(root, "mainBonusGroupId");
  mainBonusEl.value = task.main_bonus_group_id || "";

  const secondaryBonusEl = field(root, "secondaryBonusGroupId");
  if (secondaryBonusEl?.tagName === "SELECT") {
    secondaryBonusEl.value =
      task.secondary_bonus_group_id == null ? "" : String(task.secondary_bonus_group_id);
  } else {
    secondaryBonusEl.value =
      task.secondary_bonus_group_id == null ? "" : String(task.secondary_bonus_group_id);
  }

  const notificationEvents = task.notification_events || [];
  if (root.__notificationEventsCombobox) {
    root.__notificationEventsCombobox.setValue(notificationEvents);
  }
}

export function buildCopyPayload(root, sourceTask) {
  if (!sourceTask) throw new Error("Сначала выберите исходную задачу");

  const name = field(root, "name").value.trim();
  const frontendIdentifier = field(root, "frontendIdentifier").value.trim();
  if (!name) throw new Error("Поле name обязательно");
  if (!frontendIdentifier) throw new Error("Поле frontend_identifier обязательно");

  const infinite = !!field(root, "infinite").checked;

  const events = readEvents(root);
  const hasScheduler = eventsIncludeScheduler(events);
  const repeatState =
    hasScheduler && root.__repeatSchedule
      ? root.__repeatSchedule.getValue()
      : { cron: null };

  const maxRepRaw = field(root, "maxRepetitions").value.trim();

  const typeRaw = field(root, "type").value;
  const categoryRaw = field(root, "category").value;
  const priorityRaw = field(root, "priority").value;

  const actionsState = root.__actionsBuilder
    ? root.__actionsBuilder.getValue()
    : { main: [], secondary: [], mainSequential: false, secondarySequential: false };

  const countryFields = readCountryFields(root);

  const overrides = {
    name,
    locales: readLocales(root),
    frontend_identifier: frontendIdentifier,
    hidden: !!field(root, "hidden").checked,
    type: (typeof typeRaw === "string" ? typeRaw : String(typeRaw || "")).trim() || undefined,
    countries_matching_type: countryFields.matchingType || undefined,
    countries: countryFields.countries,
    countries_lists: countryFields.countriesLists,
    player_consent_required: field(root, "playerConsentRequired")?.value === "true",
    category: (typeof categoryRaw === "string" ? categoryRaw : String(categoryRaw || "")).trim() || undefined,
    priority: Number(priorityRaw || 0),
    events,
    repeatable: hasScheduler,
    cron: hasScheduler ? repeatState.cron : null,
    available_from: datetimeLocalToIso(field(root, "availableFrom").value),
    available_till: datetimeLocalToIso(field(root, "availableTill").value),
    max_repetitions: maxRepRaw ? Number(maxRepRaw) : null,
    infinite,
    duration: formToDurationMinutes(field(root, "duration").value, infinite),
    main_actions_sequential: actionsState.mainSequential,
    secondary_actions_sequential: actionsState.secondarySequential,
    serialized_main_actions: actionsState.main,
    serialized_secondary_actions: actionsState.secondary,
    conditions: root.__conditionsBuilder
      ? root.__conditionsBuilder.getValue()
      : [],
    main_bonus_group_id: readNullableSelect(root, "mainBonusGroupId"),
    secondary_bonus_group_id: readNullableSelect(root, "secondaryBonusGroupId"),
    notification_events: readNotificationEvents(root),
    __tagRaw: readTagRaw(root),
  };

  return { gamification_task: buildCreatePayload(sourceTask, overrides) };
}

export function getCopyPanelMarkup({
  title = PANEL_MODES.copy.title,
  showPreview = true,
  mode = "copy",
} = {}) {
  const labels = PANEL_MODES[mode === "edit" ? "edit" : "copy"];
  return `
    <div class="copy-panel">
    <h2 class="copy-panel__title">${title || labels.title}</h2>
    <div id="copy-panel-meta-status" class="copy-panel__meta-status copy-panel__meta-status--loading">
      <span class="copy-panel__spinner" aria-hidden="true"></span>
      <span class="copy-panel__meta-status-text">Загрузка справочников…</span>
    </div>
    <div id="copy-panel-status" class="copy-panel__status">Загрузите исходную задачу</div>
    <div class="copy-panel__sections">
      ${SECTIONS.map(sectionMarkup).join("")}
    </div>
    <div class="copy-panel__actions">
      <button id="copy-btn-create" class="btn btn--success" type="button" disabled>${labels.submit}</button>
      ${
        showPreview
          ? '<button id="copy-btn-preview" class="btn" type="button" disabled>Показать payload</button>'
          : ""
      }
    </div>
    <pre id="copy-result" class="copy-panel__result">Здесь будет результат запросов</pre>
    </div>
  `;
}

function bindSectionToggles(root) {
  for (const header of root.querySelectorAll(".copy-panel__section-header")) {
    header.addEventListener("click", () => {
      const section = header.closest(".copy-panel__section");
      if (!section) return;
      const open = section.classList.toggle("copy-panel__section--open");
      header.setAttribute("aria-expanded", String(open));
    });
  }
}

function updateMetaStatusEl(root, { loading = false, error = false, text = "" } = {}) {
  const el = root.querySelector("#copy-panel-meta-status");
  if (!el) return;
  el.classList.toggle("copy-panel__meta-status--loading", loading);
  el.classList.toggle("copy-panel__meta-status--error", error);
  el.classList.toggle("copy-panel__meta-status--hidden", !loading && !error && !text);
  const textEl = el.querySelector(".copy-panel__meta-status-text");
  if (textEl && text) textEl.textContent = text;
}

function setFormActionsEnabled(root, enabled) {
  root.querySelector("#copy-btn-create")?.toggleAttribute("disabled", !enabled);
  root.querySelector("#copy-btn-preview")?.toggleAttribute("disabled", !enabled);
}

function applyPanelModeUi(root, mode) {
  const labels = PANEL_MODES[mode === "edit" ? "edit" : "copy"];
  const titleEl = root.querySelector(".copy-panel__title");
  if (titleEl) titleEl.textContent = labels.title;
  const createBtn = root.querySelector("#copy-btn-create");
  if (createBtn) createBtn.textContent = labels.submit;
  const sourceLabel = field(root, "sourceId")
    ?.closest(".copy-panel__field")
    ?.querySelector(".copy-panel__field-label");
  if (sourceLabel) sourceLabel.textContent = labels.sourceIdLabel;
}

/**
 * @param {HTMLElement} root
 * @param {{
 *   title?: string,
 *   showPreview?: boolean,
 *   mode?: "copy" | "edit",
 *   domain?: string,
 *   getDomain?: () => string,
 *   onCreate?: (payload: object) => Promise<unknown>,
 *   onUpdate?: (payload: object) => Promise<unknown>,
 *   getTaskOptions?: () => Array<{ id?: string, name?: string, value?: string, label?: string }>,
 * }} options
 */
export function mountCopyPanel(root, options = {}) {
  root.innerHTML = getCopyPanelMarkup(options);

  const statusEl = root.querySelector("#copy-panel-status");
  const resultEl = root.querySelector("#copy-result");
  let sourceTask = null;
  let pendingTask = null;
  let panelMode = options.mode === "edit" ? "edit" : "copy";
  let metaLoadToken = 0;
  let countriesLoadToken = 0;
  let getTaskOptionsFn =
    typeof options.getTaskOptions === "function" ? options.getTaskOptions : null;

  function refreshConditionsTaskOptions() {
    root.__conditionsBuilder?.refreshTaskOptions?.();
  }

  function fillFormFromTask(task) {
    fillCopyForm(root, task, { mode: panelMode });
    syncDurationDisabled();
  }

  function resolveDomain() {
    if (typeof options.getDomain === "function") {
      return String(options.getDomain() || "").trim();
    }
    return String(options.domain || "").trim();
  }

  function setStatus(text, isError = false) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.classList.toggle("copy-panel__status--error", !!isError);
  }

  function printResult(value) {
    if (!resultEl) return;
    resultEl.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  }

  function fillFromTask(task) {
    sourceTask = task;
    refreshConditionsTaskOptions();
    if (getMetaState(root).mode === "loading") {
      pendingTask = task;
      return;
    }
    fillFormFromTask(task);
  }

  function setMode(mode) {
    panelMode = mode === "edit" ? "edit" : "copy";
    applyPanelModeUi(root, panelMode);
  }

  function buildPayload() {
    return buildCopyPayload(root, sourceTask);
  }

  async function loadCountries(domainInput) {
    const domain = String(domainInput || resolveDomain()).trim();
    const token = ++countriesLoadToken;

    const countryMount = field(root, "countrySelector");
    if (!countryMount) return { ok: false, reason: "no_mount" };

    if (!root.__countrySelector) {
      root.__countrySelector = mountCountrySelector(countryMount, { onChange: () => {} });
    }

    root.__countrySelector.setMode("loading");
    root.__countrySelector.setDisabled(true);

    try {
      const countriesData = await loadCountriesData(domain);
      if (token !== countriesLoadToken) return { ok: false, reason: "stale" };

      root.__countrySelector.setData(countriesData);
      root.__countrySelector.setMode("ui");
      root.__countrySelector.setDisabled(false);

      const taskToFill = pendingTask || sourceTask;
      if (taskToFill) {
        root.__countrySelector.setValue({
          matchingType: taskToFill.countries_matching_type || "countries",
          countries: taskToFill.countries || [],
          countriesLists: taskToFill.countries_lists || [],
        });
      }
      return { ok: true, data: countriesData };
    } catch (err) {
      if (token !== countriesLoadToken) return { ok: false, reason: "stale" };
      root.__countrySelector.setMode("fallback");
      root.__countrySelector.setDisabled(false);

      const taskToFill = pendingTask || sourceTask;
      if (taskToFill) {
        root.__countrySelector.setValue({
          matchingType: taskToFill.countries_matching_type || "countries",
          countries: taskToFill.countries || [],
          countriesLists: taskToFill.countries_lists || [],
        });
      }
      return { ok: false, reason: "error", error: err };
    }
  }

  async function applyActionFieldOptions(domainInput) {
    if (!root.__actionsBuilder) return;
    const domain = String(domainInput || "").trim();
    root.__actionsBuilder.setDomain(domain);
    try {
      const schema = await loadConditionsSchema(domain);
      root.__actionsBuilder.setFieldOptions(buildActionFieldOptionsFromConditionsSchema(schema));
    } catch {
      /* text fallback for multi-select fields */
    }
  }

  async function loadMeta(domainInput) {
    const domain = String(domainInput || resolveDomain()).trim();
    const token = ++metaLoadToken;

    if (!domain) {
      applyMetaFallback(root);
      root.__conditionsBuilder?.loadSchema("");
      void applyActionFieldOptions("");
      void loadCountries("");
      updateMetaStatusEl(root, {
        error: true,
        text: "Домен не выбран — поля справочников в режиме ввода вручную",
      });
      setFormActionsEnabled(root, true);
      if (pendingTask) {
        fillFormFromTask(pendingTask);
        pendingTask = null;
      }
      return { ok: false, reason: "no_domain" };
    }

    root.__copyMetaState = { mode: "loading", data: null };
    setMetaFieldsLoading(root, true);
    updateMetaStatusEl(root, { loading: true, text: "Загрузка справочников…" });
    setFormActionsEnabled(root, false);

    try {
      const [meta, countriesResult] = await Promise.all([
        loadTaskMeta(domain),
        loadCountries(domain),
      ]);
      if (token !== metaLoadToken) return { ok: false, reason: "stale" };

      applyMetaSelects(root, meta);
      root.__conditionsBuilder?.loadSchema(domain);
      void applyActionFieldOptions(domain);

      const countriesHint =
        countriesResult.ok && countriesResult.data
          ? `, ${countriesResult.data.countries.length} стран`
          : "";
      updateMetaStatusEl(root, {
        text: `Справочники загружены: ${meta.filters.length} фильтров, ${meta.tags.length} тегов${countriesHint}`,
      });
      setFormActionsEnabled(root, true);

      const taskToFill = pendingTask || sourceTask;
      if (taskToFill) {
        fillFormFromTask(taskToFill);
        pendingTask = null;
      }
      return { ok: true, meta };
    } catch (err) {
      if (token !== metaLoadToken) return { ok: false, reason: "stale" };
      applyMetaFallback(root);
      root.__conditionsBuilder?.loadSchema(domain);
      void applyActionFieldOptions(domain);
      void loadCountries(domain);
      const message = err?.message || String(err);
      updateMetaStatusEl(root, {
        error: true,
        text: `Meta не загружена — ручной ввод: ${message.split("\n")[0]}`,
      });
      setFormActionsEnabled(root, true);

      const taskToFill = pendingTask || sourceTask;
      if (taskToFill) {
        fillFormFromTask(taskToFill);
        pendingTask = null;
      }
      return { ok: false, reason: "error", error: err };
    }
  }

  root.querySelector("#copy-btn-create")?.addEventListener("click", async () => {
    try {
      const labels = PANEL_MODES[panelMode];
      setStatus(labels.submitting);
      const requestBody = buildPayload();
      printResult(requestBody);
      const handler = panelMode === "edit" ? options.onUpdate : options.onCreate;
      if (handler) {
        const response = await handler(requestBody);
        if (response !== undefined) printResult(response);
      } else {
        setStatus(`Payload собран (${panelMode === "edit" ? "onUpdate" : "onCreate"} не задан)`);
      }
    } catch (err) {
      const message = err.message || String(err);
      printResult(message);
      setStatus(message.split("\n")[0], true);
    }
  });

  root.querySelector("#copy-btn-preview")?.addEventListener("click", () => {
    try {
      const payload = buildPayload();
      printResult(payload);
      setStatus(PANEL_MODES[panelMode].previewStatus);
    } catch (err) {
      setStatus(`Ошибка в форме: ${err.message || err}`, true);
    }
  });

  const infiniteEl = field(root, "infinite");
  const durationEl = field(root, "duration");
  function syncDurationDisabled() {
    const disabled = !!infiniteEl?.checked;
    if (durationEl) durationEl.disabled = disabled;
  }
  infiniteEl?.addEventListener("change", syncDurationDisabled);

  bindSectionToggles(root);
  syncDurationDisabled();

  const repeatMount = field(root, "repeatSchedule");
  root.__repeatSchedule = mountRepeatSchedule(repeatMount, { onChange: () => {} });
  syncRepeatScheduleVisibility(root);

  const conditionsMount = field(root, "conditions");
  root.__conditionsBuilder = mountConditionsBuilder(conditionsMount, {
    value: [],
    getDomain: resolveDomain,
    meta: null,
    taskMeta: null,
    getTaskOptions: () => (typeof getTaskOptionsFn === "function" ? getTaskOptionsFn() : []),
    onChange: () => {},
  });

  const actionsMount = field(root, "actions");
  root.__actionsBuilder = mountActionsBuilder(actionsMount, {
    mainValue: [],
    secondaryValue: [],
    mainSequential: false,
    secondarySequential: false,
    onChange: () => {},
  });

  const countryMount = field(root, "countrySelector");
  root.__countrySelector = mountCountrySelector(countryMount, { onChange: () => {} });

  for (const key of META_FIELD_KEYS) {
    root.querySelector(`[data-meta-slot="${key}"]`)?.classList.add("copy-panel__meta-slot--loading");
  }

  void loadMeta(resolveDomain());

  applyPanelModeUi(root, panelMode);

  return {
    fillFromTask,
    buildPayload,
    setStatus,
    printResult,
    loadMeta,
    loadCountries,
    setMode,
    getMode: () => panelMode,
    getSourceTask: () => sourceTask,
    setSourceTask: (task) => {
      sourceTask = task;
    },
    refreshTaskOptions: refreshConditionsTaskOptions,
    setGetTaskOptions: (fn) => {
      getTaskOptionsFn = typeof fn === "function" ? fn : null;
      root.__conditionsBuilder?.setGetTaskOptions?.(getTaskOptionsFn);
    },
  };
}
