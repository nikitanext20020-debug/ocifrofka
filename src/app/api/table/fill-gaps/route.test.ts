import dns from "node:dns/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/table/fill-gaps/route";

describe("fill-gaps route", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns accepted first-pass changes when the retry fails", async () => {
    vi.spyOn(dns, "lookup").mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
    ] as unknown as Awaited<ReturnType<typeof dns.lookup>>);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          changes: [{ row: 12, column: 0, value: "Иванов" }],
        }) } }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "temporary" } }), { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(new Request("http://localhost/api/table/fill-gaps", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-agent-base-url": "https://api.example.com/v1",
        "x-agent-api-key": "test",
        "x-agent-model": "test-model",
      },
      body: JSON.stringify({
        headers: ["Фамилия", "Имя"],
        rows: [{ row: 12, values: ["", ""] }],
        gaps: [{ row: 12, column: 0 }, { row: 12, column: 1 }],
        examples: [],
        formats: {},
        categoricals: {},
        instruction: "",
      }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      changes: [{ row: 12, column: 0, value: "Иванов" }],
      missing: 1,
      warning: "Часть пропусков заполнена; повторная попытка для оставшихся ячеек не удалась.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
