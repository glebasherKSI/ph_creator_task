/**
 * Минимальный ридер .xlsx (только текстовые значения ячеек по листам), без внешних библиотек
 * и без DOMParser — чтобы модуль был testable в node-окружении vitest (см. vitest.config.ts)
 * так же, как остальной app/lib. MV3 CSP запрещает удалённые скрипты, а вендорить
 * многосоткилобайтный минифицированный SheetJS рискованно (не проверить побайтово) —
 * поэтому .xlsx (это ZIP + XML) читается напрямую: ZIP central directory разбирается
 * вручную, распаковка deflate — через нативный DecompressionStream("deflate-raw")
 * (доступен и в Chrome, и как глобальный в Node 18+), а XML — собственным мини-парсером.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;

function findEndOfCentralDirectory(view: DataView): number {
  const maxCommentLength = 65535;
  const minPos = Math.max(0, view.byteLength - 22 - maxCommentLength);
  for (let pos = view.byteLength - 22; pos >= minPos; pos -= 1) {
    if (view.getUint32(pos, true) === EOCD_SIGNATURE) return pos;
  }
  throw new Error("Не найден конец central directory — файл повреждён или это не .xlsx/.zip");
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("Среда не поддерживает DecompressionStream — обновите браузер");
  }
  const stream = new Blob([new Uint8Array(bytes)])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Путь внутри архива → распакованные байты. */
async function readZipEntries(arrayBuffer: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);
  const eocdPos = findEndOfCentralDirectory(view);
  const totalEntries = view.getUint16(eocdPos + 10, true);
  let cdOffset = view.getUint32(eocdPos + 16, true);

  const decoder = new TextDecoder("utf-8");
  const entries = new Map<string, Uint8Array>();

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

// ---------------------------------------------------------------------------
// Минимальный XML-парсер (вместо DOMParser — testable в node-окружении)
// ---------------------------------------------------------------------------

export interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** Прямой текст этого узла (без учёта вложенных элементов — для <v>/<t> этого достаточно). */
  text: string;
}

function localName(tag: string): string {
  const i = tag.indexOf(":");
  return i >= 0 ? tag.slice(i + 1) : tag;
}

function decodeEntities(raw: string): string {
  if (!raw.includes("&")) return raw;
  return raw.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, ent: string) => {
    if (ent[0] === "#") {
      const isHex = ent[1] === "x" || ent[1] === "X";
      const code = parseInt(ent.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    switch (ent) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "apos":
        return "'";
      default:
        return match;
    }
  });
}

const TAG_RE = /^<([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/;
const ATTR_RE = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function parseAttrs(attrText: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(attrText))) {
    attrs[m[1]!] = decodeEntities(m[2] ?? m[3] ?? "");
  }
  return attrs;
}

/** Разбирает XML-документ (без namespace-резолюции — префикс остаётся частью tag/имени атрибута). */
export function parseXml(xmlText: string): XmlNode {
  const n = xmlText.length;
  let i = 0;

  function skipMisc(): void {
    for (;;) {
      while (i < n && /\s/.test(xmlText[i]!)) i += 1;
      if (xmlText.startsWith("<?", i)) {
        const end = xmlText.indexOf("?>", i);
        i = end === -1 ? n : end + 2;
        continue;
      }
      if (xmlText.startsWith("<!--", i)) {
        const end = xmlText.indexOf("-->", i);
        i = end === -1 ? n : end + 3;
        continue;
      }
      if (xmlText.startsWith("<!", i)) {
        const end = xmlText.indexOf(">", i);
        i = end === -1 ? n : end + 1;
        continue;
      }
      break;
    }
  }

  function parseElement(): XmlNode {
    const tagMatch = TAG_RE.exec(xmlText.slice(i));
    if (!tagMatch) throw new Error(`xlsx-lite: не удалось разобрать XML (смещение ${i})`);
    const [full, tag, attrText, selfClose] = tagMatch;
    i += full.length;
    const attrs = parseAttrs(attrText ?? "");

    if (selfClose === "/") {
      return { tag: tag!, attrs, children: [], text: "" };
    }

    const children: XmlNode[] = [];
    const textParts: string[] = [];
    while (i < n) {
      if (xmlText.startsWith("<!--", i)) {
        const end = xmlText.indexOf("-->", i);
        i = end === -1 ? n : end + 3;
        continue;
      }
      if (xmlText.startsWith("</", i)) {
        const end = xmlText.indexOf(">", i);
        i = end === -1 ? n : end + 1;
        break;
      }
      if (xmlText[i] === "<") {
        children.push(parseElement());
        continue;
      }
      const next = xmlText.indexOf("<", i);
      const chunk = xmlText.slice(i, next === -1 ? n : next);
      textParts.push(decodeEntities(chunk));
      i = next === -1 ? n : next;
    }
    return { tag: tag!, attrs, children, text: textParts.join("") };
  }

  skipMisc();
  if (i >= n) throw new Error("xlsx-lite: пустой XML-документ");
  return parseElement();
}

/** Все потомки (на любом уровне) с данным (без учёта префикса namespace) именем тега. */
export function findAll(node: XmlNode, tag: string): XmlNode[] {
  const wanted = localName(tag);
  const out: XmlNode[] = [];
  const walk = (current: XmlNode): void => {
    for (const child of current.children) {
      if (localName(child.tag) === wanted) out.push(child);
      walk(child);
    }
  };
  walk(node);
  return out;
}

/** Первый прямой потомок с данным именем тега (без учёта префикса namespace), если есть. */
export function findFirstChild(node: XmlNode, tag: string): XmlNode | null {
  const wanted = localName(tag);
  return node.children.find((child) => localName(child.tag) === wanted) ?? null;
}

// ---------------------------------------------------------------------------
// Разбор содержимого .xlsx поверх распакованных XML-частей
// ---------------------------------------------------------------------------

const RELATIONSHIPS_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

function parseEntryXml(entries: Map<string, Uint8Array>, path: string): XmlNode | null {
  const bytes = entries.get(path);
  if (!bytes) return null;
  return parseXml(new TextDecoder("utf-8").decode(bytes));
}

/** Номер столбца из адреса ячейки ("A1" → 0, "B1" → 1, "AA5" → 26). */
function columnIndexFromCellRef(ref: string | undefined): number {
  const match = /^([A-Z]+)/.exec(String(ref ?? ""));
  if (!match) return -1;
  const letters = match[1]!;
  let index = 0;
  for (let i = 0; i < letters.length; i += 1) {
    index = index * 26 + (letters.charCodeAt(i) - 64);
  }
  return index - 1;
}

function cellText(cellEl: XmlNode, sharedStrings: string[]): string {
  const type = cellEl.attrs.t;
  if (type === "inlineStr") {
    const isEl = findFirstChild(cellEl, "is");
    const tEl = isEl ? findFirstChild(isEl, "t") : null;
    return (tEl?.text ?? "").trim();
  }
  const vEl = findFirstChild(cellEl, "v");
  if (!vEl) return "";
  const raw = vEl.text;
  if (type === "s") {
    const idx = Number(raw);
    return Number.isFinite(idx) ? (sharedStrings[idx] ?? "").trim() : "";
  }
  return raw.trim();
}

function parseSharedStrings(doc: XmlNode | null): string[] {
  if (!doc) return [];
  return findAll(doc, "si").map((si) =>
    findAll(si, "t")
      .map((t) => t.text)
      .join("")
      .trim(),
  );
}

/** Строки листа как массив массивов строк (по индексу столбца, пропуски — пустая строка). */
function parseSheetRows(doc: XmlNode, sharedStrings: string[]): string[][] {
  const rows: string[][] = [];
  for (const rowEl of findAll(doc, "row")) {
    const cells = findAll(rowEl, "c");
    if (!cells.length) continue;
    const row: string[] = [];
    for (const cellEl of cells) {
      const col = columnIndexFromCellRef(cellEl.attrs.r);
      if (col < 0) continue;
      while (row.length <= col) row.push("");
      row[col] = cellText(cellEl, sharedStrings);
    }
    rows.push(row);
  }
  return rows;
}

export interface XlsxSheet {
  name: string;
  rows: string[][];
}

/**
 * Читает .xlsx и возвращает листы в порядке книги, каждый — { name, rows }.
 * @param arrayBuffer содержимое файла (например, из `File#arrayBuffer()`)
 */
export async function readXlsxSheets(arrayBuffer: ArrayBuffer): Promise<XlsxSheet[]> {
  const entries = await readZipEntries(arrayBuffer);

  const workbookDoc = parseEntryXml(entries, "xl/workbook.xml");
  if (!workbookDoc) throw new Error("В файле нет xl/workbook.xml — это не .xlsx");

  const relsDoc = parseEntryXml(entries, "xl/_rels/workbook.xml.rels");
  const relsById = new Map<string, string>();
  if (relsDoc) {
    for (const rel of findAll(relsDoc, "Relationship")) {
      const id = rel.attrs.Id;
      const target = rel.attrs.Target;
      if (id && target) relsById.set(id, target);
    }
  }

  const sharedStrings = parseSharedStrings(parseEntryXml(entries, "xl/sharedStrings.xml"));

  const sheets: XlsxSheet[] = [];
  for (const sheetEl of findAll(workbookDoc, "sheet")) {
    const name = sheetEl.attrs.name ?? "";
    const rId = sheetEl.attrs["r:id"] ?? sheetEl.attrs[`${RELATIONSHIPS_NS}:id`];
    const target = rId ? relsById.get(rId) : null;
    const path = target ? `xl/${target.replace(/^\.?\//, "")}` : null;
    const sheetDoc = path ? parseEntryXml(entries, path) : null;
    if (!sheetDoc) continue;

    sheets.push({ name, rows: parseSheetRows(sheetDoc, sharedStrings) });
  }

  return sheets;
}
