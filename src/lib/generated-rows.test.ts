import { describe, expect, it } from "vitest";
import { generatedRowsSchema, normalizeGeneratedModelRows } from "@/lib/generated-rows";

describe("generatedRowsSchema", () => {
  it("accepts indexed objects inside common provider envelopes", () => {
    expect(generatedRowsSchema.parse({
      data: {
        rows: {
          1: { 0: "Петров", 2: "Ногинск" },
          0: { 0: "Иванов", 2: "Электроугли" },
        },
      },
    })).toEqual({
      rows: [
        { 0: "Иванов", 2: "Электроугли" },
        { 0: "Петров", 2: "Ногинск" },
      ],
    });
  });
});

describe("normalizeGeneratedModelRows", () => {
  const headers = ["Колонка 1", "Фамилия", "Текст наказа"];

  it("maps object values by explicit zero-based column indexes", () => {
    expect(normalizeGeneratedModelRows([
      { 2: "Старый мост узкий. Расширение уберёт пробки.", 0: 3411, 1: "Иванов" },
    ], headers)).toEqual([
      ["3411", "Иванов", "Старый мост узкий. Расширение уберёт пробки."],
    ]);
  });

  it("maps object values by descriptive headers and ignores key order", () => {
    expect(normalizeGeneratedModelRows([
      { "Текст наказа": "Очередь в сад большая. Новый корпус поможет семьям.", Фамилия: "Петрова" },
    ], headers)).toEqual([
      ["", "Петрова", "Очередь в сад большая. Новый корпус поможет семьям."],
    ]);
  });

  it("pads short positional rows instead of rejecting the whole response", () => {
    expect(normalizeGeneratedModelRows([["1", "Сидоров"]], headers)).toEqual([
      ["1", "Сидоров", ""],
    ]);
  });
});
