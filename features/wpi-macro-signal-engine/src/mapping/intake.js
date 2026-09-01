import { cleanName } from '../core/text.js';
import { assignRoles } from './roles.js';
import { resolveTerm } from './stage1.js';
import { mapToCode } from './stage2.js';
import { driverKeyForCode } from '../seed/drivers.js';
import { runProfileSignals, toEvidenceRows } from '../signals/run.js';
import { composeReport, policyChecksForProfile } from '../report/compose.js';
import { reviewFlagsFor } from '../pipeline/monthly.js';

// PRD §3.1 rule 5: only BUY/STOCK spawn a standalone WATCH row for their
// upstream driver. A COST row (e.g. Empty Tin) still carries the driverCode
// for its own early-warning sentence, but does not get a companion WATCH row
// — that mirrors the pilot profiles (N.K. Product has no separate "CR coils"
// row even though Empty Tin's driver is CR coils).
const AUTO_WATCH_ROLES = new Set(['BUY', 'STOCK']);
const DRIVER_KINDS_ATTACHED = new Set(['upstream', 'material']);

/**
 * PRD §3 receipt pipeline, minus the network/LLM edges not wired up yet:
 * clean names -> drop the immaterial tail -> assign roles (§3.1) -> resolve
 * each term (§5.1, synonym table only — unknown terms fall to Stage 2 at low
 * confidence rather than an LLM call) -> map to a WPI code (§5.2) -> auto-add
 * WATCH rows from the driver table. Returns a profile shaped exactly like
 * store.loadProfile() output, plus the review-queue entries §5.2's confidence
 * table calls for (Low confidence: PROXY + review).
 */
export function buildProfileFromIntake(store, payload) {
  const { entity_name: entityName, schedules, profile: meta = {} } = payload;
  if (!entityName) throw new Error('entity_name is required');
  if (!Array.isArray(schedules) || schedules.length === 0) throw new Error('schedules must be a non-empty array');

  const roleRows = assignRoles({ schedules });
  const items = [];
  const reviewEntries = [];

  for (const row of roleRows) {
    const cleaned = cleanName(row.nameVerbatim);
    const stage1 = resolveTerm(store, cleaned);
    const neighborhoodPrefixes = items.map((i) => i.codes[0]).filter(Boolean);
    const stage2 = mapToCode(store, stage1.commodityName, { stage1Confidence: stage1.confidence, neighborhoodPrefixes });

    items.push({
      label: row.nameVerbatim,
      displayName: (stage2.name ?? stage1.commodityName).toLowerCase(),
      role: row.role,
      codes: [stage2.code],
      isProxy: stage2.isProxy,
      confidence: stage2.confidence,
      valueInr: row.valueInr ?? null,
      share: row.share ?? null,
      note: row.note ?? '',
    });

    if (stage2.confidence === 'low') {
      reviewEntries.push({
        label: row.nameVerbatim,
        reason: `Stage 1 could not resolve "${row.nameVerbatim}" — committed ${stage2.name} [${stage2.code}] as an industry-level PROXY, pending review`,
        term: cleaned,
        resolvedName: stage1.commodityName,
        committedCode: stage2.code,
        confidence: stage2.confidence,
      });
    }
  }

  const seenDriverCodes = new Set();
  for (const item of [...items]) {
    if (item.codes.length !== 1) continue;
    const driverKey = driverKeyForCode(item.codes[0]);
    if (!driverKey) continue;
    const driver = store.driver(driverKey);
    if (!driver || !DRIVER_KINDS_ATTACHED.has(driver.kind)) continue;
    if (!['BUY', 'STOCK', 'COST'].includes(item.role)) continue;

    item.driverCode = driver.driverCode;
    const driverCommodity = store.commodity(driver.driverCode);
    item.driverName = driverCommodity ? driverCommodity.name.toLowerCase() : driver.driverCode;

    if (!AUTO_WATCH_ROLES.has(item.role) || seenDriverCodes.has(driver.driverCode)) continue;
    seenDriverCodes.add(driver.driverCode);
    items.push({
      label: item.driverName,
      displayName: item.driverName,
      role: 'WATCH',
      codes: [driver.driverCode],
      isProxy: false,
      confidence: 'high',
      watchKind: 'upstream',
      note: driver.note ?? '',
    });
  }

  const profile = {
    name: entityName,
    industry: meta.industry ?? null,
    importExposed: meta.importExposed ?? false,
    grossMarginPct: meta.grossMarginPct ?? null,
    grossProfitInr: meta.grossProfitInr ?? null,
    spreadName: meta.spreadName ?? 'gross spread',
    unitName: meta.unitName ?? 'unit',
    items,
  };

  return { profile, reviewEntries };
}

/**
 * PRD §3: full intake -> stored profile -> first verdict sheet, synchronous,
 * no human input. Reuses the same signal engine and report composer the
 * monthly cycle runs, against whatever WPI month is already ingested — a
 * borrower onboarded today reads identically to one seeded a year ago.
 */
export function intakeProfile(store, payload, { fx = null } = {}) {
  const { profile, reviewEntries } = buildProfileFromIntake(store, payload);

  const profileId = store.transaction(() => {
    const id = store.upsertProfile(profile);
    profile.items.forEach((item, i) => store.addProfileItem(id, item, i));
    for (const entry of reviewEntries) store.queueReview({ ...entry, profileId: id });
    return id;
  });

  const snapshot = store.loadIndexSnapshot();
  const stored = store.loadProfile(profileId);
  const signals = runProfileSignals(stored, snapshot, { fx });
  const previousStatus = store.previousStatus(profileId, signals.month);
  const report = composeReport(signals, {
    policyChecks: policyChecksForProfile(store, stored),
    previousStatus,
    revisions: store.revisionsForMonth(signals.month),
    reviewFlags: reviewFlagsFor(signals),
  });

  const runId = store.startSignalRun(signals.month, 1);
  store.recordSignals(runId, toEvidenceRows(signals));
  store.saveReport({
    runId,
    profileId,
    month: signals.month,
    status: signals.status,
    markdown: report.markdown,
    payload: { ...report, markdown: undefined },
  });

  return { profileId, signals, report, reviewEntries };
}
