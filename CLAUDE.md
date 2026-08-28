# CLAUDE.md — instructions for Claude when working in this repo

## What this repo is

Feature prototypes built by Meenakshy (product manager at IDfy) for handoff to
the engineering team. Prototypes must be working and tested, but they are NOT
production code — a developer integrates them into the platform afterwards.

## Ground rules

- **Never** include IDfy proprietary code, API keys, credentials, or real
  customer/bureau data. All sample data must be synthetic (e.g. made-up PANs).
- Every feature lives in its own folder under `features/<feature-name>/`.
- Every feature gets a README following the template in
  `features/pan-entity-detection/README.md`: Problem → API contract →
  Business rules → Edge cases → How to run → "For the developer" notes.
- **Spec before code:** write/update the feature README first, then implement.

## Code conventions

- Default stack: Node.js (platform also runs Python and Elixir — note in the
  README when a feature is meant for one of those services).
- Split every feature into pure logic (`src/<name>.js`, zero/minimal deps,
  liftable into any service) and a thin Express wrapper (`src/server.js`).
- Tests are mandatory, using Node's built-in runner: `npm test` must pass
  before any commit. Edge cases listed in the README must each have a test.
- Keep dependencies minimal; prefer the standard library.
- API responses use `{ valid | error | ... }` JSON shapes with proper HTTP
  status codes (200 success, 400 bad request, 422 validation failure).

## Git workflow

- Work on a feature branch named `feature/<feature-name>`, never directly on `main`.
- Commit messages: short imperative summary, e.g. "Add PAN entity detection API".
- Before committing: run `npm test` in the touched feature folder.
- Handoff = PR from the feature branch to `main`, with the feature README
  linked in the PR description, reviewed by an IDfy developer.
