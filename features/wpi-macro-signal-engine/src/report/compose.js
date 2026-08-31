import { DASH, monthLong, monthShort, pct } from '../core/text.js';
import { policyKeysForCodes } from '../seed/policyChecks.js';
import {
  costBlock,
  headlineBlock,
  inventoryBlock,
  marginBlock,
  policyBlock,
  questionsBlock,
  warningsBlock,
} from './templates.js';

/** PRD §7.1: fixed, in this order. Blocks that do not apply are omitted, never reordered. */
export const BLOCK_ORDER = Object.freeze(['headline', 'margin', 'inventory', 'cost', 'warnings', 'policy', 'questions']);

/**
 * Turns one profile's computed signals into the written Borrower Macro Signal
 * Report. `signals` is the only source of numbers; `context` carries the month's
 * shared facts (revisions, previous status) and the profile's policy checklist.
 */
export function composeReport(signals, { policyChecks = [], previousStatus = null, revisions = [], reviewFlags = [] } = {}) {
  const blocks = [
    headlineBlock(signals),
    marginBlock(signals),
    inventoryBlock(signals),
    costBlock(signals),
    warningsBlock(signals),
    policyBlock(signals, policyChecks),
    questionsBlock(signals),
  ].filter(Boolean);

  const ordered = BLOCK_ORDER.map((key) => blocks.find((b) => b.key === key)).filter(Boolean);

  const report = {
    profile: signals.profile,
    month: signals.month,
    comparisonMonth: signals.comparisonMonth,
    status: signals.status,
    previousStatus,
    blocks: ordered,
    traceability: traceability(signals, revisions, reviewFlags),
  };

  return { ...report, markdown: renderMarkdown(report) };
}

/**
 * PRD §7: every figure must be traceable to a WPI code and month. This is that
 * audit trail — which code produced each row, which rows are PROXY rather than
 * an exact item, which provisional values moved since last month (§4 rule 6),
 * and which mappings the safety net wants a human to look at (§5).
 */
function traceability(signals, revisions, reviewFlags) {
  return {
    wpiMonth: signals.month,
    comparedWith: signals.comparisonMonth,
    yearAgo: signals.yearAgoMonth,
    rows: signals.rows.map((r) => ({
      label: r.label,
      role: r.role,
      codes: r.codes,
      codeNames: r.codeNames,
      isProxy: r.isProxy,
      confidence: r.confidence,
      valueThen: r.valueThen,
      valueNow: r.valueNow,
      move3m: r.move3m,
      move12m: r.move12m,
      flag: r.flag,
      fxUpgraded: r.fxUpgraded ?? false,
      missingCodes: r.missingCodes,
    })),
    revisions,
    reviewFlags,
  };
}

function renderMarkdown(report) {
  const lines = [];
  const [headline, ...rest] = report.blocks;

  lines.push(`# ${headline.title}`, '');
  lines.push(headline.sentences.join(' '), '');

  if (report.previousStatus && report.previousStatus.status !== report.status) {
    lines.push(
      `> Status changed from **${report.previousStatus.status}** in ${monthLong(report.previousStatus.month)} to **${report.status}** this month.`,
      '',
    );
  }

  for (const block of rest) {
    lines.push(`**${block.heading}:** ${block.sentences.join(' ')}`, '');
  }

  lines.push(...renderTraceability(report));
  return lines.join('\n');
}

function renderTraceability(report) {
  const t = report.traceability;
  const lines = ['---', '', '### Traceability', ''];
  lines.push(
    `WPI item-wise index, base 2022-23. Latest month **${monthLong(t.wpiMonth)}**, compared with **${monthLong(t.comparedWith)}**.`,
    '',
  );
  lines.push(
    `| Item (their books) | Role | WPI item [code] | ${monthShort(t.comparedWith)} | ${monthShort(t.wpiMonth)} | 3-mo | 12-mo | Flag |`,
  );
  lines.push('| --- | --- | --- | ---: | ---: | ---: | ---: | --- |');
  for (const r of t.rows) {
    const names = r.codeNames.map((n, i) => `${n} [${r.codes[i]}]`).join(' + ');
    const proxy = r.isProxy ? ' _(PROXY)_' : '';
    const fx = r.fxUpgraded ? ' _(FX)_' : '';
    lines.push(
      `| ${r.label}${proxy} | ${r.role} | ${names} | ${fmt(r.valueThen)} | ${fmt(r.valueNow)} | **${pct(r.move3m)}** | ${pct(r.move12m)} | ${r.flag}${fx} |`,
    );
  }
  lines.push('');

  const policy = report.blocks.find((b) => b.key === 'policy');
  if (policy) {
    lines.push('Override sources:', '');
    for (const c of policy.checks) lines.push(`- ${c.text} ${DASH} <${c.url}>`);
    lines.push('');
  }

  if (t.revisions.length > 0) {
    lines.push(
      `Revisions since last run (provisional values restated by the publisher):`,
      '',
      ...t.revisions.map((r) => `- ${r.name ?? r.code} [${r.code}] ${r.month}: ${r.oldValue} to ${r.newValue}`),
      '',
    );
  }

  if (t.reviewFlags.length > 0) {
    lines.push(
      'Mapping flagged for review (signal still published, tagged per §5 safety net):',
      '',
      ...t.reviewFlags.map((f) => `- ${f.label}: ${f.reason}`),
      '',
    );
  }

  const missing = t.rows.filter((r) => r.missingCodes.length > 0);
  if (missing.length > 0) {
    lines.push(
      'Codes absent from this month file:',
      '',
      ...missing.map((r) => `- ${r.label}: ${r.missingCodes.join(', ')}`),
      '',
    );
  }

  return lines;
}

function fmt(v) {
  return v === null || v === undefined ? DASH : String(v);
}

/** The policy checklist for a profile, derived from the codes it actually maps to. */
export function policyChecksForProfile(store, profile) {
  const codes = profile.items.flatMap((i) => i.codes);
  return store.policyChecksFor(policyKeysForCodes(codes, { importExposed: profile.importExposed }));
}
