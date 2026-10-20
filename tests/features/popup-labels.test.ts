import { describe, expect, it } from "vitest";

import {
  domainAuthTone,
  formatAuthLabel,
  formatAuthTitle,
  graphicHostLabel,
  graphicUserLabel,
  isGraphicConnectivityError,
} from "@/features/popup/labels";

describe("popup labels", () => {
  it("статус входа в админку", () => {
    expect(formatAuthLabel({ authenticated: true })).toBe("вход");
    expect(formatAuthLabel({ pendingOtp: true })).toBe("otp");
    expect(formatAuthLabel({ awaitingMagicLink: true })).toBe("link");
    expect(formatAuthLabel(undefined)).toBe("нет");

    expect(formatAuthTitle({ authenticated: true, email: "a@b" })).toBe("Вход выполнен (a@b)");
    expect(formatAuthTitle({ authenticated: true })).toBe("Вход выполнен");
    expect(formatAuthTitle({ pendingOtp: true })).toMatch(/OTP/);
    expect(formatAuthTitle({})).toBe("Вход не выполнен");

    expect(domainAuthTone({ authenticated: true })).toBe("ok");
    expect(domainAuthTone({ awaitingMagicLink: true })).toBe("pending");
    expect(domainAuthTone(undefined)).toBe("none");
  });

  it("подписи Graphic", () => {
    expect(graphicUserLabel({ username: " gleb " })).toBe("gleb");
    expect(graphicUserLabel({ email: "g@x" })).toBe("g@x");
    expect(graphicUserLabel(null)).toBe("");
    expect(graphicHostLabel("http://127.0.0.1:8000")).toBe("127.0.0.1:8000");
    expect(graphicHostLabel("not a url")).toBe("not a url");
    expect(isGraphicConnectivityError("Failed to fetch")).toBe(true);
    expect(isGraphicConnectivityError("HTTP 401")).toBe(false);
  });
});
