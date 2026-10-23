import { describe, expect, it } from "vitest";

import {
  type GraphState,
  EMPTY_GRAPH,
  addEdge,
  draftBodyWithCanvasLinks,
} from "@/features/chains/graph";
import {
  CARD_MIN_H,
  CARD_W,
  COL_GAP,
  GRID_START_X,
  GRID_START_Y,
  VERTICAL_GAP,
} from "@/features/chains/layout";
import { linkPrerequisite } from "@/features/chains/packages-actions";
import {
  collectPlannerLinks,
  nextStackOrigin,
  packageSubtitle,
  planPackagePlacement,
} from "@/features/chains/packages";
import { getGamificationTasksCondition } from "@/lib/tasks";

const PKG_TASKS = [
  { id: 1, name_backend: "A", sort_order: 1 },
  {
    id: 2,
    name_backend: "B",
    sort_order: 2,
    targeting: { prerequisite_task_id: 1 },
    ph_backend_id: "500",
  },
  { id: 3, name_backend: "C", sort_order: 3, targeting: { prerequisite_task_id: 2 } },
  { id: 4, name_backend: "D", sort_order: 0, targeting: { prerequisite_task_id: 99 } },
];

function graph(ids: string[], local: string[] = []): GraphState {
  const canvas: GraphState["canvas"] = {};
  for (const id of ids) {
    canvas[id] = {
      id,
      name: id,
      frontend_identifier: "",
      conditions: [],
      full: null,
      x: 0,
      y: 0,
      ...(local.includes(id) ? { localOnly: true } : {}),
    };
  }
  return { ...EMPTY_GRAPH, canvas };
}

describe("packages — раскладка", () => {
  it("planPackagePlacement: колонки по глубине, строки по порядку, ph_backend_id распознан", () => {
    const origin = { x: GRID_START_X, y: GRID_START_Y };
    const placed = planPackagePlacement(PKG_TASKS, origin);
    const byId = Object.fromEntries(placed.map((p) => [p.task.id, p]));
    expect(byId[1]).toMatchObject({ depth: 0, x: origin.x, phBackendId: null });
    expect(byId[4]).toMatchObject({ depth: 0, x: origin.x });
    expect(byId[2]).toMatchObject({
      depth: 1,
      x: origin.x + CARD_W + COL_GAP,
      y: origin.y,
      phBackendId: 500,
    });
    expect(byId[3]).toMatchObject({ depth: 2, x: origin.x + 2 * (CARD_W + COL_GAP) });
    // Две задачи в нулевой колонке — вторая строкой ниже.
    const col0 = placed
      .filter((p) => p.depth === 0)
      .map((p) => p.y)
      .sort((a, b) => a - b);
    expect(col0).toEqual([origin.y, origin.y + CARD_MIN_H + VERTICAL_GAP]);
  });

  it("nextStackOrigin под нижней карточкой", () => {
    expect(nextStackOrigin({})).toEqual({ x: GRID_START_X, y: GRID_START_Y });
    expect(nextStackOrigin({ a: { y: 100 }, b: { y: 400 } }, { b: 200 })).toEqual({
      x: GRID_START_X,
      y: 400 + 200 + VERTICAL_GAP,
    });
  });

  it("collectPlannerLinks: внешние предшественники и циклы", () => {
    const placed = planPackagePlacement(PKG_TASKS, { x: 0, y: 0 });
    const map = new Map<number, string>([
      [1, "local_1"],
      [2, "500"],
      [3, "local_3"],
      [4, "local_4"],
    ]);
    const links = collectPlannerLinks(placed, map);
    expect(links.map((l) => [l.targetId, l.prereqPlannerId, l.cycle]).sort()).toEqual(
      [
        ["500", 1, false],
        ["local_3", 2, false],
        ["local_4", 99, false],
      ].sort(),
    );
    const cyc = collectPlannerLinks(
      planPackagePlacement(
        [
          { id: 7, targeting: { prerequisite_task_id: 8 } },
          { id: 8, targeting: { prerequisite_task_id: 7 } },
        ],
        { x: 0, y: 0 },
      ),
      new Map([
        [7, "l7"],
        [8, "l8"],
      ]),
    );
    expect(cyc.some((l) => l.cycle)).toBe(true);
  });

  it("packageSubtitle", () => {
    expect(
      packageSubtitle({
        id: 1,
        project_code: "LEX",
        kind: "seasonal",
        status: "ready",
        task_count: 3,
      }),
    ).toBe("LEX · Сезонные · Готово · — → — · 3 задач");
  });
});

describe("packages — linkPrerequisite", () => {
  it("оба на канве → ребро; цель с бэка становится грязной", () => {
    const { state, result } = linkPrerequisite(graph(["1", "2"]), "1", "2");
    expect(result).toBe("linked");
    expect(state.edges).toEqual([{ from: "1", to: "2" }]);
    expect(state.dirtyTargets).toEqual(["2"]);
    expect(linkPrerequisite(state, "1", "2").result).toBe("exists");
    expect(linkPrerequisite(state, "2", "2").result).toBe("skip");
  });

  it("предшественник только на бэке → id в conditions цели", () => {
    const { state, result } = linkPrerequisite(graph(["2"]), "777", "2");
    expect(result).toBe("linked");
    expect(getGamificationTasksCondition(state.canvas["2"]!.conditions)?.list).toEqual(["777"]);
    expect(state.dirtyTargets).toEqual(["2"]);
  });

  it("цель — локальный черновик: связь есть, но на бэк сохранять нечего", () => {
    const { state } = linkPrerequisite(graph(["1", "local_x"], ["local_x"]), "1", "local_x");
    expect(state.edges).toEqual([{ from: "1", to: "local_x" }]);
    expect(state.dirtyTargets).toEqual([]);
  });

  it("источник — черновик, цель с бэка: ребро есть, цель не грязная до создания черновика", () => {
    const base = addEdge(graph(["local_a", "2", "3"], ["local_a"]), "3", "2");
    const { state } = linkPrerequisite({ ...base, dirtyTargets: [] }, "local_a", "2");
    expect(state.edges).toContainEqual({ from: "local_a", to: "2" });
    expect(state.dirtyTargets).toEqual([]);
  });
});

describe("packages — форма черновика", () => {
  it("draftBodyWithCanvasLinks: связи с канвы в conditions, без id черновиков", () => {
    let state = graph(["1529", "local_a", "local_b"], ["local_a", "local_b"]);
    state = addEdge(state, "1529", "local_b");
    state = addEdge(state, "local_a", "local_b");
    const full = { name: "B", conditions: [{ fraud: false }] };
    const body = draftBodyWithCanvasLinks(state, full, state.canvas["local_b"]!.conditions);
    expect(body.conditions).toEqual([
      { fraud: false },
      {
        gamification_tasks: {
          list: ["1529"],
          type: "enabled",
          extra_type: "or",
          only_completed: true,
        },
      },
    ]);
    // Связь только с черновиком — тело без изменений.
    const onlyLocal = addEdge(
      graph(["local_a", "local_c"], ["local_a", "local_c"]),
      "local_a",
      "local_c",
    );
    expect(draftBodyWithCanvasLinks(onlyLocal, full, onlyLocal.canvas["local_c"]!.conditions)).toBe(
      full,
    );
  });
});
