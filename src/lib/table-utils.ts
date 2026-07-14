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
