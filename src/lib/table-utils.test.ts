import { describe, expect, it } from "vitest";
import { appendRecords, applyCellChanges, applyFixedColumnValues, applyRecordCategories, findGapCells, findInsertRow, markSyntheticRowsForExport, mergeRecordsAt, normalizeTable, recordsToCsv, splitFullName } from "@/lib/table-utils";
import type { ColumnMapping, ExtractedRecord } from "@/lib/types";

describe("normalizeTable", () => {
  it("creates stable names for empty headers and pads rows", () => {
    expect(normalizeTable([["ФИО", "", "Телефон"], ["Иванов", "Москва"]])).toEqual({
      headers: ["ФИО", "Колонка 2", "Телефон"],
      rows: [["Иванов", "Москва", ""]],
    });
  });

  it("uses the descriptive row instead of a technical header row", () => {
    expect(normalizeTable([
      ["A", "", "C", "D", "E", "F", "G", "H", "I", "J", "K", "", "M", "N"],
      ["", "МУНИЦИПАЛИТЕТ", "Адрес проживания", "Фамилия", "Имя", "Отчество", "Дата", "Номер мобильного телефона", "E-mail", "Вовлеченность в деятельность Партии", "Тематика предложения", "Направление обращения", "Текст наказа", ""],
      ["", "Богородский г.о.", "Ногинск", "Иванов", "Иван", "Иванович", "01.01.1990", "7999", "", "Иное", "ЖКХ", "Благоустройство", "Починить дорогу", "Родионова"],
    ])).toEqual({
      headers: ["Колонка 1", "МУНИЦИПАЛИТЕТ", "Адрес проживания", "Фамилия", "Имя", "Отчество", "Дата", "Номер мобильного телефона", "E-mail", "Вовлеченность в деятельность Партии", "Тематика предложения", "Направление обращения", "Текст наказа"],
      rows: [["", "Богородский г.о.", "Ногинск", "Иванов", "Иван", "Иванович", "01.01.1990", "7999", "", "Иное", "ЖКХ", "Благоустройство", "Починить дорогу"]],
    });
  });

  it("drops stray values to the right of the last named column", () => {
    expect(normalizeTable([
      ["ФИО", "Телефон", ""],
      ["Иванов", "7999", "случайное значение"],
    ])).toEqual({
      headers: ["ФИО", "Телефон"],
      rows: [["Иванов", "7999"]],
    });
  });
});

describe("applyRecordCategories", () => {
  it("writes K and L classifications only into empty cells of new rows", () => {
    const result = applyRecordCategories(
      [["старое", ""], ["", "уже заполнено"]],
      [0, 1],
      [{ categories: { 0: "Тематика", 1: "Направление" } }, { categories: { 0: "Другая тема", 1: "Нельзя заменить" } }],
    );
    expect(result.rows).toEqual([["старое", "Направление"], ["Другая тема", "уже заполнено"]]);
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

  it("cannot replace a non-empty cell in empty-only mode", () => {
    const result = applyCellChanges(
      [["Существующее значение", ""]],
      [
        { row: 0, column: 0, value: "Нельзя" },
        { row: 0, column: 1, value: "Можно" },
      ],
      new Set(["0:0", "0:1"]),
      true,
    );
    expect(result.rows).toEqual([["Существующее значение", "Можно"]]);
    expect(result.applied).toEqual([{ row: 0, column: 1, value: "Можно" }]);
  });
});

describe("findGapCells", () => {
  it("returns gaps only from explicitly selected new rows", () => {
    const table = {
      headers: ["ФИО", "Телефон"],
      rows: [["Старая строка", ""], ["Новая строка", ""]],
    };
    const mapping: ColumnMapping = {
      topic: null,
      full_name: 0,
      last_name: null,
      first_name: null,
      middle_name: null,
      birth_date: null,
      address: null,
      phone: 1,
    };

    expect(findGapCells(table, mapping, [1])).toEqual([{ row: 1, column: 1 }]);
  });
});

describe("applyFixedColumnValues", () => {
  it("sets fixed categoricals only in selected new rows", () => {
    const result = applyFixedColumnValues(
      [["Старая", ""], ["Новая", ""]],
      [1],
      { 1: "Иное" },
    );
    expect(result.rows).toEqual([["Старая", ""], ["Новая", "Иное"]]);
    expect(result.applied).toEqual([{ row: 1, column: 1, value: "Иное" }]);
  });
});

describe("markSyntheticRowsForExport", () => {
  it("adds an explicit status column only for synthetic rows", () => {
    expect(markSyntheticRowsForExport(
      { headers: ["ФИО"], rows: [["Иванов"], ["Петров"]] },
      [1],
    )).toEqual({
      headers: ["ФИО", "Статус данных"],
      rows: [["Иванов", ""], ["Петров", "Синтетические данные"]],
    });
  });
});

describe("appendRecords", () => {
  it("adds a row using column mapping without replacing unrelated columns", () => {
    const result = appendRecords(
      { headers: ["ID", "ФИО", "Телефон"], rows: [[1, "Петров", "8000"]] },
      [{ topic: "Тема", full_name: "Иванов Иван", birth_date: "-", address: "-", phone: "8999" }],
      { topic: null, full_name: 1, last_name: null, first_name: null, middle_name: null, birth_date: null, address: null, phone: 2 },
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

describe("findInsertRow", () => {
  const mapping: ColumnMapping = {
    topic: 3,
    full_name: 1,
    last_name: null,
    first_name: null,
    middle_name: null,
    birth_date: null,
    address: null,
    phone: 2,
  };

  it("skips monotone service columns and finds the last real-data row", () => {
    const table = {
      headers: ["Округ", "ФИО", "Телефон", "Тема"],
      rows: [
        ["Богородский г.о.", "Иванов Иван", "8999", "Дорога"],
        ["Богородский г.о.", "Петров Петр", "8888", "ЖКХ"],
        ["Богородский г.о.", "", "", ""],
        ["Богородский г.о.", "", "", ""],
      ],
    };
    // Col 0 (Округ) is monotone (same value in every row).
    // Last row with real data is index 1 → insert at index 2.
    expect(findInsertRow(table, mapping)).toBe(2);
  });

  it("returns 0 when the table has no rows", () => {
    expect(findInsertRow({ headers: ["ФИО"], rows: [] }, { topic: null, full_name: 0, last_name: null, first_name: null, middle_name: null, birth_date: null, address: null, phone: null })).toBe(0);
  });

  it("returns 0 when all mapped columns are monotone", () => {
    const table = {
      headers: ["Статус"],
      rows: [["Обработано"], ["Обработано"], ["Обработано"]],
    };
    expect(findInsertRow(table, { topic: 0, full_name: null, last_name: null, first_name: null, middle_name: null, birth_date: null, address: null, phone: null })).toBe(0);
  });
});

describe("mergeRecordsAt", () => {
  const mapping: ColumnMapping = {
    topic: 3,
    full_name: 1,
    last_name: null,
    first_name: null,
    middle_name: null,
    birth_date: null,
    address: null,
    phone: 2,
  };
  const record = { topic: "Ремонт", full_name: "Сидоров Сидор", birth_date: "-", address: "-", phone: "8777" };

  it("fills empty mapped cells and leaves existing values intact", () => {
    const table = {
      headers: ["Округ", "ФИО", "Телефон", "Тема"],
      rows: [
        ["Богородский г.о.", "Иванов", "8999", "Дорога"],
        ["Богородский г.о.", "", "", ""],
      ],
    };
    const { rows, writtenRows } = mergeRecordsAt(table, [record], mapping, 1);
    expect(rows[1][0]).toBe("Богородский г.о."); // service column untouched
    expect(rows[1][1]).toBe("Сидоров Сидор");
    expect(rows[1][2]).toBe("8777");
    expect(rows[1][3]).toBe("Ремонт");
    expect(writtenRows).toEqual([1]);
  });

  it("does not overwrite an existing non-empty cell", () => {
    const table = {
      headers: ["Округ", "ФИО", "Телефон", "Тема"],
      rows: [["Богородский г.о.", "Уже есть", "", ""]],
    };
    const { rows } = mergeRecordsAt(table, [record], mapping, 0);
    expect(rows[0][1]).toBe("Уже есть"); // NOT overwritten
  });

  it("does not add rows beyond the table length", () => {
    const table = { headers: ["ФИО"], rows: [] as unknown[][] };
    const { rows, writtenRows } = mergeRecordsAt(
      table,
      [{ topic: "-", full_name: "Иванов", birth_date: "-", address: "-", phone: "-" }],
      { topic: null, full_name: 0, last_name: null, first_name: null, middle_name: null, birth_date: null, address: null, phone: null },
      0,
    );
    expect(rows).toHaveLength(0);
    expect(writtenRows).toHaveLength(0);
  });
});

describe("splitFullName", () => {
  it("splits surname, first name and patronymic", () => {
    expect(splitFullName("  Котова   Людмила Сергеевна ")).toEqual({
      last_name: "Котова",
      first_name: "Людмила",
      middle_name: "Сергеевна",
    });
  });

  it("keeps a compound patronymic tail together", () => {
    expect(splitFullName("Алиев Камиль Рашид оглы")).toEqual({
      last_name: "Алиев",
      first_name: "Камиль",
      middle_name: "Рашид оглы",
    });
  });
});

describe("mergeRecordsAt with separate name columns", () => {
  it("writes surname, first name and patronymic into three cells", () => {
    const table = {
      headers: ["Фамилия", "Имя", "Отчество"],
      rows: [["", "", ""]],
    };
    const record = {
      topic: "Ремонт",
      full_name: "Котова Людмила Сергеевна",
      birth_date: "10.12.1957",
      address: "Ногинск",
      phone: "7999",
    };
    const mapping: ColumnMapping = {
      topic: null,
      full_name: null,
      last_name: 0,
      first_name: 1,
      middle_name: 2,
      birth_date: null,
      address: null,
      phone: null,
    };

    const { rows } = mergeRecordsAt(table, [record], mapping, 0);

    expect(rows[0]).toEqual(["Котова", "Людмила", "Сергеевна"]);
  });
});
