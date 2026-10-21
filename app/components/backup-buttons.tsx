/** Экспорт / импорт данных расширения (домены, сессии, шаблоны, раскладки). */
import { Download, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  exportStorageToFile,
  importStorageFromBackup,
  parseBackupText,
  pickBackupFile,
} from "@/lib/backup";

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function exportBackup(): Promise<void> {
  try {
    const count = await exportStorageToFile();
    toast.success(`Экспортировано ключей: ${count}`);
  } catch (err) {
    toast.error(`Не удалось экспортировать данные: ${errorText(err)}`);
  }
}

export async function importBackup(): Promise<void> {
  const text = await pickBackupFile();
  if (text == null) return;
  try {
    const backup = parseBackupText(text);
    const when = backup.exportedAt
      ? ` от ${new Date(backup.exportedAt).toLocaleString("ru-RU")}`
      : "";
    const ok = window.confirm(
      `Импортировать резервную копию${when}?\n\nДанные с совпадающими ключами (домены, сессии, шаблоны, раскладки) будут перезаписаны. Страница перезагрузится.`,
    );
    if (!ok) return;
    await importStorageFromBackup(backup);
    window.location.reload();
  } catch (err) {
    toast.error(`Не удалось импортировать данные: ${errorText(err)}`);
  }
}

export function BackupButtons() {
  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Экспорт данных"
        title="Экспорт данных расширения (домены, сессии, шаблоны) в JSON"
        onClick={() => void exportBackup()}
      >
        <Download />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Импорт данных"
        title="Импорт данных расширения из JSON"
        onClick={() => void importBackup()}
      >
        <Upload />
      </Button>
    </div>
  );
}
