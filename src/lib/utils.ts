import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { AgentConfig } from "@/lib/types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function agentHeaders(config: AgentConfig, meta?: { kind: "vision" | "table"; index: number }) {
  return {
    "Content-Type": "application/json",
    "x-agent-base-url": config.baseUrl,
    "x-agent-api-key": config.apiKey,
    "x-agent-model": config.model,
    ...(meta ? { "x-agent-kind": meta.kind, "x-agent-index": String(meta.index) } : {}),
  };
}

export async function readApiResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as
    | { error?: string }
    | T
    | null;
  if (!response.ok) {
    const errorMessage =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : "Не удалось выполнить запрос к серверу.";
    throw new Error(errorMessage);
  }
  return payload as T;
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export function clone<T>(value: T): T {
  return structuredClone(value);
}
