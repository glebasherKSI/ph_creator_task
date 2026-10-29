import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

const fetchTask = vi.fn();
const updateTask = vi.fn();
vi.mock("@/lib/task-api", () => ({
  fetchTasksPage: vi.fn(),
  fetchTask: (...args: unknown[]) => fetchTask(...args),
  updateTask: (...args: unknown[]) => updateTask(...args),
}));

const { useChainsStore } = await import("@/features/chains/store");
const { applyBulkEdit, revertBulkEdit, useBulkEdit } =
  await import("@/features/chains/bulk-edit-run");

/** «Бэк»: задачи по id, PATCH записывает тело. */
let backend: Record<string, Record<string, unknown>> = {};

function backendTask(id: string, priority: number) {
  return {
    id: Number(id),
    name: `T${id}`,
    frontend_identifier: `t${id}`,
    priority,
    conditions: [],
  };
}

function card(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name: `T${id}`,
    frontend_identifier: `t${id}`,
    conditions: [],
    full: null,
    x: 0,
    y: 0,
    ...extra,
  };
}

beforeEach(async () => {
  fakeBrowser.reset();
  fetchTask.mockReset();
  updateTask.mockReset();
  backend = { "1": backendTask("1", 1), "2": backendTask("2", 4) };
  fetchTask.mockImplementation(async (_d: string, id: string) => structuredClone(backend[id]));
  updateTask.mockImplementation(
    async (_d: string, id: string, payload: { gamification_task: Record<string, unknown> }) => {
      backend[id] = { ...backend[id], ...payload.gamification_task, id: Number(id) };
      return { response: {}, task: structuredClone(backend[id]) };
    },
  );
  useChainsStore.setState({ domain: "" });
  await useChainsStore.getState().setDomain("admin.example.com");
  useChainsStore.setState({
    canvas: {
      "1": card("1"),
      "2": card("2"),
      "3": card("3"),
      local_1: card("local_1", { localOnly: true, full: { name: "draft", priority: 0 } }),
    },
    dirtyTargets: ["3"],
  });
  useBulkEdit.setState({ ids: ["1", "2", "3", "local_1"], phase: "edit", rows: [], snapshots: {} });
});

describe("applyBulkEdit / revertBulkEdit", () => {
  it("сохраняет на бэк, черновик меняет на канве, задачу с несохранёнными связями пропускает", async () => {
    await applyBulkEdit([{ field: "priority", value: 3 }], {});
    const { phase, rows } = useBulkEdit.getState();
    expect(phase).toBe("done");
    const outcome = Object.fromEntries(rows.map((r) => [r.id, r.outcome]));
    expect(outcome).toEqual({ "1": "updated", "2": "updated", "3": "skipped", local_1: "updated" });
    expect(backend["1"]!.priority).toBe(3);
    expect(backend["2"]!.priority).toBe(3);
    expect(updateTask).toHaveBeenCalledTimes(2);
    expect(useChainsStore.getState().canvas.local_1!.full).toMatchObject({ priority: 3 });
  });

  it("исключённые задачи не трогаются", async () => {
    await applyBulkEdit([{ field: "priority", value: 2 }], {}, new Set(["2", "3", "local_1"]));
    expect(useBulkEdit.getState().rows.map((r) => r.id)).toEqual(["1"]);
    expect(backend["2"]!.priority).toBe(4);
  });

  it("откат возвращает только изменённые поля, правки на бэке после этого сохраняются", async () => {
    await applyBulkEdit([{ field: "priority", value: 2 }], {}, new Set(["3"]));
    backend["1"] = { ...backend["1"], name: "Переименовали" };
    await revertBulkEdit();
    expect(backend["1"]).toMatchObject({ priority: 1, name: "Переименовали" });
    expect(backend["2"]!.priority).toBe(4);
    expect(useChainsStore.getState().canvas.local_1!.full).toMatchObject({ priority: 0 });
    const outcomes = useBulkEdit.getState().rows.map((r) => r.outcome);
    expect(outcomes.every((o) => o === "reverted")).toBe(true);
    expect(useBulkEdit.getState().snapshots).toEqual({});
  });
});

describe("открытие правки из сравнения", () => {
  it("операции-заготовки и возврат после закрытия", () => {
    const onClose = vi.fn();
    useBulkEdit.getState().show(["1", "2"], { seed: [{ field: "priority", value: 2 }], onClose });
    expect(useBulkEdit.getState().seed).toEqual([{ field: "priority", value: 2 }]);
    useBulkEdit.setState({ phase: "edit" });
    useBulkEdit.getState().close();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(useBulkEdit.getState()).toMatchObject({ open: false, seed: [], onClose: null });
  });
});
