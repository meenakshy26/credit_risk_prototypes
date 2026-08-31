import test from 'node:test';
import assert from 'node:assert/strict';
import { FLAG, flagOf, seriesReader, topMovers, upgradeFlag } from '../src/signals/moves.js';
import { driverPressure, fxPressure, inventory, marginSqueeze } from '../src/signals/rules.js';
import { STATUS } from '../src/core/constants.js';
import { LEVEL } from '../src/core/constants.js';

// -------------------------------------------------------------- flagOf (§6 thresholds, strict comparisons)

test('flagOf: thresholds are strict — exactly 20% is not RED, exactly 10% is not ORANGE', () => {
  assert.equal(flagOf(0.2), FLAG.ORANGE); // > 10% orange band, not yet > 20% red
  assert.equal(flagOf(0.2000001), FLAG.RED);
  assert.equal(flagOf(0.1), FLAG.OK);
  assert.equal(flagOf(0.1000001), FLAG.ORANGE);
  assert.equal(flagOf(-0.25), FLAG.RED); // magnitude, not sign
});

test('flagOf: null/undefined move is n/a', () => {
  assert.equal(flagOf(null), FLAG.NA);
  assert.equal(flagOf(undefined), FLAG.NA);
});

test('upgradeFlag: one step up the ladder, RED stays RED', () => {
  assert.equal(upgradeFlag(FLAG.OK), FLAG.ORANGE);
  assert.equal(upgradeFlag(FLAG.ORANGE), FLAG.RED);
  assert.equal(upgradeFlag(FLAG.RED), FLAG.RED);
  assert.equal(upgradeFlag(FLAG.NA), FLAG.NA);
});

// -------------------------------------------------------------- seriesReader / moveMulti

function snapshotFrom(entries) {
  const months = ['2026-03', '2026-04', '2026-05', '2026-06'];
  const byCode = new Map();
  for (const [code, series] of Object.entries(entries)) {
    byCode.set(code, { code, name: code, level: LEVEL.ITEM, series });
  }
  return { months, latestIndex: 3, byCode };
}

test('seriesReader.move: 3-month move is now/then - 1', () => {
  const reader = seriesReader(snapshotFrom({ A: [100, 102, 104, 110] }));
  assert.ok(Math.abs(reader.move('A', 3) - 0.1) < 1e-9);
});

test('seriesReader.move: null when either endpoint is null, never divides by zero', () => {
  const reader = seriesReader(snapshotFrom({ A: [null, 102, 104, 110], B: [0, 102, 104, 110] }));
  assert.equal(reader.move('A', 3), null);
  assert.equal(reader.move('B', 3), null);
});

test('seriesReader.moveMulti: averages the moves of a multi-code row (two-code SELL row counts once)', () => {
  // mustard oil: 1301040002 and 1301040012 — mean of their individual 3-month moves.
  const reader = seriesReader(snapshotFrom({
    oil1: [100, 100, 100, 102], // +2%
    oil2: [100, 100, 100, 106], // +6%
  }));
  assert.ok(Math.abs(reader.moveMulti(['oil1', 'oil2'], 3) - 0.04) < 1e-9); // (2%+6%)/2
});

test('topMovers: ranks by absolute move and only considers Item-level rows', () => {
  const reader = seriesReader(snapshotFrom({
    big: [100, 100, 100, 130], // +30%
    small: [100, 100, 100, 101], // +1%
  }));
  reader.byCode.get('big').level = LEVEL.ITEM;
  reader.byCode.get('small').level = LEVEL.ITEM;
  const movers = topMovers(reader, 5);
  assert.equal(movers[0].code, 'big');
});

// -------------------------------------------------------------- marginSqueeze (§6)

const row = (role, move3m, extra = {}) => ({ role, move3m, ...extra });

test('marginSqueeze: gap below -3pp is "earning_less" (RED)', () => {
  const rows = [row('BUY', 0.15), row('SELL', 0.08)]; // gap = -7pp
  const result = marginSqueeze(rows);
  assert.equal(result.verdict, 'earning_less');
  assert.equal(result.severity, STATUS.RED);
});

test('marginSqueeze: gap between -3pp and 0 is "mild_squeeze" (AMBER) — reproduces §7.2 N.K. Product', () => {
  // PRD §7.2: mustard seed +10.5%, products +8.4% together -> gap = -2.1pp
  const rows = [row('BUY', 0.105), row('SELL', 0.084)];
  const result = marginSqueeze(rows);
  assert.equal(result.verdict, 'mild_squeeze');
  assert.equal(result.severity, STATUS.AMBER);
  assert.ok(Math.abs(result.gap - -0.021) < 1e-9);
});

test('marginSqueeze: gap >= 0 is healthy (GREEN)', () => {
  const rows = [row('BUY', 0.02), row('SELL', 0.05)];
  const result = marginSqueeze(rows);
  assert.equal(result.verdict, 'healthy');
  assert.equal(result.severity, STATUS.GREEN);
});

test('marginSqueeze: null when either side has no rows', () => {
  assert.equal(marginSqueeze([row('BUY', 0.1)]), null);
  assert.equal(marginSqueeze([row('SELL', 0.1)]), null);
});

test('marginSqueeze: rows with a null move3m are excluded from the average', () => {
  const rows = [row('BUY', 0.1), row('BUY', null), row('SELL', 0.1)];
  const result = marginSqueeze(rows);
  assert.equal(result.buyAvg, 0.1);
});

// -------------------------------------------------------------- inventory (§6)

test('inventory: move below -10% is losing_on_stock (RED)', () => {
  const result = inventory([row('STOCK', -0.15)]);
  assert.equal(result.verdict, 'losing_on_stock');
  assert.equal(result.severity, STATUS.RED);
});

test('inventory: move above +10% is paper_gains (AMBER)', () => {
  const result = inventory([row('STOCK', 0.15)]);
  assert.equal(result.verdict, 'paper_gains');
  assert.equal(result.severity, STATUS.AMBER);
});

test('inventory: move within band is quiet (GREEN) — reproduces §7.2 rice trader (+2.8%)', () => {
  const result = inventory([row('STOCK', 0.028)]);
  assert.equal(result.verdict, 'quiet');
  assert.equal(result.severity, STATUS.GREEN);
});

test('inventory: null when no STOCK rows', () => {
  assert.equal(inventory([row('BUY', 0.1)]), null);
});

// -------------------------------------------------------------- driverPressure (§6)

test('driverPressure: flags when driver move exceeds item move by more than 5pp', () => {
  const rows = [{ itemId: 1, driverCode: 'CR', driverName: 'CR coils', driverMove3m: 0.092, move3m: 0.021, label: 'Empty Tin' }];
  const out = driverPressure(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].severity, STATUS.AMBER);
  assert.ok(Math.abs(out[0].gap - 0.071) < 1e-9);
});

test('driverPressure: no flag when gap is at or below 5pp, or codes/moves are missing', () => {
  assert.equal(driverPressure([{ itemId: 1, driverCode: 'X', driverMove3m: 0.1, move3m: 0.06 }]).length, 0); // gap = 4pp
  assert.equal(driverPressure([{ itemId: 1, driverCode: null, driverMove3m: 0.1, move3m: 0.01 }]).length, 0);
  assert.equal(driverPressure([{ itemId: 1, driverCode: 'X', driverMove3m: null, move3m: 0.01 }]).length, 0);
});

// -------------------------------------------------------------- fxPressure (§6)

test('fxPressure: no fx input -> reported unavailable, nothing upgraded', () => {
  const result = fxPressure([{ itemId: 1, flag: FLAG.OK }], { fx: null, importExposed: true });
  assert.equal(result.verdict, 'no_fx_input');
  assert.equal(result.applied, false);
});

test('fxPressure: not import-exposed -> never applied even if rupee weak', () => {
  const result = fxPressure([{ itemId: 1, flag: FLAG.OK }], { fx: { weakeningMove3m: 0.08 }, importExposed: false });
  assert.equal(result.applied, false);
  assert.equal(result.verdict, 'not_import_exposed');
});

test('fxPressure: rupee weaker than 5% and import-exposed upgrades every flag one level', () => {
  const rows = [
    { itemId: 1, flag: FLAG.OK },
    { itemId: 2, flag: FLAG.ORANGE },
    { itemId: 3, flag: FLAG.RED },
    { itemId: 4, flag: FLAG.NA },
  ];
  const result = fxPressure(rows, { fx: { weakeningMove3m: 0.06 }, importExposed: true });
  assert.equal(result.applied, true);
  assert.equal(result.severity, STATUS.AMBER);
  assert.equal(result.upgraded.length, 2); // OK->ORANGE, ORANGE->RED; RED stays RED and NA is skipped, so neither counts
  const byId = new Map(result.upgraded.map((u) => [u.itemId, u]));
  assert.equal(byId.get(1).to, FLAG.ORANGE);
  assert.equal(byId.get(2).to, FLAG.RED);
});

test('fxPressure: rupee move at or below 5% does not apply', () => {
  const result = fxPressure([{ itemId: 1, flag: FLAG.OK }], { fx: { weakeningMove3m: 0.05 }, importExposed: true });
  assert.equal(result.applied, false);
});
