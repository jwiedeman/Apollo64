# JS Prototype Workspace

This workspace now includes a Node.js simulation harness that exercises the Apollo 11 mission datasets produced during Milestone M0. The prototype focuses on the Milestone M1 goals of deterministic scheduling, Passive Thermal Control (PTC) feedback, and resource bookkeeping before a browser UI is introduced.

## Current Prototype Features
- Loads `docs/data/*.csv` and autopilot JSON packs into typed runtime structures (`src/data/missionDataLoader.js`).
- Runs a fixed-step (20 Hz by default) mission loop that arms, activates, and completes events based on prerequisites and GET windows (`src/sim/eventScheduler.js`, `src/sim/simulation.js`).
- Applies success/failure effects into a lightweight resource model with thermal drift modelling for PTC coverage (`src/sim/resourceSystem.js`).
- Streams mission log messages with GET stamps for later HUD/audio wiring (`src/logging/missionLogger.js`).

## Running the Prototype
```
npm start -- --until 015:00:00
```

The `--until` flag accepts a `HHH:MM:SS` GET target; omit it to simulate the first 15 hours automatically. Additional flags:
- `--tick-rate <hz>` – Override the simulation frequency (default `20`).
- `--log-interval <seconds>` – How often to emit aggregate resource snapshots (default `3600`).
- `--quiet` – Suppress per-event logging while still printing the final summary.

## Module Overview
- `src/index.js` – CLI entrypoint that wires the loader, scheduler, resource model, and simulation loop.
- `src/data/missionDataLoader.js` – CSV/JSON ingestion with autopilot duration estimation and checklist/failure maps.
- `src/sim/eventScheduler.js` – Handles prerequisite gating, activation, completion, and failure effects.
- `src/sim/resourceSystem.js` – Tracks power/thermal deltas, Passive Thermal Control status, and failure hooks.
- `src/utils/` – Helpers for GET parsing and CSV decoding without external dependencies.

## Next Steps
- Integrate manual/checklist inputs so non-autopilot events respect crew acknowledgement instead of auto-completing.
- Expand the resource model to differentiate SPS, RCS, and electrical budgets, wiring in PAD-driven consumable deltas.
- Surface the scheduler/resource state through a browser HUD per Milestone M3, keeping the CLI loop as a regression harness.
- Add deterministic log replay tests that validate event ordering, PTC drift divergence, and failure propagation.
