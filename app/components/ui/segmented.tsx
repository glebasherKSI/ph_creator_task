import * as React from "react";

import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  disabled?: boolean;
}

export interface SegmentedProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  options: ReadonlyArray<SegmentedOption<T>>;
  size?: "sm" | "md";
  className?: string;
  "aria-label"?: string;
}

/**
 * Сегментный переключатель: вкладки, «Включая / Исключая», «И / Или».
 * Активный сегмент — оранжевая заливка.
 */
function Segmented<T extends string>({
  value,
  onValueChange,
  options,
  size = "md",
  className,
  ...rest
}: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={rest["aria-label"]}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md bg-surface p-0.5",
        size === "sm" && "rounded-chip",
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={opt.disabled}
            onClick={() => onValueChange(opt.value)}
            className={cn(
              "cursor-pointer rounded-chip font-medium whitespace-nowrap transition-colors outline-none",
              "focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-default disabled:opacity-50",
              size === "sm" ? "h-6 px-2 text-caption" : "h-8 px-3 text-subhead",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export { Segmented };
