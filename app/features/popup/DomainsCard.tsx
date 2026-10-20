import { Plus, X } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { domainAuthTone, formatAuthLabel, formatAuthTitle } from "./labels";
import type { DomainsState } from "./useDomains";

const TONE_VARIANT = { ok: "accent", pending: "accent-outline", none: "muted" } as const;

function DomainRow({
  host,
  granted,
  auth,
  onRemove,
}: {
  host: string;
  granted: boolean | undefined;
  auth: DomainsState["auth"][string];
  onRemove: () => void;
}) {
  const tone = domainAuthTone(auth);
  return (
    <li className="flex items-center gap-2 rounded-md bg-surface-2/50 py-1.5 pr-1 pl-2.5">
      <span
        className={cn("size-2 shrink-0 rounded-full", granted ? "bg-success" : "bg-destructive")}
        title={
          granted ? "Доступ разрешён" : "Нет доступа — добавьте домен снова для запроса разрешения"
        }
      />
      <span className="min-w-0 flex-1 truncate font-mono text-subhead" title={host}>
        {host}
      </span>
      <Badge variant={TONE_VARIANT[tone]} title={formatAuthTitle(auth)}>
        {formatAuthLabel(auth)}
      </Badge>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Удалить ${host}`}
        title="Удалить"
        onClick={onRemove}
      >
        <X />
      </Button>
    </li>
  );
}

export function DomainsCard({ state }: { state: DomainsState }) {
  const [draft, setDraft] = useState("");

  async function submit() {
    const ok = await state.addDomain(draft);
    if (ok) setDraft("");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Админки</CardTitle>
        <p className="text-caption text-muted-foreground">
          Вход выполняется в конструкторе при загрузке задач (magic link + OTP).
        </p>
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
                onRemove={() => void state.removeDomain(host)}
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
