import { readdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { parseWorkbookFile } from './parse.js';
import { ValidationError, validateParsed } from './validate.js';
import { monthDiff } from '../core/months.js';

/**
 * PRD §4: values are provisional for ~8 weeks, then final. Two elapsed months
 * is the deterministic stand-in — once a month is that far behind the latest
 * released month, its value stops being overwritten and revisions stop.
 */
export const FINALISE_AFTER_MONTHS = 2;

const WPI_FILE_RE = /\.xlsx?$/i;

/** Accepts a file or a directory; a directory yields its newest .xlsx. */
export function resolveSourceFile(path) {
  const target = resolve(path);
  if (!statSync(target).isDirectory()) return target;
  const candidates = readdirSync(target)
    .filter((f) => WPI_FILE_RE.test(f) && !f.startsWith('~$'))
    .map((f) => join(target, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (candidates.length === 0) throw new Error(`No .xlsx file found in ${target}`);
  return candidates[0];
}

export function ingestFile(store, path, { logger = console } = {}) {
  const sourceFile = resolveSourceFile(path);
  const runId = store.startIngestRun(basename(sourceFile));

  try {
    const parsed = parseWorkbookFile(sourceFile);
    const previous = store.lastSuccessfulIngest();
    const mappedCodes = collectMappedCodes(store);

    const { failures, warnings } = validateParsed(parsed, {
      previousLatestMonth: previous?.latestMonth ?? null,
      mappedCodes,
    });

    for (const w of warnings) logger.warn?.(`  warning [${w.check}] ${w.message}`);

    if (failures.length > 0) {
      const error = new ValidationError(failures);
      store.finishIngestRun(runId, { status: 'failed', latestMonth: parsed.latestMonth, message: error.message });
      throw error;
    }

    const result = store.transaction(() => {
      store.upsertCommodities(parsed.commodities);
      const entries = parsed.values.map((v) => ({
        ...v,
        isFinal: monthDiff(v.month, parsed.latestMonth) >= FINALISE_AFTER_MONTHS,
      }));
      const { written, revisions } = store.upsertIndexValues(entries);
      store.logRevisions(revisions, runId);
      return { written, revisions };
    });

    store.finishIngestRun(runId, {
      status: 'ok',
      latestMonth: parsed.latestMonth,
      rowCount: parsed.commodities.length,
      message: `${result.written} values written, ${result.revisions.length} revisions`,
    });

    return {
      runId,
      sourceFile,
      sheetName: parsed.sheetName,
      latestMonth: parsed.latestMonth,
      months: parsed.months,
      commodityCount: parsed.commodities.length,
      valuesWritten: result.written,
      revisions: result.revisions,
      warnings,
    };
  } catch (err) {
    if (!(err instanceof ValidationError)) {
      store.finishIngestRun(runId, { status: 'error', message: err.message });
    }
    throw err;
  }
}

function collectMappedCodes(store) {
  const codes = new Set();
  for (const p of store.profiles()) {
    for (const item of store.profileItems(p.id)) {
      for (const code of item.codes) codes.add(code);
      if (item.driverCode) codes.add(item.driverCode);
    }
  }
  return [...codes];
}

export { ValidationError } from './validate.js';
export { parseWorkbookFile, parseWorkbook } from './parse.js';
