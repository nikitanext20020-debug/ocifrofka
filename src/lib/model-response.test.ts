import dns from "node:dns/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  callStructured,
  extractCompletionText,
  normalizeAssistantContent,
  parseJsonContent,
} from "@/lib/model-client";
import { cellChangesSchema, extractedRecordResponseSchema } from "@/lib/schemas";

describe("parseJsonContent", () => {
  it("parses JSON from a Markdown fence", () => {
    expect(parseJsonContent('```json\n{"topic":"Ремонт"}\n```')).toEqual({ topic: "Ремонт" });
  });

  it("extracts a balanced JSON object from explanatory text", () => {
    const content = 'Результат распознавания:\n{"topic":"Ремонт {крыши}","phone":"8\\"999"}\nГотово.';
    expect(parseJsonContent(content)).toEqual({ topic: "Ремонт {крыши}", phone: '8"999' });
  });
});

describe("normalizeAssistantContent", () => {
  it("joins text parts returned by an OpenAI-compatible provider", () => {
    expect(
      normalizeAssistantContent([
        { type: "text", text: '{"topic":' },
        { type: "text", text: '"Ремонт"}' },
      ]),
    ).toBe('{"topic":\n"Ремонт"}');
  });

  it("serializes an already parsed JSON object", () => {
    expect(normalizeAssistantContent({ topic: "Ремонт" })).toBe('{"topic":"Ремонт"}');
  });

  it("reads nested output text blocks", () => {
    expect(normalizeAssistantContent([
      { type: "message", content: [{ type: "output_text", text: '{"topic":"Ремонт"}' }] },
    ])).toBe('{"topic":"Ремонт"}');
  });
});

describe("extractCompletionText", () => {
  it("reads the standard chat-completions envelope", () => {
    expect(extractCompletionText({
      choices: [{ message: { content: '{"mapping":{}}' } }],
    })).toBe('{"mapping":{}}');
  });

  it("reads Responses-style output blocks", () => {
    expect(extractCompletionText({
      output: [{ content: [{ type: "output_text", text: '{"mapping":{}}' }] }],
    })).toBe('{"mapping":{}}');
  });

  it("uses provider reasoning fields only when final content is empty", () => {
    expect(extractCompletionText({
      choices: [{ message: { content: "", reasoning: '{"mapping":{}}' } }],
    })).toBe('{"mapping":{}}');
  });

  it("returns an empty string for an empty successful envelope", () => {
    expect(extractCompletionText({ choices: [{ message: { content: null } }] })).toBe("");
  });
});

describe("callStructured", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("retries an empty provider response and disables DeepSeek thinking for JSON", async () => {
    vi.spyOn(dns, "lookup").mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
    ] as unknown as Awaited<ReturnType<typeof dns.lookup>>);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "" }, finish_reason: "stop" }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: '{"value":"готово"}' }, finish_reason: "stop" }],
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(callStructured({
      config: {
        baseUrl: "https://api.example.com/v1",
        apiKey: "test",
        model: "deepseek/deepseek-v4-flash",
      },
      messages: [{ role: "user", content: "Верни JSON" }],
      schema: z.object({ value: z.string() }),
    })).resolves.toEqual({ value: "готово" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstRequest = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const secondRequest = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(firstRequest.thinking).toEqual({ type: "disabled" });
    expect(secondRequest.messages).toEqual([
      { role: "user", content: "Верни JSON" },
      {
        role: "user",
        content: "Предыдущий ответ был пустым. Верни только валидный JSON строго по заданной структуре, без Markdown и пояснений.",
      },
    ]);
  });
});

describe("cellChangesSchema", () => {
  it("accepts direct arrays and string row indexes from providers", () => {
    expect(cellChangesSchema.parse([
      { row: "12", column: "3", value: "готово" },
    ])).toEqual({ changes: [{ row: 12, column: 3, value: "готово" }] });
  });

  it("accepts an updates envelope", () => {
    expect(cellChangesSchema.parse({
      updates: [{ row: 1, column: 2, value: true }],
    })).toEqual({ changes: [{ row: 1, column: 2, value: "true" }] });
  });
});

describe("extractedRecordResponseSchema", () => {
  it("normalizes numeric, null and missing OCR values", () => {
    expect(
      extractedRecordResponseSchema.parse({
        topic: "Ремонт крыши",
        full_name: "Иванов Иван Иванович",
        birth_date: null,
        address: "",
        phone: 89991234567,
        confidence_notes: null,
      }),
    ).toEqual({
      topic: "Ремонт крыши",
      full_name: "Иванов Иван Иванович",
      birth_date: "-",
      address: "-",
      phone: "89991234567",
      confidence_notes: "",
    });
  });
});
