# JS Prototype Workspace

This workspace now includes a Node.js simulation harness that exercises the Apollo 11 mission datasets produced during Milestone M0. The prototype focuses on the Milestone M1 goals of deterministic scheduling, Passive Thermal Control (PTC) feedback, and resource bookkeeping before a browser UI is introduced.

## Current Prototype Features
- Loads `docs/data/*.csv` and autopilot JSON packs into typed runtime structures (`src/data/missionDataLoader.js`).
- Parses the shared audio cue catalog (`docs/data/audio_cues.json`) alongside the mission datasets so the simulation context can expose bus/category metadata for HUD/audio prototyping.
- Runs a fixed-step (20 Hz by default) mission loop that arms, activates, and completes events based on prerequisites and GET windows (`src/sim/eventScheduler.js`, `src/sim/simulation.js`).
- Applies success/failure effects into a resource model with thermal drift modelling for PTC coverage and baseline consumable budgets sourced from `docs/data/consumables.json` (`src/sim/resourceSystem.js`).
- Tracks checklist-driven events with automatic or manual step acknowledgement scheduling so crew procedures gate event completion (`src/sim/checklistManager.js`).
- Supports deterministic manual action scripts for checklist overrides, resource deltas, and propellant burns via `ManualActionQueue` (`src/sim/manualActionQueue.js`).
- Streams mission log messages with GET stamps and can export them to JSON for regression playback (`src/logging/missionLogger.js`).
- Replays autopilot JSON sequences through `AutopilotRunner` (`src/sim/autopilotRunner.js`), issuing ullage, attitude, and throttle commands while subtracting SPS/LM/RCS propellant usage from the shared resource model.
- Captures auto-advanced checklist acknowledgements and exports them as deterministic manual action scripts when `--record-manual-script` is provided, enabling parity runs without relying on auto crew logic (`src/logging/manualActionRecorder.js`).
- Manual action recorder exports now bundle workspace, panel, and audio ledgers so parity harnesses, HUD exports, and replay tooling can replay layout changes and the cue soundscape alongside checklist history (`src/logging/manualActionRecorder.js`).
- Emits periodic text HUD snapshots (`src/hud/textHud.js`) summarizing event status, resource margins, propellant usage, checklist activity, and manual action queues so long running simulations remain legible from the CLI.
- Exports deterministic `ui_frame` sequences for front-end prototyping through the new CLI in [`src/tools/exportUiFrames.js`](src/tools/exportUiFrames.js).
- Audio validation CLI in [`src/tools/validateAudio.js`](src/tools/validateAudio.js) replays mission slices, inspects dispatcher-ledger stats for cooldown/priority/concurrency regressions, and emits optional JSON reports for regression tracking.
- Carries the commander rating snapshot (`frame.score`) through both the CLI HUD and UI frame exporter so mission performance data is available to text output, saved frames, and future UI bindings.
- Entry overlay config in [`docs/ui/entry_overlay.json`](../docs/ui/entry_overlay.json) now feeds `UiFrameBuilder`'s `frame.entry` payload with corridor, blackout, EMS, and recovery telemetry so downstream HUD experiments can render the TEI → splashdown finale without custom data stitching.

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
- `--hud-interval <seconds>` – Override how often the CLI HUD snapshot is emitted (default `600`).
- `--no-hud`/`--disable-hud` – Suppress the CLI HUD output entirely (useful for minimal logs or scripted runs).
- `--hud-debug` – Append performance metrics to the CLI HUD output and mission logs for instrumentation passes.
- `--profile-performance <path>` – Write the aggregated performance telemetry to a JSON file after the run (combine with `--profile-performance-pretty` for formatted output).

## Manual vs. Auto Parity Harness

Run the automated comparison workflow with:

```
npm run parity -- --until 015:00:00 --verbose
```

The harness executes an auto-advance baseline run, records the resulting manual action script, replays it with auto-advance disabled, and reports any divergence in event counts, resource snapshots, autopilot metrics, or (when a profile is supplied) progression/unlock state. Useful flags:

- `--output <path>` – Persist a JSON parity report for CI/regression review.
- `--tolerance <value>` – Override the numeric comparison tolerance (default `1e-6`).
- `--quiet` / `--verbose` – Control mission log verbosity during the paired runs (quiet by default).
- `--profile <path>` – Load a commander profile (use `default` for the standard location) so the harness can assert that auto/manual runs produce identical unlocks, achievements, and persisted mission stats.
- `--mission-id <id>` – Tag the parity slice for progression tracking; combine with `--full-mission` / `--partial-mission` to mirror campaign context.

Parity runs consume the same script format documented under [`docs/data/manual_scripts/README.md`](../docs/data/manual_scripts/README.md).

## UI Frame Exporter

Capture mission-state snapshots for UI prototyping or automated tests with:

```
npm run export:ui-frames -- --until 020:00:00 --interval 300 --output out/ui_frames.json --pretty
```

Key options:

- `--start <GET>` – Begin capturing frames at a specific GET (default `000:00:00`).
- `--interval <seconds>` – Sampling cadence for frames (default `600`).
- `--max-frames <count>` – Optional cap on exported frames.
- `--include-history` / `--no-history` – Toggle resource-history buffers in each frame (enabled by default).
- `--manual-checklists` / `--manual-script <path>` – Mirror CLI controls to disable auto-advance or replay a manual script while exporting.

The exporter writes a JSON payload containing metadata, the simulation summary, and an ordered array of `ui_frame` objects that follow the schema documented in [`docs/ui/ui_frame_reference.md`](../docs/ui/ui_frame_reference.md).

## Mission HUD Web Demo

Launch the browser-based mission HUD with:

```
npm run dev
```

The server streams simulation frames to the UI via Server-Sent Events. Visit [`http://localhost:3000`](http://localhost:3000) to watch the mission progress in real time. The visual MVP includes:

- A persistent HUD with GET/MET, next event countdown, resource bars, comms status, maneuver status, and live commander score.
- Three views—Navigation, Controls, and Systems—mirroring the project plan's layout. Tabs toggle between trajectory/timeline context, checklist & AGC details, and resource/performance telemetry.
- Navigation view panels for docking progress and the entry corridor summarize rendezvous gates, blackout timing, and recovery milestones as the mission advances.
- Systems view adds a commander scorecard and resource trend snapshots sourced from the simulator's history buffers.
- Mission log feed and alert banner reacting to warnings, cautions, and failures surfaced by the simulator.

Use the “Restart Simulation” button to trigger a fresh full-mission run without reloading the page. The CLI simulator remains available through `npm start` for text HUD and data exports.

The development server now replays the entire Apollo 11 timeline (to GET `196:00:00`) instead of stopping after the first coast segment. The footer playback selector throttles the stream at 1×, 2×, 4×, 8×, or 16× pacing, while the **Fast (dev)** option removes pacing for regression sweeps. Each preset keeps the HUD’s ~100 ms refresh loop while the simulator’s mission clock advances at the selected multiplier: 1× mirrors the historical GET (≈8.2 days of wall time), 2× halves that, 4× quarters it, and 16× lands in roughly 12¼ hours. Use the Fast preset when you need the simulation to sprint to splashdown as quickly as the host CPU allows.

The UI stream now emits a mission frame every 0.1 GET seconds (or the equivalent at higher compression rates), so checklist micro-steps, switch throws, autopilot pulses, and resource deltas surface in the Navigation, Controls, and Systems panes without waiting for multi-second aggregation windows. The footer hint updates live to show the effective frame cadence for the active preset, making it easy to confirm that the feed is syncing to the backend.

> **Tip:** The mission HUD binds to `0.0.0.0` by default. Pass `--host` and `--port` if you need to target a specific interface or port when running outside the container.

## Autopilot Burn Analyzer

Inspect autopilot execution metrics against historical PADs and tolerance envelopes with:

```
npm run analyze:autopilots -- --until 015:00:00 --autopilot PGM_06_TLI --pretty
```

Key options:

- `--until <GET>` – Mission GET to stop the analysis run (defaults to `015:00:00`).
- `--autopilot <id>` / `--event <id>` – Focus the report on specific automation programs or events.
- `--json` / `--pretty` – Emit structured JSON suitable for regression dashboards or notebook ingestion.
- `--output <path>` – Persist the report to disk.

The analyzer replays the mission slice with the full simulator stack, capturing actual vs. expected burn seconds, propellant draw, Δv deltas, ullage usage, and PAD metadata for each autopilot event. Runs exit non-zero when any analyzed event fails so tolerance regressions surface immediately.

## Performance Analyzer

Replay a mission slice and audit HUD/audio/input performance metrics with:

```
npm run analyze:performance -- --until 015:00:00 --output out/performance.json --csv out/performance.csv --pretty
```

Key options:

- `--until <GET>` – Mission GET ceiling for the analysis run (default `015:00:00`).
- `--hud-interval <seconds>` – Override the HUD render cadence when sampling metrics.
- `--output <path>` / `--pretty` – Persist the JSON summary for dashboards or regression logs.
- `--csv <path>` – Export a flat timeline of performance log entries for spreadsheet review.
- `--strict` – Exit non-zero when any warning/failure threshold is breached.
- `--verbose` – Print additional log counts alongside the console summary.

The report bundles the latest `PerformanceTracker` snapshot, per-minute mission log entries tagged `logCategory: 'performance'`, and threshold evaluations. Use it to spot HUD render spikes, audio queue saturation, or elevated manual input latency before they propagate into parity failures.

## Module Overview
- `src/index.js` – CLI entrypoint that wires the loader, scheduler, resource model, and simulation loop.
- `src/data/missionDataLoader.js` – CSV/JSON ingestion with autopilot duration estimation and checklist/failure maps.
- `src/sim/simulationContext.js` – Wraps the loader output (including audio cue metadata) into HUD/resource/autopilot subsystems for CLI runs and upcoming UI layers.
- `src/sim/eventScheduler.js` – Handles prerequisite gating, activation, completion, and failure effects.
- `src/sim/resourceSystem.js` – Tracks power/thermal deltas, Passive Thermal Control status, and failure hooks.
- `src/utils/` – Helpers for GET parsing and CSV decoding without external dependencies.

## Next Steps
- Integrate the parity harness into automated regression checks, expanding comparisons beyond end-state snapshots to cover mission logs and manual action diffs.
- Expand the resource model to ingest PAD-driven consumable deltas and publish propellant/power summaries for HUD integration.
- Surface the scheduler/resource state through a browser HUD per Milestone M3, keeping the CLI loop as a regression harness.
- Calibrate the autopilot runner against PAD timelines by validating propellant mass-flow assumptions, logging Δv proxies, and wiring failure thresholds that surface when burns diverge from historical tolerances.
