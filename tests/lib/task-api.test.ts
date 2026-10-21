import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import { createTask, fetchTasksPage, updateTask } from "@/lib/task-api";
import { createMessageRouter, type MessageMap } from "@/lib/messaging";

import taskInteractive from "../fixtures/har/task-interactive-1454.json";
import taskSequence from "../fixtures/har/task-sequence-1456.json";

const DOMAIN = "admin.example.com";

/** Эмулирует background: статус авторизации + admin API по path. */
function installBackground(handler: (path: string, method: string, body: unknown) => unknown) {
  const calls: Array<{ path: string; method: string; body: unknown }> = [];
  fakeBrowser.runtime.onMessage.addListener(
    createMessageRouter<MessageMap>({
      PH_AUTH_STATUS: async () => ({
        ok: true,
        domain: DOMAIN,
        authenticated: true,
        pendingOtp: false,
        awaitingMagicLink: false,
        email: null,
      }),
      PH_ADMIN_API_FETCH: async (payload) => {
        const method = payload.method || "GET";
        calls.push({ path: payload.path, method, body: payload.body });
        const data = handler(payload.path, method, payload.body);
        return { ok: true, status: 200, data, headers: {} };
      },
    }),
  );
  return calls;
}

beforeEach(() => fakeBrowser.reset());

describe("task-api", () => {
  it("fetchTasksPage: скрывает задачи не active/draft и считает hasMore", async () => {
    installBackground(() => ({
      gamification_tasks: [taskInteractive, { ...taskSequence, state: "archived" }],
    }));
    const page = await fetchTasksPage(DOMAIN, 0, 2);
    expect(page.tasks.map((t) => t.id)).toEqual([1454]);
    expect(page.hidden).toBe(1);
    expect(page.rawCount).toBe(2);
    expect(page.hasMore).toBe(true);
  });

  it("fetchTasksPage: has_next_page и count из pagination", async () => {
    installBackground(() => ({
      gamification_tasks: [taskInteractive, taskSequence],
      pagination: { limit: 2, offset: 0, count: 1456, has_next_page: false },
    }));
    const page = await fetchTasksPage(DOMAIN, 0, 2);
    expect(page.hasMore).toBe(false);
    expect(page.total).toBe(1456);
  });

  it("createTask: ответ 200 без тела → id ищется по списку, задача дочитывается", async () => {
    const calls = installBackground((path, method) => {
      if (method === "POST") return 200;
      if (path.includes("limit=10")) return { gamification_tasks: [taskSequence] };
      return { gamification_task: taskSequence };
    });
    const result = await createTask(DOMAIN, {
      gamification_task: { name: "123213", frontend_identifier: "test_chains" },
    });
    expect(result.newId).toBe(1456);
    expect(result.task?.id).toBe(1456);
    expect(calls[0]).toMatchObject({
      method: "POST",
      path: "/admin/api/gamification/tasks?locale=ru",
    });
  });

  it("createTask: id в теле ответа — без поиска по списку", async () => {
    const calls = installBackground((_path, method) =>
      method === "POST"
        ? { gamification_task: taskInteractive }
        : { gamification_task: taskInteractive },
    );
    const result = await createTask(DOMAIN, { gamification_task: { name: "x" } });
    expect(result.newId).toBe(1454);
    expect(calls.some((c) => c.path.includes("limit=10"))).toBe(false);
  });

  it("updateTask: PATCH с id в теле", async () => {
    const calls = installBackground((_path, method) =>
      method === "PATCH"
        ? { gamification_task: taskInteractive }
        : { gamification_task: taskInteractive },
    );
    const result = await updateTask(DOMAIN, "1454", { gamification_task: { name: "edited" } });
    expect(calls[0]).toMatchObject({
      method: "PATCH",
      path: "/admin/api/gamification/tasks/1454?locale=ru",
      body: { gamification_task: { name: "edited", id: 1454 } },
    });
    expect(result.task?.id).toBe(1454);
  });
});
