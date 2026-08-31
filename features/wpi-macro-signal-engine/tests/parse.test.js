import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { findDataSheet, parentCodeOf, parseWorkbook, toMonth, toValue } from '../src/ingest/parse.js';
import { ALL_COMMODITIES, LEVEL } from '../src/core/constants.js';

// -------------------------------------------------------------- toMonth

test('toMonth: Excel serial normalises to YYYY-MM', () => {
  // 45383 = 1 Apr 2024 in the 1900 date system.
  assert.equal(toMonth(45383), '2024-04');
});

test('toMonth: Date object uses local-calendar Y/M, not UTC', () => {
  assert.equal(toMonth(new Date(2026, 5, 15)), '2026-06');
});

test('toMonth: text formats (Apr-24, Apr 2024, 2024-04)', () => {
  assert.equal(toMonth('Apr-24'), '2024-04');
  assert.equal(toMonth('April 2024'), '2024-04');
  assert.equal(toMonth('2024-04'), '2024-04');
  assert.equal(toMonth('2024-04-01'), '2024-04');
});

test('toMonth: non-month text and small/large numbers return null', () => {
  assert.equal(toMonth('Weight'), null);
  assert.equal(toMonth('Level'), null);
  assert.equal(toMonth(5), null);
  assert.equal(toMonth(999999), null);
});

// -------------------------------------------------------------- toValue

test('toValue: "-" is null, never zero (PRD §4 rule 3)', () => {
  assert.equal(toValue('-'), null);
  assert.equal(toValue('--'), null);
  assert.equal(toValue(''), null);
  assert.equal(toValue('NA'), null);
});

test('toValue: numeric strings with commas parse to numbers', () => {
  assert.equal(toValue('1,234.5'), 1234.5);
  assert.equal(toValue(102.8), 102.8);
});

// -------------------------------------------------------------- parentCodeOf

test('parentCodeOf: Item falls back through known parent prefixes', () => {
  const known = new Set(['1101000000', '1101010000', ALL_COMMODITIES]);
  // 1101010101 (Paddy) -> nearest known prefix is 1101010000 (Food Grains)
  assert.equal(parentCodeOf('1101010101', LEVEL.ITEM, known), '1101010000');
});

test('parentCodeOf: no known parent prefix falls back to All Commodities', () => {
  const known = new Set([ALL_COMMODITIES]);
  assert.equal(parentCodeOf('1315020000', LEVEL.SS_GROUP, known), ALL_COMMODITIES);
});

test('parentCodeOf: All Commodities itself has no parent', () => {
  const known = new Set([ALL_COMMODITIES]);
  assert.equal(parentCodeOf(ALL_COMMODITIES, LEVEL.ALL, known), null);
});

// -------------------------------------------------------------- findDataSheet / parseWorkbook

function buildWorkbook(rows, sheetName = 'Sheet3') {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return wb;
}

const HEADER = ['Level', 'Commodity Name', 'Commodity Code', 'Commodity Weight', 'Apr-24', 'May-24', 'Jun-24'];

test('findDataSheet: locates the sheet by header signature regardless of name', () => {
  const wb = buildWorkbook([
    ['irrelevant', 'title', 'page'],
    HEADER,
    [LEVEL.ALL, 'All Commodities', ALL_COMMODITIES, 100, 100, 101, 102],
  ]);
  const { name, headerRow } = findDataSheet(wb);
  assert.equal(name, 'Sheet3');
  assert.equal(headerRow, 1);
});

test('findDataSheet: throws a descriptive error when no sheet matches', () => {
  const wb = buildWorkbook([['a', 'b'], [1, 2]]);
  assert.throws(() => findDataSheet(wb), /No sheet matched the WPI header signature/);
});

test('parseWorkbook: full round trip — months, commodities, values, latestMonth, parentCode', () => {
  const rows = [
    HEADER,
    [LEVEL.ALL, 'All Commodities', ALL_COMMODITIES, 100, 100, 101, 102],
    [LEVEL.MAJOR_GROUP, 'Primary Articles', '1100000000', 22.6, 100, 102, 104],
    [LEVEL.SUB_GROUP, 'Food Grains', '1101000000', 3.4, 100, 103, 106],
    [LEVEL.ITEM, 'Paddy', '1101010101', 0.6, 120, '-', 130],
    ['', 'FOOD INDEX', '', 24.4, 100, 100, 101], // derived aggregate, no code -> skipped
  ];
  const parsed = parseWorkbook(buildWorkbook(rows), 'fixture.xlsx');

  assert.deepEqual(parsed.months, ['2024-04', '2024-05', '2024-06']);
  assert.equal(parsed.commodities.length, 4);
  assert.deepEqual(parsed.skipped, ['FOOD INDEX']);

  const paddy = parsed.commodities.find((c) => c.code === '1101010101');
  assert.equal(paddy.parentCode, '1101000000');

  const paddyMay = parsed.values.find((v) => v.code === '1101010101' && v.month === '2024-05');
  assert.equal(paddyMay.value, null); // '-' stays null, never 0

  // latestMonth is the last non-null value on the All Commodities row, not the
  // last column — here that's still 2024-06 since all three months are filled.
  assert.equal(parsed.latestMonth, '2024-06');
});

test('parseWorkbook: latestMonth stops at the last non-null All Commodities value, not the last column', () => {
  const rows = [
    HEADER,
    [LEVEL.ALL, 'All Commodities', ALL_COMMODITIES, 100, 100, 101, '-'],
  ];
  const parsed = parseWorkbook(buildWorkbook(rows), 'fixture.xlsx');
  assert.equal(parsed.latestMonth, '2024-05');
});

test('parseWorkbook: duplicate month columns are rejected', () => {
  const rows = [
    ['Level', 'Commodity Name', 'Commodity Code', 'Commodity Weight', 'Apr-24', 'Apr-24'],
    [LEVEL.ALL, 'All Commodities', ALL_COMMODITIES, 100, 100, 101],
  ];
  assert.throws(() => parseWorkbook(buildWorkbook(rows), 'fixture.xlsx'), /Duplicate month column/);
});
