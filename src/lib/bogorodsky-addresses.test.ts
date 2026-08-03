import { describe, expect, it } from "vitest";
import {
  BOGORODSKY_SETTLEMENTS,
  formatBogorodskyAddress,
  isBogorodskyStreet,
  selectBogorodskyAddress,
} from "@/lib/bogorodsky-addresses";

describe("Bogorodsky address catalog", () => {
  it("contains unique real street pairs and the required settlements", () => {
    const names = BOGORODSKY_SETTLEMENTS.map((item) => item.name);
    expect(names).toEqual(expect.arrayContaining([
      "Ногинск",
      "Старая Купавна",
      "Электроугли",
      "Мамонтово",
    ]));

    const pairs = BOGORODSKY_SETTLEMENTS.flatMap((settlement) =>
      settlement.streets.map((street) => (
        `${settlement.name}|${street.type}|${street.name}`
          .toLocaleLowerCase("ru-RU")
          .replaceAll("ё", "е")
      )),
    );
    expect(new Set(pairs).size).toBe(pairs.length);
    expect(pairs.every((pair) => !pair.endsWith("|"))).toBe(true);
  });

  it("balances consecutive rows across settlements", () => {
    const firstCycle = BOGORODSKY_SETTLEMENTS.map((_, index) => (
      selectBogorodskyAddress(index).settlement
    ));
    expect(new Set(firstCycle).size).toBe(BOGORODSKY_SETTLEMENTS.length);
    expect(firstCycle).toContain("Старая Купавна");
    expect(firstCycle).toContain("Электроугли");
    expect(firstCycle).toContain("Мамонтово");
  });

  it("formats only a catalog pair and a deterministic synthetic house", () => {
    const selected = selectBogorodskyAddress(17);
    expect(isBogorodskyStreet(selected.settlement, selected.street)).toBe(true);
    expect(formatBogorodskyAddress(selected, 17)).toMatch(/, д\. \d+$/);
    expect(formatBogorodskyAddress(selected, 17)).toBe(formatBogorodskyAddress(selected, 17));
  });
});
