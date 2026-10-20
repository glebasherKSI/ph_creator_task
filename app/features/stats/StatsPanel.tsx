/** Вкладка «Статистика»: фильтры, сводные метрики, карточки задач с мини-графиками. */
import { RefreshCw } from "lucide-react";
import { useMemo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  YAxis,
} from "recharts";

import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SimpleSelect } from "@/components/ui/select";
import { computeMetrics, formatMetricNumber, reportTaskNamesMatch } from "@/lib/reports";
import { cn } from "@/lib/utils";

import {
  SERIES,
  type StatsPoint,
  type StatsSeries,
  type TaskStatsGroup,
  formatCompact,
  formatCompactDate,
  formatDateLabel,
  formatPercent,
  groupStatsRowsByTask,
  seriesBounds,
  toNumber,
} from "./stats";
import type { StatsReportState } from "./useStatsReport";

export interface StatsPanelProps {
  report: StatsReportState;
  /** Выбранная задача в редакторе — для фильтра «только выбранная». */
  activeTask: { id: number | string; name: string } | null;
  taskOnly: boolean;
  onTaskOnlyChange: (next: boolean) => void;
}

function MetricCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-md bg-surface p-3">
      <span className="text-caption text-muted-foreground">{title}</span>
      <span className="text-title-2 tabular-nums">{value}</span>
    </div>
  );
}

function KpiTile({
  title,
  value,
  sub,
  color,
  meter,
}: {
  title: string;
  value: string;
  sub?: string;
  color: string;
  meter?: number;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-md bg-background/60 p-2.5 ring-1 ring-border">
      <span className="text-caption text-muted-foreground">{title}</span>
      <span className="text-headline tabular-nums" style={{ color }}>
        {value}
      </span>
      {sub ? <span className="text-caption text-muted-foreground">{sub}</span> : null}
      {meter != null ? (
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full rounded-full"
            style={{ width: `${Math.max(0, Math.min(100, meter)).toFixed(1)}%`, background: color }}
          />
        </div>
      ) : null}
    </div>
  );
}

function MiniTooltip({
  active,
  payload,
  series,
}: {
  active?: boolean;
  payload?: Array<{ payload: StatsPoint }>;
  series: StatsSeries;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  const raw = toNumber(point[series.key]);
  return (
    <div className="rounded-chip bg-surface-2 px-2 py-1 text-caption shadow-md ring-1 ring-border">
      <div className="text-muted-foreground">{formatDateLabel(point.period)}</div>
      <div className="font-semibold" style={{ color: series.color }}>
        {formatMetricNumber(raw, series.digits)}
        {series.suffix || ""}
      </div>
    </div>
  );
}

/** Один мини-график; `syncId` синхронизирует курсор между графиками карточки. */
function MiniChart({
  points,
  series,
  syncId,
}: {
  points: StatsPoint[];
  series: StatsSeries;
  syncId: string;
}) {
  const bounds = seriesBounds(points, series);
  const domain: [number, number] = [bounds.min, bounds.max];
  const tooltip = (
    <Tooltip
      content={(props) => <MiniTooltip {...(props as object)} series={series} />}
      cursor={{ stroke: "var(--muted-foreground)", strokeOpacity: 0.5 }}
      isAnimationActive={false}
    />
  );
  const common = { data: points, syncId, margin: { top: 4, right: 4, bottom: 0, left: 4 } };

  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-md bg-background/60 p-2 ring-1 ring-border">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-caption text-muted-foreground">
          <span className="size-2 rounded-full" style={{ background: series.color }} />
          {series.label}
        </span>
        <span className="text-caption text-muted-foreground tabular-nums">
          {series.suffix === "%" ? "100%" : formatCompact(bounds.max)}
        </span>
      </div>
      <div className="h-24">
        <ResponsiveContainer width="100%" height="100%">
          {series.type === "bar" ? (
            <BarChart {...common}>
              <YAxis hide domain={domain} />
              {tooltip}
              <Bar
                dataKey={series.key}
                fill={series.color}
                radius={[3, 3, 0, 0]}
                isAnimationActive={false}
              />
            </BarChart>
          ) : series.type === "area" ? (
            <AreaChart {...common}>
              <YAxis hide domain={domain} />
              {tooltip}
              <Area
                type="monotone"
                dataKey={series.key}
                stroke={series.color}
                fill={series.color}
                fillOpacity={0.18}
                strokeWidth={2}
                isAnimationActive={false}
              />
            </AreaChart>
          ) : (
            <LineChart {...common}>
              <YAxis hide domain={domain} />
              {tooltip}
              <Line
                type="monotone"
                dataKey={series.key}
                stroke={series.color}
                strokeWidth={2}
                dot={points.length === 1}
                isAnimationActive={false}
              />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
      <div className="flex justify-between text-caption text-muted-foreground tabular-nums">
        <span>{formatCompactDate(points[0]?.period)}</span>
        {points.length > 1 ? (
          <span>{formatCompactDate(points[points.length - 1]?.period)}</span>
        ) : null}
      </div>
    </div>
  );
}

function TaskCard({ group, index }: { group: TaskStatsGroup; index: number }) {
  const t = group.totals;
  const syncId = `stats-card-${index}`;
  return (
    <article className="flex flex-col gap-3 rounded-lg bg-surface p-4">
      <header className="flex items-baseline justify-between gap-2">
        <h3 className="min-w-0 truncate text-headline">{group.taskName}</h3>
        <span className="shrink-0 text-caption text-muted-foreground">
          {group.points.length} дн.
        </span>
      </header>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <KpiTile
          title="Выдано заданий"
          value={formatCompact(t.tasksCount)}
          color={SERIES[0]!.color}
        />
        <KpiTile
          title="Выполнено"
          value={formatCompact(t.tasksFinished)}
          color={SERIES[1]!.color}
        />
        <KpiTile
          title="Вовлечённость"
          value={formatPercent(t.completion)}
          color={SERIES[2]!.color}
          meter={t.completion}
        />
        <KpiTile
          title="Депозиты"
          value={formatCompact(t.depositsSum)}
          sub={`${formatCompact(t.depositsCount)} шт.`}
          color={SERIES[3]!.color}
        />
        <KpiTile
          title="Оборот ставок"
          value={formatCompact(t.betsSum)}
          sub={`${formatCompact(t.betsCount)} шт.`}
          color={SERIES[5]!.color}
        />
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {SERIES.map((series) => (
          <MiniChart key={series.key} points={group.points} series={series} syncId={syncId} />
        ))}
      </div>
    </article>
  );
}

export function StatsPanel({ report, activeTask, taskOnly, onTaskOnlyChange }: StatsPanelProps) {
  const rows = useMemo(() => {
    if (!taskOnly) return report.rows;
    const taskName = String(activeTask?.name || "").trim();
    if (!taskName) return report.rows;
    return report.rows.filter((row) => reportTaskNamesMatch(row.name, taskName));
  }, [report.rows, taskOnly, activeTask?.name]);
  const groups = useMemo(() => groupStatsRowsByTask(rows), [rows]);
  const metrics = useMemo(
    () => computeMetrics(rows, report.payload?.period),
    [rows, report.payload],
  );

  const activeTaskMissing =
    taskOnly &&
    activeTask &&
    report.rows.length > 0 &&
    !rows.length &&
    !report.loading &&
    !report.error;
  const statusText = report.loading
    ? "Загрузка отчета..."
    : report.error
      ? report.error
      : activeTaskMissing
        ? `Задача «${activeTask?.name || activeTask?.id}» не найдена в отчёте за выбранный период. Проверьте даты и проект.`
        : report.updatedAt
          ? `Обновлено: ${report.updatedAt}. Строк: ${rows.length}${
              report.countAll != null && report.rows.length < report.countAll
                ? ` (загружено ${report.rows.length} из ${report.countAll})`
                : ""
            }`
          : "Отчет не загружен";

  const activeTaskLabel = activeTask ? `#${activeTask.id} ${activeTask.name || ""}` : "не выбрана";
  const projectOptions = report.projects.list.map((p) => ({
    value: p.id,
    label: `${p.name} (#${p.id})`,
  }));

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-title-2">Статистика задач</h2>

      <div className="grid grid-cols-2 gap-3 rounded-lg bg-surface p-4 md:grid-cols-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="stats-from">Период от</Label>
          <Input
            id="stats-from"
            type="date"
            value={report.filters.from || report.payload?.period.from || ""}
            onChange={(e) => {
              report.setFilters({ from: e.target.value });
              report.reload();
            }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="stats-to">Период до</Label>
          <Input
            id="stats-to"
            type="date"
            value={report.filters.to || report.payload?.period.to || ""}
            onChange={(e) => {
              report.setFilters({ to: e.target.value });
              report.reload();
            }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="stats-project">
            {report.projects.list.length
              ? "Проект"
              : `Project ID${report.projects.error ? " (список недоступен)" : ""}`}
          </Label>
          {report.projects.loading ? (
            <Input id="stats-project" value="Загрузка проектов…" disabled readOnly />
          ) : report.projects.list.length ? (
            <SimpleSelect
              value={report.effectiveProjectId}
              onValueChange={(v) => {
                report.setFilters({ projectId: v });
                report.reload();
              }}
              options={projectOptions}
              placeholder="Выберите проект…"
              aria-label="Проект"
            />
          ) : (
            <div className="flex gap-2">
              <Input
                id="stats-project"
                inputMode="numeric"
                placeholder={report.effectiveProjectId || "например, 13"}
                value={report.filters.projectId}
                onChange={(e) => {
                  report.setFilters({ projectId: e.target.value.trim() });
                  report.reload();
                }}
              />
              <Button variant="secondary" onClick={() => void report.loadProjects({ force: true })}>
                Проекты
              </Button>
            </div>
          )}
        </div>
        <div className="flex flex-col justify-end gap-2">
          <Button
            variant="primary"
            disabled={report.loading}
            onClick={() => {
              void report.loadProjects();
              report.reload(0);
            }}
          >
            <RefreshCw className={cn(report.loading && "animate-spin")} /> Обновить
          </Button>
          <CheckboxField
            label={`Только выбранная (${activeTaskLabel})`}
            checked={taskOnly}
            disabled={!activeTask}
            onCheckedChange={(c) => onTaskOnlyChange(c === true)}
          />
        </div>
      </div>

      <p
        role="status"
        className={cn("text-subhead", report.error ? "text-destructive" : "text-muted-foreground")}
      >
        {statusText}
      </p>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <MetricCard title="Уникальных задач" value={formatMetricNumber(metrics.uniqueTasks)} />
        <MetricCard title="Дней в выборке" value={formatMetricNumber(metrics.daysCount)} />
        <MetricCard title="Всего задач (sum)" value={formatMetricNumber(metrics.tasksCount)} />
        <MetricCard title="Завершено" value={formatMetricNumber(metrics.tasksFinished)} />
        <MetricCard
          title="Успешность"
          value={`${formatMetricNumber(metrics.completionRate, 2)}%`}
        />
        <MetricCard title="Сумма ставок" value={formatMetricNumber(metrics.betsSum, 2)} />
        <MetricCard title="Сумма депозитов" value={formatMetricNumber(metrics.depositsSum, 2)} />
        <MetricCard
          title="Конверсия депозиты/ставки"
          value={`${formatMetricNumber(metrics.depositsToBetsRate, 2)}%`}
        />
      </div>

      {groups.length ? (
        <div className="flex flex-col gap-3">
          {groups.map((group, index) => (
            <TaskCard key={group.taskName} group={group} index={index} />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-subhead text-muted-foreground">
          Нет данных для отображения графиков
        </div>
      )}
    </div>
  );
}
