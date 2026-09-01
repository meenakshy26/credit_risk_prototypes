import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/store/index.js';
import { norm } from '../src/core/text.js';
import { LEVEL } from '../src/core/constants.js';
import { createApp } from '../src/server.js';

/**
 * Same synthetic fixture shape as tests/mapping.test.js — small, independent
 * commodity codes, not real WPI data. Exercises the HTTP wrapper around
 * mapping/intake.js: request validation, status codes, and that a successful
 * call returns the same report/summary text the CLI prints.
 */
function seedStore() {
  const store = openStore(':memory:');
  store.upsertCommodities([
    { code: '1000000000', name: 'All Commodities', level: LEVEL.ALL },
    { code: '1301060004', name: 'Rice Other Than Basmati', level: LEVEL.ITEM, parentCode: '1301060000' },
    { code: '1101010101', name: 'Paddy', level: LEVEL.ITEM, parentCode: '1101010100' },
  ]);
  const months = ['2026-03', '2026-04', '2026-05', '2026-06'];
  const series = {
    '1000000000': [138, 139, 140, 141],
    '1301060004': [100, 103, 108, 112],
    '1101010101': [100, 104, 112, 121],
  };
  const entries = [];
  for (const [code, values] of Object.entries(series)) {
    values.forEach((value, i) => entries.push({ code, month: months[i], value, isFinal: i < 3 }));
  }
  store.upsertIndexValues(entries);
  store.putSynonym({ term: norm('chawal'), commodityName: 'rice other than basmati', confidence: 'high', source: 'seed' });
  store.putDriver({ commodityKey: 'rice_non_basmati', driverCode: '1101010101', kind: 'upstream', note: 'Paddy leads rice.' });
  return store;
}

async function withServer(fn) {
  const store = seedStore();
  const app = createApp(store);
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    store.close();
  }
}

test('GET /health -> 200 ok', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  });
});

test('POST /profiles/intake: missing entity_name -> 400', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/profiles/intake`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ schedules: [{ type: 'raw_material', items: [{ name_verbatim: 'Chawal', value_inr: 100 }] }] }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /entity_name/);
  });
});

test('POST /profiles/intake: empty schedules -> 400', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/profiles/intake`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entity_name: 'X', schedules: [] }),
    });
    assert.equal(res.status, 400);
  });
});

test('POST /profiles/intake: unknown schedule type -> 422', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/profiles/intake`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entity_name: 'X', schedules: [{ type: 'bogus_type', items: [{ name_verbatim: 'Chawal', value_inr: 100 }] }] }),
    });
    assert.equal(res.status, 422);
    const body = await res.json();
    assert.match(body.error, /unknown schedule type/);
  });
});

test('POST /profiles/intake: item missing name_verbatim -> 422', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/profiles/intake`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entity_name: 'X', schedules: [{ type: 'raw_material', items: [{ value_inr: 100 }] }] }),
    });
    assert.equal(res.status, 422);
    const body = await res.json();
    assert.match(body.error, /name_verbatim/);
  });
});

test('POST /profiles/intake: a well-formed payload returns the same report the CLI prints', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/profiles/intake`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        entity_name: 'HTTP Test Traders',
        period: '2026-06',
        schedules: [
          { type: 'trading_purchases', items: [{ name_verbatim: 'Chawal', value_inr: 10000000 }] },
          { type: 'trading_sales', items: [{ name_verbatim: 'Chawal', value_inr: 10500000 }] },
        ],
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(typeof body.profileId, 'number');
    assert.equal(body.month, '2026-06');
    assert.ok(['GREEN', 'AMBER', 'RED'].includes(body.status));
    assert.match(body.summary, /HTTP TEST TRADERS/);
    assert.deepEqual(body.reviewEntries, []);
  });
});
