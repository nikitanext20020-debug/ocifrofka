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

/**
 * Makes obvious mappings deterministic instead of trusting a model to infer
 * them. Some source workbooks have a technical first row (A, C, D...) and put
 * the descriptive headers in the next row, so that row is considered too.
 */
export function refineColumnMapping(
  headers: string[],
  rows: unknown[][],
  modelMapping: ColumnMapping,
): ColumnMapping {
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

  return mapping;
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
  const mapping = refineColumnMapping(headers, rows, emptyMapping());
  if (!hasCompleteCoreMapping(mapping)) return null;
  return { mapping, formats: localFormats(mapping, rows) };
}
