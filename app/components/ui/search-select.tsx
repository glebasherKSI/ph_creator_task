/**
 * Одиночный выбор из длинного списка: поиск + порционная отрисовка, без модальности.
 * Radix Select строит все пункты сразу и блокирует страницу — на сотнях опций открывается с задержкой.
 */
import { Check, ChevronDown } from "lucide-react";
import * as React from "react";

import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "./command";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { cn } from "@/lib/utils";

export interface SearchSelectOption {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
}

const RENDER_STEP = 60;

function optionText(option: SearchSelectOption): string {
  return typeof option.label === "string" || typeof option.label === "number"
    ? String(option.label)
    : option.value;
}

export function SearchSelect({
  value,
  onValueChange,
  options,
  placeholder = "Выберите…",
  nullable = false,
  nullLabel = "—",
  disabled,
  size = "md",
  className,
  "aria-label": ariaLabel,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: ReadonlyArray<SearchSelectOption>;
  placeholder?: string;
  nullable?: boolean;
  nullLabel?: string;
  disabled?: boolean;
  size?: "sm" | "md";
  className?: string;
  "aria-label"?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [limit, setLimit] = React.useState(RENDER_STEP);

  const current = options.find((o) => o.value === value);
  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => optionText(o).toLowerCase().includes(q) || o.value.toLowerCase().includes(q),
    );
  }, [options, query]);
  const visible = filtered.length > limit ? filtered.slice(0, limit) : filtered;

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setQuery("");
      setLimit(RENDER_STEP);
    }
  }

  function pick(next: string) {
    onValueChange(next);
    onOpenChange(false);
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          data-state={open ? "open" : "closed"}
          className={cn(
            "flex w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-transparent bg-input px-3 text-left text-body text-foreground outline-none",
            "transition-colors focus-visible:border-primary data-[state=open]:border-primary",
            "disabled:cursor-not-allowed disabled:opacity-50",
            size === "sm" ? "h-8 text-subhead" : "h-10",
            className,
          )}
        >
          <span className={cn("truncate", !current && "text-muted-foreground")}>
            {current ? current.label : value === "" && nullable ? nullLabel : placeholder}
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={(q) => {
              setQuery(q);
              setLimit(RENDER_STEP);
            }}
            placeholder="Поиск…"
          />
          <CommandList
            onScroll={(e) => {
              const el = e.currentTarget;
              if (
                visible.length < filtered.length &&
                el.scrollTop + el.clientHeight > el.scrollHeight - 120
              )
                setLimit((n) => n + RENDER_STEP);
            }}
          >
            {nullable && !query ? (
              <CommandItem value="__null__" onSelect={() => pick("")}>
                <span className="flex-1 truncate">{nullLabel}</span>
                <Check
                  className={cn("size-4 text-primary", value === "" ? "opacity-100" : "opacity-0")}
                />
              </CommandItem>
            ) : null}
            {filtered.length === 0 ? <CommandEmpty>Ничего не найдено</CommandEmpty> : null}
            {visible.map((opt) => (
              <CommandItem
                key={opt.value}
                value={opt.value}
                disabled={opt.disabled}
                onSelect={() => pick(opt.value)}
              >
                <span className="flex-1 truncate">{opt.label}</span>
                <Check
                  className={cn(
                    "size-4 text-primary",
                    opt.value === value ? "opacity-100" : "opacity-0",
                  )}
                />
              </CommandItem>
            ))}
            {visible.length < filtered.length ? (
              <div className="px-2 py-1.5 text-center text-caption text-muted-foreground tabular-nums">
                Показано {visible.length} из {filtered.length} — прокрутите или уточните поиск
              </div>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
