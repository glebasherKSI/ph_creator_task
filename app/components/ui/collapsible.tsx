import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";
import * as React from "react";

import { cn } from "@/lib/utils";

const Collapsible = CollapsiblePrimitive.Root;
const CollapsibleTrigger = CollapsiblePrimitive.Trigger;

/**
 * Контент с плавным раскрытием: Radix даёт высоту в CSS-переменной,
 * анимируем её и прозрачность (см. @keyframes collapsible-* в globals.css).
 */
function CollapsibleContent({
  className,
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Content>) {
  return (
    <CollapsiblePrimitive.Content
      data-slot="collapsible-content"
      className={cn(
        "overflow-hidden data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up",
        className,
      )}
      {...props}
    />
  );
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent };
