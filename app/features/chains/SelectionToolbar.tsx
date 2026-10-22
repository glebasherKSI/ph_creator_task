/** Группа «Выделение»: выбрать все / снять / цвет / выровнять / в пакет / убрать (рамка — Shift + drag). */
import { useReactFlow } from "@xyflow/react";
import { BoxSelect, Languages, LayoutGrid, PackagePlus, Palette, Trash2, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { measuredHeights } from "./layout";
import { useSendToPackageDialog } from "./SendToPackageDialog";
import { useChainsStore } from "./store";
import { HeaderColorPalette, commonHeaderColor, removeTasksWithConfirm } from "./TaskNode";
import { runTitlesSync } from "./titles-sync";

export function SelectionToolbar() {
  const rf = useReactFlow();
  const ids = useChainsStore((s) => s.selectedIds);
  const selectedCount = ids.length;
  const total = useChainsStore((s) => Object.keys(s.canvas).length);
  const [colorOpen, setColorOpen] = useState(false);

  function selectAll(all: boolean) {
    const store = useChainsStore.getState();
    store.setSelectedIds(all ? Object.keys(store.canvas) : []);
  }

  function alignSelected() {
    const store = useChainsStore.getState();
    store.alignTasks(ids, measuredHeights(rf.getNodes()));
    store.setStatus(`Выровнено карточек: ${ids.length}`);
  }

  if (!selectedCount) {
    return (
      <Button
        variant="ghost"
        size="sm"
        disabled={!total}
        onClick={() => selectAll(true)}
        title="Выбрать все карточки (или рамкой: Shift + перетаскивание)"
      >
        <BoxSelect /> Выбрать все
      </Button>
    );
  }

  return (
    <>
      <span className="px-1.5 text-caption font-semibold text-primary tabular-nums">
        Выбрано {selectedCount}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Снять выделение"
        title="Снять выделение"
        onClick={() => selectAll(false)}
      >
        <X />
      </Button>
      <Popover open={colorOpen} onOpenChange={setColorOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" title="Цвет шапки выбранных карточек">
            <Palette /> Цвет
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto pt-2">
          <HeaderColorPalette
            current={commonHeaderColor(ids)}
            onPick={(color) => {
              useChainsStore.getState().setHeaderColor(ids, color);
              setColorOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
      <Button
        variant="ghost"
        size="sm"
        disabled={selectedCount < 2}
        onClick={alignSelected}
        title="Разложить выбранные карточки по рядам на их месте, остальные не трогать"
      >
        <LayoutGrid /> Выровнять
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => useSendToPackageDialog.getState().show(ids)}
        title="Отправить выбранные задачи в пакет Promo Graphic"
      >
        <PackagePlus /> В пакет
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => void runTitlesSync(ids)}
        title="Подтянуть названия по локалям из Promo Graphic для выбранных задач"
      >
        <Languages /> Названия
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => removeTasksWithConfirm(ids)}
        className="text-destructive hover:text-destructive"
        title="Убрать выбранные карточки с канвы"
      >
        <Trash2 /> Убрать
      </Button>
    </>
  );
}
