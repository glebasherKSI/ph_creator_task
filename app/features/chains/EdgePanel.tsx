/** Панель выбранной связи: настройки блока gamification_tasks цели и список её источников. */
import { Trash2, X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";

import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";

import { DEFAULT_GT_CONFIG, type GtConfig, buildGtValueForTarget } from "./graph";
import { useChainsStore } from "./store";

export function EdgePanel() {
  const selectedEdge = useChainsStore((s) => s.selectedEdge);
  const to = selectedEdge?.to ?? null;
  const cfg: GtConfig =
    useChainsStore((s) => (to ? s.targetConfigs[to] : undefined)) ?? DEFAULT_GT_CONFIG;
  const targetName = useChainsStore((s) => (to ? s.canvas[to]?.name : undefined));
  // Все источники цели: рёбра на канве + сохранённые id задач вне канвы.
  const sources = useChainsStore(useShallow((s) => (to ? buildGtValueForTarget(s, to).list : [])));
  const onCanvas = useChainsStore(useShallow((s) => sources.filter((id) => !!s.canvas[id])));
  const updateTargetConfig = useChainsStore((s) => s.updateTargetConfig);
  const disconnect = useChainsStore((s) => s.disconnect);
  const selectEdge = useChainsStore((s) => s.selectEdge);

  if (!selectedEdge || !to) return null;
  const onCanvasSet = new Set(onCanvas);

  return (
    <aside
      className="flex h-full w-80 min-h-0 flex-col gap-4 overflow-y-auto rounded-lg bg-surface p-4"
      aria-label="Настройки связи"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-headline">Связь → #{to}</h2>
          <p className="truncate text-caption text-muted-foreground">{targetName || "—"}</p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Закрыть панель"
          onClick={() => selectEdge(null)}
        >
          <X />
        </Button>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Тип</Label>
        <Segmented<GtConfig["type"]>
          size="sm"
          value={cfg.type}
          onValueChange={(type) => updateTargetConfig(to, { type })}
          options={[
            { value: "enabled", label: "Включая" },
            { value: "disabled", label: "Исключая" },
          ]}
          aria-label="Тип связи"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Логика списка (несколько задач в list)</Label>
        <Segmented<GtConfig["extra_type"]>
          size="sm"
          value={cfg.extra_type}
          onValueChange={(extra_type) => updateTargetConfig(to, { extra_type })}
          options={[
            { value: "and", label: "И (and)" },
            { value: "or", label: "Или (or)" },
          ]}
          aria-label="Логика списка"
        />
      </div>

      <CheckboxField
        label="Только выполненные"
        checked={cfg.only_completed}
        onCheckedChange={(next) => updateTargetConfig(to, { only_completed: next === true })}
      />

      <div className="flex min-h-0 flex-col gap-1.5">
        <div className="text-subhead font-medium">Входящие связи</div>
        {sources.length === 0 ? (
          <p className="text-caption text-muted-foreground">Нет входящих связей</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {sources.map((from) => {
              const isOnCanvas = onCanvasSet.has(from);
              const isSelected = selectedEdge.from === from;
              return (
                <li key={from} className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={!isOnCanvas}
                    onClick={() => selectEdge({ from, to })}
                    aria-current={isSelected ? "true" : undefined}
                    className={cn(
                      "flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-left font-mono text-caption outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                      isSelected ? "border-primary bg-surface-2" : "border-transparent",
                      isOnCanvas ? "hover:bg-surface-2/60" : "cursor-default text-muted-foreground",
                    )}
                  >
                    #{from} → #{to}
                    {!isOnCanvas ? <span className="font-sans">(вне канвы)</span> : null}
                    {isSelected ? <span className="font-sans text-primary">выбрана</span> : null}
                  </button>
                  {isOnCanvas ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Удалить связь #${from} → #${to}`}
                      onClick={() => disconnect(from, to)}
                    >
                      <Trash2 />
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="mt-auto">
        <Button
          variant="destructive"
          size="sm"
          className="w-full"
          onClick={() => disconnect(selectedEdge.from, selectedEdge.to)}
        >
          <Trash2 /> Удалить связь #{selectedEdge.from} → #{to}
        </Button>
      </div>
    </aside>
  );
}
