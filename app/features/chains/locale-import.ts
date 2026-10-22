/**
 * Импорт названий задач по языкам из .xlsx, сопоставление с канвой по front_id.
 * Формат файла: одна таблица со строкой заголовков — среди них ищем столбец front_id
 * (по названию, см. isFrontIdHeader) и столбцы-локали (короткие буквенные коды, напр.
 * RU/EN/DE — см. isLocaleHeaderCode). Остальные столбцы (название, описание, ставка и т.п.)
 * игнорируются. Лист без столбца front_id или без ни одной локали пропускается целиком.
 */
import type { XlsxSheet } from "@/lib/xlsx-lite";

import type { CanvasTask } from "./graph";

/** Ключ для регистронезависимого сравнения front_id (на канве и в файле регистр может отличаться). */
export function normalizeFrontIdKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

/** Заголовок столбца похож на короткий код локали — "RU", "EN", "pt" и т.п. (2-3 латинские буквы). */
export function isLocaleHeaderCode(header: unknown): boolean {
  return /^[a-z]{2,3}$/i.test(String(header ?? "").trim());
}

/** Заголовок столбца похож на front_id — "Front ID", "front_id", "FrontID", "frontend_identifier". */
export function isFrontIdHeader(header: unknown): boolean {
  const normalized = String(header ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_.-]+/g, "");
  return normalized.includes("frontid") || normalized.includes("frontendid");
}

export interface FrontIdLocaleEntry {
  /** Исходное написание front_id из файла (для сообщений в логе) — ключ в карте нормализован. */
  frontId: string;
  locales: Map<string, string>;
}

export interface LocaleUpdatesFromSheets {
  byFrontId: Map<string, FrontIdLocaleEntry>;
  totalRows: number;
  skippedEmptyRows: number;
}

/**
 * Разбирает листы .xlsx в карту front_id → (код локали → название) по заголовкам столбцов:
 * первая строка каждого листа — заголовки.
 */
export function buildLocaleUpdatesFromSheets(sheets: XlsxSheet[]): LocaleUpdatesFromSheets {
  const byFrontId = new Map<string, FrontIdLocaleEntry>();
  let totalRows = 0;
  let skippedEmptyRows = 0;

  for (const sheet of sheets) {
    const rows = sheet.rows ?? [];
    if (!rows.length) continue;

    const headerRow = rows[0] ?? [];
    let frontIdCol = -1;
    const localeCols: { col: number; code: string }[] = [];

    headerRow.forEach((header, col) => {
      const text = String(header ?? "").trim();
      if (!text) return;
      if (frontIdCol < 0 && isFrontIdHeader(text)) {
        frontIdCol = col;
        return;
      }
      if (isLocaleHeaderCode(text)) {
        localeCols.push({ col, code: text.toLowerCase() });
      }
    });

    if (frontIdCol < 0 || !localeCols.length) continue;

    for (let r = 1; r < rows.length; r += 1) {
      const row = rows[r] ?? [];
      const frontId = String(row[frontIdCol] ?? "").trim();
      if (!frontId) continue;
      const key = normalizeFrontIdKey(frontId);

      for (const { col, code } of localeCols) {
        const name = String(row[col] ?? "").trim();
        totalRows += 1;
        if (!name) {
          skippedEmptyRows += 1;
          continue;
        }
        if (!byFrontId.has(key)) byFrontId.set(key, { frontId, locales: new Map() });
        byFrontId.get(key)!.locales.set(code, name);
      }
    }
  }

  return { byFrontId, totalRows, skippedEmptyRows };
}

/** normalizeFrontIdKey(frontend_identifier) → множество id задач на канве с таким front_id (обычно одно). */
export function buildCanvasFrontIdIndex(
  canvas: Record<string, CanvasTask>,
): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const task of Object.values(canvas)) {
    const frontId = String(task.frontend_identifier ?? "").trim();
    if (!frontId) continue;
    const key = normalizeFrontIdKey(frontId);
    if (!index.has(key)) index.set(key, new Set());
    index.get(key)!.add(task.id);
  }
  return index;
}

export interface LocaleImportMissingEntry {
  taskId: string;
  frontId: string;
  name: string;
}

export interface LocaleImportMatch {
  /** taskId на канве → (код локали → название). */
  matchedTasks: Map<string, Record<string, string>>;
  /** front_id из файла, для которых на канве нет карточки. */
  notFound: string[];
  /** front_id из файла, которым на канве соответствует несколько карточек. */
  ambiguous: string[];
  /** Карточки на канве, для которых в файле не нашлось строки по front_id. */
  missingFromFile: LocaleImportMissingEntry[];
  localeCodesUsed: string[];
  skippedEmptyRows: number;
}

/** Сопоставляет листы .xlsx (по front_id, регистронезависимо) с задачами на канве. */
export function matchLocaleImport(
  sheets: XlsxSheet[],
  canvas: Record<string, CanvasTask>,
): LocaleImportMatch {
  const { byFrontId, skippedEmptyRows } = buildLocaleUpdatesFromSheets(sheets);
  const canvasIndex = buildCanvasFrontIdIndex(canvas);

  const matchedTasks = new Map<string, Record<string, string>>();
  const notFound: string[] = [];
  const ambiguous: string[] = [];

  for (const [key, entry] of byFrontId.entries()) {
    const candidates = canvasIndex.get(key);
    if (!candidates || !candidates.size) {
      notFound.push(entry.frontId);
      continue;
    }
    if (candidates.size > 1) {
      ambiguous.push(entry.frontId);
      continue;
    }
    const taskId = [...candidates][0]!;
    const existing = matchedTasks.get(taskId) ?? {};
    matchedTasks.set(taskId, { ...existing, ...Object.fromEntries(entry.locales) });
  }

  const localeCodesUsed = [
    ...new Set([...byFrontId.values()].flatMap((entry) => [...entry.locales.keys()])),
  ].sort();

  // Карточки на канве, для которых в файле не нашлось ни одной строки (по front_id,
  // регистронезависимо) — их язык импорт не тронул.
  const missingFromFile: LocaleImportMissingEntry[] = [];
  for (const task of Object.values(canvas)) {
    const frontId = String(task.frontend_identifier ?? "").trim();
    if (frontId && byFrontId.has(normalizeFrontIdKey(frontId))) continue;
    missingFromFile.push({ taskId: task.id, frontId, name: task.name || "" });
  }

  return { matchedTasks, notFound, ambiguous, missingFromFile, localeCodesUsed, skippedEmptyRows };
}
