import { z } from "zod";
import { extractedRecordResponseSchema } from "@/lib/schemas";
import type { ExtractedRecord } from "@/lib/types";

const importedRecordSchema = extractedRecordResponseSchema.extend({
  id: z.string().optional(),
  sourceName: z.string().optional(),
  thumbnail: z.string().optional(),
});

const importedSessionSchema = z.array(importedRecordSchema).min(1).max(10_000);

export function parseRecognitionSession(
  input: unknown,
  createId: () => string,
): ExtractedRecord[] {
  const candidate = input && typeof input === "object" && !Array.isArray(input) && "records" in input
    ? (input as { records: unknown }).records
    : input;
  const records = importedSessionSchema.parse(candidate);

  return records.map((record, index) => ({
    ...record,
    id: createId(),
    sourceName: record.sourceName?.trim() || `Импортированная запись ${index + 1}`,
    thumbnail: record.thumbnail?.startsWith("data:image/") ? record.thumbnail : "",
  }));
}
