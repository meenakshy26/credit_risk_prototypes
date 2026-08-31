import { ALL_COMMODITIES, LEVEL } from '../core/constants.js';
import { monthDiff } from '../core/months.js';

export const VALIDATION_LIMITS = Object.freeze({
  minRows: 900,
  minItems: 600,
  minMappedCodePresence: 0.95,
});

export class ValidationError extends Error {
  constructor(failures) {
    super(`WPI ingest validation failed: ${failures.map((f) => f.message).join(' | ')}`);
    this.name = 'ValidationError';
    this.failures = failures;
  }
}

/**
 * PRD §4 rule 7: validate before signalling, and on failure abort and alert.
 * Returns { failures, warnings }; the caller aborts if failures is non-empty.
 * `mappedCodes` are the codes live borrower profiles depend on — if the source
 * file stops carrying them, the signal run would silently produce blanks.
 */
export function validateParsed(parsed, { previousLatestMonth = null, mappedCodes = [] } = {}) {
  const failures = [];
  const warnings = [];

  if (parsed.commodities.length < VALIDATION_LIMITS.minRows) {
    failures.push({
      check: 'row_count',
      message: `only ${parsed.commodities.length} commodity rows parsed, expected at least ${VALIDATION_LIMITS.minRows}`,
    });
  }

  const items = parsed.commodities.filter((c) => c.level === LEVEL.ITEM).length;
  if (items < VALIDATION_LIMITS.minItems) {
    failures.push({
      check: 'item_count',
      message: `only ${items} leaf Item rows parsed, expected at least ${VALIDATION_LIMITS.minItems}`,
    });
  }

  if (!parsed.commodities.some((c) => c.code === ALL_COMMODITIES)) {
    failures.push({ check: 'all_commodities', message: `All Commodities row (${ALL_COMMODITIES}) is absent` });
  }

  if (previousLatestMonth) {
    const advance = monthDiff(previousLatestMonth, parsed.latestMonth);
    if (advance === 0) {
      failures.push({
        check: 'month_advance',
        message: `latest month is still ${parsed.latestMonth} — the publisher has not released a new month yet`,
      });
    } else if (advance < 0) {
      failures.push({
        check: 'month_advance',
        message: `latest month went backwards: stored ${previousLatestMonth}, file has ${parsed.latestMonth}`,
      });
    } else if (advance > 1) {
      failures.push({
        check: 'month_advance',
        message: `latest month jumped ${advance} months (${previousLatestMonth} to ${parsed.latestMonth}) — a month is missing`,
      });
    }
  }

  if (mappedCodes.length > 0) {
    const present = new Set(parsed.commodities.map((c) => c.code));
    const missing = mappedCodes.filter((c) => !present.has(c));
    const presence = 1 - missing.length / mappedCodes.length;
    if (presence < VALIDATION_LIMITS.minMappedCodePresence) {
      failures.push({
        check: 'mapped_code_presence',
        message:
          `only ${(presence * 100).toFixed(1)}% of ${mappedCodes.length} mapped codes are present ` +
          `(missing ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? `, +${missing.length - 5} more` : ''}) — ` +
          'a base-year rebase would look like this',
      });
    } else if (missing.length > 0) {
      warnings.push({
        check: 'mapped_code_presence',
        message: `${missing.length} mapped code(s) absent from this file: ${missing.join(', ')}`,
      });
    }
  }

  if (parsed.skipped.length > 0) {
    warnings.push({
      check: 'uncoded_rows',
      message: `ignored ${parsed.skipped.length} row(s) with no commodity code: ${parsed.skipped.join(', ')}`,
    });
  }

  const allCommoditiesLatest = parsed.values.find(
    (v) => v.code === ALL_COMMODITIES && v.month === parsed.latestMonth,
  );
  if (allCommoditiesLatest && (allCommoditiesLatest.value < 50 || allCommoditiesLatest.value > 400)) {
    warnings.push({
      check: 'all_commodities_sanity',
      message: `All Commodities index reads ${allCommoditiesLatest.value} for ${parsed.latestMonth}, which is outside the plausible range for base 2022-23`,
    });
  }

  return { failures, warnings };
}
