import { describe, expect, it } from "vitest";
import { analyzeTableDeterministically, refineColumnMapping, sampleColumnValues } from "@/lib/column-mapping";
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

    const { mapping } = refineColumnMapping(headers, rows, modelMapping);
    expect(mapping).toEqual({
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
    expect(refineColumnMapping(["A", "B", "C"], [["1", "2", "3"]], mapping).mapping).toEqual(mapping);
  });

  it("picks the column whose data matches the field heuristic over the header-matched column", () => {
    // Col 0: header "Адрес проживания" but contains municipality names (no street keywords).
    // Col 1: no recognisable header but contains real street addresses.
    const headers = ["Адрес проживания", "Колонка 2", "Фамилия", "Дата", "Номер мобильного телефона"];
    const rows = [
      ["Богородский г.о.",  "Ногинск, ул. Дружбы, д. 8", "Иванов", "11.05.1957", "7(963)983-62-52"],
      ["Щёлковский г.о.", "Щёлково, просп. Ленина, д. 1", "Петров", "03.07.1981", "7(916)111-22-33"],
    ];
    const modelMapping: ColumnMapping = {
      topic: null, full_name: null,
      last_name: 2, first_name: null, middle_name: null,
      birth_date: 3, address: 0, phone: 4,
    };
    const { mapping, conflicts } = refineColumnMapping(headers, rows, modelMapping);
    // Address should resolve to col 1 (contains street addresses) not col 0 (municipalities).
    expect(mapping.address).toBe(1);
    expect(conflicts).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "address", headerColumn: 0, dataColumn: 1 })]),
    );
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

    expect(analyzeTableDeterministically(headers, rows)).toMatchObject({
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

describe("sampleColumnValues", () => {
  const rows = [["Иванов", "7(963)983-62-52"], ["-", "7(916)111-22-33"], ["", "7(900)000-00-00"]];

  it("returns non-empty, non-dash values from the specified column", () => {
    expect(sampleColumnValues(rows, 0)).toEqual(["Иванов"]);
  });

  it("limits results to n items", () => {
    expect(sampleColumnValues(rows, 1, 2)).toEqual(["7(963)983-62-52", "7(916)111-22-33"]);
  });

  it("returns empty array for an out-of-range column", () => {
    expect(sampleColumnValues(rows, 5)).toEqual([]);
  });
});
