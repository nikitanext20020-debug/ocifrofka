import { z } from "zod";

export const recordValueSchema = z.preprocess((value) => {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return value;
}, z.string().transform((value) => value.trim() || "-"));

const confidenceNotesSchema = z.preprocess((value) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return value;
}, z.string());

export const extractedRecordResponseSchema = z.object({
  topic: recordValueSchema,
  full_name: recordValueSchema,
  birth_date: recordValueSchema,
  address: recordValueSchema,
  phone: recordValueSchema,
  confidence_notes: confidenceNotesSchema,
});

const nullableColumnSchema = z.number().int().nonnegative().nullable();

export const columnMappingSchema = z.object({
  topic: nullableColumnSchema,
  full_name: nullableColumnSchema.default(null),
  last_name: nullableColumnSchema.default(null),
  first_name: nullableColumnSchema.default(null),
  middle_name: nullableColumnSchema.default(null),
  birth_date: nullableColumnSchema,
  address: nullableColumnSchema,
  phone: nullableColumnSchema,
});

export const tableAnalysisSchema = z.object({
  mapping: columnMappingSchema,
  formats: z.object({
    topic: z.string(),
    full_name: z.string(),
    birth_date: z.string(),
    address: z.string(),
    phone: z.string(),
  }),
});

const normalizedRecordSchema = z.object({
  topic: recordValueSchema,
  full_name: recordValueSchema,
  birth_date: recordValueSchema,
  address: recordValueSchema,
  phone: recordValueSchema,
  categories: z.preprocess(
    (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {},
    z.record(z.string(), recordValueSchema),
  ).default({}),
});

export const normalizedRecordsSchema = z.preprocess(
  (value) => {
    if (Array.isArray(value)) return { records: value };
    if (value && typeof value === "object" && "data" in value && Array.isArray(value.data)) {
      return { ...value, records: value.data };
    }
    return value;
  },
  z.object({ records: z.array(normalizedRecordSchema) }),
);

const cellChangeSchema = z.object({
  row: z.coerce.number().int().nonnegative(),
  column: z.coerce.number().int().nonnegative(),
  value: z.union([z.string(), z.number(), z.boolean()]).transform(String),
});

export const cellChangesSchema = z.preprocess(
  (value) => {
    if (Array.isArray(value)) return { changes: value };
    if (value && typeof value === "object") {
      if ("data" in value && Array.isArray(value.data)) return { changes: value.data };
      if ("updates" in value && Array.isArray(value.updates)) return { changes: value.updates };
    }
    return value;
  },
  z.object({ changes: z.array(cellChangeSchema) }),
);
