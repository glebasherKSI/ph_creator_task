import { ExternalLink, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { reportsHostLabel, reportsReadiness } from "./labels";
import type { ReportsState } from "./useReports";

function Line({ ok, label, hint }: { ok: boolean | null; label: string; hint: string }) {
  return (
    <li className="flex items-center gap-2 text-subhead">
      <span
        aria-hidden="true"
        className={cn(
          "size-2 shrink-0 rounded-full",
          ok == null ? "bg-muted-foreground/40" : ok ? "bg-success" : "bg-destructive",
        )}
      />
      <span className="flex-1">{label}</span>
      <span className="text-caption text-muted-foreground">{hint}</span>
    </li>
  );
}

export function ReportsCard({ state }: { state: ReportsState }) {
  const readiness = reportsReadiness(state.status);
  const host = reportsHostLabel(state.status?.origin);
  const session = state.status ? state.status.sessionPresent : null;
  const tab = state.status ? state.status.tabOpen : null;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <CardTitle>Отчёты (Reports)</CardTitle>
          <p className="font-mono text-caption text-muted-foreground">{host}</p>
        </div>
        <div className="flex items-center gap-1">
          <Badge
            variant={
              readiness === "ready"
                ? "success"
                : readiness === "unknown"
                  ? "muted"
                  : "accent-outline"
            }
          >
            {readiness === "ready"
              ? "Готово"
              : readiness === "no-session"
                ? "Нет сессии"
                : readiness === "no-tab"
                  ? "Нет вкладки"
                  : "…"}
          </Badge>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Проверить снова"
            title="Проверить снова"
            onClick={() => void state.refresh()}
          >
            <RefreshCw />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        <ul className="flex flex-col gap-1.5">
          <Line
            ok={session}
            label="Сессия Reports"
            hint={session == null ? "проверяю" : session ? "cookie найдена" : "войдите на сайте"}
          />
          <Line
            ok={tab}
            label="Вкладка Reports"
            hint={tab == null ? "проверяю" : tab ? "открыта" : "нужна для запросов"}
          />
        </ul>
        {state.error ? (
          <p role="alert" className="text-caption text-destructive">
            {state.error}
          </p>
        ) : null}
        <p className="text-caption text-muted-foreground">
          Отдельного входа нет: статистика запрашивается через открытую вкладку Reports с вашей
          сессией. Если сессии нет — войдите на сайте и держите вкладку открытой.
        </p>
        <Button
          variant={readiness === "ready" ? "secondary" : "outline"}
          className="w-full"
          onClick={() => void state.openTab()}
        >
          <ExternalLink />
          {tab ? "Перейти во вкладку Reports" : "Открыть Reports"}
        </Button>
      </CardContent>
    </Card>
  );
}
