import { describe, expect, it } from "vitest";
import { appendRecords, applyCellChanges, normalizeTable, recordsToCsv } from "@/lib/table-utils";
import type { ExtractedRecord } from "@/lib/types";

describe("normalizeTable", () => {
  it("creates stable names for empty headers and pads rows", () => {
    expect(normalizeTable([["ФИО", "", "Телефон"], ["Иванов", "Москва"]])).toEqual({
      headers: ["ФИО", "Колонка 2", "Телефон"],
      rows: [["Иванов", "Москва", ""]],
    });
  });
});

describe("applyCellChanges", () => {
  it("applies only in-range and explicitly allowed changes", () => {
    const result = applyCellChanges(
      [["A", "B"], ["C", "D"]],
      [
        { row: 0, column: 1, value: "ok" },
        { row: 1, column: 0, value: "blocked" },
        { row: 9, column: 0, value: "outside" },
      ],
      new Set(["0:1"]),
    );
    expect(result.rows).toEqual([["A", "ok"], ["C", "D"]]);
    expect(result.applied).toHaveLength(1);
  });
});

describe("appendRecords", () => {
  it("adds a row using column mapping without replacing unrelated columns", () => {
    const result = appendRecords(
      { headers: ["ID", "ФИО", "Телефон"], rows: [[1, "Петров", "8000"]] },
      [{ topic: "Тема", full_name: "Иванов Иван", birth_date: "-", address: "-", phone: "8999" }],
      { topic: null, full_name: 1, birth_date: null, address: null, phone: 2 },
    );
    expect(result.rows[1]).toEqual(["", "Иванов Иван", "8999"]);
  });
});

describe("recordsToCsv", () => {
  it("adds BOM and escapes quotes and commas", () => {
    const record: ExtractedRecord = {
      id: "1",
      sourceName: "doc.jpg",
      thumbnail: "data:image/jpeg;base64,",
      topic: "Ремонт, крыши",
      full_name: 'Иванов "Иван"',
      birth_date: "01.01.1990",
      address: "Москва",
      phone: "8999",
      confidence_notes: "",
    };
    const csv = recordsToCsv([record]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"Ремонт, крыши"');
    expect(csv).toContain('"Иванов ""Иван"""');
  });
});
