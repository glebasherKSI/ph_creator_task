import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

const graphicApiPost = vi.fn();
vi.mock("@/lib/graphic-api", () => ({
  graphicApiPost: (...args: unknown[]) => graphicApiPost(...args),
}));
vi.mock("@/lib/storage", () => ({
  getGraphicProjectForDomain: async (domain: string) => (domain === "admin.a" ? "p1" : ""),
}));

import { logTaskEvent } from "@/lib/task-events";

beforeEach(() => {
  graphicApiPost.mockReset();
  // fake-browser не реализует getManifest.
  vi.spyOn(fakeBrowser.runtime, "getManifest").mockReturnValue({
    manifest_version: 3,
    name: "test",
    version: "3.0.0",
  });
});

describe("logTaskEvent", () => {
  it("sends the event with the domain's Graphic project and extension version", async () => {
    graphicApiPost.mockResolvedValue({ id: 1 });
    await logTaskEvent({
      event: "created",
      source: "package",
      domain: "admin.a",
      ph_backend_id: 55,
      planner_task_id: 12,
    });
    const [path, body] = graphicApiPost.mock.calls[0]!;
    expect(path).toBe("/api/promohub-planner/task-events");
    expect(body).toMatchObject({
      event: "created",
      source: "package",
      ph_backend_id: 55,
      planner_task_id: 12,
      project_code: "p1",
    });
    expect(body.client_version).toBe("3.0.0");
  });

  it("never throws when Graphic is unavailable", async () => {
    graphicApiPost.mockRejectedValue(new Error("Нет входа в Promo Graphic"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      logTaskEvent({
        event: "create_failed",
        source: "draft",
        domain: "admin.b",
        error: "HTTP 422",
      }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
