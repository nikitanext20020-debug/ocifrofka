function expandTwoDigitYear(year: number) {
  if (year >= 100) return year;
  const currentTwoDigits = new Date().getFullYear() % 100;
  return year <= currentTwoDigits ? 2000 + year : 1900 + year;
}

function validDate(day: number, month: number, year: number) {
  const value = new Date(Date.UTC(year, month - 1, day));
  return value.getUTCFullYear() === year && value.getUTCMonth() === month - 1 && value.getUTCDate() === day;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

/**
 * Converts common date representations to DD.MM.YYYY.
 * Slash dates are treated as MM/DD/YY only when the source format says so
 * or the second component cannot be a month. Dot and dash dates default to
 * the Russian day-month-year order.
 */
export function normalizeBirthDate(value: unknown, formatHint = "") {
  const source = String(value ?? "").trim();
  if (!source || source === "-") return source;

  const iso = source.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    return validDate(day, month, year) ? `${pad(day)}.${pad(month)}.${year}` : source;
  }

  const match = source.match(/^(\d{1,2})([./-])(\d{1,2})\2(\d{2}|\d{4})$/);
  if (!match) return source;

  const first = Number(match[1]);
  const separator = match[2];
  const second = Number(match[3]);
  const year = expandTwoDigitYear(Number(match[4]));
  const normalizedHint = formatHint.toLocaleLowerCase("ru-RU").replace(/\s+/g, "");
  const hintIsMonthFirst = /mm[./-]dd|month.*day|месяц.*день/.test(normalizedHint);

  let day = first;
  let month = second;
  if (separator === "/" && (hintIsMonthFirst || (first <= 12 && second > 12))) {
    month = first;
    day = second;
  } else if (first <= 12 && second > 12) {
    month = first;
    day = second;
  }

  return validDate(day, month, year) ? `${pad(day)}.${pad(month)}.${year}` : source;
}
