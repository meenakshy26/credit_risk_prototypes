import { cleanName } from '../core/text.js';
import { PACKAGING_KEYWORDS } from '../seed/synonyms.js';

const TRADER_STOCK_SHARE = 0.7;
const PACKAGING_COST_SHARE = 0.1;
const SCHEDULE_MATERIALITY = 0.9;

const isPackaging = (cleaned) => {
  const words = cleaned.toLowerCase().split(' ');
  return PACKAGING_KEYWORDS.some((k) => words.includes(k));
};

/**
 * PRD §3: drops the immaterial tail of a schedule, keeping the largest items
 * whose values cover ~90% of that schedule's total. Items with no value are
 * kept by default — there is nothing to rank them against.
 */
export function trimImmaterial(items) {
  const valued = items.filter((i) => typeof i.valueInr === 'number');
  const unvalued = items.filter((i) => typeof i.valueInr !== 'number');
  const total = valued.reduce((sum, i) => sum + i.valueInr, 0);
  if (total <= 0) return items;

  const sorted = [...valued].sort((a, b) => b.valueInr - a.valueInr);
  const kept = [];
  let running = 0;
  for (const item of sorted) {
    kept.push(item);
    running += item.valueInr;
    if (running / total > SCHEDULE_MATERIALITY) break;
  }
  return [...kept, ...unvalued];
}

function scheduleTotal(items) {
  return items.reduce((sum, i) => sum + (typeof i.valueInr === 'number' ? i.valueInr : 0), 0);
}

/** Normalizes a raw §3 schedule item (snake_case value_inr, per the intake contract) to the camelCase shape used throughout role assignment. */
function normalizeItem(item) {
  return { name_verbatim: item.name_verbatim, valueInr: typeof item.value_inr === 'number' ? item.value_inr : undefined };
}

/**
 * PRD §3.1: deterministic role assignment, evaluated in the order given —
 * STOCK (trader test) first, then BUY, SELL, COST. WATCH is never taken from
 * the statement; it is added later from the driver table once items are
 * mapped to WPI codes (see mapping/intake.js).
 */
export function assignRoles({ schedules }) {
  const byType = Object.fromEntries(schedules.map((s) => [s.type, trimImmaterial(s.items.map(normalizeItem))]));
  const purchases = byType.trading_purchases ?? [];
  const sales = byType.trading_sales ?? [];
  const rawMaterial = byType.raw_material ?? [];
  const finishedGoods = byType.finished_goods ?? [];
  const expenses = byType.expenses ?? [];

  const purchasesTotal = scheduleTotal(purchases);
  const salesTotal = scheduleTotal(sales);
  const rmTotal = scheduleTotal(rawMaterial);

  const out = [];
  const stockedNames = new Set();

  // Rule 1: STOCK — same cleaned name is >=70% of value on both sides of the trading account.
  for (const buy of purchases) {
    const cleaned = cleanName(buy.name_verbatim);
    if (purchasesTotal <= 0 || buy.valueInr / purchasesTotal < TRADER_STOCK_SHARE) continue;
    const sell = sales.find((s) => cleanName(s.name_verbatim) === cleaned);
    if (!sell || salesTotal <= 0 || sell.valueInr / salesTotal < TRADER_STOCK_SHARE) continue;
    stockedNames.add(cleaned);
    out.push({
      nameVerbatim: buy.name_verbatim,
      cleaned,
      role: 'STOCK',
      valueInr: buy.valueInr,
      note: `traded: bought ${buy.valueInr}, sold ${sell.valueInr}`,
    });
  }

  // Rule 2: BUY — raw_material items, except packaging/consumables or <10% of RM value, which become COST.
  const reclassifiedPackaging = [];
  for (const item of rawMaterial) {
    const cleaned = cleanName(item.name_verbatim);
    if (stockedNames.has(cleaned)) continue;
    const share = rmTotal > 0 ? item.valueInr / rmTotal : null;
    if (isPackaging(cleaned) || (share !== null && share < PACKAGING_COST_SHARE)) {
      reclassifiedPackaging.push({ nameVerbatim: item.name_verbatim, cleaned, role: 'COST', valueInr: item.valueInr ?? null });
      continue;
    }
    out.push({ nameVerbatim: item.name_verbatim, cleaned, role: 'BUY', valueInr: item.valueInr ?? null, share });
  }

  // Rule 3: SELL — finished_goods items. One in both RM and FG gets BUY and SELL rows.
  for (const item of finishedGoods) {
    const cleaned = cleanName(item.name_verbatim);
    if (stockedNames.has(cleaned)) continue;
    out.push({ nameVerbatim: item.name_verbatim, cleaned, role: 'SELL', valueInr: item.valueInr ?? null });
  }

  // Rule 4: COST — only freight/diesel/power/electricity/packing lines from expenses qualify.
  const COST_EXPENSE_WORDS = ['freight', 'diesel', 'power', 'fuel', 'electricity', 'packing'];
  for (const item of expenses) {
    const cleaned = cleanName(item.name_verbatim);
    const words = cleaned.toLowerCase().split(' ');
    if (!COST_EXPENSE_WORDS.some((w) => words.includes(w))) continue;
    out.push({ nameVerbatim: item.name_verbatim, cleaned, role: 'COST', valueInr: item.valueInr ?? null });
  }
  out.push(...reclassifiedPackaging);

  // Fallback: a trading account with no RM/FG schedules and rule 1 not triggered -> purchases BUY, sales SELL.
  if (rawMaterial.length === 0 && finishedGoods.length === 0) {
    for (const item of purchases) {
      const cleaned = cleanName(item.name_verbatim);
      if (stockedNames.has(cleaned)) continue;
      out.push({ nameVerbatim: item.name_verbatim, cleaned, role: 'BUY', valueInr: item.valueInr ?? null });
    }
    for (const item of sales) {
      const cleaned = cleanName(item.name_verbatim);
      if (stockedNames.has(cleaned)) continue;
      out.push({ nameVerbatim: item.name_verbatim, cleaned, role: 'SELL', valueInr: item.valueInr ?? null });
    }
  }

  return out;
}
