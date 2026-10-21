import { describe, expect, it } from "vitest";

import {
  conflictsByTask,
  detectBlockConflicts,
  formatConflictsCounter,
  formatSiblingGroupLabel,
  getSiblingGroupKey,
  getTargetActionTypes,
  pluralConflicts,
  taskHasConsentButton,
} from "@/features/chains/block-check";
import { type CanvasTask, type GraphState, EMPTY_GRAPH, addEdge } from "@/features/chains/graph";
import type { Condition, TaskLike } from "@/lib/types";

interface TaskSpec {
  consent?: boolean;
  actions?: string[];
  conditions?: Condition[];
  full?: boolean;
}

function task(id: string, spec: TaskSpec = {}): CanvasTask {
  const full: TaskLike | null =
    spec.full === false
      ? null
      : {
          id: Number(id),
          player_consent_required: spec.consent ?? false,
          serialized_main_actions: (spec.actions ?? []).map((action) => ({ action })),
        };
  return {
    id,
    name: `Task ${id}`,
    frontend_identifier: "",
    conditions: spec.conditions ?? [],
    full,
    x: 0,
    y: 0,
  };
}

function graph(tasks: CanvasTask[], edges: Array<[string, string]> = []): GraphState {
  let state: GraphState = {
    ...EMPTY_GRAPH,
    canvas: Object.fromEntries(tasks.map((t) => [t.id, t])),
  };
  for (const [from, to] of edges) state = addEdge(state, from, to);
  return state;
}

describe("block-check — вспомогательные правила", () => {
  it("taskHasConsentButton и getTargetActionTypes читают полную задачу", () => {
    expect(taskHasConsentButton(task("1", { consent: true }))).toBe(true);
    expect(taskHasConsentButton(task("1", { consent: false }))).toBe(false);
    expect(taskHasConsentButton(task("1", { full: false }))).toBe(false);
    expect(getTargetActionTypes(task("1", { actions: ["deposit", "", "bet"] }))).toEqual([
      "deposit",
      "bet",
    ]);
    expect(getTargetActionTypes(task("1", { full: false }))).toEqual([]);
  });

  it("ключ группы — отсортированные предшественники, включая сохранённые вне канвы", () => {
    const state = graph(
      [
        task("10"),
        task("3"),
        task("5", {
          conditions: [{ gamification_tasks: { list: ["99", "10"], type: "enabled" } }],
        }),
      ],
      [
        ["10", "5"],
        ["3", "5"],
      ],
    );
    expect(getSiblingGroupKey(state, "5")).toBe("3,10,99");
    expect(getSiblingGroupKey(state, "10")).toBe("");
    expect(formatSiblingGroupLabel("3,10")).toBe("после #3, #10");
    expect(formatSiblingGroupLabel("")).toBe("без зависимостей на канве");
  });

  it("склонения и счётчик", () => {
    expect(pluralConflicts(1)).toBe("конфликт");
    expect(pluralConflicts(2)).toBe("конфликта");
    expect(pluralConflicts(5)).toBe("конфликтов");
    expect(pluralConflicts(11)).toBe("конфликтов");
    expect(pluralConflicts(21)).toBe("конфликт");
    expect(formatConflictsCounter(0)).toBe("Конфликтов блокировки нет");
    expect(formatConflictsCounter(3)).toBe("3 конфликта блокировки");
  });
});

describe("block-check — detectBlockConflicts", () => {
  it("две корневые задачи с согласием и одним действием — конфликт", () => {
    const state = graph([
      task("2", { consent: true, actions: ["deposit"] }),
      task("1", { consent: true, actions: ["deposit"] }),
    ]);
    const { conflicts, conflictTaskIds } = detectBlockConflicts(state);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      parentKey: "",
      taskIds: ["1", "2"],
      actionLabel: "Депозит",
      siblingLabel: "без зависимостей на канве",
    });
    expect(conflicts[0]!.tooltip).toContain("#1, #2");
    expect(conflicts[0]!.tooltip).toContain("«Депозит»");
    expect([...conflictTaskIds].sort()).toEqual(["1", "2"]);
    expect(conflictsByTask(conflicts)["2"]).toBe(conflicts[0]);
  });

  it("без согласия или с разными действиями конфликта нет", () => {
    const noConsent = graph([
      task("1", { consent: false, actions: ["deposit"] }),
      task("2", { consent: true, actions: ["deposit"] }),
    ]);
    expect(detectBlockConflicts(noConsent).conflicts).toEqual([]);

    const differentActions = graph([
      task("1", { consent: true, actions: ["deposit"] }),
      task("2", { consent: true, actions: ["bet"] }),
    ]);
    expect(detectBlockConflicts(differentActions).conflicts).toEqual([]);
  });

  it("разные предшественники — разные группы; одинаковые — конфликт «после #…»", () => {
    const split = graph(
      [
        task("10"),
        task("11"),
        task("1", { consent: true, actions: ["bet"] }),
        task("2", { consent: true, actions: ["bet"] }),
      ],
      [
        ["10", "1"],
        ["11", "2"],
      ],
    );
    expect(detectBlockConflicts(split).conflicts).toEqual([]);

    const same = graph(
      [
        task("10"),
        task("1", { consent: true, actions: ["bet"] }),
        task("2", { consent: true, actions: ["bet"] }),
        task("3", { consent: true, actions: ["bet"] }),
      ],
      [
        ["10", "1"],
        ["10", "2"],
      ],
    );
    const { conflicts } = detectBlockConflicts(same);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      parentKey: "10",
      taskIds: ["1", "2"],
      siblingLabel: "после #10",
    });
    // Задача 3 — корневая, одна в своей группе.
    expect(conflicts[0]!.taskIds).not.toContain("3");
  });

  it("несколько действий — по конфликту на каждый тип, неизвестный тип подписывается как есть", () => {
    const state = graph([
      task("1", { consent: true, actions: ["deposit", "custom_x"] }),
      task("2", { consent: true, actions: ["deposit"] }),
      task("3", { consent: true, actions: ["custom_x"] }),
    ]);
    const { conflicts, conflictTaskIds } = detectBlockConflicts(state);
    expect(conflicts.map((c) => [c.actionLabel, c.taskIds])).toEqual([
      ["Депозит", ["1", "2"]],
      ["custom_x", ["1", "3"]],
    ]);
    expect(conflictTaskIds.size).toBe(3);
    // Для карточки берётся первый конфликт задачи.
    expect(conflictsByTask(conflicts)["1"]!.actionLabel).toBe("Депозит");
  });
});
