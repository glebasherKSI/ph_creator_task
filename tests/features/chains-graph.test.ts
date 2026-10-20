import { describe, expect, it } from "vitest";

import {
  type GraphState,
  EMPTY_GRAPH,
  addEdge,
  buildGtValueForTarget,
  conditionsForSave,
  importGraphFromConditions,
  mergeGamificationTasks,
  remapTaskId,
  removeEdge,
  removeTasks,
  savableDirtyTargets,
  setTargetConfig,
  stripLocalTaskIds,
} from "@/features/chains/graph";
import {
  assignColumns,
  columnX,
  layoutCanvasTasks,
  GRID_START_Y,
  CARD_MIN_H,
  VERTICAL_GAP,
} from "@/features/chains/layout";
import { getGamificationTasksCondition } from "@/lib/tasks";

import taskWithGt from "../fixtures/har/task-with-gamification-tasks-1366.json";
import taskWithoutOnly from "../fixtures/har/task-without-only-completed-1365.json";

function task(
  id: string,
  conditions: Record<string, unknown>[] | null = [],
  extra: Partial<GraphState["canvas"][string]> = {},
) {
  return {
    id,
    name: `T${id}`,
    frontend_identifier: `fi_${id}`,
    conditions,
    full: null,
    x: 0,
    y: 0,
    ...extra,
  };
}

function graph(
  ids: string[],
  conditions: Record<string, Record<string, unknown>[]> = {},
): GraphState {
  const canvas: GraphState["canvas"] = {};
  for (const id of ids) canvas[id] = task(id, conditions[id] ?? []);
  return { ...EMPTY_GRAPH, canvas };
}

describe("chains graph — рёбра ↔ conditions", () => {
  it("importGraphFromConditions строит рёбра и конфиги из conditions (отсутствие only_completed = false)", () => {
    const state = graph(["1313", "1314", "1365", "1366"], {
      "1366": taskWithGt.conditions as Record<string, unknown>[],
      "1365": taskWithoutOnly.conditions as Record<string, unknown>[],
    });
    const next = importGraphFromConditions(state);
    expect(next.edges).toEqual([
      { from: "1313", to: "1365" },
      { from: "1365", to: "1366" },
      { from: "1314", to: "1366" },
    ]);
    expect(next.targetConfigs["1366"]).toEqual({
      type: "enabled",
      extra_type: "or",
      only_completed: true,
    });
    expect(next.targetConfigs["1365"]).toEqual({
      type: "enabled",
      extra_type: "or",
      only_completed: false,
    });
  });

  it("addEdge: конфиг по умолчанию, цель грязная, conditions пересобраны", () => {
    const next = addEdge(graph(["1", "2"]), "1", "2");
    expect(next.edges).toEqual([{ from: "1", to: "2" }]);
    expect(next.dirtyTargets).toEqual(["2"]);
    expect(getGamificationTasksCondition(next.canvas["2"]!.conditions)).toEqual({
      list: ["1"],
      type: "enabled",
      extra_type: "or",
      only_completed: true,
    });
    expect(addEdge(next, "1", "2")).toBe(next);
    expect(addEdge(next, "2", "2")).toBe(next);
  });

  it("removeEdge: последнее ребро убирает блок и конфиг", () => {
    const state = addEdge(graph(["1", "2"]), "1", "2");
    const next = removeEdge(state, "1", "2");
    expect(next.edges).toEqual([]);
    expect(next.targetConfigs["2"]).toBeUndefined();
    expect(getGamificationTasksCondition(next.canvas["2"]!.conditions)).toBeNull();
    expect(removeEdge(next, "1", "2")).toBe(next);
  });

  it("setTargetConfig меняет блок и сортирует list численно", () => {
    let state = addEdge(graph(["10", "9", "2"]), "10", "2");
    state = addEdge(state, "9", "2");
    state = setTargetConfig(state, "2", { extra_type: "and", only_completed: false });
    expect(buildGtValueForTarget(state, "2")).toEqual({
      list: ["9", "10"],
      type: "enabled",
      extra_type: "and",
      only_completed: false,
    });
  });

  it("buildGtValueForTarget сохраняет id задач, которых нет на канве", () => {
    const state = graph(["1366"], { "1366": taskWithGt.conditions as Record<string, unknown>[] });
    const imported = importGraphFromConditions(state);
    expect(buildGtValueForTarget(imported, "1366").list).toEqual(["1314", "1365"]);
  });

  it("stripLocalTaskIds / conditionsForSave не шлют локальные id, но хранят их локально", () => {
    let state = graph(["1", "2"]);
    state.canvas["local_a"] = task("local_a", [], { localOnly: true });
    state = addEdge(state, "1", "2");
    state = addEdge(state, "local_a", "2");
    const { merged, toSend } = conditionsForSave(state, "2", [{ fraud: false }]);
    expect(getGamificationTasksCondition(merged)?.list).toEqual(["1", "local_a"]);
    expect(getGamificationTasksCondition(toSend)?.list).toEqual(["1"]);
    expect(merged[0]).toEqual({ fraud: false });
    expect(stripLocalTaskIds(state, merged)).toEqual(toSend);
    expect(savableDirtyTargets(state)).toEqual(["2"]);
  });

  it("removeTasks: цели потерянных рёбер становятся грязными", () => {
    let state = addEdge(graph(["1", "2", "3"]), "1", "2");
    state = { ...state, dirtyTargets: [] };
    const next = removeTasks(state, ["1"]);
    expect(next.canvas["1"]).toBeUndefined();
    expect(next.edges).toEqual([]);
    expect(next.dirtyTargets).toEqual(["2"]);
  });

  it("remapTaskId: черновик стал задачей — рёбра и последователи переносятся", () => {
    let state = graph(["5"]);
    state.canvas["local_x"] = task("local_x", [], { localOnly: true });
    state = addEdge(state, "local_x", "5");
    const next = remapTaskId(state, "local_x", "77");
    expect(next.canvas["77"]?.localOnly).toBeUndefined();
    expect(next.edges).toEqual([{ from: "77", to: "5" }]);
    expect(getGamificationTasksCondition(next.canvas["5"]!.conditions)?.list).toEqual(["77"]);
    expect(next.dirtyTargets).toEqual(["5"]);
  });

  it("mergeGamificationTasks: пустой list удаляет блок", () => {
    const base = [
      { fraud: false },
      { gamification_tasks: { list: ["1"], type: "enabled", extra_type: "or" } },
    ];
    expect(mergeGamificationTasks(base, null)).toEqual([{ fraud: false }]);
    expect(mergeGamificationTasks(base, { list: [] })).toEqual([{ fraud: false }]);
  });
});

describe("chains layout", () => {
  it("assignColumns: глубина по рёбрам, цикл не зацикливает", () => {
    const cols = assignColumns(
      ["a", "b", "c", "d"],
      [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "c", to: "b" },
        { from: "a", to: "d" },
      ],
    );
    expect(cols.get("a")).toBe(0);
    expect(cols.get("d")).toBe(1);
    expect(cols.get("b")).toBeGreaterThanOrEqual(1);
  });

  it("layoutCanvasTasks: колонки по id, высоты учитываются", () => {
    const state = graph(["2", "1", "3"]);
    const pos = layoutCanvasTasks(state.canvas, [{ from: "1", to: "3" }], {
      forceAll: true,
      heights: { "1": 200 },
    });
    expect(pos["1"]).toEqual({ x: columnX(0), y: GRID_START_Y });
    expect(pos["2"]).toEqual({ x: columnX(0), y: GRID_START_Y + 200 + VERTICAL_GAP });
    expect(pos["3"]).toEqual({ x: columnX(1), y: GRID_START_Y });
  });

  it("layoutCanvasTasks onlyIds: новая карточка не накладывается на существующую", () => {
    const state = graph(["1", "2"]);
    state.canvas["1"]!.y = GRID_START_Y;
    const pos = layoutCanvasTasks(state.canvas, [], { onlyIds: ["2"] });
    expect(pos["1"]).toBeUndefined();
    expect(pos["2"]!.y).toBe(GRID_START_Y + CARD_MIN_H + VERTICAL_GAP);
  });
});
