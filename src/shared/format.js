/** Форматирование строк и JSON для UI. */

export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatJson(value) {
  if (value == null) return "—";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function formatJsonStrict(value) {
  return JSON.stringify(value ?? null, null, 2);
}

export function formatTime(iso) {
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

/** Компактная дата для карточек задач (ru-RU). */
export function formatCardDate(iso) {
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

/**
 * API datetime → значение для `<input type="datetime-local">`.
 * Бэкенд хранит «наивное» UTC-время: стенные часы в ISO с суффиксом Z (как в админке).
 */
export function isoToDatetimeLocal(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

/**
 * Значение `<input type="datetime-local">` → ISO для API.
 * Стенное время пользователя записывается в Z без сдвига часового пояса.
 */
export function datetimeLocalToIso(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) throw new Error("Некорректная дата/время");
  const [, year, month, day, hour, minute, second = "00"] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`;
}

export function exportDateStamp() {
  const d = new Date();
  const pad = (v) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Число для полей ввода с запятой как десятичным разделителем (1,5).
 * @param {unknown} value
 * @returns {string}
 */
export function formatDecimalForUi(value) {
  if (value == null || value === "") return "";
  const num = typeof value === "number" && Number.isFinite(value) ? value : parseDecimalFromUi(value);
  if (num === undefined) return String(value);
  return String(num).replace(".", ",");
}

/**
 * Число для API с точкой как десятичным разделителем ("1.5").
 * Принимает number (1.5), строку "1,5" или "1.5".
 * @param {unknown} value
 * @returns {string | undefined}
 */
export function formatDecimalForApi(value) {
  if (value == null || value === "") return undefined;
  const num = typeof value === "number" && Number.isFinite(value) ? value : parseDecimalFromUi(value);
  if (num === undefined) return undefined;
  return String(num);
}

/**
 * Парсит UI-строку с запятой или точкой в число.
 * @param {unknown} value
 * @returns {number | undefined}
 */
export function parseDecimalFromUi(value) {
  if (value == null || value === "") return undefined;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const normalized = String(value).trim().replace(",", ".");
  if (!normalized) return undefined;
  const num = Number(normalized);
  return Number.isFinite(num) ? num : undefined;
}
