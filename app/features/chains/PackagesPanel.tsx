/** Вкладка «Пакеты»: сессия Promo Graphic, список пакетов, «Открыть на канве». */
import { Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { useAuth } from "@/features/auth/AuthModal";
import { GraphicCard } from "@/features/popup/GraphicCard";
import { useGraphic } from "@/features/popup/useGraphic";
import { graphicApiGet } from "@/lib/graphic-api";
import { cn } from "@/lib/utils";

import { openPackageOnCanvas } from "./packages-actions";
import {
  type GraphicPackage,
  type PackageStatusFilter,
  PACKAGE_STATUS_OPTIONS,
  extractPackages,
  packageSubtitle,
} from "./packages";
import { useChainsStore } from "./store";

export function PackagesPanel({ onOpened }: { onOpened: () => void }) {
  const graphic = useGraphic();
  const auth = useAuth();
  const authenticated = Boolean(graphic.status?.authenticated);
  const [status, setStatus] = useState<PackageStatusFilter>("ready");
  const [items, setItems] = useState<GraphicPackage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [opening, setOpening] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback((filter: PackageStatusFilter) => {
    const mySeq = ++seq.current;
    setLoading(true);
    setError("");
    graphicApiGet("/api/promohub-planner/packages", { status: filter }).then(
      (data) => {
        if (mySeq !== seq.current) return;
        setItems(extractPackages(data));
        setLoading(false);
      },
      (err: unknown) => {
        if (mySeq !== seq.current) return;
        setItems([]);
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      },
    );
  }, []);

  // Список грузится, когда есть вход; при выходе — очищается.
  useEffect(() => {
    if (!authenticated) return;
    const timer = setTimeout(() => load(status), 0);
    return () => clearTimeout(timer);
  }, [authenticated, status, load]);

  async function open(pkg: GraphicPackage) {
    setOpening(String(pkg.id));
    const store = useChainsStore.getState();
    try {
      const r = await openPackageOnCanvas(pkg, {
        ensureAuthenticated: (domain) =>
          auth.ensureAuthenticated(domain, {
            message: `Для загрузки задач пакета нужен вход в ${domain}`,
          }),
      });
      const parts: string[] = [];
      if (r.placedBackend.length) parts.push(`${r.placedBackend.length} с бэка`);
      if (r.placedDrafts.length) parts.push(`${r.placedDrafts.length} черновиков`);
      if (parts.length) {
        toast.success(
          `На канву: ${parts.join(", ")} из «${r.packageName}».` +
            (r.linked ? ` Связей из графика: ${r.linked}.` : "") +
            (r.placedDrafts.length
              ? " Создавайте черновики слева направо — связи подвяжутся сами."
              : "") +
            (r.backendDirty
              ? ` У ${r.backendDirty} задач(и) с бэка новая связь — нажмите «Сохранить».`
              : ""),
          { duration: 9000 },
        );
        store.setStatus(`Пакет «${r.packageName}» открыт на канве`);
      } else if (!r.loadErrors.length) {
        toast.warning("На канву ничего не добавлено");
      }
      if (r.unresolved.length) {
        toast.warning(
          `Не перенесено связей: ${r.unresolved.length}. Предшественник не создан на бэке или не загрузился:\n${r.unresolved.slice(0, 3).join("\n")}`,
          { duration: 10000 },
        );
      }
      if (r.loadErrors.length) {
        toast.warning(
          `Не удалось загрузить с бэка ${r.loadErrors.length} задач(и):\n${r.loadErrors.slice(0, 3).join("\n")}`,
          { duration: 10000 },
        );
      }
      onOpened();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(message);
      store.setStatus(message, true);
    } finally {
      setOpening(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-title-2">Пакеты Promo Graphic</h2>
      <div className="max-w-md">
        <GraphicCard state={graphic} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented<PackageStatusFilter>
          size="sm"
          value={status}
          onValueChange={setStatus}
          options={PACKAGE_STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          aria-label="Статус пакета"
        />
        <Button
          variant="secondary"
          size="sm"
          disabled={!authenticated || loading}
          onClick={() => load(status)}
        >
          <RefreshCw className={cn(loading && "animate-spin")} /> Обновить
        </Button>
      </div>

      {error ? (
        <p role="alert" className="text-subhead text-destructive">
          {error}
        </p>
      ) : null}

      {!authenticated ? (
        <p className="rounded-md border border-dashed border-border p-4 text-center text-subhead text-muted-foreground">
          Сначала войдите в Promo Graphic
        </p>
      ) : loading && !items.length ? (
        <p className="flex items-center gap-2 text-subhead text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Загрузка пакетов…
        </p>
      ) : !items.length ? (
        <p className="rounded-md border border-dashed border-border p-4 text-center text-subhead text-muted-foreground">
          Пакетов нет
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((pkg) => {
            const key = String(pkg.id);
            return (
              <li
                key={key}
                className="flex items-center gap-3 rounded-lg bg-surface p-3 ring-1 ring-border"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-headline">{pkg.name || `Пакет #${key}`}</div>
                  <div className="truncate text-caption text-muted-foreground">
                    {packageSubtitle(pkg)}
                  </div>
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={opening != null}
                  onClick={() => void open(pkg)}
                >
                  {opening === key ? <Loader2 className="animate-spin" /> : null}
                  Открыть на канве
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
