import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

const graphicApiPost = vi.fn();
vi.mock("@/lib/graphic-api", () => ({
  graphicApiPost: (...args: unknown[]) => graphicApiPost(...args),
}));
let project = "LEX";
vi.mock("@/lib/storage", () => ({
  getGraphicProjectForDomain: async () => project,
}));

import {
  diffGroups,
  GROUPS_RECHECK_MS,
  groupsHash,
  normalizeGroups,
  syncGraphicGroups,
} from "@/lib/graphic-groups";

const SAMPLE = [
  { id: "19", name: "REGISTRATION RBEZDEP" },
  { id: "2", name: "Staff" },
  { id: 1885, name: " Ёлка 🎄 VIP " },
];

beforeEach(() => {
  fakeBrowser.reset();
  graphicApiPost.mockReset();
  project = "LEX";
});

describe("normalizeGroups / groupsHash", () => {
  it("matches the backend hash vector", async () => {
    // Тот же вектор на бэке: tests/test_promohub_groups.py (promo-graphic-backend)
    expect(await groupsHash(normalizeGroups(SAMPLE))).toBe(
      "94e486c237e1e47b7414ef7bb16adc3dd07822f14b1f5bac2b0165a5df5b312d",
    );
    expect(await groupsHash(new Map())).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("drops invalid ids and cuts long names by code points", () => {
    const groups = normalizeGroups([
      { id: "", name: "empty" },
      { id: "a b", name: "space" },
      { id: "7", name: "🎄".repeat(300) },
    ]);
    expect([...groups.keys()]).toEqual(["7"]);
    expect(Array.from(groups.get("7")!)).toHaveLength(255);
  });

  it("diffs against the previous snapshot", () => {
    const next = normalizeGroups([
      { id: "1", name: "Same" },
      { id: "2", name: "Renamed" },
      { id: "4", name: "New" },
    ]);
    expect(diffGroups({ "1": "Same", "2": "Old", "3": "Gone" }, next)).toEqual({
      upsert: [
        { id: "2", name: "Renamed" },
        { id: "4", name: "New" },
      ],
      remove: ["3"],
    });
  });
});

describe("syncGraphicGroups", () => {
  it("probes first, sends the full list on conflict, then stays silent", async () => {
    graphicApiPost
      .mockResolvedValueOnce({ status: "conflict" })
      .mockResolvedValueOnce({ status: "applied" });
    await syncGraphicGroups("Admin.A", SAMPLE);

    const [path, probe] = graphicApiPost.mock.calls[0]!;
    expect(path).toBe("/api/promohub-planner/groups/sync");
    expect(probe).toEqual({
      domain: "admin.a",
      project_code: "LEX",
      hash: "94e486c237e1e47b7414ef7bb16adc3dd07822f14b1f5bac2b0165a5df5b312d",
    });
    const full = graphicApiPost.mock.calls[1]![1];
    expect(full.full).toBe(true);
    expect(full.upsert).toHaveLength(3);

    // тот же список и проект — без запросов
    await syncGraphicGroups("admin.a", SAMPLE);
    expect(graphicApiPost).toHaveBeenCalledTimes(2);
  });

  it("sends only the delta when the list changes", async () => {
    graphicApiPost.mockResolvedValue({ status: "applied" });
    await syncGraphicGroups("admin.a", SAMPLE);
    const baseHash = graphicApiPost.mock.calls[0]![1].hash;
    graphicApiPost.mockClear();

    await syncGraphicGroups("admin.a", [
      { id: "19", name: "REGISTRATION" },
      { id: 1885, name: "Ёлка 🎄 VIP" },
      { id: "8", name: "New" },
    ]);
    expect(graphicApiPost).toHaveBeenCalledTimes(1);
    const body = graphicApiPost.mock.calls[0]![1];
    expect(body.base_hash).toBe(baseHash);
    expect(body.upsert).toEqual([
      { id: "19", name: "REGISTRATION" },
      { id: "8", name: "New" },
    ]);
    expect(body.remove).toEqual(["2"]);
    expect(body.full).toBeUndefined();
  });

  it("re-checks when the project changes or the snapshot is old", async () => {
    graphicApiPost.mockResolvedValue({ status: "applied" });
    await syncGraphicGroups("admin.a", SAMPLE);
    graphicApiPost.mockClear();
    graphicApiPost.mockResolvedValue({ status: "unchanged" });

    project = "JET";
    await syncGraphicGroups("admin.a", SAMPLE);
    const body = graphicApiPost.mock.calls[0]![1];
    expect(body.project_code).toBe("JET");
    expect(body.upsert).toEqual([]);
    expect(body.remove).toEqual([]);

    const now = vi.spyOn(Date, "now").mockReturnValue(Date.now() + GROUPS_RECHECK_MS + 1);
    await syncGraphicGroups("admin.a", SAMPLE);
    expect(graphicApiPost).toHaveBeenCalledTimes(2);
    now.mockRestore();
  });

  it("never throws and keeps no snapshot when Graphic is unavailable", async () => {
    graphicApiPost.mockRejectedValue(new Error("Нет входа в Promo Graphic"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(syncGraphicGroups("admin.b", SAMPLE)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    expect(await fakeBrowser.storage.local.get(null)).toEqual({});
    warn.mockRestore();
  });

  it("joins a sync already running for the domain", async () => {
    graphicApiPost.mockResolvedValue({ status: "applied" });
    await Promise.all([syncGraphicGroups("admin.c", SAMPLE), syncGraphicGroups("admin.c", SAMPLE)]);
    expect(graphicApiPost).toHaveBeenCalledTimes(1);
  });
});
