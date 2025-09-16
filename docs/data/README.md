# Apollo 11 Mission Data Packs

This directory contains the structured mission datasets produced during Milestone M0. They translate the Apollo 11 Flight Plan, Flight Journal, and Mission Operations Report into machine-readable packs that the simulation engine can load without revisiting the raw sources.

## Current Coverage
- Launch through Lunar Orbit Insertion 2 circularization (GET 000:00:00 → 081:00:00).
- Passive Thermal Control monitoring, MCC-1/2/3/4 PAD flows and execution logic, extended consumables tracking, LOI-focused P52 realignment, LOI-1/2 PAD loading and burn automation, and associated failure hooks captured in the events, checklists, PADs, and autopilot packs defined by [`../milestones/M0_DATA_INGESTION.md`](../milestones/M0_DATA_INGESTION.md).
- Provenance log linking each record to the primary reference used.

Future updates will extend the dataset through LM descent/ascent preparation and surface operations while adding validation notebooks under `scripts/ingest/` as described in the milestone plan.

## File Inventory
- `events.csv` – Mission beat definitions with prerequisites, windows, and resource effects.
- `checklists.csv` – Crew procedures broken into atomic steps.
- `autopilots.csv` – High-level metadata for automation scripts, each pointing to a JSON profile under `autopilots/`.
- `failures.csv` – Recoverable and hard failure hooks tied to mission logic.
- `pads.csv` – Uplink cards for burns and corrections.
- `provenance.md` – Source citations for every record range.

These files use UTF-8 encoding with Unix line endings and can be imported into spreadsheets or parsed directly by ingestion tooling.
