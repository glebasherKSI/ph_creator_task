import { PAGE_SIZE } from "../shared/constants.js";
import {
  fillDomainSelect,
  loadDomainsFromStorage,
  normalizeDomainOrEmpty,
} from "../shared/domains.js";
import { apiFetch, apiFetchResult, resolveAdminTab } from "../shared/api.js";
import { mountCopyPanel } from "../shared/copy-panel.js";
import {
  isVisibleTaskState,
  taskFromResponse,
  taskListFromResponse,
  resolveCreatedTaskId,
} from "../shared/tasks.js";
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
import { escapeHtml } from "../shared/format.js";
import { getTaskChartsMarkup, groupStatsRowsByTask, mountTaskCharts } from "../shared/stats-charts.js";

const state = {
  domains: [],
  selectedDomain: "",
  selectedTabId: null,
  tasks: [],
  offset: 0,
  hasMore: false,
  activeTaskId: null,
  tasksHiddenByState: 0,
  tasksStatusFilter: "all",
  currentMainView: "editor",
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

function setStatus(text, isError = false) {
  const el = $("status");
  el.textContent = text;
  el.classList.toggle("status--error", !!isError);
}

async function loadDomains() {
  state.domains = await loadDomainsFromStorage();
  state.selectedDomain = fillDomainSelect($("domain-select"), state.domains, state.selectedDomain);
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

function taskMatchesStatusFilter(task) {
  if (state.tasksStatusFilter === "all") return true;
  const taskState = String(task?.state ?? "draft").toLowerCase();
  return taskState === state.tasksStatusFilter;
}

function getTasksCountByStatusFilter() {
  if (state.tasksStatusFilter === "all") return state.tasks.length;
  return state.tasks.filter(taskMatchesStatusFilter).length;
}

function renderTaskList() {
  const list = $("tasks-list");
  list.innerHTML = "";
  const visibleTasks = state.tasks.filter(taskMatchesStatusFilter);

  if (!visibleTasks.length) {
    const empty = document.createElement("div");
    empty.className = "tasks-list__empty";
    empty.textContent = state.tasks.length
      ? "Ничего не найдено по фильтру"
      : "Список пуст — загрузите задачи";
    list.appendChild(empty);
  }

  for (const task of visibleTasks) {
    const item = document.createElement("article");
    item.className = "task-item";
    if (task.id === state.activeTaskId) item.classList.add("task-item--active");
    const event = Array.isArray(task.events) ? task.events[0] || "—" : task.event || "—";
    item.innerHTML = `
      <div class="task-item__name">#${task.id} ${task.name || "(без названия)"}</div>
      <div class="task-item__meta">
        <span>frontend_identifier: ${task.frontend_identifier || "—"}</span>
        <span>enabled: ${String(task.enabled ?? "—")}</span>
        <span>event: ${event}</span>
      </div>
    `;
    item.addEventListener("click", () => loadTask(task.id));
    list.appendChild(item);
  }
  $("tasks-count").textContent = `${getTasksCountByStatusFilter()} задач${
    state.tasksHiddenByState > 0 ? `, скрыто ${state.tasksHiddenByState}` : ""
  }`;
  $("tasks-filter-hint")?.classList.remove("meta--hidden");
  $("tasks-page").textContent = `offset: ${state.offset}`;
  $("btn-load-more").disabled = !state.hasMore;
  renderStatsPanel();
}

function getActiveTask() {
  return state.tasks.find((task) => task.id === state.activeTaskId) || null;
}

function getFilteredStatsRows() {
  if (!state.statsTaskOnly) return state.statsRows;
  const activeTask = getActiveTask();
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

function getStatsPanelMarkup() {
  const activeTask = getActiveTask();
  const activeTaskLabel = activeTask ? `#${activeTask.id} ${activeTask.name || ""}` : "не выбрана";
  const inferredProjectId = inferProjectIdFromDomain(state.selectedDomain || $("domain-select")?.value || "");
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
            Только выбранная (${activeTaskLabel})
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
  state.currentMainView = view === "stats" ? "stats" : "editor";
  const isStats = state.currentMainView === "stats";
  $("view-editor")?.classList.toggle("main-view--active", !isStats);
  $("view-stats")?.classList.toggle("main-view--active", isStats);
  $("view-editor")?.setAttribute("aria-hidden", String(isStats));
  $("view-stats")?.setAttribute("aria-hidden", String(!isStats));
  $("tab-editor")?.classList.toggle("main-tabs__btn--active", !isStats);
  $("tab-stats")?.classList.toggle("main-tabs__btn--active", isStats);
  $("tab-editor")?.setAttribute("aria-selected", String(!isStats));
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
    console.debug("[editor:stats] force fetch", payload);
  } else {
    console.debug("[editor:stats] fetch", payload);
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
      console.debug("[editor:stats] stale response ignored", { requestSeq, active: state.statsActiveFetchSeq });
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

async function loadTasks(reset = true) {
  if (reset) {
    state.offset = 0;
    state.tasks = [];
    state.hasMore = false;
    state.tasksHiddenByState = 0;
  }
  setStatus("Загружаю список задач...");
  const data = await callApi(
    `/admin/api/gamification/tasks?limit=${PAGE_SIZE}&offset=${state.offset}&locale=ru`
  );
  const page = taskListFromResponse(data);
  state.offset += page.length;
  state.hasMore = page.length === PAGE_SIZE;

  for (const raw of page) {
    if (!isVisibleTaskState(raw)) {
      state.tasksHiddenByState += 1;
      continue;
    }
    state.tasks.push(raw);
  }

  renderTaskList();
  const hiddenNote =
    state.tasksHiddenByState > 0 ? `, скрыто по статусу: ${state.tasksHiddenByState}` : "";
  setStatus(`Загружено ${state.tasks.length} задач (Активно и Черновик)${hiddenNote} с ${state.selectedDomain}`);
}

async function loadTask(taskId) {
  setStatus(`Загружаю задачу #${taskId}...`);
  const data = await callApi(`/admin/api/gamification/tasks/${taskId}?locale=ru`);
  const task = taskFromResponse(data);
  if (!task) throw new Error("API не вернул объект gamification_task");
  state.activeTaskId = task.id;
  copyPanel.fillFromTask(task);
  renderTaskList();
  renderStatsPanel();
  copyPanel.printResult(task);
  copyPanel.setStatus(`Задача #${taskId} загружена`);
  setStatus(`Задача #${taskId} загружена`);
}

async function createCopy(requestBody) {
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

  const msg = `Копия создана, новая задача #${newId}`;
  copyPanel.setStatus(msg);
  setStatus(msg);
  return response;
}

function bindEvents() {
  $("domain-select").addEventListener("change", () => {
    state.selectedDomain = normalizeDomainOrEmpty($("domain-select").value);
    if (!normalizeProjectId(state.statsProjectId)) {
      state.statsProjectId = inferProjectIdFromDomain(state.selectedDomain);
    }
    void copyPanel?.loadMeta(state.selectedDomain);
  });

  $("btn-load-tasks").addEventListener("click", async () => {
    try {
      await loadTasks(true);
    } catch (err) {
      setStatus(`Ошибка загрузки списка: ${err.message || err}`, true);
    }
  });

  $("btn-load-more").addEventListener("click", async () => {
    try {
      await loadTasks(false);
    } catch (err) {
      setStatus(`Ошибка загрузки ещё: ${err.message || err}`, true);
    }
  });

  $("tasks-status-filter")?.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-status]");
    if (!btn) return;
    const next = btn.dataset.status;
    if (!next || next === state.tasksStatusFilter) return;
    state.tasksStatusFilter = next;
    for (const el of $("tasks-status-filter").querySelectorAll("[data-status]")) {
      el.classList.toggle("tasks-status-filter__btn--active", el.dataset.status === next);
    }
    renderTaskList();
  });

  $("btn-open-chains")?.addEventListener("click", async () => {
    const url = chrome.runtime.getURL("src/chains/chains.html");
    await chrome.tabs.create({ url });
  });

  $("tab-editor")?.addEventListener("click", () => setMainView("editor"));
  $("tab-stats")?.addEventListener("click", () => {
    setMainView("stats");
    renderStatsPanel();
    void ensureStatsLoaded();
  });
}

async function ensureStatsLoaded() {
  await loadReportsProjects();
  if (!state.statsRows.length && !state.statsLoading) {
    void loadStatsReport();
  }
}

async function init() {
  try {
    copyPanel = mountCopyPanel($("copy-panel-mount"), {
      getDomain: () => state.selectedDomain || normalizeDomainOrEmpty($("domain-select").value),
      onCreate: createCopy,
    });

    await loadDomains();
    state.statsProjectId = inferProjectIdFromDomain(state.selectedDomain);
    void copyPanel.loadMeta(state.selectedDomain);
    bindEvents();
    renderStatsPanel();
    setMainView("editor");
    if (!state.domains.length) {
      setStatus("Нет сохранённых доменов. Добавьте админку в popup.", true);
      return;
    }
    setStatus("Готово. Нажмите «Загрузить задачи»");
  } catch (err) {
    setStatus(`Ошибка инициализации: ${err.message || err}`, true);
  }
}

init();
