import { norm } from '../core/text.js';
import { CODE_LEVEL_WIDTH, LEVEL, ALL_COMMODITIES } from '../core/constants.js';

const STOP_WORDS = new Set(['and', 'the', 'for', 'incl', 'excl', 'other', 'others', 'with', 'non', 'exp', 'charges', 'expenses', 'misc', 'fee', 'fees']);

// PRD §5.2 confidence table: a single generic token like "Oil" cannot commit
// an exact Item on its own — it must be narrowed by the borrower's own
// commodity neighbourhood, so it is always at best a Medium-confidence PROXY.
const GENERIC_TERMS = new Set(['oil', 'tin', 'box', 'coal', 'bar', 'power', 'sheet', 'scrap', 'flour', 'sugar']);

/** Ported from the prototype's fuzzyScored, byte-identical scoring against real commodity names (see core/text.js norm). */
function scoreCandidates(commodities, resolvedName, limit = 5) {
  const q = norm(resolvedName);
  const toks = q.split(' ').filter((t) => t.length > 2 && !STOP_WORDS.has(t));
  if (toks.length === 0) return [];
  const scored = [];
  for (const it of commodities) {
    const n = norm(it.name);
    const words = n.split(' ');
    let s = 0;
    for (const t of toks) {
      if (words.includes(t)) s += t.length > 3 ? 4 : 2;
      else if (n.includes(t)) s += t.length > 3 ? 2 : 1;
      else if (t.length > 4 && n.includes(t.slice(0, t.length - 1))) s += 1;
    }
    if (n === q) s += 10;
    if (it.level === LEVEL.ITEM) s += 1;
    if (s > 0) scored.push({ ...it, score: s });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

function isGeneric(resolvedName) {
  const toks = norm(resolvedName).split(' ').filter((t) => t.length > 2 && !STOP_WORDS.has(t));
  return toks.length === 1 && GENERIC_TERMS.has(toks[0]);
}

/**
 * Cuts a code to a wider (less specific) hierarchy level and returns the
 * nearest ancestor actually present in the store, walking up levels until
 * one is found. Every WPI file carries its own group/sub-group rows (§4
 * rule 5), so this always resolves to something real short of "All Commodities".
 */
function nearestParent(store, code, fromLevel) {
  const widths = [CODE_LEVEL_WIDTH[LEVEL.SS_GROUP], CODE_LEVEL_WIDTH[LEVEL.SUB_GROUP], CODE_LEVEL_WIDTH[LEVEL.GROUP], CODE_LEVEL_WIDTH[LEVEL.MAJOR_GROUP]]
    .filter((w) => w < (CODE_LEVEL_WIDTH[fromLevel] ?? 10));
  for (const width of widths) {
    const candidate = `${code.slice(0, width)}${'0'.repeat(10 - width)}`;
    const found = store.commodity(candidate);
    if (found) return found;
  }
  return store.commodity(ALL_COMMODITIES);
}

/**
 * PRD §5.2 + confidence table. Combines Stage 1's confidence with how well
 * the resolved name matches the ~800 WPI items to decide what gets committed:
 * an exact Item code, a PROXY parent constrained to the borrower's own
 * commodity neighbourhood, or an industry-level PROXY sent to review.
 */
export function mapToCode(store, resolvedName, { stage1Confidence = 'high', neighborhoodPrefixes = [] } = {}) {
  const all = store.allCommodities();
  const top = scoreCandidates(all, resolvedName, 5);
  const best = top[0] ?? null;
  const generic = isGeneric(resolvedName);

  if (!best) {
    const parent = nearestParent(store, ALL_COMMODITIES, LEVEL.MAJOR_GROUP) ?? store.commodity(ALL_COMMODITIES);
    return { code: parent.code, name: parent.name, level: parent.level, isProxy: true, confidence: 'low', matchStrength: 'none', candidates: [] };
  }

  const clear = best.level === LEVEL.ITEM && best.score >= 6;

  if (stage1Confidence === 'high' && clear && !generic) {
    return { code: best.code, name: best.name, level: best.level, isProxy: false, confidence: 'high', matchStrength: 'clear', candidates: top };
  }

  if (stage1Confidence === 'low') {
    const parent = nearestParent(store, best.code, LEVEL.SUB_GROUP);
    return { code: parent.code, name: parent.name, level: parent.level, isProxy: true, confidence: 'low', matchStrength: clear ? 'clear' : 'weak', candidates: top, needsReview: true };
  }

  // Medium: Stage 1 unsure, a generic word, or only a weak Stage 2 match.
  // Prefer, among the top-scoring candidates (i.e. genuine ties — never a
  // weaker candidate over a stronger one), the one nearest the borrower's
  // other mapped items (longest shared code prefix) before falling back to best.
  let pick = best;
  if (neighborhoodPrefixes.length > 0) {
    const tied = top.filter((c) => c.score === best.score);
    let bestOverlap = -1;
    for (const cand of tied) {
      const overlap = Math.max(...neighborhoodPrefixes.map((p) => sharedPrefixLength(p, cand.code)));
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        pick = cand;
      }
    }
  }
  const parent = nearestParent(store, pick.code, LEVEL.SS_GROUP);
  return { code: parent.code, name: parent.name, level: parent.level, isProxy: true, confidence: 'medium', matchStrength: clear ? 'clear' : 'weak', candidates: top };
}

function sharedPrefixLength(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return i;
}
