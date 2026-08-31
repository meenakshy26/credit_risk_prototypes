import { STATUS, THRESHOLDS } from '../core/constants.js';
import { FLAG, upgradeFlag } from './moves.js';

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const movesOf = (rows, role) => rows.filter((r) => r.role === role && r.move3m !== null);

/**
 * PRD §6, margin squeeze. Averages across ROWS, not across codes: a row that
 * maps to several codes has already been collapsed to one move by moveMulti,
 * so a two-code product counts once. This is what reproduces the §7.2 sample's
 * 8.4% for mustard oil (two codes) plus oil cake (one code).
 */
export function marginSqueeze(rows) {
  const buyRows = movesOf(rows, 'BUY');
  const sellRows = movesOf(rows, 'SELL');
  if (buyRows.length === 0 || sellRows.length === 0) return null;

  const buyAvg = mean(buyRows.map((r) => r.move3m));
  const sellAvg = mean(sellRows.map((r) => r.move3m));
  const gap = sellAvg - buyAvg;

  const severity = gap < THRESHOLDS.marginSqueezeRed ? STATUS.RED : gap < 0 ? STATUS.AMBER : STATUS.GREEN;
  const verdict = gap < THRESHOLDS.marginSqueezeRed ? 'earning_less' : gap < 0 ? 'mild_squeeze' : 'healthy';

  return { rule: 'margin_squeeze', severity, verdict, buyAvg, sellAvg, gap, buyRows, sellRows };
}

/** PRD §6, inventory rule — a trader's exposure is the value of goods held. */
export function inventory(rows) {
  const stockRows = movesOf(rows, 'STOCK');
  if (stockRows.length === 0) return null;

  const stockAvg = mean(stockRows.map((r) => r.move3m));
  const severity =
    stockAvg < THRESHOLDS.inventoryLoss ? STATUS.RED : stockAvg > THRESHOLDS.inventoryGain ? STATUS.AMBER : STATUS.GREEN;
  const verdict =
    stockAvg < THRESHOLDS.inventoryLoss ? 'losing_on_stock' : stockAvg > THRESHOLDS.inventoryGain ? 'paper_gains' : 'quiet';

  return { rule: 'inventory', severity, verdict, stockAvg, stockRows };
}

/**
 * PRD §6, pressure building. An upstream input that has already moved but has
 * not yet shown up in the item's own price is a 1-2 month leading indicator.
 */
export function driverPressure(rows) {
  const out = [];
  for (const row of rows) {
    if (!row.driverCode || row.driverMove3m === null || row.move3m === null) continue;
    const gap = row.driverMove3m - row.move3m;
    if (gap <= THRESHOLDS.driverGap) continue;
    out.push({
      rule: 'driver_pressure',
      severity: STATUS.AMBER,
      itemId: row.itemId,
      label: row.displayName ?? row.label,
      itemMove: row.move3m,
      driverCode: row.driverCode,
      driverName: row.driverName,
      driverMove: row.driverMove3m,
      gap,
    });
  }
  return out;
}

/**
 * PRD §6, FX. WPI carries no exchange rate, so the rupee move is an injected
 * input; with none supplied the rule is reported as unavailable rather than
 * assumed benign, and the RBI reference-rate check stays in the policy block.
 */
export function fxPressure(rows, { fx, importExposed }) {
  if (!fx || typeof fx.weakeningMove3m !== 'number') {
    return { rule: 'fx', severity: STATUS.GREEN, verdict: 'no_fx_input', applied: false, upgraded: [] };
  }
  if (!importExposed || fx.weakeningMove3m <= THRESHOLDS.fxWeaker) {
    return {
      rule: 'fx',
      severity: STATUS.GREEN,
      verdict: importExposed ? 'rupee_stable' : 'not_import_exposed',
      applied: false,
      weakeningMove3m: fx.weakeningMove3m,
      source: fx.source ?? null,
      upgraded: [],
    };
  }

  const upgraded = [];
  for (const row of rows) {
    if (row.flag === FLAG.NA) continue;
    const next = upgradeFlag(row.flag);
    if (next !== row.flag) upgraded.push({ itemId: row.itemId, label: row.label, from: row.flag, to: next });
  }

  return {
    rule: 'fx',
    severity: upgraded.length > 0 ? STATUS.AMBER : STATUS.GREEN,
    verdict: 'rupee_weaker',
    applied: true,
    weakeningMove3m: fx.weakeningMove3m,
    source: fx.source ?? null,
    upgraded,
  };
}
