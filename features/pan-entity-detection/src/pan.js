/**
 * PAN entity type detection — core logic.
 *
 * A PAN is 10 characters: 5 letters, 4 digits, 1 letter (e.g. AAAPA1234A).
 * The 4th character encodes the holder's entity type.
 *
 * Pure function, zero dependencies — safe to lift into any service.
 */

const ENTITY_TYPES = {
  P: 'Individual',
  C: 'Company',
  H: 'Hindu Undivided Family (HUF)',
  F: 'Firm / LLP',
  A: 'Association of Persons (AOP)',
  T: 'Trust',
  B: 'Body of Individuals (BOI)',
  L: 'Local Authority',
  J: 'Artificial Juridical Person',
  G: 'Government',
};

const PAN_FORMAT = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

const FORMAT_ERROR =
  'PAN must be 10 characters: 5 letters, 4 digits, 1 letter (e.g. AAAPA1234A)';

/**
 * Detect the entity type encoded in a PAN.
 *
 * @param {string} rawPan - PAN as entered by the user (any case, may have spaces)
 * @returns {{valid: true, pan: string, entityCode: string, entityType: string, isIndividual: boolean}
 *         | {valid: false, pan: string, error: string}}
 */
function detectEntityType(rawPan) {
  const pan = String(rawPan ?? '').trim().toUpperCase();

  if (!PAN_FORMAT.test(pan)) {
    return { valid: false, pan, error: FORMAT_ERROR };
  }

  const entityCode = pan[3]; // 4th character (positions count from 0)
  const entityType = ENTITY_TYPES[entityCode];

  if (!entityType) {
    return {
      valid: false,
      pan,
      error: `Unknown entity code '${entityCode}' in 4th position of PAN`,
    };
  }

  return {
    valid: true,
    pan,
    entityCode,
    entityType,
    isIndividual: entityCode === 'P',
  };
}

module.exports = { detectEntityType, ENTITY_TYPES };
