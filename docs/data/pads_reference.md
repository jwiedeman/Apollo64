# PAD Dataset Reference

The PAD (Pre-Advisory Data) dataset captures the burn cards and
trajectory updates uplinked to Apollo 11 during the mission. Each row in
[`docs/data/pads.csv`](pads.csv) mirrors a historical PAD delivery so the
simulation can load ignition timing, targeting, and validity windows
without revisiting the Flight Plan or Mission Operations Report. This
reference explains the CSV columns, the embedded parameter payload, and
the way downstream systems consume the records.

## CSV Columns

| Column | Description |
| --- | --- |
| `pad_id` | Unique identifier (`PAD_<PHASE>_<SEQ>`). Events reference this identifier through the optional `pad_id` column. |
| `purpose` | Human-readable summary of the PAD ("Translunar Injection Burn", "Midcourse Correction 3"). |
| `GET_delivery` | Ground Elapsed Time when the PAD was delivered to the crew. Stored as `HHH:MM:SS` and parsed into seconds for runtime comparisons. |
| `parameters` | JSON object encoded as a string. Described in the [Parameter Payload](#parameter-payload) section. |
| `valid_until` | GET timestamp for PAD expiration. Events use this value to confirm the PAD is still current before executing the linked maneuver. |
| `source_ref` | Citation pointing back to the Flight Plan, Flight Journal, or Mission Operations Report used during ingestion. |

## Parameter Payload

The `parameters` column stores a JSON blob so each PAD can include the
values specific to its maneuver. When the mission loader parses the CSV
it forwards the object through `normalizePadParameters`, producing a
normalized structure with pre-parsed GET stamps and metric conversions
for the HUD, UI frame builder, and autopilot tooling.【F:js/src/data/missionDataLoader.js†L323-L410】

Common keys and their meaning:

| JSON key | Example | Notes |
| --- | --- | --- |
| `TIG` | `"002:44:14"` | Ignition time. Converted to `parameters.tig` with both string and seconds values. |
| `delta_v_ft_s` / `delta_v_mps` | `10037` / `3050` | Planned Δv magnitude. Feet-per-second values are converted to meters-per-second. |
| `burn_duration_s` | `347` | Nominal burn duration. Used for scheduler expectation windows and HUD copy. |
| `attitude` | `"R180/P000/Y000"` | Target attitude callout. Presented on the HUD and controls panels before burns. |
| `entry_interface_get` | `"195:11:40"` | Entry interface GET for re-entry PADs. Becomes `parameters.entryInterface`. |
| `range_to_target_nm` | `2150` | Downrange distance for entry and correction PADs. Remains available in the normalized payload. |
| `flight_path_angle_deg` | `-6.53` | Entry corridor angle for re-entry PADs. |
| `v_infinity_ft_s` / `v_infinity_mps` | `-2200` | Hyperbolic excess velocity, with both imperial and metric forms supported. |
| `notes` | "Throttle bucket at 40%" | Optional free text for situational reminders. |

The normalized object retains the raw JSON under `parameters.raw` while
providing derived fields such as `deltaVMetersPerSecond` and
`burnDurationSeconds` so downstream consumers avoid redundant parsing.
Both the mission logger and upcoming UI panels surface these values when
previewing a burn or reviewing completed maneuvers.【F:docs/ui/ui_frame_reference.md†L324-L347】【F:js/src/hud/uiFrameBuilder.js†L64-L107】

## Simulation Integration

- **Event scheduler:** Events that include a `pad_id` receive the
  normalized PAD payload during preparation so the scheduler can expose
  it in status logs, autopilot summaries, and completion checks.【F:js/src/sim/eventScheduler.js†L30-L111】
- **UI frame builder:** The HUD and Navigation view obtain PAD
  summaries for the next event, the active burn, and checklist chips,
  ensuring DSKY macros and "Plan Burn" shortcuts use historically
  accurate values.【F:js/src/hud/uiFrameBuilder.js†L36-L118】【F:docs/ui/ui_frame_reference.md†L320-L347】
- **Validation pipeline:** `npm run validate:data` parses every PAD,
  confirms GET formatting, and verifies all `pad_id` references resolve
  so dataset regressions surface immediately.【F:js/src/tools/validateMissionData.js†L612-L723】

## Ingestion & Extension Notes

1. Maintain GET strings in `HHH:MM:SS` form. The ingestion helpers and
   validator depend on this formatting when computing seconds and
   comparing windows.【F:scripts/ingest/ingestlib/time.py†L1-L44】
2. When adding new fields to the parameter payload, extend
   `normalizePadParameters` to emit the normalized values and update the
   validator if cross-checks are required.
3. Cite the controlling source (Flight Plan page, Mission Operations
   Report section, Flight Journal entry) in `source_ref` so future data
   audits remain traceable.
4. Regenerate downstream artifacts—UI frame exports, parity fixtures,
   and documentation screenshots—after major PAD updates to keep
   tooling, HUDs, and scoring aligned with the new data packs.

Capturing PAD metadata at this fidelity keeps mission automation,
checklists, HUD widgets, and scoring logic anchored to the same truth
source the controllers and crew used during Apollo 11.
