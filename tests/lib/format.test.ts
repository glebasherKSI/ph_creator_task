import { describe, expect, it } from "vitest";

import {
  datetimeLocalToIso,
  escapeHtml,
  formatCardDate,
  formatCardDateTime,
  formatDecimalForApi,
  formatDecimalForUi,
  isoToDatetimeLocal,
  parseDecimalFromUi,
} from "@/lib/format";
import { hostFromRequest, normalizeDomain, normalizeDomainOrEmpty } from "@/lib/domains";

import * as legacyFormat from "legacy/format.js";

const ISO = "2026-10-01T15:39:11.000Z";

describe("format — паритет со старой реализацией", () => {
  it.each([ISO, "2026-10-31T15:39:15.000Z", "", null, "not a date"])(
    "isoToDatetimeLocal(%s)",
    (value) => {
      expect(isoToDatetimeLocal(value)).toBe(legacyFormat.isoToDatetimeLocal(value));
    },
  );

  it.each(["2026-10-01T15:39", "2026-10-01T15:39:11", "", "  "])(
    "datetimeLocalToIso(%s)",
    (value) => {
      expect(datetimeLocalToIso(value)).toBe(legacyFormat.datetimeLocalToIso(value));
    },
  );

  it.each([ISO, "", null, "x"])("formatCardDate(%s)", (value) => {
    expect(formatCardDate(value)).toBe(legacyFormat.formatCardDate(value));
  });

  it.each([1.5, "1,5", "1.5", "", null, "abc", 0])("decimal helpers(%s)", (value) => {
    expect(parseDecimalFromUi(value)).toBe(legacyFormat.parseDecimalFromUi(value));
    expect(formatDecimalForUi(value)).toBe(legacyFormat.formatDecimalForUi(value));
    expect(formatDecimalForApi(value)).toBe(legacyFormat.formatDecimalForApi(value));
  });

  it("escapeHtml", () => {
    expect(escapeHtml(`<a href="x">&</a>`)).toBe(legacyFormat.escapeHtml(`<a href="x">&</a>`));
  });
});

describe("format — новое", () => {
  it("formatCardDateTime: полная дата с годом и временем в UTC", () => {
    expect(formatCardDateTime(ISO)).toBe("01.10.2026 15:39");
    expect(formatCardDateTime(null)).toBeNull();
    expect(formatCardDateTime("bad")).toBeNull();
  });

  it("datetimeLocalToIso бросает на мусоре", () => {
    expect(() => datetimeLocalToIso("31.10.2026")).toThrow();
  });
});

describe("domains", () => {
  it.each([
    ["admin.example.com", "admin.example.com"],
    ["https://Admin.Example.com/path", "admin.example.com"],
    ["admin.example.com:8443/x", "admin.example.com"],
    ["http://insecure.example.com", null],
    ["", null],
    ["not a host!", null],
  ])("normalizeDomain(%s) → %s", (input, expected) => {
    expect(normalizeDomain(input)).toBe(expected);
    expect(normalizeDomainOrEmpty(input)).toBe(expected ?? "");
  });

  it("hostFromRequest", () => {
    expect(hostFromRequest({ host: "https://a.example.com" })).toBe("a.example.com");
    expect(hostFromRequest({ url: "https://b.example.com/api" })).toBe("b.example.com");
    expect(hostFromRequest({})).toBe("");
  });
});
