/**
 * Универсальный multi-select combobox с chips, поиском и галочками.
 */

/**
 * @typedef {object} MultiComboboxOption
 * @property {string} value
 * @property {string} label
 */

/**
 * @typedef {object} MultiComboboxConfig
 * @property {MultiComboboxOption[]} options
 * @property {string[]} [value]
 * @property {string} [placeholder]
 * @property {string} [searchPlaceholder]
 * @property {boolean} [allowAll]
 * @property {string} [allLabel]
 * @property {boolean} [disabled]
 * @property {boolean} [remoteSearch]
 * @property {number} [searchDebounceMs]
 * @property {number} [minSearchLength]
 * @property {(query: string) => void | Promise<Array<{ value: string, label: string }> | void>}
 * @property {() => void} [onSearchStart]
 * @property {() => void} [onSearchEnd]
 * @property {(value: string[]) => void} [onChange]
 */

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function escapeHtml(value) {
  return escapeAttr(value).replace(/>/g, "&gt;");
}

/**
 * @param {HTMLElement} container
 * @param {MultiComboboxConfig} config
 */
export function mountMultiCombobox(container, config) {
  if (!container) throw new Error("mountMultiCombobox: container is required");

  /** @type {MultiComboboxOption[]} */
  let options = [...(config.options || [])];
  /** @type {Set<string>} */
  let selected = new Set((config.value || []).map(String));
  let allSelected = false;
  let searchQuery = "";
  let dropdownOpen = false;
  let highlightIndex = -1;
  let disabled = !!config.disabled;
  const placeholder = config.placeholder || "Выберите…";
  const searchPlaceholder = config.searchPlaceholder || "Поиск…";
  const allowAll = !!config.allowAll;
  const allLabel = config.allLabel || "Все";
  const remoteSearch = !!config.remoteSearch;
  const searchDebounceMs = Number.isFinite(config.searchDebounceMs) ? config.searchDebounceMs : 300;
  const minSearchLength = Number.isFinite(config.minSearchLength) ? config.minSearchLength : 0;
  let searchTimer = null;
  let searchSeq = 0;
  let searchLoading = false;

  const uid = `mc-${Math.random().toString(36).slice(2, 9)}`;

  container.innerHTML = `
    <div class="multi-combobox" data-multi-combobox="${uid}">
      <div class="multi-combobox__control" tabindex="0" role="combobox" aria-expanded="false" aria-haspopup="listbox">
        <div class="multi-combobox__chips" data-chips></div>
        <input
          type="text"
          class="multi-combobox__input"
          data-input
          placeholder="${escapeAttr(placeholder)}"
          autocomplete="off"
          aria-autocomplete="list"
        />
      </div>
      <div class="multi-combobox__dropdown multi-combobox__dropdown--hidden" data-dropdown>
        <div class="multi-combobox__list" data-list role="listbox" aria-multiselectable="true"></div>
        ${allowAll ? `<div class="multi-combobox__divider"></div><button type="button" class="multi-combobox__all-btn" data-all>${escapeHtml(allLabel)}</button>` : ""}
      </div>
    </div>
  `;

  const root = container.querySelector("[data-multi-combobox]");
  const control = root.querySelector(".multi-combobox__control");
  const chipsEl = root.querySelector("[data-chips]");
  const input = root.querySelector("[data-input]");
  const dropdown = root.querySelector("[data-dropdown]");
  const listEl = root.querySelector("[data-list]");
  const allBtn = root.querySelector("[data-all]");

  function emitChange() {
    config.onChange?.(getValue());
  }

  function getOption(value) {
    return options.find((item) => item.value === String(value)) ?? null;
  }

  function getFilteredOptions() {
    if (remoteSearch) return options;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (item) =>
        item.value.toLowerCase().includes(q) || item.label.toLowerCase().includes(q)
    );
  }

  function mergeOptionsWithSelected(nextOptions) {
    const merged = new Map((nextOptions || []).map((item) => [String(item.value), item]));
    for (const value of selected) {
      const key = String(value);
      if (!merged.has(key)) {
        const existing = getOption(key);
        merged.set(key, existing || { value: key, label: key });
      }
    }
    return [...merged.values()];
  }

  function setSearchLoading(next) {
    searchLoading = !!next;
    if (!dropdownOpen) return;
    renderDropdown();
    positionDropdown();
  }

  function scheduleRemoteSearch(query) {
    if (!remoteSearch || typeof config.onSearch !== "function") return;
    const q = String(query || "").trim();
    const seq = ++searchSeq;
    clearTimeout(searchTimer);
    if (q.length >= minSearchLength) {
      setSearchLoading(true);
    }
    searchTimer = setTimeout(async () => {
      if (q.length < minSearchLength) {
        if (seq !== searchSeq) return;
        setOptions(mergeOptionsWithSelected([]));
        setSearchLoading(false);
        config.onSearchEnd?.();
        if (dropdownOpen) {
          renderDropdown();
          positionDropdown();
        }
        return;
      }
      setSearchLoading(true);
      config.onSearchStart?.();
      try {
        const result = await config.onSearch(q);
        if (seq !== searchSeq) return;
        if (Array.isArray(result)) {
          setOptions(
            mergeOptionsWithSelected(
              result.map((item) => ({
                value: String(item.value),
                label: String(item.label ?? item.value),
              }))
            )
          );
        }
      } catch {
        if (seq !== searchSeq) return;
      } finally {
        if (seq === searchSeq) {
          setSearchLoading(false);
          config.onSearchEnd?.();
          if (dropdownOpen) {
            renderDropdown();
            positionDropdown();
          }
        }
      }
    }, searchDebounceMs);
  }

  function getValue() {
    if (allSelected) return ["all"];
    return [...selected];
  }

  function setValue(values) {
    const list = Array.isArray(values) ? values.map(String) : [];
    if (allowAll && list.includes("all")) {
      allSelected = true;
      selected.clear();
    } else {
      allSelected = false;
      selected = new Set(list);
    }
    renderChips();
    if (dropdownOpen) renderDropdown();
  }

  function setOptions(nextOptions) {
    options = [...(nextOptions || [])];
    const valid = new Set(options.map((item) => item.value));
    if (!allSelected) {
      selected = new Set([...selected].filter((value) => valid.has(value)));
    }
    renderChips();
    if (dropdownOpen) renderDropdown();
  }

  function setDisabled(nextDisabled) {
    disabled = !!nextDisabled;
    input.disabled = disabled;
    control.classList.toggle("multi-combobox__control--disabled", disabled);
    if (disabled) closeDropdown();
    renderChips();
  }

  function renderChips() {
    if (allSelected) {
      chipsEl.innerHTML = `
        <span class="multi-combobox__chip multi-combobox__chip--all">
          <span class="multi-combobox__chip-label">${escapeHtml(allLabel)}</span>
          <button type="button" class="multi-combobox__chip-remove" data-remove-all aria-label="Убрать «${escapeAttr(allLabel)}»" ${disabled ? "disabled" : ""}>×</button>
        </span>
      `;
      input.placeholder = "";
      return;
    }

    const values = [...selected].sort((a, b) => {
      const la = getOption(a)?.label ?? a;
      const lb = getOption(b)?.label ?? b;
      return la.localeCompare(lb, "ru");
    });

    chipsEl.innerHTML = values
      .map((value) => {
        const opt = getOption(value);
        const label = opt?.label ?? value;
        return `
          <span class="multi-combobox__chip">
            <span class="multi-combobox__chip-label">${escapeHtml(label)}</span>
            <button type="button" class="multi-combobox__chip-remove" data-remove="${escapeAttr(value)}" aria-label="Убрать ${escapeAttr(label)}" ${disabled ? "disabled" : ""}>×</button>
          </span>
        `;
      })
      .join("");

    input.placeholder = values.length ? "" : placeholder;
  }

  function updateAllButton() {
    if (!allBtn) return;
    const filtered = getFilteredOptions();
    const allHighlighted = highlightIndex === filtered.length;
    allBtn.classList.toggle("multi-combobox__all-btn--selected", allSelected);
    allBtn.classList.toggle("multi-combobox__all-btn--highlighted", allHighlighted);
  }

  function renderDropdown() {
    if (searchLoading) {
      listEl.innerHTML = `<div class="multi-combobox__empty">Загрузка…</div>`;
      highlightIndex = -1;
      updateAllButton();
      return;
    }

    if (!options.length) {
      const emptyText = remoteSearch && searchQuery.trim().length < minSearchLength
        ? `Введите минимум ${minSearchLength} символа`
        : "Список пуст";
      listEl.innerHTML = `<div class="multi-combobox__empty">${escapeHtml(emptyText)}</div>`;
      highlightIndex = -1;
      updateAllButton();
      return;
    }

    const filtered = getFilteredOptions();
    if (!filtered.length) {
      listEl.innerHTML = `<div class="multi-combobox__empty">Ничего не найдено</div>`;
      highlightIndex = -1;
      updateAllButton();
      return;
    }

    if (highlightIndex >= filtered.length) highlightIndex = filtered.length - 1;

    listEl.innerHTML = filtered
      .map((item, index) => {
        const isSelected = !allSelected && selected.has(item.value);
        const highlighted = index === highlightIndex;
        return `
          <button
            type="button"
            class="multi-combobox__item${isSelected ? " multi-combobox__item--selected" : ""}${highlighted ? " multi-combobox__item--highlighted" : ""}"
            data-value="${escapeAttr(item.value)}"
            data-index="${index}"
            role="option"
            aria-selected="${isSelected}"
          >
            <span class="multi-combobox__item-text">${escapeHtml(item.label)}</span>
            <span class="multi-combobox__item-check" aria-hidden="true">✓</span>
          </button>
        `;
      })
      .join("");

    updateAllButton();
  }

  function setFocused(focused) {
    control.classList.toggle("multi-combobox__control--focused", focused);
    control.setAttribute("aria-expanded", focused ? "true" : "false");
  }

  // Dropdown рендерится как fixed-поповер от control, чтобы не обрезаться
  // секциями с overflow: hidden и быть поверх slide-over панели.
  let repositionHandler = null;

  function positionDropdown() {
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

  function resetDropdownPosition() {
    dropdown.style.position = "";
    dropdown.style.left = "";
    dropdown.style.top = "";
    dropdown.style.bottom = "";
    dropdown.style.width = "";
    dropdown.style.zIndex = "";
  }

  function attachReposition() {
    if (repositionHandler) return;
    repositionHandler = () => positionDropdown();
    window.addEventListener("scroll", repositionHandler, true);
    window.addEventListener("resize", repositionHandler);
  }

  function detachReposition() {
    if (!repositionHandler) return;
    window.removeEventListener("scroll", repositionHandler, true);
    window.removeEventListener("resize", repositionHandler);
    repositionHandler = null;
  }

  function openDropdown() {
    if (disabled) return;
    dropdownOpen = true;
    highlightIndex = -1;
    input.placeholder = searchPlaceholder;
    if (remoteSearch) scheduleRemoteSearch(searchQuery);
    renderDropdown();
    dropdown.classList.remove("multi-combobox__dropdown--hidden");
    setFocused(true);
    positionDropdown();
    attachReposition();
    input.focus();
  }

  function closeDropdown() {
    dropdownOpen = false;
    dropdown.classList.add("multi-combobox__dropdown--hidden");
    detachReposition();
    resetDropdownPosition();
    setFocused(false);
    searchQuery = "";
    input.value = "";
    highlightIndex = -1;
    clearTimeout(searchTimer);
    searchSeq += 1;
    setSearchLoading(false);
    renderChips();
  }

  function toggleValue(value) {
    const key = String(value);
    if (allSelected) {
      allSelected = false;
      selected = new Set([key]);
    } else if (selected.has(key)) {
      selected.delete(key);
    } else {
      selected.add(key);
    }
    renderChips();
    if (dropdownOpen) renderDropdown();
    emitChange();
  }

  function selectAll() {
    allSelected = true;
    selected.clear();
    renderChips();
    if (dropdownOpen) renderDropdown();
    emitChange();
  }

  function removeValue(value) {
    if (value === "all" || allSelected) {
      allSelected = false;
    } else {
      selected.delete(String(value));
    }
    renderChips();
    if (dropdownOpen) renderDropdown();
    emitChange();
  }

  function activateHighlighted() {
    const filtered = getFilteredOptions();
    if (allowAll && highlightIndex === filtered.length) {
      selectAll();
      return;
    }
    const item = filtered[highlightIndex];
    if (item) toggleValue(item.value);
  }

  function moveHighlight(delta) {
    const filtered = getFilteredOptions();
    const max = filtered.length + (allowAll ? 1 : 0) - 1;
    if (!filtered.length && !allowAll) return;
    if (highlightIndex < 0) {
      highlightIndex = delta > 0 ? 0 : max;
    } else {
      highlightIndex = Math.max(0, Math.min(max, highlightIndex + delta));
    }
    renderDropdown();
    const highlighted = listEl.querySelector(".multi-combobox__item--highlighted");
    highlighted?.scrollIntoView({ block: "nearest" });
  }

  control.addEventListener("click", (event) => {
    if (disabled) return;
    if (event.target.closest(".multi-combobox__chip-remove")) return;
    if (!dropdownOpen) openDropdown();
  });

  control.addEventListener("focus", () => {
    if (!dropdownOpen && !disabled) openDropdown();
  });

  input.addEventListener("input", () => {
    searchQuery = input.value;
    highlightIndex = -1;
    if (!dropdownOpen) openDropdown();
    else if (remoteSearch) {
      scheduleRemoteSearch(searchQuery);
      renderDropdown();
      positionDropdown();
    } else {
      renderDropdown();
      positionDropdown();
    }
  });

  input.addEventListener("keydown", (event) => {
    if (disabled) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeDropdown();
      control.blur();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!dropdownOpen) openDropdown();
      else moveHighlight(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!dropdownOpen) openDropdown();
      else moveHighlight(-1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (!dropdownOpen) openDropdown();
      else activateHighlighted();
      return;
    }
    if (event.key === "Backspace" && !input.value) {
      if (allSelected) {
        removeValue("all");
      } else if (selected.size) {
        const last = [...selected].pop();
        if (last) removeValue(last);
      }
    }
  });

  chipsEl.addEventListener("click", (event) => {
    const removeAll = event.target.closest("[data-remove-all]");
    if (removeAll) {
      event.stopPropagation();
      removeValue("all");
      return;
    }
    const removeBtn = event.target.closest("[data-remove]");
    if (removeBtn) {
      event.stopPropagation();
      removeValue(removeBtn.getAttribute("data-remove"));
    }
  });

  listEl.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-value]");
    if (!btn) return;
    toggleValue(btn.getAttribute("data-value"));
  });

  allBtn?.addEventListener("click", () => selectAll());

  document.addEventListener("mousedown", (event) => {
    if (!root.contains(event.target)) closeDropdown();
  });

  setValue(config.value || []);
  setDisabled(disabled);

  return {
    getValue,
    setValue,
    setOptions,
    setDisabled,
    destroy: () => {
      clearTimeout(searchTimer);
      detachReposition();
      container.innerHTML = "";
    },
  };
}
