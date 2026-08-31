import { SEVERITY_RANK, STATUS } from '../core/constants.js';
import { FLAG, flagOf, seriesReader, topMovers } from './moves.js';
import { driverPressure, fxPressure, inventory, marginSqueeze } from './rules.js';

const FLAG_SEVERITY = Object.freeze({ [FLAG.RED]: STATUS.RED, [FLAG.ORANGE]: STATUS.AMBER, [FLAG.OK]: STATUS.GREEN, [FLAG.NA]: STATUS.GREEN });

export function worstStatus(severities) {
  let worst = STATUS.GREEN;
  for (const s of severities) {
    if (SEVERITY_RANK[s] > SEVERITY_RANK[worst]) worst = s;
  }
  return worst;
}

/** Every displayable number for one profile row, each tied to its codes and months. */
export function computeRow(reader, item) {
  const codeNames = item.codes.map((c) => reader.name(c) ?? `code ${c} not in file`);
  const missingCodes = item.codes.filter((c) => !reader.hasCode(c));
  const move3m = reader.moveMulti(item.codes, 3);
  const move12m = reader.moveMulti(item.codes, 12);
  const single = item.codes.length === 1 ? item.codes[0] : null;

  return {
    itemId: item.id,
    label: item.label,
    displayName: item.displayName ?? item.label,
    role: item.role,
    codes: item.codes,
    codeNames,
    missingCodes,
    isProxy: item.isProxy,
    watchKind: item.watchKind ?? null,
    confidence: item.confidence,
    note: item.note,
    valueInr: item.valueInr,
    share: item.share,
    valueThen: single ? reader.valueAt(single, 3) : null,
    valueNow: single ? reader.valueAt(single, 0) : null,
    move3m,
    move12m,
    flag: flagOf(move3m),
    driverCode: item.driverCode ?? null,
    driverName: item.driverCode ? (item.driverName ?? reader.name(item.driverCode)) : null,
    driverMove3m: item.driverCode ? reader.move(item.driverCode, 3) : null,
  };
}

/**
 * PRD §6 monthly signal run for one borrower. Returns only computed values —
 * no prose. The report composer turns this into sentences (§7), and nothing
 * downstream may introduce a number that did not come from here.
 */
export function runProfileSignals(profile, snapshot, { fx = null } = {}) {
  const reader = seriesReader(snapshot);
  const month = reader.monthAt(0);
  const comparisonMonth = reader.monthAt(3);
  const yearAgoMonth = reader.monthAt(12);

  const rows = profile.items.map((item) => computeRow(reader, item));

  const fxRule = fxPressure(rows, { fx, importExposed: profile.importExposed });
  if (fxRule.applied) {
    const byId = new Map(fxRule.upgraded.map((u) => [u.itemId, u]));
    for (const row of rows) {
      const upgrade = byId.get(row.itemId);
      if (!upgrade) continue;
      row.flagBeforeFx = upgrade.from;
      row.flag = upgrade.to;
      row.fxUpgraded = true;
    }
  }

  const squeeze = marginSqueeze(rows);
  const stock = inventory(rows);
  const drivers = driverPressure(rows);

  const rules = [squeeze, stock, ...drivers, fxRule].filter(Boolean);
  const status = worstStatus([...rules.map((r) => r.severity), ...rows.map((r) => FLAG_SEVERITY[r.flag])]);

  return {
    profile: {
      id: profile.id,
      name: profile.name,
      industry: profile.industry,
      grossMarginPct: profile.grossMarginPct,
      importExposed: profile.importExposed,
    },
    month,
    comparisonMonth,
    yearAgoMonth,
    status,
    rows,
    rules: { squeeze, stock, drivers, fx: fxRule },
    ruleList: rules,
  };
}

/** Run-level context shared by every borrower report in the month. */
export function runMacroContext(snapshot, { moverLimit = 25 } = {}) {
  const reader = seriesReader(snapshot);
  return {
    month: reader.monthAt(0),
    comparisonMonth: reader.monthAt(3),
    topMovers: topMovers(reader, moverLimit),
  };
}

/** Flattens a signal result into evidence-log rows (§6). */
export function toEvidenceRows(signals) {
  const out = [];
  for (const row of signals.rows) {
    out.push({
      profileId: signals.profile.id,
      profileItemId: row.itemId,
      month: signals.month,
      kind: 'item_flag',
      rule: null,
      code: row.codes.join(','),
      move3m: row.move3m,
      move12m: row.move12m,
      flag: row.flag,
      severity: FLAG_SEVERITY[row.flag],
      detail: JSON.stringify({
        label: row.label,
        role: row.role,
        isProxy: row.isProxy,
        fxUpgraded: row.fxUpgraded ?? false,
      }),
    });
  }
  for (const rule of signals.ruleList) {
    out.push({
      profileId: signals.profile.id,
      profileItemId: null,
      month: signals.month,
      kind: 'rule',
      rule: rule.rule,
      code: null,
      move3m: null,
      move12m: null,
      flag: null,
      severity: rule.severity,
      detail: JSON.stringify(rule, replaceRowRefs),
    });
  }
  return out;
}

/** Rule objects carry whole row references; the evidence log only needs labels. */
function replaceRowRefs(key, value) {
  if ((key === 'buyRows' || key === 'sellRows' || key === 'stockRows') && Array.isArray(value)) {
    return value.map((r) => ({ label: r.label, move3m: r.move3m }));
  }
  return value;
}
