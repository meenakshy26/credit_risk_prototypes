import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runMacroContext, runProfileSignals, toEvidenceRows } from '../signals/run.js';
import { composeReport, policyChecksForProfile } from '../report/compose.js';

/**
 * PRD §2 monthly cycle, steps 3-5: run the rules for every borrower, compose the
 * report, and record both the evidence log and the finished report. One call per
 * month; nothing here asks a question or waits for input, which is the Phase 1
 * "hands-free" requirement.
 */
export function runMonth(store, { fx = null } = {}) {
  const snapshot = store.loadIndexSnapshot();
  const macro = runMacroContext(snapshot);
  const profiles = store.profiles().map((p) => store.loadProfile(p.id));
  const revisions = store.revisionsForMonth(macro.month);
  const runId = store.startSignalRun(macro.month, profiles.length);

  const results = [];
  for (const profile of profiles) {
    const signals = runProfileSignals(profile, snapshot, { fx });
    const previousStatus = store.previousStatus(profile.id, signals.month);
    const report = composeReport(signals, {
      policyChecks: policyChecksForProfile(store, profile),
      previousStatus,
      revisions,
      reviewFlags: reviewFlagsFor(signals),
    });

    store.recordSignals(runId, toEvidenceRows(signals));
    store.saveReport({
      runId,
      profileId: profile.id,
      month: signals.month,
      status: signals.status,
      markdown: report.markdown,
      payload: { ...report, markdown: undefined },
    });

    results.push({ profileId: profile.id, signals, report });
  }

  return { runId, month: macro.month, comparisonMonth: macro.comparisonMonth, macro, results };
}

/**
 * PRD §5 safety net: a mapping the engine is not certain of is published with a
 * flag rather than withheld. A PROXY row and a row whose Stage 1 confidence was
 * below `high` are both cases a human should confirm once.
 */
function reviewFlagsFor(signals) {
  const out = [];
  for (const row of signals.rows) {
    if (row.isProxy) {
      out.push({ label: row.label, reason: `mapped to a parent group (${row.codeNames.join(', ')}) because no WPI item exists for it` });
    } else if (row.confidence && row.confidence !== 'high') {
      out.push({ label: row.label, reason: `${row.confidence} confidence on the name-to-code mapping` });
    }
    if (row.missingCodes.length > 0) {
      out.push({ label: row.label, reason: `code(s) ${row.missingCodes.join(', ')} not present in this month's file` });
    }
  }
  return out;
}

export const slug = (name) =>
  String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Markdown per borrower per month, plus the signal JSON that backs every figure. */
export function writeMonthOutputs(run, outDir) {
  const reportDir = join(outDir, 'reports', run.month);
  const signalDir = join(outDir, 'signals', run.month);
  mkdirSync(reportDir, { recursive: true });
  mkdirSync(signalDir, { recursive: true });

  const written = [];
  for (const { signals, report } of run.results) {
    const base = slug(signals.profile.name);
    const md = join(reportDir, `${base}.md`);
    const js = join(signalDir, `${base}.json`);
    writeFileSync(md, `${report.markdown}\n`);
    writeFileSync(js, `${JSON.stringify({ signals, traceability: report.traceability }, null, 2)}\n`);
    written.push({ profile: signals.profile.name, status: signals.status, markdown: md, signals: js });
  }

  const moversPath = join(signalDir, '_top-movers.json');
  writeFileSync(moversPath, `${JSON.stringify(run.macro, null, 2)}\n`);
  return { written, moversPath };
}
