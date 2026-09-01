/**
 * PRD §5.1 term resolution. Stage 1 only ever proposes a commodity NAME
 * (+ confidence) — never a code. Known terms resolve instantly from the
 * synonym memory table; unknown terms have no LLM wired up yet (that's the
 * deferred half of §5.1), so they resolve to the cleaned name itself at low
 * confidence and Stage 2 / the confidence-tier commit decides what happens
 * next — typically the review queue.
 */
import { norm } from '../core/text.js';

export function resolveTerm(store, cleanedName) {
  const term = norm(cleanedName);
  const hit = store.synonym(term);
  if (hit) return { commodityName: hit.commodityName, confidence: hit.confidence, source: hit.source };
  return { commodityName: cleanedName, confidence: 'low', source: 'unresolved' };
}
