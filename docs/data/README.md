# Apollo 11 Mission Data Packs

This directory contains the structured mission datasets produced during Milestone M0. They translate the Apollo 11 Flight Plan, Flight Journal, and Mission Operations Report into machine-readable packs that the simulation engine can load without revisiting the raw sources.

## Current Coverage
- Launch through transearth coast, atmospheric entry, and splashdown (GET 000:00:00 → 195:25:00).
- Passive Thermal Control monitoring, MCC-1/2/3/4 PAD flows and execution logic, LOI-focused P52 realignment, DOI planning, LM separation and powered descent, landing/post-landing safing, ascent rendezvous guidance, TEI preparation and burn execution, MCC-5 return correction, entry PAD alignment, service module jettison, and recovery procedures captured in the events, checklists, PADs, and autopilot packs defined by [`../milestones/M0_DATA_INGESTION.md`](../milestones/M0_DATA_INGESTION.md).
- Provenance log linking each record to the primary reference used.

Future updates will flesh out surface EVA timelines, transearth communications, and add validation notebooks under `scripts/ingest/` as described in the milestone plan.

## Validation Harness

- Run `cd js && npm run validate:data` to execute the mission dataset sweep implemented in [`../../js/src/tools/validateMissionData.js`](../../js/src/tools/validateMissionData.js).
- The validator checks GET formatting for events, PADs, and mission effects; verifies that prerequisite, checklist, autopilot, and failure references resolve; confirms autopilot JSON assets load with monotonic sequencing; ensures checklists are sequentially numbered; and surfaces missing numeric baselines in `consumables.json`.
- Extend the harness alongside new ingest work—surface EVA and transearth communication records should introduce companion checks so regression runs highlight schema drift early.

## File Inventory
- `events.csv` – Mission beat definitions with prerequisites, windows, and resource effects.
- `checklists.csv` – Crew procedures broken into atomic steps.
- `autopilots.csv` – High-level metadata for automation scripts, each pointing to a JSON profile under `autopilots/`.
- `failures.csv` – Recoverable and hard failure hooks tied to mission logic.
- `pads.csv` – Uplink cards for burns and corrections.
- `provenance.md` – Source citations for every record range.
- `consumables.json` – Baseline power, propellant, and life-support budgets with notes and references to the Mission Operations Report and Flight Plan.

These files use UTF-8 encoding with Unix line endings and can be imported into spreadsheets or parsed directly by ingestion tooling.

## Manual Action Scripts

Milestone M1 introduced a manual action scripting system that can drive checklist acknowledgements and resource deltas deterministically. Script structure, examples, and usage notes live in [`manual_scripts/README.md`](manual_scripts/README.md) to keep the CLI harness and future HUD implementations in sync.
