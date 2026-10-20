/**
 * Выбор стран / уровней стран для таргетинга задачи (замена mountCountrySelector).
 * Controlled: `value` + `onChange`. Режимы как у старого компонента:
 * `loading` — спиннер, `ui` — комбобоксы по справочнику, `fallback` (data === null) —
 * ручной ввод кодов с пояснением.
 */
import { Loader2 } from "lucide-react";
import * as React from "react";

import { MultiCombobox } from "@/components/multi-combobox";
import { CheckboxField } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";

import {
  ALL_COUNTRIES,
  COUNTRIES_MATCHING_TYPES,
  countryLabel,
  loadCountriesData,
  normalizeCountrySelectorValue,
  type CountriesData,
  type CountriesMatchingTypeId,
  type CountrySelectorValue,
} from "./country-selector";

const FALLBACK_NOTICE =
  "Не удалось загрузить справочник стран. Можно выбрать «Все страны» или оставить ранее заданные коды; список для выбора недоступен, пока справочник не загрузится.";

export interface CountrySelectorProps {
  value: CountrySelectorValue;
  onChange: (next: CountrySelectorValue) => void;
  /** null — режим fallback (ручной ввод кодов), как у старого компонента. */
  data: CountriesData | null;
  loading?: boolean;
  disabled?: boolean;
  className?: string;
}

function parseCodesInput(raw: string): string[] {
  return raw
    .split(/[,;\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Текстовое поле со списком через запятую: черновик ввода живёт локально,
 * в `onChange` уходит разобранный список при blur / Enter.
 */
function ListInput({
  id,
  items,
  onCommit,
  placeholder,
  disabled,
  uppercase,
}: {
  id: string;
  items: string[];
  onCommit: (items: string[]) => void;
  placeholder: string;
  disabled?: boolean;
  uppercase?: boolean;
}) {
  const [draft, setDraft] = React.useState<string | null>(null);
  const text = draft ?? items.join(", ");

  const commit = () => {
    if (draft === null) return;
    const parsed = parseCodesInput(draft);
    onCommit(uppercase ? parsed.map((code) => code.toUpperCase()) : parsed);
    setDraft(null);
  };

  return (
    <Input
      id={id}
      value={text}
      placeholder={placeholder}
      disabled={disabled}
      autoComplete="off"
      className="font-mono text-subhead"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
      }}
    />
  );
}

export function CountrySelector({
  value,
  onChange,
  data,
  loading = false,
  disabled = false,
  className,
}: CountrySelectorProps) {
  const uid = React.useId();
  const normalized = normalizeCountrySelectorValue(value);
  const matchingType = normalized.matchingType as CountriesMatchingTypeId;
  const allSelected = normalized.countries.includes(ALL_COUNTRIES);
  const isFallback = !loading && data === null;

  const countryOptions = React.useMemo(
    () => (data?.countries ?? []).map((item) => ({ value: item.code, label: countryLabel(item) })),
    [data],
  );
  const listOptions = React.useMemo(
    () => (data?.countriesLists ?? []).map((item) => ({ value: item.id, label: item.label })),
    [data],
  );

  const patch = (next: Partial<CountrySelectorValue>) => onChange({ ...normalized, ...next });

  if (loading) {
    return (
      <div
        className={cn("flex items-center gap-2 text-subhead text-muted-foreground", className)}
        role="status"
      >
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        <span>Загрузка списка стран…</span>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {isFallback ? (
        <div
          className="rounded-md bg-surface-2 px-3 py-2 text-caption text-muted-foreground"
          role="status"
        >
          {FALLBACK_NOTICE}
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label>Сопоставлять по</Label>
        <Segmented
          value={matchingType}
          onValueChange={(next) => patch({ matchingType: next })}
          options={COUNTRIES_MATCHING_TYPES.map((item) => ({
            value: item.id,
            label: item.label,
            disabled,
          }))}
          aria-label="Сопоставлять по"
        />
      </div>

      {matchingType === "countries" ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${uid}-countries`}>Страны</Label>
          {isFallback ? (
            <>
              <ListInput
                id={`${uid}-countries`}
                items={allSelected ? [] : normalized.countries}
                onCommit={(codes) => patch({ countries: codes })}
                placeholder="Коды стран через запятую: US, DE, FR"
                disabled={disabled || allSelected}
                uppercase
              />
              <CheckboxField
                label="Все страны"
                checked={allSelected}
                disabled={disabled}
                onCheckedChange={(checked) =>
                  patch({ countries: checked === true ? [ALL_COUNTRIES] : [] })
                }
              />
            </>
          ) : (
            <MultiCombobox
              id={`${uid}-countries`}
              options={countryOptions}
              value={normalized.countries}
              onChange={(codes) => patch({ countries: codes })}
              allowAll
              allLabel="Все страны"
              placeholder="Поиск по коду или названию…"
              searchPlaceholder="Поиск по коду или названию…"
              disabled={disabled}
              aria-label="Страны"
            />
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${uid}-lists`}>Уровни стран (countries_lists)</Label>
          {isFallback ? (
            <ListInput
              id={`${uid}-lists`}
              items={normalized.countriesLists}
              onCommit={(ids) => patch({ countriesLists: ids })}
              placeholder="Идентификаторы уровней через запятую"
              disabled={disabled}
            />
          ) : (
            <MultiCombobox
              id={`${uid}-lists`}
              options={listOptions}
              value={normalized.countriesLists}
              onChange={(ids) => patch({ countriesLists: ids })}
              placeholder="Поиск уровня…"
              searchPlaceholder="Поиск уровня…"
              disabled={disabled}
              aria-label="Уровни стран"
            />
          )}
        </div>
      )}
    </div>
  );
}

interface CountriesState {
  key: string;
  data: CountriesData | null;
  error: string | null;
}

/** Справочник стран для домена: `{ data, loading, error, reload }`. */
export function useCountriesData(domain: string): {
  data: CountriesData | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
} {
  const [seq, setSeq] = React.useState(0);
  const [state, setState] = React.useState<CountriesState | null>(null);
  const key = `${seq}:${String(domain || "").trim()}`;

  React.useEffect(() => {
    let cancelled = false;
    loadCountriesData(domain)
      .then((data) => {
        if (!cancelled) setState({ key, data, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setState({ key, data: null, error: message });
      });
    return () => {
      cancelled = true;
    };
  }, [key, domain]);

  // Состояние «актуально» только для текущего key: смена домена / reload ⇒ loading без setState в эффекте.
  const current = state && state.key === key ? state : null;
  return {
    data: current?.data ?? null,
    loading: current === null,
    error: current?.error ?? null,
    reload: () => setSeq((n) => n + 1),
  };
}
