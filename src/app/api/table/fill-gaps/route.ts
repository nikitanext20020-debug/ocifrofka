import { z } from "zod";
import { apiError, callStructured, readAgentConfig } from "@/lib/model-client";
import { cellChangesSchema } from "@/lib/schemas";
import { isBriefRecognizedText, isEmptyCell } from "@/lib/table-utils";

export const runtime = "nodejs";
export const maxDuration = 120;

const bodySchema = z.object({
  headers: z.array(z.string()).min(1