/**
 * Плавно анимирует изменение высоты содержимого (переключение вкладок/карточек).
 * Высота меряется ResizeObserver'ом, анимируется CSS-transition — без тяжёлых пересчётов.
 */
import * as React from "react";

import { cn } from "@/lib/utils";

export function AnimatedHeight({
  children,
  className,
  duration = 220,
}: {
  children: React.ReactNode;
  className?: string;
  duration?: number;
}) {
  const innerRef = React.useRef<HTMLDivElement>(null);
  const [height, setHeight] = React.useState<number | null>(null);

  React.useEffect(() => {
    const el = innerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const next = Math.round(entry.contentRect.height);
      setHeight((prev) => (prev === next ? prev : next));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      className={cn("overflow-hidden", className)}
      style={{
        // До первого замера — auto, чтобы не мигнуть нулевой высотой.
        height: height == null ? "auto" : height,
        transition: `height ${duration}ms cubic-bezier(0.22, 1, 0.36, 1)`,
      }}
    >
      <div ref={innerRef}>{children}</div>
    </div>
  );
}
