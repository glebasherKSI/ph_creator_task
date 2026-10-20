import { Loader2, Plus, RefreshCw, X } from "lucide-react";
import { memo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { type DomainAuthState, domainAuthTone, formatAuthLabel, formatAuthTitle } from "./labels";
import type { DomainsState } from "./useDomains";

const TONE_VARIANT = { ok: "accent", pending: "accent-outline", none: "muted" } as const;

const DomainRow = memo(function DomainRow({
  host,
  granted,
  auth,
  checking,
  onRemove,
}: {
  host: string;
  granted: boolean | undefined;
  auth: DomainAuthState | undefined;
  checking: boolean;
  onRemove: (host: string) => void;
}) {
  const tone = domainAuthTone(auth);
  return (
    <li className="flex items-center gap-2 rounded-md bg-surface-2/50 py-1.5 pr-1 pl-2.5">
      <span
        className={cn(
          "size-2 shrink-0 rounded-full",
          granted == null ? "bg-muted-foreground/40" : granted ? "bg-success" : "bg-destructive",
        )}
        title={
          granted == null
            ? "Проверяю доступ…"
            : granted
              ? "Доступ разрешён"
              : "Нет доступа — добавьте домен снова для запроса разрешения"
        }
      />
      <span className="min-w-0 flex-1 truncate font-mono text-subhead" title={host}>
        {host}
      </span>
      {checking && !auth ? (
        <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-label="Проверяю" />
      ) : (
        <Badge
          variant={TONE_VARIANT[tone]}
          title={checking ? `${formatAuthTitle(auth)} — проверяю…` : formatAuthTitle(auth)}
          className={cn(checking && "opacity-60")}
        >
          {formatAuthLabel(auth)}
        </Badge>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Удалить ${host}`}
        title="Удалить"
        onClick={() => onRemove(host)}
      >
        <X />
      </Button>
    </li>
  );
});

export function DomainsCard({ state }: { state: DomainsState }) {
  const [draft, setDraft] = useState("");
  const anyChecking = Object.values(state.checking).some(Boolean);

  async function submit() {
    const ok = await state.addDomain(draft);
    if (ok) setDraft("");
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <CardTitle>Бэкенд PromoHub</CardTitle>
          <p className="text-caption text-muted-foreground">
            Вход (magic link + OTP) выполняется в конструкторе при загрузке задач.
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Обновить статусы"
          title="Обновить статусы входа"
          disabled={anyChecking}
          onClick={() => void state.refreshAuth()}
        >
          <RefreshCw className={cn(anyChecking && "animate-spin")} />
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        <ul className="flex flex-col gap-1">
          {state.loading ? (
            <li className="py-2 text-center text-subhead text-muted-foreground">Загрузка…</li>
          ) : state.domains.length === 0 ? (
            <li className="py-2 text-center text-subhead text-muted-foreground">
              Нет сохранённых админок
            </li>
          ) : (
            state.domains.map((host) => (
              <DomainRow
                key={host}
                host={host}
                granted={state.permissions[host]}
                auth={state.auth[host]}
                checking={Boolean(state.checking[host])}
                onRemove={state.removeDomain}
              />
            ))
          )}
        </ul>

        <div className="flex gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder="admin.example.com"
            spellCheck={false}
            aria-label="Домен админки"
            className="h-9"
          />
          <Button variant="secondary" onClick={() => void submit()}>
            Добавить
          </Button>
        </div>

        <Button variant="outline" className="w-full" onClick={() => void state.addCurrentTab()}>
          <Plus />
          Добавить текущую вкладку
        </Button>
      </CardContent>
    </Card>
  );
}
