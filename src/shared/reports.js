const REPORTS_ORIGIN = "https://reports.maxbit.private";
const REPORTS_ENDPOINT = `${REPORTS_ORIGIN}/reports/gamification-tasks`;
const SET_ACTIVE_PROJECT_ENDPOINT = `${REPORTS_ORIGIN}/set-active-project`;
const REPORTS_STATE_ENDPOINT = `${REPORTS_ORIGIN}/state/0`;

export const REPORTS_FETCH_ERRORS = {
  TAB_REQUIRED: "REPORTS_TAB_REQUIRED",
  SESSION_MISSING: "REPORTS_SESSION_MISSING",
  XSRF_MISSING: "REPORTS_XSRF_MISSING",
  SSL_ERROR: "REPORTS_SSL_ERROR",
  SCRIPT_FAILED: "REPORTS_SCRIPT_FAILED",
};

export function formatReportsFetchError(err) {
  const raw = String(err?.message || err || "").trim();
  const code = raw.startsWith("REPORTS_") ? raw : "";

  const byCode = {
    [REPORTS_FETCH_ERRORS.TAB_REQUIRED]:
      "Откройте https://reports.maxbit.private в браузере (вкладка должна оставаться открытой), примите сертификат при первом заходе и нажмите «Обновить».",
    [REPORTS_FETCH_ERRORS.SESSION_MISSING]:
      "Вы не авторизованы в Reports. Откройте https://reports.maxbit.private, войдите в систему и повторите загрузку.",
    [REPORTS_FETCH_ERRORS.XSRF_MISSING]:
      "Не найден XSRF-токен. Обновите страницу Reports и повторите загрузку.",
    [REPORTS_FETCH_ERRORS.SSL_ERROR]:
      "Ошибка SSL-сертификата Reports. Откройте https://reports.maxbit.private в браузере, примите сертификат и повторите загрузку.",
    [REPORTS_FETCH_ERRORS.SCRIPT_FAILED]:
      "Не удалось выполнить запрос на вкладке Reports. Обновите страницу https://reports.maxbit.private и повторите попытку.",
  };

  if (byCode[code]) return byCode[code];
  if (/ERR_CERT|CERT_AUTHORITY|SSL|certificate/i.test(raw)) return byCode[REPORTS_FETCH_ERRORS.SSL_ERROR];
  if (/Failed to fetch/i.test(raw)) {
    return "Не удалось подключиться к Reports. Убедитесь, что вкладка https://reports.maxbit.private открыта, и повторите загрузку.";
  }
  const httpMatch = raw.match(/HTTP\s*(\d{3})/i);
  if (httpMatch) {
    return `Сервер Reports вернул ошибку ${httpMatch[1]}. Проверьте авторизацию и повторите загрузку.`;
  }
  if (!raw) return "Не удалось загрузить отчёт из Reports.";
  return `Ошибка загрузки отчёта: ${raw}`;
}

export const REPORTS_DEFAULT_PAYLOAD = {
  reportId: 71,
  currentPage: 1,
  perPage: 500,
  period: {
    type: "date_range",
    from: "",
    to: "",
  },
  filters: {
    date_range: {
      start: "",
      end: "",
    },
    date_start: "",
    date_end: "",
    created_at_start: "",
    created_at_end: "",
    month_start: "",
    month_end: "",
    created_at_period: "1",
  },
};

const DOMAIN_PROJECT_ID_MAP = Object.freeze({
  "admin.crimson.lex.prd.maxbit.private": "13",
});

function toDateInputValue(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function buildReportsPayload({ from, to, projectId } = {}) {
  const today = new Date();
  const fromDate = new Date(today);
  fromDate.setDate(fromDate.getDate() - 6);

  const fromValue = from || toDateInputValue(fromDate);
  const toValue = to || toDateInputValue(today);

  const normalizedProjectId = normalizeProjectId(projectId);

  return {
    ...REPORTS_DEFAULT_PAYLOAD,
    ...(normalizedProjectId ? { project_id: normalizedProjectId } : {}),
    period: {
      ...REPORTS_DEFAULT_PAYLOAD.period,
      from: fromValue,
      to: toValue,
    },
    filters: {
      ...REPORTS_DEFAULT_PAYLOAD.filters,
      date_range: {
        ...REPORTS_DEFAULT_PAYLOAD.filters.date_range,
        start: fromValue,
        end: toValue,
      },
      date_start: fromValue,
      date_end: toValue,
      created_at_start: fromValue,
      created_at_end: toValue,
      month_start: fromValue,
      month_end: toValue,
      created_at_period: "1",
    },
  };
}

export function normalizeProjectId(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (!/^\d+$/.test(raw)) return "";
  const asNumber = Number(raw);
  if (!Number.isInteger(asNumber) || asNumber <= 0) return "";
  return String(asNumber);
}

// Разбирает ответ GET /state/0: список проектов и текущий активный проект.
export function extractReportsProjects(data) {
  const list = Array.isArray(data?.projects) ? data.projects : [];
  const projects = list
    .map((item) => ({
      id: normalizeProjectId(item?.id),
      name: String(item?.name ?? "").trim(),
    }))
    .filter((item) => item.id)
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  return {
    projects,
    activeProjectId: normalizeProjectId(data?.active_project_id),
  };
}

export function inferProjectIdFromDomain(domain) {
  const normalizedDomain = String(domain ?? "").trim().toLowerCase();
  if (!normalizedDomain) return "";

  const fromDirectMap = DOMAIN_PROJECT_ID_MAP[normalizedDomain];
  if (fromDirectMap) return fromDirectMap;

  if (normalizedDomain.includes(".lex.")) return "13";
  return "";
}

function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const normalized = String(value ?? "")
    .replace(/\s+/g, "")
    .replace("%", "")
    .replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeReportRows(response) {
  const rowsRaw = Array.isArray(response?.rows) ? response.rows : [];
  return rowsRaw.map((row) => ({
    projectId: String(row?.project_id ?? "--"),
    name: String(row?.name ?? "").trim(),
    period: String(row?.period ?? ""),
    tasksCount: toNumber(row?.tasks_count),
    tasksActive: toNumber(row?.tasks_active),
    tasksExpired: toNumber(row?.tasks_expired),
    tasksFinished: toNumber(row?.tasks_finished),
    tasksFinishedPercent: toNumber(row?.tasks_finished_percent),
    depositsSum: toNumber(row?.deposits_sum),
    depositsCount: toNumber(row?.deposits_count),
    betsSum: toNumber(row?.bets_sum),
    betsCount: toNumber(row?.bets_count),
    sportBetsSum: toNumber(row?.sport_bets_sum),
    sportBetsCount: toNumber(row?.sport_bets_count),
  }));
}

function parseIsoDate(value) {
  const raw = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [y, m, d] = raw.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return Number.isNaN(date.getTime()) ? null : date;
}

function computeInclusiveDays(from, to) {
  const fromDate = parseIsoDate(from);
  const toDate = parseIsoDate(to);
  if (!fromDate || !toDate) return 0;
  const ms = toDate.getTime() - fromDate.getTime();
  if (ms < 0) return 0;
  return Math.floor(ms / 86400000) + 1;
}

export function computeMetrics(rows, period = {}) {
  const totals = rows.reduce(
    (acc, row) => {
      acc.tasksCount += row.tasksCount;
      acc.tasksActive += row.tasksActive;
      acc.tasksFinished += row.tasksFinished;
      acc.tasksExpired += row.tasksExpired;
      acc.depositsSum += row.depositsSum;
      acc.depositsCount += row.depositsCount;
      acc.betsSum += row.betsSum;
      acc.betsCount += row.betsCount;
      return acc;
    },
    {
      tasksCount: 0,
      tasksActive: 0,
      tasksFinished: 0,
      tasksExpired: 0,
      depositsSum: 0,
      depositsCount: 0,
      betsSum: 0,
      betsCount: 0,
    }
  );

  const uniqueTasks = new Set(rows.map((row) => row.name).filter(Boolean)).size;
  const daysFromRange = computeInclusiveDays(period?.from, period?.to);
  const daysFromRows = new Set(rows.map((row) => row.period).filter(Boolean)).size;
  const daysCount = daysFromRange || daysFromRows;
  const completionRate = totals.tasksCount > 0 ? (totals.tasksFinished / totals.tasksCount) * 100 : 0;
  const depositsToBetsRate = totals.betsCount > 0 ? (totals.depositsCount / totals.betsCount) * 100 : 0;

  return {
    ...totals,
    uniqueTasks,
    daysCount,
    completionRate,
    depositsToBetsRate,
  };
}

export function formatMetricNumber(value, fractionDigits = 0) {
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

export { REPORTS_ENDPOINT, REPORTS_ORIGIN, SET_ACTIVE_PROJECT_ENDPOINT, REPORTS_STATE_ENDPOINT };
