import type { ColumnMapping, MappableField } from "@/lib/types";

const HEADER_ALIASES: Record<MappableField, RegExp[]> = {
  topic: [
    /^тема$/,
    /^тематика$/,
    /^тема (предложения|обращения)$/,
    /^тематика (предложения|обращения)$/,
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
    /^дата рождения$/,
    /^дата рожд$/,
  ],
  address: [
    /^адрес$/,
    /^адрес проживания$/,
    /^место жительства$/,
    /^адрес регистрации$/,
  ],
  phone: [
    /^телефон$/,
    /^номер телефона$/,
    /^мобильный телефон$/,
    /^номер мобильного телефона$/,
    /^контактный телефон$/,
  ],
};

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
