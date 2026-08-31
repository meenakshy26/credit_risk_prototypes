export const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS commodities (
  code        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  level       TEXT NOT NULL,
  weight      REAL,
  parent_code TEXT
);
CREATE INDEX IF NOT EXISTS idx_commodities_level  ON commodities(level);
CREATE INDEX IF NOT EXISTS idx_commodities_parent ON commodities(parent_code);

CREATE TABLE IF NOT EXISTS index_values (
  code     TEXT NOT NULL,
  month    TEXT NOT NULL,
  value    REAL,
  is_final INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (code, month)
);
CREATE INDEX IF NOT EXISTS idx_index_values_month ON index_values(month);

CREATE TABLE IF NOT EXISTS revisions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT NOT NULL,
  month         TEXT NOT NULL,
  old_value     REAL,
  new_value     REAL,
  ingest_run_id INTEGER,
  observed_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ingest_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  source_file  TEXT NOT NULL,
  latest_month TEXT,
  row_count    INTEGER,
  status       TEXT NOT NULL,
  message      TEXT,
  ran_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS profiles (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT NOT NULL UNIQUE,
  industry         TEXT,
  gross_margin_pct REAL,
  gross_profit_inr REAL,
  import_exposed   INTEGER NOT NULL DEFAULT 0,
  -- Report vocabulary. A mill has a "crushing margin" earned "per quintal"; a
  -- trader has a "gross spread" earned "per unit". Template variables, not
  -- logic -- §7 requires prose an officer recognises, and the wrong industry
  -- noun is how a report stops being read.
  spread_name      TEXT,
  unit_name        TEXT,
  created_at       TEXT NOT NULL
);

-- label is the borrower's own wording, kept verbatim per §3 so the report is
-- recognisable against their books; display_name is the Stage 1 resolved
-- commodity name, which is what reads naturally in prose (§7.2 prints
-- "Bardana (hessian)" -- both fields, in that order).
CREATE TABLE IF NOT EXISTS profile_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id   INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  label        TEXT NOT NULL,
  display_name TEXT,
  role         TEXT NOT NULL CHECK (role IN ('BUY','SELL','STOCK','COST','WATCH')),
  is_proxy     INTEGER NOT NULL DEFAULT 0,
  driver_code  TEXT,
  driver_name  TEXT,
  -- 'upstream' (a rising input pushes this borrower's cost up) or 'ceiling'
  -- (a substitute that caps what the borrower can charge). Opposite meanings,
  -- so the early-warning sentence must know which it is holding.
  watch_kind   TEXT,
  value_inr    REAL,
  share        REAL,
  confidence   TEXT,
  note         TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_profile_items_profile ON profile_items(profile_id);

CREATE TABLE IF NOT EXISTS profile_item_codes (
  profile_item_id INTEGER NOT NULL REFERENCES profile_items(id) ON DELETE CASCADE,
  code            TEXT NOT NULL,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (profile_item_id, code)
);

CREATE TABLE IF NOT EXISTS synonyms (
  term           TEXT PRIMARY KEY,
  commodity_name TEXT NOT NULL,
  confidence     TEXT NOT NULL DEFAULT 'high',
  source         TEXT NOT NULL DEFAULT 'seed',
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS drivers (
  commodity_key TEXT PRIMARY KEY,
  driver_code   TEXT NOT NULL,
  kind          TEXT NOT NULL,
  note          TEXT
);

CREATE TABLE IF NOT EXISTS policy_checks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  commodity_key TEXT NOT NULL,
  text          TEXT NOT NULL,
  url           TEXT NOT NULL,
  sort_order    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_policy_checks_key ON policy_checks(commodity_key);

CREATE TABLE IF NOT EXISTS signal_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  month        TEXT NOT NULL,
  ran_at       TEXT NOT NULL,
  profile_count INTEGER
);

CREATE TABLE IF NOT EXISTS signals (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id          INTEGER NOT NULL REFERENCES signal_runs(id) ON DELETE CASCADE,
  profile_id      INTEGER,
  profile_item_id INTEGER,
  month           TEXT NOT NULL,
  kind            TEXT NOT NULL,
  rule            TEXT,
  code            TEXT,
  move_3m         REAL,
  move_12m        REAL,
  flag            TEXT,
  severity        TEXT,
  detail          TEXT
);
CREATE INDEX IF NOT EXISTS idx_signals_profile ON signals(profile_id, month);

CREATE TABLE IF NOT EXISTS reports (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id     INTEGER NOT NULL REFERENCES signal_runs(id) ON DELETE CASCADE,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  month      TEXT NOT NULL,
  status     TEXT NOT NULL,
  markdown   TEXT NOT NULL,
  payload    TEXT NOT NULL,
  UNIQUE (profile_id, month)
);

CREATE TABLE IF NOT EXISTS review_queue (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id      INTEGER,
  profile_item_id INTEGER,
  reason          TEXT NOT NULL,
  term            TEXT,
  resolved_name   TEXT,
  committed_code  TEXT,
  confidence      TEXT,
  status          TEXT NOT NULL DEFAULT 'open',
  created_at      TEXT NOT NULL
);
`;
