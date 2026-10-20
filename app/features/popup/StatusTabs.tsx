import { cn } from "@/lib/utils";

export type PopupTab = "backend" | "graphic" | "reports";
export type StatusTone = "ok" | "pending" | "none" | "unknown";

export interface StatusTabItem {
  value: PopupTab;
  label: string;
  tone: StatusTone;
  title?: string;
}

const DOT: Record<StatusTone, string> = {
  ok: "bg-success",
  pending: "bg-primary",
  none: "bg-destructive",
  unknown: "bg-muted-foreground/60",
};

/** Сегменты-вкладки popup со статусом каждого блока: обзор всех трёх одним взглядом. */
export function StatusTabs({
  value,
  onValueChange,
  items,
}: {
  value: PopupTab;
  onValueChange: (tab: PopupTab) => void;
  items: StatusTabItem[];
}) {
  return (
    <div role="tablist" className="grid grid-cols-3 gap-0.5 rounded-md bg-surface p-0.5">
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            title={item.title}
            onClick={() => onValueChange(item.value)}
            className={cn(
              "flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-chip text-subhead font-medium transition-colors outline-none",
              "focus-visible:ring-2 focus-visible:ring-ring/60",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "size-2 shrink-0 rounded-full",
                active ? "bg-primary-foreground/90" : DOT[item.tone],
              )}
            />
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
