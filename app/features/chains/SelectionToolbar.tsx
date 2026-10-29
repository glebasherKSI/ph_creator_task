/**
 * Выделение карточек. В шапке — только «Выбрать все» (ширина не меняется, шапка не прыгает).
 * Действия с выделенными — плавающая панель над канвой (SelectionBar): цвет / выровнять /
 * сравнить / изменить / в пакет / названия / убрать. Рамка — Shift + перетаскивание.
 */
import { useReactFlow } from "@xyflow/react";
import {
  BoxSelect,
  GitCompareArrows,
  Languages,
  LayoutGrid,
  ListChecks,
  PackagePlus,
  Palette,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { useBulkEdit } from "./bulk-edit-run";
import { useCompare } from "./CompareDialog";
import { measuredHeights } from "./layout";
import { useSendToPackageDialog } from "./SendToPackageDialog";
import { useChainsStore } from "./store";
import { HeaderColorPalette, commonHeaderColor, removeTasksWithConfirm } from "./TaskNode";
import { runTitlesSync } from "./titles-sync";

/** Кнопка в шапке: одна и та же при любом выделении. */
export function SelectionToolbar() {
  const total = useChainsStore((s) => Object.keys(s.canvas).length);
  const allSelected = useChainsStore(
    (s) => s.selectedIds.length > 0 && s.selectedIds.length === Object.keys(s.canvas).length,
  );
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={!total || allSelected}
      onClick={() => {
        const store = useChainsStore.getState();
        store.setSelectedIds(Object.keys(store.canvas));
      }}
      title="Выбрать все карточки (или рамкой: Shift + перетаскивание)"
    >
      <BoxSelect /> Выбрать все
    </Button>
  );
}

function Divider() {
  return <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-border" />;
}

/**
 * Плавающая панель действий над канвой: появляется при выделении и плавно уходит,
 * когда выделение снято. Лежит поверх канвы — вёрстку страницы не двигает.
 */
export function SelectionBar() {
  const rf = useReactFlow();
  const ids = useChainsStore((s) => s.selectedIds);
  const [colorOpen, setColorOpen] = useState(false);
  // Пока панель уезжает, показываем последнее выделение (без мигания пустой панели).
  const [shown, setShown] = useState<string[]>(ids);
  const [closing, setClosing] = useState(false);
  if (ids.length && shown !== ids) {
    setShown(ids);
    if (closing) setClosing(false);
  } else if (!ids.length && shown.length && !closing) {
    setClosing(true);
  }

  // Esc снимает выделение — если фокус не в поле ввода и не открыто модальное окно.
  const hasSelection = ids.length > 0;
  useEffect(() => {
    if (!hasSelection) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return;
      if (document.querySelector("[role=dialog][data-state=open]")) return;
      useChainsStore.getState().setSelectedIds([]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasSelection]);

  if (!shown.length) return null;

  const count = shown.length;
  const clear = () => useChainsStore.getState().setSelectedIds([]);

  function alignSelected() {
    const store = useChainsStore.getState();
    store.alignTasks(shown, measuredHeights(rf.getNodes()));
    store.setStatus(`Выровнено карточек: ${shown.length}`);
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center px-3">
      <div
        role="toolbar"
        aria-label={`Действия с выделенными: ${count}`}
        className={cn(
          "pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-0.5 rounded-lg bg-surface/95 p-1 shadow-xl ring-1 ring-border backdrop-blur-sm",
          closing ? "animate-pop-out [animation-fill-mode:forwards]" : "animate-pop-in",
        )}
        onAnimationEnd={() => {
          if (!closing) return;
          setClosing(false);
          setShown([]);
        }}
      >
        <span
          className="flex h-7 items-center rounded-md bg-primary/15 px-2 text-caption font-semibold text-primary tabular-nums"
          aria-live="polite"
        >
          Выбрано {count}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Снять выделение"
          title="Снять выделение (Esc)"
          onClick={clear}
        >
          <X />
        </Button>
        <Divider />
        <Popover open={colorOpen} onOpenChange={setColorOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" title="Цвет шапки выбранных карточек">
              <Palette /> Цвет
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto pt-2">
            <HeaderColorPalette
              current={commonHeaderColor(shown)}
              onPick={(color) => {
                useChainsStore.getState().setHeaderColor(shown, color);
                setColorOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>
        <Button
          variant="ghost"
          size="sm"
          disabled={count < 2}
          onClick={alignSelected}
          title="Разложить выбранные карточки по рядам на их месте, остальные не трогать"
        >
          <LayoutGrid /> Выровнять
        </Button>
        <Divider />
        <Button
          variant="ghost"
          size="sm"
          disabled={count < 2}
          onClick={() => useCompare.getState().show(shown)}
          title="Сравнить параметры выбранных задач в таблице — видно, где значения расходятся"
        >
          <GitCompareArrows /> Сравнить
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => useBulkEdit.getState().show(shown)}
          title="Изменить поля сразу у всех выбранных задач (кроме целевых действий)"
        >
          <ListChecks /> Изменить
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => useSendToPackageDialog.getState().show(shown)}
          title="Отправить выбранные задачи в пакет Promo Graphic"
        >
          <PackagePlus /> В пакет
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void runTitlesSync(shown)}
          title="Подтянуть названия по локалям из Promo Graphic для выбранных задач"
        >
          <Languages /> Названия
        </Button>
        <Divider />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => removeTasksWithConfirm(shown)}
          className="text-destructive hover:text-destructive"
          title="Убрать выбранные карточки с канвы"
        >
          <Trash2 /> Убрать
        </Button>
      </div>
    </div>
  );
}
