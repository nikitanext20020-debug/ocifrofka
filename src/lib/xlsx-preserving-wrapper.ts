// The application edits table values, but the stock SheetJS writer rebuilds the
// workbook and drops drawings, validation lists, styles and other package parts.
// This wrapper keeps the original XLSX ZIP package and only replaces changed cell
// values in worksheet XML. All unrelated Excel content remains byte-for-byte
// present in the exported archive.

// The npm package exposes this runtime ESM entry without a dedicated declaration.
// @ts-expect-error runtime subpath intentionally bypasses the local "xlsx" alias
import * as RealXLSX from "xlsx/xlsx.mjs";
import { findDescriptiveHeaderRowIndex } from "@/lib/column-mapping";
import { normalizeTable } from "@/lib/table-utils";
import type { TableData } from "@/lib/types";

export const utils = RealXLSX.utils;
export const version = RealXLSX.version;

type SheetLayout = {
  headerRowIndex: number;
  table: TableData;
};

type WorkbookSession = {
  bytes: Uint8Array;
  layouts: Record<string, SheetLayout>;
};

type CellEdit = {
  row: number;
  column: number;
  value: string;
};

type ZipEntry = {
  name: string;
  versionMadeBy: number;
  versionNeeded: number;
  flags: number;
  method: number;
  modTime: number;
  modDate: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  diskStart: number;
  internalAttributes: number;
  externalAttributes: number;
  centralExtra: Uint8Array;
  localExtra: Uint8Array;
  comment: Uint8Array;
  compressedData: Uint8Array;
};

let session: WorkbookSession | null = null;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8");
const XML_NS = "http://www.w3.org/XML/1998/namespace";

function copyBytes(data: unknown): Uint8Array | null {
  if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
  }
  return null;
}

function isZip(bytes: Uint8Array) {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

export function read(data: unknown, options?: unknown) {
  const parsed = RealXLSX.read(data, options);
  const bytes = copyBytes(data);

  if (!bytes || !isZip(bytes)) {
    session = null;
    return parsed;
  }

  const layouts: Record<string, SheetLayout> = {};
  for (const name of parsed.SheetNames as string[]) {
    const matrix = RealXLSX.utils.sheet_to_json(parsed.Sheets[name], {
      header: 1,
      raw: false,
      defval: "",
    }) as unknown[][];
    layouts[name] = {
      headerRowIndex: findDescriptiveHeaderRowIndex(matrix),
      table: normalizeTable(matrix),
    };
  }

  session = { bytes, layouts };
  return parsed;
}

function displayValue(value: unknown) {
  return String(value ?? "");
}

function collectSheetEdits(output: any, name: string, layout: SheetLayout): CellEdit[] {
  const outputSheet = output.Sheets[name];
  if (!outputSheet) return [];

  const matrix = RealXLSX.utils.sheet_to_json(outputSheet, {
    header: 1,
    raw: false,
    defval: "",
  }) as unknown[][];
  const edits: CellEdit[] = [];

  for (let row = 0; row < matrix.length; row++) {
    const sourceRow = row === 0 ? layout.table.headers : (layout.table.rows[row - 1] ?? []);
    const width = Math.max(matrix[row]?.length ?? 0, sourceRow.length);
    for (let column = 0; column < width; column++) {
      const next = displayValue(matrix[row]?.[column]);
      const previous = displayValue(sourceRow[column]);
      if (next !== previous) {
        edits.push({
          row: layout.headerRowIndex + row + 1,
          column,
          value: next,
        });
      }
    }
  }

  return edits;
}

function getElementsByLocalName(root: ParentNode, localName: string): Element[] {
  const namespaceMatches = Array.from((root as Document | Element).getElementsByTagNameNS?.("*", localName) ?? []);
  if (namespaceMatches.length) return namespaceMatches;
  return Array.from((root as Document | Element).getElementsByTagName(localName));
}

function parseXml(bytes: Uint8Array) {
  const xml = textDecoder.decode(bytes);
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.getElementsByTagName("parsererror").length) {
    throw new Error("Excel XML could not be parsed");
  }
  return { document, hadDeclaration: /^\s*<\?xml/i.test(xml) };
}

function serializeXml(document: XMLDocument, hadDeclaration: boolean) {
  const body = new XMLSerializer().serializeToString(document);
  const xml = hadDeclaration && !/^\s*<\?xml/i.test(body)
    ? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${body}`
    : body;
  return textEncoder.encode(xml);
}

function normalizeZipPath(baseFile: string, target: string) {
  if (target.startsWith("/")) return target.slice(1);
  const parts = baseFile.split("/");
  parts.pop();
  for (const part of target.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function columnName(index: number) {
  let number = index + 1;
  let result = "";
  while (number > 0) {
    const remainder = (number - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    number = Math.floor((number - 1) / 26);
  }
  return result;
}

function columnIndex(reference: string) {
  const letters = reference.match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? "A";
  let result = 0;
  for (const letter of letters) result = result * 26 + letter.charCodeAt(0) - 64;
  return result - 1;
}

function cellReference(column: number, row: number) {
  return `${columnName(column)}${row}`;
}

function findDirectChild(parent: Element, localName: string) {
  return Array.from(parent.children).find((child) => child.localName === localName) ?? null;
}

function ensureRow(document: XMLDocument, sheetData: Element, rowNumber: number) {
  const rows = Array.from(sheetData.children).filter((child) => child.localName === "row");
  const existing = rows.find((row) => Number(row.getAttribute("r")) === rowNumber);
  if (existing) return existing;

  const namespace = sheetData.namespaceURI;
  const row = document.createElementNS(namespace, "row");
  row.setAttribute("r", String(rowNumber));
  const before = rows.find((candidate) => Number(candidate.getAttribute("r")) > rowNumber);
  sheetData.insertBefore(row, before ?? null);
  return row;
}

function styleForNewCell(sheetData: Element, row: Element, column: number) {
  const sameRowCells = Array.from(row.children).filter((child) => child.localName === "c");
  const left = [...sameRowCells]
    .reverse()
    .find((cell) => columnIndex(cell.getAttribute("r") ?? "A1") < column && cell.hasAttribute("s"));
  if (left) return left.getAttribute("s");

  for (const cell of getElementsByLocalName(sheetData, "c")) {
    if (columnIndex(cell.getAttribute("r") ?? "A1") === column && cell.hasAttribute("s")) {
      return cell.getAttribute("s");
    }
  }
  return null;
}

function ensureCell(document: XMLDocument, sheetData: Element, row: Element, column: number, rowNumber: number) {
  const reference = cellReference(column, rowNumber);
  const cells = Array.from(row.children).filter((child) => child.localName === "c");
  const existing = cells.find((cell) => cell.getAttribute("r") === reference);
  if (existing) return existing;

  const namespace = row.namespaceURI;
  const cell = document.createElementNS(namespace, "c");
  cell.setAttribute("r", reference);
  const style = styleForNewCell(sheetData, row, column);
  if (style !== null) cell.setAttribute("s", style);
  const before = cells.find((candidate) => columnIndex(candidate.getAttribute("r") ?? "A1") > column);
  row.insertBefore(cell, before ?? null);
  return cell;
}

function setCellValue(document: XMLDocument, cell: Element, value: string) {
  for (const child of Array.from(cell.children)) {
    if (child.localName === "f" || child.localName === "v" || child.localName === "is") {
      cell.removeChild(child);
    }
  }

  if (!value) {
    cell.removeAttribute("t");
    return;
  }

  cell.setAttribute("t", "inlineStr");
  const namespace = cell.namespaceURI;
  const inlineString = document.createElementNS(namespace, "is");
  const text = document.createElementNS(namespace, "t");
  if (/^\s|\s$/.test(value)) text.setAttributeNS(XML_NS, "xml:space", "preserve");
  text.textContent = value;
  inlineString.appendChild(text);
  cell.appendChild(inlineString);
}

function updateDimension(document: XMLDocument, edits: CellEdit[]) {
  if (!edits.length) return;
  const dimension = getElementsByLocalName(document, "dimension")[0];
  if (!dimension) return;

  const current = dimension.getAttribute("ref") ?? "A1";
  const [start, end = start] = current.split(":");
  let maxColumn = columnIndex(end);
  let maxRow = Number(end.match(/\d+$/)?.[0] ?? 1);
  for (const edit of edits) {
    maxColumn = Math.max(maxColumn, edit.column);
    maxRow = Math.max(maxRow, edit.row);
  }
  dimension.setAttribute("ref", `${start}:${cellReference(maxColumn, maxRow)}`);
}

function patchWorksheet(bytes: Uint8Array, edits: CellEdit[]) {
  const { document, hadDeclaration } = parseXml(bytes);
  const sheetData = getElementsByLocalName(document, "sheetData")[0];
  if (!sheetData) throw new Error("Worksheet has no sheetData section");

  for (const edit of edits) {
    const row = ensureRow(document, sheetData, edit.row);
    const cell = ensureCell(document, sheetData, row, edit.column, edit.row);
    setCellValue(document, cell, edit.value);
  }
  updateDimension(document, edits);
  return serializeXml(document, hadDeclaration);
}

function u16(view: DataView, offset: number) {
  return view.getUint16(offset, true);
}

function u32(view: DataView, offset: number) {
  return view.getUint32(offset, true);
}

function locateEndOfCentralDirectory(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const lowerBound = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= lowerBound; offset--) {
    if (u32(view, offset) === 0x06054b50) return offset;
  }
  throw new Error("Invalid ZIP: central directory not found");
}

function parseZip(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endOffset = locateEndOfCentralDirectory(bytes);
  const totalEntries = u16(view, endOffset + 10);
  const centralOffset = u32(view, endOffset + 16);
  if (totalEntries === 0xffff || centralOffset === 0xffffffff) {
    throw new Error("ZIP64 workbooks are not supported");
  }

  const entries: ZipEntry[] = [];
  let offset = centralOffset;
  for (let index = 0; index < totalEntries; index++) {
    if (u32(view, offset) !== 0x02014b50) throw new Error("Invalid ZIP central directory");
    const nameLength = u16(view, offset + 28);
    const extraLength = u16(view, offset + 30);
    const commentLength = u16(view, offset + 32);
    const localOffset = u32(view, offset + 42);
    const nameBytes = bytes.slice(offset + 46, offset + 46 + nameLength);
    const name = textDecoder.decode(nameBytes);

    if (u32(view, localOffset) !== 0x04034b50) throw new Error("Invalid ZIP local header");
    const localNameLength = u16(view, localOffset + 26);
    const localExtraLength = u16(view, localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressedSize = u32(view, offset + 20);

    entries.push({
      name,
      versionMadeBy: u16(view, offset + 4),
      versionNeeded: u16(view, offset + 6),
      flags: u16(view, offset + 8),
      method: u16(view, offset + 10),
      modTime: u16(view, offset + 12),
      modDate: u16(view, offset + 14),
      crc32: u32(view, offset + 16),
      compressedSize,
      uncompressedSize: u32(view, offset + 24),
      diskStart: u16(view, offset + 34),
      internalAttributes: u16(view, offset + 36),
      externalAttributes: u32(view, offset + 38),
      centralExtra: bytes.slice(offset + 46 + nameLength, offset + 46 + nameLength + extraLength),
      localExtra: bytes.slice(localOffset + 30 + localNameLength, dataOffset),
      comment: bytes.slice(offset + 46 + nameLength + extraLength, offset + 46 + nameLength + extraLength + commentLength),
      compressedData: bytes.slice(dataOffset, dataOffset + compressedSize),
    });

    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function arrayBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function transformCompression(bytes: Uint8Array, mode: "compress" | "decompress") {
  const Stream = mode === "compress" ? CompressionStream : DecompressionStream;
  const stream = new Blob([arrayBuffer(bytes)])
    .stream()
    .pipeThrough(new Stream("deflate-raw" as never));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function decompressEntry(entry: ZipEntry) {
  if (entry.method === 0) return entry.compressedData;
  if (entry.method === 8) return transformCompression(entry.compressedData, "decompress");
  throw new Error(`Unsupported ZIP compression method: ${entry.method}`);
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let value = 0; value < 256; value++) {
    let crc = value;
    for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    table[value] = crc >>> 0;
  }
  return table;
})();

function calculateCrc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function concatenate(parts: Uint8Array[]) {
  const size = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function localHeader(entry: ZipEntry, name: Uint8Array, compressed: Uint8Array, plain: Uint8Array, crc: number) {
  const header = new Uint8Array(30 + name.length + entry.localExtra.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, entry.versionNeeded, true);
  view.setUint16(6, entry.flags & ~0x0008, true);
  view.setUint16(8, entry.method, true);
  view.setUint16(10, entry.modTime, true);
  view.setUint16(12, entry.modDate, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, compressed.length, true);
  view.setUint32(22, plain.length, true);
  view.setUint16(26, name.length, true);
  view.setUint16(28, entry.localExtra.length, true);
  header.set(name, 30);
  header.set(entry.localExtra, 30 + name.length);
  return header;
}

function centralHeader(
  entry: ZipEntry,
  name: Uint8Array,
  compressed: Uint8Array,
  plain: Uint8Array,
  crc: number,
  localOffset: number,
) {
  const header = new Uint8Array(46 + name.length + entry.centralExtra.length + entry.comment.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, entry.versionMadeBy, true);
  view.setUint16(6, entry.versionNeeded, true);
  view.setUint16(8, entry.flags & ~0x0008, true);
  view.setUint16(10, entry.method, true);
  view.setUint16(12, entry.modTime, true);
  view.setUint16(14, entry.modDate, true);
  view.setUint32(16, crc, true);
  view.setUint32(20, compressed.length, true);
  view.setUint32(24, plain.length, true);
  view.setUint16(28, name.length, true);
  view.setUint16(30, entry.centralExtra.length, true);
  view.setUint16(32, entry.comment.length, true);
  view.setUint16(34, entry.diskStart, true);
  view.setUint16(36, entry.internalAttributes, true);
  view.setUint32(38, entry.externalAttributes, true);
  view.setUint32(42, localOffset, true);
  header.set(name, 46);
  header.set(entry.centralExtra, 46 + name.length);
  header.set(entry.comment, 46 + name.length + entry.centralExtra.length);
  return header;
}

async function writeZip(entries: ZipEntry[], replacements: Map<string, Uint8Array>) {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = textEncoder.encode(entry.name);
    const replacement = replacements.get(entry.name);
    const plain = replacement ?? await decompressEntry(entry);
    const compressed = replacement
      ? (entry.method === 0 ? plain : await transformCompression(plain, "compress"))
      : entry.compressedData;
    const crc = replacement ? calculateCrc32(plain) : entry.crc32;

    const local = localHeader(entry, name, compressed, plain, crc);
    localParts.push(local, compressed);
    centralParts.push(centralHeader(entry, name, compressed, plain, crc, localOffset));
    localOffset += local.length + compressed.length;
  }

  const central = concatenate(centralParts);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, central.length, true);
  endView.setUint32(16, localOffset, true);
  return concatenate([...localParts, central, end]);
}

async function worksheetPaths(entries: ZipEntry[]) {
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const workbookEntry = byName.get("xl/workbook.xml");
  const relationshipsEntry = byName.get("xl/_rels/workbook.xml.rels");
  if (!workbookEntry || !relationshipsEntry) throw new Error("Workbook relationships are missing");

  const workbookDocument = parseXml(await decompressEntry(workbookEntry)).document;
  const relationshipsDocument = parseXml(await decompressEntry(relationshipsEntry)).document;
  const targets = new Map<string, string>();
  for (const relationship of getElementsByLocalName(relationshipsDocument, "Relationship")) {
    const id = relationship.getAttribute("Id");
    const target = relationship.getAttribute("Target");
    if (id && target) targets.set(id, normalizeZipPath("xl/workbook.xml", target));
  }

  const result = new Map<string, string>();
  for (const sheet of getElementsByLocalName(workbookDocument, "sheet")) {
    const name = sheet.getAttribute("name");
    const relationshipId = sheet.getAttribute("r:id")
      ?? sheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    const path = relationshipId ? targets.get(relationshipId) : undefined;
    if (name && path) result.set(name, path);
  }
  return result;
}

function saveBytes(bytes: Uint8Array, fileName: string) {
  const blob = new Blob([arrayBuffer(bytes)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function writePreservingOriginal(output: any, fileName: string) {
  if (!session) throw new Error("Original workbook is unavailable");
  const entries = parseZip(session.bytes);
  const entryByName = new Map(entries.map((entry) => [entry.name, entry]));
  const paths = await worksheetPaths(entries);
  const replacements = new Map<string, Uint8Array>();

  for (const name of output.SheetNames as string[]) {
    const layout = session.layouts[name];
    const path = paths.get(name);
    const entry = path ? entryByName.get(path) : undefined;
    if (!layout || !path || !entry) continue;
    const edits = collectSheetEdits(output, name, layout);
    if (!edits.length) continue;
    replacements.set(path, patchWorksheet(await decompressEntry(entry), edits));
  }

  if (!replacements.size) {
    saveBytes(session.bytes, fileName);
    return;
  }
  saveBytes(await writeZip(entries, replacements), fileName);
}

export function writeFile(output: any, fileName: string, options?: unknown) {
  if (!session || !/\.xlsx$/i.test(fileName)) {
    return RealXLSX.writeFile(output, fileName, options);
  }

  void writePreservingOriginal(output, fileName).catch((error) => {
    console.error("Could not preserve the original XLSX package; using standard export", error);
    RealXLSX.writeFile(output, fileName, options);
  });
}
