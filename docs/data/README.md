# Apollo 11 Mission Data Packs

This directory contains the structured mission datasets produced during Milestone M0. They translate the Apollo 11 Flight Plan, Flight Journal, and Mission Operations Report into machine-readable packs that the simulation engine can load without revisiting the raw sources.

## Current Coverage
- Launch through transearth coast, atmospheric entry, and splashdown (GET 000:00:00 → 195:25:00).
- Passive Thermal Control monitoring, MCC-1/2/3/4 PAD flows and execution logic, LOI-focused P52 realignment, DOI planning, LM separation and powered descent, landing/post-landing safing, surface EVA-1 prep/egress/traverse/closeout **plus the contingency EVA-2 extension**, ascent rendezvous guidance, TEI preparation and burn execution, MCC-5 return correction, transearth DSN communications passes with signal-strength trend analytics, entry PAD alignment, service module jettison, and recovery procedures captured in the events, checklists, PADs, and autopilot packs defined by [`../milestones/M0_DATA_INGESTION.md`](../milestones/M0_DATA_INGESTION.md).
- Provenance log linking each record to the primary reference used.
- Reaction-control system cluster geometry for both vehicles captured in `thrusters.json`, providing Milestone M2 with baseline lever-arm and control-axis metadata before guidance tuning begins.

Future updates will publish the ingestion notebooks under `scripts/ingest/`, expand contingency branches, and wire the new analytics into regression notebooks as described in the milestone plan.

The shared helper package at [`../scripts/ingest/ingestlib/`](../../scripts/ingest/ingestlib) exposes GET parsers, typed dataset loaders, validation utilities, and provenance builders so notebooks and automation reuse consistent logic.

## Validation Harness

- Run `cd js && npm run validate:data` to execute the mission dataset sweep implemented in [`../../js/src/tools/validateMissionData.js`](../../js/src/tools/validateMissionData.js).
- The validator checks GET formatting for events, PADs, and mission effects; verifies that prerequisite, checklist, autopilot, and failure references resolve; confirms autopilot JSON assets load with monotonic sequencing; ensures checklists are sequentially numbered; and surfaces missing numeric baselines in `consumables.json`.
- Extend the harness alongside new ingest work—surface EVA and transearth communication records should introduce companion checks so regression runs highlight schema drift early.

## File Inventory
- `events.csv` – Mission beat definitions with prerequisites, windows, and resource effects.
- `checklists.csv` – Crew procedures broken into atomic steps.
- `autopilots.csv` – High-level metadata for automation scripts, each pointing to a JSON profile under `autopilots/` and
  defining `propulsion` JSON payloads that capture tank assignments, mass-flow rates, and optional ullage usage for the
  resource model.
- `autopilot_scripts.md` – Authoring guide for the CSV/JSON autopilot packs, command schema, propulsion metadata, and
  validation workflow.
- `failures.csv` – Recoverable and hard failure hooks tied to mission logic.
- `pads.csv` – Uplink cards for burns and corrections.
- `provenance.md` – Source citations for every record range.
- `consumables.json` – Baseline power, propellant, and life-support budgets with notes and references to the Mission Operations Report and Flight Plan.
- `communications_trends.json` – DSN pass analytics (signal strength, handover duration, power deltas) for transearth coast support.
- `thrusters.json` – Reaction-control system geometry for the CSM and LM, including cluster placement, control axes, and baseline thrust/impulse metadata for Milestone M2 tuning.

These files use UTF-8 encoding with Unix line endings and can be imported into spreadsheets or parsed directly by ingestion tooling.

## Autopilot Command Reference

Automation scripts under `autopilots/` describe maneuvers as ordered command sequences. The runner in [`../../js/src/sim/autopilotRunner.js`](../../js/src/sim/autopilotRunner.js) currently supports:

- `attitude_hold` — maintain an attitude target using the guidance loop.
- `ullage_fire` — request an ullage firing for a specified duration (seconds).
- `throttle` — step the propulsion system to a specific throttle level.
- `throttle_ramp` — linearly transition throttle from the current (or explicit `from`) level to the `to`/`level` target over the provided `duration` seconds. Zero-duration ramps collapse to an instantaneous throttle change.
- `rcs_pulse` — request quantized RCS firings; the new `RcsController` resolves thruster selections from `thrusters.json`, computes propellant mass and impulse totals, and records usage against the appropriate tank.
- `dsky_entry` — log AGC Verb/Noun macros (optionally by ID) and forward them to the manual action recorder so parity scripts and upcoming UI workflows can replay the same DSKY interactions.

The LM powered descent script (`PGM_LM_PDI.json`) now uses `throttle_ramp` entries to approximate the gradual spool-up and throttle-bucket transitions captured in the Flight Journal, giving the simulation smoother mass-flow integration for descent propellant tracking.

Autopilot metadata in `autopilots.csv` now feeds tolerance envelopes directly into the scheduler; burn duration, propellant usage, and derived Δv deltas beyond the documented limits trigger the corresponding failure effects.

## Manual Action Scripts

Milestone M1 introduced a manual action scripting system that can drive checklist acknowledgements and resource deltas deterministically. Script structure, examples, and usage notes live in [`manual_scripts/README.md`](manual_scripts/README.md) to keep the CLI harness and future HUD implementations in sync.
