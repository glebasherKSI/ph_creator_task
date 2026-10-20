import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import {
  adminApiUrl,
  extractMagicLinkToken,
  formatAuthFetchError,
  getStoredAuthSession,
  hasPendingOtpFlow,
  isPrivateAdminDomain,
  saveStoredAuthSession,
  setPendingOtpFlow,
  withTimeout,
} from "@/lib/auth";
import { MAX_CANVAS_TEMPLATES_PER_DOMAIN, STORAGE_KEYS } from "@/lib/constants";
import { parseTaskMeta } from "@/lib/meta";
import {
  type CanvasTemplate,
  deleteDomainCanvasTemplate,
  getDomainCanvasTemplates,
  loadChainsLayout,
  saveChainsLayout,
  upsertDomainCanvasTemplate,
} from "@/lib/storage";

const DOMAIN = "admin.example.com";

function template(id: string, name: string, updatedAt: string): CanvasTemplate {
  return {
    id,
    name,
    domain: DOMAIN,
    createdAt: updatedAt,
    updatedAt,
    canvas: {},
    edges: [],
    targetConfigs: {},
    labels: [],
    viewport: { x: 0, y: 0, scale: 1 },
  };
}

beforeEach(() => {
  fakeBrowser.reset();
});

describe("storage — шаблоны канвы", () => {
  it("upsert: по id обновляет, по имени перезаписывает, иначе добавляет; сортирует по updatedAt", async () => {
    await upsertDomainCanvasTemplate(DOMAIN, template("a", "Alpha", "2026-01-01T00:00:00Z"));
    await upsertDomainCanvasTemplate(DOMAIN, template("b", "Beta", "2026-02-01T00:00:00Z"));
    await upsertDomainCanvasTemplate(DOMAIN, template("c", "Alpha", "2026-03-01T00:00:00Z"));

    const list = await getDomainCanvasTemplates(DOMAIN);
    expect(list.map((t) => t.id)).toEqual(["c", "b"]);

    await upsertDomainCanvasTemplate(DOMAIN, template("b", "Beta 2", "2026-04-01T00:00:00Z"));
    expect((await getDomainCanvasTemplates(DOMAIN)).map((t) => t.name)).toEqual([
      "Beta 2",
      "Alpha",
    ]);
  });

  it("лимит шаблонов на домен", async () => {
    for (let i = 0; i < MAX_CANVAS_TEMPLATES_PER_DOMAIN; i += 1) {
      await upsertDomainCanvasTemplate(DOMAIN, template(`t${i}`, `T${i}`, "2026-01-01T00:00:00Z"));
    }
    await expect(
      upsertDomainCanvasTemplate(DOMAIN, template("over", "Over", "2026-01-01T00:00:00Z")),
    ).rejects.toThrow(/лимит/);
  });

  it("delete: удаляет домен из store, когда список пуст", async () => {
    await upsertDomainCanvasTemplate(DOMAIN, template("a", "A", "2026-01-01T00:00:00Z"));
    expect(await deleteDomainCanvasTemplate(DOMAIN, "missing")).toBe(false);
    expect(await deleteDomainCanvasTemplate(DOMAIN, "a")).toBe(true);
    const stored = await fakeBrowser.storage.local.get(STORAGE_KEYS.CANVAS_TEMPLATES);
    expect(stored[STORAGE_KEYS.CANVAS_TEMPLATES]).toEqual({});
  });

  it("формат хранения совместим со старым: store[domain] — массив шаблонов", async () => {
    await upsertDomainCanvasTemplate(DOMAIN, template("a", "A", "2026-01-01T00:00:00Z"));
    const stored = await fakeBrowser.storage.local.get(STORAGE_KEYS.CANVAS_TEMPLATES);
    const store = stored[STORAGE_KEYS.CANVAS_TEMPLATES] as Record<string, unknown[]>;
    expect(Array.isArray(store[DOMAIN])).toBe(true);
  });
});

describe("storage — раскладка", () => {
  it("roundtrip под ключом ph_chains_layout_<domain>", async () => {
    expect(await loadChainsLayout(DOMAIN)).toEqual({ positions: {} });
    await saveChainsLayout(DOMAIN, { "1": { x: 10, y: 20 } });
    const stored = await fakeBrowser.storage.local.get(`ph_chains_layout_${DOMAIN}`);
    expect(stored[`ph_chains_layout_${DOMAIN}`]).toEqual({ positions: { "1": { x: 10, y: 20 } } });
    expect((await loadChainsLayout(DOMAIN)).positions["1"]).toEqual({ x: 10, y: 20 });
  });
});

describe("auth — хранилище сессий и флаги", () => {
  it("saveStoredAuthSession не пишет без value и не дублирует одинаковые записи", async () => {
    await saveStoredAuthSession(DOMAIN, { email: "x@y" });
    expect(await getStoredAuthSession(DOMAIN)).toBeNull();

    await saveStoredAuthSession(DOMAIN, { value: "cookie", email: "x@y", verified: true });
    const first = await getStoredAuthSession(DOMAIN);
    expect(first?.value).toBe("cookie");

    await saveStoredAuthSession(DOMAIN, { value: "cookie", email: "x@y", verified: true });
    const second = await getStoredAuthSession(DOMAIN);
    expect(second?.updatedAt).toBe(first?.updatedAt);
  });

  it("pending OTP flag", async () => {
    expect(await hasPendingOtpFlow(DOMAIN)).toBe(false);
    await setPendingOtpFlow(DOMAIN);
    expect(await hasPendingOtpFlow(DOMAIN)).toBe(true);
  });
});

describe("auth — хелперы", () => {
  it("adminApiUrl добавляет locale и префикс", () => {
    expect(adminApiUrl(DOMAIN, "current_user")).toBe(
      "https://admin.example.com/admin/api/current_user?locale=ru",
    );
    expect(adminApiUrl(DOMAIN, "/admin/api/x?locale=en")).toBe(
      "https://admin.example.com/admin/api/x?locale=en",
    );
    expect(adminApiUrl("", "x")).toBe("");
  });

  it("extractMagicLinkToken", () => {
    expect(
      extractMagicLinkToken("https://admin.example.com/admin/-/auth/magic-login?token=abc%20"),
    ).toBe("abc");
    expect(extractMagicLinkToken("https://admin.example.com/admin/other?token=abc")).toBeNull();
    expect(extractMagicLinkToken("not a url")).toBeNull();
  });

  it("isPrivateAdminDomain", () => {
    expect(isPrivateAdminDomain("admin.crimson.lex.prd.maxbit.private")).toBe(true);
    expect(isPrivateAdminDomain(DOMAIN)).toBe(false);
  });

  it("formatAuthFetchError по коду и по тексту", () => {
    expect(formatAuthFetchError("AUTH_TAB_REQUIRED", DOMAIN)).toContain(
      "https://admin.example.com",
    );
    expect(formatAuthFetchError(new Error("net::ERR_CERT_AUTHORITY_INVALID"))).toMatch(/SSL/);
    expect(formatAuthFetchError("")).toBe("Не удалось выполнить запрос к админке.");
    expect(formatAuthFetchError("custom")).toBe("custom");
  });

  it("withTimeout", async () => {
    await expect(withTimeout(Promise.resolve(1), 50)).resolves.toBe(1);
    await expect(withTimeout(new Promise(() => {}), 10, "T")).rejects.toThrow("T");
  });
});

describe("meta", () => {
  it("parseTaskMeta: дефолты и нормализация", () => {
    const meta = parseTaskMeta({
      events: ["deposit", 1],
      filters: [{ id: 1, name: "f" }, null],
      bonuses: [{ id: "b", title: "B" }, { id: null }],
      priorities: ["1", "x"],
    });
    expect(meta.events).toEqual(["deposit", "1"]);
    expect(meta.filters).toEqual([{ id: 1, name: "f" }]);
    expect(meta.bonuses).toEqual([{ id: "b", title: "B" }]);
    expect(meta.priorities).toEqual([1]);
    expect(meta.types).toContain("sequence");
    expect(parseTaskMeta(null).priorities).toEqual([0, 1, 2, 3, 4]);
  });
});
