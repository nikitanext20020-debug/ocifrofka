import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendAppLog,
  loggedFetch,
  readAppLogs,
} from "@/lib/app-logs";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe("diagnostic app logs", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", new MemoryStorage());
    vi.stubGlobal("window", {
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      location: { origin: "https://example.test" },
    });
    vi.stubGlobal("navigator", { onLine: true, userAgent: "test-browser" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("redacts private detail fields while preserving diagnostic counters", () => {
    appendAppLog({
      level: "error",
      area: "Генератор",
      message: "Failed to fetch",
      details: {
        apiKey: "secret-value",
        address: "Ногинск, улица Мира",
        requestedCount: 100,
        columnCount: 13,
      },
    });

    expect(readAppLogs()[0]).toMatchObject({
      level: "error",
      area: "Генератор",
      message: "Failed to fetch",
      details: {
        apiKey: "[скрыто]",
        address: "[скрыто]",
        requestedCount: 100,
        columnCount: 13,
      },
    });
  });

  it("redacts common secrets and contacts from error messages", () => {
    appendAppLog({
      level: "error",
      area: "Тест",
      message: "api_key=secret-value email test@example.com phone +7(999)123-45-67 token=abc123",
    });

    const message = readAppLogs()[0].message;
    expect(message).toContain("api_key=[скрыто]");
    expect(message).toContain("[email скрыт]");
    expect(message).toContain("[телефон скрыт]");
    expect(message).toContain("token=[скрыто]");
    expect(message).not.toContain("secret-value");
    expect(message).not.toContain("test@example.com");
    expect(message).not.toContain("123-45-67");
  });

  it("keeps only the newest 200 entries", () => {
    for (let index = 0; index < 205; index += 1) {
      appendAppLog({ level: "info", area: "Тест", message: `Событие ${index}` });
    }

    const logs = readAppLogs();
    expect(logs).toHaveLength(200);
    expect(logs[0].message).toBe("Событие 204");
    expect(logs.at(-1)?.message).toBe("Событие 5");
  });

  it("records network failures with safe request metadata", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(loggedFetch(
      "/api/table/generate",
      { method: "POST", body: "private request body" },
      { area: "Генератор", action: "Создание строк", details: { requestedCount: 100 } },
    )).rejects.toThrow("Failed to fetch");

    expect(readAppLogs()[0]).toMatchObject({
      level: "error",
      area: "Генератор",
      message: "Создание строк: Failed to fetch",
      details: {
        method: "POST",
        path: "/api/table/generate",
        online: true,
        requestedCount: 100,
      },
    });
    expect(JSON.stringify(readAppLogs()[0])).not.toContain("private request body");
  });

  it("records a non-JSON gateway timeout instead of losing it behind a generic error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("Gateway Timeout", { status: 504, headers: { "Content-Type": "text/plain" } }),
    ));

    const response = await loggedFetch(
      "/api/table/generate",
      { method: "POST" },
      { area: "Генератор", action: "Создание строк", details: { requestedCount: 100 } },
    );

    expect(response.status).toBe(504);
    expect(readAppLogs()[0]).toMatchObject({
      level: "error",
      status: 504,
      message: "Создание строк: сервер вернул HTTP 504",
      details: { requestedCount: 100 },
    });
  });
});
