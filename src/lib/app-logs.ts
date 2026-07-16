"use client";

export type AppLogLevel = "info" | "warning" | "error";

export type AppLogEntry = {
  id: string;
  timestamp: string;
  level: AppLogLevel;
  area: string;
  message: string;
  status?: number;
  durationMs?: number;
  details?: Record<string, string | number | boolean | null>;
};

export const APP_LOG_STORAGE_KEY = "digitizer-diagnostic-logs-v1";
const APP_LOG_EVENT = "digitizer-diagnostic-logs-updated";
const MAX_LOG_ENTRIES = 200;
const MAX_TEXT_LENGTH = 500;
const PRIVATE_DETAIL_KEY = /(?:api.?key|authorization|token|secret|password|image|prompt|address|full.?name|first.?name|last.?name|middle.?name|phone|e.?mail|record|row|body|payload|content|file)/i;

type LogInput = Omit<AppLogEntry, "id" | "timestamp" | "details"> & {
  details?: Record<string, unknown>;
};

function shortText(value: unknown) {
  return String(value ?? "")
    .replace(/\bsk-[a-z0-9_-]{8,}\b/gi, "[ключ скрыт]")
    .replace(/\b(authorization|api[_ -]?key|token|password)\s*[:=]\s*[^\s,;]+/gi, "$1=[скрыто]")
    .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, "[email скрыт]")
    .replace(/\+?7[\s(.-]*\d{3}[\s).-]*\d{3}[\s.-]*\d{2}[\s.-]*\d{2}/g, "[телефон скрыт]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
}

function safeDetails(details?: Record<string, unknown>) {
  if (!details) return undefined;
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(details).slice(0, 20)) {
    if (PRIVATE_DETAIL_KEY.test(key)) {
      result[key] = "[скрыто]";
    } else if (value === null || typeof value === "number" || typeof value === "boolean") {
      result[key] = value;
    } else if (typeof value === "string") {
      result[key] = shortText(value);
    }
  }
  return Object.keys(result).length ? result : undefined;
}

function isAppLogEntry(value: unknown): value is AppLogEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<AppLogEntry>;
  return typeof entry.id === "string"
    && typeof entry.timestamp === "string"
    && ["info", "warning", "error"].includes(entry.level ?? "")
    && typeof entry.area === "string"
    && typeof entry.message === "string";
}

export function readAppLogs() {
  if (typeof localStorage === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(APP_LOG_STORAGE_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter(isAppLogEntry).slice(0, MAX_LOG_ENTRIES) : [];
  } catch {
    return [];
  }
}

function notifyLogsChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(APP_LOG_EVENT));
}

export function appendAppLog(input: LogInput) {
  if (typeof localStorage === "undefined") return;
  const details = safeDetails(input.details);
  const entry: AppLogEntry = {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    timestamp: new Date().toISOString(),
    level: input.level,
    area: shortText(input.area) || "Приложение",
    message: shortText(input.message) || "Событие без описания",
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.durationMs === undefined ? {} : { durationMs: Math.max(0, Math.round(input.durationMs)) }),
    ...(details ? { details } : {}),
  };

  try {
    localStorage.setItem(
      APP_LOG_STORAGE_KEY,
      JSON.stringify([entry, ...readAppLogs()].slice(0, MAX_LOG_ENTRIES)),
    );
    notifyLogsChanged();
  } catch {
    // Diagnostics must never break the main workflow, including on storage quota errors.
  }
}

export function logAppError(area: string, error: unknown, details?: Record<string, unknown>) {
  appendAppLog({
    level: "error",
    area,
    message: error instanceof Error ? error.message : String(error ?? "Неизвестная ошибка"),
    details,
  });
}

export function clearAppLogs() {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(APP_LOG_STORAGE_KEY);
  notifyLogsChanged();
}

export function subscribeAppLogs(listener: () => void) {
  if (typeof window === "undefined") return () => undefined;
  const onStorage = (event: StorageEvent) => {
    if (event.key === APP_LOG_STORAGE_KEY) listener();
  };
  window.addEventListener(APP_LOG_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(APP_LOG_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

function requestPath(input: RequestInfo | URL) {
  const raw = input instanceof Request ? input.url : String(input);
  try {
    return new URL(raw, typeof window === "undefined" ? "http://localhost" : window.location.origin).pathname;
  } catch {
    return raw.split("?")[0].slice(0, 120);
  }
}

async function responseErrorMessage(response: Response) {
  if (response.ok) return "";
  try {
    const payload = await response.clone().json() as { error?: unknown };
    return typeof payload?.error === "string" ? shortText(payload.error) : "";
  } catch {
    return "";
  }
}

export async function loggedFetch(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  context: {
    area: string;
    action: string;
    details?: Record<string, unknown>;
  },
) {
  const startedAt = Date.now();
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  const path = requestPath(input);
  try {
    const response = await fetch(input, init);
    const serverMessage = await responseErrorMessage(response);
    appendAppLog({
      level: response.ok ? "info" : response.status === 429 ? "warning" : "error",
      area: context.area,
      message: response.ok
        ? `${context.action}: запрос выполнен`
        : `${context.action}: ${serverMessage || `сервер вернул HTTP ${response.status}`}`,
      status: response.status,
      durationMs: Date.now() - startedAt,
      details: { method, path, online: navigator.onLine, ...context.details },
    });
    return response;
  } catch (error) {
    appendAppLog({
      level: "error",
      area: context.area,
      message: `${context.action}: ${error instanceof Error ? error.message : "сетевая ошибка"}`,
      durationMs: Date.now() - startedAt,
      details: { method, path, online: navigator.onLine, ...context.details },
    });
    throw error;
  }
}

export function diagnosticExport(logs: AppLogEntry[]) {
  return {
    exportedAt: new Date().toISOString(),
    application: "Оцифровка обращений",
    page: typeof location === "undefined" ? "" : location.origin,
    browser: typeof navigator === "undefined" ? "" : navigator.userAgent,
    online: typeof navigator === "undefined" ? null : navigator.onLine,
    privacy: "API-ключи, содержимое файлов, таблиц и персональные данные не записываются.",
    logs,
  };
}

export function diagnosticText(logs: AppLogEntry[]) {
  const metadata = diagnosticExport(logs);
  const lines = [
    "Оцифровка обращений — диагностический журнал",
    `Экспортировано: ${metadata.exportedAt}`,
    `Страница: ${metadata.page}`,
    `Браузер: ${metadata.browser}`,
    `Онлайн: ${String(metadata.online)}`,
    metadata.privacy,
    "",
  ];
  for (const entry of logs) {
    const metrics = [
      entry.status === undefined ? "" : `HTTP ${entry.status}`,
      entry.durationMs === undefined ? "" : `${entry.durationMs} мс`,
    ].filter(Boolean).join(", ");
    lines.push(`[${entry.timestamp}] ${entry.level.toUpperCase()} · ${entry.area}${metrics ? ` · ${metrics}` : ""}`);
    lines.push(entry.message);
    if (entry.details) lines.push(JSON.stringify(entry.details));
    lines.push("");
  }
  return lines.join("\n");
}
