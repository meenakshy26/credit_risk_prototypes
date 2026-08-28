# PAN Entity Type Detection API

**Status:** Prototype — working & tested
**Owner:** Meenakshy (PM)
**Handoff to:** _(developer name)_

## Problem

OneRisk flows need to know what kind of entity a borrower is (Individual, Company,
HUF, Firm/LLP, Trust, ...) as early as possible. The PAN itself encodes this — the
4th character identifies the holder type — so we can detect entity type instantly
from the PAN alone, before any bureau or MCA lookup.

## API contract

### `POST /api/v1/pan/entity-type`

**Request**

```json
{ "pan": "AAACI1234A" }
```

**Response — 200 (valid PAN)**

```json
{
  "valid": true,
  "pan": "AAACI1234A",
  "entityCode": "C",
  "entityType": "Company",
  "isIndividual": false
}
```

**Response — 422 (invalid PAN)**

```json
{
  "valid": false,
  "pan": "AAA123",
  "error": "PAN must be 10 characters: 5 letters, 4 digits, 1 letter (e.g. AAAPA1234A)"
}
```

**Response — 400 (bad request)** — missing/non-string `pan` field.

### `GET /health` → `{ "status": "ok" }`

## Business rules

1. **PAN format:** exactly 10 characters — 5 letters, 4 digits, 1 letter
   (regex `^[A-Z]{5}[0-9]{4}[A-Z]$`).
2. **Normalization:** input is trimmed and uppercased before validation
   (`aaapa1234a` is accepted).
3. **Entity type = 4th character:**

   | Code | Entity type |
   |------|-------------|
   | P | Individual |
   | C | Company |
   | H | Hindu Undivided Family (HUF) |
   | F | Firm / LLP |
   | A | Association of Persons (AOP) |
   | T | Trust |
   | B | Body of Individuals (BOI) |
   | L | Local Authority |
   | J | Artificial Juridical Person |
   | G | Government |

4. A PAN matching the format but with a 4th character outside this table is
   rejected as invalid (`valid: false`).
5. Format validity only — this does NOT verify the PAN exists with NSDL/Protean.

## Edge cases covered by tests

- Lowercase / whitespace-padded input → normalized, accepted
- Wrong length, digits in letter positions, letters in digit positions → 422
- Valid format but unknown 4th character (e.g. `AAAXA1234A`) → 422
- Missing or non-string `pan` in request body → 400

## How to run

```bash
npm install   # once
npm test      # automated tests
npm start     # API on http://localhost:3000
```

Try it:

```bash
curl -s -X POST http://localhost:3000/api/v1/pan/entity-type \
  -H "Content-Type: application/json" \
  -d '{"pan": "AAACI1234A"}'
```

## For the developer (integration notes)

- Core logic is a **pure function** in `src/pan.js` with zero dependencies —
  it can be lifted into any existing service (Node) or ported trivially
  (Python/Elixir) without the Express wrapper.
- No auth, rate limiting, or logging — platform standards apply on integration.
- Nothing is mocked; the logic is self-contained and deterministic.
- Open question for prod: should we also verify PAN existence via the
  NSDL/Protean API, or is format+type detection enough for the early flow?
