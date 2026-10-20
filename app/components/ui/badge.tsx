import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-chip px-1.5 py-0.5 text-caption font-semibold tracking-wide",
  {
    variants: {
      variant: {
        // Мелкий текст на оранжевом — тёмный, ради контраста.
        accent: "bg-accent text-accent-foreground",
        "accent-outline": "border border-accent text-accent",
        neutral: "bg-surface-2 text-foreground",
        muted: "bg-surface-2 text-muted-foreground",
        destructive: "bg-destructive text-destructive-foreground",
        success: "bg-success text-success-foreground",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  },
);

export interface BadgeProps
  extends React.ComponentProps<"span">, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
