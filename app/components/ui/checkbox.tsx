import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer size-4 shrink-0 cursor-pointer rounded-[4px] border border-muted-foreground/60 bg-input transition-colors outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring/60",
        "data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
        <Check className="size-3" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

/** Чекбокс с подписью справа — самый частый случай в формах. */
function CheckboxField({
  label,
  className,
  id,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root> & { label: React.ReactNode }) {
  const autoId = React.useId();
  const checkboxId = id ?? autoId;
  return (
    <label
      htmlFor={checkboxId}
      className={cn(
        "inline-flex cursor-pointer items-center gap-2 text-subhead select-none",
        props.disabled && "cursor-not-allowed opacity-60",
        className,
      )}
    >
      <Checkbox id={checkboxId} {...props} />
      <span>{label}</span>
    </label>
  );
}

export { Checkbox, CheckboxField };
