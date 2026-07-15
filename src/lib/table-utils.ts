import type { CellChange, ColumnMapping, ExtractedRecord, MappableField, NamePartField, RecordField, TableData } from "@/lib/types";
import { NAME_PART_FIELDS, RECORD_FIELDS } from "@/lib/types";
import { findDescriptiveHeaderRowIndex } from "@/lib/column-mapping";

const MAPPABLE_FIELDS = [...RECORD_FIELDS, ...NAME_PART_FIELDS] as const;

function normalizedHeader(value: string) {
  return value.toLocaleLowerCase("ru-RU").replaceAll("ё", "е").replace(/[^a-zа-я0-9]+/gi, " ").trim();
}

function isDerivedCategoryHeader(value: string) {
  const header = normalizedHeader(value);
  return header.includes("тематика предложения") || header.includes("тематика обращения") || header.includes("направление обращения");
}

export function isBriefRecognizedText(value: unknown) {
  const normalized = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!normalized || normalized === "-") return false;
  const words = normalized.match(/[a-zа-яё0-9]+/gi) ?? [];
  return words.length > 0 && words.length <= 2 && normalized.length <= 40;
}

export function splitFullName(value: string): Record<NamePartField, string> {
  const normalized = value.trim().replace(/\s+/g, " ");
  const [lastName = "", firstName = "", ...middleName] = normalized.split(" ");
  return { last_name: lastName, first_name: firstName, middle_name: middleName.join(" ") };
}

function valuesForMapping(record: Record<RecordField, string>) {
  return { ...record, ...splitFullName(record.full_name) } satisfies Record<MappableField, string>;
}

export function isEmptyCell(value: unknown) {
  const normalized = String(value ?? "").trim();
  return !normalized || normalized === "-";
}

export function normalizeTable(matrix: unknown[][]): TableData {
  if (!matrix.length) return { headers: [], rows: [] };
  const headerRowIndex = findDescriptiveHeaderRowIndex(matrix);
  const rawHeaders = matrix[headerRowIndex] ?? [];
  const width = rawHeaders.reduce((last, value, index) => String(value ?? "").trim() ? index + 1 : last, 0);
  return {
    headers: Array.from({ length: width }, (_, index) => String(rawHeaders[index] ?? "").trim() || `Колонка ${index + 1}`),
    rows: matrix.slice(headerRowIndex + 1).map((row) => Array.from({ length: width }, (_, index) => row[index] ?? "")),
  };
}

export function applyCellChanges(rows: unknown[][], changes: CellChange[]) {
  const next = rows.map((row) => [...row]);
  for (const change of changes) {
    if (next[change.row] && change.column < next[change.row].length) next[change.row][change.column] = change.value;
  }
  return { rows: next, applied: changes };
}

export function findGapCells(table: TableData, mapping: ColumnMapping, targetRows: readonly number[]) {
  const gaps: Array<{ row: number; column: number }> = [];
  const categoryColumns = table.headers.map((header, column) => ({ header, column })).filter(({ header }) => isDerivedCategoryHeader(header)).map(({ column }) => column);
  for (const row of targetRows) {
    const data = table.rows[row];
    if (!data) continue;
    Object.values(mapping).forEach((column) => {
      if (column !== null && isEmptyCell(data[column])) gaps.push({ row, column });
    });
    if (mapping.topic !== null && (isEmptyCell(data[mapping.topic]) || isBriefRecognizedText(data[mapping.topic]))) {
      categoryColumns.forEach((column) => gaps.push({ row, column }));
    }
  }
  return gaps;
}

export function markSyntheticRowsForExport(table: TableData) { return table; }
export function recordForApi(record: ExtractedRecord) { return record as Record<RecordField, string>; }
export function appendRecords(table: TableData, records: Array<Record<RecordField, string>>, mapping: ColumnMapping) { return table; }
export function applyFixedColumnValues(rows: unknown[][]) { return { rows, applied: [] }; }
export function applyRecordCategories(rows: unknown[][]) { return { rows, applied: [] }; }
