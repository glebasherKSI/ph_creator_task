/**
 * Редактор условий таргетинга задачи (замена mountConditionsBuilder).
 * Controlled: `value` — API-массив conditions, `onChange(next)`. Схема, справочник стран и
 * список заданий приходят через props. Локальный state — только UI: выбранное условие,
 * пикер (открыт / поиск), режим UI/JSON по условиям и черновики ввода.
 */
import { Loader2, Plus, Trash2 } from "lucide-react";
import * as React from "react";

import { AnimatedHeight } from "@/components/animated-height";
import { MultiCombobox } from "@/components/multi-combobox";
import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Segmented } from "@/components/ui/segmented";
import { SimpleSelect } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  getConditionDef,
  type ConditionDefinition,
  type OptionRef,
  type ParsedConditionsSchema,
} from "@/lib/conditions-schema";
import { formatJsonStrict } from "@/lib/format";
import { conditionLabel } from "@/lib/labels-ru";
import type { Condition } from "@/lib/types";
import { cn } from "@/lib/utils";

import {
  BOOLEAN_TYPES,
  DURATION_PERIODS,
  EXISTENCE_TYPES,
  INCLUDE_EXCLUDE_TYPES,
  LIST_LOGIC_TYPES,
  MONEY_RANGE_TYPES,
  NUMBER_TYPES,
  PAYMENT_STATUSES,
  canAddCondition,
  conditionInstanceLabel,
  createConditionId,
  defaultValueForDef,
  extraOptionList,
  filterPickerConditions,
  formatTagsInput,
  hasGamificationTaskOptions,
  isHandledWidget,
  isMultipleSelect,
  isRecord,
  moneyRangeView,
  numberInputValue,
  parseConditionsArray,
  parseJsonDraft,
  parseTagsInput,
  patchDuration,
  patchMoneyRange,
  patchValue,
  reconcileConditionItems,
  resolveGamificationTaskOptions,
  schemaStatusText,
  selectMultiValue,
  serializeConditions,
  setNested,
  stringList,
  toComboOptions,
  widgetTypeHint,
  type ConditionItem,
  type TaskOption,
} from "./conditions-builder";
import { CountrySelector } from "./CountrySelector";
import {
  conditionValueToCountrySelector,
  countrySelectorToConditionValue,
  type CountriesData,
} from "./country-selector";

export type { TaskOption } from "./conditions-builder";

export interface ConditionsBuilderProps {
  /** API-массив conditions: `[{ <name>: <value> }]`. */
  value: Condition[];
  onChange: (next: Condition[]) => void;
  /** null — пока грузится или не загрузилась. */
  schema: ParsedConditionsSchema | null;
  schemaLoading?: boolean;
  schemaError?: string | null;
  duplicable: Set<string> | null;
  /** Список заданий из каталога для виджета gamification_task. */
  taskOptions: ReadonlyArray<TaskOption>;
  /** Справочник стран для countries_with_lists. */
  countries: { data: CountriesData | null; loading: boolean };
  disabled?: boolean;
  className?: string;
}

type EditMode = "ui" | "json";

/**
 * Элементы редактора из `value` с сохранением id между рендерами: кэш `{ value, items }`
 * в state обновляется прямо в рендере, когда приходит новый `value` (паттерн
 * «состояние из прошлого рендера»; никаких эффектов и ref).
 */
function useConditionItems(
  value: Condition[],
): [ConditionItem[], (items: ConditionItem[]) => Condition[]] {
  const [cache, setCache] = React.useState<{ value: Condition[]; items: ConditionItem[] }>(() => ({
    value,
    items: parseConditionsArray(value),
  }));
  let items = cache.items;
  if (cache.value !== value) {
    items = reconcileConditionItems(cache.items, value);
    setCache({ value, items });
  }
  const commit = (next: ConditionItem[]): Condition[] => {
    const serialized = serializeConditions(next);
    setCache({ value: serialized, items: next });
    return serialized;
  };
  return [items, commit];
}

function toSegmentedOptions(options: ReadonlyArray<OptionRef>, disabled?: boolean) {
  return options.map((opt) => ({ value: opt.id, label: opt.name, disabled }));
}

function toSelectOptions(options: ReadonlyArray<OptionRef>) {
  return options.map((opt) => ({ value: opt.id, label: opt.name }));
}

function Field({
  label,
  htmlFor,
  wide,
  children,
}: {
  label: React.ReactNode;
  htmlFor?: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", wide && "col-span-full")}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

/**
 * Текстовое поле с черновиком: пока поле в фокусе, показывается введённый текст,
 * наружу на каждый ввод уходит `onText(raw)`; при blur черновик сбрасывается к `text`.
 */
function DraftInput({
  text,
  onText,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "value" | "onChange"> & {
  text: string;
  onText: (raw: string) => void;
}) {
  const [draft, setDraft] = React.useState<string | null>(null);
  return (
    <Input
      {...props}
      value={draft ?? text}
      onChange={(e) => {
        setDraft(e.target.value);
        onText(e.target.value);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

function NumberField({
  id,
  value,
  onValue,
  disabled,
  min,
}: {
  id: string;
  value: unknown;
  onValue: (num: number | null) => void;
  disabled?: boolean;
  min?: number;
}) {
  return (
    <DraftInput
      id={id}
      type="number"
      min={min}
      text={String(value ?? "")}
      onText={(raw) => onValue(numberInputValue(raw))}
      disabled={disabled}
    />
  );
}

function TagsField({
  id,
  label,
  list,
  onList,
  disabled,
}: {
  id: string;
  label: string;
  list: unknown;
  onList: (list: string[]) => void;
  disabled?: boolean;
}) {
  return (
    <Field label={label} htmlFor={id} wide>
      <DraftInput
        id={id}
        text={formatTagsInput(list)}
        onText={(raw) => onList(parseTagsInput(raw))}
        placeholder="ID через запятую"
        disabled={disabled}
        autoComplete="off"
        className="font-mono text-subhead"
      />
    </Field>
  );
}

function SegmentedField({
  label,
  options,
  value,
  onValue,
  disabled,
}: {
  label: string;
  options: ReadonlyArray<OptionRef>;
  value: unknown;
  onValue: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <Field label={label}>
      <Segmented
        value={String(value ?? "")}
        onValueChange={onValue}
        options={toSegmentedOptions(options, disabled)}
        aria-label={label}
        className="w-fit max-w-full"
      />
    </Field>
  );
}

/**
 * Группа связанных полей: заголовок + рамка. Даёт глазу понять, что к чему относится
 * (период, диапазон суммы, список и т.д.).
 */
function Group({
  title,
  hint,
  children,
  className,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <fieldset
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-md bg-background/60 p-3 ring-1 ring-border",
        className,
      )}
    >
      <legend className="px-1 text-caption font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </legend>
      {hint ? <p className="-mt-1 text-caption text-muted-foreground">{hint}</p> : null}
      {children}
    </fieldset>
  );
}

/** Два поля в ряд на широких экранах, одно под другим на узких. */
function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>;
}

/* ---------- составные виджеты ---------- */

function MoneyRangeWidget({
  uid,
  title,
  value,
  onChange,
  disabled,
}: {
  uid: string;
  title: string;
  value: unknown;
  onChange: (next: Record<string, unknown>) => void;
  disabled?: boolean;
}) {
  const view = moneyRangeView(isRecord(value) ? value.money_range : undefined);
  const isRange = view.type === "range";
  return (
    <Group title={title}>
      <SegmentedField
        label="Как сравнивать"
        options={MONEY_RANGE_TYPES}
        value={view.type}
        onValue={(id) => onChange(setNested(value, "money_range.type", id))}
        disabled={disabled}
      />
      <Row>
        <Field label={isRange ? "От" : "Значение"} htmlFor={`${uid}-money-min`}>
          <NumberField
            id={`${uid}-money-min`}
            value={view.min}
            onValue={(num) => onChange(patchMoneyRange(value, "min", num))}
            disabled={disabled}
          />
        </Field>
        {isRange ? (
          <Field label="До" htmlFor={`${uid}-money-max`}>
            <NumberField
              id={`${uid}-money-max`}
              value={view.max}
              onValue={(num) => onChange(patchMoneyRange(value, "max", num))}
              disabled={disabled}
            />
          </Field>
        ) : null}
      </Row>
      {isRange ? (
        <CheckboxField
          label="Исключить конец диапазона"
          checked={view.excludeEnd}
          disabled={disabled}
          onCheckedChange={(checked) =>
            onChange(patchMoneyRange(value, "exclude_end", checked === true))
          }
        />
      ) : null}
    </Group>
  );
}

function DurationWidget({
  uid,
  value,
  periods,
  onChange,
  disabled,
}: {
  uid: string;
  value: unknown;
  periods: ReadonlyArray<OptionRef> | undefined;
  onChange: (next: Record<string, unknown>) => void;
  disabled?: boolean;
}) {
  const duration = isRecord(value) && isRecord(value.duration) ? value.duration : {};
  const options = periods?.length ? periods : DURATION_PERIODS;
  return (
    <Group title="Период">
      <Row>
        <Field label="За какой период">
          <SimpleSelect
            value={String(duration.period ?? "lifetime")}
            onValueChange={(period) => onChange(patchDuration(value, "period", period))}
            options={toSelectOptions(options)}
            disabled={disabled}
            aria-label="Период"
          />
        </Field>
        <Field label="Сколько периодов" htmlFor={`${uid}-duration-number`}>
          <NumberField
            id={`${uid}-duration-number`}
            value={duration.number ?? 1}
            min={0}
            onValue={(num) => onChange(patchDuration(value, "number", num))}
            disabled={disabled}
          />
        </Field>
      </Row>
      <CheckboxField
        label="Включая текущий период"
        checked={Boolean(duration.include_current_period)}
        disabled={disabled}
        onCheckedChange={(checked) =>
          onChange(patchDuration(value, "include_current_period", checked === true))
        }
      />
    </Group>
  );
}

function CheckboxListWidget({
  collection,
  list,
  onList,
  disabled,
}: {
  collection: ReadonlyArray<OptionRef>;
  list: unknown;
  onList: (list: string[]) => void;
  disabled?: boolean;
}) {
  const selected = new Set(stringList(list));
  const toggle = (id: string, checked: boolean) => {
    const next = new Set(selected);
    if (checked) next.add(id);
    else next.delete(id);
    // Порядок — как в collection (как при сборе отмеченных чекбоксов в DOM).
    onList(collection.map((opt) => String(opt.id)).filter((optId) => next.has(optId)));
  };
  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
      {collection.map((opt) => (
        <CheckboxField
          key={opt.id}
          label={opt.name}
          checked={selected.has(String(opt.id))}
          disabled={disabled}
          onCheckedChange={(checked) => toggle(String(opt.id), checked === true)}
        />
      ))}
    </div>
  );
}

function JsonWidget({
  uid,
  value,
  onChange,
  disabled,
  note,
}: {
  uid: string;
  value: unknown;
  onChange: (next: unknown) => void;
  disabled?: boolean;
  note?: string;
}) {
  const [draft, setDraft] = React.useState<string | null>(null);
  const text = draft ?? formatJsonStrict(value);
  const parsed = draft === null ? null : parseJsonDraft(draft);
  const error = parsed && !parsed.ok ? parsed.error : null;
  return (
    <div className="flex flex-col gap-1.5">
      {note ? <p className="text-caption text-muted-foreground">{note}</p> : null}
      <Textarea
        id={`${uid}-json`}
        aria-label="Значение (JSON)"
        aria-invalid={error ? true : undefined}
        rows={8}
        value={text}
        disabled={disabled}
        spellCheck={false}
        className="min-h-32 font-mono text-subhead"
        onChange={(e) => {
          const raw = e.target.value;
          setDraft(raw);
          const result = parseJsonDraft(raw);
          if (result.ok) onChange(result.value);
        }}
        onBlur={() => {
          // Валидный черновик уже ушёл наружу — показываем отформатированный; невалидный оставляем.
          if (draft !== null && parseJsonDraft(draft).ok) setDraft(null);
        }}
      />
      {error ? <p className="text-caption text-destructive">Некорректный JSON: {error}</p> : null}
    </div>
  );
}

/* ---------- тело виджета по типу ---------- */

interface WidgetBodyProps {
  uid: string;
  def: ConditionDefinition | null;
  value: unknown;
  onChange: (next: unknown) => void;
  taskOptions: ReadonlyArray<TaskOption>;
  countries: { data: CountriesData | null; loading: boolean };
  disabled?: boolean;
}

function WidgetBody({
  uid,
  def,
  value,
  onChange,
  taskOptions,
  countries,
  disabled,
}: WidgetBodyProps) {
  const widgetType = def?.type || "unknown";
  const v = isRecord(value) ? value : {};
  const patch = (fields: Record<string, unknown>) => onChange(patchValue(value, fields));

  if (!def || !isHandledWidget(def)) {
    return (
      <JsonWidget
        uid={uid}
        value={value}
        onChange={onChange}
        disabled={disabled}
        note={`Тип «${widgetType}» — расширенное редактирование значения.`}
      />
    );
  }

  if (widgetType === "boolean") {
    return (
      <CheckboxField
        label={def.label}
        checked={Boolean(value)}
        disabled={disabled}
        onCheckedChange={(checked) => onChange(checked === true)}
      />
    );
  }

  if (widgetType === "string") {
    return (
      <Field label="Значение" htmlFor={`${uid}-value`} wide>
        <Input
          id={`${uid}-value`}
          value={String(value ?? "")}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      </Field>
    );
  }

  if (widgetType === "number") {
    const types = def.availableTypes || NUMBER_TYPES;
    const isRange = v.type === "range";
    return (
      <Group title="Значение">
        <SegmentedField
          label="Как сравнивать"
          options={types}
          value={v.type ?? types[0]?.id}
          onValue={(id) => patch({ type: id })}
          disabled={disabled}
        />
        <Row>
          <Field label={isRange ? "От" : "Значение"} htmlFor={`${uid}-min`}>
            <NumberField
              id={`${uid}-min`}
              value={v.min ?? 0}
              onValue={(num) => patch({ min: num })}
              disabled={disabled}
            />
          </Field>
          {isRange ? (
            <Field label="До" htmlFor={`${uid}-max`}>
              <NumberField
                id={`${uid}-max`}
                value={v.max ?? 0}
                onValue={(num) => patch({ max: num })}
                disabled={disabled}
              />
            </Field>
          ) : null}
        </Row>
      </Group>
    );
  }

  if (widgetType === "boolean_checkboxes" || widgetType === "boolean_tags") {
    const types = def.availableTypes || BOOLEAN_TYPES;
    return (
      <div className="flex flex-col gap-3">
        <SegmentedField
          label="Условие"
          options={types}
          value={v.type ?? "enabled"}
          onValue={(id) => patch({ type: id })}
          disabled={disabled}
        />
        {def.collection?.length ? (
          <Group title="Список">
            <CheckboxListWidget
              collection={def.collection}
              list={v.list}
              onList={(list) => patch({ list })}
              disabled={disabled}
            />
          </Group>
        ) : null}
        <CheckboxField
          label="Только выполненные"
          checked={Boolean(v.only_completed)}
          disabled={disabled}
          onCheckedChange={(checked) => patch({ only_completed: checked === true })}
        />
      </div>
    );
  }

  if (widgetType === "select") {
    const collection = def.collection || [];
    if (isMultipleSelect(def)) {
      return (
        <Field label={def.label} htmlFor={`${uid}-value`} wide>
          <MultiCombobox
            id={`${uid}-value`}
            options={toComboOptions(collection)}
            value={selectMultiValue(value)}
            onChange={(values) => onChange(values)}
            placeholder="Выберите…"
            disabled={disabled}
          />
        </Field>
      );
    }
    return (
      <Field label={def.label}>
        <SimpleSelect
          value={String(value ?? "")}
          onValueChange={(raw) => onChange(raw === "" ? null : raw)}
          options={toSelectOptions(collection)}
          nullable
          disabled={disabled}
          aria-label={def.label}
        />
      </Field>
    );
  }

  if (widgetType === "tags_extended" || def.name === "user_id") {
    const types = def.availableTypes || INCLUDE_EXCLUDE_TYPES;
    return (
      <div className="flex flex-col gap-3">
        <SegmentedField
          label="Условие"
          options={types}
          value={v.type ?? "enabled"}
          onValue={(id) => patch({ type: id })}
          disabled={disabled}
        />
        {def.collection?.length ? (
          <Field label="Список" htmlFor={`${uid}-list`} wide>
            <MultiCombobox
              id={`${uid}-list`}
              options={toComboOptions(def.collection)}
              value={stringList(v.list)}
              onChange={(list) => patch({ list })}
              placeholder="Выберите…"
              disabled={disabled}
            />
          </Field>
        ) : (
          <TagsField
            id={`${uid}-list`}
            label="ID (через запятую)"
            list={v.list}
            onList={(list) => patch({ list })}
            disabled={disabled}
          />
        )}
      </div>
    );
  }

  if (widgetType === "gamification_task" || widgetType === "groups") {
    const isGroups = widgetType === "groups";
    const types = def.availableTypes || INCLUDE_EXCLUDE_TYPES;
    const extraTypes = def.availableExtraTypes || LIST_LOGIC_TYPES;
    const selectedIds = stringList(v.list);
    const hasCollection = isGroups
      ? (def.collection?.length || 0) > 0
      : hasGamificationTaskOptions(def, taskOptions);
    const options = isGroups
      ? def.collection
      : resolveGamificationTaskOptions(def, selectedIds, taskOptions);
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          <SegmentedField
            label="Условие"
            options={types}
            value={v.type ?? "enabled"}
            onValue={(id) => patch({ type: id })}
            disabled={disabled}
          />
          <SegmentedField
            label="Логика списка"
            options={extraTypes}
            value={v.extra_type ?? "or"}
            onValue={(id) => patch({ extra_type: id })}
            disabled={disabled}
          />
        </div>
        <Group title={isGroups ? "Группы" : "Задания"}>
          {hasCollection ? (
            <MultiCombobox
              id={`${uid}-list`}
              options={toComboOptions(options)}
              value={selectedIds}
              onChange={(list) => patch({ list })}
              placeholder={isGroups ? "Выберите группы…" : "Выберите задания…"}
              disabled={disabled}
              aria-label={isGroups ? "Группы" : "Задания"}
            />
          ) : (
            <TagsField
              id={`${uid}-list`}
              label={isGroups ? "ID групп" : "ID заданий"}
              list={v.list}
              onList={(list) => patch({ list })}
              disabled={disabled}
            />
          )}
          {!isGroups ? (
            <CheckboxField
              label="Только выполненные"
              checked={v.only_completed === true}
              disabled={disabled}
              onCheckedChange={(checked) => patch({ only_completed: checked === true })}
            />
          ) : null}
        </Group>
      </div>
    );
  }

  if (widgetType === "payment") {
    const existenceTypes = extraOptionList(def, "availableExistenceTypes") || EXISTENCE_TYPES;
    const statusTypes = extraOptionList(def, "availablePaymentStatuses") || PAYMENT_STATUSES;
    const periodTypes = extraOptionList(def, "availablePeriodTypes");
    return (
      <div className="flex flex-col gap-3">
        <Group title="Платёж">
          <Row>
            <Field label="Наличие">
              <SimpleSelect
                value={String(v.existence ?? "any")}
                onValueChange={(existence) => patch({ existence })}
                options={toSelectOptions(existenceTypes)}
                disabled={disabled}
                aria-label="Наличие"
              />
            </Field>
            <Field label="Статус">
              <SimpleSelect
                value={String(v.status ?? "any")}
                onValueChange={(status) => patch({ status })}
                options={toSelectOptions(statusTypes)}
                disabled={disabled}
                aria-label="Статус"
              />
            </Field>
          </Row>
        </Group>
        <DurationWidget
          uid={uid}
          value={value}
          periods={periodTypes}
          onChange={onChange}
          disabled={disabled}
        />
        <MoneyRangeWidget
          uid={uid}
          title="Диапазон суммы"
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      </div>
    );
  }

  if (widgetType === "bet") {
    const gameCategories = extraOptionList(def, "availableGameCategories");
    const betTypes = extraOptionList(def, "availableBetTypes");
    return (
      <div className="flex flex-col gap-3">
        <DurationWidget
          uid={uid}
          value={value}
          periods={extraOptionList(def, "availablePeriods")}
          onChange={onChange}
          disabled={disabled}
        />
        <MoneyRangeWidget
          uid={uid}
          title="Количество / сумма ставок"
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
        {gameCategories?.length || betTypes?.length ? (
          <Group title="Параметры ставки">
            {gameCategories?.length ? (
              <Field label="Категории игр" htmlFor={`${uid}-game-categories`} wide>
                <MultiCombobox
                  id={`${uid}-game-categories`}
                  options={toComboOptions(gameCategories)}
                  value={stringList(v.game_categories)}
                  onChange={(list) => patch({ game_categories: list })}
                  placeholder="Выберите категории…"
                  disabled={disabled}
                />
              </Field>
            ) : null}
            {betTypes?.length ? (
              <Field label="Тип ставки">
                <SimpleSelect
                  value={String(v.bet_type ?? "")}
                  onValueChange={(raw) => patch({ bet_type: raw === "" ? null : raw })}
                  options={toSelectOptions(betTypes)}
                  nullable
                  disabled={disabled}
                  aria-label="Тип ставки"
                />
              </Field>
            ) : null}
          </Group>
        ) : null}
      </div>
    );
  }

  if (widgetType === "countries_with_lists") {
    const types = def.availableTypes || INCLUDE_EXCLUDE_TYPES;
    return (
      <div className="flex flex-col gap-3">
        <SegmentedField
          label="Условие"
          options={types}
          value={v.type ?? "enabled"}
          onValue={(id) => patch({ type: id })}
          disabled={disabled}
        />
        <Group title="Страны">
          <CountrySelector
            value={conditionValueToCountrySelector(value)}
            onChange={(next) => onChange(countrySelectorToConditionValue(next, value))}
            data={countries.data}
            loading={countries.loading}
            disabled={disabled}
          />
        </Group>
      </div>
    );
  }

  return <JsonWidget uid={uid} value={value} onChange={onChange} disabled={disabled} />;
}

/* ---------- сам билдер ---------- */

export function ConditionsBuilder({
  value,
  onChange,
  schema,
  schemaLoading = false,
  schemaError = null,
  duplicable,
  taskOptions,
  countries,
  disabled = false,
  className,
}: ConditionsBuilderProps) {
  const uid = React.useId();
  const [items, commit] = useConditionItems(value);
  const [selectedIdState, setSelectedId] = React.useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [pickerQuery, setPickerQuery] = React.useState("");
  const [modes, setModes] = React.useState<Record<string, EditMode>>({});

  // Выбранное условие — производное: если выбранного уже нет, берём первое (как setValue в старом коде).
  const selectedId = items.some((item) => item.id === selectedIdState)
    ? selectedIdState
    : (items[0]?.id ?? null);
  const selected = items.find((item) => item.id === selectedId) ?? null;
  const selectedDef = selected ? getConditionDef(schema, selected.name) : null;
  const selectedHandled = isHandledWidget(selectedDef);
  const mode: EditMode = selected && selectedHandled ? (modes[selected.id] ?? "ui") : "json";

  const emit = (next: ConditionItem[]) => onChange(commit(next));

  const setItemValue = (id: string, nextValue: unknown) =>
    emit(items.map((item) => (item.id === id ? { ...item, value: nextValue } : item)));

  const removeItem = (id: string) => {
    const next = items.filter((item) => item.id !== id);
    if (selectedId === id) setSelectedId(next[0]?.id ?? null);
    emit(next);
  };

  const addItem = (name: string) => {
    if (!canAddCondition(items, name, duplicable)) return;
    const item: ConditionItem = {
      id: createConditionId(),
      name,
      value: defaultValueForDef(getConditionDef(schema, name)),
    };
    setSelectedId(item.id);
    setPickerOpen(false);
    setPickerQuery("");
    emit([...items, item]);
  };

  const pickerConditions = filterPickerConditions(schema, pickerQuery);
  const statusText = schemaStatusText(schema, duplicable, schemaLoading, schemaError);

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          role="status"
          className={cn(
            "flex items-center gap-2 text-caption",
            schemaError ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {schemaLoading ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : null}
          <span>{statusText}</span>
        </div>

        <Popover
          open={pickerOpen}
          onOpenChange={(open) => {
            setPickerOpen(open);
            if (!open) setPickerQuery("");
          }}
        >
          <PopoverTrigger asChild>
            <Button variant="primary" size="sm" disabled={disabled || !schema}>
              <Plus /> Добавить условие
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-0" align="end">
            <Command shouldFilter={false}>
              <CommandInput
                value={pickerQuery}
                onValueChange={setPickerQuery}
                placeholder="Поиск по названию…"
              />
              <CommandList>
                {pickerConditions.length === 0 ? (
                  <CommandEmpty>
                    {pickerQuery ? "Ничего не найдено" : "Все условия уже добавлены"}
                  </CommandEmpty>
                ) : (
                  pickerConditions.map((def) => {
                    const addable = canAddCondition(items, def.name, duplicable);
                    return (
                      <CommandItem
                        key={def.name}
                        value={def.name}
                        disabled={!addable}
                        onSelect={() => addItem(def.name)}
                        className="flex-col items-start gap-0"
                      >
                        <span className="truncate">{conditionLabel(def.name, def)}</span>
                        <span className="text-caption text-muted-foreground">
                          {def.name} · {def.type}
                          {!addable ? " · уже добавлено" : ""}
                        </span>
                      </CommandItem>
                    );
                  })
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-[14rem_minmax(0,1fr)]">
        <aside className="flex flex-col gap-1.5 self-start rounded-lg bg-surface-2/40 p-2">
          <div className="px-1 text-caption font-semibold text-muted-foreground uppercase">
            Активные условия ({items.length})
          </div>
          {items.length === 0 ? (
            <div className="px-1 py-2 text-subhead text-muted-foreground">Нет активных условий</div>
          ) : (
            <ul className="flex max-h-96 flex-col gap-0.5 overflow-y-auto">
              {items.map((item) => {
                const def = getConditionDef(schema, item.name);
                const isSelected = item.id === selectedId;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      aria-current={isSelected ? "true" : undefined}
                      onClick={() => setSelectedId(item.id)}
                      className={cn(
                        "flex w-full cursor-pointer flex-col items-start rounded-md border px-2 py-1.5 text-left transition-colors outline-none",
                        "focus-visible:ring-2 focus-visible:ring-ring/60",
                        isSelected
                          ? "border-primary bg-surface"
                          : "border-transparent hover:bg-surface",
                      )}
                    >
                      <span className="w-full truncate text-subhead text-foreground">
                        {conditionInstanceLabel(items, item, def)}
                      </span>
                      <span className="w-full truncate font-mono text-caption text-muted-foreground">
                        {item.name}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <AnimatedHeight className="min-w-0 rounded-lg">
          {selected ? (
            <article className="flex flex-col gap-4 rounded-lg bg-surface-2/40 p-4">
              <header className="flex flex-wrap items-start justify-between gap-2 border-b border-border pb-3">
                <div className="min-w-0">
                  <div className="text-headline">
                    {conditionInstanceLabel(items, selected, selectedDef)}
                  </div>
                  <div className="font-mono text-caption text-muted-foreground">
                    {selected.name} · {widgetTypeHint(selectedDef)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {selectedHandled ? (
                    <Segmented
                      size="sm"
                      value={mode}
                      onValueChange={(next) =>
                        setModes((prev) => ({ ...prev, [selected.id]: next }))
                      }
                      options={[
                        { value: "ui", label: "UI" },
                        { value: "json", label: "JSON" },
                      ]}
                      aria-label="Режим редактирования"
                    />
                  ) : null}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Удалить"
                    title="Удалить"
                    disabled={disabled}
                    onClick={() => removeItem(selected.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </header>
              {mode === "json" && selectedHandled ? (
                <JsonWidget
                  key={selected.id}
                  uid={`${uid}-${selected.id}`}
                  value={selected.value}
                  onChange={(next) => setItemValue(selected.id, next)}
                  disabled={disabled}
                />
              ) : (
                <WidgetBody
                  key={selected.id}
                  uid={`${uid}-${selected.id}`}
                  def={selectedDef}
                  value={selected.value}
                  onChange={(next) => setItemValue(selected.id, next)}
                  taskOptions={taskOptions}
                  countries={countries}
                  disabled={disabled}
                />
              )}
            </article>
          ) : (
            <div className="rounded-lg bg-surface-2/40 p-4 text-subhead text-muted-foreground">
              Добавьте условие из списка слева
            </div>
          )}
        </AnimatedHeight>
      </div>
    </div>
  );
}
