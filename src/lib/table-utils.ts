import type {
  CellChange,
  ColumnMapping,
  ExtractedRecord,
  RecordField,
  TableData,
} from "@/lib/types";
import { RECORD_FIELDS } from "@/lib/types";

export function normalizeTable(matrix: unknown[][]): TableData {
  if (matrix.length === 0) return { headers: [], rows: [] };
  const width = Math.max(...matrix.map((row) => row.length), 0);
  const rawHeaders = matrix[0] ?? [];
  const headers = Array.from({ length: width }, (_, index) => {
    const value = String(rawHeaders[index] ?? "").trim();
    return value || `Колонка ${index + 1}`;
  });
  const rows = matrix.slice(1).map((row) =>
    Array.from({ length: width }, (_, index) => row[index] ?? ""),
  );
  return { headers, rows };
}

export function applyCellChanges(
  rows: unknown[][],
  changes: CellChange[],
  allowed?: Set<string>,
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
      (allowed && !allowed.has(key))
    ) {
      continue;
    }
    next[change.row][change.column] = change.value;
    applied.push(change);
  }
  return { rows: next, applied };
}

export function appendRecords(
  table: TableData,
  records: Array<Record<RecordField, string>>,
  mapping: ColumnMapping,
) {
  const added = records.map((record) => {
    const row = Array.from({ length: table.headers.length }, () => "");
    for (const field of RECORD_FIELDS) {
      const column = mapping[field];
      if (column !== null && column < row.length) row[column] = record[field];
    }
    return row;
  });
  return { ...table, rows: [...table.rows, ...added] };
}

export function findGapCells(table: TableData, mapping: ColumnMapping) {
  const mappedColumns = Object.values(mapping).filter(
    (column): column is number => column !== null,
  );
  const gaps: Array<{ row: number; column: number }> = [];
  table.rows.forEach((row, rowIndex) => {
    mappedColumns.forEach((column) => {
      const value = String(row[column] ?? "").trim();
      if (!value || value === "-") gaps.push({ row: rowIndex, column });
    });
  });
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
  const mappedColumns = Object.values(mapping).filter(
    (col): col is number => col !== null,
  );
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
    for (const field of RECORD_FIELDS) {
      const col = mapping[field];
      if (col === null || col >= (next[rowIndex]?.length ?? 0)) continue;
      const existing = String(next[rowIndex][col] ?? "").trim();
      if (!existing || existing === "-") {
        next[rowIndex][col] = record[field];
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
