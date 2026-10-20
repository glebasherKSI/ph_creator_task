import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as React from "react";

import { cn } from "@/lib/utils";

function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-50",
        "data-[state=checked]:bg-primary data-[state=unchecked]:bg-surface-2",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-4 rounded-full bg-foreground shadow transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0" />
    </SwitchPrimitive.Root>
  );
}

function SwitchField({
  label,
  className,
  id,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & { label: React.ReactNode }) {
  const autoId = React.useId();
  const switchId = id ?? autoId;
  return (
    <label
      htmlFor={switchId}
      className={cn(
        "inline-flex cursor-pointer items-center gap-2 text-subhead select-none",
        className,
      )}
    >
      <Switch id={switchId} {...props} />
      <span>{label}</span>
    </label>
  );
}

export { Switch, SwitchField };
