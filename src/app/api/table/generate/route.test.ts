import dns from "node:dns/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/table/generate/route";
import {
  formatBogorodskyAddress,
  selectBogorodskyAddress,
} from "@/lib/bogorodsky-addresses";

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
    // Use mockImplementation (not mockResolvedValue) so each fetch call gets a
    // fresh Response instance — Response.json() can only be consumed once per object.
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
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
    // The route detects quality issues (all texts start with an imperative verb)
    // and performs a retry, so the provider is called twice.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const providerRequest = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(providerRequest.temperature).toBe(0.7);
  });

  it("flags quality warning if a generated row is highly similar to one of the forbiddenTexts", async () => {
    vi.spyOn(dns, "lookup").mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
    ] as unknown as Awaited<ReturnType<typeof dns.lookup>>);

    // The mock model returns a row that matches the forbidden text "Почините объект номер один"
    const rows = [{ 0: "Почините объект номер один. Жителям станет удобнее." }];
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
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
        count: 1,
        headers: ["Текст наказа"],
        examples: [],
        formats: {},
        categoricals: {},
        fixedValues: {},
        instruction: "",
        forbiddenTexts: ["Почините объект номер один. Нам станет удобнее."],
      }),
    }));

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.warning).toContain("запрещенное");
  });

  it("clears technical column values unless populated in >=80% of examples", async () => {
    vi.spyOn(dns, "lookup").mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
    ] as unknown as Awaited<ReturnType<typeof dns.lookup>>);

    const rows = [{
      0: "Иванов Иван",
      1: "Текст обращения. Просим разобраться.",
      2: "технический-мусор-будет-стерт",
      3: "сохраняемое-значение",
    }];
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ rows }) } }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    // Columns explanation:
    // Column 0: "ФИО" (not technical)
    // Column 1: "Текст наказа" (not technical)
    // Column 2: "Колонка 3" (technical, matched in examples: 0/5 = 0% < 80% -> cleared!)
    // Column 3: "Колонка 4" (technical, matched in examples: 4/5 = 80% >= 80% -> kept!)
    const response = await POST(new Request("http://localhost/api/table/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-agent-base-url": "https://api.example.com/v1",
        "x-agent-api-key": "test",
        "x-agent-model": "test-model",
      },
      body: JSON.stringify({
        count: 1,
        headers: ["ФИО", "Текст наказа", "Колонка 3", "Колонка 4"],
        examples: [
          ["Иванов", "Текст", "", "Да"],
          ["Петров", "Текст", "", "Да"],
          ["Сидоров", "Текст", "", "Да"],
          ["Козлов", "Текст", "", "Да"],
          ["Смирнов", "Текст", "", ""], // 4 out of 5 filled for column 3
        ],
        formats: {},
        categoricals: {},
        fixedValues: {},
        instruction: "",
      }),
    }));

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.rows[0]).toEqual([
      "Иванов Иван",
      "Текст обращения. Просим разобраться.",
      "", // cleared!
      "сохраняемое-значение", // kept!
    ]);
  });

  it("overwrites a hallucinated model address with an offline catalog address", async () => {
    vi.spyOn(dns, "lookup").mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
    ] as unknown as Awaited<ReturnType<typeof dns.lookup>>);
    const rows = [{
      0: "Спокойный текст обращения. Жители просят разобраться.",
      1: "г. Ногинск, ул. Несуществующая, д. 5",
    }];
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
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
        count: 1,
        headers: ["Текст наказа", "Адрес"],
        examples: [],
        formats: {},
        categoricals: {},
        fixedValues: {},
        instruction: "",
        addressColumn: 1,
        sequenceStart: 1,
      }),
    }));

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.rows[0][1]).not.toContain("Несуществующая");
    expect(payload.rows[0][1]).toContain("Старая Купавна");
  });

  it("keeps the same catalog addresses when generation retries", async () => {
    vi.spyOn(dns, "lookup").mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
    ] as unknown as Awaited<ReturnType<typeof dns.lookup>>);
    let attempt = 0;
    const cleanRetryTexts = [
      "Старое покрытие у дома разрушилось. Жители просят разобраться.",
      "Детям трудно переходить этот участок. Хотелось бы сделать его безопаснее.",
      "После дождя дорогу сильно размывает. Местные просят обратить внимание.",
      "Автобусная остановка давно стоит без навеса. Людям нужен удобный павильон.",
      "Пожилые жители обходят яму по проезжей части. Здесь требуется безопасный проход.",
    ];
    const fetchMock = vi.fn().mockImplementation(async () => {
      attempt += 1;
      const rows = Array.from({ length: 5 }, (_, index) => ({
        0: attempt === 1
          ? `Почините объект ${index + 1}. Жителям станет удобнее.`
          : cleanRetryTexts[index],
        1: `г. Ногинск, ул. Выдуманная-${attempt}-${index + 1}, д. 5`,
      }));
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ rows }) } }],
      }), { status: 200 });
    });
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
        headers: ["Текст наказа", "Адрес"],
        examples: [],
        formats: {},
        categoricals: {},
        fixedValues: {},
        instruction: "",
        addressColumn: 1,
        sequenceStart: 0,
      }),
    }));

    expect(response.status).toBe(200);
    const payload = await response.json();
    const expectedAddresses = Array.from({ length: 5 }, (_, sequence) => (
      formatBogorodskyAddress(selectBogorodskyAddress(sequence), sequence)
    ));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(payload.rows[0][0]).toBe(cleanRetryTexts[0]);
    expect(payload.rows.map((row: string[]) => row[1])).toEqual(expectedAddresses);
  });

  it("rejects an address column outside the table", async () => {
    vi.spyOn(dns, "lookup").mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
    ] as unknown as Awaited<ReturnType<typeof dns.lookup>>);
    const fetchMock = vi.fn();
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
        count: 1,
        headers: ["Текст наказа", "Адрес"],
        examples: [],
        formats: {},
        categoricals: {},
        fixedValues: {},
        instruction: "",
        addressColumn: 2,
      }),
    }));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves model addresses when no address column is mapped", async () => {
    vi.spyOn(dns, "lookup").mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
    ] as unknown as Awaited<ReturnType<typeof dns.lookup>>);
    const rows = [{ 0: "г. Ногинск, ул. Несуществующая, д. 5" }];
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ rows }) } }],
    }), { status: 200 })));

    const response = await POST(new Request("http://localhost/api/table/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-agent-base-url": "https://api.example.com/v1",
        "x-agent-api-key": "test",
        "x-agent-model": "test-model",
      },
      body: JSON.stringify({
        count: 1,
        headers: ["Адрес"],
        examples: [],
        formats: {},
        categoricals: {},
        fixedValues: {},
        instruction: "",
      }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      rows: [["г. Ногинск, ул. Несуществующая, д. 5"]],
    });
  });
});
