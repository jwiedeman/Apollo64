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
  - Validate that optional `pad_id` references resolve to rows in `pads.csv` so UI bindings can surface PAD metadata.
  - Parse `success_effects`/`failure_effects` JSON payloads to ensure GET-like fields remain well-formed.
- **Autopilots:**
  - Confirm each CSV record has a unique `autopilot_id` and a resolvable JSON script.
  - Inspect the JSON sequence for monotonically ordered `time`+`duration` spans and flag invalid step definitions.
  - Validate command payloads (throttle ranges, ullage durations, DSKY macros, RCS pulse metadata) so malformed steps are caught before guidance tuning.
  - Cross-check `rcs_pulse` craft/thruster references against `thrusters.json` and ensure referenced propellant tanks exist in `consumables.json`.
  - Parse the `tolerances` JSON payload to surface malformed input before guidance tuning begins.
  - Parse the `propulsion` JSON payload, verifying tank identifiers, numeric mass-flow entries (kg/s or lb/s), and nested
    ullage definitions when provided.
- **Checklists:**
  - Validate `GET_nominal` formatting and sequential step numbering.
  - Catch duplicate `step_number` values that could desync manual/auto parity recordings.
- **PADs:**
  - Parse delivery/expiration GET stamps, parse parameter JSON payloads, sanity-check embedded GET strings (e.g., TIG values), and warn when burn durations, Δv entries, v∞, or range figures are non-numeric or non-positive.
- **Failures:**
  - Ensure unique IDs, recognized classifications, and the presence of trigger/effect/recovery descriptions for downstream tooling.
- **Consumables:**
  - Parse the JSON payload and warn when numeric baselines (propellant, power, life support) are missing or non-numeric.
  - Validate Deep Space Network support fields (`dsn_shift_hours`, `next_window_open_get`).
- **Communications trends:**
  - Parse `communications_trends.json`, verify GET windows, ensure signal-strength and handover metrics are numeric, and confirm station handovers reference expected identifiers.
- **Thrusters:**
  - Parse `thrusters.json`, ensure each craft and RCS cluster defines unique IDs, verify translation/torque axis enums, confirm thrust/Isp/min impulse values resolve (using defaults when needed), and cross-check that referenced propellant tanks exist in `consumables.json`.
- **Audio cues:**
  - Parse `audio_cues.json`, ensuring buses and categories expose unique IDs, ducking rules reference known targets, and cooldown/priority fields stay numeric.
  - Validate that each cue references a known category, defines playback duration/loop metadata, includes at least one platform asset path, and carries mission-source citations for provenance tracking.
- **UI bundles:**
  - Parse `docs/ui/panels.json`, confirming panel IDs remain unique, control definitions list valid states, dependencies reference existing controls, alerts carry valid triggers, and cross-panel references resolve correctly.
  - Validate `docs/ui/checklists.json`, ensuring checklist IDs exist in the CSV dataset, phases/roles use the documented enums, panel/control/state references resolve, and per-checklist step ordering stays sequential.
  - Inspect `docs/ui/workspaces.json` so preset IDs remain unique, tile IDs and coordinates stay in range, constraints use numeric values, and optional `panelFocus` references point at known panels.
  - Validate `docs/ui/entry_overlay.json` so pad/event references resolve, corridor/g-load states stay numeric, blackout GET stamps parse, and recovery milestones expose deterministic IDs, GETs, and offsets.

## Extending the Sweep

- Future EVA extensions or DSN updates should extend these checks so nested effect payloads (e.g., `communications.next_window_open_get`, `surface_ops.eva2_complete`) stay validated as new fields appear.
- Planned notebooks under `scripts/ingest/` can re-use the validator’s helper functions for GET parsing and reference verification so manual analyses stay aligned with the automated sweep.
- When mission scoring hooks mature, incorporate regression checks that assert metric ranges (Δv margins, propellant draw) remain within expected tolerances.
- Upcoming scheduler hooks (`audio_cue`, `audio_channel`, DSN handover triggers) should reuse these helpers so event/failure records resolve cue IDs against `audio_cues.json` and bus routing stays canonical as playback wiring proceeds.

Maintaining these checks keeps the mission data trustworthy for both the JS prototype and the eventual Nintendo 64 build while reducing manual verification overhead as Milestone M0 evolves.
