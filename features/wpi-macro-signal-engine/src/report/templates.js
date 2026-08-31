import { FUEL_AND_POWER, STATUS } from '../core/constants.js';
import { DASH, inr, joinProse, monthLong, pct, pp } from '../core/text.js';
import { FLAG } from '../signals/moves.js';
import { PACKAGING_KEYWORDS } from '../seed/synonyms.js';

/**
 * PRD §7 generation rule: every sentence here is a fixed template filled with
 * numbers that arrived from the signal service. Nothing in this file computes a
 * move, a direction or a verdict, and nothing in it may call an LLM. An LLM may
 * smooth the finished prose downstream, but if it ever produced a figure the
 * report would stop being traceable to a WPI code and month.
 */

const ACTOR_NOUNS = ['mill', 'trader', 'unit', 'factory', 'plant', 'processor', 'manufacturer'];

export function subjectNoun(industry) {
  const words = String(industry ?? '').toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const actor = [...words].reverse().find((w) => ACTOR_NOUNS.includes(w));
  return actor ? `the ${actor}` : 'the borrower';
}

const isPackaging = (row) => {
  const haystack = `${row.label} ${row.displayName}`.toLowerCase();
  return PACKAGING_KEYWORDS.some((k) => new RegExp(`\\b${k}\\b`).test(haystack));
};

const isEnergy = (row) =>
  row.codes.includes(FUEL_AND_POWER) || /fuel|power|diesel|electric|freight|petrol|coal/i.test(`${row.label} ${row.displayName}`);

const flagged = (row) => row.flag === FLAG.ORANGE || row.flag === FLAG.RED;

/** The row a reader should look at first: biggest money, else biggest move. */
function dominant(rows) {
  if (rows.length === 0) return null;
  const withValue = rows.filter((r) => typeof r.valueInr === 'number');
  const pool = withValue.length > 0 ? withValue : rows;
  return [...pool].sort((a, b) => {
    if (withValue.length > 0) return b.valueInr - a.valueInr;
    return Math.abs(b.move3m ?? 0) - Math.abs(a.move3m ?? 0);
  })[0];
}

const moveWords = (m) => {
  if (m === null) return 'not published this month';
  if (Math.abs(m) < 0.005) return 'flat';
  return `${m > 0 ? 'up' : 'down'} ${pct(Math.abs(m))}`;
};

// ---------------------------------------------------------------- 1. headline

export function headlineBlock(signals) {
  const { profile, month, status } = signals;
  const title = `${profile.name.toUpperCase()}${profile.industry ? ` (${profile.industry})` : ''} ${DASH} Macro Signal Report, ${monthLong(month)} ${DASH} STATUS: ${status}`;
  return { key: 'headline', heading: null, title, sentences: [summarySentence(signals)] };
}

function summarySentence(signals) {
  const { squeeze, stock } = signals.rules;
  const costFlags = signals.rows.filter((r) => r.role === 'COST' && flagged(r));

  if (squeeze && squeeze.severity !== STATUS.GREEN) {
    return 'What this borrower buys is rising faster than what it sells.';
  }
  if (stock && stock.verdict === 'losing_on_stock') {
    return 'The price of the goods this borrower holds in stock is falling.';
  }
  if (stock && stock.verdict === 'paper_gains') {
    return 'The goods this borrower holds are worth more than they cost, which is a gain only until the reason for it lapses.';
  }
  if (costFlags.length > 0) {
    return `Prices on what this borrower buys and sells are steady; the pressure this month is in ${joinProse(costFlags.map((r) => r.displayName.toLowerCase()))}.`;
  }
  if (squeeze && squeeze.severity === STATUS.GREEN) {
    return 'Realisations are keeping pace with input costs; no price-driven margin pressure this month.';
  }
  return 'No material price pressure on this borrower this month.';
}

// ------------------------------------------------------------------ 2. margin

export function marginBlock(signals) {
  const squeeze = signals.rules.squeeze;
  if (!squeeze) return null;

  const { profile } = signals;
  const spreadName = profile.spreadName ?? 'gross spread';
  const unitName = profile.unitName ?? 'unit';
  const subject = subjectNoun(profile.industry);
  const sentences = [];

  const leadBuy = dominant(squeeze.buyRows);
  const buyClause =
    squeeze.buyRows.length === 1
      ? `${capitalise(leadBuy.displayName)}${leadBuy.share ? ` (${(leadBuy.share * 100).toFixed(0)}% of raw-material cost)` : ''} is ${moveWords(leadBuy.move3m)} over 3 months`
      : `What it buys (${joinProse(squeeze.buyRows.map((r) => r.displayName.toLowerCase()))}) is ${moveWords(squeeze.buyAvg)} over 3 months on average`;

  const sellNames = joinProse(squeeze.sellRows.map((r) => r.displayName.toLowerCase()));
  const sellClause =
    squeeze.sellRows.length === 1
      ? `its product ${DASH} ${sellNames} ${DASH} is ${moveWords(squeeze.sellAvg)}`
      : `its products ${DASH} ${sellNames} ${DASH} are ${moveWords(squeeze.sellAvg)} together`;

  sentences.push(`${buyClause}; ${sellClause}.`);

  if (squeeze.verdict === 'healthy') {
    sentences.push(
      `The ${spreadName} is holding, ${pp(squeeze.gap)} on the quarter: realisations are keeping up with input costs.`,
    );
  } else {
    const strength = squeeze.verdict === 'earning_less' ? 'clearly' : 'slightly';
    sentences.push(
      `Inputs are running ${strength} ahead of outputs, so the ${spreadName} has compressed by ${pp(Math.abs(squeeze.gap)).replace('+', '~')} this quarter: ${subject} is earning less per ${unitName} than its financials suggest.`,
    );
  }

  return { key: 'margin', heading: 'Margin', sentences };
}

// --------------------------------------------------------------- 3. inventory

export function inventoryBlock(signals) {
  const stock = signals.rules.stock;
  if (!stock) return null;

  const lead = dominant(stock.stockRows);
  const sentences = [];

  const quietTail =
    stock.verdict === 'quiet'
      ? ` ${DASH} no gain or loss pressure on stock.`
      : stock.verdict === 'losing_on_stock'
        ? ` ${DASH} falling prices mean losses are sitting on the stock.`
        : ` ${DASH} rising prices are paper gains on the stock.`;

  sentences.push(
    `${capitalise(lead.displayName)} is ${stock.verdict === 'quiet' && Math.abs(lead.move3m) <= 0.1 ? 'quiet' : moveWords(lead.move3m)} (${pct(lead.move3m)} in 3 months)${quietTail}`,
  );

  const others = stock.stockRows.filter((r) => r.itemId !== lead.itemId);
  if (others.length > 0) {
    sentences.push(
      `${joinProse(others.map((r) => `${r.displayName} ${pct(r.move3m)}`))}; the traded book averages ${pct(stock.stockAvg)} over the quarter.`,
    );
  }

  if (stock.verdict === 'paper_gains') {
    sentences.push(
      'Ask why the price rose before treating it as profit: if a duty or an export restriction is holding it up, a lapse reverses this overnight.',
    );
  }

  return { key: 'inventory', heading: 'Inventory', sentences };
}

// ------------------------------------------------------------ 4. cost pressure

export function costBlock(signals) {
  const costRows = signals.rows.filter((r) => r.role === 'COST');
  if (costRows.length === 0) return null;

  const { profile } = signals;
  const sentences = [];

  const packaging = costRows.filter((r) => isPackaging(r) && flagged(r));
  if (packaging.length > 0) {
    sentences.push(
      `Packing is turning expensive ${DASH} ${joinProse(
        packaging.map((r) => `${r.label}${nameSuffix(r)} ${pct(r.move3m)} in 3 months (${r.flag})`),
      )}.`,
    );
  }

  for (const row of costRows.filter((r) => isEnergy(r) && flagged(r))) {
    sentences.push(`${capitalise(row.displayName)} ${pct(row.move3m)} in 3 months (${pct(row.move12m)} in 12)${sizingClause(row, profile)}`);
  }

  const others = costRows.filter((r) => flagged(r) && !isPackaging(r) && !isEnergy(r));
  if (others.length > 0) {
    sentences.push(`Also moving: ${joinProse(others.map((r) => `${r.displayName} ${pct(r.move3m)} (${r.flag})`))}.`);
  }

  if (sentences.length === 0) {
    sentences.push(
      `Overheads are quiet ${DASH} ${joinProse(costRows.map((r) => `${r.displayName} ${pct(r.move3m)}`))}, all inside the 10% flag band.`,
    );
  }

  return { key: 'cost', heading: 'Cost pressure', sentences };
}

/**
 * PRD §7.1: cost moves "sized against the borrower's margin where values are
 * known". Where they are not known the sentence stops at the percentage rather
 * than inventing a denominator.
 */
function sizingClause(row, profile) {
  if (typeof row.valueInr !== 'number' || row.move3m === null) {
    return ': a freight- and power-heavy cost base will feel this.';
  }
  const extraCost = row.valueInr * row.move3m;
  const parts = [];
  if (typeof profile.grossMarginPct === 'number') parts.push(`a ${profile.grossMarginPct}% gross margin`);
  parts.push(`${inr(row.valueInr)} of ${row.label.toLowerCase()}`);

  let clause = ` against ${joinProse(parts)} ${DASH} about ${inr(extraCost)} of extra cost if rates follow`;
  if (typeof profile.grossProfitInr === 'number' && profile.grossProfitInr > 0) {
    clause += `, roughly ${((extraCost / profile.grossProfitInr) * 100).toFixed(0)}% of gross profit`;
  }
  return `${clause}.`;
}

// ----------------------------------------------------------- 5. early warnings

export function warningsBlock(signals) {
  const sentences = [];

  for (const d of signals.rules.drivers) {
    const itemQuiet = Math.abs(d.itemMove) <= 0.05;
    sentences.push(
      itemQuiet
        ? `${capitalise(d.label)} looks quiet (${pct(d.itemMove)}) but ${d.driverName}, what it is made of, is ${pct(d.driverMove)} ${DASH} expect this cost to rise within 1-2 months.`
        : `${capitalise(d.label)} is ${pct(d.itemMove)} while its driver ${d.driverName} is already ${pct(d.driverMove)}; the ${pp(d.gap)} gap usually closes, so expect more within 1-2 months.`,
    );
  }

  const watchRows = signals.rows.filter((r) => r.role === 'WATCH');
  const upstream = watchRows.filter((r) => r.watchKind !== 'ceiling');
  const ceilings = watchRows.filter((r) => r.watchKind === 'ceiling');

  const movingUpstream = upstream.filter((r) => flagged(r));
  const quietUpstream = upstream.filter((r) => !flagged(r));

  for (const row of movingUpstream) {
    sentences.push(
      `${capitalise(row.displayName)} is ${pct(row.move3m)} over 3 months (${row.flag}) ${DASH} an upstream input that typically reaches finished prices within 1-2 months.`,
    );
  }
  if (quietUpstream.length > 0 && movingUpstream.length === 0) {
    sentences.push(`${capitalise(joinProse(quietUpstream.map((r) => `${r.displayName} is ${moveWords(r.move3m)}`)))}; no upstream push.`);
  } else if (quietUpstream.length > 0) {
    sentences.push(`${capitalise(joinProse(quietUpstream.map((r) => `${r.displayName} is ${moveWords(r.move3m)}`)))}.`);
  }

  for (const row of ceilings) {
    sentences.push(
      row.move3m !== null && row.move3m > 0
        ? `${capitalise(row.displayName)} is ${pct(row.move3m)}; as the substitute that caps this borrower's realisations, a rising ceiling gives room on price.`
        : `${capitalise(row.displayName)} is ${moveWords(row.move3m)}; as the substitute that caps this borrower's realisations, a falling ceiling limits how much cost can be passed on.`,
    );
  }

  if (sentences.length === 0) sentences.push('Nothing upstream is moving enough to flag this month.');

  return { key: 'warnings', heading: 'Early warning', sentences };
}

// ------------------------------------------------------------- 6. policy checks

export function policyBlock(signals, policyChecks) {
  if (policyChecks.length === 0) return null;
  return {
    key: 'policy',
    heading: 'Before acting, check',
    checks: policyChecks,
    sentences: [policyChecks.map((c) => c.text).join(' \u00b7 ')],
  };
}

// ----------------------------------------------------------------- 7. questions

/** PRD §7.1: auto-generated from the rules that actually triggered. */
export function questionsBlock(signals) {
  const { squeeze, stock } = signals.rules;
  const questions = [];

  if (squeeze && squeeze.severity !== STATUS.GREEN) {
    const buy = dominant(squeeze.buyRows);
    questions.push(`current ${buy.displayName.toLowerCase()} stock and average purchase price`);
    questions.push(`are ${dominant(squeeze.sellRows).displayName.toLowerCase()} sales contracted or spot`);
  }

  if (stock && stock.verdict === 'losing_on_stock') {
    questions.push('stock quantity, average purchase price, and how the stock is funded');
  } else if (stock && stock.verdict === 'paper_gains') {
    questions.push('what is holding the price up, and whether a duty or export restriction is involved');
  }

  const costRows = signals.rows.filter((r) => r.role === 'COST' && flagged(r));
  if (costRows.some((r) => isPackaging(r))) questions.push('can packaging cost be passed through');
  if (costRows.some((r) => isEnergy(r))) questions.push('current freight contracts — fixed or per-trip');

  for (const d of signals.rules.drivers) {
    questions.push(`is ${d.label.toLowerCase()} bought on contract or at spot`);
  }

  if (questions.length === 0) questions.push('any change in supplier or customer terms since the last financials');

  return { key: 'questions', heading: 'Ask the borrower', sentences: [`${dedupe(questions).join('; ')}?`] };
}

function nameSuffix(row) {
  const label = row.label.toLowerCase();
  const display = row.displayName.toLowerCase();
  return display && display !== label ? ` (${display})` : '';
}

function capitalise(s) {
  const str = String(s ?? '');
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function dedupe(list) {
  return [...new Set(list)];
}
