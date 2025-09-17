# Autopilot Script Authoring Guide

The autopilot dataset pairs the metadata in [`autopilots.csv`](autopilots.csv) with
JSON command sequences under [`autopilots/`](autopilots) so the simulator can
replay historical burn profiles, ullage sequences, and checklist-driven DSKY
macros deterministically. This guide documents the structure of those files and
the expectations enforced by the Milestone M1/M2 tooling (`missionDataLoader`,
`AutopilotRunner`, and the parity harness) so future additions remain
compatible.

## Dataset Overview

1. **CSV catalog (`autopilots.csv`)** — High-level metadata that the loader
   attaches to each event: descriptive text, entry/termination requirements,
   tolerances, and propulsion parameters.
2. **JSON script (`autopilots/*.json`)** — Ordered command stream executed once
   an event arms the autopilot. Commands run in script time (seconds after
   engagement) and may modify attitude, throttle, RCS usage, or AGC state.
3. **Runtime ingestion** — `missionDataLoader` wires CSV rows and JSON payloads
   together; `AutopilotRunner` executes the commands, subtracts propellant using
   the propulsion metadata, logs DSKY entries, and feeds metrics into the HUD
   and scoring systems.

All timestamps use Ground Elapsed Time (GET) when stored in the CSV, while
script `time` offsets are relative to the start of the autopilot run.

## `autopilots.csv` Columns

| Column | Purpose |
| --- | --- |
| `autopilot_id` | Stable identifier referenced by events/checklists. |
| `description` | Plain-language summary (CLI/log output). |
| `script_path` | Relative path to the JSON command sequence. |
| `entry_conditions` | Human-readable prerequisites shown in logs/HUD tooltips. |
| `termination_conditions` | Criteria for ending the program (Δv reached, GET limit). |
| `tolerances` | JSON string describing evaluation tolerances (e.g., `delta_v_ft_s`). |
| `propulsion` | JSON string describing the propulsion system (tank, mass flow, ullage tank/rate). |

The loader parses the JSON columns into structured objects so simulation code
receives typed tolerances and propulsion profiles. Provide units explicitly:
`delta_v_ft_s` for velocity, `mass_flow_kg_per_s` or `mass_flow_lb_per_s` for
propellant draw, etc.

## JSON Script Schema

Each script is an object with the fields below (additional metadata is allowed):

```
{
  "id": "PGM_MCC1",
  "title": "Apollo 11 Midcourse Correction 1",
  "dt": 0.5,
  "sequence": [
    { "time": 0, "command": "attitude_hold", "target": { "roll_deg": 0, "pitch_deg": 29, "yaw_deg": 0 } },
    { "time": 5, "command": "ullage_fire", "duration": 2 },
    { "time": 7, "command": "throttle", "level": 0.65 },
    { "time": 22, "command": "throttle", "level": 0.0 },
    { "time": 26, "command": "attitude_hold", "target": { "roll_deg": 0, "pitch_deg": 0, "yaw_deg": 0 } }
  ],
  "notes": "Mission Operations Report MCC-1 profile"
}
```

`dt` is reserved for future high-rate resampling but is currently informational;
`AutopilotRunner` sorts the `sequence` array by `time` and executes commands in
order.

## Command Reference

`AutopilotRunner` accepts the following command names (case-insensitive). Field
aliases listed in parentheses are parsed automatically.

| Command | Required Fields | Behavior |
| --- | --- | --- |
| `attitude_hold` | `target` (`roll_deg`, `pitch_deg`, `yaw_deg`) | Logs the requested attitude; guidance loops consume the target externally. |
| `ullage_fire` | `duration` (seconds) | Opens an ullage window and, when propulsion metadata provides an ullage tank/rate, subtracts RCS propellant for the overlap. |
| `throttle` | `level` (`value`) | Sets instantaneous throttle level [0–1]. Cancels active throttle ramps. |
| `throttle_ramp` | `duration`, `to`/`level` (`from`) | Interpolates throttle from the current (`from`) level to the target over the duration, with near-zero durations collapsing to an instant set. |
| `rcs_pulse` | `axis`/`torque_axis`, `duration`/`seconds`, optional `tank`, `count`, `duty_cycle`, `thrusters` | Requests quantized RCS pulses via `RcsController`. Propellant usage, impulse, and pulse counts feed resource/score metrics. |
| `dsky_entry` (`dsky_macro`) | `macro` *or* `verb`+`noun`; optional `registers`, `sequence`, `program`, `note` | Records Verb/Noun inputs, forwards them to the mission log, and stores them in the manual action recorder for parity runs. |

Each command may include an optional `note`/`label` string for logging. New
commands should extend `AutopilotRunner.#executeCommand` and be documented here
before landing in the dataset.

## Propulsion Metadata & Resource Tracking

`propulsion` entries control how propellant is consumed while throttle or ullage
commands run:

```
{
  "type": "csm_sps",
  "tank": "csm_sps",
  "mass_flow_kg_per_s": 29.5,
  "ullage": { "tank": "csm_rcs", "mass_flow_kg_per_s": 0.65 }
}
```

- `tank` / `tank_key` / `propellant` — Maps to `ResourceSystem` tank IDs (`csm_sps`,
  `csm_rcs`, `lm_descent`, `lm_ascent`, `lm_rcs`).
- `mass_flow_*` — Propellant draw while throttle > 0. Pounds-per-second values
  are converted to kilograms internally.
- `ullage` — Optional nested object specifying RCS tank and mass-flow during
  ullage windows.

When metadata is omitted the runner falls back to sensible defaults:
`csm_sps` profile for CSM burns, LM descent/ascent rates for LM programs, and a
placeholder `sivb` profile (no propellant subtraction) for S-IVB powered TLI. All
usage is logged through `ResourceSystem.recordPropellantUsage`, aggregated into
`AutopilotRunner.stats()`, and surfaced by the HUD/score systems.

## Logging, Parity, and Manual Scripts

- Mission log entries identify each command execution, throttle ramp, RCS pulse,
  and DSKY macro along with the event/autopilot IDs.
- The manual action recorder captures DSKY macros emitted by autopilots so
  parity runs (`npm run parity`) can replay the exact Verb/Noun sequences when
  comparing auto vs. manual checklists.
- Autopilot statistics (`totalBurnSeconds`, `propellantKgByTank`, `totalRcsImpulseNs`, etc.)
  flow into `UiFrameBuilder` frames and the commander rating summary, enabling UI
  widgets and scoring to stay synchronized with script data.

## Authoring Workflow

1. Update the CSV row (tolerances, propulsion metadata, notes) and the
   corresponding JSON script together.
2. Run `npm run validate:data` inside `js/` to ensure the loader can parse the
   changes and that GET windows, tolerances, and propulsion schemas remain
   valid.
3. If the script alters burn timing or propellant usage, rerun the parity
   harness (`npm run parity`) to confirm auto/manual runs remain in sync.
4. Document new sources and row ranges in `docs/data/provenance.md` so future
   contributors can trace the research lineage.

Following this structure keeps the guidance and RCS milestones aligned with the
historical burn data while giving the UI, scoring, and parity tooling a stable
contract.
