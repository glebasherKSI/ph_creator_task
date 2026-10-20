import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

const Select = SelectPrimitive.Root;
const SelectGroup = SelectPrimitive.Group;
const SelectValue = SelectPrimitive.Value;

function SelectTrigger({
  className,
  children,
  size = "md",
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & { size?: "sm" | "md" }) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        "flex w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-transparent bg-input px-3 text-body text-foreground outline-none",
        "transition-colors focus-visible:border-primary data-[state=open]:border-primary",
        "disabled:cursor-not-allowed disabled:opacity-50 data-[placeholder]:text-muted-foreground",
        "[&>span]:truncate",
        size === "sm" ? "h-8 text-subhead" : "h-10",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  children,
  position = "popper",
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        position={position}
        className={cn(
          "z-50 max-h-80 min-w-[8rem] overflow-hidden rounded-md bg-popover text-popover-foreground shadow-lg ring-1 ring-border",
          "data-[state=open]:animate-pop-in data-[state=closed]:animate-pop-out",
          position === "popper" && "w-[var(--radix-select-trigger-width)]",
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex w-full cursor-pointer items-center rounded-chip py-1.5 pr-8 pl-2 text-subhead outline-none select-none",
        "data-[highlighted]:bg-surface-2 data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <span className="absolute right-2 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="size-3.5 text-primary" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

export interface SimpleSelectOption {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
}

/**
 * Обычный одиночный select по списку опций. `value: ""` — ничего не выбрано;
 * при `nullable` первая опция «—» сбрасывает значение.
 */
function SimpleSelect({
  value,
  onValueChange,
  options,
  placeholder = "Выберите…",
  nullable = false,
  nullLabel = "—",
  disabled,
  size,
  className,
  "aria-label": ariaLabel,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: ReadonlyArray<SimpleSelectOption>;
  placeholder?: string;
  nullable?: boolean;
  nullLabel?: string;
  disabled?: boolean;
  size?: "sm" | "md";
  className?: string;
  "aria-label"?: string;
}) {
  // Radix Select не принимает "" как значение item — кодируем «пусто» служебным ключом.
  const NULL = "__null__";
  return (
    <Select
      value={value === "" ? (nullable ? NULL : undefined) : value}
      onValueChange={(next) => onValueChange(next === NULL ? "" : next)}
      disabled={disabled}
    >
      <SelectTrigger size={size} className={className} aria-label={ariaLabel}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {nullable ? <SelectItem value={NULL}>{nullLabel}</SelectItem> : null}
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value} disabled={opt.disabled}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export { Select, SelectGroup, SelectValue, SelectTrigger, SelectContent, SelectItem, SimpleSelect };
