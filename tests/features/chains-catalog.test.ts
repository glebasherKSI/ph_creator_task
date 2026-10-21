import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import type { GamificationTask } from "@/lib/types";

const fetchTasksPage = vi.fn();
vi.mock("@/lib/task-api", () => ({
  fetchTasksPage: (...args: unknown[]) => fetchTasksPage(...args),
  fetchTask: vi.fn(),
  updateTask: vi.fn(),
}));

const { useChainsStore } = await import("@/features/chains/store");

function task(id: number, state = "active"): GamificationTask {
  return { id, name: `T${id}`, frontend_identifier: `fi${id}`, state } as GamificationTask;
}

function page(ids: number[], hasMore: boolean, hidden = 0) {
  return {
    tasks: ids.map((id) => task(id)),
    hidden,
    rawCount: ids.length + hidden,
    hasMore,
    total: null,
  };
}

beforeEach(async () => {
  fakeBrowser.reset();
  fetchTasksPage.mockReset();
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
