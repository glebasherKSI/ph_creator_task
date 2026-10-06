/**
 * Минимальный ридер .xlsx (только текстовые значения ячеек по листам), без внешних библиотек.
 * MV3 CSP запрещает удалённые скрипты, а вендорить многосоткилобайтный минифицированный
 * SheetJS рискованно (не проверить побайтово) — поэтому .xlsx (это ZIP + XML) читается
 * напрямую: ZIP central directory разбирается вручную, а распаковка deflate — через
 * нативный DecompressionStream("deflate-raw"), доступный в Chrome.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const RELATIONSHIPS_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

function findEndOfCentralDirectory(view) {
  const maxCommentLength = 65535;
  const minPos = Math.max(0, view.byteLength - 22 - maxCommentLength);
  for (let pos = view.byteLength - 22; pos >= minPos; pos -= 1) {
    if (view.getUint32(pos, true) === EOCD_SIGNATURE) return pos;
  }
  throw new Error("Не найден конец central directory — файл повреждён или это не .xlsx/.zip");
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("Браузер не поддерживает DecompressionStream — обновите Chrome");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** @returns {Promise<Map<string, Uint8Array>>} путь внутри архива → распакованные байты */
async function readZipEntries(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);
  const eocdPos = findEndOfCentralDirectory(view);
  const totalEntries = view.getUint16(eocdPos + 10, true);
  let cdOffset = view.getUint32(eocdPos + 16, true);

  const decoder = new TextDecoder("utf-8");
  const entries = new Map();

  for (let i = 0; i < totalEntries; i += 1) {
    if (view.getUint32(cdOffset, true) !== CENTRAL_DIR_SIGNATURE) {
      throw new Error("Повреждённый central directory record в .xlsx");
    }
    const compressionMethod = view.getUint16(cdOffset + 10, true);
    const compressedSize = view.getUint32(cdOffset + 20, true);
    const nameLen = view.getUint16(cdOffset + 28, true);
    const extraLen = view.getUint16(cdOffset + 30, true);
    const commentLen = view.getUint16(cdOffset + 32, true);
    const localHeaderOffset = view.getUint32(cdOffset + 42, true);
    const nameBytes = bytes.subarray(cdOffset + 46, cdOffset + 46 + nameLen);
    const fileName = decoder.decode(nameBytes);

    if (view.getUint32(localHeaderOffset, true) !== LOCAL_HEADER_SIGNATURE) {
      throw new Error(`Повреждённый local file header для "${fileName}"`);
    }
    const localNameLen = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const compressedData = bytes.subarray(dataStart, dataStart + compressedSize);

    if (!fileName.endsWith("/")) {
      if (compressionMethod === 0) {
        entries.set(fileName, compressedData);
      } else if (compressionMethod === 8) {
        entries.set(fileName, await inflateRaw(compressedData));
      } else {
        throw new Error(`Неподдерживаемый метод сжатия (${compressionMethod}) для "${fileName}"`);
      }
    }

    cdOffset += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}

function parseXml(bytes) {
  const text = new TextDecoder("utf-8").decode(bytes);
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) {
    throw new Error("Не удалось разобрать XML внутри .xlsx");
  }
  return doc;
}

/** Номер столбца из адреса ячейки ("A1" → 0, "B1" → 1, "AA5" → 26). */
function columnIndexFromCellRef(ref) {
  const match = String(ref || "").match(/^([A-Z]+)/);
  if (!match) return -1;
  const letters = match[1];
  let index = 0;
  for (let i = 0; i < letters.length; i += 1) {
    index = index * 26 + (letters.charCodeAt(i) - 64);
  }
  return index - 1;
}

function cellText(cellEl, sharedStrings) {
  const type = cellEl.getAttribute("t");
  if (type === "inlineStr") {
    const isEl = cellEl.getElementsByTagName("is")[0];
    const tEl = isEl?.getElementsByTagName("t")[0];
    return (tEl?.textContent ?? "").trim();
  }
  const vEl = cellEl.getElementsByTagName("v")[0];
  if (!vEl) return "";
  const raw = vEl.textContent ?? "";
  if (type === "s") {
    const idx = Number(raw);
    return Number.isFinite(idx) ? (sharedStrings[idx] ?? "").trim() : "";
  }
  return raw.trim();
}

function parseSharedStrings(doc) {
  if (!doc) return [];
  const items = [...doc.getElementsByTagName("si")];
  return items.map((si) => {
    const texts = [...si.getElementsByTagName("t")].map((t) => t.textContent ?? "");
    return texts.join("").trim();
  });
}

/** Строки листа как массив массивов строк (по индексу столбца, пропуски = ""). */
function parseSheetRows(doc, sharedStrings) {
  const rows = [];
  for (const rowEl of doc.getElementsByTagName("row")) {
    const cells = [...rowEl.getElementsByTagName("c")];
    if (!cells.length) continue;
    const row = [];
    for (const cellEl of cells) {
      const col = columnIndexFromCellRef(cellEl.getAttribute("r"));
      if (col < 0) continue;
      while (row.length <= col) row.push("");
      row[col] = cellText(cellEl, sharedStrings);
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Читает .xlsx и возвращает листы в порядке книги, каждый — { name, rows }.
 * @param {ArrayBuffer} arrayBuffer
 * @returns {Promise<{ name: string, rows: string[][] }[]>}
 */
export async function readXlsxSheets(arrayBuffer) {
  const entries = await readZipEntries(arrayBuffer);

  const workbookXml = entries.get("xl/workbook.xml");
  if (!workbookXml) throw new Error("В файле нет xl/workbook.xml — это не .xlsx");
  const workbookDoc = parseXml(workbookXml);

  const relsXml = entries.get("xl/_rels/workbook.xml.rels");
  const relsDoc = relsXml ? parseXml(relsXml) : null;
  const relsById = new Map();
  if (relsDoc) {
    for (const rel of relsDoc.getElementsByTagName("Relationship")) {
      relsById.set(rel.getAttribute("Id"), rel.getAttribute("Target"));
    }
  }

  const sharedStringsXml = entries.get("xl/sharedStrings.xml");
  const sharedStrings = sharedStringsXml ? parseSharedStrings(parseXml(sharedStringsXml)) : [];

  const sheets = [];
  for (const sheetEl of workbookDoc.getElementsByTagName("sheet")) {
    const name = sheetEl.getAttribute("name") || "";
    const rId = sheetEl.getAttribute("r:id") || sheetEl.getAttributeNS(RELATIONSHIPS_NS, "id");
    const target = rId ? relsById.get(rId) : null;
    const path = target ? `xl/${String(target).replace(/^\.?\//, "")}` : null;
    const sheetXml = path ? entries.get(path) : null;
    if (!sheetXml) continue;

    sheets.push({ name, rows: parseSheetRows(parseXml(sheetXml), sharedStrings) });
  }

  return sheets;
}
