/** Асинхронная обвязка импорта переводов: выбор файла, чтение .xlsx и сопоставление с канвой. */
import { readXlsxSheets } from "@/lib/xlsx-lite";

import type { CanvasTask } from "./graph";
import { matchLocaleImport, type LocaleImportMatch } from "./locale-import";

/** Открывает системный диалог выбора файла; null — если пользователь отменил выбор. */
export function pickXlsxFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null));
    input.click();
  });
}

/** Читает .xlsx и сопоставляет строки (front_id → название по локали) с задачами на канве. */
export async function readAndMatchLocaleImport(
  file: File,
  canvas: Record<string, CanvasTask>,
): Promise<LocaleImportMatch> {
  const sheets = await readXlsxSheets(await file.arrayBuffer());
  if (!sheets.length) throw new Error("В файле нет листов");

  const match = matchLocaleImport(sheets, canvas);
  if (!match.matchedTasks.size && !match.notFound.length && !match.ambiguous.length) {
    throw new Error(
      "В файле не найдено строк с front_id и названием — нужен столбец «Front ID» и хотя бы один столбец-локаль (RU, EN, DE...)",
    );
  }
  return match;
}
