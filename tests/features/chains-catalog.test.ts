import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import type { GamificationTask } from "@/lib/types";

const fetchTasksPage = vi.fn();
const fetchTask = vi.fn();
vi.mock("@/lib/task-api", () => ({
  fetchTasksPage: (...args: unknown[]) => fetchTasksPage(...args),
  fetchTask: (...args: unknown[]) => fetchTask(...args),
  updateTask: vi.fn(),
}));

const { useChainsStore } = await import("@/features/chains/store");

function task(id: number, state = "active"): GamificationTask {
  return { id, name: `T${id}`, frontend_identifier: `fi${id}`, state } as GamificationTask;
}

function page(ids: number[], hasMore: boolean, hidden = 0, total: number | null = null) {
  return {
    tasks: ids.map((id) => task(id)),
    hidden,
    rawCount: ids.length + hidden,
    hasMore,
    total,
  };
}

beforeEach(async () => {
  fakeBrowser.reset();
  fetchTasksPage.mockReset();
  fetchTask.mockReset();
  useChainsStore.setState({ domain: "" });
  await useChainsStore.getState().setDomain("admin.example.com");
});

describe("loadCatalog", () => {
  it("reset загружает все страницы подряд и считает скрытые", async () => {
    fetchTasksPage
      .mockResolvedValueOnce(page([1, 2], true, 1))
      .mockResolvedValueOnce(page([3], true))
      .mockResolvedValueOnce(page([4], false));
    await useChainsStore.getState().loadCatalog(true);
    const s = useChainsStore.getState();
    expect(s.catalogOrder).toEqual(["1", "2", "3", "4"]);
    expect(s.catalogHidden).toBe(1);
    expect(s.catalogHasMore).toBe(false);
    expect(s.catalogOffset).toBe(5);
    expect(fetchTasksPage.mock.calls.map((c) => c[1])).toEqual([0, 3, 4]);
    expect(s.catalogLoading).toBe(false);
    expect(s.catalogProgress).toBeNull();
  });

  it("с известным total — остальные страницы параллельно, коммит по порядку offset", async () => {
    // Первая страница: 2 строки, total 6 → ещё offsets 2 и 4 (шаг = 2).
    fetchTasksPage.mockImplementation(async (_d: string, offset: number) => {
      if (offset === 0) return page([1, 2], true, 0, 6);
      if (offset === 2) {
        await new Promise((r) => setTimeout(r, 20)); // медленнее следующей
        return page([3, 4], true, 0, 6);
      }
      return page([5, 6], false, 0, 6);
    });
    await useChainsStore.getState().loadCatalog(true);
    const s = useChainsStore.getState();
    expect(s.catalogOrder).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(s.catalogOffset).toBe(6);
    expect(s.catalogHasMore).toBe(false);
    expect(fetchTasksPage.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      [0, 250],
      [2, 2],
      [4, 2],
    ]);
  });

  it("без reset — одна следующая страница", async () => {
    fetchTasksPage.mockResolvedValueOnce(page([1], true)).mockResolvedValueOnce(page([2], false));
    await useChainsStore.getState().loadCatalog(true);
    fetchTasksPage.mockResolvedValueOnce(page([3], true));
    // reset уже прошёл все страницы; дозагрузка добавляет следующую.
    await useChainsStore.getState().loadCatalog(false);
    expect(useChainsStore.getState().catalogOrder).toEqual(["1", "2", "3"]);
    expect(fetchTasksPage).toHaveBeenCalledTimes(3);
  });
});

describe("addToCanvas", () => {
  it("сначала загружает все задачи, потом добавляет их одним обновлением", async () => {
    fetchTasksPage.mockResolvedValueOnce(page([1, 2, 3], false));
    await useChainsStore.getState().loadCatalog(true);

    const canvasSizes: number[] = [];
    const progress: (number | null)[] = [];
    const unsubscribe = useChainsStore.subscribe((s) => {
      canvasSizes.push(Object.keys(s.canvas).length);
      progress.push(s.addProgress?.done ?? null);
    });
    fetchTask.mockImplementation(async (_d: string, id: string) => {
      if (id === "2") throw new Error("boom");
      return { ...task(Number(id)), conditions: [] };
    });

    await expect(useChainsStore.getState().addToCanvas(["1", "2", "3"])).rejects.toThrow(
      "не загрузились 1 из 3",
    );
    unsubscribe();

    expect(Object.keys(useChainsStore.getState().canvas).sort()).toEqual(["1", "3"]);
    expect(useChainsStore.getState().canvas["1"]!.full).not.toBeNull();
    expect(useChainsStore.getState().addProgress).toBeNull();
    // Пока шла загрузка, канва оставалась пустой; прогресс дошёл до 3.
    const firstAdded = canvasSizes.findIndex((n) => n > 0);
    expect(progress.slice(0, firstAdded)).toContain(3);
    expect(canvasSizes[firstAdded]).toBe(2);
  });
});

it("addToCanvas: связи от новой задачи к уже добавленным подтягиваются", async () => {
  fetchTasksPage.mockResolvedValueOnce(page([1, 2, 3], false));
  await useChainsStore.getState().loadCatalog(true);
  const gt = (list: number[]) => [
    { gamification_tasks: { type: "enabled", extra_type: "or", list } },
  ];
  fetchTask.mockImplementation(async (_d: string, id: string) => ({
    ...task(Number(id)),
    conditions: id === "1" ? [] : gt([1]),
  }));
  // Сначала дочерние, потом родитель.
  await useChainsStore.getState().addToCanvas(["2", "3"]);
  expect(useChainsStore.getState().edges).toEqual([]);
  await useChainsStore.getState().addToCanvas(["1"]);
  const edges = useChainsStore
    .getState()
    .edges.map((e) => `${e.from}->${e.to}`)
    .sort();
  expect(edges).toEqual(["1->2", "1->3"]);
  expect(useChainsStore.getState().dirtyTargets).toEqual([]);
});

it("removeFromCanvas: связи не теряются, убранная задача помнится как «не на канве»", async () => {
  fetchTasksPage.mockResolvedValueOnce(page([1, 2], false));
  await useChainsStore.getState().loadCatalog(true);
  fetchTask.mockImplementation(async (_d: string, id: string) => ({
    ...task(Number(id)),
    conditions:
      id === "2" ? [{ gamification_tasks: { type: "enabled", extra_type: "or", list: [1] } }] : [],
  }));
  await useChainsStore.getState().addToCanvas(["1", "2"]);
  expect(useChainsStore.getState().edges).toHaveLength(1);

  useChainsStore.getState().removeFromCanvas(["2"]);
  let s = useChainsStore.getState();
  expect(s.dirtyTargets).toEqual([]);
  expect(s.detachedDeps).toEqual({ "2": ["1"] });

  useChainsStore.getState().removeFromCanvas(["1"]);
  await useChainsStore.getState().addToCanvas(["2"]);
  s = useChainsStore.getState();
  expect(s.dirtyTargets).toEqual([]);
  expect(s.detachedDeps).toEqual({});
});
