import { describe, expect, it } from "vitest";
import { analyzeTableDeterministically, refineColumnMapping } from "@/lib/column-mapping";
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
      topic: 10,
      full_name: 3,
      last_name: null,
      first_name: null,
      middle_name: null,
      birth_date: 6,
      address: 2,
      phone: 7,
    };

    expect(refineColumnMapping(headers, rows, modelMapping)).toEqual({
      topic: 12,
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

describe("analyzeTableDeterministically", () => {
  it("analyzes a spreadsheet with explicit business headers without a model", () => {
    const headers = [
      "Текст наказа",
      "МУНИЦИПАЛИТЕТ",
      "Адрес проживания в формате: населенный пункт, улица, дом",
      "Фамилия",
      "Имя",
      "Отчество",
      "Дата рождения в формате: 01.01.2000",
      "Номер мобильного телефона СТРОГО В ФОРМАТЕ +7(999)999-99-99",
    ];
    const rows = [[
      "Отремонтировать дорогу.",
      "Богородский г.о.",
      "Ногинск, ул. Дружбы, д. 8",
      "Головника",
      "Надежда",
      "Владимировна",
      "11.05.1957",
      "7(963)983-62-52",
    ]];

    expect(analyzeTableDeterministically(headers, rows)).toEqual({
      mapping: {
        topic: 0,
        full_name: null,
        last_name: 3,
        first_name: 4,
        middle_name: 5,
        birth_date: 6,
        address: 2,
        phone: 7,
      },
      formats: {
        topic: "текст обращения",
        full_name: "фамилия, имя и отчество в отдельных колонках",
        birth_date: "ДД.ММ.ГГГГ",
        address: "текстовый адрес",
        phone: "7(999)999-99-99 без знака +",
      },
    });
  });

  it("falls back to the model for ambiguous technical headers", () => {
    expect(analyzeTableDeterministically(["A", "B"], [["1", "2"]])).toBeNull();
  });
});
