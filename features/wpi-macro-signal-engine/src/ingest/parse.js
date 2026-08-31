import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { ALL_COMMODITIES, CODE_LEVEL_WIDTH, LEVEL } from '../core/constants.js';

const HEADER_SIGNATURE = ['level', 'name', 'code', 'weight'];

/**
 * PRD §4 rule 2: find the data sheet by its header signature. The published
 * file's sheet is currently named "Sheet3", so any name-based lookup is a
 * time bomb.
 */
export function findDataSheet(workbook) {
  for (const name of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, blankrows: false, raw: true });
    const headerRow = rows.findIndex((r) => matchesSignature(r));
    if (headerRow !== -1) return { name, rows, headerRow };
  }
  throw new Error(
    'No sheet matched the WPI header signature (Level / Commodity Name / Commodity Code / Commodity Weight ' +
      'followed by date columns). Is this the item-wise monthly file, Base 2022-23, from eaindustry.nic.in?',
  );
}

function matchesSignature(row) {
  if (!Array.isArray(row) || row.length < 6) return false;
  const head = row.slice(0, 4).map((c) => String(c ?? '').toLowerCase());
  const labelled = HEADER_SIGNATURE.every((token, i) => head[i]?.includes(token));
  if (!labelled) return false;
  return row.slice(4).some((c) => toMonth(c) !== null);
}

/**
 * Month columns are read as Excel serials rather than Dates (see the cellDates
 * note in parseWorkbookFile) but the published file has also shipped them as
 * text, and a caller may hand us real Dates, so all three are accepted and
 * normalised to 'YYYY-MM'.
 */
export function toMonth(cell) {
  if (cell instanceof Date) return isoFromDate(cell);
  if (typeof cell === 'number' && cell > 20000 && cell < 80000) return isoFromSerial(cell);
  if (typeof cell === 'string') {
    const parsed = parseMonthText(cell);
    if (parsed) return parsed;
  }
  return null;
}

/** SheetJS constructs cellDates values in local time, so read them the same way. */
function isoFromDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function isoFromSerial(serial) {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const MONTH_TOKENS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function parseMonthText(text) {
  const s = text.trim().toLowerCase();
  let m = s.match(/^(\d{4})-(\d{2})(-\d{2})?$/);
  if (m) return `${m[1]}-${m[2]}`;
  m = s.match(/^([a-z]{3})[a-z]*[\s\-/'"]*(\d{2,4})$/);
  if (m && MONTH_TOKENS[m[1]]) {
    const year = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
    return `${year}-${String(MONTH_TOKENS[m[1]]).padStart(2, '0')}`;
  }
  return null;
}

/** PRD §4 rule 3: index values are numbers; '-' means null, never zero. */
export function toValue(cell) {
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : null;
  if (typeof cell === 'string') {
    const s = cell.trim();
    if (s === '' || s === '-' || s === '--' || s === 'NA' || s === 'N.A.') return null;
    const n = Number(s.replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * PRD §4 rule 5: the 10-digit code encodes the hierarchy by prefix, so a row's
 * parent is the nearest shorter prefix that is itself a stored code. This is
 * what makes PROXY mapping to a parent group possible (§5.2 rule 2).
 */
export function parentCodeOf(code, level, knownCodes) {
  const width = CODE_LEVEL_WIDTH[level];
  if (!width || width <= 2) return null;
  for (let w = width - 2; w >= 2; w -= 2) {
    const candidate = code.slice(0, w).padEnd(10, '0');
    if (candidate !== code && knownCodes.has(candidate)) return candidate;
  }
  return knownCodes.has(ALL_COMMODITIES) && code !== ALL_COMMODITIES ? ALL_COMMODITIES : null;
}

export function parseWorkbookFile(path) {
  // cellDates is deliberately off: SheetJS would build Date objects in the
  // machine's local timezone, which shifts a 1-Apr column into March on any
  // host east of UTC. Raw serials keep the month independent of where this runs.
  const workbook = XLSX.read(readFileSync(path), { cellDates: false });
  return parseWorkbook(workbook, path);
}

export function parseWorkbook(workbook, sourceFile = '(buffer)') {
  const { name: sheetName, rows, headerRow } = findDataSheet(workbook);
  const header = rows[headerRow];

  const monthColumns = [];
  for (let col = 4; col < header.length; col += 1) {
    const month = toMonth(header[col]);
    if (month !== null) monthColumns.push({ col, month });
  }
  if (monthColumns.length === 0) throw new Error('Data sheet found but it carries no month columns.');

  const months = monthColumns.map((m) => m.month);
  const seenMonths = new Set();
  for (const m of months) {
    if (seenMonths.has(m)) throw new Error(`Duplicate month column ${m} in the source file.`);
    seenMonths.add(m);
  }

  const commodities = [];
  const values = [];
  const knownCodes = new Set();
  const skipped = [];

  for (let r = headerRow + 1; r < rows.length; r += 1) {
    const row = rows[r];
    if (!row) continue;
    // PRD §4 rule 3: codes are strings. A numeric cell would lose nothing here
    // (no leading zeros) but String() keeps the type stable across sources.
    const rawCode = row[2];
    if (rawCode === undefined || rawCode === null || String(rawCode).trim() === '') {
      // The published file ends with derived aggregates (FOOD INDEX) that carry
      // a weight and a series but no code. They are not commodities.
      if (String(row[1] ?? '').trim() !== '') skipped.push(String(row[1]).trim());
      continue;
    }
    const code = String(rawCode).trim();
    const level = String(row[0] ?? '').trim() || LEVEL.ITEM;
    commodities.push({
      code,
      name: String(row[1] ?? '').trim(),
      level,
      weight: toValue(row[3]),
    });
    knownCodes.add(code);
    for (const { col, month } of monthColumns) {
      values.push({ code, month, value: toValue(row[col]) });
    }
  }

  for (const c of commodities) c.parentCode = parentCodeOf(c.code, c.level, knownCodes);

  const latestMonth = latestMonthOf(values, months);

  return { sourceFile, sheetName, months, latestMonth, commodities, values, skipped };
}

/**
 * PRD §4 rule 4: the latest month is the last non-null value on the All
 * Commodities row, not the last column. The published file ships trailing
 * empty columns for months not yet released.
 */
export function latestMonthOf(values, months) {
  const allSeries = new Map();
  for (const v of values) {
    if (v.code === ALL_COMMODITIES) allSeries.set(v.month, v.value);
  }
  if (allSeries.size === 0) {
    throw new Error(`All Commodities row (${ALL_COMMODITIES}) missing from the source file — cannot establish the latest month.`);
  }
  let latest = null;
  for (const month of months) {
    if (allSeries.get(month) !== null && allSeries.get(month) !== undefined) latest = month;
  }
  if (latest === null) throw new Error('All Commodities row carries no values.');
  return latest;
}
