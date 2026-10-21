/** Мультивыделение карточек: выбрать все / снять / убрать выбранные (рамка — Shift + drag). */
import { Trash2 } from "lucide-react";

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

  if (!total) return null;

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => selectAll(true)}
        title="Выбрать все карточки"
      >
        Выбрать все
      </Button>
      <Button variant="ghost" size="sm" disabled={!selectedCount} onClick={() => selectAll(false)}>
        Снять
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={!selectedCount}
        onClick={removeSelected}
        className="text-destructive hover:text-destructive"
        title="Убрать выбранные карточки с канвы"
      >
        <Trash2 /> Убрать{selectedCount ? ` (${selectedCount})` : ""}
      </Button>
    </div>
  );
}
