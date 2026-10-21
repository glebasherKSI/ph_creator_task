import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import type { GamificationTask } from "@/lib/types";

const fetchTask = vi.fn();
vi.mock("@/lib/task-api", () => ({
  fetchTask: (...args: unknown[]) => fetchTask(...args),
  fetchTasksPage: vi.fn(),
  updateTask: vi.fn(),
}));

const graphicApiGet = vi.fn();
const graphicApiPost = vi.fn();
vi.mock("@/lib/graphic-api", () => ({
  graphicApiGet: (...args: unknown[]) => graphicApiGet(...args),
  graphicApiPost: (...args: unknown[]) => graphicApiPost(...args),
}));

const { useChainsStore } = await import("@/features/chains/store");
const { countRows, loadProjectPackages, sendPercent, sendTasksToPackage } =
  await import("@/features/chains/package-export");
const { getGraphicProjectForDomain } = await import("@/lib/storage");

type ImportBody = { mode: string; tasks: Array<Record<string, unknown>> };

function phTask(id: number | string, prereqs: string[] = []): GamificationTask {
  return {
    id: Number(id),
    name: `T${id}`,
    frontend_identifier: `fi${id}`,
    type: "interactive",
    priority: 2,
    conditions: prereqs.length
      ? [{ gamification_tasks: { list: prereqs, type: "enabled", extra_type: "or" } }]
      : [],
  } as unknown as GamificationTask;
}

function card(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name: `T${id}`,
    frontend_identifier: "",
    conditions: [],
    full: null,
    x: 0,
    y: 0,
    ...extra,
  };
}

/** Ответ импорта: всё из запроса создано в пакете packageId. */
function createdAll(packageId = 5, name = "Осень") {
  return (_path: string, body: ImportBody) =>
    Promise.resolve({
      created: body.tasks.map((t, i) => ({
        ph_backend_id: t.ph_backend_id,
        task_id: 100 + i,
        package_id: packageId,
      })),
      updated: [],
      skipped: [],
      errors: [],
      warnings: [],
      package: { id: packageId, name },
    });
}

function importCalls(): ImportBody[] {
  return graphicApiPost.mock.calls
    .filter(([path]) => String(path).endsWith("/import"))
    .map(([, body]) => body as ImportBody);
}

beforeEach(() => {
  fakeBrowser.reset();
  fetchTask.mockReset();
  graphicApiGet.mockReset();
  graphicApiPost.mockReset();
  useChainsStore.setState({
    domain: "admin.example.com",
    catalog: { "3": { id: "3", name: "Из каталога" } },
    dirtyTargets: [],
    canvas: {
      "1": card("1", { headerColor: "red", full: phTask(1) }),
      "2": card("2", { full: phTask(2, ["1"]) }),
      local_9: card("local_9", { localOnly: true }),
    },
  } as never);
  fetchTask.mockImplementation((_domain: string, id: string) => Promise.resolve(phTask(id)));
});

describe("sendTasksToPackage", () => {
  it("карточки с канвы не грузит заново, каталог и изменённые — грузит", async () => {
    useChainsStore.setState({ dirtyTargets: ["2"] } as never);
    graphicApiPost.mockImplementation(createdAll());

    const result = await sendTasksToPackage({
      taskIds: ["2", "local_9", "1", "3"],
      projectCode: "p1",
      target: { packageId: 5 },
      mode: "update",
    });

    expect(fetchTask.mock.calls.map(([, id]) => id).sort()).toEqual(["2", "3"]);
    const [body] = importCalls();
    expect(body!.mode).toBe("update");
    expect(body!.tasks.map((t) => t.ph_backend_id)).toEqual(["1", "2", "3"]);
    expect(body!.tasks[0]).toMatchObject({ color: "#ef4444", priority: "medium" });
    expect(result.rows.map((r) => [r.id, r.state])).toEqual([
      ["2", "created"],
      ["local_9", "draft"],
      ["1", "created"],
      ["3", "created"],
    ]);
    expect(result.rows[3]!.name).toBe("Из каталога");
    expect(result.packageName).toBe("Осень");
    expect(await getGraphicProjectForDomain("admin.example.com")).toBe("p1");
  });

  it("большой выбор уходит пачками по 20, предшественники раньше", async () => {
    const ids = Array.from({ length: 45 }, (_, i) => String(i + 1));
    // Цепочка в обратном порядке выбора: n зависит от n + 1.
    fetchTask.mockImplementation((_d: string, id: string) =>
      Promise.resolve(phTask(id, Number(id) < 45 ? [String(Number(id) + 1)] : [])),
    );
    useChainsStore.setState({ canvas: {} } as never);
    graphicApiPost.mockImplementation(createdAll());

    const result = await sendTasksToPackage({
      taskIds: ids,
      projectCode: "p1",
      target: { packageId: 5 },
      mode: "update",
    });

    const calls = importCalls();
    expect(calls.map((c) => c.tasks.length)).toEqual([20, 20, 5]);
    expect(calls[0]!.tasks[0]!.ph_backend_id).toBe("45");
    expect(calls[2]!.tasks.at(-1)!.ph_backend_id).toBe("1");
    expect(countRows(result.rows).created).toBe(45);
  });

  it("пачка с ошибкой сети: повтор, затем ошибка у её задач — остальные уходят", async () => {
    useChainsStore.setState({ canvas: {} } as never);
    const ids = Array.from({ length: 25 }, (_, i) => String(i + 1));
    graphicApiPost
      .mockRejectedValueOnce(new Error("Превышено время ожидания Graphic"))
      .mockRejectedValueOnce(new Error("Превышено время ожидания Graphic"))
      .mockImplementation(createdAll());

    const result = await sendTasksToPackage({
      taskIds: ids,
      projectCode: "p1",
      target: { packageId: 5 },
      mode: "update",
    });

    const counts = countRows(result.rows);
    expect(counts.errors).toBe(20);
    expect(counts.created).toBe(5);
    expect(result.rows[0]!.detail).toContain("Превышено время ожидания");
  });

  it("одна неудачная попытка повторяется незаметно", async () => {
    graphicApiPost.mockRejectedValueOnce(new Error("сеть")).mockImplementation(createdAll());

    const result = await sendTasksToPackage({
      taskIds: ["1"],
      projectCode: "p1",
      target: { packageId: 5 },
      mode: "update",
    });

    expect(importCalls()).toHaveLength(2);
    expect(result.rows[0]!.state).toBe("created");
  });

  it("ошибки, предупреждения и обновления в других пакетах — по строкам", async () => {
    useChainsStore.setState({
      canvas: {
        "1": card("1", { full: phTask(1) }),
        "2": card("2", { full: phTask(2) }),
        "3": card("3", { full: phTask(3) }),
      },
    } as never);
    graphicApiPost.mockResolvedValue({
      created: [{ ph_backend_id: "1", task_id: 11, package_id: 5 }],
      updated: [
        {
          ph_backend_id: "2",
          task_id: 12,
          package_id: 5,
          moved_from: { id: 7, name: "Тест синки" },
        },
      ],
      skipped: [],
      errors: [{ ph_backend_id: "3", detail: "Неизвестный приоритет" }],
      warnings: [{ ph_backend_id: "1", detail: "Предшественник не найден в графике: 9" }],
      package: { id: 5, name: "Осень" },
    });

    const result = await sendTasksToPackage({
      taskIds: ["1", "2", "3"],
      projectCode: "p1",
      target: { packageId: 5 },
      mode: "update",
    });

    expect(result.rows).toEqual([
      expect.objectContaining({
        id: "1",
        state: "created",
        warning: true,
        detail: "Предшественник не найден в графике: 9",
      }),
      expect.objectContaining({
        id: "2",
        state: "updated",
        moved: true,
        place: "Перенесено из пакета «Тест синки»",
      }),
      expect.objectContaining({ id: "3", state: "error", detail: "Неизвестный приоритет" }),
    ]);
    expect(countRows(result.rows)).toMatchObject({ warnings: 1, moved: 1, errors: 1 });
  });

  it("задача не загрузилась из админки — остальные всё равно уходят", async () => {
    useChainsStore.setState({ canvas: {} } as never);
    fetchTask.mockImplementation((_d: string, id: string) =>
      id === "1" ? Promise.reject(new Error("404")) : Promise.resolve(phTask(id)),
    );
    graphicApiPost.mockImplementation(createdAll());

    const result = await sendTasksToPackage({
      taskIds: ["1", "2"],
      projectCode: "p1",
      target: { packageId: 5 },
      mode: "update",
    });

    expect(result.rows[0]).toMatchObject({
      state: "error",
      detail: "Не загрузилась из админки: 404",
    });
    expect(importCalls()[0]!.tasks).toHaveLength(1);
  });

  it("новый пакет создаётся черновиком в выбранном проекте", async () => {
    graphicApiPost.mockImplementation((path: string, body: unknown) =>
      path.endsWith("/packages")
        ? Promise.resolve({ id: 8, name: "Сезон 8" })
        : createdAll(8, "Сезон 8")(path, body as ImportBody),
    );
    const stages: string[] = [];

    await sendTasksToPackage({
      taskIds: ["1"],
      projectCode: "p1",
      target: { create: { name: " Сезон 8 ", kind: "seasonal", available_from: "2026-11-01" } },
      mode: "skip",
      onProgress: ({ stage }) => {
        if (stages.at(-1) !== stage) stages.push(stage);
      },
    });

    expect(graphicApiPost.mock.calls[0]).toEqual([
      "/api/promohub-planner/packages",
      {
        name: "Сезон 8",
        kind: "seasonal",
        available_from: "2026-11-01",
        project_code: "p1",
        status: "draft",
      },
    ]);
    expect(graphicApiPost.mock.calls[1]![0]).toBe("/api/promohub-planner/packages/8/import");
    expect(stages).toEqual(["load", "package", "import"]);
  });

  it("прогресс показывает путь каждой задачи", async () => {
    useChainsStore.setState({ canvas: {} } as never);
    graphicApiPost.mockImplementation(createdAll());
    const seen = new Set<string>();

    await sendTasksToPackage({
      taskIds: ["1", "2"],
      projectCode: "p1",
      target: { packageId: 5 },
      mode: "update",
      onProgress: ({ rows }) => rows.forEach((r) => seen.add(`${r.id}:${r.state}`)),
    });

    expect([...seen]).toEqual(
      expect.arrayContaining(["1:loading", "1:ready", "1:sending", "1:created", "2:created"]),
    );
  });

  it("одни черновики — ошибка без запросов в граф", async () => {
    await expect(
      sendTasksToPackage({
        taskIds: ["local_9"],
        projectCode: "p1",
        target: { packageId: 5 },
        mode: "update",
      }),
    ).rejects.toThrow(/черновики/);
    expect(graphicApiPost).not.toHaveBeenCalled();
  });
});

describe("loadProjectPackages", () => {
  it("фильтрует архивные пакеты", async () => {
    graphicApiGet.mockResolvedValue({
      packages: [
        { id: 1, status: "draft" },
        { id: 2, status: "archived" },
      ],
    });
    expect((await loadProjectPackages("p1")).map((p) => p.id)).toEqual([1]);
    expect(graphicApiGet).toHaveBeenCalledWith("/api/promohub-planner/packages", {
      project_code: "p1",
    });
  });
});

describe("sendPercent", () => {
  it("загрузка — треть пути, итог — 100", () => {
    const row = (state: string) => ({ id: state, name: state, state }) as never;
    expect(sendPercent([])).toBe(0);
    expect(sendPercent([row("queued"), row("queued")])).toBe(0);
    expect(sendPercent([row("ready"), row("ready")])).toBe(35);
    expect(sendPercent([row("created"), row("error")])).toBe(100);
  });
});
