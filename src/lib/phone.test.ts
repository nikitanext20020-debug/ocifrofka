import { describe, expect, it } from "vitest";
import { normalizeRuPhone } from "@/lib/phone";

describe("normalizeRuPhone", () => {
  it("recognises an already-canonical 7(xxx) number as ok", () => {
    const result = normalizeRuPhone("7(916)111-22-33", false);
    expect(result.formatted).toBe("7(916)111-22-33");
    expect(result.status).toBe("ok");
  });

  it("recognises an already-canonical +7(xxx) number as ok when wantPlus is true", () => {
    const result = normalizeRuPhone("+7(905)123-45-67", true);
    expect(result.formatted).toBe("+7(905)123-45-67");
    expect(result.status).toBe("ok");
  });

  it("fixes 8(xxx) format by replacing 8 with 7", () => {
    const result = normalizeRuPhone("8(905)123-45-67", true);
    expect(result.formatted).toBe("+7(905)123-45-67");
    expect(result.status).toBe("fixed");
  });

  it("fixes raw 11-digit string starting with 8", () => {
    const result = normalizeRuPhone("89051234567", true);
    expect(result.formatted).toBe("+7(905)123-45-67");
    expect(result.status).toBe("fixed");
  });

  it("fixes 10-digit string starting with 9 by prepending 7", () => {
    const result = normalizeRuPhone("9051234567", true);
    expect(result.formatted).toBe("+7(905)123-45-67");
    expect(result.status).toBe("fixed");
  });

  it("returns invalid status and unchanged value for 9-digit input", () => {
    const result = normalizeRuPhone("905123456");
    expect(result.status).toBe("invalid");
    expect(result.formatted).toBe("905123456");
  });

  it("returns invalid for empty string", () => {
    const result = normalizeRuPhone("");
    expect(result.status).toBe("invalid");
    expect(result.formatted).toBe("");
  });

  it("returns invalid for a non-phone string", () => {
    const result = normalizeRuPhone("abc");
    expect(result.status).toBe("invalid");
    expect(result.formatted).toBe("abc");
  });

  it("formats without + by default", () => {
    const result = normalizeRuPhone("89051234567");
    expect(result.formatted).toBe("7(905)123-45-67");
    expect(result.status).toBe("fixed");
  });

  it("strips spaces and dashes before matching", () => {
    const result = normalizeRuPhone("+7 905 123 45 67", true);
    expect(result.formatted).toBe("+7(905)123-45-67");
    expect(result.status).toBe("fixed");
  });
});
