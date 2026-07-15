// Каждая метрика рисуется в СВОЁМ мини-графике с собственной осью (small
// multiples). Это принципиально: вовлечённость (0–100%) и оборот (~100 млн)
// нельзя мешать на одной оси — иначе линии превращаются в кашу. Общий курсор
// (crosshair) синхронизирует все мини-графики карточки по дате, чтобы видеть
// связь «выполнение задания → депозиты / оборот».

const SVG_NS = "http://www.w3.org/2000/svg";

// Палитра из data-viz reference (light surface), проверена валидатором.
const SERIES = [
  { key: "tasksCount", label: "Выдано заданий", color: "#2a78d6", type: "bar", digits: 0 },
  { key: "tasksFinished", label: "Выполнено", color: "#008300", type: "bar", digits: 0 },
  {
    key: "tasksFinishedPercent",
    label: "Успешность",
    color: "#eda100",
    type: "line",
    digits: 1,
    suffix: "%",
    fixedMin: 0,
    fixedMax: 100,
  },
  { key: "depositsSum", label: "Депозиты", color: "#1baf7a", type: "area", digits: 0 },
  { key: "betsSum", label: "Оборот ставок", color: "#4a3aa7", type: "area", digits: 0 },
];

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

// Компактные подписи для осей/плиток: 98,6 млн вместо 98 641 183.
function formatCompact(value) {
  const num = toNumber(value);
  const abs = Math.abs(num);
  const sign = num < 0 ? "-" : "";
  const trim = (v) => v.toFixed(1).replace(/\.0$/, "").replace(".", ",");
  if (abs >= 1e9) return `${sign}${trim(abs / 1e9)} млрд`;
  if (abs >= 1e6) return `${sign}${trim(abs / 1e6)} млн`;
  if (abs >= 1e3) return `${sign}${trim(abs / 1e3)} тыс`;
  return `${sign}${Math.round(abs)}`;
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
      betsCount: 0,
      depositsSum: 0,
      depositsCount: 0,
    };
    bucket.tasksCount += toNumber(row.tasksCount);
    bucket.tasksFinished += toNumber(row.tasksFinished);
    bucket.betsSum += toNumber(row.betsSum);
    bucket.betsCount += toNumber(row.betsCount);
    bucket.depositsSum += toNumber(row.depositsSum);
    bucket.depositsCount += toNumber(row.depositsCount);
    byPeriod.set(period, bucket);
  }

  return Array.from(byPeriod.values())
    .sort((a, b) => String(a.period).localeCompare(String(b.period)))
    .map((point) => ({
      ...point,
      tasksFinishedPercent: point.tasksCount > 0 ? (point.tasksFinished / point.tasksCount) * 100 : 0,
    }));
}

function computeTotals(points) {
  const totals = points.reduce(
    (acc, point) => {
      acc.tasksCount += point.tasksCount;
      acc.tasksFinished += point.tasksFinished;
      acc.depositsSum += point.depositsSum;
      acc.depositsCount += point.depositsCount;
      acc.betsSum += point.betsSum;
      acc.betsCount += point.betsCount;
      return acc;
    },
    { tasksCount: 0, tasksFinished: 0, depositsSum: 0, depositsCount: 0, betsSum: 0, betsCount: 0 }
  );
  totals.completion = totals.tasksCount > 0 ? (totals.tasksFinished / totals.tasksCount) * 100 : 0;
  return totals;
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
    .map(([taskName, taskRows]) => {
      const points = aggregateByPeriod(taskRows);
      return { taskName, points, totals: computeTotals(points) };
    })
    .filter((item) => item.points.length > 0)
    // Самые «рабочие» задания вперёд: сначала по выполнениям, потом по обороту.
    .sort((a, b) => b.totals.tasksFinished - a.totals.tasksFinished || b.totals.betsSum - a.totals.betsSum);
}

function seriesBounds(points, series) {
  const values = points.map((point) => toNumber(point[series.key]));
  let min = series.fixedMin != null ? series.fixedMin : Math.min(0, ...values);
  let max = series.fixedMax != null ? series.fixedMax : Math.max(...values);
  if (!(max > min)) max = min + 1;
  return { min, max };
}

function kpiTile({ title, value, sub, accent, meter }) {
  const meterMarkup =
    meter != null
      ? `<div class="stats-task-tile__meter"><span style="width:${clamp(meter, 0, 100).toFixed(1)}%;${
          accent ? `background:${accent};` : ""
        }"></span></div>`
      : "";
  return `
    <div class="stats-task-tile">
      <span class="stats-task-tile__title">${title}</span>
      <span class="stats-task-tile__value"${accent ? ` style="color:${accent};"` : ""}>${value}</span>
      ${sub ? `<span class="stats-task-tile__sub">${sub}</span>` : ""}
      ${meterMarkup}
    </div>`;
}

export function getTaskChartsMarkup(groups) {
  if (!groups.length) {
    return '<div class="stats-chart-empty">Нет данных для отображения графиков</div>';
  }

  return `
    <div class="stats-chart-list">
      ${groups
        .map((group, index) => {
          const t = group.totals;
          const tiles = [
            kpiTile({ title: "Выдано заданий", value: formatCompact(t.tasksCount), accent: "#2a78d6" }),
            kpiTile({ title: "Выполнено", value: formatCompact(t.tasksFinished), accent: "#008300" }),
            kpiTile({
              title: "Вовлечённость",
              value: `${t.completion.toFixed(1).replace(".", ",")}%`,
              accent: "#eda100",
              meter: t.completion,
            }),
            kpiTile({
              title: "Депозиты",
              value: formatCompact(t.depositsSum),
              sub: `${formatCompact(t.depositsCount)} шт.`,
              accent: "#1baf7a",
            }),
            kpiTile({
              title: "Оборот ставок",
              value: formatCompact(t.betsSum),
              sub: `${formatCompact(t.betsCount)} шт.`,
              accent: "#4a3aa7",
            }),
          ].join("");

          const miniCharts = SERIES.map(
            (series, sIdx) => `
              <div class="stats-mini" data-mini="${sIdx}">
                <div class="stats-mini__head">
                  <span class="stats-mini__dot" style="background:${series.color};"></span>
                  <span class="stats-mini__label">${series.label}</span>
                </div>
                <div class="stats-mini__plot"></div>
              </div>`
          ).join("");

          return `
            <article class="stats-chart-card" data-chart-card="${index}">
              <header class="stats-chart-card__head">
                <h3 class="stats-chart-card__title">${group.taskName}</h3>
                <span class="stats-chart-card__days">${group.points.length} дн.</span>
              </header>
              <div class="stats-task-tiles">${tiles}</div>
              <div class="stats-mini-grid" data-chart="${index}">${miniCharts}</div>
            </article>`;
        })
        .join("")}
    </div>
  `;
}

function buildBarChart(svg, points, series, geom) {
  const { chart } = geom;
  const { min, max } = seriesBounds(points, series);
  const range = max - min || 1;
  const zeroY = chart.top + chart.height - ((0 - min) / range) * chart.height;
  const slot = chart.width / points.length;
  const barW = Math.max(2, Math.min(18, slot * 0.6));

  points.forEach((point, index) => {
    const value = toNumber(point[series.key]);
    const cx = chart.left + slot * (index + 0.5);
    const valueY = chart.top + chart.height - ((value - min) / range) * chart.height;
    const top = Math.min(valueY, zeroY);
    const h = Math.max(1, Math.abs(zeroY - valueY));
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", (cx - barW / 2).toFixed(2));
    rect.setAttribute("y", top.toFixed(2));
    rect.setAttribute("width", barW.toFixed(2));
    rect.setAttribute("height", h.toFixed(2));
    rect.setAttribute("rx", Math.min(3, barW / 2).toFixed(2));
    rect.setAttribute("fill", series.color);
    rect.setAttribute("fill-opacity", "0.9");
    svg.appendChild(rect);
  });
}

function pointCoords(points, series, geom) {
  const { chart } = geom;
  const { min, max } = seriesBounds(points, series);
  const range = max - min || 1;
  const stepX = points.length > 1 ? chart.width / (points.length - 1) : 0;
  return points.map((point, index) => {
    const value = toNumber(point[series.key]);
    const x = points.length > 1 ? chart.left + stepX * index : chart.left + chart.width / 2;
    const y = chart.top + chart.height - ((value - min) / range) * chart.height;
    return { x, y };
  });
}

function buildLineChart(svg, points, series, geom, { area }) {
  const { chart } = geom;
  const coords = pointCoords(points, series, geom);
  if (!coords.length) return;

  const linePath = coords
    .map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(2)} ${c.y.toFixed(2)}`)
    .join(" ");

  if (area) {
    const baseY = chart.top + chart.height;
    const first = coords[0];
    const last = coords[coords.length - 1];
    const areaPath = `${linePath} L ${last.x.toFixed(2)} ${baseY.toFixed(2)} L ${first.x.toFixed(2)} ${baseY.toFixed(2)} Z`;
    const fill = document.createElementNS(SVG_NS, "path");
    fill.setAttribute("d", areaPath);
    fill.setAttribute("fill", series.color);
    fill.setAttribute("fill-opacity", "0.14");
    svg.appendChild(fill);
  }

  const line = document.createElementNS(SVG_NS, "path");
  line.setAttribute("d", linePath);
  line.setAttribute("fill", "none");
  line.setAttribute("stroke", series.color);
  line.setAttribute("stroke-width", "2");
  line.setAttribute("stroke-linecap", "round");
  line.setAttribute("stroke-linejoin", "round");
  svg.appendChild(line);

  if (coords.length === 1) {
    const dot = document.createElementNS(SVG_NS, "circle");
    dot.setAttribute("cx", coords[0].x.toFixed(2));
    dot.setAttribute("cy", coords[0].y.toFixed(2));
    dot.setAttribute("r", "3");
    dot.setAttribute("fill", series.color);
    svg.appendChild(dot);
  }
}

function renderMiniChart(plotNode, points, series) {
  const width = Math.max(160, plotNode.clientWidth || 220);
  const height = 96;
  const geom = { chart: { left: 6, top: 10, width: width - 12, height: height - 34 } };

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "stats-mini__svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("preserveAspectRatio", "none");

  // Верхняя и нижняя опорные линии.
  [geom.chart.top, geom.chart.top + geom.chart.height].forEach((y) => {
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", String(geom.chart.left));
    line.setAttribute("x2", String(geom.chart.left + geom.chart.width));
    line.setAttribute("y1", y.toFixed(2));
    line.setAttribute("y2", y.toFixed(2));
    line.setAttribute("class", "stats-mini__grid");
    svg.appendChild(line);
  });

  if (series.type === "bar") {
    buildBarChart(svg, points, series, geom);
  } else {
    buildLineChart(svg, points, series, geom, { area: series.type === "area" });
  }

  // Максимум оси — подпись слева сверху.
  const bounds = seriesBounds(points, series);
  const axisLabel = document.createElementNS(SVG_NS, "text");
  axisLabel.setAttribute("x", String(geom.chart.left));
  axisLabel.setAttribute("y", String(geom.chart.top - 2));
  axisLabel.setAttribute("class", "stats-mini__axis");
  axisLabel.textContent = series.suffix === "%" ? "100%" : formatCompact(bounds.max);
  svg.appendChild(axisLabel);

  // Даты по краям.
  const startLabel = document.createElementNS(SVG_NS, "text");
  startLabel.setAttribute("x", String(geom.chart.left));
  startLabel.setAttribute("y", String(height - 6));
  startLabel.setAttribute("class", "stats-mini__axis");
  startLabel.textContent = formatCompactDate(points[0].period);
  svg.appendChild(startLabel);

  if (points.length > 1) {
    const endLabel = document.createElementNS(SVG_NS, "text");
    endLabel.setAttribute("x", String(geom.chart.left + geom.chart.width));
    endLabel.setAttribute("y", String(height - 6));
    endLabel.setAttribute("text-anchor", "end");
    endLabel.setAttribute("class", "stats-mini__axis");
    endLabel.textContent = formatCompactDate(points[points.length - 1].period);
    svg.appendChild(endLabel);
  }

  // Общий фокус-курсор (управляется с уровня карточки).
  const focusLine = document.createElementNS(SVG_NS, "line");
  focusLine.setAttribute("class", "stats-mini__focus");
  focusLine.setAttribute("y1", String(geom.chart.top));
  focusLine.setAttribute("y2", String(geom.chart.top + geom.chart.height));
  focusLine.style.display = "none";
  svg.appendChild(focusLine);

  plotNode.appendChild(svg);

  const stepX = points.length > 1 ? geom.chart.width / (points.length - 1) : geom.chart.width;
  return {
    svg,
    focusLine,
    geom,
    indexAtClientX: (clientX) => {
      const rect = svg.getBoundingClientRect();
      if (!rect.width) return 0;
      const scale = geom.chart.width / rect.width;
      const localX = (clientX - rect.left) * scale;
      const raw = stepX === 0 ? 0 : Math.round((localX - geom.chart.left) / stepX);
      return clamp(raw, 0, points.length - 1);
    },
    focusXAt: (index) => geom.chart.left + (points.length > 1 ? stepX * index : geom.chart.width / 2),
  };
}

export function mountTaskCharts(root, groups, formatMetricNumber) {
  if (!root || !groups.length) return;

  root.querySelectorAll("[data-chart]").forEach((gridNode) => {
    const idx = Number(gridNode.getAttribute("data-chart"));
    const group = groups[idx];
    if (!group?.points?.length) return;
    const cardNode = gridNode.closest(".stats-chart-card") || gridNode;
    const points = group.points;

    const minis = [];
    gridNode.querySelectorAll("[data-mini]").forEach((miniNode) => {
      const sIdx = Number(miniNode.getAttribute("data-mini"));
      const series = SERIES[sIdx];
      const plotNode = miniNode.querySelector(".stats-mini__plot");
      if (!series || !plotNode) return;
      const handle = renderMiniChart(plotNode, points, series);
      if (handle) minis.push({ series, ...handle });
    });
    if (!minis.length) return;

    const tooltip = document.createElement("div");
    tooltip.className = "stats-chart-tooltip";
    tooltip.style.display = "none";
    cardNode.appendChild(tooltip);

    const hideFocus = () => {
      tooltip.style.display = "none";
      minis.forEach((mini) => {
        mini.focusLine.style.display = "none";
      });
    };

    const showFocus = (index, clientX, clientY) => {
      const point = points[index];
      minis.forEach((mini) => {
        const fx = mini.focusXAt(index);
        mini.focusLine.style.display = "";
        mini.focusLine.setAttribute("x1", fx.toFixed(2));
        mini.focusLine.setAttribute("x2", fx.toFixed(2));
      });

      tooltip.style.display = "block";
      tooltip.innerHTML = `
        <div class="stats-chart-tooltip__date">${formatDateLabel(point.period)}</div>
        ${SERIES.map((series) => {
          const raw = toNumber(point[series.key]);
          const value = `${formatMetricNumber(raw, series.digits)}${series.suffix || ""}`;
          return `
            <div class="stats-chart-tooltip__row">
              <span class="stats-chart-tooltip__metric"><span class="stats-chart-tooltip__dot" style="background:${series.color};"></span>${series.label}</span>
              <span class="stats-chart-tooltip__value">${value}</span>
            </div>`;
        }).join("")}
      `;

      const cardBounds = cardNode.getBoundingClientRect();
      const left = clamp(clientX - cardBounds.left + 14, 8, Math.max(8, cardBounds.width - 250));
      const top = clamp(clientY - cardBounds.top + 14, 8, Math.max(8, cardBounds.height - 180));
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
    };

    minis.forEach((mini) => {
      const onMove = (event) => {
        const index = mini.indexAtClientX(event.clientX);
        showFocus(index, event.clientX, event.clientY);
      };
      mini.svg.addEventListener("mousemove", onMove);
      mini.svg.addEventListener("mouseenter", onMove);
      mini.svg.addEventListener("mouseleave", hideFocus);
      mini.svg.style.cursor = "crosshair";
    });
  });
}
