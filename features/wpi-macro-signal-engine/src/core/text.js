/** Ported verbatim from the prototype so token scoring stays byte-identical. */
export function norm(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ACCOUNTING_WORDS =
  /\b(rs|inr|lakh|lakhs|crore|crores|cr|qty|qtls|kg|kgs|mt|ton|tons|tonnes|ltr|ltrs|litre|litres|nos|no|pcs|amount|value|total|opening|closing|stock|balance|of|as|at|on|to|by|less|add|purchases?|sales?)\b/gi;

/** PRD §3: strip numbers, units and accounting words before any matching. */
export function cleanName(s) {
  return String(s ?? '')
    .replace(/[0-9]/g, ' ')
    .replace(/[,.()[\]:;₹%/\\-]/g, ' ')
    .replace(ACCOUNTING_WORDS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const DASH = '\u2013';

export function pct(m, { dash = DASH } = {}) {
  if (m === null || m === undefined || Number.isNaN(m)) return dash;
  return `${m >= 0 ? '+' : ''}${(m * 100).toFixed(1)}%`;
}

/** Percentage-point deltas: the sign matters, "pp" not "%". */
export function pp(m, { dash = DASH } = {}) {
  if (m === null || m === undefined || Number.isNaN(m)) return dash;
  return `${m >= 0 ? '+' : ''}${(m * 100).toFixed(1)}pp`;
}

export function inr(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return DASH;
  const abs = Math.abs(value);
  if (abs >= 1e7) return `Rs ${(value / 1e7).toFixed(2)} cr`;
  if (abs >= 1e5) return `Rs ${(value / 1e5).toFixed(2)} lakh`;
  return `Rs ${Math.round(value).toLocaleString('en-IN')}`;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026-06' -> 'Jun-26' */
export function monthShort(month) {
  const [y, m] = month.split('-');
  return `${MONTH_NAMES[Number(m) - 1]}-${y.slice(2)}`;
}

/** '2026-06' -> 'June 2026' */
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function monthLong(month) {
  const [y, m] = month.split('-');
  return `${MONTH_LONG[Number(m) - 1]} ${y}`;
}

export function titleCase(s) {
  return String(s ?? '').replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** Joins a list into prose: [a] -> 'a', [a,b] -> 'a and b', [a,b,c] -> 'a, b and c'. */
export function joinProse(parts, conjunction = 'and') {
  const list = parts.filter(Boolean);
  if (list.length === 0) return '';
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).join(', ')} ${conjunction} ${list[list.length - 1]}`;
}
