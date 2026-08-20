import { PAGE_SIZE } from "../shared/constants.js";
import {
  fillDomainSelect,
  ensureDefaultDomainsInStorage,
  loadDomainsFromStorage,
  normalizeDomainOrEmpty,
} from "../shared/domains.js";
import { apiFetch, apiFetchResult, API_REQUEST_TIMEOUT_MS, resolveAdminTab, withTimeout } from "../shared/api.js";
import { ensureAuthenticated, formatDomainAuthLabel, isAuthError, isAuthModalOpen, isDomainAuthenticated, mountAuthModal, queryDomainAuthStatus, resetAuthModalForDomainSwitch } from "../shared/auth-modal.js";
import { escapeHtml, formatCardDate } from "../shared/format.js";
import { loadConditionsSchema } from "../shared/conditions-schema.js";
import { setConditionsLabelSchema } from "../shared/labels-ru.js";
import { loadChainsLayout, saveChainsLayout, getDomainCanvasTemplates, upsertDomainCanvasTemplate, deleteDomainCanvasTemplate } from "../shared/storage.js";
import { mountCopyPanel } from "../shared/copy-panel.js";
import {
  cloneJson,
  buildPatchPayload,
  boolValue,
  isVisibleTaskState,
  taskFromResponse,
  taskListFromResponse,
  resolveCreatedTaskId,
} from "../shared/tasks.js";
import { ACTION_LABELS } from "../shared/actions-schema.js";
import {
  buildReportsPayload,
  computeMetrics,
  extractReportCountAll,
  extractReportsProjects,
  formatMetricNumber,
  formatReportsFetchError,
  inferProjectIdFromDomain,
  normalizeProjectId,
  normalizeReportRows,
  reportTaskNamesMatch,
} from "../shared/reports.js";
import { getTaskChartsMarkup, groupStatsRowsByTask, mountTaskCharts } from "../shared/stats-charts.js";
const CARD_W = 220;
const CARD_H = 110;
const CARD_MIN_H = CARD_H;
const VERTICAL_GAP = 32;
const COL_GAP = 70;
const GRID_COLS = 4;
const GRID_GAP_X = 40;
const GRID_GAP_Y = 30;
const GRID_START_X = 40;
const GRID_START_Y = 40;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2.0;
const ZOOM_STEP = 1.08;

const DEFAULT_GT_CONFIG = {
  type: "enabled",
  extra_type: "or",
  only_completed: true,
};

/** Пресеты цвета шапки карточки (id → метаданные для UI). */
const CARD_HEADER_COLORS = {
  green: { label: "Зелёный" },
  orange: { label: "Оранжевый" },
  purple: { label: "Фиолетовый" },
  red: { label: "Красный" },
  teal: { label: "Бирюзовый" },
  gray: { label: "Серый" },
  pink: { label: "Розовый" },
  amber: { label: "Янтарный" },
};

const state = {
  domains: [],
  selectedDomain: "",
  selectedTabId: null,
  catalog: new Map(),
  listChecked: new Set(),
  canvas: new Map(),
  edges: [],
  targetConfigs: new Map(),
  dirtyTargets: new Set(),
  offset: 0,
  hasMore: false,
  loading: false,
  linkSourceId: null,
  selectedEdgeKey: null,
  selectedTargetId: null,
  drag: null,
  suppressCardClick: false,
  pan: null,
  panMoved: false,
  canvasSelected: new Set(),
  marquee: null,
  catalogFilterTerms: [],
  catalogStatusFilter: "all",
  catalogHiddenByState: 0,
  viewport: { x: 0, y: 0, scale: 1 },
  checkBlocks: false,
  blockConflicts: [],
  blockConflictTaskIds: new Set(),
  labels: [],
  selectedLabelId: null,
  currentMainView: "canvas",
  statsRows: [],
  statsPayload: null,
  statsLoading: false,
  statsError: "",
  statsTaskOnly: false,
  statsUpdatedAt: "",
  statsReportCountAll: null,
  statsProjectId: "",
  statsProjects: [],
  statsProjectsLoading: false,
  statsProjectsLoaded: false,
  statsProjectsError: "",
  statsFetchSeq: 0,
  statsActiveFetchSeq: 0,
  statsFetchDebounceTimer: null,
};

const $ = (id) => document.getElementById(id);

let copyPanel = null;
let copyPanelSourceId = null;
let copyPanelMode = "copy";
/** @type {string|null} целевой домен для копирования на другой проект */
let copyCrossDomainTarget = null;
/** @type {string|null} id задачи для модалки «Скопировать на другой проект» */
let copyToProjectTaskId = null;
/** @type {"task"|"template"} режим модалки копирования на другой проект */
let copyToProjectMode = "task";
/** @type {string|null} id сохранённого шаблона для копирования на другой проект */
let copyToProjectTemplateId = null;
/** @type {string|null} локальный черновик, который сохраняем на бэк через «Создать» */
let promotingLocalDraftId = null;
let contextMenuTaskId = null;
let canvasContextMenuPoint = null;
let viewportAnimation = null;
let catalogFocusFlashTimer = null;
let canvasCardHighlightTimer = null;
let toastDismissTimer = null;
let sidePanelCloseTimer = null;
let copyPanelCloseTimer = null;

function prefersReducedMotion() {
  return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

function setButtonLoading(id, loading) {
  const btn = $(id);
  if (!btn) return;
  btn.classList.toggle("is-loading", !!loading);
  if (loading) btn.setAttribute("aria-busy", "true");
  else btn.removeAttribute("aria-busy");
}

function renderCatalogSkeleton(rows = 9) {
  const list = $("catalog-list");
  if (!list) return;
  list.innerHTML = "";
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < rows; i += 1) {
    const li = document.createElement("li");
    li.className = "catalog-skeleton";
    li.innerHTML = `
      <div class="skeleton-line skeleton-line--id"></div>
      <div class="skeleton-line skeleton-line--name"></div>
      <div class="skeleton-line skeleton-line--fi"></div>
    `;
    fragment.appendChild(li);
  }
  list.appendChild(fragment);
}

function showCanvasLoading(text) {
  const el = $("canvas-loading");
  if (!el) return;
  if (text) $("canvas-loading-text").textContent = text;
  el.classList.remove("canvas-loading--hidden");
  el.setAttribute("aria-hidden", "false");
}

function hideCanvasLoading() {
  const el = $("canvas-loading");
  if (!el) return;
  el.classList.add("canvas-loading--hidden");
  el.setAttribute("aria-hidden", "true");
}

function setStatus(text, isError = false) {
  const el = $("status");
  el.textContent = text;
  el.classList.toggle("status--error", !!isError);
}

function showToast(message, { type = "success", durationMs = 4500 } = {}) {
  const host = $("chains-toast-host");
  if (!host || !message) return;

  if (toastDismissTimer) {
    clearTimeout(toastDismissTimer);
    toastDismissTimer = null;
  }

  host.replaceChildren();
  const toast = document.createElement("div");
  toast.className = `chains-toast chains-toast--${type}`;
  toast.setAttribute("role", "status");

  const icon = document.createElement("span");
  icon.className = "material-symbols-outlined chains-toast__icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent =
    type === "success" ? "check_circle" : type === "warning" ? "warning" : "info";

  const text = document.createElement("span");
  text.className = "chains-toast__text";
  text.textContent = message;

  toast.append(icon, text);
  host.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("chains-toast--visible"));

  toastDismissTimer = window.setTimeout(() => {
    toast.classList.remove("chains-toast--visible");
    toast.addEventListener(
      "transitionend",
      () => {
        toast.remove();
        if (!host.childElementCount) toastDismissTimer = null;
      },
      { once: true }
    );
    toastDismissTimer = null;
  }, durationMs);
}

function edgeKey(from, to) {
  return `${from}->${to}`;
}

function parseEdgeKey(key) {
  const [from, to] = String(key).split("->");
  return { from, to };
}

function defaultGtConfig() {
  return { ...DEFAULT_GT_CONFIG };
}

function getGtBlock(conditions) {
  if (!Array.isArray(conditions)) return null;
  for (const item of conditions) {
    if (item && item.gamification_tasks) return item.gamification_tasks;
  }
  return null;
}

function mergeGamificationTasks(conditions, gtValue) {
  const next = Array.isArray(conditions) ? conditions.map((item) => cloneJson(item)) : [];
  const idx = next.findIndex((item) => item && item.gamification_tasks);

  const hasList = gtValue && Array.isArray(gtValue.list) && gtValue.list.length > 0;
  if (hasList) {
    const block = { gamification_tasks: cloneJson(gtValue) };
    if (idx >= 0) next[idx] = block;
    else next.push(block);
  } else if (idx >= 0) {
    next.splice(idx, 1);
  }
  return next;
}

function buildGtValueForTarget(targetId) {
  const targetKey = String(targetId);
  const edgeSources = state.edges.filter((e) => e.to === targetKey).map((e) => e.from);
  const task = state.canvas.get(targetKey);
  const gt = getGtBlock(task?.conditions);
  const conditionList = Array.isArray(gt?.list) ? gt.list.map((id) => String(id)) : [];
  const offCanvasPreserved = conditionList.filter((id) => !state.canvas.has(id));
  const sources = [...new Set([...edgeSources, ...offCanvasPreserved])];
  const cfg = state.targetConfigs.get(targetKey) || defaultGtConfig();
  return {
    list: sources.sort((a, b) => Number(a) - Number(b)),
    type: cfg.type || "enabled",
    extra_type: cfg.extra_type || "or",
    only_completed: cfg.only_completed !== false,
  };
}

function syncTargetConfigList(targetId) {
  const gt = buildGtValueForTarget(targetId);
  if (gt.list.length) {
    const existing = state.targetConfigs.get(targetId) || defaultGtConfig();
    state.targetConfigs.set(targetId, { ...existing, ...gt, list: gt.list });
  }
}

function syncLocalConditionsFromEdges(targetId) {
  const task = state.canvas.get(String(targetId));
  if (!task) return;
  const gtValue = buildGtValueForTarget(targetId);
  task.conditions = mergeGamificationTasks(
    task.conditions || [],
    gtValue.list.length ? gtValue : null
  );
}

function refreshGraphVisuals(targetIds = []) {
  const ids = [...new Set((Array.isArray(targetIds) ? targetIds : [targetIds]).map(String))].filter(
    Boolean
  );
  for (const id of ids) syncLocalConditionsFromEdges(id);
  renderCards();
}

function markDirtyTarget(targetId) {
  if (targetId) state.dirtyTargets.add(String(targetId));
  updateSaveButton();
}

function updateSaveButton() {
  $("btn-save").disabled = state.dirtyTargets.size === 0 || state.loading;
}

function catalogMatchesStatusFilter(meta) {
  if (state.catalogStatusFilter === "all") return true;
  return meta.state === state.catalogStatusFilter;
}

function getCatalogCountByStatusFilter() {
  if (state.catalogStatusFilter === "all") return state.catalog.size;
  let count = 0;
  for (const meta of state.catalog.values()) {
    if (catalogMatchesStatusFilter(meta)) count += 1;
  }
  return count;
}

function updateCounters() {
  const hidden = state.catalogHiddenByState;
  const hiddenNote = hidden > 0 ? ` / ${hidden} скрыто` : "";
  $("tasks-count").textContent = `${getCatalogCountByStatusFilter()} задач${hiddenNote}`;
  $("tasks-filter-hint")?.classList.remove("meta--hidden");
  $("canvas-counter").textContent = `${state.canvas.size} из ${state.catalog.size}`;
  $("canvas-empty")?.classList.toggle(
    "canvas-empty--hidden",
    state.canvas.size > 0 || state.labels.length > 0
  );
  const alignBtn = $("btn-align");
  if (alignBtn) alignBtn.disabled = state.canvas.size === 0;
  const fitBtn = $("btn-zoom-fit");
  if (fitBtn) fitBtn.disabled = state.canvas.size === 0 && state.labels.length === 0;
  const saveTemplateBtn = $("btn-save-template");
  if (saveTemplateBtn) saveTemplateBtn.disabled = state.canvas.size === 0 || state.loading;
  updateCanvasSelectionUI();
}

function showCatalogPanel() {
  const panel = $("catalog-panel");
  panel.classList.remove("catalog-panel--hidden");
  const toggle = $("btn-toggle-catalog");
  if (toggle) toggle.disabled = false;
  setCatalogCollapsed(panel.classList.contains("catalog-panel--collapsed"));
}

function parseCatalogSearchTerms(raw) {
  return String(raw || "")
    .split(/[\n\r,\t]+/)
    .map((term) => term.trim())
    .filter(Boolean);
}

function getActiveCatalogFilterTerms() {
  const pending = $("catalog-search-input")?.value.trim() || "";
  if (!pending) return state.catalogFilterTerms;
  return [...state.catalogFilterTerms, pending];
}

function catalogMatchesFilter(meta) {
  const terms = getActiveCatalogFilterTerms();
  if (!terms.length) return true;
  const hay = `${meta.id} ${meta.name || ""} ${meta.frontend_identifier || ""}`.toLowerCase();
  return terms.some((term) => hay.includes(term.toLowerCase()));
}

function addCatalogSearchTerms(rawTerms) {
  const parsed = Array.isArray(rawTerms) ? rawTerms : parseCatalogSearchTerms(rawTerms);
  for (const term of parsed) {
    if (!state.catalogFilterTerms.includes(term)) {
      state.catalogFilterTerms.push(term);
    }
  }
}

function removeCatalogSearchTerm(index) {
  state.catalogFilterTerms.splice(index, 1);
  renderCatalogSearchChips();
  renderTaskList();
}

function commitCatalogSearchInput() {
  const input = $("catalog-search-input");
  if (!input?.value.trim()) return;
  addCatalogSearchTerms(input.value);
  input.value = "";
  renderCatalogSearchChips();
  renderTaskList();
}

function renderCatalogSearchChips() {
  const container = $("catalog-search");
  const input = $("catalog-search-input");
  if (!container || !input) return;

  container.querySelectorAll(".catalog-search__chip").forEach((el) => el.remove());

  const fragment = document.createDocumentFragment();
  state.catalogFilterTerms.forEach((term, index) => {
    const chip = document.createElement("span");
    chip.className = "catalog-search__chip";

    const text = document.createElement("span");
    text.className = "catalog-search__chip-text";
    text.textContent = term;
    text.title = term;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "catalog-search__chip-remove";
    btn.setAttribute("aria-label", `Удалить «${term}»`);
    btn.textContent = "×";
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      removeCatalogSearchTerm(index);
    });

    chip.append(text, btn);
    fragment.appendChild(chip);
  });

  container.insertBefore(fragment, input);
}

function initCatalogSearch() {
  const container = $("catalog-search");
  const input = $("catalog-search-input");
  if (!container || !input) return;

  container.addEventListener("click", (ev) => {
    if (ev.target !== input) input.focus();
  });

  input.addEventListener("input", () => {
    renderTaskList();
  });

  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Backspace" && !input.value && state.catalogFilterTerms.length) {
      ev.preventDefault();
      removeCatalogSearchTerm(state.catalogFilterTerms.length - 1);
      return;
    }
    if (ev.key === "Enter") {
      ev.preventDefault();
      commitCatalogSearchInput();
      return;
    }
    if (ev.key === ",") {
      ev.preventDefault();
      commitCatalogSearchInput();
    }
  });

  input.addEventListener("paste", (ev) => {
    const text = ev.clipboardData?.getData("text") || "";
    const terms = parseCatalogSearchTerms(text);
    if (terms.length > 1 || /[\n\r,\t]/.test(text)) {
      ev.preventDefault();
      addCatalogSearchTerms(terms);
      input.value = "";
      renderCatalogSearchChips();
      renderTaskList();
    }
  });
}

function getVisibleCatalogIds() {
  return [...state.catalog.keys()].filter((id) => {
    const meta = state.catalog.get(id);
    return catalogMatchesFilter(meta) && catalogMatchesStatusFilter(meta);
  });
}

function updateAddToCanvasButton() {
  const hasNewSelection = [...state.listChecked].some((id) => !state.canvas.has(id));
  $("btn-add-to-canvas").disabled = state.loading || !hasNewSelection;
}

function renderTaskList() {
  const list = $("catalog-list");
  list.innerHTML = "";
  const visibleIds = getVisibleCatalogIds();

  if (!visibleIds.length) {
    const empty = document.createElement("li");
    empty.className = "catalog-list__empty";
    empty.textContent = state.catalog.size
      ? "Ничего не найдено по фильтру"
      : "Список пуст — загрузите задачи";
    list.appendChild(empty);
    updateAddToCanvasButton();
    return;
  }

  for (const id of visibleIds) {
    const meta = state.catalog.get(id);
    const onCanvas = state.canvas.has(id);
    const checked = onCanvas ? state.canvasSelected.has(id) : state.listChecked.has(id);

    const li = document.createElement("li");
    li.className = "catalog-item";
    li.dataset.taskId = id;
    if (onCanvas) li.classList.add("catalog-item--on-canvas");
    if (checked) li.classList.add("catalog-item--checked");

    if (onCanvas) {
      li.innerHTML = `
        <input type="checkbox" class="catalog-item__check" data-task-id="${escapeHtml(id)}" ${
          checked ? "checked" : ""
        } title="Выделить карточку на канве" />
        <div class="catalog-item__body" title="Перейти к карточке на канве">
          <span class="catalog-item__id">#${escapeHtml(id)}</span>
          <span class="catalog-item__name">${escapeHtml(meta.name || "(без названия)")}</span>
          <span class="catalog-item__fi">${escapeHtml(meta.frontend_identifier || "—")}</span>
        </div>
        <span class="catalog-item__badge" title="Уже на канве">на канве</span>
      `;
    } else {
      li.innerHTML = `
        <label class="catalog-item__label">
          <input type="checkbox" class="catalog-item__check" data-task-id="${escapeHtml(id)}" ${
            checked ? "checked" : ""
          } />
          <span class="catalog-item__body">
            <span class="catalog-item__id">#${escapeHtml(id)}</span>
            <span class="catalog-item__name">${escapeHtml(meta.name || "(без названия)")}</span>
            <span class="catalog-item__fi">${escapeHtml(meta.frontend_identifier || "—")}</span>
          </span>
        </label>
      `;
    }

    const checkbox = li.querySelector(".catalog-item__check");
    checkbox.addEventListener("change", (ev) => {
      if (onCanvas) {
        if (ev.target.checked) state.canvasSelected.add(id);
        else state.canvasSelected.delete(id);
        li.classList.toggle("catalog-item--checked", ev.target.checked);
        updateCanvasSelectionUI();
        updateCardSelectionClasses();
      } else {
        if (ev.target.checked) state.listChecked.add(id);
        else state.listChecked.delete(id);
        li.classList.toggle("catalog-item--checked", ev.target.checked);
        updateAddToCanvasButton();
      }
    });

    if (onCanvas) {
      li.addEventListener("click", (ev) => {
        if (ev.target.closest(".catalog-item__check")) return;
        ev.preventDefault();
        focusCanvasCardFromList(id);
      });
    }

    list.appendChild(li);
  }

  updateAddToCanvasButton();
}

async function loadDomains() {
  state.domains = await ensureDefaultDomainsInStorage();
  state.selectedDomain = fillDomainSelect($("domain-select"), state.domains, state.selectedDomain);
  updateDomainAuthIndicator(null);
}

function updateDomainAuthIndicator(status) {
  const el = $("domain-auth-indicator");
  if (!el) return;

  if (!status) {
    el.textContent = "";
    el.hidden = true;
    el.className = "toolbar__domain-auth toolbar__domain-auth--idle";
    el.title = "";
    el.dataset.action = "";
    return;
  }

  const label = formatDomainAuthLabel(status, { forIndicator: true });
  el.hidden = false;
  el.textContent = label;
  el.title =
    status.pendingOtp ? "Нажмите, чтобы завершить вход (OTP)" : label;

  if (status.authenticated) {
    el.className = "toolbar__domain-auth toolbar__domain-auth--ok";
    el.dataset.action = "";
  } else if (status.pendingOtp || status.awaitingMagicLink) {
    el.className = "toolbar__domain-auth toolbar__domain-auth--pending toolbar__domain-auth--action";
    el.dataset.action = status.pendingOtp ? "complete-otp" : "";
  } else {
    el.className = "toolbar__domain-auth toolbar__domain-auth--idle";
    el.dataset.action = "";
  }

  const btnCompleteOtp = $("btn-complete-auth-otp");
  if (btnCompleteOtp) {
    btnCompleteOtp.hidden = !status.pendingOtp;
  }
}

async function fetchAndUpdateDomainAuthIndicator(domain) {
  if (!domain) {
    updateDomainAuthIndicator(null);
    return null;
  }

  const el = $("domain-auth-indicator");
  if (el) {
    el.hidden = false;
    el.textContent = "…";
    el.className = "toolbar__domain-auth toolbar__domain-auth--pending";
    el.title = "Проверка входа…";
  }

  const status = await queryDomainAuthStatus(domain, { force: true });
  updateDomainAuthIndicator(status);
  return status;
}

function resetUiForDomainSwitch() {
  clearCanvasWithoutConfirm();
  state.catalog.clear();
  state.listChecked.clear();
  state.offset = 0;
  state.hasMore = false;
  state.catalogHiddenByState = 0;
  closePanel();
  $("catalog-panel")?.classList.add("catalog-panel--hidden");
  $("btn-load-more").disabled = true;
  renderTaskList();
  renderCards();
  updateCounters();
}

async function promptCompleteOtpAuth() {
  const domain = state.selectedDomain || normalizeDomainOrEmpty($("domain-select").value);
  if (!domain) {
    setStatus("Выберите домен админки", true);
    return;
  }

  const authed = await ensureAuthenticated(domain, {
    forcePrompt: true,
    message: "Завершите вход — введите OTP из письма",
  });
  if (authed) {
    await fetchAndUpdateDomainAuthIndicator(domain);
    await loadTasks(true, true, false, { skipConfirm: true, skipAuthCheck: true });
  }
}

function handleDomainSwitch() {
  const domain = state.selectedDomain;
  resetAuthModalForDomainSwitch(domain);
  resetUiForDomainSwitch();
  updateDomainAuthIndicator(null);

  if (!domain) {
    setStatus("Выберите домен админки", true);
    return;
  }

  void copyPanel?.loadMeta(domain);
  setStatus("Нажмите «Загрузить задачи»");
}

async function getAdminContext() {
  const context = await resolveAdminTab($("domain-select").value);
  state.selectedDomain = context.domain;
  state.selectedTabId = context.tabId ?? null;
  return context;
}

async function callApi(path, method = "GET", body = null) {
  const context = await getAdminContext();
  return apiFetch(context, path, method, body);
}

async function callApiResult(path, method = "GET", body = null) {
  const context = await getAdminContext();
  return apiFetchResult(context, path, method, body);
}

function gridPosition(index) {
  const col = index % GRID_COLS;
  const row = Math.floor(index / GRID_COLS);
  return {
    x: GRID_START_X + col * (CARD_W + GRID_GAP_X),
    y: GRID_START_Y + row * (CARD_H + GRID_GAP_Y),
  };
}

function columnX(col) {
  return GRID_START_X + col * (CARD_W + COL_GAP);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function rectsOverlapVertical(ay, ah, by, bh) {
  return ay < by + bh && ay + ah > by;
}

function estimateCardHeight(taskId) {
  const id = String(taskId);
  const task = state.canvas.get(id);
  if (!task) return CARD_MIN_H;
  if (typeof task.cardHeight === "number" && task.cardHeight > 0) return task.cardHeight;

  const { incoming, outgoing } = getDependencyRefs(id);
  if (!incoming.length && !outgoing.length) return CARD_MIN_H;

  let extra = 13;
  if (incoming.length) {
    extra += 18 + Math.ceil(incoming.length / 1.5) * 22;
  }
  if (outgoing.length) {
    extra += 18 + Math.ceil(outgoing.length / 1.5) * 22;
  }
  return CARD_MIN_H + extra;
}

function getCardHeight(taskId) {
  return estimateCardHeight(taskId);
}

function measureCardHeights() {
  const layer = $("cards-layer");
  if (!layer) return false;

  let changed = false;
  for (const card of layer.querySelectorAll(".task-card")) {
    const id = card.dataset.taskId;
    const task = state.canvas.get(id);
    if (!task) continue;
    const h = Math.ceil(card.offsetHeight);
    if (h > 0 && task.cardHeight !== h) {
      task.cardHeight = h;
      changed = true;
    }
  }
  return changed;
}

function getAllCanvasEdges() {
  const seen = new Set();
  const edges = [];

  function pushEdge(from, to) {
    const fromId = String(from);
    const toId = String(to);
    if (fromId === toId) return;
    if (!state.canvas.has(fromId) || !state.canvas.has(toId)) return;
    const key = edgeKey(fromId, toId);
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ from: fromId, to: toId });
  }

  for (const edge of state.edges) pushEdge(edge.from, edge.to);

  for (const task of state.canvas.values()) {
    const targetId = String(task.id);
    if (state.dirtyTargets.has(targetId)) continue;
    for (const depId of getGtListForTask(targetId)) {
      pushEdge(depId, targetId);
    }
  }

  return edges;
}

function assignColumns(ids, edges) {
  const idSet = new Set(ids);
  const parents = new Map();
  for (const id of ids) parents.set(id, []);

  for (const edge of edges) {
    if (!idSet.has(edge.from) || !idSet.has(edge.to)) continue;
    parents.get(edge.to).push(edge.from);
  }

  const columns = new Map();
  const visiting = new Set();

  function resolveColumn(id) {
    if (columns.has(id)) return columns.get(id);
    if (visiting.has(id)) return 0;
    visiting.add(id);

    const incoming = parents.get(id) || [];
    let col = 0;
    if (incoming.length) {
      col = Math.max(...incoming.map((parentId) => resolveColumn(parentId) + 1));
    }
    columns.set(id, col);
    visiting.delete(id);
    return col;
  }

  for (const id of ids) resolveColumn(id);
  return columns;
}

function occupiedRectsInColumn(col, columns, skipId = null) {
  const rects = [];
  for (const [id, task] of state.canvas.entries()) {
    if (skipId && id === skipId) continue;
    if (columns.get(id) !== col) continue;
    rects.push({ x: task.x, y: task.y, h: getCardHeight(id) });
  }
  return rects.sort((a, b) => a.y - b.y);
}

function findFreeY(col, columns, preferredY, skipId, cardHeight) {
  const occupied = occupiedRectsInColumn(col, columns, skipId);
  const x = columnX(col);
  const h = cardHeight || CARD_MIN_H;
  let y = preferredY;

  for (let guard = 0; guard < 200; guard += 1) {
    const overlaps = occupied.some(
      (r) =>
        x < r.x + CARD_W &&
        x + CARD_W > r.x &&
        rectsOverlapVertical(y, h, r.y, r.h)
    );
    if (!overlaps) return y;
    const blockers = occupied.filter(
      (r) =>
        x < r.x + CARD_W &&
        x + CARD_W > r.x &&
        rectsOverlapVertical(y, h, r.y, r.h)
    );
    y = Math.max(...blockers.map((r) => r.y + r.h)) + VERTICAL_GAP;
  }
  return y;
}

function applyLayoutPositions(columns, idsToMove) {
  const moveSet = idsToMove ? new Set(idsToMove.map(String)) : null;
  const byColumn = new Map();

  for (const id of columns.keys()) {
    if (moveSet && !moveSet.has(id)) continue;
    const col = columns.get(id);
    if (!byColumn.has(col)) byColumn.set(col, []);
    byColumn.get(col).push(id);
  }

  for (const [col, colIds] of [...byColumn.entries()].sort((a, b) => a[0] - b[0])) {
    const sorted = colIds.sort((a, b) => Number(a) - Number(b));
    const allInColumn = [...columns.entries()]
      .filter(([, column]) => column === col)
      .map(([id]) => id);
    const allMoving = !moveSet || allInColumn.every((id) => moveSet.has(id));
    const avgStep = CARD_MIN_H + VERTICAL_GAP;

    if (allMoving) {
      let y = GRID_START_Y;
      for (const id of sorted) {
        const task = state.canvas.get(id);
        if (!task) continue;
        const h = getCardHeight(id);
        task.x = columnX(col);
        task.y = y;
        y += h + VERTICAL_GAP;
      }
      continue;
    }

    sorted.forEach((id, row) => {
      const task = state.canvas.get(id);
      if (!task) return;
      const h = getCardHeight(id);
      const preferredY = GRID_START_Y + row * avgStep;
      task.x = columnX(col);
      task.y = findFreeY(col, columns, preferredY, id, h);
    });
  }
}

function layoutCanvasTasks({ forceAll = false, onlyIds = null, fixedIds = null } = {}) {
  const allIds = [...state.canvas.keys()];
  if (!allIds.length) return;

  const edges = getAllCanvasEdges();
  const columns = assignColumns(allIds, edges);

  if (forceAll) {
    applyLayoutPositions(columns, allIds);
    return;
  }

  const fixedSet = new Set((fixedIds || []).map(String));
  const onlySet = onlyIds ? new Set(onlyIds.map(String)) : null;
  const idsToMove = allIds.filter((id) => {
    if (fixedSet.has(id)) return false;
    if (onlySet && !onlySet.has(id)) return false;
    return true;
  });

  if (!idsToMove.length) return;
  applyLayoutPositions(columns, idsToMove);
}

async function persistCanvasPositions() {
  if (!state.selectedDomain) return;
  const positions = {};
  for (const [id, task] of state.canvas.entries()) {
    positions[id] = serializeCanvasTaskLayout(task);
  }
  await saveChainsLayout(state.selectedDomain, positions);
}

function normalizeHeaderColorId(value) {
  const id = String(value || "").trim();
  return id && CARD_HEADER_COLORS[id] ? id : null;
}

function isTaskConfiguredOnBackend(task) {
  return !!(task && task.configuredOnBackend);
}

function isTaskLocalOnly(task) {
  return !!(task && (task.localOnly === true || task.notSyncedWithBackend === true));
}

function newLocalDraftId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `local_${crypto.randomUUID()}`;
  }
  return `local_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function snapshotTaskBodyForDraft(task) {
  const raw = task && typeof task === "object" ? cloneJson(task) : {};
  delete raw.configuredOnBackend;
  delete raw.localOnly;
  delete raw.notSyncedWithBackend;
  delete raw._full;
  delete raw.x;
  delete raw.y;
  delete raw.headerColor;
  return raw;
}

function serializeCanvasTaskLayout(task) {
  const entry = { x: task.x, y: task.y };
  const colorId = normalizeHeaderColorId(task.headerColor);
  if (colorId) entry.headerColor = colorId;
  if (isTaskLocalOnly(task)) {
    entry.localOnly = true;
    entry.configuredOnBackend = false;
  } else if (isTaskConfiguredOnBackend(task)) {
    entry.configuredOnBackend = true;
  }
  return entry;
}

function buildCardHeadClassName(headerColor) {
  const colorId = normalizeHeaderColorId(headerColor);
  return colorId ? `task-card__head task-card__head--${colorId}` : "task-card__head";
}

function setTaskHeaderColor(taskId, colorId) {
  const id = String(taskId);
  const task = state.canvas.get(id);
  if (!task) return;

  const normalized = normalizeHeaderColorId(colorId);
  if (normalized) task.headerColor = normalized;
  else delete task.headerColor;

  hideCardContextMenu();
  renderCards();
  persistCanvasPositions();
}

function toggleTaskBackendConfigured(taskId) {
  const id = String(taskId);
  const task = state.canvas.get(id);
  if (!task) return;
  if (isTaskLocalOnly(task)) {
    hideCardContextMenu();
    showToast("Локальный черновик ещё не на бэке — откройте «Изменить» и сохраните", {
      type: "warning",
      durationMs: 5000,
    });
    return;
  }

  if (isTaskConfiguredOnBackend(task)) delete task.configuredOnBackend;
  else task.configuredOnBackend = true;

  hideCardContextMenu();
  renderCards();
  persistCanvasPositions();
}

function updateCardContextMenuBackendState(taskId) {
  const task = state.canvas.get(String(taskId));
  const btn = $("card-context-menu-backend");
  const editBtn = $("card-context-menu")?.querySelector('[data-action="edit"]');
  if (editBtn) {
    editBtn.textContent = isTaskLocalOnly(task) ? "Изменить и сохранить на бэк" : "Изменить";
  }
  if (!btn) return;
  if (isTaskLocalOnly(task)) {
    btn.textContent = "Только локально — не на бэке";
    btn.setAttribute("aria-checked", "false");
    btn.disabled = true;
    btn.title = "Черновик хранится локально. Откройте «Изменить», поправьте поля и создайте на бэке.";
    return;
  }
  btn.disabled = false;
  btn.removeAttribute("title");
  const configured = isTaskConfiguredOnBackend(task);
  btn.textContent = configured ? "Не настроена на бэке" : "Настроена на бэке";
  btn.setAttribute("aria-checked", configured ? "true" : "false");
}

function initCardColorContextMenu() {
  const container = $("card-context-menu-colors");
  if (!container || container.dataset.initialized) return;

  const defaultBtn = document.createElement("button");
  defaultBtn.type = "button";
  defaultBtn.className = "card-context-menu__swatch card-context-menu__swatch--default";
  defaultBtn.dataset.action = "set-color";
  defaultBtn.dataset.color = "";
  defaultBtn.title = "По умолчанию";
  defaultBtn.setAttribute("aria-label", "По умолчанию");
  defaultBtn.setAttribute("role", "menuitemradio");
  container.appendChild(defaultBtn);

  for (const [colorId, meta] of Object.entries(CARD_HEADER_COLORS)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `card-context-menu__swatch card-context-menu__swatch--${colorId}`;
    btn.dataset.action = "set-color";
    btn.dataset.color = colorId;
    btn.title = meta.label;
    btn.setAttribute("aria-label", meta.label);
    btn.setAttribute("role", "menuitemradio");
    container.appendChild(btn);
  }

  container.dataset.initialized = "1";
}

function updateCardContextMenuColors(taskId) {
  const task = state.canvas.get(String(taskId));
  const current = normalizeHeaderColorId(task?.headerColor) || "";
  const menu = $("card-context-menu");
  if (!menu) return;
  for (const btn of menu.querySelectorAll('[data-action="set-color"]')) {
    const isActive = (btn.dataset.color || "") === current;
    btn.classList.toggle("card-context-menu__swatch--active", isActive);
    btn.setAttribute("aria-checked", isActive ? "true" : "false");
  }
}

function applyViewportTransform() {
  const vp = $("canvas-viewport");
  if (!vp) return;
  const { x, y, scale } = state.viewport;
  vp.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  const indicator = $("zoom-indicator");
  if (indicator) indicator.textContent = `${Math.round(scale * 100)}%`;
}

function clientToCanvas(clientX, clientY) {
  const wrap = $("canvas-wrap");
  const rect = wrap.getBoundingClientRect();
  const { x, y, scale } = state.viewport;
  return {
    x: (clientX - rect.left - x) / scale,
    y: (clientY - rect.top - y) / scale,
  };
}

function setZoom(newScale, pivot = null) {
  const wrap = $("canvas-wrap");
  if (!wrap) return;
  const rect = wrap.getBoundingClientRect();
  const px = pivot ? pivot.x : rect.width / 2;
  const py = pivot ? pivot.y : rect.height / 2;
  const next = clamp(newScale, MIN_ZOOM, MAX_ZOOM);
  if (next === state.viewport.scale) return;
  const ratio = next / state.viewport.scale;
  state.viewport.x = px - (px - state.viewport.x) * ratio;
  state.viewport.y = py - (py - state.viewport.y) * ratio;
  state.viewport.scale = next;
  applyViewportTransform();
}

function zoomBy(factor) {
  cancelViewportAnimation();
  setZoom(state.viewport.scale * factor);
}

function resetZoom() {
  cancelViewportAnimation();
  setZoom(1);
}

function fitCanvasToView() {
  if (!state.canvas.size && !state.labels.length) return;
  const wrap = $("canvas-wrap");
  if (!wrap) return;
  const rect = wrap.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [id, task] of state.canvas.entries()) {
    minX = Math.min(minX, task.x);
    minY = Math.min(minY, task.y);
    maxX = Math.max(maxX, task.x + CARD_W);
    maxY = Math.max(maxY, task.y + getCardHeight(id));
  }
  for (const label of state.labels) {
    minX = Math.min(minX, label.x);
    minY = Math.min(minY, label.y);
    maxX = Math.max(maxX, label.x + 160);
    maxY = Math.max(maxY, label.y + 36);
  }

  if (!Number.isFinite(minX)) return;

  const pad = 60;
  const contentW = maxX - minX + pad * 2;
  const contentH = maxY - minY + pad * 2;
  const scale = clamp(Math.min(rect.width / contentW, rect.height / contentH), MIN_ZOOM, MAX_ZOOM);

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const targetX = rect.width / 2 - centerX * scale;
  const targetY = rect.height / 2 - centerY * scale;

  cancelViewportAnimation();
  state.viewport.scale = scale;
  applyViewportTransform();
  if (prefersReducedMotion()) {
    state.viewport.x = targetX;
    state.viewport.y = targetY;
    applyViewportTransform();
  } else {
    animateViewportTo(targetX, targetY);
  }
}

function setCatalogCollapsed(collapsed) {
  const panel = $("catalog-panel");
  if (!panel) return;
  panel.classList.toggle("catalog-panel--collapsed", collapsed);
  $("btn-expand-catalog")?.classList.toggle("catalog-rail--visible", collapsed);
  $("btn-toggle-catalog")?.setAttribute("aria-expanded", String(!collapsed));
}

function toggleCatalogCollapsed() {
  const panel = $("catalog-panel");
  if (!panel) return;
  setCatalogCollapsed(!panel.classList.contains("catalog-panel--collapsed"));
}

function cancelViewportAnimation() {
  if (viewportAnimation) {
    cancelAnimationFrame(viewportAnimation);
    viewportAnimation = null;
  }
}

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

function getCardRect(taskId) {
  const task = state.canvas.get(String(taskId));
  if (!task) return null;
  return {
    x: task.x,
    y: task.y,
    w: CARD_W,
    h: getCardHeight(taskId),
  };
}

function computeViewportForCardRect(rect) {
  const wrap = $("canvas-wrap");
  if (!wrap || !rect) return null;

  const { width, height } = wrap.getBoundingClientRect();
  const scale = state.viewport.scale;
  const centerX = rect.x + rect.w / 2;
  const centerY = rect.y + rect.h / 2;

  return {
    x: width / 2 - centerX * scale,
    y: height / 2 - centerY * scale,
    scale,
  };
}

function animateViewportTo(targetX, targetY, duration = 360) {
  cancelViewportAnimation();
  const startX = state.viewport.x;
  const startY = state.viewport.y;
  const t0 = performance.now();

  function frame(now) {
    const t = Math.min(1, (now - t0) / duration);
    const e = easeOutCubic(t);
    state.viewport.x = startX + (targetX - startX) * e;
    state.viewport.y = startY + (targetY - startY) * e;
    applyViewportTransform();
    if (t < 1) viewportAnimation = requestAnimationFrame(frame);
    else viewportAnimation = null;
  }

  viewportAnimation = requestAnimationFrame(frame);
}

function panToCanvasCard(taskId, { animate = true } = {}) {
  const rect = getCardRect(taskId);
  const target = computeViewportForCardRect(rect);
  if (!target) return false;

  if (animate) animateViewportTo(target.x, target.y);
  else {
    state.viewport.x = target.x;
    state.viewport.y = target.y;
    applyViewportTransform();
  }
  return true;
}

function pulseCanvasCard(taskId) {
  const layer = $("cards-layer");
  if (!layer) return;
  const card = layer.querySelector(`.task-card[data-task-id="${CSS.escape(String(taskId))}"]`);
  if (!card) return;

  card.classList.remove("task-card--focus-pulse");
  void card.offsetWidth;
  card.classList.add("task-card--focus-pulse");
  card.addEventListener(
    "animationend",
    () => card.classList.remove("task-card--focus-pulse"),
    { once: true }
  );
}

function isCanvasCardInView(taskId, { padding = 32 } = {}) {
  const cardRect = getCardRect(taskId);
  const wrap = $("canvas-wrap");
  if (!cardRect || !wrap) return true;

  const { width, height } = wrap.getBoundingClientRect();
  const { x: vx, y: vy, scale } = state.viewport;
  const left = cardRect.x * scale + vx;
  const top = cardRect.y * scale + vy;
  const right = left + cardRect.w * scale;
  const bottom = top + cardRect.h * scale;

  return (
    right > padding &&
    bottom > padding &&
    left < width - padding &&
    top < height - padding
  );
}

function highlightCanvasCard(taskId, durationMs = 5000) {
  const layer = $("cards-layer");
  if (!layer) return;
  const card = layer.querySelector(`.task-card[data-task-id="${CSS.escape(String(taskId))}"]`);
  if (!card) return;

  if (canvasCardHighlightTimer) {
    clearTimeout(canvasCardHighlightTimer);
    canvasCardHighlightTimer = null;
  }

  card.classList.remove("task-card--created-highlight");
  void card.offsetWidth;
  card.classList.add("task-card--created-highlight");
  canvasCardHighlightTimer = window.setTimeout(() => {
    card.classList.remove("task-card--created-highlight");
    canvasCardHighlightTimer = null;
  }, durationMs);
}

function focusNewlyCreatedTask(taskId) {
  const id = String(taskId);
  if (!state.canvas.has(id)) return;

  if (!isCanvasCardInView(id)) panToCanvasCard(id);
  highlightCanvasCard(id, 5000);
  flashCatalogListItem(id);
}

function flashCatalogListItem(taskId) {
  const list = $("catalog-list");
  if (!list) return;
  const item = list.querySelector(`.catalog-item[data-task-id="${CSS.escape(String(taskId))}"]`);
  if (!item) return;

  if (catalogFocusFlashTimer) clearTimeout(catalogFocusFlashTimer);
  item.classList.remove("catalog-item--focus-flash");
  void item.offsetWidth;
  item.classList.add("catalog-item--focus-flash");
  catalogFocusFlashTimer = setTimeout(() => {
    item.classList.remove("catalog-item--focus-flash");
    catalogFocusFlashTimer = null;
  }, 1200);
}

function focusCanvasCardFromList(taskId) {
  const id = String(taskId);
  if (!state.canvas.has(id)) {
    setStatus("Задача не на канве — отметьте её и нажмите «Добавить выбранные на канву»");
    return;
  }

  panToCanvasCard(id);
  pulseCanvasCard(id);
  flashCatalogListItem(id);
  setStatus(`Показана карточка #${id} на канве`);
}

function importGraphFromConditions(onlyTaskIds = null) {
  const onlySet = onlyTaskIds ? new Set(onlyTaskIds.map(String)) : null;
  if (!onlySet) {
    state.edges = [];
    state.targetConfigs.clear();
  }

  for (const task of state.canvas.values()) {
    const targetId = String(task.id);
    if (onlySet && !onlySet.has(targetId)) continue;
    if (onlySet && state.dirtyTargets.has(targetId)) continue;

    if (onlySet) {
      state.edges = state.edges.filter((e) => e.to !== targetId);
      state.targetConfigs.delete(targetId);
    }

    const gt = getGtBlock(task.conditions);
    if (!gt || !Array.isArray(gt.list)) continue;

    state.targetConfigs.set(targetId, {
      type: gt.type || "enabled",
      extra_type: gt.extra_type || "or",
      only_completed: gt.only_completed !== false,
    });

    for (const rawSource of gt.list) {
      const from = String(rawSource);
      if (!state.canvas.has(from)) continue;
      if (from === targetId) continue;
      const key = edgeKey(from, targetId);
      if (!state.edges.some((e) => edgeKey(e.from, e.to) === key)) {
        state.edges.push({ from, to: targetId });
      }
    }
  }
}

function addEdge(from, to) {
  const fromId = String(from);
  const toId = String(to);
  if (fromId === toId) return false;
  if (!state.canvas.has(fromId) || !state.canvas.has(toId)) return false;
  const key = edgeKey(fromId, toId);
  if (state.edges.some((e) => edgeKey(e.from, e.to) === key)) return false;

  state.edges.push({ from: fromId, to: toId });
  if (!state.targetConfigs.has(toId)) {
    state.targetConfigs.set(toId, defaultGtConfig());
  }
  syncTargetConfigList(toId);
  markDirtyTarget(toId);
  syncLocalConditionsFromEdges(toId);
  refreshGraphVisuals([fromId, toId]);
  return true;
}

function removeEdge(from, to) {
  const key = edgeKey(from, to);
  const before = state.edges.length;
  state.edges = state.edges.filter((e) => edgeKey(e.from, e.to) !== key);
  if (state.edges.length === before) return false;

  const toId = String(to);
  const stillHasIncoming = state.edges.some((e) => e.to === toId);
  if (!stillHasIncoming) state.targetConfigs.delete(toId);
  else syncTargetConfigList(toId);

  markDirtyTarget(toId);
  if (state.selectedEdgeKey === key) state.selectedEdgeKey = null;
  syncLocalConditionsFromEdges(toId);
  refreshGraphVisuals([String(from), toId]);
  return true;
}

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

function updateCanvasSelectionUI() {
  const n = state.canvasSelected.size;
  const counter = $("canvas-selection-counter");
  if (counter) {
    counter.textContent = String(n);
    counter.title = `Выбрано: ${n}`;
  }

  const hasCanvas = state.canvas.size > 0;
  const btnSelectAll = $("btn-select-all-canvas");
  const btnClearSel = $("btn-clear-canvas-selection");
  const btnRemove = $("btn-remove-selected-canvas");
  const btnClearCanvas = $("btn-clear-canvas");
  const btnCatalogRemove = $("btn-remove-from-canvas");
  const btnCatalogClearAll = $("btn-clear-all-from-catalog");

  if (btnSelectAll) btnSelectAll.disabled = !hasCanvas || n === state.canvas.size;
  if (btnClearSel) btnClearSel.disabled = n === 0;
  if (btnRemove) {
    btnRemove.disabled = n === 0;
    const label = `Убрать с канвы (${n})`;
    btnRemove.title = label;
    btnRemove.setAttribute("aria-label", label);
  }
  if (btnClearCanvas) btnClearCanvas.disabled = !hasCanvas;
  if (btnCatalogRemove) btnCatalogRemove.disabled = n === 0;
  if (btnCatalogClearAll) btnCatalogClearAll.disabled = !hasCanvas;
}

function clearCanvasSelection() {
  if (!state.canvasSelected.size) return;
  state.canvasSelected.clear();
  updateCanvasSelectionUI();
  updateCardSelectionClasses();
  renderTaskList();
}

function selectAllOnCanvas() {
  if (!state.canvas.size) return;
  state.canvasSelected = new Set(state.canvas.keys());
  updateCanvasSelectionUI();
  updateCardSelectionClasses();
  renderTaskList();
  setStatus(`Выделено ${state.canvasSelected.size} задач на канве`);
}

function toggleCanvasSelection(taskId) {
  const id = String(taskId);
  if (!state.canvas.has(id)) return;
  if (state.canvasSelected.has(id)) state.canvasSelected.delete(id);
  else state.canvasSelected.add(id);
  updateCanvasSelectionUI();
  updateCardSelectionClasses();
  renderTaskList();
}

function addToCanvasSelection(taskId) {
  const id = String(taskId);
  if (!state.canvas.has(id)) return;
  state.canvasSelected.add(id);
  updateCanvasSelectionUI();
  updateCardSelectionClasses();
  renderTaskList();
}

function needsRemoveConfirm(taskIds) {
  return taskIds.length > 5 || taskIds.some((id) => state.dirtyTargets.has(id));
}

function buildRemoveConfirmMessage(taskIds) {
  const dirtyCount = taskIds.filter((id) => state.dirtyTargets.has(id)).length;
  const parts = [`Убрать с канвы ${taskIds.length} задач?`];
  if (taskIds.length > 5) parts.push("Выбрано больше 5 карточек.");
  if (dirtyCount) {
    parts.push(
      `У ${dirtyCount} из них есть несохранённые изменения — они будут потеряны (на бэкенде задачи не удаляются).`
    );
  } else {
    parts.push("Задачи не удаляются с бэкенда, только снимаются с канвы.");
  }
  return parts.join("\n");
}

function removeMultipleFromCanvas(taskIds, { skipConfirm = false, single = false } = {}) {
  const ids = [...new Set(taskIds.map(String))].filter((id) => state.canvas.has(id));
  if (!ids.length) return false;

  if (!skipConfirm && needsRemoveConfirm(ids)) {
    if (!confirm(buildRemoveConfirmMessage(ids))) return false;
  }

  let shouldClosePanel = false;
  for (const id of ids) {
    state.canvas.delete(id);
    state.listChecked.delete(id);
    state.canvasSelected.delete(id);
    state.edges = state.edges.filter((e) => e.from !== id && e.to !== id);
    state.targetConfigs.delete(id);
    state.dirtyTargets.delete(id);

    if (state.linkSourceId === id) state.linkSourceId = null;
    if (state.selectedTargetId === id || state.selectedEdgeKey?.includes(id)) {
      shouldClosePanel = true;
    }
  }

  if (shouldClosePanel) closePanel();

  renderCards();
  renderTaskList();
  updateCounters();
  updateCanvasSelectionUI();
  updateSaveButton();
  setStatus(
    single ? `Задача #${ids[0]} убрана с канвы` : `С канвы убрано ${ids.length} задач`
  );
  return true;
}

function removeFromCanvas(taskId) {
  removeMultipleFromCanvas([taskId], { skipConfirm: true, single: true });
}

function removeSelectedFromCanvas() {
  const ids = [...state.canvasSelected];
  if (!ids.length) return;
  removeMultipleFromCanvas(ids);
}

function clearCanvas() {
  const ids = [...state.canvas.keys()];
  if (!ids.length) return;

  let message = `Очистить канву и убрать все ${ids.length} задач?`;
  if (needsRemoveConfirm(ids)) {
    message = `Очистить канву?\n\n${buildRemoveConfirmMessage(ids)}`;
  } else {
    message += "\nЗадачи не удаляются с бэкенда, только снимаются с канвы.";
  }
  if (!confirm(message)) return;

  removeMultipleFromCanvas(ids, { skipConfirm: true });
}

function clientRectToCanvas(x1, y1, x2, y2) {
  const p1 = clientToCanvas(x1, y1);
  const p2 = clientToCanvas(x2, y2);
  return {
    x1: Math.min(p1.x, p2.x),
    y1: Math.min(p1.y, p2.y),
    x2: Math.max(p1.x, p2.x),
    y2: Math.max(p1.y, p2.y),
  };
}

function cardIntersectsRect(taskId, rect) {
  const task = state.canvas.get(String(taskId));
  if (!task) return false;
  const x1 = task.x;
  const y1 = task.y;
  const x2 = task.x + CARD_W;
  const y2 = task.y + getCardHeight(taskId);
  return !(rect.x2 < x1 || rect.x1 > x2 || rect.y2 < y1 || rect.y1 > y2);
}

function getTaskIdsInClientRect(x1, y1, x2, y2) {
  const rect = clientRectToCanvas(x1, y1, x2, y2);
  if (Math.abs(rect.x2 - rect.x1) < 4 && Math.abs(rect.y2 - rect.y1) < 4) return [];
  return [...state.canvas.keys()].filter((id) => cardIntersectsRect(id, rect));
}

function updateMarqueeVisual(clientX, clientY) {
  const marquee = state.marquee;
  if (!marquee) return;

  const wrap = $("canvas-wrap");
  const rect = wrap.getBoundingClientRect();
  const left = Math.min(marquee.startX, clientX) - rect.left;
  const top = Math.min(marquee.startY, clientY) - rect.top;
  const width = Math.abs(clientX - marquee.startX);
  const height = Math.abs(clientY - marquee.startY);

  const el = $("selection-marquee");
  el.classList.remove("selection-marquee--hidden");
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  el.style.width = `${width}px`;
  el.style.height = `${height}px`;
}

function hideMarqueeVisual() {
  const el = $("selection-marquee");
  el.classList.add("selection-marquee--hidden");
  el.style.width = "0";
  el.style.height = "0";
}

function finishMarqueeSelection(clientX, clientY) {
  const marquee = state.marquee;
  if (!marquee) return;

  hideMarqueeVisual();
  $("canvas-wrap").classList.remove("canvas-wrap--selecting");
  state.marquee = null;

  if (Math.abs(clientX - marquee.startX) < 4 && Math.abs(clientY - marquee.startY) < 4) {
    return;
  }

  const hitIds = getTaskIdsInClientRect(marquee.startX, marquee.startY, clientX, clientY);
  if (marquee.additive) {
    for (const id of hitIds) state.canvasSelected.add(id);
  } else {
    state.canvasSelected = new Set(hitIds);
  }

  updateCanvasSelectionUI();
  updateCardSelectionClasses();
  renderTaskList();

  if (hitIds.length) {
    setStatus(`Выделено ${state.canvasSelected.size} задач на канве`);
  }
}

function startMarquee(ev) {
  state.marquee = {
    startX: ev.clientX,
    startY: ev.clientY,
    additive: !!(ev.ctrlKey || ev.metaKey),
  };
  $("canvas-wrap").classList.add("canvas-wrap--selecting");
  updateMarqueeVisual(ev.clientX, ev.clientY);
  ev.preventDefault();
}

function getIncomingEdges(targetId) {
  return state.edges.filter((e) => e.to === String(targetId));
}

function getOutgoingEdges(sourceId) {
  return state.edges.filter((e) => e.from === String(sourceId));
}

function getGtListForTask(taskId) {
  const task = state.canvas.get(String(taskId));
  if (!task) return [];
  const gt = getGtBlock(task.conditions);
  if (!gt || !Array.isArray(gt.list)) return [];
  return [...new Set(gt.list.map((id) => String(id)))];
}

function classifyDependencyId(depId, taskId) {
  const id = String(depId);
  if (id === String(taskId)) return null;
  if (state.canvas.has(id)) return { id, kind: "on-canvas" };
  if (state.catalog.has(id)) return { id, kind: "off-canvas" };
  return { id, kind: "external" };
}

function getDependencyRefs(taskId) {
  const id = String(taskId);
  const incoming = [];
  const seen = new Set();

  for (const edge of getIncomingEdges(id)) {
    incoming.push({ id: edge.from, kind: "on-canvas" });
    seen.add(edge.from);
  }

  for (const depId of getGtListForTask(id)) {
    const depKey = String(depId);
    if (seen.has(depKey)) continue;
    const ref = classifyDependencyId(depId, id);
    if (!ref) continue;
    seen.add(ref.id);
    incoming.push(ref);
  }

  const outgoing = [];
  const seenOutgoing = new Set();
  for (const edge of getOutgoingEdges(id)) {
    if (seenOutgoing.has(edge.to)) continue;
    seenOutgoing.add(edge.to);
    outgoing.push({ id: edge.to, kind: "on-canvas" });
  }

  return { incoming, outgoing };
}

function formatDepLabel(ref, role = "incoming") {
  const meta = state.catalog.get(ref.id);
  const name = meta?.name;
  let label = `#${ref.id}`;
  if (name) label += ` — ${name}`;
  if (ref.kind === "off-canvas") label += " (не на канве)";
  else if (ref.kind === "external") label += " (вне каталога)";
  return label;
}

function hasAnyDependencies(taskId) {
  const { incoming, outgoing } = getDependencyRefs(taskId);
  return incoming.length > 0 || outgoing.length > 0 || getIncomingEdges(taskId).length > 0;
}

function syncCatalogTaskMeta(id, source) {
  if (!source || !state.catalog.has(id)) return;
  state.catalog.set(id, {
    ...state.catalog.get(id),
    available_from: source.available_from ?? null,
    available_till: source.available_till ?? null,
    main_bonus_group_id: source.main_bonus_group_id ?? null,
  });
}

/** Актуальные id/name заданий для виджета gamification_tasks в conditions-builder. */
function buildCatalogTaskOptions() {
  const byId = new Map();
  for (const [id, meta] of state.catalog) {
    byId.set(String(id), {
      id: String(id),
      name: String(meta?.name || "(без названия)"),
    });
  }
  for (const [id, task] of state.canvas) {
    const key = String(id);
    if (!byId.has(key)) {
      byId.set(key, { id: key, name: String(task?.name || key) });
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

function resolveTaskMeta(task) {
  const id = String(task.id);
  const full = task._full;
  const catalog = state.catalog.get(id);
  return {
    available_from: full?.available_from ?? catalog?.available_from ?? task.available_from ?? null,
    available_till: full?.available_till ?? catalog?.available_till ?? task.available_till ?? null,
    main_bonus_group_id:
      full?.main_bonus_group_id ?? catalog?.main_bonus_group_id ?? task.main_bonus_group_id ?? null,
  };
}

/** Последнее число в имени бонуса из main_bonus_group_id (type:NAME:NAME). */
function parseBonusPointsFromGroupId(groupId) {
  if (!groupId || typeof groupId !== "string") return null;
  const parts = groupId.split(":");
  const namePart = (parts.length >= 2 ? parts[1] : groupId).trim();
  const match = namePart.match(/(\d+)\s*$/);
  if (!match) return null;
  const points = Number(match[1]);
  return Number.isFinite(points) ? points : null;
}

function buildCardMetaHtml(task) {
  const meta = resolveTaskMeta(task);
  const fromStr = formatCardDate(meta.available_from);
  const tillStr = formatCardDate(meta.available_till);
  const points = parseBonusPointsFromGroupId(meta.main_bonus_group_id);
  const hasDates = !!(fromStr || tillStr);
  const hasPoints = points != null;

  if (!hasDates && !hasPoints) return "";

  const parts = [];
  if (hasDates) {
    const range =
      fromStr && tillStr
        ? `${fromStr} — ${tillStr}`
        : fromStr
          ? `с ${fromStr}`
          : `до ${tillStr}`;
    parts.push(`<span class="task-card__meta-dates" title="Доступность">${escapeHtml(range)}</span>`);
  }
  if (hasPoints) {
    parts.push(
      `<span class="task-card__meta-points" title="Награда в баллах">${escapeHtml(String(points))} б.</span>`
    );
  }

  return `<div class="task-card__meta">${parts.join("")}</div>`;
}

function buildCardDepsHtml(taskId) {
  const { incoming, outgoing } = getDependencyRefs(taskId);
  const parts = [];

  if (incoming.length) {
    const items = incoming
      .map((ref) => {
        const cls =
          ref.kind === "on-canvas"
            ? "task-card__dep"
            : ref.kind === "off-canvas"
              ? "task-card__dep task-card__dep--off-canvas"
              : "task-card__dep task-card__dep--external";
        return `<span class="${cls}">${escapeHtml(formatDepLabel(ref))}</span>`;
      })
      .join("");
    parts.push(`<div class="task-card__deps-row"><span class="task-card__deps-label">Зависит от:</span> ${items}</div>`);
  }

  if (outgoing.length) {
    const items = outgoing
      .map((ref) => `<span class="task-card__dep">${escapeHtml(formatDepLabel(ref, "outgoing"))}</span>`)
      .join("");
    parts.push(`<div class="task-card__deps-row"><span class="task-card__deps-label">Требуется для:</span> ${items}</div>`);
  }

  if (!parts.length) {
    return '<div class="task-card__deps task-card__deps--empty">Нет входящих связей</div>';
  }

  return `<div class="task-card__deps">${parts.join("")}</div>`;
}

function getCardElement(taskId) {
  const layer = $("cards-layer");
  if (!layer) return null;
  return layer.querySelector(`.task-card[data-task-id="${CSS.escape(String(taskId))}"]`);
}

function updateCardSelectionClasses() {
  const layer = $("cards-layer");
  if (!layer) return;
  for (const card of layer.querySelectorAll(".task-card")) {
    const taskId = card.dataset.taskId;
    if (!taskId) continue;
    card.classList.toggle("task-card--selected", state.selectedTargetId === taskId);
    card.classList.toggle("task-card--multi-selected", state.canvasSelected.has(taskId));
    card.classList.toggle("task-card--link-source", state.linkSourceId === taskId);
  }
}

function updateCardBlockConflictClasses() {
  refreshBlockCheckState();
  const layer = $("cards-layer");
  if (!layer) return;
  for (const card of layer.querySelectorAll(".task-card")) {
    const taskId = card.dataset.taskId;
    if (!taskId) continue;
    const blockConflict = getBlockConflictForTask(taskId);
    card.classList.toggle("task-card--block-conflict", !!blockConflict);
    card.title = blockConflict ? blockConflict.tooltip : "";
    const head = card.querySelector(".task-card__head");
    if (!head) continue;
    let badge = head.querySelector(".task-card__block-badge");
    if (blockConflict) {
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "task-card__block-badge";
        badge.setAttribute("aria-label", "Конфликт блокировки");
        badge.textContent = "⚠ блок";
        const removeBtn = head.querySelector(".task-card__remove");
        head.insertBefore(badge, removeBtn);
      }
    } else if (badge) {
      badge.remove();
    }
  }
}

function updateCardDomPosition(taskId) {
  const task = state.canvas.get(String(taskId));
  const card = getCardElement(taskId);
  if (!task || !card) return;
  card.style.left = `${task.x}px`;
  card.style.top = `${task.y}px`;
}

function getCardCenter(taskId, side) {
  const task = state.canvas.get(String(taskId));
  if (!task) return { x: 0, y: 0 };
  const y = task.y + getCardHeight(taskId) / 2;
  const x = side === "out" ? task.x + CARD_W : task.x;
  return { x, y };
}

function bezierPath(x1, y1, x2, y2) {
  const dx = Math.max(60, Math.abs(x2 - x1) * 0.45);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

function renderGhostEdges() {
  const svg = $("edges-svg");
  let ghostIndex = 0;

  for (const task of state.canvas.values()) {
    const targetId = String(task.id);
    const to = getCardCenter(targetId, "in");

    for (const ref of getDependencyRefs(targetId).incoming) {
      if (ref.kind === "on-canvas") continue;

      const yOffset = (ghostIndex % 5) * 18 - 36;
      ghostIndex += 1;
      const x1 = to.x - 90;
      const y1 = to.y + yOffset;
      const d = bezierPath(x1, y1, to.x, to.y);

      const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
      line.setAttribute("d", d);
      line.setAttribute("class", "edge-line edge-line--ghost");
      line.dataset.ghostDep = ref.id;
      svg.appendChild(line);

      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      label.setAttribute("class", "edge-ghost-label");
      label.setAttribute("x", x1 - 4);
      label.setAttribute("y", y1 + 4);
      label.setAttribute("text-anchor", "end");
      label.textContent = `#${ref.id}`;
      svg.appendChild(label);
    }
  }
}

function renderEdges() {
  const svg = $("edges-svg");
  if (!svg) return;

  for (const child of [...svg.children]) {
    if (child.tagName === "defs") continue;
    child.remove();
  }

  const seen = new Set();
  for (const edge of state.edges) {
    const fromId = String(edge.from);
    const toId = String(edge.to);
    if (!state.canvas.has(fromId) || !state.canvas.has(toId)) continue;
    const key = edgeKey(fromId, toId);
    if (seen.has(key)) continue;
    seen.add(key);

    const from = getCardCenter(fromId, "out");
    const to = getCardCenter(toId, "in");
    const d = bezierPath(from.x, from.y, to.x, to.y);
    const selected = state.selectedEdgeKey === key;

    const hit = document.createElementNS("http://www.w3.org/2000/svg", "path");
    hit.setAttribute("d", d);
    hit.setAttribute("class", "edge-hit");
    hit.dataset.edgeKey = key;
    hit.addEventListener("click", (ev) => {
      ev.stopPropagation();
      selectEdge(key);
    });

    const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
    line.setAttribute("d", d);
    line.setAttribute("class", selected ? "edge-line edge-line--selected" : "edge-line");
    line.dataset.edgeKey = key;

    svg.appendChild(hit);
    svg.appendChild(line);
  }

  renderGhostEdges();
}

function getTaskFull(taskId) {
  return state.canvas.get(String(taskId))?._full || null;
}

function taskHasConsentButton(taskId) {
  const full = getTaskFull(taskId);
  if (!full) return false;
  return boolValue(full.player_consent_required, false);
}

function normalizeTargetActions(actions) {
  if (!Array.isArray(actions)) return [];
  return actions.map((item) => ({
    action: item?.action || "",
    requirements: item?.requirements && typeof item.requirements === "object" ? item.requirements : {},
    conditions: item?.conditions && typeof item.conditions === "object" ? item.conditions : {},
  }));
}

function getTargetActionTypes(taskId) {
  const full = getTaskFull(taskId);
  if (!full) return [];
  const main = normalizeTargetActions(full.serialized_main_actions);
  return main.map((item) => item.action).filter(Boolean);
}

function getSiblingGroupKey(taskId) {
  const gt = buildGtValueForTarget(taskId);
  const parents = Array.isArray(gt.list) ? gt.list.map(String) : [];
  if (!parents.length) return "";
  return [...new Set(parents)].sort((a, b) => Number(a) - Number(b)).join(",");
}

function formatSiblingGroupLabel(parentKey) {
  if (!parentKey) return "без зависимостей на канве";
  return `после ${parentKey.split(",").map((id) => `#${id}`).join(", ")}`;
}

function pluralConflicts(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "конфликт";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "конфликта";
  return "конфликтов";
}

function detectBlockConflicts() {
  const groups = new Map();

  for (const taskId of state.canvas.keys()) {
    const key = getSiblingGroupKey(taskId);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(String(taskId));
  }

  const conflicts = [];
  const conflictTaskIds = new Set();

  for (const [parentKey, siblings] of groups) {
    if (siblings.length < 2) continue;

    const byActionType = new Map();
    for (const taskId of siblings) {
      if (!taskHasConsentButton(taskId)) continue;
      const actionTypes = getTargetActionTypes(taskId);
      if (!actionTypes.length) continue;
      for (const actionType of actionTypes) {
        if (!byActionType.has(actionType)) byActionType.set(actionType, []);
        byActionType.get(actionType).push(taskId);
      }
    }

    for (const [actionType, taskIds] of byActionType) {
      const uniqueTaskIds = [...new Set(taskIds)].sort((a, b) => Number(a) - Number(b));
      if (uniqueTaskIds.length < 2) continue;
      const actionLabel = ACTION_LABELS[actionType] || actionType;
      const siblingLabel = formatSiblingGroupLabel(parentKey);
      const tooltip = `Блокировка: ${uniqueTaskIds.map((id) => `#${id}`).join(", ")} — кнопка «Согласие игрока», один тип целевого действия «${actionLabel}» (условия могут различаться), разблокируются ${siblingLabel}`;
      conflicts.push({ parentKey, taskIds: uniqueTaskIds, actionLabel, siblingLabel, tooltip });
      for (const taskId of uniqueTaskIds) conflictTaskIds.add(taskId);
    }
  }

  return { conflicts, conflictTaskIds };
}

function refreshBlockCheckState() {
  if (!state.checkBlocks) {
    state.blockConflicts = [];
    state.blockConflictTaskIds = new Set();
    updateBlockCheckUI();
    return;
  }

  const { conflicts, conflictTaskIds } = detectBlockConflicts();
  state.blockConflicts = conflicts;
  state.blockConflictTaskIds = conflictTaskIds;
  updateBlockCheckUI();
}

function updateBlockCheckUI() {
  const counter = $("block-conflicts-counter");
  if (!counter) return;

  if (!state.checkBlocks) {
    counter.classList.add("meta--hidden");
    counter.textContent = "";
    return;
  }

  counter.classList.remove("meta--hidden");
  const count = state.blockConflicts.length;
  if (!count) {
    counter.textContent = "Конфликтов блокировки нет";
    return;
  }
  counter.textContent = `${count} ${pluralConflicts(count)} блокировки`;
  counter.title = state.blockConflicts.map((item) => item.tooltip).join("\n");
}

function getBlockConflictForTask(taskId) {
  if (!state.checkBlocks) return null;
  const id = String(taskId);
  if (!state.blockConflictTaskIds.has(id)) return null;
  return state.blockConflicts.find((item) => item.taskIds.includes(id)) || null;
}

function renderCards() {
  refreshBlockCheckState();

  const layer = $("cards-layer");
  const existingIds = new Set(
    [...layer.querySelectorAll(".task-card")].map((card) => card.dataset.taskId).filter(Boolean)
  );
  layer.innerHTML = "";

  for (const task of state.canvas.values()) {
    const taskId = String(task.id);
    const blockConflict = getBlockConflictForTask(taskId);
    const card = document.createElement("article");
    card.className = "task-card";
    if (!existingIds.has(taskId)) {
      card.classList.add("task-card--enter");
      card.addEventListener(
        "animationend",
        () => card.classList.remove("task-card--enter"),
        { once: true }
      );
    }
    card.style.left = `${task.x}px`;
    card.style.top = `${task.y}px`;
    card.dataset.taskId = taskId;

    if (state.selectedTargetId === taskId) card.classList.add("task-card--selected");
    if (state.canvasSelected.has(taskId)) card.classList.add("task-card--multi-selected");
    if (state.linkSourceId === taskId) card.classList.add("task-card--link-source");
    if (isTaskLocalOnly(task)) card.classList.add("task-card--local-only");
    if (blockConflict) {
      card.classList.add("task-card--block-conflict");
      card.title = blockConflict.tooltip;
    }

    const blockBadge = blockConflict
      ? `<span class="task-card__block-badge" aria-label="Конфликт блокировки">⚠ блок</span>`
      : "";

    const localBadge = isTaskLocalOnly(task)
      ? `<span class="task-card__local-badge" title="Только локально — не синхронизирована с бэком" aria-label="Только локально">Только локально</span>`
      : "";

    const backendBadge =
      !isTaskLocalOnly(task) && isTaskConfiguredOnBackend(task)
        ? `<span class="task-card__backend-badge" title="Настроена на бэке" aria-label="Настроена на бэке">BE</span>`
        : "";

    const headClass = buildCardHeadClassName(task.headerColor);

    const idLabel = isTaskLocalOnly(task) ? "черновик" : task.id;

    card.innerHTML = `
      <div class="task-card__port task-card__port--in" data-port="in" title="Вход"></div>
      <div class="${headClass}">
        <div class="task-card__head-main">
          <span class="task-card__id">#${escapeHtml(String(idLabel))}</span>
          ${localBadge}
          ${backendBadge}
          ${blockBadge}
        </div>
        <button class="task-card__remove" type="button" title="Убрать с канвы">×</button>
      </div>
      <div class="task-card__body">
        <div class="task-card__name">${escapeHtml(task.name || "(без названия)")}</div>
        <div class="task-card__fi">${escapeHtml(task.frontend_identifier || "—")}</div>
        ${buildCardMetaHtml(task)}
        ${buildCardDepsHtml(task.id)}
      </div>
      <div class="task-card__port task-card__port--out" data-port="out" title="Выход — перетащите к цели"></div>
    `;

    card.addEventListener("mousedown", (ev) => onCardMouseDown(ev, task.id));
    card.addEventListener("click", (ev) => onCardClick(ev, task.id));
    card.addEventListener("contextmenu", (ev) => showCardContextMenu(ev, task.id));

    const outPort = card.querySelector('[data-port="out"]');
    outPort.addEventListener("mousedown", (ev) => onPortMouseDown(ev, task.id));

    card.querySelector(".task-card__remove").addEventListener("click", (ev) => {
      ev.stopPropagation();
      removeFromCanvas(task.id);
    });

    layer.appendChild(card);
  }

  updateCounters();
  renderEdges();
}

function newLabelId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return `lbl_${crypto.randomUUID()}`;
  return `lbl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function getLabelById(labelId) {
  const id = String(labelId);
  return state.labels.find((label) => label.id === id) || null;
}

function getLabelElement(labelId) {
  return $("labels-layer")?.querySelector(`.canvas-label[data-label-id="${CSS.escape(String(labelId))}"]`) || null;
}

function updateLabelDomPosition(labelId) {
  const label = getLabelById(labelId);
  const el = getLabelElement(labelId);
  if (!label || !el) return;
  el.style.left = `${label.x}px`;
  el.style.top = `${label.y}px`;
}

function updateLabelSelectionClasses() {
  for (const el of $("labels-layer")?.querySelectorAll(".canvas-label") || []) {
    el.classList.toggle("canvas-label--selected", el.dataset.labelId === state.selectedLabelId);
  }
}

function selectCanvasLabel(labelId) {
  state.selectedLabelId = String(labelId);
  state.canvasSelected.clear();
  updateCanvasSelectionUI();
  updateLabelSelectionClasses();
}

function clearCanvasLabelSelection() {
  if (!state.selectedLabelId) return;
  state.selectedLabelId = null;
  updateLabelSelectionClasses();
}

function getViewportCenterCanvasCoords() {
  const wrap = $("canvas-wrap");
  const rect = wrap.getBoundingClientRect();
  return clientToCanvas(rect.left + rect.width / 2, rect.top + rect.height / 2);
}

function addCanvasLabel(x, y, text = "Подпись") {
  const label = {
    id: newLabelId(),
    text: String(text || "Подпись").trim() || "Подпись",
    x: Number(x) || 0,
    y: Number(y) || 0,
  };
  state.labels.push(label);
  renderLabels();
  selectCanvasLabel(label.id);
  setStatus("Подпись добавлена — перетащите или дважды кликните для редактирования");
  return label;
}

function removeCanvasLabel(labelId) {
  const id = String(labelId);
  const index = state.labels.findIndex((label) => label.id === id);
  if (index < 0) return;
  state.labels.splice(index, 1);
  if (state.selectedLabelId === id) state.selectedLabelId = null;
  renderLabels();
  updateCounters();
  setStatus("Подпись удалена");
}

function clearCanvasLabels() {
  state.labels = [];
  state.selectedLabelId = null;
  renderLabels();
  updateCounters();
}

function loadCanvasLabels(raw) {
  state.labels = [];
  state.selectedLabelId = null;
  if (!Array.isArray(raw)) {
    renderLabels();
    updateCounters();
    return;
  }

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const x = Number(item.x);
    const y = Number(item.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    state.labels.push({
      id: String(item.id || newLabelId()),
      text: String(item.text || "Подпись").trim() || "Подпись",
      x,
      y,
    });
  }

  renderLabels();
  updateCounters();
}

function serializeCanvasLabels() {
  return state.labels.map(({ id, text, x, y }) => ({ id, text, x, y }));
}

function finishLabelEdit(labelId, rawText) {
  const label = getLabelById(labelId);
  if (!label) return;
  const next = String(rawText || "").trim();
  label.text = next || "Подпись";
  renderLabels();
  if (state.selectedLabelId === String(labelId)) selectCanvasLabel(labelId);
}

function startLabelEdit(labelId) {
  const id = String(labelId);
  const label = getLabelById(id);
  const el = getLabelElement(id);
  if (!label || !el || el.classList.contains("canvas-label--editing")) return;

  el.classList.add("canvas-label--editing");
  const currentText = label.text;
  el.innerHTML = `<input class="canvas-label__input" type="text" maxlength="120" />`;
  const input = el.querySelector(".canvas-label__input");
  if (!input) return;
  input.value = currentText;

  input.focus();
  input.select();

  const commit = () => {
    finishLabelEdit(id, input.value);
  };

  input.addEventListener("blur", commit, { once: true });
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      input.blur();
    }
    if (ev.key === "Escape") {
      ev.preventDefault();
      finishLabelEdit(id, currentText);
    }
    ev.stopPropagation();
  });
}

function renderLabels() {
  const layer = $("labels-layer");
  if (!layer) return;
  layer.innerHTML = "";

  for (const label of state.labels) {
    const el = document.createElement("div");
    el.className = "canvas-label";
    if (state.selectedLabelId === label.id) el.classList.add("canvas-label--selected");
    el.style.left = `${label.x}px`;
    el.style.top = `${label.y}px`;
    el.dataset.labelId = label.id;
    el.innerHTML = `
      <span class="canvas-label__text">${escapeHtml(label.text)}</span>
      <button class="canvas-label__remove" type="button" title="Удалить подпись" aria-label="Удалить подпись">×</button>
    `;

    el.addEventListener("mousedown", (ev) => onLabelMouseDown(ev, label.id));
    el.addEventListener("click", (ev) => onLabelClick(ev, label.id));
    el.addEventListener("dblclick", (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      startLabelEdit(label.id);
    });

    el.querySelector(".canvas-label__remove")?.addEventListener("mousedown", (ev) => {
      ev.stopPropagation();
    });
    el.querySelector(".canvas-label__remove")?.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      removeCanvasLabel(label.id);
    });

    layer.appendChild(el);
  }
}

function hideCanvasContextMenu() {
  const menu = $("canvas-context-menu");
  menu?.classList.add("card-context-menu--hidden");
  canvasContextMenuPoint = null;
}

function showCanvasContextMenu(ev) {
  ev.preventDefault();
  ev.stopPropagation();
  hideCardContextMenu();
  canvasContextMenuPoint = clientToCanvas(ev.clientX, ev.clientY);
  const menu = $("canvas-context-menu");
  if (!menu) return;
  menu.style.left = `${ev.clientX}px`;
  menu.style.top = `${ev.clientY}px`;
  menu.classList.remove("card-context-menu--hidden");
}

function onLabelClick(ev, labelId) {
  if (state.suppressCardClick) {
    state.suppressCardClick = false;
    return;
  }
  if (ev.target.closest(".canvas-label__remove")) return;
  ev.stopPropagation();
  selectCanvasLabel(labelId);
}

function onLabelMouseDown(ev, labelId) {
  if (ev.button !== 0) return;
  if (ev.target.closest(".canvas-label__remove") || ev.target.closest(".canvas-label__input")) return;

  const label = getLabelById(labelId);
  if (!label) return;

  selectCanvasLabel(labelId);
  state.drag = {
    kind: "label",
    labelId: String(labelId),
    startX: ev.clientX,
    startY: ev.clientY,
    originX: label.x,
    originY: label.y,
    moved: false,
  };

  $("canvas-wrap")?.classList.add("canvas-wrap--dragging");
  getLabelElement(labelId)?.classList.add("canvas-label--dragging");

  ev.preventDefault();
  ev.stopPropagation();
}

function selectEdge(key) {
  state.selectedEdgeKey = key;
  state.selectedTargetId = null;
  const { to } = parseEdgeKey(key);
  openTargetPanel(to, `Связь → задача #${to}`);
  renderEdges();
  updateCardSelectionClasses();
}

function selectTarget(targetId) {
  state.selectedTargetId = String(targetId);
  state.selectedEdgeKey = null;
  if (hasAnyDependencies(targetId)) {
    openTargetPanel(targetId, `Задача #${targetId}`);
  } else {
    closePanel();
    return;
  }
  renderEdges();
  updateCardSelectionClasses();
}

function showSidePanel() {
  const panel = $("side-panel");
  if (!panel) return;
  if (sidePanelCloseTimer) {
    clearTimeout(sidePanelCloseTimer);
    sidePanelCloseTimer = null;
  }
  const wasHidden = panel.classList.contains("side-panel--hidden");
  panel.classList.remove("side-panel--hidden", "side-panel--closing");
  if (wasHidden && !prefersReducedMotion()) {
    panel.classList.remove("side-panel--enter");
    void panel.offsetWidth;
    panel.classList.add("side-panel--enter");
  }
}

function openTargetPanel(targetId, title) {
  showSidePanel();
  $("panel-title").textContent = title;

  const id = String(targetId);
  const task = state.canvas.get(id);
  const gtFromConditions = getGtBlock(task?.conditions);
  if (!state.targetConfigs.has(id)) {
    if (getIncomingEdges(id).length || gtFromConditions) {
      state.targetConfigs.set(id, {
        type: gtFromConditions?.type || "enabled",
        extra_type: gtFromConditions?.extra_type || "or",
        only_completed: gtFromConditions?.only_completed !== false,
      });
    }
  }
  const cfg = state.targetConfigs.get(id) || defaultGtConfig();
  const incoming = getIncomingEdges(id);

  const body = $("panel-body");
  body.innerHTML = `
    <div class="panel-field">
      <span>type</span>
      <select id="cfg-type">
        <option value="enabled" ${cfg.type === "enabled" ? "selected" : ""}>Включая</option>
        <option value="disabled" ${cfg.type === "disabled" ? "selected" : ""}>Исключая</option>
      </select>
    </div>
    <div class="panel-field">
      <span>extra_type (несколько задач в list)</span>
      <select id="cfg-extra-type">
        <option value="and" ${cfg.extra_type === "and" ? "selected" : ""}>И (and)</option>
        <option value="or" ${cfg.extra_type === "or" ? "selected" : ""}>Или (or)</option>
      </select>
    </div>
    <div class="panel-field panel-check">
      <label>
        <input id="cfg-only-completed" type="checkbox" ${cfg.only_completed !== false ? "checked" : ""} />
        Только выполненные
      </label>
    </div>
    <div class="panel-section">
      <h3>Входящие связи</h3>
      <ul class="edge-list" id="panel-edge-list"></ul>
    </div>
    <div class="panel-section">
      <button id="btn-delete-selected-edge" class="btn btn--danger" type="button" ${
        state.selectedEdgeKey ? "" : "disabled"
      }>Удалить выбранную связь</button>
    </div>
  `;

  const list = $("panel-edge-list");
  const edgeFromIds = new Set(incoming.map((e) => e.from));

  for (const edge of incoming) {
    const li = document.createElement("li");
    const key = edgeKey(edge.from, edge.to);
    const selected = state.selectedEdgeKey === key;
    li.textContent = `#${edge.from} → #${edge.to}${selected ? " (выбрана)" : ""}`;
    li.style.cursor = "pointer";
    li.addEventListener("click", () => selectEdge(key));
    list.appendChild(li);
  }

  for (const ref of getDependencyRefs(id).incoming) {
    if (ref.kind === "on-canvas" && edgeFromIds.has(ref.id)) continue;
    const li = document.createElement("li");
    li.className =
      ref.kind === "off-canvas" ? "edge-list__off-canvas" : "edge-list__external";
    li.textContent = formatDepLabel(ref);
    list.appendChild(li);
  }

  if (!list.children.length) {
    const li = document.createElement("li");
    li.className = "edge-list__empty";
    li.textContent = "Нет входящих связей";
    list.appendChild(li);
  }

  $("cfg-type").addEventListener("change", (ev) => {
    const next = state.targetConfigs.get(id) || defaultGtConfig();
    next.type = ev.target.value;
    state.targetConfigs.set(id, next);
    markDirtyTarget(id);
  });

  $("cfg-extra-type").addEventListener("change", (ev) => {
    const next = state.targetConfigs.get(id) || defaultGtConfig();
    next.extra_type = ev.target.value;
    state.targetConfigs.set(id, next);
    markDirtyTarget(id);
  });

  $("cfg-only-completed").addEventListener("change", (ev) => {
    const next = state.targetConfigs.get(id) || defaultGtConfig();
    next.only_completed = !!ev.target.checked;
    state.targetConfigs.set(id, next);
    markDirtyTarget(id);
  });

  $("btn-delete-selected-edge").addEventListener("click", () => {
    if (!state.selectedEdgeKey) return;
    const { from, to } = parseEdgeKey(state.selectedEdgeKey);
    removeEdge(from, to);
    state.selectedEdgeKey = null;
    if (getIncomingEdges(to).length) openTargetPanel(to, `Задача #${to}`);
    else closePanel();
  });
}

function closePanel() {
  const panel = $("side-panel");
  if (panel && !panel.classList.contains("side-panel--hidden")) {
    panel.classList.remove("side-panel--enter");
    if (prefersReducedMotion()) {
      panel.classList.add("side-panel--hidden");
      panel.classList.remove("side-panel--closing");
    } else {
      panel.classList.add("side-panel--closing");
      if (sidePanelCloseTimer) clearTimeout(sidePanelCloseTimer);
      sidePanelCloseTimer = window.setTimeout(() => {
        if (panel.classList.contains("side-panel--closing")) {
          panel.classList.add("side-panel--hidden");
          panel.classList.remove("side-panel--closing");
        }
        sidePanelCloseTimer = null;
      }, 200);
    }
  }
  state.selectedEdgeKey = null;
  state.selectedTargetId = null;
  renderEdges();
  updateCardSelectionClasses();
}

function hideCardContextMenu() {
  const menu = $("card-context-menu");
  menu.classList.add("card-context-menu--hidden");
  contextMenuTaskId = null;
}

function showCardContextMenu(ev, taskId) {
  ev.preventDefault();
  ev.stopPropagation();
  hideCardContextMenu();
  contextMenuTaskId = String(taskId);
  const menu = $("card-context-menu");
  updateCardContextMenuColors(taskId);
  updateCardContextMenuBackendState(taskId);
  menu.style.left = `${ev.clientX}px`;
  menu.style.top = `${ev.clientY}px`;
  menu.classList.remove("card-context-menu--hidden");
}

function isCopyPanelOpen() {
  return !$("copy-panel-overlay").classList.contains("copy-panel-overlay--hidden");
}

function closeCopyPanel() {
  const overlay = $("copy-panel-overlay");
  if (overlay.classList.contains("copy-panel-overlay--hidden")) return;

  const finalize = () => {
    overlay.classList.add("copy-panel-overlay--hidden");
    overlay.classList.remove("copy-panel-overlay--closing");
    overlay.setAttribute("aria-hidden", "true");
    copyPanelSourceId = null;
    copyPanelMode = "copy";
    promotingLocalDraftId = null;
    const hadCrossDomain = !!copyCrossDomainTarget;
    copyCrossDomainTarget = null;
    copyPanel?.setMode("copy");
    $("copy-panel-overlay-title").textContent = "Скопировать задачу";
    copyPanelCloseTimer = null;
    if (hadCrossDomain) {
      void copyPanel?.loadMeta(state.selectedDomain || normalizeDomainOrEmpty($("domain-select").value));
    }
  };

  if (prefersReducedMotion()) {
    finalize();
    return;
  }

  overlay.classList.add("copy-panel-overlay--closing");
  if (copyPanelCloseTimer) clearTimeout(copyPanelCloseTimer);
  copyPanelCloseTimer = window.setTimeout(finalize, 200);
}

function setCopyPanelChrome(mode) {
  copyPanelMode = mode === "edit" ? "edit" : "copy";
  copyPanel?.setMode(copyPanelMode);
  if (promotingLocalDraftId) {
    $("copy-panel-overlay-title").textContent = "Сохранить черновик на бэк";
  } else if (copyPanelMode === "edit") {
    $("copy-panel-overlay-title").textContent = "Изменить задачу";
  } else if (copyCrossDomainTarget) {
    $("copy-panel-overlay-title").textContent = `Скопировать на ${copyCrossDomainTarget}`;
  } else {
    $("copy-panel-overlay-title").textContent = "Скопировать задачу";
  }
  if (promotingLocalDraftId) {
    return "Поправьте несовместимые поля (группы, теги, бонусы) и нажмите «Создать» — задача появится на бэке.";
  }
  return copyPanelMode === "edit"
    ? "Измените поля и нажмите «Сохранить»."
    : copyCrossDomainTarget
      ? `Измените поля и нажмите «Создать» — задача будет создана на ${copyCrossDomainTarget}.`
      : "Измените поля и нажмите «Создать».";
}

async function loadFullTaskForCopy(taskId) {
  const id = String(taskId);
  const canvasTask = state.canvas.get(id);
  if (isTaskLocalOnly(canvasTask) && canvasTask?._full) return canvasTask._full;
  if (canvasTask?._full && !isTaskLocalOnly(canvasTask)) return canvasTask._full;
  if (isTaskLocalOnly(canvasTask)) {
    throw new Error("У локального черновика нет данных задачи");
  }
  const full = await fetchTaskConditions(id);
  if (full) return full;
  const data = await callApi(`/admin/api/gamification/tasks/${id}?locale=ru`);
  const task = taskFromResponse(data);
  if (!task) throw new Error("API не вернул объект gamification_task");
  return task;
}

async function openTaskPanel(taskId, mode = "copy") {
  const id = String(taskId);
  hideCardContextMenu();
  closePanel();
  copyPanelSourceId = id;
  const submitHint = setCopyPanelChrome(mode);

  if (copyPanelCloseTimer) {
    clearTimeout(copyPanelCloseTimer);
    copyPanelCloseTimer = null;
  }
  $("copy-panel-overlay").classList.remove("copy-panel-overlay--hidden", "copy-panel-overlay--closing");
  $("copy-panel-overlay").setAttribute("aria-hidden", "false");
  copyPanel.setStatus(`Загружаю задачу #${id}...`);

  try {
    const task = await loadFullTaskForCopy(id);
    copyPanel.refreshTaskOptions?.();
    copyPanel.fillFromTask(task);
    copyPanel.printResult(task);
    copyPanel.setStatus(`Задача #${id}. ${submitHint}`);
    if (promotingLocalDraftId || isTaskLocalOnly(state.canvas.get(id))) {
      showToast(
        "Черновик с другого проекта: проверьте группы, теги и бонус-группы перед сохранением на бэк",
        { type: "warning", durationMs: 7000 }
      );
    }
  } catch (err) {
    copyPanel.setStatus(`Ошибка загрузки: ${err.message || err}`, true);
  }
}

async function openCopyPanel(taskId) {
  promotingLocalDraftId = null;
  return openTaskPanel(taskId, "copy");
}

async function openEditPanel(taskId) {
  const id = String(taskId);
  const task = state.canvas.get(id);
  if (isTaskLocalOnly(task)) {
    promotingLocalDraftId = id;
    return openTaskPanel(id, "copy");
  }
  promotingLocalDraftId = null;
  return openTaskPanel(id, "edit");
}

async function handleCopyCreate(requestBody) {
  const crossDomain = copyCrossDomainTarget
    ? normalizeDomainOrEmpty(copyCrossDomainTarget)
    : "";

  if (crossDomain) {
    return handleCopyCreateToDomain(requestBody, crossDomain);
  }

  const { data: response, headers, url } = await callApiResult(
    "/admin/api/gamification/tasks?locale=ru",
    "POST",
    requestBody
  );

  const newId = await resolveCreatedTaskId(callApi, requestBody, response, { headers, url });
  if (!newId) {
    const msg = "Задача создана, но id не найден — нажмите «Загрузить задачи»";
    copyPanel.setStatus(msg, true);
    setStatus(msg, true);
    return response;
  }

  let created = taskFromResponse(response) || {};
  const newIdStr = String(newId);

  try {
    const fullData = await callApi(`/admin/api/gamification/tasks/${newIdStr}?locale=ru`);
    const full = taskFromResponse(fullData);
    if (full) created = full;
  } catch {
    /* conditions из requestBody ниже */
  }

  const sourceId = copyPanelSourceId;
  const source = sourceId ? state.canvas.get(sourceId) : null;
  const promoteLocal = !!(source && isTaskLocalOnly(source));

  const x = promoteLocal
    ? source.x
    : source
      ? source.x + CARD_W + COL_GAP
      : GRID_START_X;
  const y = promoteLocal ? source.y : source ? source.y : GRID_START_Y;

  state.catalog.set(newIdStr, {
    id: newIdStr,
    name: created.name || requestBody.gamification_task?.name || "",
    frontend_identifier:
      created.frontend_identifier || requestBody.gamification_task?.frontend_identifier || "",
    state: String(created.state ?? requestBody.gamification_task?.state ?? "draft").toLowerCase(),
  });

  if (promoteLocal) {
    remapCanvasTaskId(String(sourceId), newIdStr);
  }

  state.canvas.set(newIdStr, {
    id: newIdStr,
    name: state.catalog.get(newIdStr).name,
    frontend_identifier: state.catalog.get(newIdStr).frontend_identifier,
    conditions: created.conditions || requestBody.gamification_task?.conditions || [],
    _full: Object.keys(created).length ? created : null,
    x,
    y,
    ...(source?.headerColor ? { headerColor: source.headerColor } : {}),
  });

  if (promoteLocal && state.canvas.has(String(sourceId))) {
    state.canvas.delete(String(sourceId));
  }

  promotingLocalDraftId = null;
  importGraphFromConditions([newIdStr]);
  await persistCanvasPositions();
  renderCards();
  renderTaskList();
  updateCounters();

  const taskName = state.catalog.get(newIdStr)?.name || "";
  closeCopyPanel();
  focusNewlyCreatedTask(newIdStr);
  showToast(
    taskName
      ? `Задача успешно создана — #${newIdStr}: ${taskName}`
      : `Задача успешно создана — #${newIdStr}`
  );
  setStatus(
    promoteLocal
      ? `Локальный черновик сохранён на бэк как #${newIdStr}`
      : `Создана задача #${newIdStr} — карточка добавлена на канву`
  );
  return response;
}

/** Переносит рёбра/конфиги/выделение с локального id на реальный после POST. */
function remapCanvasTaskId(fromId, toId) {
  const from = String(fromId);
  const to = String(toId);
  if (from === to) return;

  state.edges = state.edges.map((e) => ({
    from: e.from === from ? to : e.from,
    to: e.to === from ? to : e.to,
  }));

  if (state.targetConfigs.has(from)) {
    state.targetConfigs.set(to, state.targetConfigs.get(from));
    state.targetConfigs.delete(from);
  }

  if (state.dirtyTargets.has(from)) {
    state.dirtyTargets.delete(from);
    state.dirtyTargets.add(to);
  }

  if (state.canvasSelected.has(from)) {
    state.canvasSelected.delete(from);
    state.canvasSelected.add(to);
  }

  if (state.linkSourceId === from) state.linkSourceId = to;
  if (state.selectedTargetId === from) state.selectedTargetId = to;
  if (state.selectedEdgeKey) {
    const parsed = parseEdgeKey(state.selectedEdgeKey);
    const nextFrom = parsed.from === from ? to : parsed.from;
    const nextTo = parsed.to === from ? to : parsed.to;
    state.selectedEdgeKey = edgeKey(nextFrom, nextTo);
  }
  state.listChecked.delete(from);
}

async function handleCopyCreateToDomain(requestBody, targetDomain) {
  const context = await resolveAdminTab(targetDomain);
  const apiForDomain = (path, method = "GET", body = null) => apiFetch(context, path, method, body);

  const { data: response, headers, url } = await apiFetchResult(
    context,
    "/admin/api/gamification/tasks?locale=ru",
    "POST",
    requestBody
  );

  const newId = await resolveCreatedTaskId(apiForDomain, requestBody, response, { headers, url });
  const taskName = requestBody.gamification_task?.name || "";
  const idLabel = newId != null ? `#${newId}` : "(id не получен)";

  closeCopyPanel();
  showToast(
    taskName
      ? `Задача скопирована на ${targetDomain} — ${idLabel}: ${taskName}`
      : `Задача скопирована на ${targetDomain} — ${idLabel}`
  );
  setStatus(
    newId != null
      ? `Задача #${newId} создана на ${targetDomain}`
      : `Задача создана на ${targetDomain}, но id не найден`
  );
  return response;
}

async function handleEditUpdate(requestBody) {
  const taskId = copyPanelSourceId;
  if (!taskId) throw new Error("ID задачи не задан");

  const gt = requestBody.gamification_task || {};
  const payload = {
    gamification_task: {
      ...gt,
      id: Number(taskId) || taskId,
    },
  };

  const response = await callApi(
    `/admin/api/gamification/tasks/${taskId}?locale=ru`,
    "PATCH",
    payload
  );

  let updated = taskFromResponse(response) || { ...gt, id: taskId };
  try {
    const fullData = await callApi(`/admin/api/gamification/tasks/${taskId}?locale=ru`);
    const full = taskFromResponse(fullData);
    if (full) updated = full;
  } catch {
    /* ответ PATCH или payload ниже */
  }

  const name = updated.name || gt.name || "";
  const frontendIdentifier = updated.frontend_identifier || gt.frontend_identifier || "";
  const taskState = String(updated.state ?? gt.state ?? "draft").toLowerCase();
  const conditions = updated.conditions || gt.conditions || [];

  if (state.catalog.has(taskId)) {
    state.catalog.set(taskId, {
      ...state.catalog.get(taskId),
      name,
      frontend_identifier: frontendIdentifier,
      state: taskState,
      available_from: updated.available_from ?? null,
      available_till: updated.available_till ?? null,
      main_bonus_group_id: updated.main_bonus_group_id ?? null,
    });
  }

  const local = state.canvas.get(taskId);
  if (local) {
    state.canvas.set(taskId, {
      ...local,
      name,
      frontend_identifier: frontendIdentifier,
      conditions,
      _full: updated,
    });
  }

  state.dirtyTargets.delete(taskId);
  importGraphFromConditions([taskId]);
  renderCards();
  renderTaskList();
  updateCounters();

  if (isCopyPanelOpen()) {
    copyPanel.refreshTaskOptions?.();
  }

  const taskName = state.catalog.get(taskId)?.name || name || "";
  closeCopyPanel();
  showToast(
    taskName
      ? `Задача успешно обновлена — #${taskId}: ${taskName}`
      : `Задача успешно обновлена — #${taskId}`
  );
  setStatus(`Задача #${taskId} обновлена`);
  return response;
}

function onCardClick(ev, taskId) {
  if (state.suppressCardClick) {
    state.suppressCardClick = false;
    return;
  }
  if (ev.target.closest("[data-port]") || ev.target.closest(".task-card__remove")) return;

  const id = String(taskId);

  if (ev.ctrlKey || ev.metaKey) {
    toggleCanvasSelection(id);
    return;
  }

  if (ev.shiftKey) {
    addToCanvasSelection(id);
    return;
  }

  const linkMode = $("link-mode").checked;

  if (linkMode) {
    if (!state.linkSourceId) {
      state.linkSourceId = id;
      setStatus(`Источник: #${id}. Кликните целевую задачу.`);
      updateCardSelectionClasses();
      return;
    }
    if (state.linkSourceId === id) {
      state.linkSourceId = null;
      setStatus("Режим связи отменён");
      updateCardSelectionClasses();
      return;
    }
    if (addEdge(state.linkSourceId, id)) {
      setStatus(`Связь #${state.linkSourceId} → #${id} добавлена`);
      selectEdge(edgeKey(state.linkSourceId, id));
    }
    state.linkSourceId = null;
    updateCardSelectionClasses();
    return;
  }

  if (hasAnyDependencies(id)) selectTarget(id);
}

function onCardMouseDown(ev, taskId) {
  if (ev.button !== 0) return;
  if (ev.target.closest("[data-port]") || ev.target.closest(".task-card__remove")) return;

  const task = state.canvas.get(String(taskId));
  if (!task) return;

  const startX = ev.clientX;
  const startY = ev.clientY;

  state.drag = {
    kind: "task",
    taskId: String(taskId),
    startX,
    startY,
    originX: task.x,
    originY: task.y,
    moved: false,
  };

  $("canvas-wrap")?.classList.add("canvas-wrap--dragging");
  getCardElement(taskId)?.classList.add("task-card--dragging");

  ev.preventDefault();
  ev.stopPropagation();
}

function onPortMouseDown(ev, taskId) {
  ev.stopPropagation();
  ev.preventDefault();

  const fromId = String(taskId);
  const start = getCardCenter(fromId, "out");

  const preview = document.createElementNS("http://www.w3.org/2000/svg", "path");
  preview.setAttribute("class", "edge-line");
  preview.setAttribute("stroke-dasharray", "6 4");
  $("edges-svg").appendChild(preview);

  function onMove(ev) {
    const p = clientToCanvas(ev.clientX, ev.clientY);
    preview.setAttribute("d", bezierPath(start.x, start.y, p.x, p.y));
  }

  function onUp(ev) {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    preview.remove();

    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    const card = el?.closest?.(".task-card");
    if (card) {
      const toId = card.dataset.taskId;
      if (toId && toId !== fromId && addEdge(fromId, toId)) {
        setStatus(`Связь #${fromId} → #${toId} добавлена`);
        selectEdge(edgeKey(fromId, toId));
      }
    }
  }

  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}

function onCanvasPanMouseDown(ev) {
  if (ev.button !== 0) return;
  if (state.drag) return;
  if (ev.target.closest(".task-card") || ev.target.closest(".edge-hit") || ev.target.closest(".canvas-label")) return;

  if (ev.shiftKey) {
    startMarquee(ev);
    return;
  }

  cancelViewportAnimation();
  state.pan = {
    startX: ev.clientX,
    startY: ev.clientY,
    originX: state.viewport.x,
    originY: state.viewport.y,
  };
  state.panMoved = false;
  $("canvas-wrap").classList.add("canvas-wrap--panning");
  ev.preventDefault();
}

function onCanvasWheel(ev) {
  ev.preventDefault();
  cancelViewportAnimation();

  const wrap = $("canvas-wrap");
  const rect = wrap.getBoundingClientRect();
  const mouseX = ev.clientX - rect.left;
  const mouseY = ev.clientY - rect.top;

  const factor = ev.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
  const newScale = clamp(state.viewport.scale * factor, MIN_ZOOM, MAX_ZOOM);
  if (newScale === state.viewport.scale) return;

  const ratio = newScale / state.viewport.scale;
  state.viewport.x = mouseX - (mouseX - state.viewport.x) * ratio;
  state.viewport.y = mouseY - (mouseY - state.viewport.y) * ratio;
  state.viewport.scale = newScale;
  applyViewportTransform();
}

function onDocumentMouseMove(ev) {
  if (state.marquee) {
    updateMarqueeVisual(ev.clientX, ev.clientY);
    return;
  }

  if (state.pan) {
    const dx = ev.clientX - state.pan.startX;
    const dy = ev.clientY - state.pan.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) state.panMoved = true;
    state.viewport.x = state.pan.originX + dx;
    state.viewport.y = state.pan.originY + dy;
    applyViewportTransform();
    return;
  }

  if (!state.drag) return;
  const dx = ev.clientX - state.drag.startX;
  const dy = ev.clientY - state.drag.startY;
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) state.drag.moved = true;

  const scale = state.viewport.scale || 1;

  if (state.drag.kind === "label") {
    const label = getLabelById(state.drag.labelId);
    if (!label) return;
    label.x = state.drag.originX + dx / scale;
    label.y = state.drag.originY + dy / scale;
    updateLabelDomPosition(state.drag.labelId);
    return;
  }

  const task = state.canvas.get(state.drag.taskId);
  if (!task) return;
  task.x = state.drag.originX + dx / scale;
  task.y = state.drag.originY + dy / scale;
  updateCardDomPosition(state.drag.taskId);
  renderEdges();
}

async function onDocumentMouseUp(ev) {
  if (state.marquee) {
    finishMarqueeSelection(ev.clientX, ev.clientY);
    return;
  }

  if (state.pan) {
    state.pan = null;
    $("canvas-wrap").classList.remove("canvas-wrap--panning");
    return;
  }

  if (!state.drag) return;
  const { kind, taskId, labelId, moved } = state.drag;
  state.drag = null;
  $("canvas-wrap")?.classList.remove("canvas-wrap--dragging");

  if (kind === "label") {
    getLabelElement(labelId)?.classList.remove("canvas-label--dragging");
    if (moved) state.suppressCardClick = true;
    return;
  }

  getCardElement(taskId)?.classList.remove("task-card--dragging");
  if (moved) {
    state.suppressCardClick = true;
    renderEdges();
  }
  await persistCanvasPositions();
}

async function fetchTaskConditions(taskId) {
  const id = String(taskId);
  const existingEarly = state.canvas.get(id);
  if (isTaskLocalOnly(existingEarly)) {
    return existingEarly._full || null;
  }

  const data = await callApi(`/admin/api/gamification/tasks/${taskId}?locale=ru`);
  const full = taskFromResponse(data);
  if (!full) return null;
  const existing = state.canvas.get(String(taskId));
  if (existing) {
    const isDirty = state.dirtyTargets.has(id);
    if (!isDirty) {
      existing.conditions = full.conditions || [];
      importGraphFromConditions([id]);
    }
    existing._full = full;
    existing.name = full.name || existing.name;
    existing.frontend_identifier = full.frontend_identifier || existing.frontend_identifier;
    syncCatalogTaskMeta(String(taskId), full);
  }
  return full;
}

async function placeTaskOnCanvas(id, positions, useSavedPosition = true) {
  const meta = state.catalog.get(id);
  if (!meta) return false;

  const saved = useSavedPosition ? positions[id] : null;
  const pos = saved || { x: GRID_START_X, y: GRID_START_Y };
  const headerColor = normalizeHeaderColorId(saved?.headerColor);
  const localOnly = saved?.localOnly === true;
  const configuredOnBackend = !localOnly && saved?.configuredOnBackend === true;
  state.canvas.set(id, {
    id,
    name: meta.name,
    frontend_identifier: meta.frontend_identifier,
    conditions: null,
    x: pos.x,
    y: pos.y,
    ...(headerColor ? { headerColor } : {}),
    ...(localOnly ? { localOnly: true } : {}),
    ...(configuredOnBackend ? { configuredOnBackend: true } : {}),
  });
  return true;
}

function placeLocalDraftOnCanvas(id, layout, body) {
  const draftId = String(id);
  const full = body && typeof body === "object" ? cloneJson(body) : {};
  const headerColor = normalizeHeaderColorId(layout?.headerColor);
  const x = Number.isFinite(Number(layout?.x)) ? Number(layout.x) : GRID_START_X;
  const y = Number.isFinite(Number(layout?.y)) ? Number(layout.y) : GRID_START_Y;

  state.canvas.set(draftId, {
    id: draftId,
    name: full.name || "(локальный черновик)",
    frontend_identifier: full.frontend_identifier || "",
    conditions: Array.isArray(full.conditions) ? full.conditions : [],
    _full: full,
    x,
    y,
    localOnly: true,
    ...(headerColor ? { headerColor } : {}),
  });
  return true;
}

async function addSelectedToCanvas() {
  const ids = [...state.listChecked].filter((id) => !state.canvas.has(id));
  if (!ids.length) return;

  state.loading = true;
  updateSaveButton();
  updateAddToCanvasButton();
  setButtonLoading("btn-add-to-canvas", true);
  showCanvasLoading("Добавляю задачи на канву…");

  try {
    const domain = state.selectedDomain || normalizeDomainOrEmpty($("domain-select").value);
    const layout = await loadChainsLayout(domain);
    const positions = layout.positions || {};
    const canvasBeforeAdd = new Set(state.canvas.keys());
    const userIds = ids.map(String);
    let done = 0;

    for (const id of userIds) {
      if (!(await placeTaskOnCanvas(id, positions, false))) continue;

      try {
        const msg = `Загрузка условий: ${done + 1}/${userIds.length} (#${id})`;
        setStatus(msg);
        showCanvasLoading(msg);
        await fetchTaskConditions(id);
      } catch {
        /* пропускаем отдельные ошибки */
      }

      done += 1;
      state.listChecked.delete(id);
    }

    importGraphFromConditions(userIds);
    layoutCanvasTasks({ onlyIds: userIds, fixedIds: [...canvasBeforeAdd] });
    renderCards();
    if (measureCardHeights()) {
      layoutCanvasTasks({ onlyIds: userIds, fixedIds: [...canvasBeforeAdd] });
    }
    await persistCanvasPositions();
    renderCards();
    renderTaskList();

    setStatus(`На канве ${state.canvas.size} задач (добавлено ${done})`);
  } catch (err) {
    setStatus(`Ошибка добавления: ${err.message || err}`, true);
  } finally {
    state.loading = false;
    updateSaveButton();
    updateAddToCanvasButton();
    setButtonLoading("btn-add-to-canvas", false);
    hideCanvasLoading();
  }
}

function confirmReloadCatalog() {
  const hasDirty = state.dirtyTargets.size > 0;
  const hasCanvas = state.canvas.size > 0;

  if (!hasDirty && !hasCanvas) return true;

  const msg = hasDirty
    ? "Есть несохранённые изменения на канве. Обновить список задач? Задачи на канве не будут удалены."
    : "Обновить список задач? Задачи на канве сохранятся.";

  return confirm(msg);
}

async function loadTasks(reset = true, loadAllPages = reset, authRetry = false, options = {}) {
  if (state.loading) return;

  const skipConfirm = Boolean(options.skipConfirm);
  const skipAuthCheck = Boolean(options.skipAuthCheck);

  if (reset && !authRetry && !skipConfirm && !confirmReloadCatalog()) return;

  const domain = state.selectedDomain || normalizeDomainOrEmpty($("domain-select").value);
  if (!domain) {
    setStatus("Выберите домен админки", true);
    return;
  }

  if (!authRetry && !skipAuthCheck) {
    const authed = await ensureAuthenticated(domain, {
      message: "Для загрузки задач нужен вход в админку",
    });
    if (!authed) {
      setStatus("Вход не выполнен — загрузка отменена", true);
      return;
    }
    void fetchAndUpdateDomainAuthIndicator(domain);
  }

  state.loading = true;
  updateSaveButton();
  updateAddToCanvasButton();
  setButtonLoading(reset ? "btn-load-tasks" : "btn-load-more", true);

  try {
    if (reset) {
      state.offset = 0;
      state.catalog.clear();
      state.listChecked.clear();
      state.catalogHiddenByState = 0;
      showCatalogPanel();
      renderCatalogSkeleton();
    }

    let lastPage = [];

    do {
      setStatus(
        loadAllPages
          ? `Загружаю список: ${state.catalog.size}+...`
          : "Загружаю следующую страницу..."
      );
      const data = await withTimeout(
        callApi(
          `/admin/api/gamification/tasks?limit=${PAGE_SIZE}&offset=${state.offset}&locale=ru`
        ),
        API_REQUEST_TIMEOUT_MS,
        "Превышено время ожидания загрузки задач — проверьте вход в админку"
      );
      lastPage = taskListFromResponse(data);
      state.offset += lastPage.length;
      state.hasMore = lastPage.length === PAGE_SIZE;

      for (const raw of lastPage) {
        if (!isVisibleTaskState(raw)) {
          state.catalogHiddenByState += 1;
          continue;
        }
        const id = String(raw.id);
        state.catalog.set(id, {
          id,
          name: raw.name || "",
          frontend_identifier: raw.frontend_identifier || "",
          state: String(raw.state ?? "draft").toLowerCase(),
          available_from: raw.available_from ?? null,
          available_till: raw.available_till ?? null,
          main_bonus_group_id: raw.main_bonus_group_id ?? null,
        });
      }

      $("btn-load-more").disabled = !state.hasMore;
      updateCounters();
    } while (loadAllPages && state.hasMore);

    showCatalogPanel();
    renderTaskList();
    renderCards();

    const domainLabel = state.selectedDomain || domain;
    const hiddenNote =
      state.catalogHiddenByState > 0 ? `, скрыто по статусу: ${state.catalogHiddenByState}` : "";
    setStatus(
      `Список загружен: ${state.catalog.size} задач (Активно и Черновик)${hiddenNote} — ${domainLabel}. Выберите задачи слева.`
    );
  } catch (err) {
    if (isAuthError(err)) {
      const authed = await ensureAuthenticated(domain, {
        forcePrompt: true,
        message: err.message?.includes("403")
          ? "Вы не подтверждены — выполните вход (magic link + OTP)"
          : err.message || "Требуется вход в админку",
      });
      if (authed) {
        void fetchAndUpdateDomainAuthIndicator(domain);
        state.loading = false;
        setButtonLoading("btn-load-tasks", false);
        setButtonLoading("btn-load-more", false);
        return loadTasks(reset, loadAllPages, true);
      }
      setStatus("Вход не выполнен — загрузка отменена", true);
    } else {
      setStatus(`Ошибка: ${err.message || err}`, true);
    }
    if (reset) renderTaskList();
  } finally {
    state.loading = false;
    updateSaveButton();
    updateAddToCanvasButton();
    setButtonLoading("btn-load-tasks", false);
    setButtonLoading("btn-load-more", false);
  }
}

function showSaveLog() {
  $("save-log").classList.remove("save-log--hidden");
}

function appendSaveLog(text, kind = "pending") {
  const li = document.createElement("li");
  li.className = `log--${kind}`;
  li.textContent = text;
  $("save-log-list").appendChild(li);
  li.scrollIntoView({ block: "nearest" });
}

async function saveChanges() {
  if (!state.dirtyTargets.size) return;

  $("save-log-list").innerHTML = "";
  showSaveLog();
  state.loading = true;
  updateSaveButton();
  setButtonLoading("btn-save", true);

  const targets = [...state.dirtyTargets].filter((id) => {
    const task = state.canvas.get(id);
    return task && !isTaskLocalOnly(task);
  });
  let okCount = 0;
  let errCount = 0;

  for (const targetId of targets) {
    appendSaveLog(`#${targetId}: загрузка...`, "pending");
    try {
      const full = (await fetchTaskConditions(targetId)) || state.canvas.get(targetId)?._full;
      if (!full) throw new Error("не удалось получить задачу");

      const gtValue = buildGtValueForTarget(targetId);
      const mergedConditions =
        gtValue.list.length > 0
          ? mergeGamificationTasks(full.conditions || [], gtValue)
          : mergeGamificationTasks(full.conditions || [], null);

      const payload = buildPatchPayload(full, mergedConditions);
      appendSaveLog(`#${targetId}: сохранение...`, "pending");
      await callApi(`/admin/api/gamification/tasks/${targetId}?locale=ru`, "PATCH", payload);

      const local = state.canvas.get(targetId);
      if (local) local.conditions = mergedConditions;
      state.dirtyTargets.delete(targetId);
      okCount += 1;
      appendSaveLog(`#${targetId}: OK`, "ok");
    } catch (err) {
      errCount += 1;
      appendSaveLog(`#${targetId}: ${err.message || err}`, "err");
    }
  }

  const savedIds = targets.filter((id) => !state.dirtyTargets.has(id));
  for (const targetId of savedIds) {
    importGraphFromConditions([targetId]);
  }
  if (savedIds.length) refreshGraphVisuals(savedIds);

  state.loading = false;
  setButtonLoading("btn-save", false);
  updateSaveButton();
  setStatus(
    errCount
      ? `Сохранено ${okCount}, ошибок ${errCount}`
      : `Сохранено ${okCount} задач`,
    errCount > 0
  );
}

function selectAllVisible(checked) {
  const visibleIds = getVisibleCatalogIds();
  for (const id of visibleIds) {
    if (state.canvas.has(id)) continue;
    if (checked) state.listChecked.add(id);
    else state.listChecked.delete(id);
  }
  renderTaskList();
}

async function alignCanvas() {
  if (!state.canvas.size) return;
  layoutCanvasTasks({ forceAll: true });
  renderCards();
  if (measureCardHeights()) {
    layoutCanvasTasks({ forceAll: true });
  }
  await persistCanvasPositions();
  renderCards();
  setStatus(`Раскладка пересчитана для ${state.canvas.size} задач`);
}

function getCurrentDomain() {
  return state.selectedDomain || normalizeDomainOrEmpty($("domain-select").value);
}

function newTemplateId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function formatTemplateDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function serializeCanvasTemplate(name, existingId = null) {
  const canvas = {};
  const taskBodies = {};
  for (const [id, task] of state.canvas.entries()) {
    canvas[id] = serializeCanvasTaskLayout(task);
    if (isTaskLocalOnly(task) && task._full) {
      taskBodies[id] = snapshotTaskBodyForDraft(task._full);
    }
  }

  const targetConfigs = {};
  for (const [id, cfg] of state.targetConfigs.entries()) {
    targetConfigs[id] = { ...cfg };
  }

  const now = new Date().toISOString();
  const template = {
    id: existingId || newTemplateId(),
    name: String(name || "").trim(),
    domain: getCurrentDomain(),
    createdAt: now,
    updatedAt: now,
    canvas,
    edges: state.edges.map((e) => ({ from: e.from, to: e.to })),
    targetConfigs,
    labels: serializeCanvasLabels(),
    viewport: { ...state.viewport },
  };
  if (Object.keys(taskBodies).length) template.taskBodies = taskBodies;
  return template;
}

function countTemplateLocalDrafts(template) {
  const bodies = template?.taskBodies && typeof template.taskBodies === "object"
    ? template.taskBodies
    : {};
  const canvas = template?.canvas && typeof template.canvas === "object" ? template.canvas : {};
  const ids = new Set([
    ...Object.keys(bodies),
    ...Object.keys(canvas).filter((id) => canvas[id]?.localOnly === true),
  ]);
  return ids.size;
}

function isTemplateModalOpen() {
  return (
    !$("template-save-overlay")?.classList.contains("chains-modal-overlay--hidden") ||
    !$("template-load-overlay")?.classList.contains("chains-modal-overlay--hidden") ||
    !$("copy-to-project-overlay")?.classList.contains("chains-modal-overlay--hidden") ||
    isAuthModalOpen()
  );
}

function getSaveTemplateMode() {
  const active = $("template-save-mode")?.querySelector(".template-save-mode__btn--active");
  return active?.dataset.mode === "overwrite" ? "overwrite" : "new";
}

function setSaveTemplateMode(mode) {
  const isOverwrite = mode === "overwrite";
  for (const btn of $("template-save-mode")?.querySelectorAll("[data-mode]") || []) {
    btn.classList.toggle("template-save-mode__btn--active", btn.dataset.mode === mode);
  }
  $("template-save-new-section")?.classList.toggle("meta--hidden", isOverwrite);
  $("template-save-overwrite-section")?.classList.toggle("meta--hidden", !isOverwrite);
  const confirmBtn = $("btn-confirm-save-template");
  if (confirmBtn) confirmBtn.textContent = isOverwrite ? "Обновить" : "Сохранить";

  if (isOverwrite) {
    $("template-save-existing")?.focus();
  } else {
    const input = $("template-save-name");
    if (input) input.value = "";
    input?.focus();
  }
}

async function populateSaveTemplateOverwriteList() {
  const domain = getCurrentDomain();
  const templates = domain ? await getDomainCanvasTemplates(domain) : [];
  const modeWrap = $("template-save-mode-wrap");
  const select = $("template-save-existing");

  if (!templates.length) {
    modeWrap?.classList.add("meta--hidden");
    setSaveTemplateMode("new");
    return templates;
  }

  modeWrap?.classList.remove("meta--hidden");
  setSaveTemplateMode("new");

  if (select) {
    select.replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "— Выберите шаблон —";
    select.appendChild(placeholder);

    for (const tpl of templates) {
      const taskCount = tpl.canvas ? Object.keys(tpl.canvas).length : 0;
      const opt = document.createElement("option");
      opt.value = tpl.id;
      opt.textContent = `${tpl.name} (${taskCount} задач)`;
      select.appendChild(opt);
    }
    select.value = "";
  }

  return templates;
}

async function openSaveTemplateModal() {
  if (!state.canvas.size) {
    showToast("На канве нет задач — нечего сохранять", { type: "warning" });
    return;
  }

  const hint = $("template-save-hint");
  if (hint) {
    hint.classList.toggle("meta--hidden", state.dirtyTargets.size === 0);
    if (state.dirtyTargets.size) {
      hint.textContent =
        "В шаблон попадут раскладка и связи. Несохранённые изменения данных задач (условия, действия) нужно сохранить отдельно кнопкой «Сохранить».";
    }
  }

  const input = $("template-save-name");
  if (input) input.value = "";

  await populateSaveTemplateOverwriteList();
  (getSaveTemplateMode() === "overwrite" ? $("template-save-existing") : input)?.focus();

  const overlay = $("template-save-overlay");
  overlay?.classList.remove("chains-modal-overlay--hidden");
  overlay?.setAttribute("aria-hidden", "false");
}

function closeSaveTemplateModal() {
  const overlay = $("template-save-overlay");
  overlay?.classList.add("chains-modal-overlay--hidden");
  overlay?.setAttribute("aria-hidden", "true");
  const confirmBtn = $("btn-confirm-save-template");
  if (confirmBtn) confirmBtn.textContent = "Сохранить";
}

function closeLoadTemplateModal() {
  const overlay = $("template-load-overlay");
  overlay?.classList.add("chains-modal-overlay--hidden");
  overlay?.setAttribute("aria-hidden", "true");
}

function buildTemplateSaveToastMessage(name, isUpdate, taskCount) {
  let message = isUpdate
    ? `Шаблон «${name}» обновлён`
    : `Шаблон «${name}» сохранён`;
  if (taskCount > 0) message += ` (${taskCount} задач)`;
  if (state.dirtyTargets.size) {
    message += ". Несохранённые изменения данных задач в шаблон не входят";
  }
  return message;
}

async function handleSaveTemplate() {
  const domain = getCurrentDomain();
  if (!domain) {
    showToast("Выберите домен", { type: "warning" });
    return;
  }

  const mode = getSaveTemplateMode();
  const templates = await getDomainCanvasTemplates(domain);

  if (mode === "overwrite") {
    const select = $("template-save-existing");
    const templateId = select?.value || "";
    if (!templateId) {
      showToast("Выберите шаблон для перезаписи", { type: "warning" });
      select?.focus();
      return;
    }

    const existing = templates.find((t) => t.id === templateId);
    if (!existing) {
      showToast("Шаблон не найден — обновите список", { type: "warning" });
      return;
    }

    const template = serializeCanvasTemplate(existing.name, existing.id);
    template.createdAt = existing.createdAt;
    template.updatedAt = new Date().toISOString();

    try {
      await upsertDomainCanvasTemplate(domain, template);
      closeSaveTemplateModal();
      const taskCount = Object.keys(template.canvas).length;
      showToast(
        buildTemplateSaveToastMessage(existing.name, true, taskCount),
        { type: state.dirtyTargets.size ? "warning" : "success" }
      );
    } catch (err) {
      showToast(err.message || "Не удалось сохранить шаблон", { type: "warning" });
    }
    return;
  }

  const input = $("template-save-name");
  const name = input?.value.trim() || "";
  if (!name) {
    showToast("Введите название шаблона", { type: "warning" });
    input?.focus();
    return;
  }

  const existing = templates.find((t) => t.name === name);
  const template = serializeCanvasTemplate(name, existing?.id);
  if (existing) {
    template.createdAt = existing.createdAt;
    template.updatedAt = new Date().toISOString();
  }

  try {
    await upsertDomainCanvasTemplate(domain, template);
    closeSaveTemplateModal();
    const taskCount = Object.keys(template.canvas).length;
    showToast(
      buildTemplateSaveToastMessage(name, Boolean(existing), taskCount),
      { type: state.dirtyTargets.size ? "warning" : "success" }
    );
  } catch (err) {
    showToast(err.message || "Не удалось сохранить шаблон", { type: "warning" });
  }
}

async function renderTemplateLoadList() {
  const domain = getCurrentDomain();
  const domainEl = $("template-load-domain");
  if (domainEl) domainEl.textContent = domain ? `Домен: ${domain}` : "Домен не выбран";

  const list = $("template-load-list");
  const empty = $("template-load-empty");
  if (!list || !empty) return;

  list.replaceChildren();
  if (!domain) {
    empty.classList.remove("meta--hidden");
    empty.textContent = "Сначала выберите домен";
    return;
  }

  const templates = await getDomainCanvasTemplates(domain);
  if (!templates.length) {
    empty.classList.remove("meta--hidden");
    empty.textContent = "Нет сохранённых шаблонов для этого домена";
    return;
  }

  empty.classList.add("meta--hidden");
  const fragment = document.createDocumentFragment();

  for (const tpl of templates) {
    const taskCount = tpl.canvas ? Object.keys(tpl.canvas).length : 0;
    const edgeCount = Array.isArray(tpl.edges) ? tpl.edges.length : 0;
    const draftCount = countTemplateLocalDrafts(tpl);
    const draftNote = draftCount ? ` · ${draftCount} черновик.` : "";
    const li = document.createElement("li");
    li.className = "template-list__item";
    li.innerHTML = `
      <button type="button" class="template-list__load" data-template-id="${escapeHtml(tpl.id)}">
        <span class="template-list__name">${escapeHtml(tpl.name)}</span>
        <span class="template-list__meta">${taskCount} задач · ${edgeCount} связей${draftNote} · ${escapeHtml(formatTemplateDate(tpl.updatedAt || tpl.createdAt))}</span>
      </button>
      <div class="template-list__actions">
        <button
          type="button"
          class="btn btn--icon btn--ghost template-list__copy-project"
          data-template-id="${escapeHtml(tpl.id)}"
          title="Скопировать шаблон на другой проект"
          aria-label="Скопировать шаблон ${escapeHtml(tpl.name)} на другой проект"
        >
          <span class="material-symbols-outlined" aria-hidden="true">drive_file_move</span>
        </button>
        <button
          type="button"
          class="btn btn--icon btn--ghost btn--danger-icon template-list__delete"
          data-template-id="${escapeHtml(tpl.id)}"
          title="Удалить шаблон"
          aria-label="Удалить шаблон ${escapeHtml(tpl.name)}"
        >
          <span class="material-symbols-outlined" aria-hidden="true">delete</span>
        </button>
      </div>
    `;
    fragment.appendChild(li);
  }

  list.appendChild(fragment);
}

async function openLoadTemplateModal() {
  const domain = getCurrentDomain();
  if (!domain) {
    showToast("Сначала выберите домен", { type: "warning" });
    return;
  }

  await renderTemplateLoadList();
  const overlay = $("template-load-overlay");
  overlay?.classList.remove("chains-modal-overlay--hidden");
  overlay?.setAttribute("aria-hidden", "false");
}

async function handleDeleteTemplate(templateId) {
  const domain = getCurrentDomain();
  if (!domain || !templateId) return;

  const templates = await getDomainCanvasTemplates(domain);
  const tpl = templates.find((t) => t.id === templateId);
  if (!tpl) return;

  if (!confirm(`Удалить шаблон «${tpl.name}»?`)) return;

  await deleteDomainCanvasTemplate(domain, templateId);
  await renderTemplateLoadList();
  showToast(`Шаблон «${tpl.name}» удалён`);
}

function buildLoadTemplateConfirmMessage(template) {
  const taskCount = template.canvas ? Object.keys(template.canvas).length : 0;
  const parts = [`Загрузить шаблон «${template.name}» (${taskCount} задач)?`];
  parts.push("Текущая канва будет заменена.");

  if (state.dirtyTargets.size) {
    parts.push(
      `Внимание: у ${state.dirtyTargets.size} задач есть несохранённые изменения — они будут потеряны.`
    );
  } else if (state.canvas.size) {
    parts.push(`С канвы будет снято ${state.canvas.size} задач.`);
  }

  return parts.join("\n");
}

function clearCanvasWithoutConfirm() {
  const ids = [...state.canvas.keys()];
  if (ids.length) removeMultipleFromCanvas(ids, { skipConfirm: true });
  clearCanvasLabels();
}

async function applyCanvasTemplate(template) {
  const domain = getCurrentDomain();
  if (!domain) {
    showToast("Выберите домен", { type: "warning" });
    return;
  }

  const positions = template.canvas || {};
  const taskBodies =
    template.taskBodies && typeof template.taskBodies === "object" ? template.taskBodies : {};
  const taskIds = Object.keys(positions);
  const hasLocalDrafts = taskIds.some(
    (id) => positions[id]?.localOnly === true || taskBodies[id]
  );

  if (!state.catalog.size && !hasLocalDrafts) {
    showToast("Сначала загрузите задачи для домена", { type: "warning" });
    return;
  }

  if (!confirm(buildLoadTemplateConfirmMessage(template))) return;

  closeLoadTemplateModal();
  state.loading = true;
  updateSaveButton();
  updateCounters();
  setButtonLoading("btn-load-template", true);
  showCanvasLoading("Загружаю шаблон…");

  try {
    clearCanvasWithoutConfirm();

    const missing = [];
    const placed = [];
    let localDraftCount = 0;

    for (const id of taskIds) {
      const layout = positions[id] || {};
      const body = taskBodies[id];
      const isLocal = layout.localOnly === true || !!body;

      if (isLocal && body) {
        placeLocalDraftOnCanvas(id, layout, body);
        placed.push(id);
        localDraftCount += 1;
        continue;
      }

      if (isLocal && !body) {
        missing.push(id);
        continue;
      }

      if (!state.catalog.has(id)) {
        missing.push(id);
        continue;
      }
      if (await placeTaskOnCanvas(id, positions, true)) placed.push(id);
    }

    for (let i = 0; i < placed.length; i += 1) {
      const id = placed[i];
      if (isTaskLocalOnly(state.canvas.get(id))) continue;
      try {
        const msg = `Загрузка условий: ${i + 1}/${placed.length} (#${id})`;
        setStatus(msg);
        showCanvasLoading(msg);
        await fetchTaskConditions(id);
      } catch {
        /* пропускаем отдельные ошибки */
      }
    }

    state.edges = [];
    state.targetConfigs.clear();

    const savedEdges = Array.isArray(template.edges) ? template.edges : [];
    for (const edge of savedEdges) {
      const from = String(edge.from);
      const to = String(edge.to);
      if (!state.canvas.has(from) || !state.canvas.has(to)) continue;
      if (from === to) continue;
      const key = edgeKey(from, to);
      if (!state.edges.some((e) => edgeKey(e.from, e.to) === key)) {
        state.edges.push({ from, to });
      }
    }

    const savedConfigs = template.targetConfigs && typeof template.targetConfigs === "object"
      ? template.targetConfigs
      : {};
    for (const [id, cfg] of Object.entries(savedConfigs)) {
      if (!state.canvas.has(id)) continue;
      state.targetConfigs.set(String(id), { ...defaultGtConfig(), ...cfg });
    }

    for (const id of placed) syncLocalConditionsFromEdges(id);

    loadCanvasLabels(template.labels);

    if (template.viewport && typeof template.viewport === "object") {
      const vp = template.viewport;
      state.viewport.x = Number(vp.x) || 0;
      state.viewport.y = Number(vp.y) || 0;
      state.viewport.scale = clamp(Number(vp.scale) || 1, MIN_ZOOM, MAX_ZOOM);
      applyViewportTransform();
    }

    renderCards();
    if (measureCardHeights()) renderCards();
    await persistCanvasPositions();
    renderTaskList();
    updateCounters();
    updateSaveButton();

    const loadedCount = state.canvas.size;
    setStatus(`Шаблон «${template.name}»: на канве ${loadedCount} задач`);

    if (missing.length) {
      showToast(
        `Шаблон загружен. ${missing.length} задач не найдено в каталоге и пропущено`,
        { type: "warning", durationMs: 7000 }
      );
    } else if (localDraftCount) {
      showToast(
        `Шаблон «${template.name}» загружен (${loadedCount} задач, ${localDraftCount} только локально). Поправьте данные и сохраните на бэк.`,
        { durationMs: 8000 }
      );
    } else {
      showToast(`Шаблон «${template.name}» загружен (${loadedCount} задач)`);
    }
  } catch (err) {
    setStatus(`Ошибка загрузки шаблона: ${err.message || err}`, true);
    showToast(`Ошибка загрузки шаблона: ${err.message || err}`, { type: "warning" });
  } finally {
    state.loading = false;
    updateSaveButton();
    updateCounters();
    setButtonLoading("btn-load-template", false);
    hideCanvasLoading();
  }
}

function closeCopyToProjectModal() {
  const overlay = $("copy-to-project-overlay");
  overlay?.classList.add("chains-modal-overlay--hidden");
  overlay?.setAttribute("aria-hidden", "true");
  copyToProjectTaskId = null;
  copyToProjectTemplateId = null;
  copyToProjectMode = "task";
}

function getCopyToProjectMode() {
  const active = $("copy-to-project-mode")?.querySelector(".template-save-mode__btn--active");
  return active?.dataset.mode === "template" ? "template" : "task";
}

function updateCopyToProjectHint(mode = getCopyToProjectMode()) {
  const hint = $("copy-to-project-hint");
  if (!hint) return;
  if (mode === "template") {
    hint.textContent =
      "На целевой проект сохранится локальный шаблон-черновик со всеми задачами выбранного шаблона, связями и раскладкой (без создания на бэке). Откройте целевой проект → «Загрузить шаблон», поправьте несовместимые поля и сохраните задачи на бэк. Нужна авторизация на целевом проекте.";
    return;
  }
  hint.textContent =
    "На целевой проект сохранится локальный шаблон-черновик с полными данными задачи (без создания на бэке). Откройте целевой проект → «Загрузить шаблон», поправьте несовместимые поля и сохраните задачу на бэк. Нужна авторизация на целевом проекте.";
}

function setCopyToProjectMode(mode) {
  const next = mode === "template" ? "template" : "task";
  copyToProjectMode = next;
  for (const btn of $("copy-to-project-mode")?.querySelectorAll("[data-mode]") || []) {
    btn.classList.toggle("template-save-mode__btn--active", btn.dataset.mode === next);
  }
  $("copy-to-project-task-section")?.classList.toggle("meta--hidden", next === "template");
  $("copy-to-project-template-section")?.classList.toggle("meta--hidden", next !== "template");
  updateCopyToProjectHint(next);

  if (next === "template") {
    $("copy-to-project-template")?.focus();
  } else {
    $("copy-to-project-domain")?.focus();
  }
}

function fillCopyToProjectDomainSelect() {
  const currentDomain = getCurrentDomain();
  const others = (state.domains || []).filter((d) => d && d !== currentDomain);
  const select = $("copy-to-project-domain");
  if (!select) return others;

  select.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "— Выберите домен —";
  select.appendChild(placeholder);
  for (const domain of others) {
    const opt = document.createElement("option");
    opt.value = domain;
    opt.textContent = domain;
    select.appendChild(opt);
  }
  select.value = "";
  return others;
}

async function populateCopyToProjectTemplateSelect(selectedId = "") {
  const domain = getCurrentDomain();
  const select = $("copy-to-project-template");
  const empty = $("copy-to-project-template-empty");
  const templates = domain ? await getDomainCanvasTemplates(domain) : [];

  if (select) {
    select.replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = templates.length
      ? "— Выберите шаблон —"
      : "— Нет шаблонов —";
    select.appendChild(placeholder);

    for (const tpl of templates) {
      const taskCount = tpl.canvas ? Object.keys(tpl.canvas).length : 0;
      const opt = document.createElement("option");
      opt.value = tpl.id;
      opt.textContent = `${tpl.name} (${taskCount} задач)`;
      select.appendChild(opt);
    }

    const preferred = selectedId || copyToProjectTemplateId || "";
    select.value = preferred && templates.some((t) => t.id === preferred) ? preferred : "";
    copyToProjectTemplateId = select.value || null;
    select.disabled = !templates.length;
  }

  empty?.classList.toggle("meta--hidden", templates.length > 0);
  return templates;
}

async function openCopyToProjectModal(taskId, { mode = "task", templateId = null } = {}) {
  hideCardContextMenu();

  const currentDomain = getCurrentDomain();
  const others = fillCopyToProjectDomainSelect();
  if (!others.length) {
    showToast("Нет других проектов в списке доменов — добавьте админку в popup", {
      type: "warning",
    });
    return;
  }

  const nextMode = mode === "template" ? "template" : "task";
  if (nextMode === "task") {
    const id = String(taskId || "");
    if (!id) return;
    copyToProjectTaskId = id;
    const sourceMeta = $("copy-to-project-source");
    const canvasTask = state.canvas.get(id);
    const name = canvasTask?.name || state.catalog.get(id)?.name || "";
    if (sourceMeta) {
      sourceMeta.textContent = name ? `Задача #${id}: ${name}` : `Задача #${id}`;
    }
  } else {
    copyToProjectTaskId = taskId ? String(taskId) : copyToProjectTaskId;
    if (!copyToProjectTaskId) {
      const sourceMeta = $("copy-to-project-source");
      if (sourceMeta) {
        sourceMeta.textContent =
          "Для режима «Текущая карточка» откройте меню задачи на канве → «Скопировать на другой проект»";
      }
    }
  }

  copyToProjectTemplateId = templateId ? String(templateId) : null;
  await populateCopyToProjectTemplateSelect(copyToProjectTemplateId || "");
  setCopyToProjectMode(nextMode);

  const overlay = $("copy-to-project-overlay");
  overlay?.classList.remove("chains-modal-overlay--hidden");
  overlay?.setAttribute("aria-hidden", "false");

  if (nextMode === "template") {
    $("copy-to-project-template")?.focus();
  } else {
    $("copy-to-project-domain")?.focus();
  }
}

async function openCopyTemplateToProjectModal(templateId) {
  const id = String(templateId || "");
  if (!id) return;
  closeLoadTemplateModal();
  await openCopyToProjectModal(null, { mode: "template", templateId: id });
}

/**
 * Собирает полные тела задач шаблона: из taskBodies или загрузкой с текущего домена.
 * @returns {Promise<{ bodies: Record<string, object>, failed: string[] }>}
 */
async function gatherTaskBodiesForTemplateCopy(template) {
  const canvas = template?.canvas && typeof template.canvas === "object" ? template.canvas : {};
  const existingBodies =
    template?.taskBodies && typeof template.taskBodies === "object" ? template.taskBodies : {};
  const ids = Object.keys(canvas);
  const bodies = {};
  const failed = [];

  for (let i = 0; i < ids.length; i += 1) {
    const id = String(ids[i]);
    setStatus(`Собираю данные задач шаблона: ${i + 1}/${ids.length} (#${id})…`);

    if (existingBodies[id]) {
      bodies[id] = snapshotTaskBodyForDraft(existingBodies[id]);
      continue;
    }

    const canvasTask = state.canvas.get(id);
    if (canvasTask?._full) {
      bodies[id] = snapshotTaskBodyForDraft(canvasTask._full);
      continue;
    }

    if (canvas[id]?.localOnly === true) {
      failed.push(id);
      continue;
    }

    try {
      const full = await loadFullTaskForCopy(id);
      bodies[id] = snapshotTaskBodyForDraft(full);
    } catch {
      failed.push(id);
    }
  }

  return { bodies, failed };
}

function buildLocalDraftTemplateFromSourceTemplate(sourceTemplate, bodies, targetDomain) {
  const currentDomain = getCurrentDomain();
  const srcCanvas =
    sourceTemplate?.canvas && typeof sourceTemplate.canvas === "object" ? sourceTemplate.canvas : {};
  const idMap = new Map();

  for (const oldId of Object.keys(bodies)) {
    idMap.set(String(oldId), newLocalDraftId());
  }

  const canvas = {};
  const taskBodies = {};
  for (const [oldId, body] of Object.entries(bodies)) {
    const newId = idMap.get(String(oldId));
    const layout = srcCanvas[oldId] || {};
    const entry = {
      x: Number.isFinite(Number(layout.x)) ? Number(layout.x) : GRID_START_X,
      y: Number.isFinite(Number(layout.y)) ? Number(layout.y) : GRID_START_Y,
      localOnly: true,
      configuredOnBackend: false,
    };
    const colorId = normalizeHeaderColorId(layout.headerColor);
    if (colorId) entry.headerColor = colorId;
    canvas[newId] = entry;
    taskBodies[newId] = body;
  }

  const edges = [];
  for (const edge of Array.isArray(sourceTemplate?.edges) ? sourceTemplate.edges : []) {
    const from = idMap.get(String(edge.from));
    const to = idMap.get(String(edge.to));
    if (!from || !to || from === to) continue;
    edges.push({ from, to });
  }

  const targetConfigs = {};
  const srcConfigs =
    sourceTemplate?.targetConfigs && typeof sourceTemplate.targetConfigs === "object"
      ? sourceTemplate.targetConfigs
      : {};
  for (const [oldId, cfg] of Object.entries(srcConfigs)) {
    const newId = idMap.get(String(oldId));
    if (!newId || !cfg || typeof cfg !== "object") continue;
    const next = { ...defaultGtConfig(), ...cfg };
    if (Array.isArray(next.list)) {
      next.list = next.list.map((ref) => idMap.get(String(ref))).filter(Boolean);
    }
    targetConfigs[newId] = next;
  }

  const labels = Array.isArray(sourceTemplate?.labels)
    ? sourceTemplate.labels.map((label) => ({ ...label }))
    : [];

  const now = new Date().toISOString();
  const sourceName = String(sourceTemplate?.name || "").trim();
  const templateName = sourceName
    ? `Черновик: ${sourceName}`
    : `Черновик шаблона с ${currentDomain || "источника"}`;

  return {
    id: newTemplateId(),
    name: templateName,
    domain: targetDomain,
    sourceDomain: currentDomain || "",
    sourceTemplateId: sourceTemplate?.id ? String(sourceTemplate.id) : "",
    isLocalDraftTemplate: true,
    createdAt: now,
    updatedAt: now,
    canvas,
    taskBodies,
    edges,
    targetConfigs,
    labels,
    viewport:
      sourceTemplate?.viewport && typeof sourceTemplate.viewport === "object"
        ? { ...sourceTemplate.viewport }
        : { x: 0, y: 0, scale: 1 },
  };
}

async function ensureTargetDomainAuthForCopy(targetDomain, { forTemplate = false } = {}) {
  const authStatus = await queryDomainAuthStatus(targetDomain, { force: true });
  if (isDomainAuthenticated(authStatus)) return true;

  showToast(
    `Нет авторизации на ${targetDomain}. Авторизуйтесь на целевом проекте, чтобы продолжить копирование.`,
    { type: "warning", durationMs: 6000 }
  );
  const authed = await ensureAuthenticated(targetDomain, {
    message: forTemplate
      ? `Для копирования шаблона на ${targetDomain} нужна авторизация на этом проекте`
      : `Для копирования задачи на ${targetDomain} нужна авторизация на этом проекте`,
  });
  if (!authed) {
    showToast(`Копирование отменено: нет авторизации на ${targetDomain}`, { type: "warning" });
    return false;
  }
  return true;
}

async function confirmCopyTaskToProject(taskId, targetDomain) {
  const currentDomain = getCurrentDomain();
  setStatus(`Готовлю локальный черновик для ${targetDomain}…`);
  try {
    const full = await loadFullTaskForCopy(taskId);
    const draftId = newLocalDraftId();
    const sourceName = full?.name || state.canvas.get(String(taskId))?.name || "";
    const templateName = sourceName
      ? `Черновик: ${sourceName}`
      : `Черновик с ${currentDomain || "источника"} (#${taskId})`;

    const now = new Date().toISOString();
    const body = snapshotTaskBodyForDraft(full);
    const template = {
      id: newTemplateId(),
      name: templateName,
      domain: targetDomain,
      sourceDomain: currentDomain || "",
      sourceTaskId: String(taskId),
      isLocalDraftTemplate: true,
      createdAt: now,
      updatedAt: now,
      canvas: {
        [draftId]: {
          x: GRID_START_X,
          y: GRID_START_Y,
          localOnly: true,
          configuredOnBackend: false,
        },
      },
      taskBodies: {
        [draftId]: body,
      },
      edges: [],
      targetConfigs: {},
      labels: [],
      viewport: { x: 0, y: 0, scale: 1 },
    };

    await upsertDomainCanvasTemplate(targetDomain, template);
    showToast(
      `Черновик задачи сохранён на ${targetDomain}. Откройте проект → «Загрузить шаблон», затем поправьте данные перед сохранением на бэк.`,
      { durationMs: 9000 }
    );
    setStatus(`Локальный черновик сохранён в шаблонах ${targetDomain}`);
  } catch (err) {
    showToast(`Не удалось сохранить черновик: ${err.message || err}`, { type: "warning" });
    setStatus(`Ошибка копирования черновика: ${err.message || err}`, true);
  }
}

async function confirmCopyTemplateToProject(templateId, targetDomain) {
  const domain = getCurrentDomain();
  const templates = domain ? await getDomainCanvasTemplates(domain) : [];
  const sourceTemplate = templates.find((tpl) => tpl.id === templateId);
  if (!sourceTemplate) {
    showToast("Шаблон не найден на текущем домене", { type: "warning" });
    return;
  }

  const taskCount = sourceTemplate.canvas ? Object.keys(sourceTemplate.canvas).length : 0;
  if (!taskCount) {
    showToast("В выбранном шаблоне нет задач", { type: "warning" });
    return;
  }

  setStatus(`Готовлю черновик шаблона для ${targetDomain}…`);
  try {
    const { bodies, failed } = await gatherTaskBodiesForTemplateCopy(sourceTemplate);
    const copiedCount = Object.keys(bodies).length;
    if (!copiedCount) {
      showToast(
        "Не удалось загрузить данные ни одной задачи шаблона. Черновик не сохранён.",
        { type: "warning", durationMs: 7000 }
      );
      setStatus("Копирование шаблона отменено: нет данных задач", true);
      return;
    }

    const draftTemplate = buildLocalDraftTemplateFromSourceTemplate(
      sourceTemplate,
      bodies,
      targetDomain
    );
    await upsertDomainCanvasTemplate(targetDomain, draftTemplate);

    const edgeCount = draftTemplate.edges.length;
    let message = `Шаблон «${draftTemplate.name}» сохранён на ${targetDomain} (${copiedCount} задач`;
    if (edgeCount) message += `, ${edgeCount} связей`;
    message += `). Откройте проект → «Загрузить шаблон».`;
    if (failed.length) {
      message += ` Не удалось загрузить ${failed.length} задач: ${failed.slice(0, 8).join(", ")}${
        failed.length > 8 ? "…" : ""
      }.`;
    }
    showToast(message, {
      type: failed.length ? "warning" : "success",
      durationMs: failed.length ? 11000 : 9000,
    });
    setStatus(
      failed.length
        ? `Черновик шаблона сохранён на ${targetDomain} (пропущено ${failed.length})`
        : `Черновик шаблона сохранён в шаблонах ${targetDomain}`
    );
  } catch (err) {
    showToast(`Не удалось скопировать шаблон: ${err.message || err}`, { type: "warning" });
    setStatus(`Ошибка копирования шаблона: ${err.message || err}`, true);
  }
}

async function confirmCopyToProject() {
  const mode = getCopyToProjectMode();
  const targetDomain = normalizeDomainOrEmpty($("copy-to-project-domain")?.value);
  const taskId = copyToProjectTaskId;
  const selectedTemplateId =
    mode === "template"
      ? String($("copy-to-project-template")?.value || copyToProjectTemplateId || "").trim()
      : "";

  if (mode === "task" && !taskId) {
    showToast("Сначала выберите задачу на канве", { type: "warning" });
    return;
  }
  if (mode === "template" && !selectedTemplateId) {
    showToast("Выберите шаблон для копирования", { type: "warning" });
    $("copy-to-project-template")?.focus();
    return;
  }
  if (!targetDomain) {
    showToast("Выберите целевой проект", { type: "warning" });
    $("copy-to-project-domain")?.focus();
    return;
  }

  const currentDomain = getCurrentDomain();
  if (targetDomain === currentDomain) {
    showToast("Выберите другой проект, не текущий", { type: "warning" });
    return;
  }

  closeCopyToProjectModal();

  const authed = await ensureTargetDomainAuthForCopy(targetDomain, {
    forTemplate: mode === "template",
  });
  if (!authed) return;

  if (mode === "template") {
    await confirmCopyTemplateToProject(selectedTemplateId, targetDomain);
    return;
  }
  await confirmCopyTaskToProject(taskId, targetDomain);
}

function bindTemplateEvents() {
  $("btn-save-template")?.addEventListener("click", () => void openSaveTemplateModal());
  $("btn-load-template")?.addEventListener("click", () => void openLoadTemplateModal());
  $("btn-close-save-template")?.addEventListener("click", closeSaveTemplateModal);
  $("btn-cancel-save-template")?.addEventListener("click", closeSaveTemplateModal);
  $("btn-confirm-save-template")?.addEventListener("click", () => void handleSaveTemplate());
  $("btn-close-load-template")?.addEventListener("click", closeLoadTemplateModal);
  $("btn-cancel-load-template")?.addEventListener("click", closeLoadTemplateModal);

  $("template-save-mode")?.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-mode]");
    if (!btn || btn.classList.contains("template-save-mode__btn--active")) return;
    setSaveTemplateMode(btn.dataset.mode);
  });

  $("template-save-name")?.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      void handleSaveTemplate();
    }
  });

  $("template-save-existing")?.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      void handleSaveTemplate();
    }
  });

  $("template-save-overlay")?.addEventListener("click", (ev) => {
    if (ev.target.id === "template-save-overlay") closeSaveTemplateModal();
  });

  $("template-load-overlay")?.addEventListener("click", (ev) => {
    if (ev.target.id === "template-load-overlay") closeLoadTemplateModal();
  });

  $("btn-close-copy-to-project")?.addEventListener("click", closeCopyToProjectModal);
  $("btn-cancel-copy-to-project")?.addEventListener("click", closeCopyToProjectModal);
  $("btn-confirm-copy-to-project")?.addEventListener("click", () => void confirmCopyToProject());
  $("copy-to-project-mode")?.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-mode]");
    if (!btn || btn.classList.contains("template-save-mode__btn--active")) return;
    setCopyToProjectMode(btn.dataset.mode);
  });
  $("copy-to-project-template")?.addEventListener("change", (ev) => {
    copyToProjectTemplateId = String(ev.target.value || "").trim() || null;
  });
  $("copy-to-project-template")?.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      void confirmCopyToProject();
    }
  });
  $("copy-to-project-domain")?.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      void confirmCopyToProject();
    }
  });
  $("copy-to-project-overlay")?.addEventListener("click", (ev) => {
    if (ev.target.id === "copy-to-project-overlay") closeCopyToProjectModal();
  });

  $("template-load-list")?.addEventListener("click", (ev) => {
    const deleteBtn = ev.target.closest(".template-list__delete");
    if (deleteBtn) {
      ev.stopPropagation();
      void handleDeleteTemplate(deleteBtn.dataset.templateId);
      return;
    }

    const copyBtn = ev.target.closest(".template-list__copy-project");
    if (copyBtn) {
      ev.stopPropagation();
      void openCopyTemplateToProjectModal(copyBtn.dataset.templateId);
      return;
    }

    const loadBtn = ev.target.closest(".template-list__load");
    if (!loadBtn) return;

    const domain = getCurrentDomain();
    void getDomainCanvasTemplates(domain).then((templates) => {
      const tpl = templates.find((t) => t.id === loadBtn.dataset.templateId);
      if (tpl) void applyCanvasTemplate(tpl);
    });
  });
}

function getActiveTaskForStats() {
  if (state.selectedTargetId) {
    const task = state.canvas.get(String(state.selectedTargetId));
    return task?._full || task || null;
  }
  if (state.canvasSelected.size === 1) {
    const [taskId] = state.canvasSelected;
    const task = state.canvas.get(String(taskId));
    return task?._full || task || null;
  }
  return null;
}

function getFilteredStatsRows() {
  if (!state.statsTaskOnly) return state.statsRows;
  const activeTask = getActiveTaskForStats();
  const taskName = String(activeTask?.name || "").trim();
  if (!taskName) return state.statsRows;
  return state.statsRows.filter((row) => reportTaskNamesMatch(row.name, taskName));
}

function getStatsProjectFieldMarkup(inferredProjectId) {
  if (state.statsProjectsLoading) {
    return `
      <label class="field">
        <span>Проект</span>
        <select id="stats-project-id" disabled>
          <option>Загрузка проектов…</option>
        </select>
      </label>`;
  }

  if (state.statsProjects.length) {
    const currentId = normalizeProjectId(state.statsProjectId) || normalizeProjectId(inferredProjectId);
    const options = state.statsProjects
      .map(
        (project) =>
          `<option value="${project.id}" ${project.id === currentId ? "selected" : ""}>${escapeHtml(
            project.name
          )} (#${project.id})</option>`
      )
      .join("");
    return `
      <label class="field">
        <span>Проект</span>
        <select id="stats-project-id">
          <option value="" ${currentId ? "" : "selected"} disabled>Выберите проект…</option>
          ${options}
        </select>
      </label>`;
  }

  return `
    <label class="field">
      <span>Project ID${state.statsProjectsError ? " (список недоступен)" : ""}</span>
      <input
        id="stats-project-id"
        type="text"
        inputmode="numeric"
        placeholder="${inferredProjectId || "например, 13"}"
        value="${state.statsProjectId || ""}"
      />
    </label>
    <button id="btn-stats-projects-retry" class="btn" type="button">Загрузить проекты</button>`;
}

async function loadReportsProjects({ force = false } = {}) {
  if (state.statsProjectsLoading) return;
  if (state.statsProjectsLoaded && !force) return;

  state.statsProjectsLoading = true;
  state.statsProjectsError = "";
  renderStatsPanel();

  try {
    const result = await chrome.runtime.sendMessage({ action: "PH_REPORTS_STATE" });
    if (!result?.ok) {
      throw new Error(result?.errorCode || result?.error || "REPORTS_STATE_FAILED");
    }
    const { projects, activeProjectId } = extractReportsProjects(result.data);
    state.statsProjects = projects;
    state.statsProjectsLoaded = true;
    if (!normalizeProjectId(state.statsProjectId)) {
      const inferred = inferProjectIdFromDomain(state.selectedDomain || $("domain-select")?.value || "");
      state.statsProjectId = normalizeProjectId(inferred) || normalizeProjectId(activeProjectId) || "";
    }
  } catch (err) {
    state.statsProjectsError = formatReportsFetchError(err);
  } finally {
    state.statsProjectsLoading = false;
    renderStatsPanel();
  }
}

async function ensureStatsLoaded() {
  await loadReportsProjects();
  if (!state.statsRows.length && !state.statsLoading) {
    void loadStatsReport();
  }
}

function getStatsPanelMarkup() {
  const activeTask = getActiveTaskForStats();
  const activeTaskLabel = activeTask ? `#${activeTask.id} ${activeTask.name || ""}` : "не выбрана";
  const inferredProjectId = inferProjectIdFromDomain(state.selectedDomain);
  const effectiveProjectId = normalizeProjectId(state.statsProjectId || inferredProjectId);
  const payload = state.statsPayload || buildReportsPayload({ projectId: effectiveProjectId });
  const rows = getFilteredStatsRows();
  const groupedRows = groupStatsRowsByTask(rows);
  const metrics = computeMetrics(rows, payload?.period);
  const statusClass = state.statsError ? "stats-panel__status stats-panel__status--error" : "stats-panel__status";
  const activeTaskMissing =
    state.statsTaskOnly &&
    activeTask &&
    state.statsRows.length > 0 &&
    !rows.length &&
    !state.statsLoading &&
    !state.statsError;
  const statusText = state.statsLoading
    ? "Загрузка отчета..."
    : state.statsError
      ? state.statsError
      : activeTaskMissing
        ? `Задача «${activeTask.name || activeTask.id}» не найдена в отчёте за выбранный период. Проверьте даты и проект.`
        : state.statsUpdatedAt
          ? `Обновлено: ${state.statsUpdatedAt}. Строк: ${rows.length}${
              state.statsReportCountAll != null && state.statsRows.length < state.statsReportCountAll
                ? ` (загружено ${state.statsRows.length} из ${state.statsReportCountAll})`
                : ""
            }`
          : "Отчет не загружен";

  return `
    <div class="stats-panel">
      <h2>Статистика задач</h2>
      <div class="stats-panel__controls">
        <label class="field">
          <span>Период от</span>
          <input id="stats-period-from" type="date" value="${payload.period?.from || ""}" />
        </label>
        <label class="field">
          <span>Период до</span>
          <input id="stats-period-to" type="date" value="${payload.period?.to || ""}" />
        </label>
        ${getStatsProjectFieldMarkup(inferredProjectId)}
        <button id="btn-stats-refresh" class="btn btn--primary" type="button" ${state.statsLoading ? "disabled" : ""}>Обновить</button>
        <label class="field">
          <span>Фильтр по задаче</span>
          <label>
            <input id="stats-task-only" type="checkbox" ${state.statsTaskOnly ? "checked" : ""} ${activeTask ? "" : "disabled"} />
            Только выбранная на канве (${activeTaskLabel})
          </label>
        </label>
      </div>
      <div class="${statusClass}">${statusText}</div>
      <div class="stats-metrics">
        <div class="stats-card"><div class="stats-card__title">Уникальных задач</div><div class="stats-card__value">${formatMetricNumber(metrics.uniqueTasks)}</div></div>
        <div class="stats-card"><div class="stats-card__title">Дней в выборке</div><div class="stats-card__value">${formatMetricNumber(metrics.daysCount)}</div></div>
        <div class="stats-card"><div class="stats-card__title">Всего задач (sum)</div><div class="stats-card__value">${formatMetricNumber(metrics.tasksCount)}</div></div>
        <div class="stats-card"><div class="stats-card__title">Завершено</div><div class="stats-card__value">${formatMetricNumber(metrics.tasksFinished)}</div></div>
        <div class="stats-card"><div class="stats-card__title">Успешность</div><div class="stats-card__value">${formatMetricNumber(metrics.completionRate, 2)}%</div></div>
        <div class="stats-card"><div class="stats-card__title">Сумма ставок</div><div class="stats-card__value">${formatMetricNumber(metrics.betsSum, 2)}</div></div>
        <div class="stats-card"><div class="stats-card__title">Сумма депозитов</div><div class="stats-card__value">${formatMetricNumber(metrics.depositsSum, 2)}</div></div>
        <div class="stats-card"><div class="stats-card__title">Конверсия депозиты/ставки</div><div class="stats-card__value">${formatMetricNumber(metrics.depositsToBetsRate, 2)}%</div></div>
      </div>
      <div id="stats-chart-mount" class="stats-chart-wrap">
        ${getTaskChartsMarkup(groupedRows)}
      </div>
    </div>
  `;
}

function renderStatsPanel() {
  const mount = $("stats-panel-mount");
  if (!mount) return;
  mount.innerHTML = getStatsPanelMarkup();
  const chartMount = $("stats-chart-mount");
  if (chartMount) {
    const groupedRows = groupStatsRowsByTask(getFilteredStatsRows());
    mountTaskCharts(chartMount, groupedRows, formatMetricNumber);
  }
  bindStatsEvents();
}

function setMainView(view) {
  state.currentMainView = view === "stats" ? "stats" : "canvas";
  const isStats = state.currentMainView === "stats";
  $("view-canvas")?.classList.toggle("main-view--active", !isStats);
  $("view-stats")?.classList.toggle("main-view--active", isStats);
  $("view-canvas")?.setAttribute("aria-hidden", String(isStats));
  $("view-stats")?.setAttribute("aria-hidden", String(!isStats));
  $("tab-canvas")?.classList.toggle("main-tabs__btn--active", !isStats);
  $("tab-stats")?.classList.toggle("main-tabs__btn--active", isStats);
  $("tab-canvas")?.setAttribute("aria-selected", String(!isStats));
  $("tab-stats")?.setAttribute("aria-selected", String(isStats));
}

function clearStatsFetchDebounce() {
  if (!state.statsFetchDebounceTimer) return;
  clearTimeout(state.statsFetchDebounceTimer);
  state.statsFetchDebounceTimer = null;
}

function scheduleStatsReportReload(delayMs = 250) {
  clearStatsFetchDebounce();
  state.statsFetchDebounceTimer = setTimeout(() => {
    state.statsFetchDebounceTimer = null;
    void loadStatsReport({ force: true });
  }, delayMs);
}

async function loadStatsReport({ force = false } = {}) {
  const fromInput = $("stats-period-from")?.value || "";
  const toInput = $("stats-period-to")?.value || "";
  const manualProjectId = $("stats-project-id")?.value || "";
  const inferredProjectId = inferProjectIdFromDomain(state.selectedDomain || $("domain-select")?.value || "");
  const projectId = normalizeProjectId(manualProjectId || inferredProjectId);

  if (!projectId) {
    state.statsError =
      "Не определен Project ID. Укажите его в поле Project ID на вкладке «Статистика» и повторите загрузку.";
    state.statsLoading = false;
    renderStatsPanel();
    return;
  }

  state.statsProjectId = projectId;
  const payload = buildReportsPayload({ from: fromInput, to: toInput, projectId });
  state.statsPayload = payload;
  state.statsUpdatedAt = "";
  state.statsLoading = true;
  state.statsError = "";
  const requestSeq = ++state.statsFetchSeq;
  state.statsActiveFetchSeq = requestSeq;
  renderStatsPanel();
  if (force) {
    console.debug("[chains:stats] force fetch", payload);
  } else {
    console.debug("[chains:stats] fetch", payload);
  }

  try {
    const result = await chrome.runtime.sendMessage({
      action: "PH_REPORTS_FETCH",
      payload: { body: payload },
    });
    if (!result?.ok) {
      throw new Error(result?.errorCode || result?.error || `HTTP ${result?.status || "unknown"}`);
    }
    if (requestSeq !== state.statsActiveFetchSeq) {
      console.debug("[chains:stats] stale response ignored", { requestSeq, active: state.statsActiveFetchSeq });
      return;
    }
    state.statsRows = normalizeReportRows(result.data);
    state.statsReportCountAll = extractReportCountAll(result.data);
    state.statsUpdatedAt = new Date().toLocaleString("ru-RU");
    state.statsError = "";
  } catch (err) {
    if (requestSeq !== state.statsActiveFetchSeq) return;
    state.statsError = formatReportsFetchError(err);
  } finally {
    if (requestSeq !== state.statsActiveFetchSeq) return;
    state.statsLoading = false;
    renderStatsPanel();
  }
}

function bindStatsEvents() {
  $("btn-stats-refresh")?.addEventListener("click", () => {
    clearStatsFetchDebounce();
    if (!state.statsProjectsLoaded && !state.statsProjectsLoading) {
      void loadReportsProjects();
    }
    void loadStatsReport({ force: true });
  });
  $("btn-stats-projects-retry")?.addEventListener("click", () => {
    void loadReportsProjects({ force: true });
  });
  $("stats-period-from")?.addEventListener("change", () => {
    scheduleStatsReportReload();
  });
  $("stats-period-to")?.addEventListener("change", () => {
    scheduleStatsReportReload();
  });
  $("stats-project-id")?.addEventListener("change", (ev) => {
    state.statsProjectId = String(ev.target?.value || "").trim();
    scheduleStatsReportReload();
  });
  $("stats-task-only")?.addEventListener("change", (ev) => {
    state.statsTaskOnly = !!ev.target?.checked;
    renderStatsPanel();
  });
}

function bindEvents() {
  $("domain-select").addEventListener("change", () => {
    state.selectedDomain = normalizeDomainOrEmpty($("domain-select").value);
    if (!normalizeProjectId(state.statsProjectId)) {
      state.statsProjectId = inferProjectIdFromDomain(state.selectedDomain);
    }
    void handleDomainSwitch();
  });

  $("domain-auth-indicator")?.addEventListener("click", () => {
    if ($("domain-auth-indicator")?.dataset.action === "complete-otp") {
      void promptCompleteOtpAuth();
    }
  });
  $("btn-complete-auth-otp")?.addEventListener("click", () => void promptCompleteOtpAuth());

  $("btn-load-tasks").addEventListener("click", () => loadTasks(true));
  $("btn-load-more").addEventListener("click", () => loadTasks(false, false));
  $("btn-add-to-canvas").addEventListener("click", () => addSelectedToCanvas());
  $("btn-align").addEventListener("click", () => alignCanvas());
  $("btn-zoom-in")?.addEventListener("click", () => zoomBy(ZOOM_STEP * ZOOM_STEP));
  $("btn-zoom-out")?.addEventListener("click", () => zoomBy(1 / (ZOOM_STEP * ZOOM_STEP)));
  $("btn-zoom-fit")?.addEventListener("click", () => fitCanvasToView());
  $("zoom-indicator")?.addEventListener("click", () => resetZoom());
  $("btn-toggle-catalog")?.addEventListener("click", () => toggleCatalogCollapsed());
  $("btn-collapse-catalog")?.addEventListener("click", () => setCatalogCollapsed(true));
  $("btn-expand-catalog")?.addEventListener("click", () => setCatalogCollapsed(false));
  $("btn-select-all-canvas")?.addEventListener("click", () => selectAllOnCanvas());
  $("btn-clear-canvas-selection")?.addEventListener("click", () => clearCanvasSelection());
  $("btn-remove-selected-canvas")?.addEventListener("click", () => removeSelectedFromCanvas());
  $("btn-clear-canvas")?.addEventListener("click", () => clearCanvas());
  $("btn-remove-from-canvas")?.addEventListener("click", () => removeSelectedFromCanvas());
  $("btn-clear-all-from-catalog")?.addEventListener("click", () => clearCanvas());
  $("btn-select-all").addEventListener("click", () => selectAllVisible(true));
  $("btn-select-none").addEventListener("click", () => selectAllVisible(false));
  $("btn-save").addEventListener("click", () => saveChanges());
  $("btn-close-panel").addEventListener("click", closePanel);
  $("btn-close-log").addEventListener("click", () => $("save-log").classList.add("save-log--hidden"));
  $("btn-close-copy-panel").addEventListener("click", closeCopyPanel);
  $("copy-panel-backdrop").addEventListener("click", closeCopyPanel);

  $("check-blocks")?.addEventListener("change", (ev) => {
    state.checkBlocks = !!ev.target.checked;
    updateCardBlockConflictClasses();
    if (state.checkBlocks) {
      const count = state.blockConflicts.length;
      if (!count) {
        setStatus("Проверка блоков: конфликтов не найдено");
      } else {
        setStatus(
          `Проверка блоков: ${count} ${pluralConflicts(count)} — задачи с кнопкой «Согласие игрока» и одинаковым целевым действием`,
          true
        );
      }
    } else {
      setStatus("Проверка блоков отключена");
    }
  });

  $("card-context-menu").addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-action]");
    if (!btn || !contextMenuTaskId) return;
    if (btn.dataset.action === "edit") openEditPanel(contextMenuTaskId);
    if (btn.dataset.action === "copy") openCopyPanel(contextMenuTaskId);
    if (btn.dataset.action === "copy-to-project") {
      void openCopyToProjectModal(contextMenuTaskId);
      return;
    }
    if (btn.dataset.action === "set-color") {
      ev.stopPropagation();
      setTaskHeaderColor(contextMenuTaskId, btn.dataset.color || null);
    }
    if (btn.dataset.action === "toggle-backend") {
      toggleTaskBackendConfigured(contextMenuTaskId);
    }
  });

  initCardColorContextMenu();

  document.addEventListener("click", (ev) => {
    if (!ev.target.closest("#card-context-menu")) hideCardContextMenu();
    if (!ev.target.closest("#canvas-context-menu")) hideCanvasContextMenu();
  });

  document.addEventListener("contextmenu", (ev) => {
    if (!ev.target.closest("#card-context-menu")) hideCardContextMenu();
    if (!ev.target.closest("#canvas-context-menu")) hideCanvasContextMenu();
  });

  initCatalogSearch();
  bindTemplateEvents();

  $("tab-canvas")?.addEventListener("click", () => setMainView("canvas"));
  $("tab-stats")?.addEventListener("click", () => {
    setMainView("stats");
    renderStatsPanel();
    void ensureStatsLoaded();
  });

  $("catalog-status-filter")?.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-status]");
    if (!btn) return;
    const next = btn.dataset.status;
    if (!next || next === state.catalogStatusFilter) return;
    state.catalogStatusFilter = next;
    for (const el of $("catalog-status-filter").querySelectorAll("[data-status]")) {
      el.classList.toggle("catalog-status-filter__btn--active", el.dataset.status === next);
    }
    updateCounters();
    renderTaskList();
  });

  document.addEventListener("mousemove", onDocumentMouseMove);
  document.addEventListener("mouseup", onDocumentMouseUp);

  const canvasWrap = $("canvas-wrap");
  canvasWrap.addEventListener("mousedown", onCanvasPanMouseDown);
  canvasWrap.addEventListener("wheel", onCanvasWheel, { passive: false });

  canvasWrap.addEventListener("click", (ev) => {
    if (state.panMoved) {
      state.panMoved = false;
      return;
    }
    if (ev.target.closest(".task-card") || ev.target.closest(".edge-hit") || ev.target.closest(".canvas-label")) return;
    if (!ev.shiftKey && state.canvasSelected.size) {
      clearCanvasSelection();
    }
    clearCanvasLabelSelection();
    state.linkSourceId = null;
    closePanel();
  });

  canvasWrap.addEventListener("contextmenu", (ev) => {
    if (ev.target.closest(".task-card") || ev.target.closest(".canvas-label")) return;
    showCanvasContextMenu(ev);
  });

  $("btn-add-label")?.addEventListener("click", () => {
    const center = getViewportCenterCanvasCoords();
    addCanvasLabel(center.x, center.y);
  });

  $("canvas-context-menu")?.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-action]");
    if (!btn) return;
    if (btn.dataset.action === "add-label" && canvasContextMenuPoint) {
      addCanvasLabel(canvasContextMenuPoint.x, canvasContextMenuPoint.y);
    }
    hideCanvasContextMenu();
  });

  document.addEventListener("keydown", (ev) => {
    if (isTypingTarget(ev.target)) return;

    if ((ev.key === "Delete" || ev.key === "Backspace") && state.selectedLabelId) {
      ev.preventDefault();
      removeCanvasLabel(state.selectedLabelId);
      return;
    }

    if ((ev.key === "Delete" || ev.key === "Backspace") && state.canvasSelected.size > 0) {
      ev.preventDefault();
      removeSelectedFromCanvas();
      return;
    }

    if (ev.key === "Delete" && state.selectedEdgeKey) {
      const { from, to } = parseEdgeKey(state.selectedEdgeKey);
      removeEdge(from, to);
      state.selectedEdgeKey = null;
      if (getIncomingEdges(to).length) openTargetPanel(to, `Задача #${to}`);
      else closePanel();
      renderCards();
    }
    if (ev.key === "Escape") {
      if (isTemplateModalOpen()) {
        closeSaveTemplateModal();
        closeLoadTemplateModal();
        closeCopyToProjectModal();
        return;
      }
      if (isCopyPanelOpen()) {
        closeCopyPanel();
        return;
      }
      if (state.canvasSelected.size > 0) {
        clearCanvasSelection();
        return;
      }
      if (state.selectedLabelId) {
        clearCanvasLabelSelection();
        return;
      }
      state.linkSourceId = null;
      closePanel();
    }
  });
}

async function init() {
  try {
    copyPanel = mountCopyPanel($("copy-panel-mount"), {
      title: "Параметры копии",
      showPreview: true,
      getDomain: () =>
        copyCrossDomainTarget ||
        state.selectedDomain ||
        normalizeDomainOrEmpty($("domain-select").value),
      getTaskOptions: buildCatalogTaskOptions,
      onCreate: handleCopyCreate,
      onUpdate: handleEditUpdate,
    });

    mountAuthModal();
    await loadDomains();
    state.statsProjectId = inferProjectIdFromDomain(state.selectedDomain);
    void copyPanel.loadMeta(state.selectedDomain);
    bindEvents();
    renderStatsPanel();
    setMainView("canvas");
    applyViewportTransform();
    updateCounters();
    updateCanvasSelectionUI();
    if (!state.domains.length) {
      setStatus("Нет сохранённых доменов. Добавьте админку в popup.", true);
      return;
    }
    setStatus("Нажмите «Загрузить задачи»");
  } catch (err) {
    setStatus(`Ошибка инициализации: ${err.message || err}`, true);
  }
}

init();
