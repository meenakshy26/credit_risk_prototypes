import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { SCHEMA } from './schema.js';
import { ALL_COMMODITIES } from '../core/constants.js';

export function openStore(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  return new Store(db);
}

const nowIso = () => new Date().toISOString();

const PROFILE_COLUMNS = `id, name, industry, gross_margin_pct AS grossMarginPct,
  gross_profit_inr AS grossProfitInr, import_exposed AS importExposed,
  spread_name AS spreadName, unit_name AS unitName`;

export class Store {
  constructor(db) {
    this.db = db;
  }

  close() {
    this.db.close();
  }

  transaction(fn) {
    this.db.exec('BEGIN');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  // ---------- commodities ----------

  upsertCommodities(rows) {
    const stmt = this.db.prepare(
      `INSERT INTO commodities (code, name, level, weight, parent_code)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(code) DO UPDATE SET
         name = excluded.name, level = excluded.level,
         weight = excluded.weight, parent_code = excluded.parent_code`,
    );
    for (const r of rows) stmt.run(r.code, r.name, r.level, r.weight ?? null, r.parentCode ?? null);
    return rows.length;
  }

  allCommodities() {
    return this.db.prepare('SELECT code, name, level, weight, parent_code AS parentCode FROM commodities').all();
  }

  commodity(code) {
    return this.db
      .prepare('SELECT code, name, level, weight, parent_code AS parentCode FROM commodities WHERE code = ?')
      .get(code);
  }

  countCommodities() {
    return this.db.prepare('SELECT COUNT(*) AS n FROM commodities').get().n;
  }

  // ---------- index values ----------

  /**
   * Upserts values and returns the list of provisional values whose number
   * changed, so the caller can log revisions (§4 rule 6). A value already
   * marked final is never overwritten.
   */
  upsertIndexValues(entries) {
    const existing = this.db.prepare('SELECT value, is_final AS isFinal FROM index_values WHERE code = ? AND month = ?');
    const insert = this.db.prepare(
      `INSERT INTO index_values (code, month, value, is_final)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(code, month) DO UPDATE SET value = excluded.value, is_final = excluded.is_final`,
    );
    const revisions = [];
    let written = 0;
    for (const e of entries) {
      const prev = existing.get(e.code, e.month);
      if (prev?.isFinal === 1) continue;
      if (prev && prev.value !== e.value && prev.value !== null && e.value !== null) {
        revisions.push({ code: e.code, month: e.month, oldValue: prev.value, newValue: e.value });
      }
      insert.run(e.code, e.month, e.value, e.isFinal ? 1 : 0);
      written += 1;
    }
    return { written, revisions };
  }

  logRevisions(revisions, ingestRunId) {
    const stmt = this.db.prepare(
      `INSERT INTO revisions (code, month, old_value, new_value, ingest_run_id, observed_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const at = nowIso();
    for (const r of revisions) stmt.run(r.code, r.month, r.oldValue, r.newValue, ingestRunId, at);
  }

  revisionsForMonth(month) {
    return this.db
      .prepare(
        `SELECT r.code, r.month, r.old_value AS oldValue, r.new_value AS newValue, c.name
         FROM revisions r LEFT JOIN commodities c ON c.code = r.code
         WHERE r.month = ? ORDER BY r.id`,
      )
      .all(month);
  }

  allRevisions() {
    return this.db
      .prepare(
        `SELECT r.code, r.month, r.old_value AS oldValue, r.new_value AS newValue, c.name
         FROM revisions r LEFT JOIN commodities c ON c.code = r.code ORDER BY r.id`,
      )
      .all();
  }

  distinctMonths() {
    return this.db.prepare('SELECT DISTINCT month FROM index_values ORDER BY month').all().map((r) => r.month);
  }

  /**
   * Builds the in-memory shape the signal service reads: an ordered month axis
   * plus one aligned series per code. `latestIndex` is the last month with a
   * non-null All Commodities value, never simply the last column (§4 rule 4).
   */
  loadIndexSnapshot() {
    const months = this.distinctMonths();
    const monthPos = new Map(months.map((m, i) => [m, i]));
    const byCode = new Map();
    for (const c of this.allCommodities()) {
      byCode.set(c.code, { ...c, series: new Array(months.length).fill(null) });
    }
    for (const row of this.db.prepare('SELECT code, month, value FROM index_values').all()) {
      const entry = byCode.get(row.code);
      const pos = monthPos.get(row.month);
      if (entry && pos !== undefined) entry.series[pos] = row.value;
    }
    const all = byCode.get(ALL_COMMODITIES);
    if (!all) throw new Error(`No index data stored for All Commodities (${ALL_COMMODITIES}) — run ingest first.`);
    let latestIndex = -1;
    all.series.forEach((v, i) => {
      if (v !== null) latestIndex = i;
    });
    if (latestIndex < 3) throw new Error('Fewer than 4 months of index data stored — cannot compute a 3-month move.');
    return { months, latestIndex, byCode };
  }

  // ---------- ingest runs ----------

  startIngestRun(sourceFile) {
    const info = this.db
      .prepare(`INSERT INTO ingest_runs (source_file, status, ran_at) VALUES (?, 'running', ?)`)
      .run(sourceFile, nowIso());
    return Number(info.lastInsertRowid);
  }

  finishIngestRun(id, { status, latestMonth = null, rowCount = null, message = null }) {
    this.db
      .prepare('UPDATE ingest_runs SET status = ?, latest_month = ?, row_count = ?, message = ? WHERE id = ?')
      .run(status, latestMonth, rowCount, message, id);
  }

  lastSuccessfulIngest() {
    return this.db
      .prepare(
        `SELECT id, source_file AS sourceFile, latest_month AS latestMonth, row_count AS rowCount, ran_at AS ranAt
         FROM ingest_runs WHERE status = 'ok' ORDER BY id DESC LIMIT 1`,
      )
      .get();
  }

  // ---------- profiles ----------

  upsertProfile(profile) {
    const existing = this.db.prepare('SELECT id FROM profiles WHERE name = ?').get(profile.name);
    if (existing) {
      this.db
        .prepare(
          `UPDATE profiles SET industry = ?, gross_margin_pct = ?, gross_profit_inr = ?,
             import_exposed = ?, spread_name = ?, unit_name = ? WHERE id = ?`,
        )
        .run(
          profile.industry ?? null,
          profile.grossMarginPct ?? null,
          profile.grossProfitInr ?? null,
          profile.importExposed ? 1 : 0,
          profile.spreadName ?? null,
          profile.unitName ?? null,
          existing.id,
        );
      this.db.prepare('DELETE FROM profile_items WHERE profile_id = ?').run(existing.id);
      return existing.id;
    }
    const info = this.db
      .prepare(
        `INSERT INTO profiles
           (name, industry, gross_margin_pct, gross_profit_inr, import_exposed, spread_name, unit_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        profile.name,
        profile.industry ?? null,
        profile.grossMarginPct ?? null,
        profile.grossProfitInr ?? null,
        profile.importExposed ? 1 : 0,
        profile.spreadName ?? null,
        profile.unitName ?? null,
        nowIso(),
      );
    return Number(info.lastInsertRowid);
  }

  addProfileItem(profileId, item, sortOrder) {
    const info = this.db
      .prepare(
        `INSERT INTO profile_items
           (profile_id, label, display_name, role, is_proxy, driver_code, driver_name, watch_kind,
            value_inr, share, confidence, note, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        profileId,
        item.label,
        item.displayName ?? null,
        item.role,
        item.isProxy ? 1 : 0,
        item.driverCode ?? null,
        item.driverName ?? null,
        item.watchKind ?? null,
        item.valueInr ?? null,
        item.share ?? null,
        item.confidence ?? 'high',
        item.note ?? null,
        sortOrder,
      );
    const itemId = Number(info.lastInsertRowid);
    const codeStmt = this.db.prepare('INSERT INTO profile_item_codes (profile_item_id, code, sort_order) VALUES (?, ?, ?)');
    item.codes.forEach((code, i) => codeStmt.run(itemId, code, i));
    return itemId;
  }

  profiles() {
    return this.db.prepare(`SELECT ${PROFILE_COLUMNS} FROM profiles ORDER BY id`).all();
  }

  profileByName(name) {
    return this.db.prepare(`SELECT ${PROFILE_COLUMNS} FROM profiles WHERE name = ?`).get(name);
  }

  profileItems(profileId) {
    const items = this.db
      .prepare(
        `SELECT id, label, display_name AS displayName, role, is_proxy AS isProxy,
                driver_code AS driverCode, driver_name AS driverName, watch_kind AS watchKind,
                value_inr AS valueInr, share, confidence, note
         FROM profile_items WHERE profile_id = ? ORDER BY sort_order, id`,
      )
      .all(profileId);
    const codeStmt = this.db.prepare(
      'SELECT code FROM profile_item_codes WHERE profile_item_id = ? ORDER BY sort_order',
    );
    return items.map((i) => ({
      ...i,
      isProxy: i.isProxy === 1,
      codes: codeStmt.all(i.id).map((r) => r.code),
    }));
  }

  loadProfile(profileId) {
    const p = this.db.prepare(`SELECT ${PROFILE_COLUMNS} FROM profiles WHERE id = ?`).get(profileId);
    if (!p) return null;
    return { ...p, importExposed: p.importExposed === 1, items: this.profileItems(profileId) };
  }

  // ---------- synonyms ----------

  putSynonym({ term, commodityName, confidence = 'high', source = 'seed' }) {
    this.db
      .prepare(
        `INSERT INTO synonyms (term, commodity_name, confidence, source, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(term) DO UPDATE SET
           commodity_name = excluded.commodity_name,
           confidence = excluded.confidence,
           source = excluded.source`,
      )
      .run(term, commodityName, confidence, source, nowIso());
  }

  synonym(term) {
    return this.db
      .prepare('SELECT term, commodity_name AS commodityName, confidence, source FROM synonyms WHERE term = ?')
      .get(term);
  }

  countSynonyms() {
    return this.db.prepare('SELECT COUNT(*) AS n FROM synonyms').get().n;
  }

  // ---------- drivers & policy checks ----------

  putDriver({ commodityKey, driverCode, kind, note = null }) {
    this.db
      .prepare(
        `INSERT INTO drivers (commodity_key, driver_code, kind, note) VALUES (?, ?, ?, ?)
         ON CONFLICT(commodity_key) DO UPDATE SET
           driver_code = excluded.driver_code, kind = excluded.kind, note = excluded.note`,
      )
      .run(commodityKey, driverCode, kind, note);
  }

  driver(commodityKey) {
    return this.db
      .prepare('SELECT commodity_key AS commodityKey, driver_code AS driverCode, kind, note FROM drivers WHERE commodity_key = ?')
      .get(commodityKey);
  }

  putPolicyCheck({ commodityKey, text, url, sortOrder = 0 }) {
    this.db
      .prepare('INSERT INTO policy_checks (commodity_key, text, url, sort_order) VALUES (?, ?, ?, ?)')
      .run(commodityKey, text, url, sortOrder);
  }

  policyChecksFor(keys) {
    if (keys.length === 0) return [];
    const placeholders = keys.map(() => '?').join(',');
    return this.db
      .prepare(
        `SELECT commodity_key AS commodityKey, text, url FROM policy_checks
         WHERE commodity_key IN (${placeholders}) ORDER BY sort_order, id`,
      )
      .all(...keys);
  }

  clearPolicyChecks() {
    this.db.exec('DELETE FROM policy_checks');
  }

  // ---------- signal runs, evidence log, reports ----------

  startSignalRun(month, profileCount) {
    const info = this.db
      .prepare('INSERT INTO signal_runs (month, ran_at, profile_count) VALUES (?, ?, ?)')
      .run(month, nowIso(), profileCount);
    return Number(info.lastInsertRowid);
  }

  recordSignals(runId, rows) {
    const stmt = this.db.prepare(
      `INSERT INTO signals
         (run_id, profile_id, profile_item_id, month, kind, rule, code, move_3m, move_12m, flag, severity, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const r of rows) {
      stmt.run(
        runId,
        r.profileId ?? null,
        r.profileItemId ?? null,
        r.month,
        r.kind,
        r.rule ?? null,
        r.code ?? null,
        r.move3m ?? null,
        r.move12m ?? null,
        r.flag ?? null,
        r.severity ?? null,
        r.detail ?? null,
      );
    }
  }

  saveReport({ runId, profileId, month, status, markdown, payload }) {
    this.db
      .prepare(
        `INSERT INTO reports (run_id, profile_id, month, status, markdown, payload)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(profile_id, month) DO UPDATE SET
           run_id = excluded.run_id, status = excluded.status,
           markdown = excluded.markdown, payload = excluded.payload`,
      )
      .run(runId, profileId, month, status, markdown, JSON.stringify(payload));
  }

  report(profileId, month) {
    const row = this.db
      .prepare('SELECT status, markdown, payload FROM reports WHERE profile_id = ? AND month = ?')
      .get(profileId, month);
    return row ? { ...row, payload: JSON.parse(row.payload) } : null;
  }

  /** Previous month's status, for the "status change" line in the monthly diff. */
  previousStatus(profileId, month) {
    const row = this.db
      .prepare('SELECT status, month FROM reports WHERE profile_id = ? AND month < ? ORDER BY month DESC LIMIT 1')
      .get(profileId, month);
    return row ?? null;
  }

  queueReview(entry) {
    this.db
      .prepare(
        `INSERT INTO review_queue
           (profile_id, profile_item_id, reason, term, resolved_name, committed_code, confidence, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.profileId ?? null,
        entry.profileItemId ?? null,
        entry.reason,
        entry.term ?? null,
        entry.resolvedName ?? null,
        entry.committedCode ?? null,
        entry.confidence ?? null,
        nowIso(),
      );
  }

  openReviews() {
    return this.db
      .prepare(
        `SELECT id, profile_id AS profileId, profile_item_id AS profileItemId, reason, term,
                resolved_name AS resolvedName, committed_code AS committedCode, confidence
         FROM review_queue WHERE status = 'open' ORDER BY id`,
      )
      .all();
  }
}
