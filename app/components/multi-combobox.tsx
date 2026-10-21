/**
 * Multi-select combobox с чипами, поиском и галочками (замена multi-combobox.js).
 * Controlled: `value` — массив строк; при `allowAll` значение `["all"]` означает «все».
 * Удалённый поиск: `remoteSearch` + `onSearch(query)` с debounce; выбранные значения,
 * которых нет в текущих опциях, остаются чипами с подписью = значение.
 */
import { Check, ChevronDown, Loader2, X } from "lucide-react";
import * as React from "react";

import { Command, CommandEmpty, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface MultiComboboxOption {
  value: string;
  label: string;
}

export interface MultiComboboxProps {
  options: ReadonlyArray<MultiComboboxOption>;
  value: ReadonlyArray<string>;
  onChange: (value: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  allowAll?: boolean;
  allLabel?: string;
  disabled?: boolean;
  remoteSearch?: boolean;
  onSearch?: (query: string) => Promise<MultiComboboxOption[] | void> | void;
  searchDebounceMs?: number;
  minSearchLength?: number;
  /** Подписи для значений вне options (например, из кэша игр). */
  resolveLabel?: (value: string) => string | undefined;
  className?: string;
  id?: string;
  "aria-label"?: string;
}

export const ALL_VALUE = "all";
const EMPTY_OPTIONS: MultiComboboxOption[] = [];
/** Сколько строк рисуем сразу и добавляем при прокрутке: сотни строк cmdk открываются с задержкой. */
const RENDER_STEP = 60;

export function MultiCombobox({
  options,
  value,
  onChange,
  placeholder = "Выберите…",
  searchPlaceholder = "Поиск…",
  allowAll = false,
  allLabel = "Все",
  disabled = false,
  remoteSearch = false,
  onSearch,
  searchDebounceMs = 300,
  minSearchLength = 0,
  resolveLabel,
  className,
  id,
  "aria-label": ariaLabel,
}: MultiComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [remoteOptions, setRemoteOptions] = React.useState<MultiComboboxOption[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const searchSeq = React.useRef(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [limit, setLimit] = React.useState(RENDER_STEP);
  // Новый запрос — снова с первой порции («состояние из прошлого рендера», без эффекта).
  const [limitQuery, setLimitQuery] = React.useState(query);
  if (limitQuery !== query) {
    setLimitQuery(query);
    setLimit(RENDER_STEP);
  }

  const allSelected = allowAll && value.includes(ALL_VALUE);
  const selected = React.useMemo(
    () => new Set(allSelected ? [] : value.map(String)),
    [value, allSelected],
  );

  // При удалённом поиске и слишком коротком запросе список пуст — это производное, не state.
  const belowMin = remoteSearch && query.trim().length < minSearchLength;
  const sourceOptions = React.useMemo<ReadonlyArray<MultiComboboxOption>>(
    () => (remoteSearch ? (belowMin ? EMPTY_OPTIONS : (remoteOptions ?? EMPTY_OPTIONS)) : options),
    [remoteSearch, belowMin, remoteOptions, options],
  );
  const labelOf = React.useCallback(
    (v: string) =>
      sourceOptions.find((o) => o.value === v)?.label ??
      options.find((o) => o.value === v)?.label ??
      resolveLabel?.(v) ??
      v,
    [sourceOptions, options, resolveLabel],
  );

  // Локальный фильтр (без cmdk-скоринга, чтобы порядок опций не менялся).
  const filtered = React.useMemo(() => {
    if (remoteSearch) return sourceOptions;
    const q = query.trim().toLowerCase();
    if (!q) return sourceOptions;
    return sourceOptions.filter(
      (o) => o.value.toLowerCase().includes(q) || o.label.toLowerCase().includes(q),
    );
  }, [sourceOptions, query, remoteSearch]);

  // Удалённый поиск с debounce; устаревшие ответы отбрасываются по seq.
  React.useEffect(() => {
    if (!remoteSearch || !open || !onSearch || belowMin) return;
    const q = query.trim();
    const seq = ++searchSeq.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const result = await onSearch(q);
        if (seq !== searchSeq.current) return;
        if (Array.isArray(result)) {
          setRemoteOptions(
            result.map((o) => ({ value: String(o.value), label: String(o.label ?? o.value) })),
          );
        }
      } catch {
        /* оставляем предыдущие опции */
      } finally {
        if (seq === searchSeq.current) setLoading(false);
      }
    }, searchDebounceMs);
    return () => clearTimeout(timer);
  }, [remoteSearch, open, onSearch, query, belowMin, searchDebounceMs]);

  function emit(next: Set<string>) {
    onChange([...next]);
  }

  function toggle(v: string) {
    if (allSelected) {
      emit(new Set([v]));
      return;
    }
    const next = new Set(selected);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    emit(next);
  }

  function remove(v: string) {
    if (v === ALL_VALUE || allSelected) {
      onChange([]);
      return;
    }
    const next = new Set(selected);
    next.delete(v);
    emit(next);
  }

  function selectAll() {
    onChange([ALL_VALUE]);
  }

  function close() {
    setOpen(false);
    setQuery("");
    setLimit(RENDER_STEP);
  }

  const visible = filtered.length > limit ? filtered.slice(0, limit) : filtered;

  function onListScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    if (visible.length < filtered.length && el.scrollTop + el.clientHeight > el.scrollHeight - 120)
      setLimit((n) => n + RENDER_STEP);
  }

  const chips = allSelected
    ? [{ value: ALL_VALUE, label: allLabel }]
    : [...selected]
        .map((v) => ({ value: v, label: labelOf(v) }))
        .sort((a, b) => a.label.localeCompare(b.label, "ru"));

  const emptyText = belowMin
    ? `Введите минимум ${minSearchLength} символа`
    : sourceOptions.length === 0
      ? "Список пуст"
      : "Ничего не найдено";

  return (
    <Popover open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <PopoverAnchor asChild>
        <div
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={ariaLabel}
          aria-disabled={disabled}
          data-slot="multi-combobox"
          className={cn(
            "flex min-h-10 w-full cursor-text flex-wrap items-center gap-1 rounded-md border border-transparent bg-input px-2 py-1.5 transition-colors",
            open && "border-primary",
            disabled && "cursor-not-allowed opacity-50",
            className,
          )}
          onMouseDown={(e) => {
            if (disabled) return;
            if ((e.target as HTMLElement).closest("[data-chip-remove]")) return;
            e.preventDefault();
            setOpen(true);
            inputRef.current?.focus();
          }}
        >
          {chips.map((chip) => (
            <span
              key={chip.value}
              className={cn(
                "inline-flex max-w-full items-center gap-1 rounded-chip px-1.5 py-0.5 text-caption font-medium",
                chip.value === ALL_VALUE && allSelected
                  ? "bg-primary text-primary-foreground"
                  : "bg-surface-2 text-foreground",
              )}
            >
              <span className="truncate">{chip.label}</span>
              <button
                type="button"
                data-chip-remove=""
                disabled={disabled}
                aria-label={`Убрать ${chip.label}`}
                className="cursor-pointer rounded-sm opacity-70 hover:opacity-100 disabled:cursor-not-allowed"
                onClick={(e) => {
                  e.stopPropagation();
                  remove(chip.value);
                }}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
          <input
            ref={inputRef}
            id={id}
            type="text"
            autoComplete="off"
            disabled={disabled}
            value={query}
            placeholder={open ? searchPlaceholder : chips.length ? "" : placeholder}
            className="min-w-16 flex-1 bg-transparent text-subhead outline-none placeholder:text-muted-foreground"
            onChange={(e) => {
              setQuery(e.target.value);
              if (!open) setOpen(true);
            }}
            onFocus={() => !disabled && setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                close();
                inputRef.current?.blur();
              } else if (e.key === "Backspace" && !query && chips.length) {
                remove(chips[chips.length - 1]!.value);
              } else if ((e.key === "ArrowDown" || e.key === "Enter") && !open) {
                e.preventDefault();
                setOpen(true);
              }
            }}
          />
          <ChevronDown
            className="ml-auto size-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        </div>
      </PopoverAnchor>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          if ((e.target as HTMLElement | null)?.closest?.("[data-slot=multi-combobox]"))
            e.preventDefault();
        }}
      >
        {/* Поиск живёт в поле контрола, cmdk получает его через value и не фильтрует сам. */}
        <Command shouldFilter={false}>
          <CommandList onScroll={onListScroll}>
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-4 text-subhead text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Загрузка…
              </div>
            ) : filtered.length === 0 ? (
              <CommandEmpty>{emptyText}</CommandEmpty>
            ) : (
              visible.map((opt) => {
                const isSelected = selected.has(opt.value);
                return (
                  <CommandItem
                    key={opt.value}
                    value={opt.value}
                    onSelect={() => toggle(opt.value)}
                    aria-selected={isSelected}
                  >
                    <span className="flex-1 truncate">{opt.label}</span>
                    <Check
                      className={cn(
                        "size-4 text-primary",
                        isSelected ? "opacity-100" : "opacity-0",
                      )}
                    />
                  </CommandItem>
                );
              })
            )}
            {!loading && visible.length < filtered.length ? (
              <div className="px-2 py-1.5 text-center text-caption text-muted-foreground tabular-nums">
                Показано {visible.length} из {filtered.length} — прокрутите или уточните поиск
              </div>
            ) : null}
            {allowAll ? (
              <>
                <div className="my-1 h-px bg-border" />
                <CommandItem value="__all__" onSelect={selectAll} aria-selected={allSelected}>
                  <span className="flex-1">{allLabel}</span>
                  <Check
                    className={cn("size-4 text-primary", allSelected ? "opacity-100" : "opacity-0")}
                  />
                </CommandItem>
              </>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
