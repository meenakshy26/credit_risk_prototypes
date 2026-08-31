# WPI Macro Signal Engine

Phase 1 (per the PRD): ingest the government's monthly Wholesale Price Index
(WPI) file, run the signal rules against a set of borrower profiles, and
produce fixed-format written reports — no numbers ever originate from an LLM.

This repo is **code-only**. No real WPI files, borrower data, or generated
output are committed (see `.gitignore`) — everything you need to try it out
is pulled live or generated on your machine.

## Requirements

- Node.js >= 22.5.0 (uses `node:sqlite` and the built-in test runner)

## Setup

```bash
npm install
```

## Running end-to-end

The `monthly` command does the full cycle hands-free: download the latest
published WPI file, ingest it, seed reference data (synonyms, drivers, policy
checks, the 3 pilot profiles), and run the signal rules — writing a Markdown
report and a signal JSON file per profile under `out/`.

```bash
npm run monthly
```

Or step through it manually:

```bash
npm run download          # fetches the latest wpi_monthly_index_YYYYMM.xlsx into data/raw/
npm run ingest -- data/raw/wpi_monthly_index_YYYYMM.xlsx
npm run seed
npm run run-signals       # writes reports to out/reports/<month>/ and signals to out/signals/<month>/
```

Check what's currently stored at any point:

```bash
node src/cli/index.js status
```

### Trying out scenarios

- **A different month**: run `npm run download` again next publication cycle
  (or point `ingest` at any WPI xlsx you have locally) — `run-signals` always
  compares the latest ingested month against 3 months prior, per the PRD.
- **FX pressure rule**: pass a 3-month rupee weakening figure to upgrade
  import-exposed flags, e.g. `node src/cli/index.js run --fx 6.2 --fx-source "RBI reference rate"`.
- **Custom DB/output locations**: `--db <path>` and `--out <dir>` on any
  command (see `node src/cli/index.js --help` for the full option list).
- **Lenient seeding**: `--lenient` on `seed`/`monthly` won't fail if the WPI
  file is missing a code one of the seeded profiles references.

Reports land at `out/reports/<month>/<profile-slug>.md`; the JSON backing
every number in them (for traceability) lands alongside it in
`out/signals/<month>/`.

## Testing

```bash
npm test
```

Most of the suite runs against synthetic fixtures. The acceptance suite
(`tests/acceptance.test.js`) additionally validates the engine's real output
against the PRD's §8 acceptance table and §7.2 sample reports — but only if
the actual June-2026 WPI file is present locally. It's intentionally not
committed, so on a fresh checkout those tests report as **skipped** rather
than failing. To enable them, either run `npm run download` when that month's
file is still live, or place the original `wpi_monthly_index_202607.xlsx` at
the repo root.

## Layout

```
src/
  cli/         CLI entry point (download, ingest, seed, run, monthly, status)
  ingest/      xlsx parsing, validation, and the live WPI downloader
  seed/        synonyms, drivers, policy checks, and the pilot profiles
  signals/     move calculations and the rule engine (§6)
  report/      fixed-order report composition (§7)
  store/       SQLite persistence
  pipeline/    the monthly orchestration (§2 steps 3-5)
tests/         node:test suite (unit + acceptance)
```

Phase 1 scope per the PRD: ingest, signal service, report composer, store,
and 3 pilot profiles. Intake mapping (§5 Stage 1), role-assignment automation
(§3.1), notifications, and calibration are later phases.
