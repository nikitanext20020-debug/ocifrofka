import { z } from "zod";

export type GeneratedRowSource = unknown[] | Record<string, unknown>;

function rowsFromContainer(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return null;

  const entries = Object.entries(value);
  if (!entries.length) return [];
  if (!entries.every(([key]) => /^\d+$/.test(key))) return null;
  return entries
    .sort(([left], [right]) => Number(left) - Number(right))
    .map(([, row]) => row);
}

function unwrapGeneratedRows(value: unknown): unknown {
  if (Array.isArray(value)) return { rows: value };
  if (!value || typeof value !== "object") return value;

  const record = value as Record<string, unknown>;
  for (const key of ["rows", "generatedRows", "data", "result"]) {
    if (!(key in record)) continue;
    const rows = rowsFromContainer(record[key]);
    if (rows) return { rows };
    const nested = unwrapGeneratedRows(record[key]);
    if (nested && typeof nested === "object" && "rows" in nested) return nested;
  }
  return value;
}

const generatedRowSchema = z.union([
  z.array(z.unknown()),
  z.record(z.string(), z.unknown()),
]);

/** Accepts the common wrappers and both positional and indexed model rows. */
export const generatedRowsSchema = z.preprocess(
  unwrapGeneratedRows,
  z.object({ rows: z.array(generatedRowSchema).min(1) }),
);

function normalizedHeader(value: unknown) {
  return String(value ?? "")
    .toLocaleLowerCase("ru-RU")
    .replaceAll("ё", "е")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .trim();
}

function columnForKey(key: string, headers: string[]) {
  const normalizedKey = normalizedHeader(key);
  const exactHeader = headers.findIndex((header) => normalizedHeader(header) === normalizedKey);
  if (exactHeader >= 0) return exactHeader;

  if (/^\d+$/.test(key.trim())) return Number(key.trim());
  const indexed = normalizedKey.match(/^(?:column|col|колонка)\s*(\d+)$/);
  return indexed ? Number(indexed[1]) : -1;
}

function cellsToRow(cells: unknown[], headers: string[]) {
  if (!cells.every((cell) => cell && typeof cell === "object" && "column" in cell && "value" in cell)) {
    return cells.slice(0, headers.length).map((value) => String(value ?? "").trim());
  }

  const row = Array.from({ length: headers.length }, () => "");
  for (const cell of cells as Array<{ column: unknown; value: unknown }>) {
    const column = Number(cell.column);
    if (Number.isInteger(column) && column >= 0 && column < row.length) {
      row[column] = String(cell.value ?? "").trim();
    }
  }
  return row;
}

/** Converts model rows to the table's exact width without trusting object key order. */
export function normalizeGeneratedModelRows(sources: GeneratedRowSource[], headers: string[]) {
  return sources.map((source) => {
    if (Array.isArray(source)) {
      const values = cellsToRow(source, headers);
      return Array.from({ length: headers.length }, (_, column) => values[column] ?? "");
    }

    const nested = source.values ?? source.cells ?? source.data;
    if (Array.isArray(nested)) {
      const values = cellsToRow(nested, headers);
      return Array.from({ length: headers.length }, (_, column) => values[column] ?? "");
    }
    const values = nested && typeof nested === "object"
      ? nested as Record<string, unknown>
      : source;
    const row = Array.from({ length: headers.length }, () => "");
    for (const [key, rawValue] of Object.entries(values)) {
      const column = columnForKey(key, headers);
      if (column >= 0 && column < row.length) row[column] = String(rawValue ?? "").trim();
    }
    return row;
  });
}
