/**
 * Редакторы операций массовой правки: по одному на поле + чипы текущих значений у выделенных
 * задач (клик — «сделать у всех так»). Справочники приходят готовыми из модалки.
 */
import { useMemo, useState } from "react";

import { MultiCombobox } from "@/components/multi-combobox";
import { CheckboxField } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Segmented } from "@/components/ui/segmented";
import { SimpleSelect } from "@/components/ui/select";
import { ConditionsBuilder } from "@/features/task-form/ConditionsBuilder";
import { CountrySelector, type useCountriesData } from "@/features/task-form/CountrySelector";
import { RepeatSchedule } from "@/features/task-form/RepeatSchedule";
import type { useConditionsSchema, useTaskMeta } from "@/features/task-form/hooks";
import { scheduleFromCron, scheduleToCron } from "@/features/task-form/repeat-schedule";
import { datetimeLocalToIso, isoToDatetimeLocal } from "@/lib/format";
import {
  categoryLabel,
  eventLabel,
  notificationEventLabel,
  priorityLabel,
  toLabeledOptions,
} from "@/lib/labels-ru";
import { DEFAULT_CATEGORIES, DEFAULT_PRIORITIES } from "@/lib/meta";
import type { TaskLike } from "@/lib/types";
import { cn } from "@/lib/utils";

import {
  type BulkContext,
  type BulkOp,
  type ListMode,
  LINKS_CONDITION,
  OP_DISPLAY_KEYS,
  DISPLAY_LABELS,
  bulkOpFromTask,
  summarizeConditions,
  summarizeField,
} from "./bulk-edit";

/** Справочники грузятся один раз в модалке и раздаются редакторам. */
export interface BulkRefs {
  meta: ReturnType<typeof useTaskMeta>;
  schema: ReturnType<typeof useConditionsSchema>;
  countries: ReturnType<typeof useCountriesData>;
}

const LIST_MODES: ReadonlyArray<{ value: ListMode; label: string }> = [
  { value: "add", label: "Добавить" },
  { value: "remove", label: "Убрать" },
  { value: "set", label: "Заменить на" },
];

const LIST_MODE_HINT: Record<ListMode, string> = {
  add: "Добавится к тому, что уже есть у каждой задачи.",
  remove: "Уберётся у задач, где это есть; остальное не тронется.",
  set: "У всех станет ровно этот список.",
};

const SHIFT_UNITS = [
  { value: "1440", label: "дней" },
  { value: "60", label: "часов" },
  { value: "1", label: "минут" },
];

const YES_NO = [
  { value: "false", label: "Нет" },
  { value: "true", label: "Да" },
];

function numberOrNull(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;
  const num = Number(text);
  return Number.isFinite(num) && num >= 0 ? Math.round(num) : null;
}

function isoFromInput(raw: string): string | null {
  try {
    return datetimeLocalToIso(raw);
  } catch {
    return null;
  }
}

function Hint({ children, tone }: { children: React.ReactNode; tone?: "warn" }) {
  return (
    <p className={cn("text-caption", tone === "warn" ? "text-primary" : "text-muted-foreground")}>
      {children}
    </p>
  );
}

function MetaMissing({ loading }: { loading: boolean }) {
  return (
    <Hint>
      {loading ? "Загружаю справочник…" : "Справочник не загрузился — откройте вкладку админки"}
    </Hint>
  );
}

// ---------------------------------------------------------------------------
// Текущие значения
// ---------------------------------------------------------------------------

/** Чипы «что сейчас у задач»; клик по чипу подставляет это значение в операцию. */
export function CurrentValues({
  op,
  tasks,
  ctx,
  onPick,
}: {
  op: BulkOp;
  tasks: TaskLike[];
  ctx: BulkContext;
  onPick: (op: BulkOp) => void;
}) {
  const keys = OP_DISPLAY_KEYS[op.field];
  if (!keys.length || !tasks.length) return null;
  return (
    <div className="flex flex-col gap-1">
      {keys.map((key) => {
        const values = summarizeField(tasks, key, ctx);
        const differs = values.length > 1;
        return (
          <div key={key} className="flex flex-wrap items-center gap-1 text-caption">
            <span className="text-muted-foreground">
              {keys.length > 1 ? `${DISPLAY_LABELS[key]}:` : "Сейчас:"}
            </span>
            {values.map(({ text, count, sample }) => {
              const picked = bulkOpFromTask(op.field, sample);
              const chip = (
                <>
                  <span className="max-w-64 truncate">{text}</span>
                  <span className="tabular-nums opacity-70">×{count}</span>
                </>
              );
              const chipClass = cn(
                "inline-flex max-w-full items-center gap-1 rounded-chip border px-1.5 py-px",
                differs ? "border-primary/50 text-primary" : "border-border text-foreground",
              );
              return picked ? (
                <button
                  key={text}
                  type="button"
                  title={`Сделать у всех: ${text}`}
                  className={cn(
                    chipClass,
                    "cursor-pointer transition-[background-color,transform] duration-150 hover:bg-surface-2 active:scale-95",
                  )}
                  onClick={() => onPick(picked)}
                >
                  {chip}
                </button>
              ) : (
                <span key={text} title={text} className={chipClass}>
                  {chip}
                </span>
              );
            })}
            {differs ? <span className="text-muted-foreground">— у задач по-разному</span> : null}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Редакторы
// ---------------------------------------------------------------------------

function ListModeEditor({
  mode,
  onMode,
  children,
}: {
  mode: ListMode;
  onMode: (mode: ListMode) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Segmented
        size="sm"
        value={mode}
        onValueChange={onMode}
        options={LIST_MODES}
        aria-label="Режим"
      />
      {children}
      <Hint>{LIST_MODE_HINT[mode]}</Hint>
    </div>
  );
}

function ShiftDatesEditor({
  minutes,
  onChange,
}: {
  minutes: number;
  onChange: (m: number) => void;
}) {
  const [unit, setUnit] = useState("1440");
  const factor = Number(unit);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Input
          type="number"
          step={1}
          className="w-28"
          value={minutes ? String(minutes / factor) : ""}
          placeholder="+7 или −1"
          onChange={(e) => onChange(Math.round(Number(e.target.value || 0) * factor))}
          aria-label="На сколько сдвинуть"
        />
        <SimpleSelect
          value={unit}
          onValueChange={(next) => {
            setUnit(next);
            onChange(Math.round((minutes / factor) * Number(next)));
          }}
          options={SHIFT_UNITS}
          className="w-28"
          aria-label="Единица сдвига"
        />
      </div>
      <Hint>«Доступно с» и «Доступно до» сдвигаются вместе; минус — в прошлое.</Hint>
    </div>
  );
}

export function BulkOpEditor({
  op,
  onChange,
  tasks,
  refs,
}: {
  op: BulkOp;
  onChange: (op: BulkOp) => void;
  tasks: TaskLike[];
  refs: BulkRefs;
}) {
  const { meta, schema, countries } = refs;
  const metaData = meta.data;
  const conditionSummary = useMemo(
    () => (op.field.startsWith("conditions") ? summarizeConditions(tasks) : []),
    [op.field, tasks],
  );

  switch (op.field) {
    case "hidden":
    case "player_consent_required":
      return (
        <Segmented
          size="sm"
          value={String(op.value)}
          onValueChange={(v) => onChange({ ...op, value: v === "true" })}
          options={YES_NO}
          aria-label="Значение"
        />
      );
    case "category":
      return (
        <SimpleSelect
          value={op.value ?? ""}
          onValueChange={(v) => onChange({ ...op, value: v || null })}
          options={(metaData?.categories ?? DEFAULT_CATEGORIES).map((v) => ({
            value: v,
            label: categoryLabel(v),
          }))}
          nullable
          nullLabel="— без кампании"
          className="w-72"
          aria-label="Кампания"
        />
      );
    case "priority":
      return (
        <Segmented
          size="sm"
          value={String(op.value)}
          onValueChange={(v) => onChange({ ...op, value: Number(v) })}
          options={(metaData?.priorities ?? DEFAULT_PRIORITIES).map((v) => ({
            value: String(v),
            label: priorityLabel(v),
          }))}
          aria-label="Приоритет"
        />
      );
    case "tag":
      return metaData ? (
        <SimpleSelect
          value={op.tag ? String(op.tag.id) : ""}
          onValueChange={(v) => {
            const tag = metaData.tags.find((t) => String(t.id) === v);
            onChange({ ...op, tag: tag ? { id: tag.id, name: tag.name } : null });
          }}
          options={metaData.tags.map((t) => ({ value: String(t.id), label: t.name }))}
          placeholder="Выберите тег…"
          className="w-72"
          aria-label="Тег"
        />
      ) : (
        <MetaMissing loading={meta.loading} />
      );
    case "events":
    case "notification_events": {
      const source = op.field === "events" ? metaData?.events : metaData?.notification_events;
      const label = op.field === "events" ? eventLabel : notificationEventLabel;
      return (
        <ListModeEditor mode={op.mode} onMode={(mode) => onChange({ ...op, mode })}>
          {source ? (
            <MultiCombobox
              options={toLabeledOptions(source, label)}
              value={op.values}
              onChange={(values) => onChange({ ...op, values })}
              placeholder={op.mode === "set" ? "Пусто — очистить у всех" : "Выберите…"}
              searchPlaceholder="Поиск…"
              aria-label="Значения"
            />
          ) : (
            <MetaMissing loading={meta.loading} />
          )}
        </ListModeEditor>
      );
    }
    case "countries":
      return (
        <ListModeEditor mode={op.mode} onMode={(mode) => onChange({ ...op, mode })}>
          <CountrySelector
            value={op.value}
            onChange={(value) => onChange({ ...op, value })}
            data={countries.data}
            loading={countries.loading}
          />
          {op.mode !== "set" ? (
            <Hint>Затронет только задачи с тем же способом выбора — страны или уровни стран.</Hint>
          ) : null}
        </ListModeEditor>
      );
    case "conditions_upsert":
      return (
        <div className="flex flex-col gap-2.5">
          {conditionSummary.length ? (
            <div className="flex flex-col gap-1">
              <Label className="text-caption text-muted-foreground">
                Условия у выделенных задач — нажмите, чтобы взять за основу:
              </Label>
              <div className="flex flex-wrap gap-1">
                {conditionSummary.map((c) => {
                  const differs = c.variants > 1 || c.count < tasks.length;
                  const active = op.conditions.some((entry) => c.name in entry);
                  return (
                    <button
                      key={c.name}
                      type="button"
                      aria-pressed={active}
                      className={cn(
                        "inline-flex cursor-pointer items-center gap-1 rounded-chip border px-1.5 py-px text-caption transition-[background-color,transform] duration-150 hover:bg-surface-2 active:scale-95",
                        differs ? "border-primary/50 text-primary" : "border-border",
                        active && "bg-primary/15",
                      )}
                      title={
                        c.count < tasks.length
                          ? `Есть у ${c.count} из ${tasks.length} задач`
                          : c.variants > 1
                            ? `${c.variants} разных значения — подставится самое частое`
                            : "Одинаково у всех задач"
                      }
                      onClick={() =>
                        onChange({
                          ...op,
                          conditions: [
                            ...op.conditions.filter((entry) => !(c.name in entry)),
                            { [c.name]: c.common },
                          ],
                        })
                      }
                    >
                      {c.label}
                      <span className="tabular-nums opacity-70">
                        {c.count}/{tasks.length}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
          <ConditionsBuilder
            value={op.conditions}
            onChange={(conditions) => onChange({ ...op, conditions })}
            schema={schema.data}
            schemaLoading={schema.loading}
            schemaError={schema.error}
            duplicable={schema.duplicable}
            taskOptions={[]}
            countries={{ data: countries.data, loading: countries.loading }}
          />
          {op.conditions.some((entry) => LINKS_CONDITION in entry) ? (
            <Hint tone="warn">
              Связи между задачами здесь не меняются — их задают стрелки на канве.
            </Hint>
          ) : null}
          <CheckboxField
            label="Только изменить — не добавлять задачам, у которых такого условия нет"
            checked={op.onlyExisting}
            onCheckedChange={(c) => onChange({ ...op, onlyExisting: c === true })}
          />
        </div>
      );
    case "conditions_remove":
      return conditionSummary.length ? (
        <MultiCombobox
          options={conditionSummary.map((c) => ({
            value: c.name,
            label: `${c.label} (${c.count}/${tasks.length})`,
          }))}
          value={op.names}
          onChange={(names) => onChange({ ...op, names })}
          placeholder="Какие условия удалить…"
          searchPlaceholder="Поиск условия…"
          aria-label="Условия для удаления"
        />
      ) : (
        <Hint>У выделенных задач нет условий таргетинга.</Hint>
      );
    case "schedule":
      return (
        <div className="flex flex-col gap-1.5">
          <RepeatSchedule
            value={scheduleFromCron(op.cron)}
            onChange={(value) => onChange({ ...op, cron: scheduleToCron(value) })}
          />
          <Hint>Применится только к задачам с событием запуска scheduler.</Hint>
        </div>
      );
    case "available_from":
    case "available_till":
      return (
        <div className="flex flex-col gap-1.5">
          <Input
            type="datetime-local"
            step={60}
            className="w-60"
            value={isoToDatetimeLocal(op.value)}
            onChange={(e) => onChange({ ...op, value: isoFromInput(e.target.value) })}
            aria-label="Дата"
          />
          <Hint>Время — как в админке (UTC). Пустое поле уберёт дату у всех.</Hint>
        </div>
      );
    case "shift_dates":
      return (
        <ShiftDatesEditor
          minutes={op.minutes}
          onChange={(minutes) => onChange({ ...op, minutes })}
        />
      );
    case "max_repetitions":
      return (
        <Input
          type="number"
          min={0}
          step={1}
          className="w-44"
          placeholder="не ограничено"
          value={op.value == null ? "" : String(op.value)}
          onChange={(e) => onChange({ ...op, value: numberOrNull(e.target.value) })}
          aria-label="Сколько раз"
        />
      );
    case "duration":
      return (
        <div className="flex items-center gap-3">
          <Input
            type="number"
            min={0}
            step={1}
            className="w-36"
            placeholder="минут"
            disabled={op.minutes == null}
            value={op.minutes == null ? "" : String(op.minutes)}
            onChange={(e) => onChange({ ...op, minutes: numberOrNull(e.target.value) ?? 0 })}
            aria-label="Время жизни в минутах"
          />
          <span className="text-caption text-muted-foreground">мин</span>
          <CheckboxField
            label="бессрочно"
            checked={op.minutes == null}
            onCheckedChange={(c) => onChange({ ...op, minutes: c === true ? null : 360 })}
          />
        </div>
      );
    case "main_bonus_group_id":
    case "secondary_bonus_group_id":
      return metaData ? (
        <SimpleSelect
          value={op.value ?? ""}
          onValueChange={(v) => onChange({ ...op, value: v || null })}
          options={metaData.bonuses.map((b) => ({ value: b.id, label: b.title }))}
          nullable
          nullLabel="— без бонусов"
          aria-label="Группа бонусов"
        />
      ) : (
        <Input
          value={op.value ?? ""}
          onChange={(e) => onChange({ ...op, value: e.target.value.trim() || null })}
          placeholder="gamification_award:… (пусто — убрать)"
          className="font-mono"
          aria-label="Группа бонусов"
        />
      );
  }
}
