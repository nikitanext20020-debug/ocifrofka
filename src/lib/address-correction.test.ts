import { describe, expect, it } from "vitest";
import { correctBogorodskyAddress } from "@/lib/address-correction";

describe("correctBogorodskyAddress", () => {
  it("corrects a short OCR error in Noginsk and its settlement prefix", () => {
    expect(correctBogorodskyAddress("л, Носинск").value).toBe("г. Ногинск");
  });

  it("corrects a heavily distorted but unambiguous Elektro​ugli", () => {
    expect(correctBogorodskyAddress("л. элеуугли").value).toBe("г. Электроугли");
  });

  it("corrects a multi-word settlement inside a full address", () => {
    expect(correctBogorodskyAddress("Московская обл., г. Старая Купавиа, ул. Кирова, 5").value)
      .toBe("Московская обл., г. Старая Купавна, ул. Кирова, 5");
  });

  it("uses the correct canonical settlement type", () => {
    expect(correctBogorodskyAddress("г. Ямкиио").value).toBe("с. Ямкино");
  });

  it("leaves an unrelated address untouched", () => {
    expect(correctBogorodskyAddress("г. Москва, ул. Тверская, 10")).toMatchObject({
      value: "г. Москва, ул. Тверская, 10",
      changed: false,
    });
  });

  it("does not guess when the input is too short", () => {
    expect(correctBogorodskyAddress("д. Но")).toMatchObject({ value: "д. Но", changed: false });
  });
});
