#!/usr/bin/env node
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { openStore } from '../store/index.js';
import { ValidationError, ingestFile } from '../ingest/index.js';
import { downloadLatestFile } from '../ingest/download.js';
import { seedAll } from '../seed/index.js';
import { runMonth, writeMonthOutputs } from '../pipeline/monthly.js';
import { intakeProfile } from '../mapping/intake.js';

const DEFAULTS = { db: 'data/wpi.db', source: '.', out: 'out', rawDir: 'data/raw' };

const USAGE = `wpi-engine — WPI Macro Signal Engine (Phase 1)

  download [dir]  Fetch the latest published WPI xlsx from eaindustry.nic.in (§4 rule 1)
  ingest [path]   Parse a WPI item-wise xlsx (file or directory) into the store
  seed            Load synonyms, drivers, policy checks and the pilot profiles
  run             Run the signal rules and write reports for the latest month
  monthly [path]  download (if no path given), then ingest, seed, run — hands-free
  intake <path>   Onboard a borrower from a raw §3 JSON payload and print its report
  status          Show what is currently stored

Options
  --db <path>     SQLite file (default ${DEFAULTS.db})
  --out <dir>     Output directory for reports and signal JSON (default ${DEFAULTS.out})
  --fx <pct>      3-month rupee weakening, e.g. --fx 6.2 (WPI carries no FX)
  --fx-source <s> Where that FX figure came from
  --no-write      Run without writing report files to disk
  --lenient       Do not fail seeding on codes absent from the WPI file
`;

function parseArgs(argv) {
  const opts = { ...DEFAULTS, write: true, strict: true, fx: null, fxSource: null };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--db':
        opts.db = argv[++i];
        break;
      case '--out':
        opts.out = argv[++i];
        break;
      case '--fx':
        opts.fx = Number(argv[++i]) / 100;
        break;
      case '--fx-source':
        opts.fxSource = argv[++i];
        break;
      case '--no-write':
        opts.write = false;
        break;
      case '--lenient':
        opts.strict = false;
        break;
      case '-h':
      case '--help':
        opts.help = true;
        break;
      default:
        if (arg.startsWith('-')) throw new Error(`Unknown option ${arg}`);
        positional.push(arg);
    }
  }
  if (opts.fx !== null && !Number.isFinite(opts.fx)) throw new Error('--fx expects a number, e.g. --fx 6.2');
  return { opts, positional };
}

async function doDownload(dir) {
  const result = await downloadLatestFile({ destDir: dir });
  console.log(`download ${result.url}`);
  console.log(`         saved to ${result.path} (${result.bytes} bytes, publication month ${result.publicationMonth})`);
  return result;
}

function doIngest(store, path) {
  const result = ingestFile(store, path);
  console.log(`ingest  ${result.sourceFile}`);
  console.log(`        sheet "${result.sheetName}", ${result.commodityCount} commodities, ${result.months.length} months`);
  console.log(`        ${result.months[0]} to ${result.latestMonth}, ${result.valuesWritten} values written`);
  if (result.revisions.length > 0) console.log(`        ${result.revisions.length} provisional values revised since the last run`);
  return result;
}

function doSeed(store, strict) {
  const result = seedAll(store, { strict });
  console.log(
    `seed    ${result.synonyms} synonyms, ${result.drivers} drivers, ${result.policyChecks} policy checks, ${result.profileCount} profiles`,
  );
  return result;
}

function doRun(store, opts) {
  const fx = opts.fx === null ? null : { weakeningMove3m: opts.fx, source: opts.fxSource };
  const run = runMonth(store, { fx });
  console.log(`run     ${run.month} (vs ${run.comparisonMonth}), ${run.results.length} profiles`);
  for (const { signals } of run.results) {
    console.log(`        ${signals.status.padEnd(5)} ${signals.profile.name}`);
  }

  if (opts.write) {
    const { written, moversPath } = writeMonthOutputs(run, resolve(opts.out));
    for (const w of written) console.log(`        wrote ${w.markdown}`);
    console.log(`        wrote ${moversPath}`);
  }
  return run;
}

/**
 * §3 receipt pipeline from the command line: raw schedules in, a printed
 * report out — the same synchronous path a service endpoint would expose to
 * OneRisk, minus the HTTP wrapper. No LLM is wired up (§5.1), so unresolved
 * terms land in the review queue rather than blocking the report.
 */
function doIntake(store, path, opts) {
  if (!path) throw new Error('intake needs a path to a JSON payload, e.g. wpi-engine intake borrower.json');
  const payload = JSON.parse(readFileSync(resolve(path), 'utf8'));
  const fx = opts.fx === null ? null : { weakeningMove3m: opts.fx, source: opts.fxSource };
  const result = intakeProfile(store, payload, { fx });

  console.log(`intake  ${payload.entity_name} -> profile #${result.profileId}, status ${result.signals.status}`);
  if (result.reviewEntries.length > 0) {
    console.log(`        ${result.reviewEntries.length} item(s) queued for review:`);
    for (const r of result.reviewEntries) console.log(`        - ${r.label}: ${r.reason}`);
  }
  console.log('');
  console.log(result.report.markdown);
  return result;
}

function doStatus(store) {
  const ingest = store.lastSuccessfulIngest();
  const months = store.distinctMonths();
  console.log(`db      ${store.countCommodities()} commodities, ${months.length} months stored`);
  if (ingest) console.log(`ingest  ${ingest.sourceFile} at ${ingest.ranAt}, latest month ${ingest.latestMonth}`);
  else console.log('ingest  none yet');
  console.log(`seed    ${store.countSynonyms()} synonyms, ${store.profiles().length} profiles`);
  for (const p of store.profiles()) {
    const report = ingest ? store.report(p.id, ingest.latestMonth) : null;
    console.log(`        ${p.name}${report ? ` — ${report.status} in ${ingest.latestMonth}` : ' — no report yet'}`);
  }
  const reviews = store.openReviews();
  if (reviews.length > 0) console.log(`review  ${reviews.length} open item(s)`);
}

export async function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  const { opts, positional } = parseArgs(rest);

  if (!command || opts.help || command === 'help') {
    console.log(USAGE);
    return 0;
  }

  if (command === 'download') {
    await doDownload(positional[0] ?? opts.rawDir);
    return 0;
  }

  const store = openStore(resolve(opts.db));
  try {
    switch (command) {
      case 'ingest':
        doIngest(store, positional[0] ?? opts.source);
        return 0;
      case 'seed':
        doSeed(store, opts.strict);
        return 0;
      case 'run':
        doRun(store, opts);
        return 0;
      case 'monthly': {
        // §4 rule 1: no path given -> pull the latest published file ourselves,
        // so the monthly cycle needs no human to go and fetch it by hand.
        const path = positional[0] ?? (await doDownload(opts.rawDir)).path;
        doIngest(store, path);
        doSeed(store, opts.strict);
        doRun(store, opts);
        return 0;
      }
      case 'intake':
        doIntake(store, positional[0], opts);
        return 0;
      case 'status':
        doStatus(store);
        return 0;
      default:
        console.error(`Unknown command "${command}"\n\n${USAGE}`);
        return 2;
    }
  } finally {
    store.close();
  }
}

// pathToFileURL, not string concatenation: this project's own directory name
// contains a space, which import.meta.url percent-encodes and argv[1] does not.
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  try {
    process.exitCode = await main();
  } catch (err) {
    if (err instanceof ValidationError) {
      console.error(`\nIngest refused this file (§4 rule 7):`);
      for (const f of err.failures) console.error(`  - [${f.check}] ${f.message}`);
    } else {
      console.error(`\n${err.message}`);
    }
    process.exitCode = 1;
  }
}
