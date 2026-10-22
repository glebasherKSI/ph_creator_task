import { apiFetch, resolveAdminTab } from "./api.js";
import { loadConditionsSchema, getConditionDef } from "./conditions-schema.js";

const CACHE_TTL_MS = 10 * 60 * 1000;
const CONSTANTS_API_PATH = "/admin/api/constants?locale=ru";
const FIXTURE_PATH = "test_primer/constant.json";

/** @type {Map<string, { data: ParsedCountriesData, expiresAt: number }>} */
const cache = new Map();

/** @type {ParsedCountriesData | null} */
let fixtureCache = null;

export const COUNTRIES_MATCHING_TYPES = [
  { id: "countries", label: "Страны" },
  { id: "countries_lists", label: "Уровни стран" },
];

/**
 * @typedef {object} CountryOption
 * @property {string} code
 * @property {string} en
 * @property {string} ru
 */

/**
 * @typedef {object} CountryListOption
 * @property {string} id
 * @property {string} label
 */

/**
 * @typedef {object} ParsedCountriesData
 * @property {CountryOption[]} countries
 * @property {CountryListOption[]} countriesLists
 * @property {string[]} locales Языки, реально настроенные на проекте (constants.locales), нижний регистр.
 * @property {string} source
 */

/**
 * @param {unknown} raw
 * @param {string} [source]
 * @returns {ParsedCountriesData}
 */
export function parseCountriesData(raw, source = "unknown") {
  const root = raw && typeof raw === "object" ? raw : {};
  const constants =
    root.constants && typeof root.constants === "object" ? root.constants : root;

  const countriesBlock =
    constants.countries && typeof constants.countries === "object"
      ? constants.countries
      : {};

  const countrySource =
    (Array.isArray(countriesBlock.all) && countriesBlock.all.length
      ? countriesBlock.all
      : null) ??
    (Array.isArray(countriesBlock.allowed) && countriesBlock.allowed.length
      ? countriesBlock.allowed
      : null) ??
    [];

  /** @type {CountryOption[]} */
  const countries = countrySource
    .filter((item) => item && item.code)
    .map((item) => ({
      code: String(item.code).toUpperCase(),
      en: String(item.en ?? item.code),
      ru: String(item.ru ?? item.en ?? item.code),
    }))
    .sort((a, b) => a.ru.localeCompare(b.ru, "ru"));

  /** @type {CountryListOption[]} */
  let countriesLists = [];
  const rawLists = constants.countries_lists;
  if (Array.isArray(rawLists)) {
    countriesLists = rawLists.map((item) => {
      if (typeof item === "string") {
        return { id: item, label: item };
      }
      if (item && typeof item === "object") {
        const id = String(item.id ?? item.value ?? "");
        return { id, label: String(item.name ?? item.label ?? id) };
      }
      return null;
    }).filter(Boolean);
  }

  /** @type {string[]} */
  const locales = [];
  if (Array.isArray(constants.locales)) {
    const seen = new Set();
    for (const item of constants.locales) {
      const code = String(item ?? "").trim().toLowerCase();
      if (code && !seen.has(code)) {
        seen.add(code);
        locales.push(code);
      }
    }
  }

  return { countries, countriesLists, locales, source };
}

/**
 * @param {ParsedCountriesData} data
 * @param {import("./conditions-schema.js").ParsedConditionsSchema | null} schema
 */
function enrichFromConditions(data, schema) {
  if (!schema) return data;

  const def = getConditionDef(schema, "profile_country");
  if (!def) return data;

  const next = { ...data, countries: [...data.countries], countriesLists: [...data.countriesLists] };

  if (!next.countries.length && Array.isArray(def.collection)) {
    next.countries = def.collection
      .filter((item) => item?.id)
      .map((item) => ({
        code: String(item.id).toUpperCase(),
        en: String(item.name ?? item.id),
        ru: String(item.name ?? item.id),
      }))
      .sort((a, b) => a.ru.localeCompare(b.ru, "ru"));
  }

  if (!next.countriesLists.length && def.extra?.countriesLists) {
    const lists = def.extra.countriesLists;
    if (Array.isArray(lists)) {
      next.countriesLists = lists
        .filter((item) => item?.id != null || item?.value != null)
        .map((item) => {
          const id = String(item.id ?? item.value);
          return { id, label: String(item.name ?? id) };
        });
    }
  }

  return next;
}

async function loadConstantsFixture() {
  if (fixtureCache) return fixtureCache;

  let url;
  if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
    url = chrome.runtime.getURL(FIXTURE_PATH);
  } else {
    url = `/${FIXTURE_PATH}`;
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Не удалось загрузить fixture constants (${response.status})`);
  }
  const raw = await response.json();
  fixtureCache = parseCountriesData(raw, "fixture");
  return fixtureCache;
}

/**
 * GET /admin/api/constants?locale=ru с кэшем (TTL 10 мин).
 * Fallback — test_primer/constant.json + enrichment из conditions.
 * @param {string} domain
 * @returns {Promise<ParsedCountriesData>}
 */
export async function loadCountriesData(domain) {
  const key = String(domain || "").trim();

  if (key) {
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }
  }

  let schema = null;
  try {
    schema = await loadConditionsSchema(key);
  } catch {
    schema = null;
  }

  if (!key) {
    const fixture = await loadConstantsFixture();
    return enrichFromConditions(fixture, schema);
  }

  try {
    const adminContext = await resolveAdminTab(key);
    const raw = await apiFetch(adminContext, CONSTANTS_API_PATH);
    let data = parseCountriesData(raw, "api");
    data = enrichFromConditions(data, schema);
    cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    return data;
  } catch (err) {
    const fixture = await loadConstantsFixture();
    const data = enrichFromConditions(
      { ...fixture, source: `fixture (API: ${err?.message || err})` },
      schema
    );
    return data;
  }
}

/** @param {string} [domain] */
export function clearCountriesDataCache(domain) {
  if (domain) cache.delete(String(domain).trim());
  else cache.clear();
}

function countryLabel(country) {
  return `${country.code} - ${country.en} - ${country.ru}`;
}

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function escapeHtml(value) {
  return escapeAttr(value).replace(/>/g, "&gt;");
}

function matchesCountrySearch(country, query) {
  if (!query) return true;
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    country.code.toLowerCase().includes(q) ||
    country.en.toLowerCase().includes(q) ||
    country.ru.toLowerCase().includes(q)
  );
}

/**
 * @param {HTMLElement} container
 * @param {{
 *   matchingType?: string,
 *   countries?: string[],
 *   countriesLists?: string[],
 *   onChange?: () => void,
 * }} [initial]
 */
export function mountCountrySelector(container, initial = {}) {
  if (!container) {
    throw new Error("mountCountrySelector: container is required");
  }

  const uid = `cs-${Math.random().toString(36).slice(2, 9)}`;
  let mode = "loading";
  /** @type {ParsedCountriesData | null} */
  let data = null;
  /** @type {Set<string>} */
  let selectedCountries = new Set();
  /** @type {Set<string>} */
  let selectedLists = new Set();
  let matchingType = initial.matchingType || "countries";
  let allCountriesSelected = false;
  let countriesSearchQuery = "";
  let listsSearchQuery = "";
  /** @type {"countries" | "lists" | null} */
  let openCombobox = null;
  let countriesHighlight = -1;
  let listsHighlight = -1;
  let disabled = false;

  container.innerHTML = `
    <div class="country-selector country-selector--loading" data-country-selector>
      <div class="country-selector__status">
        <span class="country-selector__spinner" aria-hidden="true"></span>
        <span>Загрузка списка стран…</span>
      </div>
      <div class="country-selector__notice country-selector__notice--hidden" role="status">
        Не удалось загрузить справочник стран. Можно выбрать «Все страны» или оставить ранее
        заданные коды; список для выбора недоступен, пока справочник не загрузится.
      </div>
      <div class="country-selector__ui country-selector__ui--hidden">
        <fieldset class="country-selector__toggle">
          <legend class="country-selector__toggle-label">Сопоставлять по</legend>
          ${COUNTRIES_MATCHING_TYPES.map(
            (item) => `
              <label class="country-selector__radio">
                <input type="radio" name="${uid}-matching" value="${item.id}" />
                <span>${item.label}</span>
              </label>
            `
          ).join("")}
        </fieldset>
        <div class="country-selector__panel" data-panel="countries">
          <span class="country-selector__field-label">Страны</span>
          <div class="country-selector__combobox" data-combobox="countries">
            <div class="country-selector__combobox-control" tabindex="0" role="combobox" aria-expanded="false" aria-haspopup="listbox">
              <div class="country-selector__chips" data-chips="countries"></div>
              <input
                type="text"
                class="country-selector__combobox-input"
                data-input="countries"
                placeholder="Поиск по коду или названию…"
                autocomplete="off"
                aria-autocomplete="list"
              />
            </div>
            <div class="country-selector__dropdown country-selector__dropdown--hidden" data-dropdown="countries">
              <div class="country-selector__dropdown-list" data-list="countries" role="listbox" aria-multiselectable="true"></div>
              <div class="country-selector__dropdown-divider"></div>
              <button type="button" class="country-selector__dropdown-all" data-all="countries">Все страны</button>
            </div>
          </div>
        </div>
        <div class="country-selector__panel country-selector__panel--hidden" data-panel="countries_lists">
          <span class="country-selector__field-label">Уровни стран (countries_lists)</span>
          <div class="country-selector__combobox" data-combobox="lists">
            <div class="country-selector__combobox-control" tabindex="0" role="combobox" aria-expanded="false" aria-haspopup="listbox">
              <div class="country-selector__chips" data-chips="lists"></div>
              <input
                type="text"
                class="country-selector__combobox-input"
                data-input="lists"
                placeholder="Поиск уровня…"
                autocomplete="off"
                aria-autocomplete="list"
              />
            </div>
            <div class="country-selector__dropdown country-selector__dropdown--hidden" data-dropdown="lists">
              <div class="country-selector__dropdown-list" data-list="lists" role="listbox" aria-multiselectable="true"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  const root = container.querySelector("[data-country-selector]");
  const uiEl = root.querySelector(".country-selector__ui");
  const statusEl = root.querySelector(".country-selector__status");
  const noticeEl = root.querySelector(".country-selector__notice");
  const countriesPanel = root.querySelector('[data-panel="countries"]');
  const listsPanel = root.querySelector('[data-panel="countries_lists"]');
  const countriesCombobox = root.querySelector('[data-combobox="countries"]');
  const listsCombobox = root.querySelector('[data-combobox="lists"]');
  const countriesControl = countriesCombobox.querySelector(".country-selector__combobox-control");
  const listsControl = listsCombobox.querySelector(".country-selector__combobox-control");
  const countriesChipsEl = root.querySelector('[data-chips="countries"]');
  const listsChipsEl = root.querySelector('[data-chips="lists"]');
  const countriesInput = root.querySelector('[data-input="countries"]');
  const listsInput = root.querySelector('[data-input="lists"]');
  const countriesDropdown = root.querySelector('[data-dropdown="countries"]');
  const listsDropdown = root.querySelector('[data-dropdown="lists"]');
  const countriesListEl = root.querySelector('[data-list="countries"]');
  const listsListEl = root.querySelector('[data-list="lists"]');
  const countriesAllBtn = root.querySelector('[data-all="countries"]');
  const matchingRadios = root.querySelectorAll(`input[name="${uid}-matching"]`);

  function emitChange() {
    initial.onChange?.();
  }

  function setLoading(loading) {
    root.classList.toggle("country-selector--loading", loading);
    statusEl.classList.toggle("country-selector__status--hidden", !loading);
  }

  function updatePanelsVisibility() {
    const isCountries = matchingType === "countries";
    countriesPanel.classList.toggle("country-selector__panel--hidden", !isCountries);
    listsPanel.classList.toggle("country-selector__panel--hidden", isCountries);
    if (!isCountries && openCombobox === "countries") closeDropdown();
    if (isCountries && openCombobox === "lists") closeDropdown();
  }

  function getCountryByCode(code) {
    const needle = String(code || "").trim().toUpperCase();
    if (!needle || !data?.countries?.length) return null;
    return (
      data.countries.find((item) => String(item.code || "").trim().toUpperCase() === needle) ?? null
    );
  }

  function getFilteredCountries() {
    if (!data?.countries?.length) return [];
    return data.countries.filter((item) => matchesCountrySearch(item, countriesSearchQuery));
  }

  function getFilteredLists() {
    if (!data?.countriesLists?.length) return [];
    const q = listsSearchQuery.trim().toLowerCase();
    if (!q) return data.countriesLists;
    return data.countriesLists.filter(
      (item) =>
        item.id.toLowerCase().includes(q) || item.label.toLowerCase().includes(q)
    );
  }

  function renderCountryChips() {
    if (allCountriesSelected) {
      countriesChipsEl.innerHTML = `
        <span class="country-selector__chip country-selector__chip--all">
          <span class="country-selector__chip-label">Все страны</span>
          <button type="button" class="country-selector__chip-remove" data-remove-all="countries" aria-label="Убрать «Все страны»" ${disabled ? "disabled" : ""}>×</button>
        </span>
      `;
      return;
    }

    const codes = [...selectedCountries].sort((a, b) => {
      const ca = getCountryByCode(a);
      const cb = getCountryByCode(b);
      return (ca?.ru ?? a).localeCompare(cb?.ru ?? b, "ru");
    });

    countriesChipsEl.innerHTML = codes
      .map((code) => {
        const country = getCountryByCode(code);
        const label = country ? countryLabel(country) : code;
        return `
          <span class="country-selector__chip">
            <span class="country-selector__chip-label">${escapeHtml(label)}</span>
            <button type="button" class="country-selector__chip-remove" data-remove-country="${escapeAttr(code)}" aria-label="Убрать ${escapeAttr(label)}" ${disabled ? "disabled" : ""}>×</button>
          </span>
        `;
      })
      .join("");
  }

  function renderListChips() {
    const ids = [...selectedLists].sort((a, b) => {
      const la = data?.countriesLists?.find((item) => item.id === a)?.label ?? a;
      const lb = data?.countriesLists?.find((item) => item.id === b)?.label ?? b;
      return la.localeCompare(lb, "ru");
    });

    listsChipsEl.innerHTML = ids
      .map((id) => {
        const item = data?.countriesLists?.find((entry) => entry.id === id);
        const label = item?.label ?? id;
        return `
          <span class="country-selector__chip">
            <span class="country-selector__chip-label">${escapeHtml(label)}</span>
            <button type="button" class="country-selector__chip-remove" data-remove-list="${escapeAttr(id)}" aria-label="Убрать ${escapeAttr(label)}" ${disabled ? "disabled" : ""}>×</button>
          </span>
        `;
      })
      .join("");
  }

  function renderCountriesDropdown() {
    if (!data?.countries?.length) {
      countriesListEl.innerHTML = `<div class="country-selector__empty">Список стран пуст</div>`;
      countriesHighlight = -1;
      return;
    }

    const filtered = getFilteredCountries();
    if (!filtered.length) {
      countriesListEl.innerHTML = `<div class="country-selector__empty">Ничего не найдено</div>`;
      countriesHighlight = -1;
      updateCountriesAllButton();
      return;
    }

    if (countriesHighlight >= filtered.length) countriesHighlight = filtered.length - 1;

    countriesListEl.innerHTML = filtered
      .map((item, index) => {
        const selected = !allCountriesSelected && selectedCountries.has(item.code);
        const highlighted = index === countriesHighlight;
        return `
          <button
            type="button"
            class="country-selector__dropdown-item${selected ? " country-selector__dropdown-item--selected" : ""}${highlighted ? " country-selector__dropdown-item--highlighted" : ""}"
            data-country="${escapeAttr(item.code)}"
            data-index="${index}"
            role="option"
            aria-selected="${selected}"
          >
            <span class="country-selector__dropdown-item-text">${escapeHtml(countryLabel(item))}</span>
            <span class="country-selector__dropdown-item-check" aria-hidden="true">✓</span>
          </button>
        `;
      })
      .join("");

    updateCountriesAllButton();
  }

  function renderListsDropdown() {
    if (!data?.countriesLists?.length) {
      listsListEl.innerHTML = `<div class="country-selector__empty">Список уровней пуст</div>`;
      listsHighlight = -1;
      return;
    }

    const filtered = getFilteredLists();
    if (!filtered.length) {
      listsListEl.innerHTML = `<div class="country-selector__empty">Ничего не найдено</div>`;
      listsHighlight = -1;
      return;
    }

    if (listsHighlight >= filtered.length) listsHighlight = filtered.length - 1;

    listsListEl.innerHTML = filtered
      .map((item, index) => {
        const selected = selectedLists.has(item.id);
        const highlighted = index === listsHighlight;
        return `
          <button
            type="button"
            class="country-selector__dropdown-item${selected ? " country-selector__dropdown-item--selected" : ""}${highlighted ? " country-selector__dropdown-item--highlighted" : ""}"
            data-list-id="${escapeAttr(item.id)}"
            data-index="${index}"
            role="option"
            aria-selected="${selected}"
          >
            <span class="country-selector__dropdown-item-text">${escapeHtml(item.label)}</span>
            <span class="country-selector__dropdown-item-check" aria-hidden="true">✓</span>
          </button>
        `;
      })
      .join("");
  }

  function updateCountriesAllButton() {
    const filtered = getFilteredCountries();
    const allHighlighted = countriesHighlight === filtered.length;
    countriesAllBtn.classList.toggle("country-selector__dropdown-all--selected", allCountriesSelected);
    countriesAllBtn.classList.toggle("country-selector__dropdown-all--highlighted", allHighlighted);
  }

  function renderCountriesUi() {
    renderCountryChips();
    if (openCombobox === "countries") renderCountriesDropdown();
  }

  function renderListsUi() {
    renderListChips();
    if (openCombobox === "lists") renderListsDropdown();
  }

  function setControlFocused(control, focused) {
    control.classList.toggle("country-selector__combobox-control--focused", focused);
    control.setAttribute("aria-expanded", focused ? "true" : "false");
  }

  // Dropdown рендерится как fixed-поповер от control, чтобы не обрезаться
  // секциями с overflow: hidden и быть поверх slide-over панели.
  let repositionHandler = null;

  function positionDropdown(kind) {
    const control = kind === "countries" ? countriesControl : listsControl;
    const dropdown = kind === "countries" ? countriesDropdown : listsDropdown;
    const rect = control.getBoundingClientRect();
    const margin = 4;
    dropdown.style.position = "fixed";
    dropdown.style.left = `${rect.left}px`;
    dropdown.style.width = `${rect.width}px`;
    dropdown.style.zIndex = "1000";
    dropdown.style.bottom = "auto";
    dropdown.style.top = `${rect.bottom + margin}px`;
    const dropdownHeight = dropdown.offsetHeight;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    if (spaceBelow < dropdownHeight + margin && spaceAbove > spaceBelow) {
      dropdown.style.top = `${Math.max(margin, rect.top - dropdownHeight - margin)}px`;
    }
  }

  function resetDropdownPosition(dropdown) {
    dropdown.style.position = "";
    dropdown.style.left = "";
    dropdown.style.top = "";
    dropdown.style.bottom = "";
    dropdown.style.width = "";
    dropdown.style.zIndex = "";
  }

  function attachReposition() {
    if (repositionHandler) return;
    repositionHandler = () => {
      if (openCombobox) positionDropdown(openCombobox);
    };
    window.addEventListener("scroll", repositionHandler, true);
    window.addEventListener("resize", repositionHandler);
  }

  function detachReposition() {
    if (!repositionHandler) return;
    window.removeEventListener("scroll", repositionHandler, true);
    window.removeEventListener("resize", repositionHandler);
    repositionHandler = null;
  }

  function openDropdown(kind) {
    if (disabled) return;
    openCombobox = kind;
    if (kind === "countries") {
      countriesHighlight = -1;
      renderCountriesDropdown();
      countriesDropdown.classList.remove("country-selector__dropdown--hidden");
      setControlFocused(countriesControl, true);
      positionDropdown("countries");
      countriesInput.focus();
    } else {
      listsHighlight = -1;
      renderListsDropdown();
      listsDropdown.classList.remove("country-selector__dropdown--hidden");
      setControlFocused(listsControl, true);
      positionDropdown("lists");
      listsInput.focus();
    }
    attachReposition();
  }

  function closeDropdown() {
    if (openCombobox === "countries") {
      countriesDropdown.classList.add("country-selector__dropdown--hidden");
      resetDropdownPosition(countriesDropdown);
      setControlFocused(countriesControl, false);
      countriesSearchQuery = "";
      countriesInput.value = "";
      countriesHighlight = -1;
    } else if (openCombobox === "lists") {
      listsDropdown.classList.add("country-selector__dropdown--hidden");
      resetDropdownPosition(listsDropdown);
      setControlFocused(listsControl, false);
      listsSearchQuery = "";
      listsInput.value = "";
      listsHighlight = -1;
    }
    detachReposition();
    openCombobox = null;
  }

  function toggleCountry(code) {
    const upper = String(code).toUpperCase();
    if (allCountriesSelected) {
      allCountriesSelected = false;
      selectedCountries = new Set([upper]);
    } else if (selectedCountries.has(upper)) {
      selectedCountries.delete(upper);
    } else {
      selectedCountries.add(upper);
    }
    renderCountriesUi();
    emitChange();
  }

  function selectAllCountries() {
    allCountriesSelected = true;
    selectedCountries.clear();
    renderCountriesUi();
    emitChange();
  }

  function clearAllCountries() {
    allCountriesSelected = false;
    renderCountriesUi();
    emitChange();
  }

  function toggleList(id) {
    const value = String(id);
    if (selectedLists.has(value)) selectedLists.delete(value);
    else selectedLists.add(value);
    renderListsUi();
    emitChange();
  }

  function moveHighlight(kind, delta) {
    if (kind === "countries") {
      const filtered = getFilteredCountries();
      const max = filtered.length;
      if (max === 0) {
        countriesHighlight = delta > 0 ? 0 : -1;
      } else if (countriesHighlight < 0) {
        countriesHighlight = delta > 0 ? 0 : max;
      } else {
        countriesHighlight += delta;
        if (countriesHighlight > max) countriesHighlight = 0;
        if (countriesHighlight < 0) countriesHighlight = max;
      }
      renderCountriesDropdown();
      if (countriesHighlight === max) {
        countriesAllBtn.scrollIntoView({ block: "nearest" });
      } else {
        scrollHighlightedIntoView(countriesListEl, countriesHighlight);
      }
    } else {
      const filtered = getFilteredLists();
      if (!filtered.length) {
        listsHighlight = -1;
        return;
      }
      if (listsHighlight < 0) listsHighlight = 0;
      else listsHighlight = Math.max(0, Math.min(filtered.length - 1, listsHighlight + delta));
      renderListsDropdown();
      scrollHighlightedIntoView(listsListEl, listsHighlight);
    }
  }

  function activateHighlight(kind) {
    if (kind === "countries") {
      const filtered = getFilteredCountries();
      if (countriesHighlight === filtered.length) {
        selectAllCountries();
        return;
      }
      if (countriesHighlight >= 0 && countriesHighlight < filtered.length) {
        toggleCountry(filtered[countriesHighlight].code);
      }
    } else {
      const filtered = getFilteredLists();
      if (listsHighlight >= 0 && listsHighlight < filtered.length) {
        toggleList(filtered[listsHighlight].id);
      }
    }
  }

  function scrollHighlightedIntoView(listEl, index) {
    if (index < 0) return;
    const item = listEl.querySelector(`[data-index="${index}"]`);
    item?.scrollIntoView({ block: "nearest" });
  }

  function syncMatchingRadios() {
    for (const radio of matchingRadios) {
      radio.checked = radio.value === matchingType;
    }
    updatePanelsVisibility();
  }

  for (const radio of matchingRadios) {
    radio.addEventListener("change", () => {
      if (!radio.checked) return;
      matchingType = radio.value;
      updatePanelsVisibility();
      emitChange();
    });
  }

  countriesControl.addEventListener("click", (event) => {
    if (disabled) return;
    if (event.target.closest(".country-selector__chip-remove")) return;
    if (openCombobox !== "countries") openDropdown("countries");
    else countriesInput.focus();
  });

  listsControl.addEventListener("click", (event) => {
    if (disabled) return;
    if (event.target.closest(".country-selector__chip-remove")) return;
    if (openCombobox !== "lists") openDropdown("lists");
    else listsInput.focus();
  });

  countriesInput.addEventListener("input", () => {
    countriesSearchQuery = countriesInput.value;
    countriesHighlight = -1;
    if (openCombobox !== "countries") openDropdown("countries");
    else {
      renderCountriesDropdown();
      positionDropdown("countries");
    }
  });

  listsInput.addEventListener("input", () => {
    listsSearchQuery = listsInput.value;
    listsHighlight = -1;
    if (openCombobox !== "lists") openDropdown("lists");
    else {
      renderListsDropdown();
      positionDropdown("lists");
    }
  });

  countriesInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeDropdown();
      countriesControl.focus();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      if (openCombobox !== "countries") openDropdown("countries");
      moveHighlight("countries", 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (openCombobox !== "countries") openDropdown("countries");
      moveHighlight("countries", -1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      activateHighlight("countries");
    }
  });

  listsInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeDropdown();
      listsControl.focus();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      if (openCombobox !== "lists") openDropdown("lists");
      moveHighlight("lists", 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (openCombobox !== "lists") openDropdown("lists");
      moveHighlight("lists", -1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      activateHighlight("lists");
    }
  });

  countriesListEl.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-country]");
    if (!btn) return;
    toggleCountry(btn.getAttribute("data-country"));
  });

  listsListEl.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-list-id]");
    if (!btn) return;
    toggleList(btn.getAttribute("data-list-id"));
  });

  countriesAllBtn.addEventListener("click", () => {
    if (disabled) return;
    selectAllCountries();
  });

  countriesChipsEl.addEventListener("click", (event) => {
    const removeAll = event.target.closest("[data-remove-all]");
    if (removeAll) {
      event.stopPropagation();
      clearAllCountries();
      return;
    }
    const removeBtn = event.target.closest("[data-remove-country]");
    if (!removeBtn) return;
    event.stopPropagation();
    toggleCountry(removeBtn.getAttribute("data-remove-country"));
  });

  listsChipsEl.addEventListener("click", (event) => {
    const removeBtn = event.target.closest("[data-remove-list]");
    if (!removeBtn) return;
    event.stopPropagation();
    toggleList(removeBtn.getAttribute("data-remove-list"));
  });

  document.addEventListener("mousedown", onDocumentMouseDown);
  container.addEventListener("keydown", onContainerKeyDown);

  function onDocumentMouseDown(event) {
    if (!openCombobox) return;
    const combobox = openCombobox === "countries" ? countriesCombobox : listsCombobox;
    if (!combobox.contains(event.target)) closeDropdown();
  }

  function onContainerKeyDown(event) {
    if (event.key === "Escape" && openCombobox) {
      event.preventDefault();
      closeDropdown();
    }
  }

  function setMode(nextMode) {
    mode = nextMode;
    const isFallback = nextMode === "fallback";
    const isLoading = nextMode === "loading";
    root.classList.toggle("country-selector--fallback", isFallback);
    // В fallback показываем тот же combobox-UI (список пуст) + поясняющее сообщение,
    // вместо сырого JSON. UI скрыт только во время загрузки.
    uiEl.classList.toggle("country-selector__ui--hidden", isLoading);
    noticeEl.classList.toggle("country-selector__notice--hidden", !isFallback);
    setLoading(isLoading);
    if (isLoading) closeDropdown();
    syncMatchingRadios();
    renderCountriesUi();
    renderListsUi();
  }

  function setData(nextData) {
    data = nextData;
    renderCountriesUi();
    renderListsUi();
  }

  function setValue({ matchingType: mt, countries = [], countriesLists = [] } = {}) {
    matchingType =
      COUNTRIES_MATCHING_TYPES.some((item) => item.id === mt) ? mt : "countries";

    const countryCodes = (countries || [])
      .map((item) => String(item ?? "").trim())
      .filter(Boolean);
    const normalized = countryCodes.map((code) => code.toUpperCase());
    allCountriesSelected =
      normalized.length > 0 && normalized.every((code) => code === "ALL");
    selectedCountries = new Set(
      allCountriesSelected
        ? []
        : normalized.filter((code) => code !== "ALL").map((code) => {
            const known = getCountryByCode(code);
            return known?.code || code;
          })
    );
    selectedLists = new Set((countriesLists || []).map(String));

    syncMatchingRadios();
    renderCountriesUi();
    renderListsUi();
  }

  function getValue() {
    return {
      matchingType,
      countries: allCountriesSelected ? ["all"] : [...selectedCountries],
      countriesLists: [...selectedLists],
    };
  }

  function setDisabled(nextDisabled) {
    disabled = nextDisabled;
    for (const el of root.querySelectorAll("input, textarea, select, button")) {
      el.disabled = nextDisabled;
    }
    countriesControl.classList.toggle("country-selector__combobox-control--disabled", nextDisabled);
    listsControl.classList.toggle("country-selector__combobox-control--disabled", nextDisabled);
    if (nextDisabled) closeDropdown();
  }

  setMode("loading");

  if (initial.matchingType || initial.countries?.length || initial.countriesLists?.length) {
    setValue(initial);
  }

  const api = {
    setData,
    setMode,
    setValue,
    getValue,
    setDisabled,
    destroy() {
      detachReposition();
      document.removeEventListener("mousedown", onDocumentMouseDown);
      container.removeEventListener("keydown", onContainerKeyDown);
    },
  };

  return api;
}

export { CONSTANTS_API_PATH, FIXTURE_PATH, CACHE_TTL_MS };
