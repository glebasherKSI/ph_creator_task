/** Группа «Выделение»: выбрать все / снять / убрать выбранные (рамка — Shift + drag). */
import { BoxSelect, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";

import { useChainsStore } from "./store";

export function SelectionToolbar() {
  const selectedCount = useChainsStore((s) => s.selectedIds.length);
  const total = useChainsStore((s) => Object.keys(s.canvas).length);

  function selectAll(all: boolean) {
    const store = useChainsStore.getState();
    store.setSelectedIds(all ? Object.keys(store.canvas) : []);
  }

  function removeSelected() {
    const store = useChainsStore.getState();
    const ids = store.selectedIds;
    if (!ids.length) return;
    if (ids.length > 1 && !window.confirm(`Убрать с канвы ${ids.length} карточек?`)) return;
    store.removeFromCanvas(ids);
    store.setStatus(`Убрано с канвы: ${ids.length}`);
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
      <Button
        variant="ghost"
        size="sm"
        onClick={removeSelected}
        className="text-destructive hover:text-destructive"
        title="Убрать выбранные карточки с канвы"
      >
        <Trash2 /> Убрать
      </Button>
    </>
  );
}
