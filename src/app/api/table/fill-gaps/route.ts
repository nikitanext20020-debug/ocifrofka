import { z } from "zod";
import { apiError, callStructured, readAgentConfig } from "@/lib/model-client";
import { cellChangesSchema } from "@/lib/schemas";
import { isBriefRecognizedText, isEmptyCell } from "@/lib/table-utils";
import type { CellChange } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const