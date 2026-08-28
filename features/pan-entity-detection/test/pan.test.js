const { test } = require('node:test');
const assert = require('node:assert/strict');
const { detectEntityType, ENTITY_TYPES } = require('../src/pan.js');

// --- Happy path: every entity code maps to the right type ---

test('detects all 10 entity types from the 4th character', () => {
  for (const [code, expectedType] of Object.entries(ENTITY_TYPES)) {
    const pan = `AAA${code}A1234A`;
    const result = detectEntityType(pan);
    assert.equal(result.valid, true, `expected ${pan} to be valid`);
    assert.equal(result.entityCode, code);
    assert.equal(result.entityType, expectedType);
  }
});

test('flags individuals with isIndividual: true', () => {
  assert.equal(detectEntityType('AAAPA1234A').isIndividual, true);
  assert.equal(detectEntityType('AAACA1234A').isIndividual, false);
});

// --- Normalization ---

test('accepts lowercase input and returns it uppercased', () => {
  const result = detectEntityType('aaaci1234a');
  assert.equal(result.valid, true);
  assert.equal(result.pan, 'AAACI1234A');
  assert.equal(result.entityType, 'Company');
});

test('trims surrounding whitespace', () => {
  assert.equal(detectEntityType('  AAAPA1234A  ').valid, true);
});

// --- Invalid inputs ---

test('rejects wrong length', () => {
  assert.equal(detectEntityType('AAAPA1234').valid, false);   // 9 chars
  assert.equal(detectEntityType('AAAPA12345A').valid, false); // 11 chars
});

test('rejects digits and letters in the wrong positions', () => {
  assert.equal(detectEntityType('AA1PA1234A').valid, false); // digit in letter block
  assert.equal(detectEntityType('AAAPAX234A').valid, false); // letter in digit block
});

test('rejects valid-format PAN with unknown entity code', () => {
  const result = detectEntityType('AAAXA1234A'); // X is not an entity code
  assert.equal(result.valid, false);
  assert.match(result.error, /Unknown entity code 'X'/);
});

test('rejects null, undefined, and empty input without crashing', () => {
  assert.equal(detectEntityType(null).valid, false);
  assert.equal(detectEntityType(undefined).valid, false);
  assert.equal(detectEntityType('').valid, false);
});
