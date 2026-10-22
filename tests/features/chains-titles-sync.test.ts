import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import type { GamificationTask } from "@/lib/types";

const graphicApiGet = vi.fn();
vi.mock("@/lib/graphic-api", () => ({
  graphicApiGet: (...args: unknown[]) => graphicApiGet(...args),
}));

const fetchTask = vi.fn();
const updateTask = vi.fn();
vi.mock("@/lib/task-api", () => ({
  fetchTasksPage: vi.fn(),
  fetchTask: (...args: unknown[]) => fetchTask(...args),
  updateTask: (...args: unknown[]) => updateTask(...args),
}));

const { useChainsStore } = await import("@/features/chains/store");
const { runTitlesSync, useTitlesSync } = await import("@/features/chains/titles-sync");

function card(id: string, fi: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name: `T${id}`,
    frontend_identifier: fi,
    conditions: [],
    full: null,
    x: 0,
    y: 0,
    ...extra,
  };
}

beforeEach(async () => {
  fakeBrowser.reset();
  graphicApiGet.mockReset();
  fetchTask.mockReset();
  updateTask.mockReset();
  useChainsStore.setState({ domain: "" });
  await useChainsStore.getState().setDomain("admin.example.com");
  useChainsStore.setState({
    canvas: {
      "1": card("1", "Task_One"),
      "2": card("2", "task_two"),
      "3": card("3", "missing_fi"),
      "4": card("4", "", { localOnly: true }),
    },
  });
});

describe("runTitlesSync", () => {
  it("обновляет найденные, считает пустые локали, не PATCH-ит без изменений", async () => {
    graphicApiGet.mockResolvedValue({
      items: [
        { frontend_identifier: " task_one ", titles: { ru: "Раз", en: "One" } },
        { frontend_identifier: "TASK_TWO", titles: { ru: "Два" } },
      ],
    });
    fetchTask.mockImplementation(async (_d: string, id: string) => {
      const base = { id: Number(id), name: `T${id}`, frontend_identifier: "x", conditions: [] };
      return (id === "2"
        ? { ...base, locales: { ru: "Два" } }
        : { ...base, locales: {} }) as unknown as GamificationTask;
    });
    updateTask.mockImplementation(
      async (_d: string, id: string, payload: { gamification_task: unknown }) => ({
        response: {},
        task: { ...(payload.gamification_task as object), id: Number(id) },
      }),
    );

    await runTitlesSync(["1", "2", "3", "4"]);
    const { phase, rows } = useTitlesSync.getState();
    expect(phase).toBe("done");
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId["1"]!.outcome).toBe("updated");
    expect(byId["1"]!.missing).toEqual(["de", "es", "fr", "it", "pt"]);
    expect(byId["2"]!.outcome).toBe("unchanged");
    expect(byId["3"]!.outcome).toBe("not-found");
    expect(byId["4"]!.outcome).toBe("skipped");

    expect(updateTask).toHaveBeenCalledTimes(1);
    const sent = updateTask.mock.calls[0]![2] as { gamification_task: { locales: unknown } };
    expect(sent.gamification_task.locales).toEqual({ ru: "Раз", en: "One" });
  });

  it("нет входа в Graphic — фаза failed с текстом ошибки", async () => {
    graphicApiGet.mockRejectedValue(new Error("Нет входа в Promo Graphic"));
    await runTitlesSync(["1"]);
    expect(useTitlesSync.getState().phase).toBe("failed");
    expect(useTitlesSync.getState().error).toContain("Нет входа");
    expect(fetchTask).not.toHaveBeenCalled();
  });
});
