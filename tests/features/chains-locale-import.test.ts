import { describe, expect, it } from "vitest";

import type { CanvasTask } from "@/features/chains/graph";
import {
  buildCanvasFrontIdIndex,
  buildLocaleUpdatesFromSheets,
  isFrontIdHeader,
  isLocaleHeaderCode,
  matchLocaleImport,
  normalizeFrontIdKey,
} from "@/features/chains/locale-import";
import type { XlsxSheet } from "@/lib/xlsx-lite";

function task(id: string, frontendIdentifier: string, name = `Задача ${id}`): CanvasTask {
  return {
    id,
    name,
    frontend_identifier: frontendIdentifier,
    conditions: [],
    full: null,
    x: 0,
    y: 0,
  };
}

describe("normalizeFrontIdKey / isLocaleHeaderCode / isFrontIdHeader", () => {
  it("нормализует front_id регистронезависимо и обрезает пробелы", () => {
    expect(normalizeFrontIdKey("  Task_Alpha  ")).toBe("task_alpha");
    expect(normalizeFrontIdKey(null)).toBe("");
  });

  it("распознаёт 2-3-буквенные коды локалей, но не более длинные слова", () => {
    expect(isLocaleHeaderCode("RU")).toBe(true);
    expect(isLocaleHeaderCode("en")).toBe(true);
    expect(isLocaleHeaderCode("Pol")).toBe(true);
    expect(isLocaleHeaderCode("Name")).toBe(false);
    expect(isLocaleHeaderCode("")).toBe(false);
  });

  it("распознаёт заголовок front_id в разных написаниях", () => {
    expect(isFrontIdHeader("Front ID")).toBe(true);
    expect(isFrontIdHeader("front_id")).toBe(true);
    expect(isFrontIdHeader("FrontID")).toBe(true);
    expect(isFrontIdHeader("frontend_identifier")).toBe(true);
    expect(isFrontIdHeader("Название")).toBe(false);
  });
});

describe("buildLocaleUpdatesFromSheets", () => {
  it("находит front_id и столбцы-локали по заголовкам, игнорируя остальные столбцы", () => {
    const sheets: XlsxSheet[] = [
      {
        name: "Sheet1",
        rows: [
          ["Название", "Front ID", "RU", "EN", "Ставка"],
          ["Альфа", "task_alpha", "Альфа RU", "Alpha EN", "100"],
          ["Бета", "task_beta", "Бета RU", "", "200"],
        ],
      },
    ];
    const { byFrontId, totalRows, skippedEmptyRows } = buildLocaleUpdatesFromSheets(sheets);

    expect([...byFrontId.keys()]).toEqual(["task_alpha", "task_beta"]);
    expect([...byFrontId.get("task_alpha")!.locales.entries()]).toEqual([
      ["ru", "Альфа RU"],
      ["en", "Alpha EN"],
    ]);
    // "Бета" EN-ячейка пустая — локаль не попадает в карту, но считается пропущенной.
    expect([...byFrontId.get("task_beta")!.locales.entries()]).toEqual([["ru", "Бета RU"]]);
    expect(totalRows).toBe(4);
    expect(skippedEmptyRows).toBe(1);
  });

  it("пропускает лист без столбца front_id или без ни одной локали", () => {
    const noFrontId: XlsxSheet = {
      name: "NoFrontId",
      rows: [
        ["RU", "EN"],
        ["x", "y"],
      ],
    };
    const noLocales: XlsxSheet = {
      name: "NoLocales",
      rows: [
        ["Front ID", "Название"],
        ["task_alpha", "Альфа"],
      ],
    };
    const { byFrontId } = buildLocaleUpdatesFromSheets([noFrontId, noLocales]);
    expect(byFrontId.size).toBe(0);
  });

  it("объединяет несколько листов с одним front_id (регистронезависимо) в одну запись", () => {
    const sheets: XlsxSheet[] = [
      {
        name: "RU-EN",
        rows: [
          ["Front ID", "RU", "EN"],
          ["Task_Alpha", "Альфа RU", "Alpha EN"],
        ],
      },
      {
        name: "DE",
        rows: [
          ["Front ID", "DE"],
          ["task_alpha", "Alpha DE"],
        ],
      },
    ];
    const { byFrontId } = buildLocaleUpdatesFromSheets(sheets);
    expect(byFrontId.size).toBe(1);
    const entry = byFrontId.get("task_alpha")!;
    expect(entry.frontId).toBe("Task_Alpha"); // первое встреченное написание
    expect(Object.fromEntries(entry.locales)).toEqual({
      ru: "Альфа RU",
      en: "Alpha EN",
      de: "Alpha DE",
    });
  });

  it("строки без front_id пропускаются", () => {
    const sheets: XlsxSheet[] = [
      {
        name: "Sheet1",
        rows: [
          ["Front ID", "RU"],
          ["", "без front_id"],
          ["task_alpha", "Альфа RU"],
        ],
      },
    ];
    const { byFrontId } = buildLocaleUpdatesFromSheets(sheets);
    expect([...byFrontId.keys()]).toEqual(["task_alpha"]);
  });
});

describe("buildCanvasFrontIdIndex", () => {
  it("индексирует задачи канвы по нормализованному front_id, дубликаты — в один Set", () => {
    const canvas: Record<string, CanvasTask> = {
      "1": task("1", "Task_Alpha"),
      "2": task("2", "task_alpha"),
      "3": task("3", "task_beta"),
      "4": task("4", ""),
    };
    const index = buildCanvasFrontIdIndex(canvas);
    expect(index.get("task_alpha")).toEqual(new Set(["1", "2"]));
    expect(index.get("task_beta")).toEqual(new Set(["3"]));
    expect(index.has("")).toBe(false);
  });
});

describe("matchLocaleImport", () => {
  const sheets: XlsxSheet[] = [
    {
      name: "Sheet1",
      rows: [
        ["Front ID", "RU", "EN"],
        ["task_alpha", "Альфа RU", "Alpha EN"],
        ["task_missing", "Пропавшая", ""],
        ["task_dup", "Дубль RU", ""],
      ],
    },
  ];

  it("сопоставляет по front_id регистронезависимо и собирает коды локалей", () => {
    const canvas: Record<string, CanvasTask> = {
      "1": task("1", "TASK_ALPHA"),
      "2": task("2", "task_beta"),
    };
    const result = matchLocaleImport(sheets, canvas);

    expect(Object.fromEntries(result.matchedTasks)).toEqual({
      "1": { ru: "Альфа RU", en: "Alpha EN" },
    });
    expect(result.notFound).toEqual(["task_missing", "task_dup"]);
    expect(result.ambiguous).toEqual([]);
    expect(result.localeCodesUsed).toEqual(["en", "ru"]);
    // Задача #2 (task_beta) не встречается в файле.
    expect(result.missingFromFile).toEqual([
      { taskId: "2", frontId: "task_beta", name: "Задача 2" },
    ]);
  });

  it("несколько задач канвы с одним front_id — неоднозначно, не применяется", () => {
    const canvas: Record<string, CanvasTask> = {
      "1": task("1", "task_dup"),
      "2": task("2", "task_dup"),
    };
    const result = matchLocaleImport(sheets, canvas);
    expect(result.matchedTasks.size).toBe(0);
    expect(result.ambiguous).toContain("task_dup");
  });

  it("задача без front_id считается отсутствующей в файле, а не ошибкой", () => {
    const canvas: Record<string, CanvasTask> = { "1": task("1", "") };
    const result = matchLocaleImport(sheets, canvas);
    expect(result.missingFromFile).toEqual([{ taskId: "1", frontId: "", name: "Задача 1" }]);
  });
});
