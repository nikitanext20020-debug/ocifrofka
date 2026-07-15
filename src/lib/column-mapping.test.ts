import { describe, expect, it } from "vitest";
import { refineColumnMapping } from "@/lib/column-mapping";
import type { ColumnMapping } from "@/lib/types";

describe("refineColumnMapping", () => {
  it("uses the descriptive header row from the uploaded workbook", () => {
    const headers = ["A", "", "C", "D", "E", "F", "G", "H", "I", "J", "K", "Колонка 12", "M"];
    const rows = [[
      "",
      "МУНИЦИПАЛИТЕТ",
      "Адрес проживания",
      "Фамилия",
      "Имя",
      "Отчество",
      "Дата",
      "Номер мобильного телефона",
      "E-mail",
      "Вовлеченность в деятельность Партии",
      "Тематика предложения",
      "Направление обращения",
      "Текст наказа",
    ]];
    const modelMapping: ColumnMapping = {
      topic: 11,
      full_name: 3,
      last_name: null,
      first_name: null,
      middle_name: null,
      birth_date: 6,
      address: 2,
      phone: 7,
    };

    expect(refineColumnMapping(headers, rows, modelMapping)).toEqual({
      topic: 10,
      full_name: null,
      last_name: 3,
      first_name: 4,
      middle_name: 5,
      birth_date: 6,
      address: 2,
      phone: 7,
    });
  });

  it("keeps model inference for technical columns when no descriptive headers exist", () => {
    const mapping: ColumnMapping = {
      topic: 10,
      full_name: null,
      last_name: 3,
      first_name: 4,
      middle_name: 5,
      birth_date: 6,
      address: 2,
      phone: 7,
    };
    expect(refineColumnMapping(["A", "B", "C"], [["1", "2", "3"]], mapping)).toEqual(mapping);
  });
});
