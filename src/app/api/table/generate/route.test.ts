import dns from "node:dns/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/table/generate/route";

describe("table generator route", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps a structurally valid first response when only the style check warns", async () => {
    vi.spyOn(dns, "lookup").mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
    ] as unknown as Awaited<ReturnType<typeof dns.lookup>>);
    const rows = Array.from({ length: 5 }, (_, index) => ({
      0: `Почините объект номер ${index + 1}. Жителям станет удобнее.`,
    }));
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ rows }) } }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(new Request("http://localhost/api/table/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-agent-base-url": "https://api.example.com/v1",
        "x-agent-api-key": "test",
        "x-agent-model": "test-model",
      },
      body: JSON.stringify({
        count: 5,
        headers: ["Текст наказа"],
        examples: [],
        formats: {},
        categoricals: {},
        fixedValues: {},
        instruction: "",
      }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      rows: rows.map((row) => [row[0]]),
      warning: expect.stringContaining("повелительного глагола"),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const providerRequest = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(providerRequest.temperature).toBe(0.7);
  });
});
