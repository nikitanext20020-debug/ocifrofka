import type { ColumnMapping, MappableField, RecordField } from "@/lib/types";

const HEADER_ALIASES: Record<MappableField, RegExp[]> = {
  topic: [
    /^тема$/,
    /^тема наказа$/,
    /^текст наказа$/,
    /^текст обращения$/,
  ],
  full_name: [
    /^фио(?: заявителя)?$/,
    /^ф и о(?: заявителя)?$/,
    /^фамилия имя отчество$/,
  ],
  last_name: [/^фамилия(?: заявителя)?$/],
  first_name: [/^имя(?: заявителя)?$/],
  middle_name: [/^отчество(?: заявителя)?$/],
  birth_date: [
    /^дата$/,
    /^дата рождения(?: в формате.*)?$/,
    /^дата рожд$/,
  ],
  address: [
    /^адрес$/,
    /^адрес проживания(?: в формате.*)?$/,
    /^место жительства$/,
    /^адрес регистрации$/,
  ],
  phone: [
    /^телефон$/,
    /^номер телефона$/,
    /^мобильный телефон$/,
    /^номер мобильного телефона(?: строго)?(?: в формате.*)?$/,
    /^контактный телефон$/,
  ],
};

const DESCRIPTIVE_HEADER_ALIASES = [
  /^муниципалитет$/,
  /^адрес проживания(?: в формате.*)?$/,
  /^фамилия$/,
  /^имя$/,
  /^отчество$/,
  /^дата(?: рождения)?(?: в формате.*)?$/,
  /^номер мобильного телефона(?: строго)?(?: в формате.*)?$/,
  /^e mail$/,
  /^вовлеченность в деятельность партии(?: единая россия)?$/,
  /^тематика (?:предложения|обращения)$/,
  /^направление обращения$/,
  /^текст наказа$/,
];

function normalizeHeader(value: unknown) {
  return String(value ?? "")
    .toLocaleLowerCase("ru-RU")
    .replaceAll("ё", "е")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .trim();
}

/** Returns up to `n` non-empty, non-dash column values from the data rows. */
export function sampleColumnValues(rows: unknown[][], column: number, n = 20): string[] {
  const result: string[] = [];
  for (const row of rows) {
    if (result.length >= n) break;
    const value = String(row[column] ?? "").trim();
    if (value && value !== "-") result.push(value);
  }
  return result;
}

function matchesRatio(samples: string[], predicate: (v: string) => boolean): boolean {
  if (samples.length < 3) return false;
  const matches = samples.filter(predicate).length;
  return matches / samples.length >= 0.5;
}

// Content heuristics: returns true when the column's sample values look like the field.
export const CONTENT_HEURISTICS: Partial<Record<MappableField, (samples: string[]) => boolean>> = {
  address: (samples) =>
    matchesRatio(samples, (v) => /(ул\.|улица|\bд\.|\bдом\b|просп|пер\.|мкр)/i.test(v)),
  phone: (samples) =>
    matchesRatio(samples, (v) => (v.match(/\d/g) ?? []).length >= 10),
  birth_date: (samples) =>
    matchesRatio(samples, (v) => /\d{1,2}\.\d{1,2}\.\d{4}/.test(v) || /\d{4}-\d{2}-\d{2}/.test(v)),
  full_name: (samples) =>
    matchesRatio(samples, (v) => {
      const words = v.split(/\s+/).filter(Boolean);
      return (
        words.length >= 2 &&
        words.length <= 3 &&
        words.every((w) => /^[А-ЯЁA-Z]/u.test(w))
      );
    }),
};

function fieldForHeader(value: unknown): MappableField | null {
  const normalized = normalizeHeader(value);
  if (!normalized) return null;
  for (const [field, aliases] of Object.entries(HEADER_ALIASES) as Array<[MappableField, RegExp[]]>) {
    if (aliases.some((alias) => alias.test(normalized))) return field;
  }
  return null;
}

function descriptiveHeaderScore(row: unknown[]) {
  return row.reduce<number>((score, value) => {
    const normalized = normalizeHeader(value);
    return score + (DESCRIPTIVE_HEADER_ALIASES.some((alias) => alias.test(normalized)) ? 1 : 0);
  }, 0);
}

/** Finds a real business-header row below an optional technical row. */
export function findDescriptiveHeaderRowIndex(matrix: unknown[][]) {
  let bestIndex = 0;
  let bestScore = descriptiveHeaderScore(matrix[0] ?? []);
  matrix.slice(1, 10).forEach((row, offset) => {
    const score = descriptiveHeaderScore(row);
    if (score > bestScore) {
      bestIndex = offset + 1;
      bestScore = score;
    }
  });
  return bestScore >= 3 ? bestIndex : 0;
}

function findEmbeddedHeaderRow(rows: unknown[][]) {
  let best: unknown[] | null = null;
  let bestScore = 0;
  for (const row of rows.slice(0, 10)) {
    const score = row.reduce<number>((total, value) => total + (fieldForHeader(value) ? 1 : 0), 0);
    if (score > bestScore) {
      best = row;
      bestScore = score;
    }
  }
  return bestScore >= 3 ? best : null;
}

export type MappingConflict = {
  field: MappableField;
  headerColumn: number;
  dataColumn: number;
};

/**
 * Makes obvious mappings deterministic instead of trusting a model to infer
 * them. Some source workbooks have a technical first row (A, C, D...) and put
 * the descriptive headers in the next row, so that row is considered too.
 *
 * Content validation: if the header-matched column's values don't pass the
 * field heuristic, but another column's values do, the data-matching column
 * wins and the discrepancy is recorded as a conflict.
 */
export function refineColumnMapping(
  headers: string[],
  rows: unknown[][],
  modelMapping: ColumnMapping,
): { mapping: ColumnMapping; conflicts: MappingConflict[] } {
  const mapping = { ...modelMapping };
  const embeddedHeaders = findEmbeddedHeaderRow(rows);
  const detected: Partial<Record<MappableField, number>> = {};

  headers.forEach((header, column) => {
    const field = fieldForHeader(header);
    if (field !== null && detected[field] === undefined) detected[field] = column;
  });
  embeddedHeaders?.forEach((header, column) => {
    const field = fieldForHeader(header);
    if (field !== null && detected[field] === undefined) detected[field] = column;
  });

  for (const field of ["topic", "birth_date", "address", "phone"] as const) {
    if (detected[field] !== undefined) mapping[field] = detected[field];
  }

  const detectedNameParts = ["last_name", "first_name", "middle_name"] as const;
  const hasSeparateNames = detectedNameParts.some((field) => detected[field] !== undefined);
  if (hasSeparateNames) {
    mapping.full_name = null;
    for (const field of detectedNameParts) {
      if (detected[field] !== undefined) mapping[field] = detected[field];
    }
  } else if (detected.full_name !== undefined) {
    mapping.full_name = detected.full_name;
    for (const field of detectedNameParts) mapping[field] = null;
  }

  // Content-based validation: for fields with a heuristic, check whether the
  // header-assigned column actually contains expected data. If not, search for
  // a better column among the remaining ones.
  const conflicts: MappingConflict[] = [];
  const contentFields = ["address", "phone", "birth_date", "full_name"] as const;
  for (const field of contentFields) {
    const heuristic = CONTENT_HEURISTICS[field];
    if (!heuristic) continue;
    const currentCol = mapping[field];
    if (currentCol === null || currentCol === undefined) continue;

    const currentSamples = sampleColumnValues(rows, currentCol);
    if (currentSamples.length > 0 && heuristic(currentSamples)) continue; // already OK

    // Header-matched column fails the heuristic — look for a better one.
    const betterCol = headers.findIndex((_, colIdx) => {
      if (colIdx === currentCol) return false;
      // Skip columns already assigned to another field.
      const alreadyUsed = (Object.values(mapping) as Array<number | null>).some(
        (v) => v === colIdx && v !== currentCol,
      );
      if (alreadyUsed) return false;
      const samples = sampleColumnValues(rows, colIdx);
      return samples.length > 0 && heuristic(samples);
    });

    if (betterCol >= 0) {
      conflicts.push({ field, headerColumn: currentCol, dataColumn: betterCol });
      mapping[field] = betterCol;
    }
  }

  return { mapping, conflicts };
}

function emptyMapping(): ColumnMapping {
  return {
    topic: null,
    full_name: null,
    last_name: null,
    first_name: null,
    middle_name: null,
    birth_date: null,
    address: null,
    phone: null,
  };
}

function hasCompleteCoreMapping(mapping: ColumnMapping) {
  const hasName = mapping.full_name !== null ||
    (mapping.last_name !== null && mapping.first_name !== null);
  return hasName && mapping.topic !== null && mapping.birth_date !== null &&
    mapping.address !== null && mapping.phone !== null;
}

function sampleValue(rows: unknown[][], column: number | null) {
  if (column === null) return "";
  for (const row of rows) {
    const value = String(row[column] ?? "").trim();
    if (value && value !== "-") return value;
  }
  return "";
}

function localFormats(mapping: ColumnMapping, rows: unknown[][]): Record<RecordField, string> {
  const birthDate = sampleValue(rows, mapping.birth_date);
  const phone = sampleValue(rows, mapping.phone);
  const birthDateFormat = /^\d{1,2}\.\d{1,2}\.\d{4}$/.test(birthDate)
    ? "ДД.ММ.ГГГГ"
    : /^\d{4}-\d{1,2}-\d{1,2}$/.test(birthDate)
      ? "ГГГГ-ММ-ДД"
      : "дата как в исходной таблице";
  const phoneFormat = /^\+?7\(\d{3}\)\d{3}-\d{2}-\d{2}$/.test(phone)
    ? "7(999)999-99-99 без знака +"
    : "телефон как в исходной таблице, без знака +";
  return {
    topic: "текст обращения",
    full_name: mapping.full_name !== null
      ? "Фамилия Имя Отчество в одной колонке"
      : "фамилия, имя и отчество в отдельных колонках",
    birth_date: birthDateFormat,
    address: "текстовый адрес",
    phone: phoneFormat,
  };
}

/** Avoids a model request when descriptive headers fully identify the table. */
export function analyzeTableDeterministically(headers: string[], rows: unknown[][]) {
  const { mapping, conflicts } = refineColumnMapping(headers, rows, emptyMapping());
  if (!hasCompleteCoreMapping(mapping)) return null;
  return { mapping, formats: localFormats(mapping, rows), conflicts };
}
