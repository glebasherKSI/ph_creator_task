import { Toaster as Sonner } from "sonner";

/** Тосты в стиле дизайн-системы (тёмная тема, токены). */
function Toaster() {
  return (
    <Sonner
      theme="dark"
      position="bottom-right"
      closeButton
      toastOptions={{
        classNames: {
          toast:
            "!bg-surface !text-foreground !border !border-border !shadow-2xl !rounded-lg !text-subhead",
          description: "!text-muted-foreground",
          success: "[&_[data-icon]]:!text-success",
          error: "[&_[data-icon]]:!text-destructive",
          warning: "[&_[data-icon]]:!text-primary",
          closeButton: "!bg-surface-2 !border-border !text-muted-foreground",
        },
      }}
    />
  );
}

export { Toaster };
