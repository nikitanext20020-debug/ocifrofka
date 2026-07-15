import type {
  CellChange,
  ColumnMapping,
  ExtractedRecord,
  MappableField,
  NamePartField,
  RecordField,
  TableData,
} from "@/lib/types";
import { NAME_PART_FIELDS, RECORD_FIELDS } from "@/lib/types";
import { findDescriptiveHeaderRowIndex } from "@/lib/column-mapping";

const MAPPABLE_FIELDS = [...RECORD_FIELDS, ...NAME_PART_FIELDS] as const;

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

function valuesForMapping(record: Record<RecordField, string>) {
  return {
    ...record,
    ...splitFullName(record.full_name),
  } satisfies Record<MappableField, string>;
}

export function normalizeTable(matrix: unknown[][]): TableData {
  if (matrix.length === 0) return { headers: [], rows: [] };
  const width = Math.max(...matrix.map((row) => row.length), 0);
  const headerRowIndex = findDescriptiveHeaderRowIndex(matrix);
  const rawHeaders = matrix[headerRowIndex] ?? [];
  const headers = Array.from({ length: width }, (_, index) => {
    const value = String(rawHeaders[index] ?? "").trim();
    return value || `Колонка ${index + 1}`;
  });
  const rows = matrix.slice(headerRowIndex + 1).map((row) =>
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
    if (
      change.row < 0 ||
      change.row >= next.length ||
      change.column < 0 ||
      change.column >= (next[change.row]?.length ?? 0) ||
      (allowed && !allowed.has(key)) ||
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

export function isEmptyCell(value: unknown) {
  const normalized = String(value ?? "").trim();
  return !normalized || normalized === "-";
}

export function findGapCells(
  table: TableData,
  mapping: ColumnMapping,
  targetRows: readonly number[],
) {
  const mappedColumns = [...new Set(Object.values(mapping).filter(
    (column): column is number => column !== null,
  ))];
  const gaps: Array<{ row: number; column: number }> = [];
  for (const rowIndex of [...new Set(targetRows)]) {
    const row = table.rows[rowIndex];
    if (!row) continue;
    mappedColumns.forEach((column) => {
      if (column < table.headers.length && isEmptyCell(row[column])) {
        gaps.push({ row: rowIndex, column });
      }
    });
  }
  return gaps;
}

export function recordForApi(record: ExtractedRecord) {
  return Object.fromEntries(
    RECORD_FIELDS.map((field) => [field, record[field]]),
  ) as Record<RecordField, string>;
}

/**
 * Finds the first row index (0-based into table.rows) where new records should
 * be inserted. Ignores «monotone» mapped columns — those where a single value
 * covers ≥ 95% of non-empty rows (e.g. a district name stamped on every row).
 * Returns the index right after the last row that has real data.
 */
export function findInsertRow(table: TableData, mapping: ColumnMapping): number {
  const mappedColumns = [...new Set(Object.values(mapping).filter(
    (col): col is number => col !== null,
  ))];
  if (!mappedColumns.length || !table.rows.length) return 0;

  // Detect monotone columns: one value covers ≥ 95 % of non-empty rows
  const monotoneColumns = new Set<number>();
  for (const col of mappedColumns) {
    const nonEmpty = table.rows
      .map((row) => String(row[col] ?? "").trim())
      .filter((v) => v !== "" && v !== "-");
    if (nonEmpty.length < 2) continue;
    const freq = new Map<string, number>();
    for (const v of nonEmpty) freq.set(v, (freq.get(v) ?? 0) + 1);
    const maxCount = Math.max(...freq.values());
    if (maxCount / nonEmpty.length >= 0.95) monotoneColumns.add(col);
  }

  const activeCols = mappedColumns.filter((col) => !monotoneColumns.has(col));
  if (!activeCols.length) return 0;

  // Scan backwards for the last row that has data in any active mapped column
  for (let i = table.rows.length - 1; i >= 0; i--) {
    const row = table.rows[i];
    const hasData = activeCols.some((col) => {
      const v = String(row[col] ?? "").trim();
      return v !== "" && v !== "-";
    });
    if (hasData) return i + 1;
  }
  return 0;
}

/**
 * Writes records into existing rows starting at insertRowIndex, filling only
 * empty cells in mapped columns (cells that already have a value are left
 * intact). Never appends rows beyond the current table length.
 * Returns the updated rows array and the list of row indices that were written.
 */
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
    if (rowIndex >= next.length) break; // do not add rows past the end
    const record = records[i];
    const values = valuesForMapping(record);
    for (const field of MAPPABLE_FIELDS) {
      const col = mapping[field];
      if (col === null || col >= (next[rowIndex]?.length ?? 0)) continue;
      const existing = String(next[rowIndex][col] ?? "").trim();
      if (!existing || existing === "-") {
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
      record.phone,
      record.confidence_notes,
    ]
      .map(escape)
      .join(","),
  );
  return `\uFEFF${headers.map(escape).join(",")}\n${rows.join("\n")}`;
}
