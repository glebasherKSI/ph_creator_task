import zlib from "node:zlib";

import { describe, expect, it } from "vitest";

import { findAll, findFirstChild, parseXml, readXlsxSheets } from "@/lib/xlsx-lite";

// ---------------------------------------------------------------------------
// Мини-сборщик ZIP (только для фикстур теста — не продакшн-код)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0 ^ -1;
  for (const byte of buf) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff]!;
  return (crc ^ -1) >>> 0;
}

interface ZipFileInput {
  name: string;
  data: Buffer;
  method?: 0 | 8;
}

function buildZip(files: ZipFileInput[]): ArrayBuffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const f of files) {
    const nameBuf = Buffer.from(f.name, "utf-8");
    const method = f.method ?? 8;
    const compressed = method === 8 ? zlib.deflateRawSync(f.data) : f.data;
    const crc = crc32(f.data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(f.data.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    const localRecord = Buffer.concat([localHeader, nameBuf, compressed]);
    localParts.push(localRecord);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(f.data.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(Buffer.concat([centralHeader, nameBuf]));

    offset += localRecord.length;
  }

  const localBuf = Buffer.concat(localParts);
  const centralBuf = Buffer.concat(centralParts);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(localBuf.length, 16);
  eocd.writeUInt16LE(0, 20);

  const full = Buffer.concat([localBuf, centralBuf, eocd]);
  return full.buffer.slice(full.byteOffset, full.byteOffset + full.byteLength) as ArrayBuffer;
}

function xmlFile(name: string, text: string, method: 0 | 8 = 8): ZipFileInput {
  return { name, data: Buffer.from(text, "utf-8"), method };
}

// ---------------------------------------------------------------------------
// Фикстуры: упрощённая, но валидная книга с двумя листами (RU — shared strings,
// EN — inline strings), разреженными столбцами и обоими методами сжатия.
// ---------------------------------------------------------------------------

const SHARED_STRINGS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="6" uniqueCount="6">
  <si><t>front_id</t></si>
  <si><t>name</t></si>
  <si><t>task_alpha</t></si>
  <si><t>Альфа RU</t></si>
  <si><t>task_beta</t></si>
  <si><t>Бета &amp; RU</t></si>
</sst>`;

const SHEET_RU_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
    <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row>
    <row r="3"><c r="A3" t="s"><v>4</v></c><c r="B3" t="s"><v>5</v></c></row>
  </sheetData>
</worksheet>`;

const SHEET_EN_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="inlineStr"><is><t>front_id</t></is></c><c r="B1" t="inlineStr"><is><t>name</t></is></c></row>
    <row r="2"><c r="A2" t="inlineStr"><is><t>task_alpha</t></is></c><c r="B2" t="inlineStr"><is><t>Alpha EN</t></is></c></row>
    <row r="3"><c r="A3" t="inlineStr"><is><t>task_gamma</t></is></c><c r="C3" t="inlineStr"><is><t>skip col B</t></is></c></row>
  </sheetData>
</worksheet>`;

const WORKBOOK_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="RU" sheetId="1" r:id="rId1"/>
    <sheet name="EN" sheetId="2" r:id="rId2"/>
  </sheets>
</workbook>`;

const RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="worksheet" Target="worksheets/sheet2.xml"/>
</Relationships>`;

function sampleWorkbookZip(): ArrayBuffer {
  return buildZip([
    xmlFile("xl/workbook.xml", WORKBOOK_XML, 8),
    xmlFile("xl/_rels/workbook.xml.rels", RELS_XML, 0),
    xmlFile("xl/sharedStrings.xml", SHARED_STRINGS_XML, 8),
    xmlFile("xl/worksheets/sheet1.xml", SHEET_RU_XML, 8),
    xmlFile("xl/worksheets/sheet2.xml", SHEET_EN_XML, 0),
  ]);
}

describe("readXlsxSheets", () => {
  it("читает несколько листов: shared strings, inline strings, оба метода сжатия", async () => {
    const sheets = await readXlsxSheets(sampleWorkbookZip());
    expect(sheets.map((s) => s.name)).toEqual(["RU", "EN"]);

    const ru = sheets.find((s) => s.name === "RU")!;
    expect(ru.rows).toEqual([
      ["front_id", "name"],
      ["task_alpha", "Альфа RU"],
      ["task_beta", "Бета & RU"], // entity &amp; декодируется
    ]);

    const en = sheets.find((s) => s.name === "EN")!;
    expect(en.rows).toEqual([
      ["front_id", "name"],
      ["task_alpha", "Alpha EN"],
      ["task_gamma", "", "skip col B"], // B3 пустая — столбец C не сдвигается
    ]);
  });

  it("лист без xl/workbook.xml — явная ошибка", async () => {
    const zip = buildZip([xmlFile("xl/sharedStrings.xml", SHARED_STRINGS_XML)]);
    await expect(readXlsxSheets(zip)).rejects.toThrow("xl/workbook.xml");
  });

  it("лист, на который нет rels-записи, пропускается без падения", async () => {
    const zip = buildZip([
      xmlFile("xl/workbook.xml", WORKBOOK_XML),
      xmlFile("xl/sharedStrings.xml", SHARED_STRINGS_XML),
      xmlFile("xl/worksheets/sheet1.xml", SHEET_RU_XML),
      // Rels и sheet2.xml намеренно отсутствуют.
    ]);
    const sheets = await readXlsxSheets(zip);
    expect(sheets).toEqual([]);
  });

  it("книга без sharedStrings.xml — пустой словарь, t=s без него даёт пустую строку", async () => {
    const zip = buildZip([
      xmlFile("xl/workbook.xml", WORKBOOK_XML),
      xmlFile("xl/_rels/workbook.xml.rels", RELS_XML),
      xmlFile("xl/worksheets/sheet1.xml", SHEET_RU_XML),
      xmlFile("xl/worksheets/sheet2.xml", SHEET_EN_XML),
    ]);
    const sheets = await readXlsxSheets(zip);
    const ru = sheets.find((s) => s.name === "RU")!;
    expect(ru.rows[0]).toEqual(["", ""]);
  });
});

describe("parseXml / findAll / findFirstChild", () => {
  it("вложенные элементы, атрибуты в одинарных/двойных кавычках, самозакрывающиеся теги", () => {
    const doc = parseXml(`<root a="1" b='two'><child x="y"/><child>text</child></root>`);
    expect(doc.tag).toBe("root");
    expect(doc.attrs).toEqual({ a: "1", b: "two" });
    const children = findAll(doc, "child");
    expect(children).toHaveLength(2);
    expect(children[0]!.attrs).toEqual({ x: "y" });
    expect(children[1]!.text).toBe("text");
    expect(findFirstChild(doc, "child")).toBe(children[0]);
  });

  it("декодирует именованные и числовые entity", () => {
    const doc = parseXml(`<t>A &amp; B &lt;tag&gt; &quot;q&quot; &#169; &#x41;</t>`);
    expect(doc.text).toBe(`A & B <tag> "q" © A`);
  });

  it("игнорирует namespace-префикс при поиске по имени тега", () => {
    const doc = parseXml(`<r:root xmlns:r="urn:x"><r:item>1</r:item></r:root>`);
    expect(findAll(doc, "item")).toHaveLength(1);
    expect(findAll(doc, "r:item")).toHaveLength(1);
  });

  it("пропускает пролог, комментарии и doctype перед корневым элементом", () => {
    const doc = parseXml(
      `<?xml version="1.0"?>\n<!-- comment -->\n<!DOCTYPE root>\n<root>ok</root>`,
    );
    expect(doc.tag).toBe("root");
    expect(doc.text).toBe("ok");
  });
});
