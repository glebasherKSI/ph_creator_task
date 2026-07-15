const METRICS = [
  { key: "tasksCount", label: "Tasks count", color: "#2563eb", digits: 0 },
  { key: "tasksFinished", label: "Tasks finished", color: "#16a34a", digits: 0 },
  { key: "tasksFinishedPercent", label: "Finished %", color: "#f59e0b", digits: 2, suffix: "%" },
  { key: "betsSum", label: "Bets sum", color: "#7c3aed", digits: 2 },
  { key: "depositsSum", label: "Deposits sum", color: "#dc2626", digits: 2 },
];

const SVG_NS = "http://www.w3.org/2000/svg";

function parseIsoDate(value) {
  const raw = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [year, month, day] = raw.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateLabel(value) {
  const date = parseIsoDate(value);
  if (!date) return String(value || "—");
  return new Intl.DateTimeFormat("ru-RU").format(date);
}

function formatCompactDate(value) {
  const date = parseIsoDate(value);
  if (!date) return String(value || "—");
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit" }).format(date);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const normalized = String(value || "").replace(/\s+/g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function aggregateByPeriod(rows) {
  const byPeriod = new Map();
  for (const row of rows) {
    const period = String(row?.period || "").trim();
    if (!period) continue;
    const bucket = byPeriod.get(period) || {
      period,
      tasksCount: 0,
      tasksFinished: 0,
      betsSum: 0,
      depositsSum: 0,
    };
    bucket.tasksCount += toNumber(row.tasksCount);
    bucket.tasksFinished += toNumber(row.tasksFinished);
    bucket.betsSum += toNumber(row.betsSum);
    bucket.depositsSum += toNumber(row.depositsSum);
    byPeriod.set(period, bucket);
  }

  return Array.from(byPeriod.values())
    .sort((a, b) => String(a.period).localeCompare(String(b.period)))
    .map((point) => ({
      ...point,
      tasksFinishedPercent: point.tasksCount > 0 ? (point.tasksFinished / point.tasksCount) * 100 : 0,
    }));
}

export function groupStatsRowsByTask(rows) {
  const byTask = new Map();
  for (const row of rows || []) {
    const taskName = String(row?.name || "").trim() || "Без названия";
    const list = byTask.get(taskName) || [];
    list.push(row);
    byTask.set(taskName, list);
  }

  return Array.from(byTask.entries())
    .map(([taskName, taskRows]) => ({
      taskName,
      points: aggregateByPeriod(taskRows),
    }))
    .filter((item) => item.points.length > 0)
    .sort((a, b) => a.taskName.localeCompare(b.taskName, "ru"));
}

function buildPath(points, key, chart) {
  if (!points.length) return "";
  const values = points.map((point) => toNumber(point[key]));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = points.length > 1 ? chart.width / (points.length - 1) : 0;

  return points
    .map((point, index) => {
      const value = toNumber(point[key]);
      const x = chart.left + stepX * index;
      const ratio = (value - min) / range;
      const y = chart.top + chart.height - ratio * chart.height;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function metricBounds(points, key) {
  const values = points.map((point) => toNumber(point[key]));
  const min = Math.min(...values);
  const max = Math.max(...values);
  return { min, max };
}

export function getTaskChartsMarkup(groups) {
  if (!groups.length) {
    return '<div class="stats-chart-empty">Нет данных для отображения графиков</div>';
  }

  return `
    <div class="stats-chart-list">
      ${groups
        .map(
          (group, index) => `
            <article class="stats-chart-card" data-chart-card="${index}">
              <header class="stats-chart-card__head">
                <h3 class="stats-chart-card__title">${group.taskName}</h3>
                <span class="stats-chart-card__days">${group.points.length} дн.</span>
              </header>
              <div class="stats-chart-card__legend">
                ${METRICS.map(
                  (metric) => `
                    <span class="stats-chart-legend__item">
                      <span class="stats-chart-legend__dot" style="--legend-color:${metric.color};"></span>
                      ${metric.label}
                    </span>
                  `
                ).join("")}
              </div>
              <div class="stats-chart" data-chart="${index}" aria-label="График задачи ${group.taskName}"></div>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

export function mountTaskCharts(root, groups, formatMetricNumber) {
  if (!root || !groups.length) return;

  const cards = root.querySelectorAll("[data-chart]");
  cards.forEach((cardNode) => {
    const idx = Number(cardNode.getAttribute("data-chart"));
    const group = groups[idx];
    if (!group?.points?.length) return;

    const width = Math.max(380, cardNode.clientWidth || 600);
    const height = 220;
    const chart = { left: 12, top: 12, width: width - 24, height: 160 };

    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "stats-chart__svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("preserveAspectRatio", "none");

    const yGrid = [0, 0.25, 0.5, 0.75, 1];
    yGrid.forEach((p) => {
      const y = chart.top + chart.height * p;
      const line = document.createElementNS(SVG_NS, "line");
      line.setAttribute("x1", String(chart.left));
      line.setAttribute("x2", String(chart.left + chart.width));
      line.setAttribute("y1", y.toFixed(2));
      line.setAttribute("y2", y.toFixed(2));
      line.setAttribute("class", "stats-chart__grid-line");
      svg.appendChild(line);
    });

    METRICS.forEach((metric) => {
      const pathData = buildPath(group.points, metric.key, chart);
      if (!pathData) return;
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", pathData);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", metric.color);
      path.setAttribute("stroke-width", "2");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      svg.appendChild(path);
    });

    const xStartLabel = document.createElementNS(SVG_NS, "text");
    xStartLabel.setAttribute("x", String(chart.left));
    xStartLabel.setAttribute("y", String(height - 10));
    xStartLabel.setAttribute("class", "stats-chart__axis-label");
    xStartLabel.textContent = formatCompactDate(group.points[0].period);
    svg.appendChild(xStartLabel);

    const xEndLabel = document.createElementNS(SVG_NS, "text");
    xEndLabel.setAttribute("x", String(chart.left + chart.width));
    xEndLabel.setAttribute("y", String(height - 10));
    xEndLabel.setAttribute("text-anchor", "end");
    xEndLabel.setAttribute("class", "stats-chart__axis-label");
    xEndLabel.textContent = formatCompactDate(group.points[group.points.length - 1].period);
    svg.appendChild(xEndLabel);

    const focusLine = document.createElementNS(SVG_NS, "line");
    focusLine.setAttribute("class", "stats-chart__focus-line");
    focusLine.setAttribute("y1", String(chart.top));
    focusLine.setAttribute("y2", String(chart.top + chart.height));
    focusLine.style.display = "none";
    svg.appendChild(focusLine);

    const hoverLayer = document.createElementNS(SVG_NS, "rect");
    hoverLayer.setAttribute("x", String(chart.left));
    hoverLayer.setAttribute("y", String(chart.top));
    hoverLayer.setAttribute("width", String(chart.width));
    hoverLayer.setAttribute("height", String(chart.height));
    hoverLayer.setAttribute("fill", "transparent");
    hoverLayer.style.cursor = "crosshair";
    svg.appendChild(hoverLayer);

    const tooltip = document.createElement("div");
    tooltip.className = "stats-chart-tooltip";
    tooltip.style.display = "none";
    cardNode.appendChild(tooltip);

    const stepX = group.points.length > 1 ? chart.width / (group.points.length - 1) : chart.width;

    const showPoint = (clientX, clientY) => {
      const bounds = svg.getBoundingClientRect();
      const x = clamp(clientX - bounds.left, chart.left, chart.left + chart.width);
      const rawIndex = stepX === 0 ? 0 : Math.round((x - chart.left) / stepX);
      const index = clamp(rawIndex, 0, group.points.length - 1);
      const focusX = chart.left + stepX * index;
      const point = group.points[index];

      focusLine.style.display = "";
      focusLine.setAttribute("x1", focusX.toFixed(2));
      focusLine.setAttribute("x2", focusX.toFixed(2));

      tooltip.style.display = "block";
      tooltip.innerHTML = `
        <div class="stats-chart-tooltip__date">${formatDateLabel(point.period)}</div>
        ${METRICS.map((metric) => {
          const raw = toNumber(point[metric.key]);
          const value = `${formatMetricNumber(raw, metric.digits)}${metric.suffix || ""}`;
          return `
            <div class="stats-chart-tooltip__row">
              <span class="stats-chart-tooltip__metric">${metric.label}</span>
              <span class="stats-chart-tooltip__value">${value}</span>
            </div>
          `;
        }).join("")}
      `;

      const cardBounds = cardNode.getBoundingClientRect();
      const left = clamp(clientX - cardBounds.left + 14, 8, Math.max(8, cardBounds.width - 260));
      const top = clamp(clientY - cardBounds.top - 18, 8, Math.max(8, cardBounds.height - 170));
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
    };

    hoverLayer.addEventListener("mousemove", (event) => showPoint(event.clientX, event.clientY));
    hoverLayer.addEventListener("mouseenter", (event) => showPoint(event.clientX, event.clientY));
    hoverLayer.addEventListener("mouseleave", () => {
      tooltip.style.display = "none";
      focusLine.style.display = "none";
    });

    cardNode.appendChild(svg);

    const metricsWrap = document.createElement("div");
    metricsWrap.className = "stats-chart-card__meta";
    metricsWrap.innerHTML = METRICS.map((metric) => {
      const lastPoint = group.points[group.points.length - 1];
      const firstPoint = group.points[0];
      const last = toNumber(lastPoint[metric.key]);
      const first = toNumber(firstPoint[metric.key]);
      const diff = last - first;
      const diffSign = diff > 0 ? "+" : "";
      const diffValue = `${diffSign}${formatMetricNumber(diff, metric.digits)}${metric.suffix || ""}`;
      const bounds = metricBounds(group.points, metric.key);
      return `
        <div class="stats-chart-card__meta-item">
          <span class="stats-chart-card__meta-title">${metric.label}</span>
          <span class="stats-chart-card__meta-value">${formatMetricNumber(last, metric.digits)}${metric.suffix || ""}</span>
          <span class="stats-chart-card__meta-diff ${diff >= 0 ? "is-positive" : "is-negative"}">${diffValue}</span>
          <span class="stats-chart-card__meta-range">min ${formatMetricNumber(bounds.min, metric.digits)} / max ${formatMetricNumber(bounds.max, metric.digits)}${metric.suffix || ""}</span>
        </div>
      `;
    }).join("");
    cardNode.appendChild(metricsWrap);
  });
}
