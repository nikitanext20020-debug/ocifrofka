/**
 * Russian mobile phone normalisation.
 *
 * Accepted inputs:
 *   - 11 digits starting with 7 or 8  →  canonical 7(xxx)xxx-xx-xx
 *   - 10 digits starting with 9        →  prepend 7, then canonical form
 *   - everything else                  →  status "invalid", value unchanged
 *
 * @param raw      - The raw string as it appears in the spreadsheet.
 * @param wantPlus - When true the result is prefixed with "+".
 */
export function normalizeRuPhone(
  raw: string,
  wantPlus = false,
): { formatted: string; status: "ok" | "fixed" | "invalid" } {
  const digits = raw.replace(/\D/g, "");

  let canonical: string | null = null;
  let wasAlreadyCanonical = false;

  if (digits.length === 11 && (digits[0] === "7" || digits[0] === "8")) {
    canonical = `7${digits.slice(1)}`;
    // "ok" only when input already matches target canonical format exactly
    const expectedRe = wantPlus
      ? /^\+7\(\d{3}\)\d{3}-\d{2}-\d{2}$/
      : /^7\(\d{3}\)\d{3}-\d{2}-\d{2}$/;
    wasAlreadyCanonical = expectedRe.test(raw.trim());
  } else if (digits.length === 10 && digits[0] === "9") {
    canonical = `7${digits}`;
  }

  if (!canonical) {
    return { formatted: raw, status: "invalid" };
  }

  const area = canonical.slice(1, 4);
  const p1   = canonical.slice(4, 7);
  const p2   = canonical.slice(7, 9);
  const p3   = canonical.slice(9, 11);
  const prefix = wantPlus ? "+" : "";
  const formatted = `${prefix}7(${area})${p1}-${p2}-${p3}`;
  return { formatted, status: wasAlreadyCanonical ? "ok" : "fixed" };
}
