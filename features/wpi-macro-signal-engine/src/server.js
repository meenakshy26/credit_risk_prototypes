#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import express from 'express';
import { openStore } from './store/index.js';
import { intakeProfile } from './mapping/intake.js';

const VALID_SCHEDULE_TYPES = new Set(['raw_material', 'finished_goods', 'trading_purchases', 'trading_sales', 'expenses']);

/**
 * §3 receipt pipeline, exactly one route: OneRisk (or any caller) posts a
 * borrower's raw schedules, gets back a profile id, status and the same
 * markdown summary the monthly cycle produces — synchronous, no LLM, no
 * confirmation step. Unresolved terms are committed as a PROXY and queued in
 * review_queue rather than blocking the response (§5 safety net).
 *
 * Pure request validation lives here; all business logic is the same
 * mapping/intake.js used by the CLI, so the two callers can never diverge.
 */
export function createApp(store) {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/health', (req, res) => {
    res.status(200).json({ ok: true });
  });

  app.post('/profiles/intake', (req, res) => {
    const payload = req.body ?? {};
    const badRequest = validateEnvelope(payload);
    if (badRequest) return res.status(400).json({ error: badRequest });

    const invalid = validateSchedules(payload.schedules);
    if (invalid) return res.status(422).json({ error: invalid });

    try {
      const result = intakeProfile(store, payload, { fx: payload.fx ?? null });
      res.status(200).json({
        profileId: result.profileId,
        status: result.signals.status,
        month: result.signals.month,
        summary: result.report.markdown,
        reviewEntries: result.reviewEntries,
      });
    } catch (err) {
      if (/index data|3-month move/i.test(err.message)) {
        return res.status(503).json({ error: `no WPI data ingested yet: ${err.message}` });
      }
      console.error(err); // eslint-disable-line no-console
      res.status(500).json({ error: 'internal error building the macro signal report' });
    }
  });

  return app;
}

/** Structurally malformed request: not even shaped like the §3 contract. */
function validateEnvelope(payload) {
  if (!payload.entity_name || typeof payload.entity_name !== 'string') return 'entity_name is required';
  if (!Array.isArray(payload.schedules) || payload.schedules.length === 0) return 'schedules must be a non-empty array';
  return null;
}

/** Well-formed request whose content the §3 pipeline cannot act on. */
function validateSchedules(schedules) {
  for (const schedule of schedules) {
    if (!VALID_SCHEDULE_TYPES.has(schedule.type)) {
      return `unknown schedule type "${schedule.type}" — expected one of ${[...VALID_SCHEDULE_TYPES].join(', ')}`;
    }
    if (!Array.isArray(schedule.items) || schedule.items.length === 0) {
      return `schedule "${schedule.type}" needs a non-empty items array`;
    }
    for (const item of schedule.items) {
      if (!item.name_verbatim || typeof item.name_verbatim !== 'string') {
        return `every item needs a name_verbatim (schedule "${schedule.type}")`;
      }
    }
  }
  return null;
}

/** Opens the persistent store and starts listening — the process entry point. */
export function startServer({ dbPath = process.env.WPI_DB_PATH || 'data/wpi.db', port = process.env.PORT || 3000 } = {}) {
  const store = openStore(dbPath);
  const app = createApp(store);
  const server = app.listen(port, () => {
    console.log(`wpi-macro-signal-engine listening on :${port} (db: ${dbPath})`); // eslint-disable-line no-console
  });
  server.on('close', () => store.close());
  return { app, server, store };
}

// pathToFileURL, not string concatenation: this project's own directory name
// contains a space, which import.meta.url percent-encodes and argv[1] does not.
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) startServer();
