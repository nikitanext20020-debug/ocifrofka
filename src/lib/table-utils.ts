import type {
  CellChange,
  ColumnMapping,
  ExtractedRecord,
  MappableField,
  NamePartField,
  RecordField,
  TableData,
} from "@/lib/types";
import { normalizeRuPhone } from "@/lib/phone";
import { NAME_PART_FIELDS, RECORD_FIELDS } from "@/lib/types";
import { findDescriptiveHeaderRowIndex } from "@/lib/column-mapping";

const MAPPABLE_FIELDS = [...RECORD_FIELDS, ...NAME_PART_FIELDS] as const;
const SPREADSHEET_ERROR_VALUES = new Set([
  "#CALC!",
  "#DIV/0!",
  "#ERROR!",
  "#FIELD!",
  "#GETTING_DATA",
  "#N/A",
  "#NAME?",
  "#NULL!",
  "#NUM!",
  "#REF!",
  "#SPILL!",
  "#VALUE!",
]);

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
  if (!normalized || normalized === "-") {
    return {
      last_name: normalized,
      first_name: normalized,
      middle_name: normalized,
    };
  }

  const [lastName = "", firstName = "", ...middleName] = normalized.split(" ");
  return {
    last_name: lastName,
    first_name: firstName,
    middle_name: middleName.join(" "),
  };
}

/**
 * Normalise a raw phone string for storage/API use.
 * Delegates to normalizeRuPhone; on invalid input returns the original value.
 * Always formats without the leading "+" (spreadsheets may interpret it as formula).
 */
export function normalizePhone(value: string) {
  return normalizeRuPhone(value, false).formatted;
}

function valuesForMapping(record: Record<RecordField, string>) {
  return {
    ...record,
    phone: normalizePhone(record.phone),
    ...splitFullName(record.full_name),
  } satisfies Record<MappableField, string>;
}

/** Merge-range descriptor matching SheetJS worksheet["!merges"]. */
type MergeRange = { s: { r: number; c: number }; e: { r: number; c: number } };

/**
 * Normalises a raw 2-D matrix (as produced by SheetJS sheet_to_json with
 * header:1) into a {headers, rows} TableData.
 *
 * @param merges - Optional list of merged-cell ranges from the worksheet
 *   (worksheet["!merges"]). When provided, the value of the top-left cell of
 *   each merge is copied into every cell of that range before the header row
 *   is detected, so merged column headers are never lost.
 *
 * Width policy: max(headerRow.length, maxDataRowLength). Empty header cells
 * receive the stable placeholder name "Колонка N" so they can be mapped.
 */
export function normalizeTable(matrix: unknown[][], merges?: MergeRange[]): TableData {
  if (matrix.length === 0) return { headers: [], rows: [] };

  // Expand merged cells: propagate top-left value to every cell in the range.
  let working = matrix;
  if (merges?.length) {
    working = matrix.map((row) => [...row]);
    for (const { s, e } of merges) {
      const topLeft = working[s.r]?.[s.c] ?? "";
      for (let r = s.r; r <= e.r; r++) {
        const row = working[r];
        if (!row) continue;
        for (let c = s.c; c <= e.c; c++) {
          if (r === s.r && c === s.c) continue;
          while (row.length <= c) row.push("");
          row[c] = topLeft;
        }
      }
    }
  }

  const headerRowIndex = findDescriptiveHeaderRowIndex(working);
  const rawHeaders = working[headerRowIndex] ?? [];
  const dataRows = working.slice(headerRowIndex + 1);

  // Width = max(header row length, longest data row). No cap at last named column.
  const headerWidth = rawHeaders.length;
  const dataWidth = dataRows.reduce((max, row) => Math.max(max, row.length), 0);
  const width = Math.max(headerWidth, dataWidth);

  const headers = Array.from({ length: width }, (_, index) => {
    const value = String(rawHeaders[index] ?? "").trim();
    return value || `Колонка ${index + 1}`;
  });
  const rows = dataRows.map((row) =>
    Array.from({ length: width }, (_, index) => row[index] ?? ""),
  );
  return { headers, rows };
}

export function applyRecordCategories(
  rows: unknown[][],
  targetRows: readonly number[],
  records: ReadonlyArray<{ categories?: Record<string, string> }>,
) {
  const next = rows.map((row) => [...row]);
  const applied: CellChange[] = [];
  targetRows.forEach((rowIndex, recordIndex) => {
    const row = next[rowIndex];
    if (!row) return;
    for (const [rawColumn, value] of Object.entries(records[recordIndex]?.categories ?? {})) {
      const column = Number(rawColumn);
      if (!Number.isInteger(column) || column < 0 || column >= row.length || !isEmptyCell(row[column])) continue;
      row[column] = value;
      applied.push({ row: rowIndex, column, value });
    }
  });
  return { rows: next, applied };
}

export function applyCellChanges(
  rows: unknown[][],
  changes: CellChange[],
  allowed?: Set<string>,
  emptyOnly = false,
) {
  const next = rows.map((row) => [...row]);
  const applied: CellChange[] = [];
  for (const change of changes) {
    const key = `${change.row}:${change.column}`;
    const explicitlyAllowed = allowed?.has(key) ?? false;
    if (
      change.row < 0 ||
      change.row >= next.length ||
      change.column < 0 ||
      change.column >= (next[change.row]?.length ?? 0) ||
      (allowed && !explicitlyAllowed) ||
      (emptyOnly && !isEmptyCell(next[change.row][change.column]))
    ) {
      continue;
    }
    next[change.row][change.column] = change.value;
    applied.push(change);
  }
  return { rows: next, applied };
}

export function applyFixedColumnValues(
  rows: unknown[][],
  targetRows: readonly number[],
  values: Record<number, string>,
) {
  const next = rows.map((row) => [...row]);
  const applied: CellChange[] = [];
  for (const rowIndex of [...new Set(targetRows)]) {
    const row = next[rowIndex];
    if (!row) continue;
    for (const [rawColumn, value] of Object.entries(values)) {
      const column = Number(rawColumn);
      if (!value || column < 0 || column >= row.length || row[column] === value) continue;
      row[column] = value;
      applied.push({ row: rowIndex, column, value });
    }
  }
  return { rows: next, applied };
}

export function markSyntheticRowsForExport(
  table: TableData,
  syntheticRows: readonly number[],
): TableData {
  if (!syntheticRows.length) return table;
  const headers = [...table.headers];
  let statusColumn = headers.findIndex((header) => header.trim().toLocaleLowerCase("ru-RU") === "статус данных");
  if (statusColumn === -1) {
    statusColumn = headers.length;
    headers.push("Статус данных");
  }
  const marked = new Set(syntheticRows);
  const rows = table.rows.map((source, rowIndex) => {
    const row = Array.from({ length: headers.length }, (_, column) => source[column] ?? "");
    if (marked.has(rowIndex)) row[statusColumn] = "Синтетические данные";
    return row;
  });
  return { headers, rows };
}

export function appendRecords(
  table: TableData,
  records: Array<Record<RecordField, string>>,
  mapping: ColumnMapping,
) {
  const added = records.map((record) => {
    const row = Array.from({ length: table.headers.length }, () => "");
    const values = valuesForMapping(record);
    for (const field of MAPPABLE_FIELDS) {
      const column = mapping[field];
      if (
        column !== null &&
        column < row.length &&
        !String(row[column] ?? "").trim()
      ) {
        row[column] = values[field];
      }
    }
    return row;
  });
  return { ...table, rows: [...table.rows, ...added] };
}

export function mergeGeneratedRowsAt(table: TableData, generatedRows: string[][], insertRowIndex: number) {
  const next = table.rows.map((row) => [...row]);
  const writtenRows: number[] = [];
  const applied: CellChange[] = [];

  generatedRows.forEach((generated, generatedIndex) => {
    if (!generated.some((value) => value.trim())) return;
    const rowIndex = insertRowIndex + generatedIndex;
    while (next.length <= rowIndex) next.push(Array.from({ length: table.headers.length }, () => ""));
    const target = next[rowIndex];
    const appliedBefore = applied.length;
    generated.slice(0, table.headers.length).forEach((value, column) => {
      if (!value.trim() || !isEmptyCell(target[column])) return;
      target[column] = value;
      applied.push({ row: rowIndex, column, value });
    });
    if (applied.length > appliedBefore) writtenRows.push(rowIndex);
  });

  return { rows: next, writtenRows, applied };
}

export function isEmptyCell(value: unknown) {
  const normalized = String(value ?? "").trim();
  return !normalized || normalized === "-" || SPREADSHEET_ERROR_VALUES.has(normalized.toUpperCase());
}

export type GapCell = {
  row: number;
  column: number;
  /** Present only for phone-column cells with non-empty, non-canonical values. */
  phoneStatus?: "fixable" | "invalid";
  /** Canonical formatted value (only when phoneStatus === "fixable"). */
  phoneFormatted?: string;
};

export function findGapCells(
  table: TableData,
  mapping: ColumnMapping,
  targetRows: readonly number[],
): GapCell[] {
  const mappedColumns = [...new Set(Object.values(mapping).filter(
    (column): column is number => column !== null,
  ))];
  const derivedCategoryColumns = table.headers
    .map((header, column) => ({ header, column }))
    .filter(({ header }) => isDerivedCategoryHeader(header))
    .map(({ column }) => column);
  const phoneColumn = mapping.phone;
  const gaps: GapCell[] = [];
  const seen = new Set<string>();
  const addTarget = (row: number, column: number, extra?: Omit<GapCell, "row" | "column">) => {
    const key = `${row}:${column}`;
    if (seen.has(key)) return;
    seen.add(key);
    gaps.push({ row, column, ...extra });
  };

  for (const rowIndex of [...new Set(targetRows)]) {
    const row = table.rows[rowIndex];
    if (!row) continue;
    mappedColumns.forEach((column) => {
      if (column >= table.headers.length) return;
      const cellValue = String(row[column] ?? "").trim();
      // Phone column: check for fixable / invalid non-empty values
      if (column === phoneColumn && !isEmptyCell(cellValue)) {
        const { status, formatted } = normalizeRuPhone(cellValue, false);
        if (status === "fixed") addTarget(rowIndex, column, { phoneStatus: "fixable", phoneFormatted: formatted });
        else if (status === "invalid") addTarget(rowIndex, column, { phoneStatus: "invalid" });
        // status === "ok" → already correct, skip
        return;
      }
      if (isEmptyCell(cellValue)) addTarget(rowIndex, column);
    });

    const topicColumn = mapping.topic;
    if (topicColumn === null || topicColumn >= table.headers.length) continue;
    const topicIsMissing = isEmptyCell(row[topicColumn]);
    const topicIsBrief = isBriefRecognizedText(row[topicColumn]);
    if (topicIsBrief) addTarget(rowIndex, topicColumn);

    if (topicIsMissing || topicIsBrief) {
      derivedCategoryColumns.forEach((column) => addTarget(rowIndex, column));
    }
  }
  return gaps;
}

export function recordForApi(record: ExtractedRecord) {
  return Object.fromEntries(
    RECORD_FIELDS.map((field) => [field, field === "phone" ? normalizePhone(record[field]) : record[field]]),
  ) as Record<RecordField, string>;
}

export function findInsertRow(table: TableData, mapping: ColumnMapping): number {
  const mappedColumns = [...new Set(Object.values(mapping).filter(
    (col): col is number => col !== null,
  ))];
  if (!mappedColumns.length || !table.rows.length) return 0;

  const monotoneColumns = new Set<number>();
  for (const col of mappedColumns) {
    const nonEmpty = table.rows
      .map((row) => String(row[col] ?? "").trim())
      .filter((v) => !isEmptyCell(v));
    if (nonEmpty.length < 2) continue;
    const freq = new Map<string, number>();
    for (const v of nonEmpty) freq.set(v, (freq.get(v) ?? 0) + 1);
    const maxCount = Math.max(...freq.values());
    if (maxCount / nonEmpty.length >= 0.95) monotoneColumns.add(col);
  }

  const activeCols = mappedColumns.filter((col) => !monotoneColumns.has(col));
  if (!activeCols.length) return 0;

  for (let i = table.rows.length - 1; i >= 0; i--) {
    const row = table.rows[i];
    const hasData = activeCols.some((col) => !isEmptyCell(row[col]));
    if (hasData) return i + 1;
  }
  return 0;
}

export function mergeRecordsAt(
  table: TableData,
  records: Array<Record<RecordField, string>>,
  mapping: ColumnMapping,
  insertRowIndex: number,
): { rows: unknown[][]; writtenRows: number[] } {
  const next = table.rows.map((row) => [...row]);
  const writtenRows: number[] = [];

  for (let i = 0; i < records.length; i++) {
    const rowIndex = insertRowIndex + i;
    if (rowIndex >= next.length) break;
    const record = records[i];
    const values = valuesForMapping(record);
    for (const field of MAPPABLE_FIELDS) {
      const col = mapping[field];
      if (col === null || col >= (next[rowIndex]?.length ?? 0)) continue;
      if (isEmptyCell(next[rowIndex][col])) {
        next[rowIndex][col] = values[field];
      }
    }
    writtenRows.push(rowIndex);
  }

  return { rows: next, writtenRows };
}

export function recordsToCsv(records: ExtractedRecord[]) {
  const headers = ["Тема", "ФИО", "Дата рождения", "Адрес", "Телефон", "Примечание"];
  const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const rows = records.map((record) =>
    [
      record.topic,
      record.full_name,
      record.birth_date,
      record.address,
      normalizePhone(record.phone),
      record.confidence_notes,
    ]
      .map(escape)
      .join(","),
  );
  return `\uFEFF${headers.map(escape).join(",")}\n${rows.join("\n")}`;
}
