/**
 * Подписи на канве (Zustand): свободный текст в координатах канвы.
 * Живут отдельно от графа задач и сохраняются только внутри шаблонов (`template.labels`),
 * как в старом расширении.
 */
import { create } from "zustand";

import type { CanvasLabel } from "@/lib/storage";

export const DEFAULT_LABEL_TEXT = "Подпись";
export const LABEL_MAX_LENGTH = 120;

/** Id подписи — как `newLabelId` в legacy. */
export function newLabelId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return `lbl_${crypto.randomUUID()}`;
  return `lbl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/** Пустой текст заменяется на «Подпись». */
export function normalizeLabelText(raw: unknown): string {
  const text = String(raw ?? "").trim();
  return text || DEFAULT_LABEL_TEXT;
}

/** Подписи из шаблона: пропускает записи без числовых координат, id — из записи или новый. */
export function parseCanvasLabels(raw: unknown): CanvasLabel[] {
  if (!Array.isArray(raw)) return [];
  const labels: CanvasLabel[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const x = Number(record.x);
    const y = Number(record.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    labels.push({
      id: String(record.id || newLabelId()),
      text: normalizeLabelText(record.text),
      x,
      y,
    });
  }
  return labels;
}

export interface LabelsStore {
  labels: CanvasLabel[];
  selectedLabelId: string | null;
  add: (x: number, y: number, text?: string) => CanvasLabel;
  update: (id: string, patch: Partial<Pick<CanvasLabel, "x" | "y" | "text">>) => void;
  remove: (id: string) => void;
  select: (id: string | null) => void;
  clear: () => void;
  load: (labels: unknown) => void;
  serialize: () => CanvasLabel[];
}

export const useLabelsStore = create<LabelsStore>((set, get) => ({
  labels: [],
  selectedLabelId: null,

  add: (x, y, text) => {
    const label: CanvasLabel = {
      id: newLabelId(),
      text: normalizeLabelText(text),
      x: Number(x) || 0,
      y: Number(y) || 0,
    };
    set((s) => ({ labels: [...s.labels, label], selectedLabelId: label.id }));
    return label;
  },

  update: (id, patch) =>
    set((s) => {
      const idx = s.labels.findIndex((l) => l.id === id);
      if (idx < 0) return {};
      const current = s.labels[idx]!;
      const next: CanvasLabel = {
        ...current,
        ...(patch.x !== undefined ? { x: patch.x } : {}),
        ...(patch.y !== undefined ? { y: patch.y } : {}),
        ...(patch.text !== undefined ? { text: normalizeLabelText(patch.text) } : {}),
      };
      const labels = [...s.labels];
      labels[idx] = next;
      return { labels };
    }),

  remove: (id) =>
    set((s) => {
      if (!s.labels.some((l) => l.id === id)) return {};
      return {
        labels: s.labels.filter((l) => l.id !== id),
        selectedLabelId: s.selectedLabelId === id ? null : s.selectedLabelId,
      };
    }),

  select: (id) => set({ selectedLabelId: id }),

  clear: () => set({ labels: [], selectedLabelId: null }),

  load: (labels) => set({ labels: parseCanvasLabels(labels), selectedLabelId: null }),

  serialize: () => get().labels.map(({ id, text, x, y }) => ({ id, text, x, y })),
}));
