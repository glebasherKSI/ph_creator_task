import { MultiCombobox } from "@/components/multi-combobox";
import { Label } from "@/components/ui/label";
import { SimpleSelect } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import {
  DAY_OF_WEEK_OPTIONS,
  HOUR_OPTIONS,
  MONTH_DAY_OPTIONS,
  REPEAT_PERIODS,
  type RepeatPeriod,
  type RepeatScheduleValue,
} from "./repeat-schedule";

const toNumbers = (values: string[]) => values.map(Number).filter((v) => Number.isInteger(v));
const toStrings = (values: number[]) => values.map(String);

/** Повторение задачи (cron) в человеческом виде; нераспознанный cron — текстом. */
export function RepeatSchedule({
  value,
  onChange,
  disabled,
}: {
  value: RepeatScheduleValue;
  onChange: (value: RepeatScheduleValue) => void;
  disabled?: boolean;
}) {
  const patch = (next: Partial<RepeatScheduleValue>) => onChange({ ...value, ...next });

  return (
    <div className="flex flex-col gap-3 rounded-md bg-surface-2/40 p-3">
      <div className="text-headline">Повторение</div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>Период</Label>
          <SimpleSelect
            value={value.period}
            onValueChange={(period) => patch({ period: period as RepeatPeriod })}
            options={REPEAT_PERIODS.map((p) => ({ value: p.id, label: p.label }))}
            disabled={disabled}
            aria-label="Период"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Время</Label>
          <MultiCombobox
            options={HOUR_OPTIONS}
            value={toStrings(value.hours)}
            onChange={(hours) => patch({ hours: toNumbers(hours) })}
            placeholder="Выберите время"
            disabled={disabled}
            aria-label="Время"
          />
        </div>
        {value.period === "week" ? (
          <div className="col-span-2 flex flex-col gap-1.5">
            <Label>День недели</Label>
            <MultiCombobox
              options={DAY_OF_WEEK_OPTIONS}
              value={toStrings(value.daysOfWeek)}
              onChange={(days) => patch({ daysOfWeek: toNumbers(days) })}
              placeholder="Выберите дни"
              disabled={disabled}
              aria-label="День недели"
            />
          </div>
        ) : null}
        {value.period === "month" ? (
          <div className="col-span-2 flex flex-col gap-1.5">
            <Label>День месяца</Label>
            <MultiCombobox
              options={MONTH_DAY_OPTIONS}
              value={toStrings(value.daysOfMonth)}
              onChange={(days) => patch({ daysOfMonth: toNumbers(days) })}
              placeholder="Выберите числа"
              disabled={disabled}
              aria-label="День месяца"
            />
          </div>
        ) : null}
      </div>
      {value.fallback != null ? (
        <div className="flex flex-col gap-1.5">
          <Label>Cron (не удалось разобрать)</Label>
          <Textarea
            rows={2}
            value={value.fallback}
            onChange={(e) => patch({ fallback: e.target.value })}
            placeholder="0 12 * * *"
            disabled={disabled}
            className="min-h-0 font-mono text-subhead"
          />
        </div>
      ) : null}
    </div>
  );
}
