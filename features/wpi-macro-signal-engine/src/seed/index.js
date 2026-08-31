import { SEED_SYNONYMS } from './synonyms.js';
import { SEED_DRIVERS } from './drivers.js';
import { SEED_POLICY_CHECKS } from './policyChecks.js';
import { PILOT_PROFILES } from './pilotProfiles.js';
import { norm } from '../core/text.js';

/**
 * Loads reference data and the pilot profiles. Idempotent: profiles are
 * replaced by name, synonyms and drivers upsert, policy checks are rebuilt.
 *
 * Runs after ingest so that every seeded code can be checked against the
 * commodities actually published — a typo in a 10-digit code is otherwise
 * invisible until a report prints a blank.
 */
export function seedAll(store, { logger = console, strict = true } = {}) {
  const unknownCodes = [];
  const knows = (code) => store.countCommodities() === 0 || store.commodity(code) !== undefined;

  const result = store.transaction(() => {
    for (const [term, commodityName] of SEED_SYNONYMS) {
      store.putSynonym({ term: norm(term), commodityName, confidence: 'high', source: 'seed' });
    }

    for (const d of SEED_DRIVERS) {
      if (!knows(d.driverCode)) {
        unknownCodes.push(`driver ${d.commodityKey} -> ${d.driverCode}`);
        continue;
      }
      store.putDriver(d);
    }

    store.clearPolicyChecks();
    for (const p of SEED_POLICY_CHECKS) store.putPolicyCheck(p);

    let profileCount = 0;
    for (const profile of PILOT_PROFILES) {
      for (const item of profile.items) {
        for (const code of item.codes) if (!knows(code)) unknownCodes.push(`${profile.name} / ${item.label} -> ${code}`);
        if (item.driverCode && !knows(item.driverCode)) {
          unknownCodes.push(`${profile.name} / ${item.label} driver -> ${item.driverCode}`);
        }
      }
      const profileId = store.upsertProfile(profile);
      profile.items.forEach((item, i) => store.addProfileItem(profileId, item, i));
      profileCount += 1;
    }

    return { synonyms: SEED_SYNONYMS.length, drivers: SEED_DRIVERS.length, policyChecks: SEED_POLICY_CHECKS.length, profileCount };
  });

  if (unknownCodes.length > 0) {
    const message = `Seeded codes absent from the ingested WPI file:\n  ${unknownCodes.join('\n  ')}`;
    if (strict) throw new Error(message);
    logger.warn?.(message);
  }

  return { ...result, unknownCodes };
}

export { PILOT_PROFILES } from './pilotProfiles.js';
export { SEED_SYNONYMS, PACKAGING_KEYWORDS } from './synonyms.js';
export { SEED_DRIVERS, driverKeyForCode } from './drivers.js';
export { SEED_POLICY_CHECKS, policyKeysForCodes } from './policyChecks.js';
