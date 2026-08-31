const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function assertMonth(month) {
  if (!MONTH_RE.test(String(month ?? ''))) throw new Error(`Not a 'YYYY-MM' month: ${JSON.stringify(month)}`);
  return month;
}

/** Absolute month ordinal, so arithmetic never touches Date and its timezones. */
export function monthOrdinal(month) {
  const m = MONTH_RE.exec(assertMonth(month));
  return Number(m[1]) * 12 + (Number(m[2]) - 1);
}

export function monthDiff(from, to) {
  return monthOrdinal(to) - monthOrdinal(from);
}

export function addMonths(month, n) {
  const total = monthOrdinal(month) + n;
  const year = Math.floor(total / 12);
  const m = total - year * 12;
  return `${String(year).padStart(4, '0')}-${String(m + 1).padStart(2, '0')}`;
}
