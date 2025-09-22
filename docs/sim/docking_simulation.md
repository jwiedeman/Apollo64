# Docking Simulation & Rendezvous Control Blueprint

This blueprint details how the simulator will model Apollo 11's
rendezvous and docking phases for Milestone M2. It extends the fixed-step
loop, autopilot runner, and reaction-control modelling delivered in M1 so
the LM ascent, terminal phase, and docking capture reflect historical
tolerances. The plan emphasizes deterministic behaviour, manual vs.
automation parity, and reusable data bindings that the upcoming UI and N64
port can share.

## Goals

1. **Deterministic approach corridor** – propagate CSM/LM state vectors,
   range, range-rate, attitude error, and capture windows on every tick so
   braking gates align with the timing documented in the Apollo 11 Flight
   Plan.
2. **Manual/automation parity** – manual control inputs dispatched through
   the [`ManualActionQueue`](manual_action_queue.md) feed the same RCS pulse
   scheduler and docking evaluators as autopilot programs stored under
   [`docs/data/autopilots/`](../data/autopilots/).
3. **Scoring and failure integration** – successful captures update the
   [`ScoreSystem`](score_system.md), while missed gates or excessive closure
   rates trigger failure breadcrumbs and penalties defined in
   [`docs/data/failures.csv`](../data/failures.csv).
4. **UI readiness** – expose normalized telemetry so the Navigation,
   Controls, and Systems views plus the rendezvous overlay described in
   [`docs/ui/rendezvous_overlay.md`](../ui/rendezvous_overlay.md) render the
   same metrics without bespoke adapters.

## Data Dependencies

- **Docking gates:** [`docs/ui/docking_gates.json`](../ui/docking_gates.json)
  enumerates braking checkpoints (range, target closure rate, tolerances,
  checklist IDs). The simulation consumes this to gate mission progression
  and scoring bonuses.
- **Thruster geometry:** [`docs/data/thrusters.json`](../data/thrusters.json)
  supplies CSM/LM RCS cluster positions, axes, and impulse budgets. The
  `RcsController` converts manual/autopilot commands into deterministic
  propellant draw and delta-v.
- **Autopilot scripts:** New LM ascent and "Docking Assist" profiles live in
  [`docs/data/autopilots/`](../data/autopilots/). They include translation and
  attitude commands, range targets, and branch markers for capture vs.
  wave-off scenarios.
- **Panels & checklists:** [`docs/ui/panels.json`](../ui/panels.json) and
  [`docs/ui/checklists.json`](../ui/checklists.json) map each braking gate to
  the switches and cues surfaced in the Controls view. Gate activation ties
  back to `FP_7-32_RNDZ_DOCK` entries so manual crews follow historical
  procedures.
- **Failures & scoring:** The failure taxonomy and commander rating hooks are
  shared with the broader simulator through [`docs/data/failures.csv`](../data/failures.csv)
  and [`docs/sim/score_system.md`](score_system.md). Docking adds new failure
  IDs (e.g., `DOCK_RATE_HIGH`, `DOCK_PROP_EXHAUSTED`) with recovery guidance.

## State Model

The docking subsystem maintains a deterministic `DockingContext` refreshed
within the simulation loop:

```text
struct DockingContext {
  RendezvousPhase phase;            // Ascent, Phasing, Terminal, Capture
  double range_m;                   // Relative distance
  double range_rate_mps;            // Closing velocity (signed)
  Vec3 attitude_error_deg;          // Roll/pitch/yaw difference
  Vec3 translation_error_m;         // Lateral offsets for corridor checks
  double capture_timer_s;           // Time remaining for current gate
  GateProgress gate;                // Snapshot from docking_gates.json
  PropellantSnapshot rcs_usage;     // Tank totals + duty cycle metrics
  bool contact_light;               // True when LM probe compression occurs
  bool hard_dock;                   // True after latches confirmed
}
```

- **Rendezvous phases:** Derived from scheduler events. `Ascent` begins at LM
  liftoff; `Phasing` covers CSI/CSM plane alignment; `Terminal` activates when
  the braking gate sequence starts; `Capture` ends with hard dock and tunnel
  equalization.
- **Propagation:** Uses the existing orbit propagator for translational
  motion and `RcsController` feedback for pulses. Range and range-rate derive
  from the relative position/velocity vectors.
- **Attitude/translation error:** Each tick, compute quaternion differences
  between docking target frames and the actual craft orientation. Translation
  error projects onto docking axes (X lateral, Y vertical, Z closure) for UI
  reticles.
- **Gate progress:** Each gate stores activation/completion progress values so
  UI overlays render approach bars. When gate constraints fail, mark the gate
  `missed` and enqueue recovery actions.

## Control & Guidance Loops

### Manual Inputs

- Crew inputs originate from the input service (`uiInputService`) or parity
  scripts. Commands include `att_hold_toggle`, `rcs_translation`,
  `rcs_rotation`, and `docking_abort`.
- Inputs pass through `uiManualActionDispatcher`, which pushes normalized
  manual actions onto the `ManualActionQueue`. The queue routes pulses to the
  `RcsController`, guaranteeing identical pulse quantization for manual and
  automated runs.
- The AGC interface exposes Program 36/37 toggles (`V37E 63E` / `V37E 62E`)
  that switch between automatic and semi-automatic docking modes. Manual
  overrides still use the same control surfaces, but instrumentation notes
  the override to help scoring and logging.

### Autopilot Programs

- **Docking Assist (CSM):** Maintains attitude lock on LM, applies braking
  pulses when range-rate exceeds gate targets, and hands off to manual control
  at 30 m unless `auto_dock` is enabled.
- **LM Ascent Guidance:** Drives ascent burns, coelliptic adjustment, and
  terminal phase initiation. Once within 500 m, the LM autopilot focuses on
  translation alignment while the CSM handles attitude and braking.
- Scripts publish their current segment into the `DockingContext` so the UI
  can display autopilot intent (e.g., "Brake to -0.9 m/s"). Branch markers
  allow wave-off or station-keeping loops when gates are missed or manual
  aborts occur.

### Gate Evaluation

1. Activate the next gate when range falls below the defined `rangeMeters` and
   prerequisites succeed (previous gate complete, checklist step acknowledged).
2. While the gate is active, enforce closure-rate tolerances and translation
   error bands. Violations increment a penalty counter and optionally trigger
   `rcs_usage` boosts to reflect extra braking propellant.
3. Gate completion occurs when range passes the `completionProgress` or hard
   dock is detected. On success, issue `ui:docking_gate_complete` events and
   scoring bonuses. On failure, log a breadcrumb referencing the gate ID,
   checklist step, and recommended recovery action (e.g., "Station-keep and
   repeat braking pulse").

## Logging & Telemetry

- `DockingContext` snapshots feed `UiFrameBuilder` as `frame.docking`, with
  fields for `range`, `rangeRate`, `attitudeError`, `translationError`,
  `gate`, `autopilotState`, and `rcsUsage`.
- Mission log entries (see [`mission_log_reference.md`](../logging/mission_log_reference.md))
  use structured IDs: `docking_gate_armed`, `docking_gate_complete`,
  `docking_abort`, `docking_contact`, `docking_hard_lock`. Each entry carries
  range, rate, propellant totals, and manual vs. autopilot attribution.
- Failure breadcrumbs leverage `createFailureBreadcrumb` to spell out the
  causal chain (e.g., "Gate_150M missed → braking pulses +45% → RCS tank B low").
- `runParityCheck` captures docking telemetry diffs (gate states, propellant
  totals, contact timestamps) to guarantee manual vs. autopilot runs stay in
  lockstep.

## Scoring & Failure Integration

- The `ScoreSystem` gains docking-specific metrics: bonus for gate adherence,
  penalty for each wave-off, and deductions for propellant overuse.
- Failure taxonomy entries:
  - `DOCK_RATE_HIGH` – triggered when contact range-rate exceeds `0.4 m/s`.
  - `DOCK_PROP_EXHAUSTED` – triggered when CSM or LM RCS reserves fall below
    defined caution bands before capture.
  - `DOCK_ALIGNMENT_LOST` – triggered when translation error exceeds 1.5 m for
    more than 10 seconds inside the 150 m gate.
- Recoverable states enqueue checklist-driven recovery events (e.g., "Station
  Keeping Mode"), while hard failures skip forward to contingency timelines
  outlined in `docs/data/events.csv`.

## Implementation Roadmap

1. **State scaffolding:** Introduce `DockingContext` and integrate it into the
   simulation loop alongside the orbit propagator.
2. **Gate loader:** Parse `docking_gates.json` into runtime structures,
   validating ranges, tolerances, and checklist IDs during the existing data
   validation pass (`npm run validate:data`).
3. **Autopilot extensions:** Add docking segments and branch markers to the
   autopilot runner; support translation velocity clamps and program-driven
   handoffs between CSM and LM scripts.
4. **Manual controls:** Extend `uiManualActionDispatcher` with
   docking-specific action types (translation pulses, station-keep toggles)
   and wire them through the `ManualActionQueue`.
5. **Telemetry plumbing:** Populate `UiFrameBuilder` and the mission log with
   docking summaries; update `docs/ui/view_data_bindings.md` once fields are
   finalized.
6. **Scoring/failure hooks:** Register docking metrics with `ScoreSystem` and
   expand the failure taxonomy with the IDs listed above.
7. **Parity harness:** Update `runParityCheck` to compare docking gate results
   and `DockingContext` snapshots between auto/manual runs.

## Validation

- **Historical replay:** Simulate LM ascent through docking using the new
  autopilot scripts. Verify gate timings and range-rate envelopes against the
  Apollo 11 Mission Operations Report (Section 3.6).
- **Manual fly-off:** Replay the terminal phase with manual inputs (recorded
  via `uiInputService`). Ensure gate scoring and propellant usage remain within
  ±5% of the autopilot reference when flown nominally.
- **Wave-off scenario:** Force a `Gate_150M` miss and confirm the recovery loop
  arms the proper checklist, logs a breadcrumb, and reuses the same gate table
  on the second attempt.
- **Failure injection:** Exhaust an RCS quad intentionally to confirm
  `DOCK_PROP_EXHAUSTED` fires, logs the penalty, and feeds the Systems view and
  failure breadcrumbs.
- **Parity regression:** Run the parity harness across the docking window to
  confirm manual-script replays reproduce identical `DockingContext` streams
  and scoring outcomes.

By defining the docking mechanics in this blueprint, Milestone M2 gains a
clear implementation path that keeps guidance, manual input, scoring, and UI
layers synchronized across both the web prototype and the future N64 build.
