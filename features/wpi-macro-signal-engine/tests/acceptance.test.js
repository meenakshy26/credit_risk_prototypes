import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../src/store/index.js';
import { ingestFile } from '../src/ingest/index.js';
import { seedAll } from '../src/seed/index.js';
import { runMonth } from '../src/pipeline/monthly.js';

/**
 * PRD §8: acceptance tests against the real June-2026 WPI file. This is Phase
 * 1's "done" bar (§9): the monthly run must reproduce these moves and flags,
 * and the §7.2 sample reports, from the real published file — not a fixture.
 *
 * The file itself is real government data pinned to one specific month and is
 * intentionally not committed (see .gitignore) — the repo stays code-only.
 * Run `npm run download` to fetch a current file, or drop the original
 * June-2026 file (wpi_monthly_index_202607.xlsx) at the repo root, and these
 * tests activate; otherwise they skip rather than fail a fresh checkout.
 */
const SOURCE_FILE = join(import.meta.dirname, '..', 'wpi_monthly_index_202607.xlsx');
const skip = existsSync(SOURCE_FILE) ? false : 'wpi_monthly_index_202607.xlsx not present locally (not committed — see .gitignore); run npm run download or place the original file at the repo root to enable these tests';

let store;
let run;

test.before(() => {
  if (skip) return;
  const dir = mkdtempSync(join(tmpdir(), 'wpi-acceptance-'));
  store = openStore(join(dir, 'wpi.db'));
  ingestFile(store, SOURCE_FILE, { logger: { warn: () => {} } });
  seedAll(store, { logger: { warn: () => {} } });
  run = runMonth(store);
  test.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

function rowFor(profileName, label) {
  const result = run.results.find((r) => r.signals.profile.name === profileName);
  return result.signals.rows.find((r) => r.label === label);
}

test('run resolves June 2026 vs March 2026, per the §8 table', { skip }, () => {
  assert.equal(run.month, '2026-06');
  assert.equal(run.comparisonMonth, '2026-03');
});

test('§8: Iron Ore +13.2% -> ORANGE, and drives a pressure-building warning on HR Coils', { skip }, () => {
  const ironOre = rowFor('Steel Trader', 'Iron Ore');
  assert.ok(Math.abs(ironOre.move3m - 0.132) < 0.0005);
  assert.equal(ironOre.flag, 'ORANGE');

  const steel = run.results.find((r) => r.signals.profile.name === 'Steel Trader').signals;
  const gapWarning = steel.rules.drivers.find((d) => d.label.toLowerCase().includes('hr coils'));
  assert.ok(gapWarning, 'expected a driver-pressure warning on HR Coils');
  assert.equal(gapWarning.driverCode, '1103010005');
});

test('§8: Fuel & Power +18.8% -> ORANGE on the rice trader\'s COST row', { skip }, () => {
  const fuel = rowFor('Aditya Rice', 'Freight & Diesel');
  assert.ok(Math.abs(fuel.move3m - 0.188) < 0.0005);
  assert.equal(fuel.flag, 'ORANGE');
});

test('§8: Mustard Seed +10.5% -> ORANGE, feeding a mild-squeeze margin verdict', { skip }, () => {
  const seed = rowFor('N.K. Product', 'Laha');
  assert.ok(Math.abs(seed.move3m - 0.105) < 0.0005);
  assert.equal(seed.flag, 'ORANGE');

  const nk = run.results.find((r) => r.signals.profile.name === 'N.K. Product').signals;
  assert.equal(nk.rules.squeeze.verdict, 'mild_squeeze');
});

test('§8: Rice non-basmati +2.8% -> quiet (ok)', { skip }, () => {
  const rice = rowFor('Aditya Rice', 'Rice');
  assert.ok(Math.abs(rice.move3m - 0.028) < 0.0005);
  assert.equal(rice.flag, 'ok');
});

test('§8: Hessian/Bardana +17.1% -> ORANGE', { skip }, () => {
  const bardana = rowFor('N.K. Product', 'Bardana');
  assert.ok(Math.abs(bardana.move3m - 0.171) < 0.0005);
  assert.equal(bardana.flag, 'ORANGE');
});

test('§7.2: N.K. Product report status is AMBER and margin block cites 8.4% for products together', { skip }, () => {
  const nk = run.results.find((r) => r.signals.profile.name === 'N.K. Product');
  assert.equal(nk.signals.status, 'AMBER');
  assert.match(nk.report.markdown, /\+8\.4% together/);
});

test('§7.2: Aditya Rice report cites the 3.3% margin and ~Rs 1.2 cr freight against Fuel & Power', { skip }, () => {
  const aditya = run.results.find((r) => r.signals.profile.name === 'Aditya Rice');
  assert.match(aditya.report.markdown, /3\.3% gross margin/);
  assert.match(aditya.report.markdown, /Rs 1\.20 cr of freight/);
});

test('every printed row is traceable to a WPI code and month (§7 generation rule)', { skip }, () => {
  for (const { report } of run.results) {
    for (const row of report.traceability.rows) {
      assert.ok(row.codes.length > 0, `${row.label} has no WPI code`);
    }
  }
});
