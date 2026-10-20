/**
 * Редактор целевых действий задачи (замена actions-builder.js).
 * Controlled: `value` — API-формат (`TaskAction[]` + флаги sequential); каждое изменение
 * проходит через `toEditorFields` → правка → `toApiAction`, как legacy `getValue()`.
 * Локальный state только для UI: добавленные пустые поля, черновик текста в фокусе,
 * выбранный оператор сравнения без значения, подписи игр.
 */
import { Plus, Trash2 } from "lucide-react";
import * as React from "react";

import { MultiCombobox, type MultiComboboxOption } from "@/components/multi-combobox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SimpleSelect,
} from "@/components/ui/select";
import { SwitchField } from "@/components/ui/switch";
import {
  ACTION_LABELS,
  ACTION_TYPES,
  COMPARISON_OPERATORS,
  buildComparisonValue,
  filterFieldKeysForAction,
  formatRequirementFieldInputValue,
  getActionDef,
  getAttributeFieldsForAction,
  getConditionFieldsForAction,
  getRequirementFieldDef,
  parseComparisonValue,
  readRequirementFieldInputValue,
  type FieldOption,
  type FieldRole,
  type RequirementFieldDef,
} from "@/lib/actions-schema";
import { resolveGamesByIds, searchGames } from "@/lib/games-api";
import type { TaskAction } from "@/lib/types";

import {
  DEFAULT_ACTION_TYPE,
  createEmptyAction,
  deleteFieldKey,
  formatMultiText,
  isRemoteOptionsField,
  moneyRangeInputs,
  normalizeMultiSelectValue,
  parseMultiText,
  resolveFieldOptions,
  retargetFields,
  setDuration,
  setMoneyRange,
  toApiAction,
  toEditorFields,
  visibleFieldKeys,
  type ActionFields,
  type BlockId,
} from "./actions-builder";

export interface ActionsValue {
  main: TaskAction[];
  secondary: TaskAction[];
  mainSequential: boolean;
  secondarySequential: boolean;
}

export interface ActionsBuilderProps {
  value: ActionsValue;
  onChange: (next: ActionsValue) => void;
  /** Домен админки — для поиска игр. */
  domain: string;
  /** Опции select/multi из conditions schema (`buildActionFieldOptionsFromConditionsSchema`). */
  fieldOptions: Record<string, FieldOption[]>;
  disabled?: boolean;
}

/** Поля, добавленные пользователем без значения; привязаны к типу действия карточки. */
interface ExtraEntry {
  action: string;
  keys: string[];
}
type ExtraMap = Record<BlockId, ExtraEntry[]>;

const BLOCKS: ReadonlyArray<{
  id: BlockId;
  title: string;
  sequentialKey: "mainSequential" | "secondarySequential";
}> = [
  { id: "main", title: "Основной блок", sequentialKey: "mainSequential" },
  { id: "secondary", title: "Дополнительный блок", sequentialKey: "secondarySequential" },
];

const ACTION_TYPE_OPTIONS = ACTION_TYPES.map((type) => ({
  value: type,
  label: ACTION_LABELS[type] ?? type,
}));

const NO_OPTIONS: MultiComboboxOption[] = [];

const str = (value: unknown): string => (value == null ? "" : String(value));

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function updateAt<T>(list: T[], index: number, next: T): T[] {
  return list.map((item, i) => (i === index ? next : item));
}

function removeAt<T>(list: T[], index: number): T[] {
  return list.filter((_, i) => i !== index);
}

function withEntry(
  list: ExtraEntry[],
  index: number,
  update: (entry: ExtraEntry | undefined) => ExtraEntry,
): ExtraEntry[] {
  const next = [...list];
  while (next.length < index) next.push({ action: "", keys: [] });
  next[index] = update(list[index]);
  return next;
}

function extraKeysOf(entry: ExtraEntry | undefined, action: string): string[] {
  return entry && entry.action === action ? entry.keys : [];
}

function collectGameIds(actions: TaskAction[]): string[] {
  const ids = new Set<string>();
  for (const action of actions) {
    for (const id of normalizeMultiSelectValue(toEditorFields(action).games)) ids.add(id);
  }
  return [...ids].sort();
}

/** Подписи игр по id (legacy: resolveGamesByIds при монтировании); незнакомые остаются id. */
function useGameLabels(domain: string, ids: readonly string[]): Record<string, string> {
  const [labels, setLabels] = React.useState<Record<string, string>>({});
  const requested = React.useRef<{ domain: string; ids: Set<string> }>({
    domain: "",
    ids: new Set(),
  });
  const idsKey = ids.join("\n");

  React.useEffect(() => {
    if (!domain) return;
    if (requested.current.domain !== domain) requested.current = { domain, ids: new Set() };
    const pending = requested.current.ids;
    const missing = idsKey.split("\n").filter((id) => id && !pending.has(id));
    if (!missing.length) return;
    for (const id of missing) pending.add(id);
    void resolveGamesByIds(domain, missing)
      .then((resolved) => {
        if (requested.current.domain !== domain) return;
        setLabels((prev) => {
          const next = { ...prev };
          for (const game of resolved) next[game.id] = game.label;
          return next;
        });
      })
      .catch(() => {
        /* оставляем id как подпись */
      });
  }, [domain, idsKey]);

  return labels;
}

/** Текстовое поле с черновиком: пока в фокусе показывает ввод как есть, после blur — значение. */
function DraftInput({
  value,
  onCommit,
  onBlur,
  ...rest
}: Omit<React.ComponentProps<typeof Input>, "value" | "onChange"> & {
  value: string;
  onCommit: (raw: string) => void;
}) {
  const [draft, setDraft] = React.useState<string | null>(null);
  return (
    <Input
      {...rest}
      value={draft ?? value}
      onChange={(e) => {
        setDraft(e.target.value);
        onCommit(e.target.value);
      }}
      onBlur={(e) => {
        setDraft(null);
        onBlur?.(e);
      }}
    />
  );
}

interface ControlProps {
  def: RequirementFieldDef;
  actionType: string;
  fields: ActionFields;
  fieldOptions: Record<string, FieldOption[]>;
  gameLabels: Record<string, string>;
  onSearchGames: (query: string) => Promise<MultiComboboxOption[]>;
  disabled: boolean;
  id: string;
  onFields: (next: ActionFields) => void;
}

function MultiTextControl({ def, fields, disabled, id, onFields }: ControlProps) {
  const current = fields[def.key];
  return (
    <DraftInput
      id={id}
      value={formatMultiText(current)}
      placeholder={def.hint ?? "через запятую"}
      disabled={disabled}
      onCommit={(raw) => {
        try {
          const next = { ...fields };
          const parsed = parseMultiText(raw);
          if (parsed === undefined) delete next[def.key];
          else next[def.key] = parsed;
          onFields(next);
        } catch {
          /* незавершённый JSON-массив — ждём ввода */
        }
      }}
    />
  );
}

function MultiSelectControl(props: ControlProps) {
  const { def, fields, fieldOptions, gameLabels, onSearchGames, disabled, id, onFields } = props;
  const value = normalizeMultiSelectValue(fields[def.key]);
  const commit = (next: string[]) => {
    const nextFields = { ...fields };
    if (next.length) nextFields[def.key] = next;
    else delete nextFields[def.key];
    onFields(nextFields);
  };

  if (isRemoteOptionsField(def)) {
    return (
      <MultiCombobox
        id={id}
        options={NO_OPTIONS}
        value={value}
        onChange={commit}
        placeholder={def.label}
        searchPlaceholder="Поиск игры…"
        remoteSearch
        minSearchLength={2}
        searchDebounceMs={300}
        onSearch={onSearchGames}
        resolveLabel={(v) => gameLabels[v]}
        disabled={disabled}
      />
    );
  }

  const options = resolveFieldOptions(def, fieldOptions);
  if (!options.length) return <MultiTextControl {...props} />;
  return (
    <MultiCombobox
      id={id}
      options={options}
      value={value}
      onChange={commit}
      placeholder={def.label}
      searchPlaceholder="Поиск…"
      disabled={disabled}
    />
  );
}

function ComparisonControl({ def, fields, disabled, id, onFields }: ControlProps) {
  const current = fields[def.key];
  const parsed = parseComparisonValue(current);
  // Оператор без значения не попадает в API — держим выбор локально, пока не введут число.
  const [opDraft, setOpDraft] = React.useState<string | null>(null);
  const valueText = formatRequirementFieldInputValue(def.key, current);
  const op = valueText ? parsed.type : (opDraft ?? parsed.type);

  const commit = (type: string, raw: string) => {
    const next = { ...fields };
    const built = raw.trim() ? buildComparisonValue(type, raw.trim()) : undefined;
    if (built) next[def.key] = built;
    else delete next[def.key];
    onFields(next);
  };

  return (
    <div className="flex items-center gap-2">
      <SimpleSelect
        value={op}
        onValueChange={(type) => {
          setOpDraft(type);
          commit(type, valueText);
        }}
        options={COMPARISON_OPERATORS.map((o) => ({
          value: o.id,
          label: <span title={`${o.symbol} ${o.label}`}>{o.symbol}</span>,
        }))}
        aria-label="Оператор"
        className="w-20 shrink-0"
        disabled={disabled}
      />
      <DraftInput
        id={id}
        inputMode="decimal"
        placeholder="Значение"
        value={valueText}
        onCommit={(raw) => commit(op, raw)}
        disabled={disabled}
      />
    </div>
  );
}

function FieldControl(props: ControlProps) {
  const { def, actionType, fields, disabled, id, onFields } = props;
  const key = def.key;
  const current = fields[key];
  const set = (val: unknown) => {
    const next = { ...fields };
    if (val === undefined) delete next[key];
    else next[key] = val;
    onFields(next);
  };

  switch (def.widget) {
    case "select":
      return (
        <SimpleSelect
          value={str(current)}
          onValueChange={(v) => set(v || undefined)}
          options={(def.options ?? []).map((o) => ({ value: String(o.id), label: o.label }))}
          nullable
          aria-label={def.label}
          disabled={disabled}
        />
      );
    case "boolean":
      return (
        <CheckboxField
          id={id}
          label="Да"
          checked={!!current}
          onCheckedChange={(checked) => set(checked === true ? true : undefined)}
          disabled={disabled}
        />
      );
    case "number":
      return (
        <DraftInput
          id={id}
          type="number"
          min={0}
          step={1}
          value={str(current)}
          onCommit={(raw) => {
            const num = Number(raw.trim());
            set(raw.trim() && Number.isFinite(num) ? num : undefined);
          }}
          disabled={disabled}
        />
      );
    case "multi_select":
      return <MultiSelectControl {...props} />;
    case "multi_text":
      return <MultiTextControl {...props} />;
    case "duration": {
      const obj = isRecord(current) ? current : {};
      return (
        <div className="flex items-center gap-2">
          <DraftInput
            id={id}
            value={str(obj.value)}
            placeholder="Значение"
            onCommit={(raw) =>
              onFields(setDuration(fields, { value: raw, period: str(obj.period) }))
            }
            disabled={disabled}
          />
          <SimpleSelect
            value={str(obj.period)}
            onValueChange={(period) =>
              onFields(setDuration(fields, { value: str(obj.value), period }))
            }
            options={(def.options ?? []).map((o) => ({ value: String(o.id), label: o.label }))}
            nullable
            aria-label="Период"
            className="w-36 shrink-0"
            disabled={disabled}
          />
        </div>
      );
    }
    case "money_range": {
      const range = moneyRangeInputs(actionType, fields);
      return (
        <div className="flex items-center gap-2">
          <DraftInput
            id={id}
            value={range.min}
            placeholder="Мин."
            onCommit={(min) => onFields(setMoneyRange(fields, actionType, { min, max: range.max }))}
            disabled={disabled}
          />
          <span className="text-muted-foreground">—</span>
          <DraftInput
            aria-label="Макс."
            value={range.max}
            placeholder="Макс."
            onCommit={(max) => onFields(setMoneyRange(fields, actionType, { min: range.min, max }))}
            disabled={disabled}
          />
        </div>
      );
    }
    case "comparison":
      return <ComparisonControl {...props} />;
    default:
      return (
        <DraftInput
          id={id}
          value={formatRequirementFieldInputValue(key, current)}
          onCommit={(raw) => {
            const trimmed = raw.trim();
            set(trimmed ? readRequirementFieldInputValue(key, trimmed, current) : undefined);
          }}
          disabled={disabled}
        />
      );
  }
}

function FieldRow({ onRemove, ...props }: Omit<ControlProps, "id"> & { onRemove: () => void }) {
  const id = React.useId();
  const { def, disabled } = props;
  return (
    <div className="flex flex-col gap-1.5 rounded-md bg-surface-2/40 p-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{def.label}</Label>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Удалить ${def.label}`}
          title="Удалить"
          onClick={onRemove}
          disabled={disabled}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
      <FieldControl {...props} id={id} />
    </div>
  );
}

function AddFieldSelect({
  label,
  available,
  disabled,
  onAdd,
}: {
  label: string;
  available: RequirementFieldDef[];
  disabled: boolean;
  onAdd: (key: string) => void;
}) {
  if (!available.length) {
    return <span className="text-caption text-muted-foreground">Все поля добавлены</span>;
  }
  // Значение всегда "" — после выбора select возвращается к placeholder.
  return (
    <Select value="" onValueChange={onAdd} disabled={disabled}>
      <SelectTrigger size="sm" className="w-auto" aria-label={label}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent className="min-w-56">
        {available.map((field) => (
          <SelectItem key={field.key} value={field.key}>
            {field.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function FieldColumn({
  role,
  visibleKeys,
  allFields,
  onAdd,
  onRemove,
  onFields,
  ...control
}: Omit<ControlProps, "def" | "id" | "onFields"> & {
  role: FieldRole;
  visibleKeys: string[];
  allFields: RequirementFieldDef[];
  onAdd: (key: string) => void;
  onRemove: (key: string) => void;
  onFields: (key: string, next: ActionFields) => void;
}) {
  const isCondition = role === "condition";
  const available = allFields.filter((field) => !visibleKeys.includes(field.key));
  const rows = visibleKeys
    .map((key) => getRequirementFieldDef(key))
    .filter((def): def is RequirementFieldDef => def !== null);

  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-center justify-between gap-2">
        <span className="text-subhead font-medium">{isCondition ? "Условия" : "Атрибуты"}</span>
        <AddFieldSelect
          label={isCondition ? "Добавить условие" : "Добавить атрибут"}
          available={available}
          disabled={control.disabled}
          onAdd={onAdd}
        />
      </header>
      {rows.length ? (
        rows.map((def) => (
          <FieldRow
            key={def.key}
            {...control}
            def={def}
            onFields={(next) => onFields(def.key, next)}
            onRemove={() => onRemove(def.key)}
          />
        ))
      ) : (
        <div className="text-caption text-muted-foreground">
          {isCondition ? "Нет условий" : "Нет атрибутов"}
        </div>
      )}
    </section>
  );
}

function ActionCard({
  index,
  action,
  extraKeys,
  fieldOptions,
  gameLabels,
  onSearchGames,
  disabled,
  onChangeType,
  onRemove,
  onFields,
  onAddField,
  onRemoveField,
}: {
  index: number;
  action: TaskAction;
  extraKeys: string[];
  fieldOptions: Record<string, FieldOption[]>;
  gameLabels: Record<string, string>;
  onSearchGames: (query: string) => Promise<MultiComboboxOption[]>;
  disabled: boolean;
  onChangeType: (type: string) => void;
  onRemove: () => void;
  onFields: (key: string, next: ActionFields) => void;
  onAddField: (role: FieldRole, key: string) => void;
  onRemoveField: (key: string) => void;
}) {
  const type = action.action;
  const def = getActionDef(type);
  const fields = toEditorFields(action);
  const typeOptions = ACTION_TYPES.includes(type)
    ? ACTION_TYPE_OPTIONS
    : [...ACTION_TYPE_OPTIONS, { value: type, label: type }];

  const columnProps = {
    actionType: type,
    fields,
    fieldOptions,
    gameLabels,
    onSearchGames,
    disabled,
  };

  return (
    <article className="flex flex-col gap-3 rounded-lg bg-surface p-3">
      <header className="flex items-center gap-2">
        <Badge variant="muted">#{index + 1}</Badge>
        <Label className="shrink-0">Тип действия</Label>
        <SimpleSelect
          value={type}
          onValueChange={onChangeType}
          options={typeOptions}
          aria-label="Тип действия"
          size="sm"
          className="flex-1"
          disabled={disabled}
        />
        <Button type="button" variant="ghost" size="sm" onClick={onRemove} disabled={disabled}>
          <Trash2 />
          Удалить
        </Button>
      </header>
      {def?.handled ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <FieldColumn
            {...columnProps}
            role="condition"
            visibleKeys={visibleFieldKeys(type, fields, "condition", extraKeys)}
            allFields={getConditionFieldsForAction(type)}
            onAdd={(key) => onAddField("condition", key)}
            onRemove={onRemoveField}
            onFields={onFields}
          />
          <FieldColumn
            {...columnProps}
            role="attribute"
            visibleKeys={visibleFieldKeys(type, fields, "attribute", extraKeys)}
            allFields={getAttributeFieldsForAction(type)}
            onAdd={(key) => onAddField("attribute", key)}
            onRemove={onRemoveField}
            onFields={onFields}
          />
        </div>
      ) : (
        <p className="text-subhead text-muted-foreground">
          Тип «{ACTION_LABELS[type] ?? type}» — без настраиваемых параметров в schema
        </p>
      )}
    </article>
  );
}

export function ActionsBuilder({
  value,
  onChange,
  domain,
  fieldOptions,
  disabled = false,
}: ActionsBuilderProps) {
  const [extras, setExtras] = React.useState<ExtraMap>({ main: [], secondary: [] });

  const gameIds = React.useMemo(
    () => collectGameIds([...value.main, ...value.secondary]),
    [value.main, value.secondary],
  );
  const gameLabels = useGameLabels(domain, gameIds);
  const onSearchGames = React.useCallback(
    async (query: string): Promise<MultiComboboxOption[]> =>
      (await searchGames(domain, query)).map((game) => ({ value: game.id, label: game.label })),
    [domain],
  );

  const setBlock = (block: BlockId, items: TaskAction[]) => onChange({ ...value, [block]: items });
  const patchExtras = (block: BlockId, update: (list: ExtraEntry[]) => ExtraEntry[]) =>
    setExtras((prev) => {
      const next = update(prev[block]);
      return next === prev[block] ? prev : { ...prev, [block]: next };
    });

  const addAction = (block: BlockId) => {
    setBlock(block, [...value[block], createEmptyAction()]);
    patchExtras(block, (list) => [...list, { action: DEFAULT_ACTION_TYPE, keys: [] }]);
  };

  const removeAction = (block: BlockId, index: number) => {
    setBlock(block, removeAt(value[block], index));
    patchExtras(block, (list) => removeAt(list, index));
  };

  const changeType = (block: BlockId, index: number, type: string) => {
    const action = value[block][index];
    if (!action) return;
    const next = toApiAction(type, retargetFields(toEditorFields(action), type));
    setBlock(block, updateAt(value[block], index, next));
    patchExtras(block, (list) => withEntry(list, index, () => ({ action: type, keys: [] })));
  };

  /** Правка поля: поле остаётся видимым, даже если значение стёрли (как в legacy). */
  const commitFields = (block: BlockId, index: number, key: string, fields: ActionFields) => {
    const action = value[block][index];
    if (!action) return;
    setBlock(block, updateAt(value[block], index, toApiAction(action.action, fields)));
    addExtraKey(block, index, action.action, key);
  };

  const addExtraKey = (block: BlockId, index: number, actionType: string, key: string) =>
    patchExtras(block, (list) => {
      const keys = extraKeysOf(list[index], actionType);
      if (keys.includes(key)) return list;
      return withEntry(list, index, () => ({ action: actionType, keys: [...keys, key] }));
    });

  const addField = (block: BlockId, index: number, role: FieldRole, key: string) => {
    const action = value[block][index];
    if (!action || !filterFieldKeysForAction(action.action, [key], role).length) return;
    addExtraKey(block, index, action.action, key);
  };

  const removeField = (block: BlockId, index: number, key: string) => {
    const action = value[block][index];
    if (!action) return;
    const fields = deleteFieldKey(toEditorFields(action), key, action.action);
    setBlock(block, updateAt(value[block], index, toApiAction(action.action, fields)));
    patchExtras(block, (list) =>
      withEntry(list, index, (entry) => ({
        action: action.action,
        keys: extraKeysOf(entry, action.action).filter((k) => k !== key),
      })),
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {BLOCKS.map((block) => {
        const items = value[block.id];
        return (
          <section key={block.id} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-headline">{block.title}</div>
              <div className="flex flex-wrap items-center gap-3">
                <SwitchField
                  label="Выполнять по порядку"
                  checked={value[block.sequentialKey]}
                  onCheckedChange={(checked) =>
                    onChange({ ...value, [block.sequentialKey]: checked })
                  }
                  disabled={disabled}
                />
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={() => addAction(block.id)}
                  disabled={disabled}
                >
                  <Plus />
                  Добавить действие
                </Button>
              </div>
            </div>
            {items.length ? (
              items.map((action, index) => (
                <ActionCard
                  key={index}
                  index={index}
                  action={action}
                  extraKeys={extraKeysOf(extras[block.id][index], action.action)}
                  fieldOptions={fieldOptions}
                  gameLabels={gameLabels}
                  onSearchGames={onSearchGames}
                  disabled={disabled}
                  onChangeType={(type) => changeType(block.id, index, type)}
                  onRemove={() => removeAction(block.id, index)}
                  onFields={(key, next) => commitFields(block.id, index, key, next)}
                  onAddField={(role, key) => addField(block.id, index, role, key)}
                  onRemoveField={(key) => removeField(block.id, index, key)}
                />
              ))
            ) : (
              <div className="rounded-md bg-surface p-3 text-subhead text-muted-foreground">
                Нет действий — нажмите «Добавить действие»
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
