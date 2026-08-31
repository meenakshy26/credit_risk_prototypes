import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downloadLatestFile, wpiFileName } from '../src/ingest/download.js';

test('wpiFileName: formats a YYYY-MM month into the publisher\'s filename', () => {
  assert.equal(wpiFileName('2026-08'), 'wpi_monthly_index_202608.xlsx');
});

test('downloadLatestFile: saves the current month\'s file when it resolves first try', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wpi-dl-'));
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return { ok: true, arrayBuffer: async () => new TextEncoder().encode('fake-xlsx-bytes').buffer };
  };

  const result = await downloadLatestFile({ destDir: dir, referenceDate: new Date(2026, 7, 20), fetchImpl });

  assert.equal(calls.length, 1);
  assert.match(calls[0], /wpi_monthly_index_202608\.xlsx$/);
  assert.equal(result.publicationMonth, '2026-08');
  assert.equal(readFileSync(result.path, 'utf8'), 'fake-xlsx-bytes');
  rmSync(dir, { recursive: true, force: true });
});

test('downloadLatestFile: falls back to the previous month when the current one 404s', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wpi-dl-'));
  const fetchImpl = async (url) => {
    if (url.includes('202608')) return { ok: false, status: 404 };
    return { ok: true, arrayBuffer: async () => new TextEncoder().encode('july-file').buffer };
  };

  const result = await downloadLatestFile({ destDir: dir, referenceDate: new Date(2026, 7, 5), fetchImpl });

  assert.equal(result.publicationMonth, '2026-07');
  assert.match(result.path, /wpi_monthly_index_202607\.xlsx$/);
  rmSync(dir, { recursive: true, force: true });
});

test('downloadLatestFile: throws with a clear message when nothing in the lookback window resolves', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wpi-dl-'));
  const fetchImpl = async () => ({ ok: false, status: 404 });

  await assert.rejects(
    downloadLatestFile({ destDir: dir, referenceDate: new Date(2026, 7, 20), lookback: 2, fetchImpl }),
    /Could not find a live WPI file/,
  );
  rmSync(dir, { recursive: true, force: true });
});
