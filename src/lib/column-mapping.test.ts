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

  it("header match has priority over content heuristic — does NOT switch to a better-filled unnamed column", () => {
    // Col 0: header «Адрес проживания» — matched by header alias → priority.
    // Col 1: unnamed but full of street addresses (content heuristic would fire).
    // Under the new rule the header match wins; address stays at col 0.
    const headers = ["Адрес проживания", "Колонка 2", "Фамилия", "Дата", "Номер мобильного телефона"];
    const rows = [
      ["Богородский г.о.",  "Ногинск, ул. Дружбы, д. 8", "Иванов", "11.05.1957", "7(963)983-62-52"],
      ["Щёлковский г.о.", "Щёлково, просп. Ленина, д. 1", "Петров", "03.07.1981", "7(916)111-22-33"],
      ["Химки г.о.", "Химки, мкр. Фирсановка, д. 3", "Сидоров", "25.12.1990", "7(903)777-88-99"],
    ];
    const modelMapping: ColumnMapping = {
      topic: null, full_name: null,
      last_name: 2, first_name: null, middle_name: null,
      birth_date: 3, address: 0, phone: 4,
    };
    const { mapping, conflicts } = refineColumnMapping(headers, rows, modelMapping);
    // Header match → stays at col 0, no conflict generated.
    expect(mapping.address).toBe(0);
    expect(conflicts.find((c) => c.field === "address")).toBeUndefined();
  });

  it("content heuristic may still override a model-only assignment when model got it wrong", () => {
    // No header matches address. Model assigned col 0 (municipalities). Col 1 has real addresses.
    // Under the new rule: model assignment (no header) can be overridden by heuristic.
    const headers = ["Колонка 1", "Колонка 2", "Фамилия", "Дата", "Номер мобильного телефона"];
    const rows = [
      ["Богородский г.о.",  "Ногинск, ул. Дружбы, д. 8", "Иванов", "11.05.1957", "7(963)983-62-52"],
      ["Щёлковский г.о.", "Щёлково, просп. Ленина, д. 1", "Петров", "03.07.1981", "7(916)111-22-33"],
      ["Химки г.о.", "Химки, мкр. Фирсановка, д. 3", "Сидоров", "25.12.1990", "7(903)777-88-99"],
    ];
    const modelMapping: ColumnMapping = {
      topic: null, full_name: null,
      last_name: 2, first_name: null, middle_name: null,
      birth_date: 3, address: 0, phone: 4,
    };
    const { mapping, conflicts } = refineColumnMapping(headers, rows, modelMapping);
    // No header match → heuristic fires → overrides to col 1.
    expect(mapping.address).toBe(1);
    expect(conflicts).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "address", headerColumn: 0, dataColumn: 1 })]),
    );
  });

  it("header match wins over 200 synthetic addresses in unnamed column (regression test for the bug)", () => {
    // Col 0: «Адрес проживания в формате...» — half-empty (100 real, 100 empty)
    // Col 1: unnamed — 200 synthetic addresses that would fool the heuristic
    const headers = [
      "Адрес проживания в формате: город, ул., д.",
      "Колонка 2",
      "Фамилия",
      "Дата рождения",
      "Номер мобильного телефона",
    ];
    const rows = Array.from({ length: 200 }, (_, i) => [
      i < 100 ? `Ногинск, ул. Ленина, д. ${i + 1}` : "",
      `Щёлково, просп. Мира, д. ${i + 1}`,   // synthetic addresses in unnamed col
      "Иванов",
      "01.01.1990",
      "7(903)111-22-33",
    ]);
    const modelMapping: ColumnMapping = {
      topic: null, full_name: null,
      last_name: 2, first_name: null, middle_name: null,
      birth_date: 3, address: 0, phone: 4,
    };
    const { mapping, conflicts } = refineColumnMapping(headers, rows, modelMapping);
    // Header «Адрес проживания...» must win; address stays at col 0.
    expect(mapping.address).toBe(0);
    expect(conflicts.find((c) => c.field === "address")).toBeUndefined();
  });

  it("junk columns passed as junkColumns are never used as mapping targets", () => {
    // Col 0 is a junk/service column (single letter header) — model pointed address there.
    const headers = ["A", "Адрес проживания", "Фамилия", "Дата", "Номер мобильного телефона"];
    const rows = [
      ["1", "Ногинск, ул. Ленина, д. 1", "Иванов", "01.01.1990", "7(903)111-22-33"],
      ["2", "Щёлково, ул. Мира, д. 5", "Петров", "15.03.1985", "7(916)222-33-44"],
      ["3", "Химки, просп. Ленина, д. 3", "Сидоров", "22.07.1975", "7(905)333-44-55"],
    ];
    const modelMapping: ColumnMapping = {
      topic: null, full_name: null,
      last_name: 2, first_name: null, middle_name: null,
      birth_date: 3, address: 0, phone: 4,
    };
    // Col 0 is junk
    const junkColumns = new Set([0]);
    const { mapping } = refineColumnMapping(headers, rows, modelMapping, junkColumns);
    // Junk col 0 must be cleared; header alias matches col 1 → address = 1
    expect(mapping.address).toBe(1);
    expect(mapping.topic).toBeNull();
  });

  it("synthetic rows (Синтетические данные) are excluded from heuristic sampling", () => {
    // Col 0: «Адрес проживания» (header match) — mostly empty in real rows,
    //         but 200 synthetic rows in col 1 have addresses.
    // «Статус данных» col marks those rows as synthetic.
    // After exclusion, col 1 has 0 real-row samples → heuristic doesn't fire.
    const STATUS_COL = 5;
    const headers = [
      "Адрес проживания",
      "Колонка 2",
      "Фамилия",
      "Дата",
      "Номер мобильного телефона",
      "Статус данных",
    ];
    // 3 real rows (empty address in col 0, no data in col 1)
    const realRows = Array.from({ length: 3 }, () => [
      "", "", "Иванов", "01.01.1990", "7(903)111-22-33", "",
    ]);
    // 200 synthetic rows with addresses in col 1
    const syntheticRows = Array.from({ length: 200 }, (_, i) => [
      "",
      `Ногинск, ул. Ленина, д. ${i + 1}`,
      "Петров",
      "01.01.1985",
      "7(916)222-33-44",
      "Синтетические данные",
    ]);
    const rows = [...realRows, ...syntheticRows];
    const modelMapping: ColumnMapping = {
      topic: null, full_name: null,
      last_name: 2, first_name: null, middle_name: null,
      birth_date: 3, address: 0, phone: 4,
    };
    const { mapping } = refineColumnMapping(headers, rows, modelMapping);
    // Header match → address stays at 0 regardless of synthetic data in col 1.
    expect(mapping.address).toBe(0);
  });

  it("does not match a column containing the word 'дома' in texts as an address", () => {
    const headers = ["Текст наказа", "Адрес проживания", "Фамилия", "Дата", "Номер мобильного телефона"];
    const rows = [
      ["Покрасить фасад дома.", "Богородский г.о.", "Иванов", "11.05.1957", "7(963)983-62-52"],
      ["Уборка мусора вокруг дома.", "Богородский г.о.", "Петров", "03.07.1981", "7(916)111-22-33"],
      ["Ремонт кровли дома.", "Богородский г.о.", "Сидоров", "25.12.1990", "7(903)777-88-99"],
    ];
    const modelMapping: ColumnMapping = {
      topic: 0, full_name: null,
      last_name: 2, first_name: null, middle_name: null,
      birth_date: 3, address: 1, phone: 4,
    };
    const { mapping, conflicts } = refineColumnMapping(headers, rows, modelMapping);
    // Address must remain col 1 (even though it lacks street names) because col 0 doesn't match address heuristic
    expect(mapping.address).toBe(1);
    // There shouldn't be any address conflicts mapping it to col 0
    const addressConflict = conflicts.find((c) => c.field === "address");
    expect(addressConflict).toBeUndefined();
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

  it("skips rows present in excludeRows set", () => {
    // All 3 rows of col 1 contain phone numbers; exclude rows 0 and 1 → only row 2 returned.
    const excludeRows = new Set([0, 1]);
    expect(sampleColumnValues(rows, 1, 20, excludeRows)).toEqual(["7(900)000-00-00"]);
  });
});
