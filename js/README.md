# JS Prototype Workspace

This workspace now includes a Node.js simulation harness that exercises the Apollo 11 mission datasets produced during Milestone M0. The prototype focuses on the Milestone M1 goals of deterministic scheduling, Passive Thermal Control (PTC) feedback, and resource bookkeeping before a browser UI is introduced.

## Current Prototype Features
- Loads `docs/data/*.csv` and autopilot JSON packs into typed runtime structures (`src/data/missionDataLoader.js`).
- Runs a fixed-step (20 Hz by default) mission loop that arms, activates, and completes events based on prerequisites and GET windows (`src/sim/eventScheduler.js`, `src/sim/simulation.js`).
- Applies success/failure effects into a resource model with thermal drift modelling for PTC coverage and baseline consumable budgets sourced from `docs/data/consumables.json` (`src/sim/resourceSystem.js`).
- Tracks checklist-driven events with automatic or manual step acknowledgement scheduling so crew procedures gate event completion (`src/sim/checklistManager.js`).
- Supports deterministic manual action scripts for checklist overrides, resource deltas, and propellant burns via `ManualActionQueue` (`src/sim/manualActionQueue.js`).
- Streams mission log messages with GET stamps and can export them to JSON for regression playback (`src/logging/missionLogger.js`).
- Replays autopilot JSON sequences through `AutopilotRunner` (`src/sim/autopilotRunner.js`), issuing ullage, attitude, and throttle commands while subtracting SPS/LM/RCS propellant usage from the shared resource model.
- Captures auto-advanced checklist acknowledgements and exports them as deterministic manual action scripts when `--record-manual-script` is provided, enabling parity runs without relying on auto crew logic (`src/logging/manualActionRecorder.js`).

## Running the Prototype
```
npm start -- --until 015:00:00
```

The `--until` flag accepts a `HHH:MM:SS` GET target; omit it to simulate the first 15 hours automatically. Additional flags:
- `--tick-rate <hz>` – Override the simulation frequency (default `20`).
- `--log-interval <seconds>` – How often to emit aggregate resource snapshots (default `3600`).
- `--quiet` – Suppress per-event logging while still printing the final summary.
- `--checklist-step-seconds <seconds>` – Configure how long the auto-advance crew spends on each checklist step (default `15`).
- `--manual-checklists` – Disable auto-advance so external tools or manual operators can acknowledge steps.
- `--manual-script <path>` – Path to a manual action script JSON file to replay during the run.
- `--record-manual-script <path>` – Capture auto crew acknowledgements into a manual action script for deterministic parity testing.

## Manual vs. Auto Parity Harness

Run the automated comparison workflow with:

```
npm run parity -- --until 015:00:00 --verbose
```

The harness executes an auto-advance baseline run, records the resulting manual action script, replays it with auto-advance disabled, and reports any divergence in event counts, resource snapshots, or autopilot metrics. Useful flags:

- `--output <path>` – Persist a JSON parity report for CI/regression review.
- `--tolerance <value>` – Override the numeric comparison tolerance (default `1e-6`).
- `--quiet` / `--verbose` – Control mission log verbosity during the paired runs (quiet by default).

Parity runs consume the same script format documented under [`docs/data/manual_scripts/README.md`](../docs/data/manual_scripts/README.md).

## Module Overview
- `src/index.js` – CLI entrypoint that wires the loader, scheduler, resource model, and simulation loop.
- `src/data/missionDataLoader.js` – CSV/JSON ingestion with autopilot duration estimation and checklist/failure maps.
- `src/sim/eventScheduler.js` – Handles prerequisite gating, activation, completion, and failure effects.
- `src/sim/resourceSystem.js` – Tracks power/thermal deltas, Passive Thermal Control status, and failure hooks.
- `src/utils/` – Helpers for GET parsing and CSV decoding without external dependencies.

## Next Steps
- Integrate the parity harness into automated regression checks, expanding comparisons beyond end-state snapshots to cover mission logs and manual action diffs.
- Expand the resource model to ingest PAD-driven consumable deltas and publish propellant/power summaries for HUD integration.
- Surface the scheduler/resource state through a browser HUD per Milestone M3, keeping the CLI loop as a regression harness.
- Calibrate the autopilot runner against PAD timelines by validating propellant mass-flow assumptions, logging Δv proxies, and wiring failure thresholds that surface when burns diverge from historical tolerances.
