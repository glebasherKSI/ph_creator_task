import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-chip font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:cursor-default [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // Главное действие: серая, пока недоступно; оранжевая, когда можно отправлять.
        primary:
          "bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-surface-2 disabled:text-muted-foreground",
        secondary: "bg-surface-2 text-foreground hover:bg-surface-2/80 disabled:opacity-50",
        outline:
          "border border-primary text-primary hover:bg-primary/10 disabled:border-border disabled:text-muted-foreground",
        ghost: "text-muted-foreground hover:bg-surface-2 hover:text-foreground disabled:opacity-50",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50",
      },
      size: {
        sm: "h-7 px-2.5 text-subhead",
        md: "h-9 px-3.5 text-body",
        lg: "h-11 px-5 text-headline rounded-md",
        icon: "size-9",
        "icon-sm": "size-7",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends React.ComponentProps<"button">, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
