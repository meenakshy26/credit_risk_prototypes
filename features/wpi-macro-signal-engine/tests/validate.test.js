import test from 'node:test';
import assert from 'node:assert/strict';
import { VALIDATION_LIMITS, validateParsed } from '../src/ingest/validate.js';
import { ALL_COMMODITIES, LEVEL } from '../src/core/constants.js';

function baseParsed(overrides = {}) {
  const items = Array.from({ length: VALIDATION_LIMITS.minItems }, (_, i) => ({
    code: `9${String(i).padStart(9, '0')}`,
    level: LEVEL.ITEM,
  }));
  const commodities = [
    { code: ALL_COMMODITIES, level: LEVEL.ALL },
    ...items,
    ...Array.from({ length: VALIDATION_LIMITS.minRows - items.length - 1 }, (_, i) => ({
      code: `8${String(i).padStart(9, '0')}`,
      level: LEVEL.GROUP,
    })),
  ];
  return {
    commodities,
    values: [{ code: ALL_COMMODITIES, month: '2026-06', value: 150 }],
    latestMonth: '2026-06',
    skipped: [],
    ...overrides,
  };
}

test('validateParsed: a healthy file passes with no failures', () => {
  const { failures } = validateParsed(baseParsed());
  assert.deepEqual(failures, []);
});

test('validateParsed: fails when row count is below the floor', () => {
  const { failures } = validateParsed(baseParsed({ commodities: [{ code: ALL_COMMODITIES, level: LEVEL.ALL }] }));
  assert.ok(failures.some((f) => f.check === 'row_count'));
  assert.ok(failures.some((f) => f.check === 'item_count'));
});

test('validateParsed: fails when All Commodities row is missing', () => {
  const parsed = baseParsed();
  parsed.commodities = parsed.commodities.filter((c) => c.code !== ALL_COMMODITIES);
  const { failures } = validateParsed(parsed);
  assert.ok(failures.some((f) => f.check === 'all_commodities'));
});

test('validateParsed: month must advance by exactly 1 from the previous ingest (§4 rule 7)', () => {
  const same = validateParsed(baseParsed(), { previousLatestMonth: '2026-06' });
  assert.ok(same.failures.some((f) => f.check === 'month_advance'));

  const backwards = validateParsed(baseParsed(), { previousLatestMonth: '2026-07' });
  assert.ok(backwards.failures.some((f) => f.check === 'month_advance'));

  const jumped = validateParsed(baseParsed(), { previousLatestMonth: '2026-03' });
  assert.ok(jumped.failures.some((f) => f.check === 'month_advance'));

  const exactlyOne = validateParsed(baseParsed(), { previousLatestMonth: '2026-05' });
  assert.ok(!exactlyOne.failures.some((f) => f.check === 'month_advance'));
});

test('validateParsed: fails when mapped-code presence drops below 95%', () => {
  const mappedCodes = Array.from({ length: 20 }, (_, i) => `7${String(i).padStart(9, '0')}`);
  const parsed = baseParsed();
  // Only 1 of 20 mapped codes present -> presence far below 95%.
  parsed.commodities.push({ code: mappedCodes[0], level: LEVEL.ITEM });
  const { failures } = validateParsed(parsed, { mappedCodes });
  assert.ok(failures.some((f) => f.check === 'mapped_code_presence'));
});

test('validateParsed: a single missing mapped code out of many is a warning, not a failure', () => {
  const mappedCodes = Array.from({ length: 100 }, (_, i) => `7${String(i).padStart(9, '0')}`);
  const parsed = baseParsed();
  for (const c of mappedCodes.slice(1)) parsed.commodities.push({ code: c, level: LEVEL.ITEM });
  const { failures, warnings } = validateParsed(parsed, { mappedCodes });
  assert.deepEqual(failures, []);
  assert.ok(warnings.some((w) => w.check === 'mapped_code_presence'));
});

test('validateParsed: uncoded rows produce a warning, never a failure', () => {
  const { failures, warnings } = validateParsed(baseParsed({ skipped: ['FOOD INDEX'] }));
  assert.deepEqual(failures, []);
  assert.ok(warnings.some((w) => w.check === 'uncoded_rows'));
});
