import * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // Тёмная заливка без рамки; рамка появляется только в фокусе — оранжевая.
        "h-10 w-full min-w-0 rounded-md border border-transparent bg-input px-3 text-body text-foreground",
        "outline-none transition-colors placeholder:text-muted-foreground",
        "focus-visible:border-primary",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
