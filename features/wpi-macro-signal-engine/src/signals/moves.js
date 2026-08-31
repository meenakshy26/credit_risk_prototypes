import { LEVEL, THRESHOLDS } from '../core/constants.js';

export const FLAG = Object.freeze({ RED: 'RED', ORANGE: 'ORANGE', OK: 'ok', NA: 'n/a' });

/**
 * PRD §6. Ported from the prototype with the comparisons left strict, so a move
 * of exactly 20.0% is ORANGE and exactly 10.0% is quiet. Changing these to >=
 * would silently reclassify borderline borrowers.
 */
export function flagOf(move) {
  if (move === null || move === undefined) return FLAG.NA;
  const a = Math.abs(move);
  if (a > THRESHOLDS.itemRed) return FLAG.RED;
  if (a > THRESHOLDS.itemOrange) return FLAG.ORANGE;
  return FLAG.OK;
}

/** One level up the flag ladder, for the FX rule (§6). */
export function upgradeFlag(flag) {
  if (flag === FLAG.OK) return FLAG.ORANGE;
  if (flag === FLAG.ORANGE) return FLAG.RED;
  return flag;
}

/**
 * Wraps an index snapshot in the read-only accessors the rules need. Every
 * number a report can print originates here, which is what makes §7's
 * traceability claim ("every figure traceable to a WPI code and month") hold.
 */
export function seriesReader(snapshot) {
  const { months, latestIndex, byCode } = snapshot;

  const valueAt = (code, offsetBack) => {
    const pos = latestIndex - offsetBack;
    if (pos < 0) return null;
    const entry = byCode.get(code);
    return entry ? entry.series[pos] : null;
  };

  const move = (code, back) => {
    const now = valueAt(code, 0);
    const then = valueAt(code, back);
    if (now === null || then === null || then === 0) return null;
    return now / then - 1;
  };

  /**
   * A profile row may carry several codes (mustard oil is published under two).
   * The row's move is the mean of its codes' moves, so a two-code row still
   * counts once when rows are later averaged — see marginSqueeze.
   */
  const moveMulti = (codes, back) => {
    const moves = codes.map((c) => move(c, back)).filter((m) => m !== null);
    if (moves.length === 0) return null;
    return moves.reduce((a, b) => a + b, 0) / moves.length;
  };

  const monthAt = (offsetBack) => {
    const pos = latestIndex - offsetBack;
    return pos < 0 ? null : months[pos];
  };

  const name = (code) => byCode.get(code)?.name ?? null;

  const hasCode = (code) => byCode.has(code);

  return { months, latestIndex, byCode, valueAt, move, moveMulti, monthAt, name, hasCode };
}

/** PRD §6: top-25 movers across all leaf Items — macro backdrop and WATCH candidates. */
export function topMovers(reader, limit = 25) {
  const rows = [];
  for (const entry of reader.byCode.values()) {
    if (entry.level !== LEVEL.ITEM) continue;
    const move3m = reader.move(entry.code, 3);
    if (move3m === null) continue;
    rows.push({ code: entry.code, name: entry.name, move3m, flag: flagOf(move3m) });
  }
  rows.sort((a, b) => Math.abs(b.move3m) - Math.abs(a.move3m));
  return rows.slice(0, limit);
}
