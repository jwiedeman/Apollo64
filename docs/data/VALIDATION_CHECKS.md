# Mission Dataset Validation Checklist

This note documents the automated sweep performed by [`js/src/tools/validateMissionData.js`](../../js/src/tools/validateMissionData.js). It complements the Milestone M0 ingestion workflow by codifying the structural assumptions behind the CSV packs and supporting assets.

## Running the Validator

```bash
cd js
npm run validate:data
```

The command loads the CSV and JSON packs under `docs/data/`, performs consistency checks, and prints a summary of dataset counts, blocking errors, and advisory warnings. The process exits with a non-zero status when errors are present so it can gate future CI automation.

## Checks Performed

- **Events:**
  - Parse `get_open`/`get_close` GET strings and confirm close ≥ open when both exist.
  - Track phase-local chronology to highlight regressions where a new entry opens before previously documented phase events.
  - Verify prerequisite references exist, are not self-referential, and open after their dependencies.
  - Confirm referenced `checklist_id`, `autopilot_script`, and `failure_id` values resolve to known datasets.
  - Parse `success_effects`/`failure_effects` JSON payloads to ensure GET-like fields remain well-formed.
- **Autopilots:**
  - Confirm each CSV record has a unique `autopilot_id` and a resolvable JSON script.
  - Inspect the JSON sequence for monotonically ordered `time`+`duration` spans and flag invalid step definitions.
  - Parse the `tolerances` JSON payload to surface malformed input before guidance tuning begins.
- **Checklists:**
  - Validate `GET_nominal` formatting and sequential step numbering.
  - Catch duplicate `step_number` values that could desync manual/auto parity recordings.
- **PADs:**
  - Parse delivery/expiration GET stamps, parse parameter JSON payloads, and sanity-check embedded GET strings (e.g., TIG values).
- **Failures:**
  - Ensure unique IDs, recognized classifications, and the presence of trigger/effect/recovery descriptions for downstream tooling.
- **Consumables:**
  - Parse the JSON payload and warn when numeric baselines (propellant, power, life support) are missing or non-numeric.
  - Validate Deep Space Network support fields (`dsn_shift_hours`, `next_window_open_get`).

## Extending the Sweep

- New surface EVA and transearth communication entries should append coverage here—add schema-specific checks to prevent accidental omissions as the dataset grows.
- Planned notebooks under `scripts/ingest/` can re-use the validator’s helper functions for GET parsing and reference verification so manual analyses stay aligned with the automated sweep.
- When mission scoring hooks mature, incorporate regression checks that assert metric ranges (Δv margins, propellant draw) remain within expected tolerances.

Maintaining these checks keeps the mission data trustworthy for both the JS prototype and the eventual Nintendo 64 build while reducing manual verification overhead as Milestone M0 evolves.
