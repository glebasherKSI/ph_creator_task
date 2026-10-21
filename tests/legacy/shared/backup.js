/**
 * Экспорт/импорт всего chrome.storage.local в JSON-файл.
 * Нужен для переноса данных (домены, сессии, шаблоны канвы, раскладки)
 * между установками расширения с разным ID.
 */

export const BACKUP_FORMAT = "ph-creator-task-backup";
export const BACKUP_VERSION = 1;

function backupFileName() {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `ph-creator-task-backup-${stamp}.json`;
}

/** Скачивает JSON со всем содержимым chrome.storage.local. */
export async function exportStorageToFile() {
  const data = await chrome.storage.local.get(null);
  const payload = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    extensionVersion: chrome.runtime.getManifest().version,
    data,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = backupFileName();
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return Object.keys(data).length;
}

/**
 * Разбирает файл резервной копии. Бросает ошибку, если формат не наш.
 * @param {string} text
 * @returns {{ data: Record<string, unknown>, exportedAt?: string, extensionVersion?: string }}
 */
export function parseBackupText(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Файл не является корректным JSON");
  }
  if (!parsed || typeof parsed !== "object" || parsed.format !== BACKUP_FORMAT) {
    throw new Error("Это не файл резервной копии расширения");
  }
  if (!parsed.data || typeof parsed.data !== "object" || Array.isArray(parsed.data)) {
    throw new Error("В файле нет данных для импорта");
  }
  return parsed;
}

/**
 * Записывает данные из резервной копии в chrome.storage.local.
 * Существующие ключи перезаписываются, остальные остаются.
 * @param {{ data: Record<string, unknown> }} backup
 */
export async function importStorageFromBackup(backup) {
  await chrome.storage.local.set(backup.data);
  return Object.keys(backup.data).length;
}

/** Открывает диалог выбора файла и возвращает его текст (null — если отменили). */
export function pickBackupFile() {
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
