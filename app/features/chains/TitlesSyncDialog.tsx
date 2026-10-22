/** Модалка групповой подтяжки названий из Promo Graphic: прогресс → сводка по задачам и локалям. */
import { AlertTriangle, Check, Loader2, Minus, SearchX, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import { type TitlesSyncOutcome, type TitlesSyncRow, useTitlesSync } from "./titles-sync";

const OUTCOMES: ReadonlyArray<{
  id: TitlesSyncOutcome;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
}> = [
  { id: "updated", label: "Обновлено", icon: Check, tone: "text-success" },
  { id: "unchanged", label: "Без изменений", icon: Minus, tone: "text-muted-foreground" },
  { id: "not-found", label: "Нет в словаре", icon: SearchX, tone: "text-primary" },
  { id: "skipped", label: "Пропущено", icon: Minus, tone: "text-muted-foreground" },
  { id: "error", label: "Ошибки", icon: X, tone: "text-destructive" },
];

function TaskLabel({ row }: { row: TitlesSyncRow }) {
  return (
    <span className="min-w-0 truncate">
      <span className="font-mono text-muted-foreground">#{row.id}</span>{" "}
      {row.name || row.frontendIdentifier || "(без названия)"}
    </span>
  );
}

function Summary({ rows }: { rows: TitlesSyncRow[] }) {
  const withMissing = rows.filter(
    (r) => (r.outcome === "updated" || r.outcome === "unchanged") && r.missing.length,
  );
  const notFound = rows.filter((r) => r.outcome === "not-found");
  const problems = rows.filter((r) => r.outcome === "error" || r.outcome === "skipped");

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-5 gap-2">
        {OUTCOMES.map(({ id, label, icon: Icon, tone }) => {
          const count = rows.filter((r) => r.outcome === id).length;
          return (
            <div
              key={id}
              className={cn(
                "flex flex-col gap-1 rounded-md bg-surface-2/50 p-2.5 ring-1 ring-border",
                !count && "opacity-50",
              )}
            >
              <span className={cn("flex items-center gap-1 text-caption", tone)}>
                <Icon className="size-3.5" /> {label}
              </span>
              <span className="text-title-2 tabular-nums">{count}</span>
            </div>
          );
        })}
      </div>

      {withMissing.length ? (
        <section className="flex flex-col gap-1.5">
          <h3 className="flex items-center gap-1.5 text-subhead font-semibold">
            <AlertTriangle className="size-4 text-primary" />
            Не заполнены после синхронизации ({withMissing.length})
          </h3>
          <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto pr-1">
            {withMissing.map((row) => (
              <li
                key={row.id}
                className="flex items-center gap-3 rounded-md bg-surface-2/40 px-2.5 py-1.5 text-subhead"
              >
                <TaskLabel row={row} />
                <span className="ml-auto flex shrink-0 flex-wrap justify-end gap-1">
                  {row.missing.map((code) => (
                    <span
                      key={code}
                      className="rounded-chip border border-primary/50 px-1.5 font-mono text-caption text-primary"
                    >
                      {code}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : rows.some((r) => r.outcome === "updated" || r.outcome === "unchanged") ? (
        <p className="flex items-center gap-1.5 text-subhead text-success">
          <Check className="size-4" /> У всех найденных задач заполнены все локали
        </p>
      ) : null}

      {notFound.length ? (
        <section className="flex flex-col gap-1.5">
          <h3 className="text-subhead font-semibold">
            Нет в словаре «Названия фронт» ({notFound.length})
          </h3>
          <ul className="flex max-h-32 flex-col gap-1 overflow-y-auto pr-1 text-subhead">
            {notFound.map((row) => (
              <li key={row.id} className="flex items-center gap-3">
                <TaskLabel row={row} />
                <span className="ml-auto shrink-0 font-mono text-caption text-muted-foreground">
                  {row.frontendIdentifier}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {problems.length ? (
        <section className="flex flex-col gap-1.5">
          <h3 className="text-subhead font-semibold">Ошибки и пропуски ({problems.length})</h3>
          <ul className="flex max-h-32 flex-col gap-1 overflow-y-auto pr-1 text-subhead">
            {problems.map((row) => (
              <li key={row.id} className="flex items-center gap-3">
                <TaskLabel row={row} />
                <span
                  className={cn(
                    "ml-auto shrink-0 text-caption",
                    row.outcome === "error" ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  {row.message}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export function TitlesSyncDialog() {
  const { open, phase, total, rows, error, close } = useTitlesSync();
  const running = phase === "dictionary" || phase === "tasks";
  const percent = total ? Math.round((rows.length / total) * 100) : 0;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent
        className="max-w-2xl"
        showClose={!running}
        onEscapeKeyDown={(e) => running && e.preventDefault()}
        onPointerDownOutside={(e) => running && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Названия из Promo Graphic</DialogTitle>
          <DialogDescription>
            Переводы названия по локалям из словаря «Названия фронт» (по frontend_identifier)
            записываются в задачи на бэке.
          </DialogDescription>
        </DialogHeader>

        {running ? (
          <div className="flex flex-col gap-3 py-2" role="progressbar" aria-valuenow={percent}>
            <div className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin text-primary" />
              <span className="text-headline">
                {phase === "dictionary" ? "Загружаю словарь названий…" : "Обновляю задачи"}
              </span>
              {phase === "tasks" ? (
                <span className="ml-auto font-semibold text-primary tabular-nums">{percent}%</span>
              ) : null}
            </div>
            <div className="relative h-2 overflow-hidden rounded-full bg-surface-2">
              {phase === "tasks" ? (
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
                  style={{ width: `${percent}%` }}
                />
              ) : (
                <div className="absolute inset-y-0 w-1/3 animate-[progress-indeterminate_1.2s_ease-in-out_infinite] rounded-full bg-primary" />
              )}
            </div>
            <div className="text-caption text-muted-foreground tabular-nums">
              Задачи: {rows.length} из {total}
            </div>
          </div>
        ) : phase === "failed" ? (
          <p role="alert" className="text-subhead text-destructive">
            Не удалось загрузить словарь: {error}
            <br />
            <span className="text-muted-foreground">
              Нужен вход в Promo Graphic — окно расширения, вкладка «Graphic».
            </span>
          </p>
        ) : (
          <Summary rows={rows} />
        )}

        <DialogFooter>
          <Button variant="secondary" disabled={running} onClick={close}>
            {running ? "Подождите…" : "Закрыть"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
