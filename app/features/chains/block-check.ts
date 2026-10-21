/**
 * Проверка блокировок: «параллельные» задачи (одинаковый набор предшественников) с кнопкой
 * «Согласие игрока» и одним типом целевого действия блокируют друг друга у игрока.
 * Чистые правила — как `detectBlockConflicts` в legacy; переключатель — крошечный store.
 */
import { create } from "zustand";

import { ACTION_LABELS } from "@/lib/actions-schema";
import { boolValue } from "@/lib/tasks";

import { type CanvasTask, type GraphState, buildGtValueForTarget } from "./graph";

export interface BlockConflict {
  /** Отсортированные id предшественников через запятую; "" — без зависимостей. */
  parentKey: string;
  taskIds: string[];
  actionLabel: string;
  siblingLabel: string;
  tooltip: string;
}

export interface BlockCheckResult {
  conflicts: BlockConflict[];
  conflictTaskIds: Set<string>;
}

export function taskHasConsentButton(task: CanvasTask | null | undefined): boolean {
  const full = task?.full;
  if (!full) return false;
  return boolValue(full.player_consent_required, false);
}

/** Типы целевых действий из serialized_main_actions (пустые пропускаются). */
export function getTargetActionTypes(task: CanvasTask | null | undefined): string[] {
  const full = task?.full;
  if (!full || !Array.isArray(full.serialized_main_actions)) return [];
  const types: string[] = [];
  for (const item of full.serialized_main_actions as unknown[]) {
    const action =
      item && typeof item === "object" ? (item as { action?: unknown }).action : undefined;
    if (typeof action === "string" && action) types.push(action);
  }
  return types;
}

/** Ключ группы «братьев»: все предшественники цели (на канве и сохранённые вне неё). */
export function getSiblingGroupKey(state: GraphState, taskId: string): string {
  const parents = buildGtValueForTarget(state, taskId).list.map(String);
  if (!parents.length) return "";
  return [...new Set(parents)].sort((a, b) => Number(a) - Number(b)).join(",");
}

export function formatSiblingGroupLabel(parentKey: string): string {
  if (!parentKey) return "без зависимостей на канве";
  return `после ${parentKey
    .split(",")
    .map((id) => `#${id}`)
    .join(", ")}`;
}

export function pluralConflicts(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "конфликт";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "конфликта";
  return "конфликтов";
}

export function formatConflictsCounter(count: number): string {
  if (!count) return "Конфликтов блокировки нет";
  return `${count} ${pluralConflicts(count)} блокировки`;
}

export function detectBlockConflicts(state: GraphState): BlockCheckResult {
  const groups = new Map<string, string[]>();
  for (const taskId of Object.keys(state.canvas)) {
    const key = getSiblingGroupKey(state, taskId);
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(taskId);
  }

  const conflicts: BlockConflict[] = [];
  const conflictTaskIds = new Set<string>();

  for (const [parentKey, siblings] of groups) {
    if (siblings.length < 2) continue;

    const byActionType = new Map<string, string[]>();
    for (const taskId of siblings) {
      const task = state.canvas[taskId];
      if (!taskHasConsentButton(task)) continue;
      for (const actionType of getTargetActionTypes(task)) {
        (byActionType.get(actionType) ?? byActionType.set(actionType, []).get(actionType)!).push(
          taskId,
        );
      }
    }

    for (const [actionType, taskIds] of byActionType) {
      const uniqueTaskIds = [...new Set(taskIds)].sort((a, b) => Number(a) - Number(b));
      if (uniqueTaskIds.length < 2) continue;
      const actionLabel = ACTION_LABELS[actionType] || actionType;
      const siblingLabel = formatSiblingGroupLabel(parentKey);
      const tooltip = `Блокировка: ${uniqueTaskIds.map((id) => `#${id}`).join(", ")} — кнопка «Согласие игрока», один тип целевого действия «${actionLabel}» (условия могут различаться), разблокируются ${siblingLabel}`;
      conflicts.push({ parentKey, taskIds: uniqueTaskIds, actionLabel, siblingLabel, tooltip });
      for (const taskId of uniqueTaskIds) conflictTaskIds.add(taskId);
    }
  }

  return { conflicts, conflictTaskIds };
}

/** Первый конфликт для каждой задачи — для бейджа «⚠ блок» на карточке. */
export function conflictsByTask(conflicts: BlockConflict[]): Record<string, BlockConflict> {
  const result: Record<string, BlockConflict> = {};
  for (const conflict of conflicts) {
    for (const id of conflict.taskIds) result[id] ??= conflict;
  }
  return result;
}

interface BlockCheckStore {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
}

/** Переключатель «Проверить блоки» (тулбар); конфликты считаются из useChainsStore в рендере. */
export const useBlockCheck = create<BlockCheckStore>((set) => ({
  enabled: false,
  setEnabled: (enabled) => set({ enabled }),
}));
