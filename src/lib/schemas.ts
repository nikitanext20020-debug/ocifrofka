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

export const tableAnalysisSchema = z.object({
  mapping: z.object({
    topic: nullableColumnSchema,
    full_name: nullableColumnSchema,
    birth_date: nullableColumnSchema,
    address: nullableColumnSchema,
    phone: nullableColumnSchema,
  }),
  formats: z.object({
    topic: z.string(),
    full_name: z.string(),
    birth_date: z.string(),
    address: z.string(),
    phone: z.string(),
  }),
});

export const normalizedRecordsSchema = z.object({
  records: z.array(
    z.object({
      topic: recordValueSchema,
      full_name: recordValueSchema,
      birth_date: recordValueSchema,
      address: recordValueSchema,
      phone: recordValueSchema,
    }),
  ),
});

export const cellChangeSchema = z.object({
  row: z.number().int().nonnegative(),
  column: z.number().int().nonnegative(),
  value: z.union([z.string(), z.number(), z.boolean()]).transform(String),
});

export const cellChangesSchema = z.object({ changes: z.array(cellChangeSchema) });
