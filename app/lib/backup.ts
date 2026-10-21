/**
 * Экспорт/импорт всего chrome.storage.local в JSON-файл — перенос данных
 * (домены, сессии, шаблоны канвы, раскладки) между установками расширения с разным ID.
 */
import { browser } from "wxt/browser";

export const BACKUP_FORMAT = "ph-creator-task-backup";
export const BACKUP_VERSION = 1;

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt?: string;
  extensionVersion?: string;
  data: Record<string, unknown>;
}

function backupFileName(now = new Date()): string {
  const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `ph-creator-task-backup-${stamp}.json`;
}

export async function buildBackup(): Promise<BackupFile> {
  const data = await browser.storage.local.get(null);
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    extensionVersion: browser.runtime.getManifest().version,
    data: data as Record<string, unknown>,
  };
}

/** Скачивает JSON со всем содержимым chrome.storage.local; возвращает число ключей. */
export async function exportStorageToFile(): Promise<number> {
  const payload = await buildBackup();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = backupFileName();
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return Object.keys(payload.data).length;
}

/** Разбирает файл резервной копии. Бросает ошибку, если формат не наш. */
export function parseBackupText(text: string): BackupFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Файл не является корректным JSON");
  }
  const record = parsed as Partial<BackupFile> | null;
  if (!record || typeof record !== "object" || record.format !== BACKUP_FORMAT) {
    throw new Error("Это не файл резервной копии расширения");
  }
  if (!record.data || typeof record.data !== "object" || Array.isArray(record.data)) {
    throw new Error("В файле нет данных для импорта");
  }
  return record as BackupFile;
}

/** Записывает данные в chrome.storage.local: совпадающие ключи перезаписываются, остальные остаются. */
export async function importStorageFromBackup(backup: BackupFile): Promise<number> {
  await browser.storage.local.set(backup.data);
  return Object.keys(backup.data).length;
}

/** Открывает диалог выбора файла и возвращает его текст (null — если отменили). */
export function pickBackupFile(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      file.text().then(resolve, () => resolve(null));
    });
    input.click();
  });
}
