# OneRisk Prototypes

Feature prototypes built by Meenakshy (PM) for handoff to the IDfy engineering team.

**What this repo is:** working, tested prototypes with specs — not production code.
Each feature lives in its own folder under `features/`, with its own README covering
the spec, how to run it, what's mocked, and what a developer needs to wire up.

**What this repo is NOT:** no IDfy proprietary code, no credentials, no customer or
bureau data. Everything here is built from scratch against mock/sample data.

## Features

| Feature | Status | Stack |
|---------|--------|-------|
| [PAN entity type detection](features/pan-entity-detection/) | In progress | Node.js |

## How to run any feature

Each feature folder has its own README with exact commands. The general pattern:

```bash
cd features/<feature-name>
npm install     # once
npm test        # run the automated tests
npm start       # start the API locally
```
