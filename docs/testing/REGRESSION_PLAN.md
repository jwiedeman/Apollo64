# Regression & QA Plan

This guide documents the repeatable checks that keep the Apollo 11 mission datasets and simulator in lock-step as new research and features land. It extends the QA expectations in the master project plan (Section 10) by enumerating concrete tooling, execution order, and artifact handling so contributors can run the same suite locally or in future CI jobs.

## Goals
- Catch dataset regressions immediately after updating ingestion notebooks or CSV/JSON packs.
- Preserve deterministic behaviour between the auto crew and manual replays.
- Quantify autopilot accuracy against the published PAD tolerances before guidance changes land.
- Capture HUD-ready telemetry snapshots for UI and accessibility reviews.
- Produce auditable artefacts (logs, parity reports, frame exports) that can gate releases.

## Core Toolchain Overview

### Mission Dataset Validation
- **Command:** `npm run validate:data`
- **Location:** [`js/src/tools/validateMissionData.js`](../../js/src/tools/validateMissionData.js)
- **Scope:** Parses every dataset in `docs/data/`, checking GET formatting, prerequisite closure, autopilot command payloads, PAD JSON, failure taxonomy metadata, thruster geometry, communications trends, consumables baselines, and the audio cue catalog.【F:docs/data/VALIDATION_CHECKS.md†L1-L76】【F:js/src/tools/validateMissionData.js†L1-L400】
- **When to run:** After any change to `docs/data/` or the ingestion helpers in [`scripts/ingest/ingestlib`](../../scripts/ingest/ingestlib). Notebook-driven exports should only be copied into the repo once this pass is clean.

### Manual vs. Auto Parity Harness
- **Command:** `npm run parity -- --until <GET> [--output out/parity.json]`
- **Location:** [`js/src/tools/runParityCheck.js`](../../js/src/tools/runParityCheck.js)
- **Scope:** Replays a mission slice twice—first with auto-advancing checklists, then with the recorded manual script—and diffs event timelines, resource snapshots, autopilot summaries, mission logs, and score outputs.【F:js/src/tools/runParityCheck.js†L1-L210】
- **Inputs:** Optional manual queue tuning via `--checklist-step-seconds` or pre-recorded scripts from the CLI (`npm start -- --record-manual-script …`). Manual scripts follow the schema documented in [`docs/data/manual_scripts/README.md`](../data/manual_scripts/README.md).
- **When to run:** Whenever checklist logic, manual action handling, or autopilot data changes. Store JSON reports for review when parity fails.

### Autopilot Burn Analyzer
- **Command:** `npm run analyze:autopilots [--event EVT_ID] [--until GET]`
- **Location:** [`js/src/tools/analyzeAutopilots.js`](../../js/src/tools/analyzeAutopilots.js)
- **Scope:** Replays autopilot-driven events, summarises achieved vs. expected burn seconds, propellant draw, and Δv deviations, and exits non-zero when tolerances are exceeded. Uses the propulsion metadata captured in `docs/data/autopilots.csv` and the JSON command streams under `docs/data/autopilots/` to remain consistent with guidance tuning work.【F:docs/data/autopilot_scripts.md†L1-L120】【F:js/src/tools/analyzeAutopilots.js†L1-L320】
- **When to run:** After altering autopilot scripts, propulsion metadata, resource model behaviour, or thruster geometry. Recommended before promoting new burn profiles from ingestion notebooks.

### Node Test Suite
- **Command:** `npm test`
- **Location:** [`js/test/`](../../js/test)
- **Scope:** Exercises deterministic units including the autopilot runner, manual action queue, AGC runtime, UI frame builder, score system, and supporting utilities so behaviour stays stable as the engine grows.【F:js/test/autopilotRunner.test.js†L1-L74】【F:js/test/agcRuntime.test.js†L1-L175】【F:js/test/scoreSystem.test.js†L1-L108】
- **When to run:** Before every commit touching `js/src/` or mission datasets that feed the tested systems.

### UI Frame Exporter & HUD Snapshots
- **Command:** `npm run export:ui-frames -- --until <GET> --output out/frames.json`
- **Location:** [`js/src/tools/exportUiFrames.js`](../../js/src/tools/exportUiFrames.js)
- **Scope:** Calls [`UiFrameBuilder`](../../js/src/hud/uiFrameBuilder.js) at a fixed cadence to capture `ui_frame` sequences (including commander rating blocks, optional resource histories, and the normalized mission log stream) for UI prototyping, accessibility audits, and regression fixtures.【F:docs/ui/ui_frame_reference.md†L1-L88】【F:js/src/tools/exportUiFrames.js†L1-L220】
- **When to run:** After changes to HUD bindings, resource summaries, scoring, mission log categorization, or whenever new UI components require fresh fixtures.

### Mission Logging & Manual Action Recorder
- **Command:** `npm start -- --until <GET> --log-file out/run.json --record-manual-script out/manual.json`
- **Location:** [`js/src/index.js`](../../js/src/index.js), [`js/src/logging/manualActionRecorder.js`](../../js/src/logging/manualActionRecorder.js)
- **Scope:** Generates deterministic mission logs alongside manual action scripts that can be replayed through the parity harness or UI automation.【F:js/src/index.js†L1-L120】【F:js/src/logging/manualActionRecorder.js†L1-L220】 Attach these artefacts to milestone reports when documenting behaviour changes.

## Recommended Regression Passes

### 1. Dataset Update Cycle
1. Run ingestion notebooks under `scripts/ingest/` with the shared helpers described in [`docs/data/INGESTION_PIPELINE.md`](../data/INGESTION_PIPELINE.md).
2. Inspect CSV/JSON diffs, update provenance notes, and commit staged artefacts.
3. Execute `npm run validate:data` to confirm structural integrity.
4. Replay a representative mission slice with `npm run parity` (recording the JSON diff).
5. Export HUD frames (`npm run export:ui-frames`) when schema changes ripple into UI consumers.

### 2. Guidance & Autopilot Tweaks
1. Run `npm run analyze:autopilots -- --event <target>` on affected burns.
2. Inspect propellant and Δv deltas; reconcile deviations with PAD tolerances.
3. Re-run `npm run parity` to ensure manual and auto crews still align after tuning.
4. Update scoring/regression notes if commander rating thresholds shift.

### 3. UI & HUD Iteration
1. Capture fresh `ui_frame` exports and diff against previous fixtures.
2. Replay CLI runs with HUD enabled (`npm start -- --hud-interval <s>`) to eyeball layout changes.
3. Verify logs still carry caption metadata per [`docs/ui/logging_accessibility_guidelines.md`](../ui/logging_accessibility_guidelines.md).

## Artefact Management
- Store parity reports, autopilot analyses, and HUD frame exports in an `_build/` or `out/` directory ignored by git until ready to publish.
- Reference saved artefacts in pull-request summaries to justify guidance or dataset changes.
- When sharing regression snapshots, include GET ranges, simulator options, and dataset revision notes for reproducibility.

## Future Automation Hooks
- Wire the commands above into CI once Node 18+ runners are available, failing the build on validator or parity regressions.
- Extend `scripts/ingest/ingestlib` with CLI wrappers so notebook workflows can be executed headlessly during nightly jobs.
- Generate dashboards from exported parity/analysis JSON (burn deviations, resource margins, score trends) for milestone reviews.
- Add long-run soak configurations that drive the simulator through multi-day segments (launch → TEI → entry) while logging validation metrics for the stability milestone.

Keeping these checks in lockstep with dataset and engine updates ensures the Apollo 11 simulation remains deterministic, historically grounded, and ready for the upcoming UI and N64 implementation passes.
