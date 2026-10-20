/** Форматирование строк, дат и чисел для UI и API. */

export function escapeHtml(text: unknown): string {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatJson(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function formatJsonStrict(value: unknown): string {
  return JSON.stringify(value ?? null, null, 2);
}

export function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      day: "2-digit",
      month: "2-digit",
      timeZone: "UTC",
    });
  } catch {
    return iso;
  }
}

/** Компактная дата для карточек задач (ru-RU): «1 окт. 2026 г.». */
export function formatCardDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  } catch {
    return null;
  }
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

/**
 * Полная дата со временем для карточек канвы: «01.10.2026 15:39».
 * Бэкенд хранит «наивное» UTC-время, поэтому читаем UTC-компоненты без сдвига.
 */
export function formatCardDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${pad2(d.getUTCDate())}.${pad2(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

/**
 * API datetime → значение для `<input type="datetime-local">`.
 * Бэкенд хранит «наивное» UTC-время: стенные часы в ISO с суффиксом Z (как в админке).
 */
export function isoToDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}T${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`;
}

/**
 * Значение `<input type="datetime-local">` → ISO для API.
 * Стенное время пользователя записывается в Z без сдвига часового пояса.
 */
export function datetimeLocalToIso(value: string | null | undefined): string | null {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) throw new Error("Некорректная дата/время");
  const [, year, month, day, hour, minute, second = "00"] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`;
}

export function exportDateStamp(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

/** Парсит UI-строку с запятой или точкой в число. */
export function parseDecimalFromUi(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const normalized = String(value).trim().replace(",", ".");
  if (!normalized) return undefined;
  const num = Number(normalized);
  return Number.isFinite(num) ? num : undefined;
}

/** Число для полей ввода с запятой как десятичным разделителем (1,5). */
export function formatDecimalForUi(value: unknown): string {
  if (value == null || value === "") return "";
  const num =
    typeof value === "number" && Number.isFinite(value) ? value : parseDecimalFromUi(value);
  if (num === undefined) return String(value);
  return String(num).replace(".", ",");
}

/** Число для API с точкой как десятичным разделителем ("1.5"). */
export function formatDecimalForApi(value: unknown): string | undefined {
  if (value == null || value === "") return undefined;
  const num =
    typeof value === "number" && Number.isFinite(value) ? value : parseDecimalFromUi(value);
  if (num === undefined) return undefined;
  return String(num);
}
