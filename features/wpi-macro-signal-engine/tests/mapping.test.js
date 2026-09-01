import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/store/index.js';
import { norm } from '../src/core/text.js';
import { LEVEL } from '../src/core/constants.js';
import { assignRoles, trimImmaterial } from '../src/mapping/roles.js';
import { resolveTerm } from '../src/mapping/stage1.js';
import { mapToCode } from '../src/mapping/stage2.js';
import { intakeProfile } from '../src/mapping/intake.js';

/**
 * Synthetic fixture — small, independent commodity codes and made-up values,
 * not the real WPI file or any real borrower's numbers (see .gitignore and
 * README: this repo stays code-only). Exercises the full §3/§5 intake
 * pipeline end to end, plus each stage in isolation.
 */
function seedStore() {
  const store = openStore(':memory:');
  store.upsertCommodities([
    { code: '1000000000', name: 'All Commodities', level: LEVEL.ALL },
    { code: '1301060004', name: 'Rice Other Than Basmati', level: LEVEL.ITEM, parentCode: '1301060000' },
    { code: '1101010101', name: 'Paddy', level: LEVEL.ITEM, parentCode: '1101010100' },
    { code: '1200000000', name: 'Fuel And Power', level: LEVEL.ITEM },
    { code: '1102020002', name: 'Rapeseed And Mustard Seed', level: LEVEL.ITEM, parentCode: '1102020000' },
    { code: '1315020000', name: 'Tanks Reservoirs And Containers Of Metal', level: LEVEL.SUB_GROUP },
    { code: '1314010012', name: 'Cold Rolled Steel Coils Sheets Strips', level: LEVEL.ITEM, parentCode: '1314010000' },
    { code: '1301040099', name: 'Edible Oil', level: LEVEL.ITEM },
  ]);

  const months = ['2026-03', '2026-04', '2026-05', '2026-06'];
  const series = {
    '1000000000': [138, 139, 140, 141],
    '1301060004': [100, 103, 108, 112],
    '1101010101': [100, 104, 112, 121],
    '1200000000': [110, 111, 105, 105],
    '1102020002': [100, 102, 108, 110],
  };
  const entries = [];
  for (const [code, values] of Object.entries(series)) {
    values.forEach((value, i) => entries.push({ code, month: months[i], value, isFinal: i < 3 }));
  }
  store.upsertIndexValues(entries);

  for (const [term, commodityName] of [
    ['laha', 'rapeseed and mustard seed'],
    ['chawal', 'rice other than basmati'],
    ['freight', 'fuel and power'],
    ['empty tin', 'tanks reservoirs and containers of metal'],
  ]) {
    store.putSynonym({ term: norm(term), commodityName, confidence: 'high', source: 'seed' });
  }
  store.putDriver({ commodityKey: 'rice_non_basmati', driverCode: '1101010101', kind: 'upstream', note: 'Paddy leads rice.' });
  store.putDriver({ commodityKey: 'metal_containers', driverCode: '1314010012', kind: 'material', note: 'Tins are pressed steel.' });

  return store;
}

// -------------------------------------------------------------- trimImmaterial

test('trimImmaterial: drops the tail once kept items cover ~90% of schedule value', () => {
  const items = [
    { name_verbatim: 'Big', valueInr: 900 },
    { name_verbatim: 'Small', valueInr: 90 },
    { name_verbatim: 'Tiny', valueInr: 10 },
  ];
  const kept = trimImmaterial(items);
  assert.deepEqual(kept.map((i) => i.name_verbatim), ['Big', 'Small']);
});

test('trimImmaterial: items with no value are always kept, never ranked away', () => {
  const items = [{ name_verbatim: 'Big', valueInr: 1000 }, { name_verbatim: 'Unvalued' }];
  const kept = trimImmaterial(items);
  assert.ok(kept.some((i) => i.name_verbatim === 'Unvalued'));
});

// -------------------------------------------------------------- assignRoles (PRD §3.1)

test('assignRoles: same name >=70% of value on both sides of the trading account -> one STOCK row', () => {
  const rows = assignRoles({
    schedules: [
      { type: 'trading_purchases', items: [{ name_verbatim: 'Chawal', value_inr: 10000000 }] },
      { type: 'trading_sales', items: [{ name_verbatim: 'Chawal', value_inr: 10500000 }] },
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].role, 'STOCK');
});

test('assignRoles: packaging keyword or <10% of RM value reclassifies raw-material items to COST', () => {
  const rows = assignRoles({
    schedules: [{
      type: 'raw_material',
      items: [
        { name_verbatim: 'Laha', value_inr: 7000000 },
        { name_verbatim: 'Empty Tin', value_inr: 2200000 },
      ],
    }],
  });
  const laha = rows.find((r) => r.nameVerbatim === 'Laha');
  const tin = rows.find((r) => r.nameVerbatim === 'Empty Tin');
  assert.equal(laha.role, 'BUY');
  assert.equal(tin.role, 'COST');
});

test('assignRoles: expenses only qualify as COST when they are freight/diesel/power/electricity/packing', () => {
  const rows = assignRoles({
    schedules: [{
      type: 'expenses',
      items: [
        { name_verbatim: 'Freight', value_inr: 500000 },
        { name_verbatim: 'Audit Fees', value_inr: 50000 },
      ],
    }],
  });
  assert.deepEqual(rows.map((r) => r.nameVerbatim), ['Freight']);
});

test('assignRoles: fallback — trading account with no RM/FG schedules and rule 1 not triggered -> purchases BUY, sales SELL', () => {
  const rows = assignRoles({
    schedules: [
      { type: 'trading_purchases', items: [{ name_verbatim: 'Wheat', value_inr: 100 }] },
      { type: 'trading_sales', items: [{ name_verbatim: 'Wheat Flour', value_inr: 120 }] },
    ],
  });
  assert.deepEqual(rows.map((r) => [r.nameVerbatim, r.role]), [['Wheat', 'BUY'], ['Wheat Flour', 'SELL']]);
});

// -------------------------------------------------------------- Stage 1 term resolution

test('resolveTerm: known term resolves from the synonym table at its stored confidence', () => {
  const store = seedStore();
  const hit = resolveTerm(store, 'Laha');
  assert.equal(hit.commodityName, 'rapeseed and mustard seed');
  assert.equal(hit.confidence, 'high');
  store.close();
});

test('resolveTerm: unknown term passes through as low confidence (no LLM wired up)', () => {
  const store = seedStore();
  const hit = resolveTerm(store, 'Zorblatt Compound');
  assert.equal(hit.confidence, 'low');
  assert.equal(hit.commodityName, 'Zorblatt Compound');
  store.close();
});

// -------------------------------------------------------------- Stage 2 code lookup + confidence tiers

test('mapToCode: Stage 1 confident + clear Item match -> High, exact code, not a PROXY', () => {
  const store = seedStore();
  const hit = mapToCode(store, 'rice other than basmati', { stage1Confidence: 'high' });
  assert.equal(hit.code, '1301060004');
  assert.equal(hit.confidence, 'high');
  assert.equal(hit.isProxy, false);
  store.close();
});

test('mapToCode: no Item exists -> nearest parent Sub Group, tagged PROXY, Medium confidence', () => {
  const store = seedStore();
  const hit = mapToCode(store, 'tanks reservoirs and containers of metal', { stage1Confidence: 'high' });
  assert.equal(hit.code, '1315020000');
  assert.equal(hit.isProxy, true);
  assert.equal(hit.confidence, 'medium');
  store.close();
});

test('mapToCode: Stage 1 cannot resolve -> Low confidence PROXY regardless of string similarity', () => {
  const store = seedStore();
  const hit = mapToCode(store, 'Zorblatt Compound', { stage1Confidence: 'low' });
  assert.equal(hit.confidence, 'low');
  assert.equal(hit.isProxy, true);
  store.close();
});

test('mapToCode: a generic single word stays Medium even with a clear Item match', () => {
  const store = seedStore();
  // Stage 1 (via synonym) is confident this brand name means "oil" — but "oil"
  // alone is too generic to commit an exact item without borrower context.
  store.putSynonym({ term: 'planturol', commodityName: 'oil', confidence: 'high', source: 'seed' });
  const stage1 = resolveTerm(store, 'Planturol');
  const hit = mapToCode(store, stage1.commodityName, { stage1Confidence: stage1.confidence });
  assert.equal(hit.confidence, 'medium');
  store.close();
});

// -------------------------------------------------------------- Full intake (PRD §3 receipt pipeline)

test('intakeProfile: raw schedules -> stored profile, mapped codes, auto-added WATCH, review queue, and a report', () => {
  const store = seedStore();
  const result = intakeProfile(store, {
    entity_name: 'Test Rice & Mustard Traders',
    period: '2026-06',
    schedules: [
      { type: 'trading_purchases', items: [{ name_verbatim: 'Chawal', value_inr: 10000000 }] },
      { type: 'trading_sales', items: [{ name_verbatim: 'Chawal', value_inr: 10500000 }] },
      { type: 'raw_material', items: [
        { name_verbatim: 'Laha', value_inr: 7000000 },
        { name_verbatim: 'Empty Tin', value_inr: 2200000 },
      ] },
      { type: 'finished_goods', items: [{ name_verbatim: 'Zorblatt Compound', value_inr: 500000 }] },
      { type: 'expenses', items: [{ name_verbatim: 'Freight', value_inr: 300000 }] },
    ],
  });

  const stored = store.loadProfile(result.profileId);
  const byLabel = Object.fromEntries(stored.items.map((i) => [i.label, i]));

  // STOCK trader test + exact high-confidence mapping.
  assert.equal(byLabel.Chawal.role, 'STOCK');
  assert.deepEqual(byLabel.Chawal.codes, ['1301060004']);
  assert.equal(byLabel.Chawal.confidence, 'high');

  // §3.1 rule 5: STOCK's upstream driver (paddy) is auto-added as a standalone WATCH row.
  const watchRow = stored.items.find((i) => i.role === 'WATCH');
  assert.ok(watchRow, 'expected an auto-added WATCH row for paddy');
  assert.deepEqual(watchRow.codes, ['1101010101']);

  // BUY, mapped high-confidence, no further upstream driver of its own.
  assert.equal(byLabel.Laha.role, 'BUY');
  assert.equal(byLabel.Laha.confidence, 'high');

  // Packaging reclassified to COST, PROXY (no WPI item for tin containers),
  // and carries its material driver — but does NOT spawn a second WATCH row.
  assert.equal(byLabel['Empty Tin'].role, 'COST');
  assert.equal(byLabel['Empty Tin'].isProxy, true);
  assert.equal(byLabel['Empty Tin'].driverCode, '1314010012');
  assert.equal(stored.items.filter((i) => i.role === 'WATCH').length, 1);

  // Freight -> exact fuel-and-power code, high confidence.
  assert.equal(byLabel.Freight.role, 'COST');
  assert.deepEqual(byLabel.Freight.codes, ['1200000000']);

  // Unresolvable term: Low confidence, PROXY, and queued for review.
  assert.equal(byLabel['Zorblatt Compound'].confidence, 'low');
  assert.equal(result.reviewEntries.length, 1);
  assert.equal(result.reviewEntries[0].label, 'Zorblatt Compound');
  const openReviews = store.openReviews();
  assert.equal(openReviews.length, 1);
  assert.equal(openReviews[0].profileId, result.profileId);

  // The same report pipeline the monthly cycle uses ran end to end (title is
  // upper-cased by the composer's existing header convention — see templates.js).
  assert.match(result.report.markdown, /TEST RICE & MUSTARD TRADERS/);
  assert.equal(result.signals.month, '2026-06');

  store.close();
});
