import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import { createMessageRouter, isRuntimeMessage, sendMessage } from "@/lib/messaging";
import {
  type ReportsPageFetcher,
  collectReportsPages,
  reportsErrorResponse,
} from "@/lib/reports-fetch";

type TestMap = {
  ECHO: { payload: { text: string }; response: { ok: true; text: string } };
  BOOM: { payload: undefined; response: { ok: true } };
};

const sender = {} as Parameters<ReturnType<typeof createMessageRouter>>[1];

function dispatch(listener: ReturnType<typeof createMessageRouter>, message: unknown) {
  return new Promise<{ kept: true | undefined; response: unknown }>((resolve) => {
    const kept = listener(message, sender, (response) => resolve({ kept: true, response }));
    if (!kept) resolve({ kept, response: undefined });
  });
}

describe("createMessageRouter", () => {
  const router = createMessageRouter<TestMap>(
    {
      ECHO: async (payload) => ({ ok: true, text: payload.text }),
      BOOM: async () => {
        throw new Error("AUTH_TAB_REQUIRED");
      },
    },
    (action, err) => ({ ok: false, action, error: (err as Error).message }),
  );

  it("вызывает обработчик и удерживает канал (true)", async () => {
    const { kept, response } = await dispatch(router, { action: "ECHO", payload: { text: "x" } });
    expect(kept).toBe(true);
    expect(response).toEqual({ ok: true, text: "x" });
  });

  it("ошибка обработчика → mapError", async () => {
    const { response } = await dispatch(router, { action: "BOOM" });
    expect(response).toEqual({ ok: false, action: "BOOM", error: "AUTH_TAB_REQUIRED" });
  });

  it("неизвестное действие и не-сообщения игнорируются", async () => {
    expect((await dispatch(router, { action: "NOPE" })).kept).toBeUndefined();
    expect((await dispatch(router, "junk")).kept).toBeUndefined();
    expect(isRuntimeMessage({ action: 1 })).toBe(false);
  });
});

describe("sendMessage", () => {
  beforeEach(() => fakeBrowser.reset());

  it("доставляет сообщение в onMessage и возвращает ответ", async () => {
    fakeBrowser.runtime.onMessage.addListener(
      createMessageRouter<TestMap>({ ECHO: async (p) => ({ ok: true, text: p.text }) }),
    );
    const response = await sendMessage("PH_AUTH_STATUS" as unknown as "PH_AUTH_STATUS", {
      domain: "x",
    });
    // Обработчика PH_AUTH_STATUS нет — fake-browser отдаёт undefined, таймаута нет.
    expect(response).toBeUndefined();
  });

  it("таймаут", async () => {
    fakeBrowser.runtime.onMessage.addListener(() => true); // никто не отвечает
    await expect(
      sendMessage("PH_AUTH_LOGOUT", { domain: "x" }, { timeoutMs: 20, timeoutMessage: "T" }),
    ).rejects.toThrow("T");
  });
});

describe("collectReportsPages", () => {
  it("собирает страницы до countAll и объединяет rows", async () => {
    const pages = [
      { ok: true, data: { rows: [1, 2], countAll: "3" } },
      { ok: true, data: { rows: [3], countAll: 3 } },
    ];
    const fetchPage = vi.fn<ReportsPageFetcher>(async () => pages.shift());
    const result = await collectReportsPages({ perPage: 2, project_id: "13" }, fetchPage);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage.mock.calls[0]?.[0]).toMatchObject({ currentPage: 1, perPage: 2 });
    expect(result.data).toEqual({ rows: [1, 2, 3], countAll: 3 });
  });

  it("останавливается на неполной странице; без countAll берёт длину", async () => {
    const fetchPage = vi.fn<ReportsPageFetcher>(async () => ({ ok: true, data: { rows: [1] } }));
    const result = await collectReportsPages({}, fetchPage);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage.mock.calls[0]?.[0]).toMatchObject({ perPage: 500 });
    expect(result.data).toEqual({ rows: [1], countAll: 1 });
  });

  it("ошибки страницы: errorCode пробрасывается, остальное → SCRIPT_FAILED", async () => {
    await expect(
      collectReportsPages({}, async () => ({ ok: false, errorCode: "REPORTS_XSRF_MISSING" })),
    ).rejects.toThrow("REPORTS_XSRF_MISSING");
    await expect(collectReportsPages({}, async () => undefined)).rejects.toThrow(
      "REPORTS_SCRIPT_FAILED",
    );
    expect(reportsErrorResponse(new Error("REPORTS_TAB_REQUIRED"))).toEqual({
      ok: false,
      error: "REPORTS_TAB_REQUIRED",
      errorCode: "REPORTS_TAB_REQUIRED",
    });
  });
});
