import { describe, expect, it } from "vitest";
import { normalizeAssistantContent, parseJsonContent } from "@/lib/model-client";
import { extractedRecordResponseSchema } from "@/lib/schemas";

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
