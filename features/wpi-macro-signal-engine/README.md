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

## Onboarding a borrower from raw schedules (§3 intake)

The monthly cycle above runs against profiles that are already coded (name +
WPI code + role). §3 covers the other path: a caller hands over a borrower's
raw, free-text schedules — exactly as they appear in the financials, no
pre-mapping — and gets back a profile, WPI codes, and a report, synchronously.

This only works once the store has at least one ingest (`npm run monthly` or
`npm run ingest` first) and the seed data (`npm run seed`) loaded, since
mapping and signals both read from what's already stored.

**Payload shape:**

```json
{
  "entity_name": "Sample Traders Pvt Ltd",
  "period": "2026-07",
  "schedules": [
    { "type": "trading_purchases", "items": [{ "name_verbatim": "Chawal", "value_inr": 12000000 }] },
    { "type": "trading_sales", "items": [{ "name_verbatim": "Chawal", "value_inr": 12600000 }] },
    { "type": "raw_material", "items": [
      { "name_verbatim": "Sarson", "value_inr": 5000000 },
      { "name_verbatim": "HDPE Bags", "value_inr": 400000 }
    ] },
    { "type": "expenses", "items": [{ "name_verbatim": "Freight Outward", "value_inr": 250000 }] }
  ]
}
```

`schedules[].type` is one of `raw_material`, `finished_goods`,
`trading_purchases`, `trading_sales`, `expenses`. What happens to each line,
in order (§3.1): a name that is ≥70% of value on both sides of a trading
account becomes a single **STOCK** row; the rest of `raw_material` becomes
**BUY** (packaging/consumable names, or anything under 10% of the raw-material
total, are reclassified to **COST**); `finished_goods` becomes **SELL**;
`expenses` becomes **COST** only for freight/diesel/power/fuel/electricity/
packing lines — everything else in an expense schedule is dropped as not
price-relevant. Every BUY/STOCK row then gets its upstream input auto-added as
a standalone **WATCH** row from the driver table (never taken from the
statement itself).

Each name is then mapped to a WPI code in two stages (§5): Stage 1 resolves
the free-text term to a commodity name via a synonym table (no LLM is wired
up yet — an unresolved term passes through as-is at Low confidence rather
than blocking the response); Stage 2 scores that name against the ~800 WPI
items and commits either an exact item code (High), a PROXY parent
constrained to the borrower's own commodity mix (Medium), or an
industry-level PROXY (Low). **Low-confidence mappings are still published**
— the signal is never withheld — but are also queued in `review_queue` for a
human to confirm once.

**CLI:**

```bash
node src/cli/index.js intake borrower.json
```

Prints the profile id, any items queued for review, and the same Markdown
report the monthly cycle writes to `out/`.

**HTTP (for a caller like OneRisk):**

```bash
npm run serve                     # starts on :3000 against data/wpi.db (override with PORT / WPI_DB_PATH)
curl -X POST localhost:3000/profiles/intake \
  -H 'content-type: application/json' \
  -d @borrower.json
```

`POST /profiles/intake` returns:

- `200` — `{ profileId, status, month, summary, reviewEntries }`, where
  `summary` is the same Markdown text as the CLI/monthly reports (that's the
  "summary text" OneRisk gets back).
- `400` — malformed request (missing `entity_name` or `schedules`).
- `422` — well-formed but semantically invalid (unknown schedule type, an
  item with no `name_verbatim`).
- `503` — the store has no WPI data ingested yet.

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
  cli/         CLI entry point (download, ingest, seed, run, monthly, intake, status)
  server.js    thin Express wrapper exposing POST /profiles/intake
  ingest/      xlsx parsing, validation, and the live WPI downloader
  mapping/     §3 intake: role assignment (§3.1), Stage 1 term resolution and
               Stage 2 WPI code lookup (§5), and the intake orchestrator
  seed/        synonyms, drivers, policy checks, and the pilot profiles
  signals/     move calculations and the rule engine (§6)
  report/      fixed-order report composition (§7)
  store/       SQLite persistence
  pipeline/    the monthly orchestration (§2 steps 3-5)
tests/         node:test suite (unit + acceptance)
```

Phase 1 scope per the PRD: ingest, signal service, report composer, store,
3 pilot profiles, and the §3/§5 raw-borrower intake pipeline (role
assignment, two-stage WPI mapping, review queue). Stage 1's LLM fallback for
unresolved terms is deliberately not wired up — unresolved terms are queued
for human review instead, so the engine has no external dependency.
Notifications and calibration are later phases.
