# Milestone M1 — Core Engine, Scheduler, and Passive Thermal Control

Milestone M1 stands up the deterministic simulation core that the rest of the project depends on. The milestone concludes when the JS prototype can march forward in real time, execute scheduled events, and maintain the Passive Thermal Control (PTC) maneuver using resource-aware control loops.

## Objectives
- Implement a fixed-step simulation loop (20 Hz) with deterministic ordering of system updates.
- Load the M0 CSV datasets and materialize runtime data structures for events, checklists, autopilot scripts, and failure definitions.
- Provide an event scheduler that enforces prerequisites, GET windows, and branching outcomes.
- Model first-pass resource systems (power, propellant, thermal, communications) with budget tracking and failure hooks.
- Implement the PTC control loop with both manual assist and autopilot maintenance.
- Expose a minimal HUD readout for GET, upcoming events, and key resource margins.

## Core Loop Architecture
```
initialize_state();
while (simulation_running) {
  advance_time(dt);                // dt = 1/20s
  poll_inputs();                   // manual crew actions or automation toggles
  update_event_scheduler();        // activate/complete events based on GET and prerequisites
  apply_autopilot_scripts();       // feed thrust/attitude commands from active scripts
  integrate_guidance_and_physics();// RK2 for translation; PD for attitude with RCS quantization
  update_resources();              // power, propellant, thermal, comm windows
  evaluate_failures();             // check for penalties and state transitions
  refresh_hud();                   // push current state to UI layer
}
```
Key properties:
- **Deterministic ordering:** updates happen in the exact order above. All randomness must be seeded through mission config files.
- **Discrete inputs:** manual crew steps are queued with the GET at which they occur; the scheduler processes them during the `update_event_scheduler` pass.
- **Time anchoring:** `advance_time` increments both Mission Elapsed Time (MET) and GET, using the launch GET reference from configuration.

## Runtime Data Structures
- **Events:** Load into a dictionary keyed by `event_id` with fields mirroring `events.csv`. Runtime fields include `status` (`Pending`, `Armed`, `Active`, `Complete`, `Failed`, `Skipped`) and `activation_time`.
- **Checklists:** Store as ordered lists under each `checklist_id`. Manual completion toggles occur when crew input matches the expected `action`/`response` pair.
- **Autopilot scripts:** Parse JSON payloads referenced by `script_path` into sequences of time-tagged commands (attitude targets, throttle levels, entry/exit conditions).
- **Failures:** Represent as evaluators that receive the current simulation state and return penalty deltas when triggered.

## Event Scheduler Behavior
1. **Arming:** When all prerequisites succeed and `GET >= get_open`, the event moves from `Pending` to `Armed`.
2. **Activation:** Events become `Active` when crew input or autopilot engagement begins, or automatically at `get_open` if flagged `auto_start`.
3. **Completion:** Upon satisfying success criteria (checklist steps complete, autopilot script exit condition met) within `get_close`, mark `Complete` and apply `success_effects` to resources.
4. **Failure:** If `get_close` passes without completion, or a linked failure condition triggers, mark `Failed`, apply `failure_effects`, and enqueue follow-on penalties (e.g., additional Δv required).
5. **Skip/Override:** Developer tools may mark events `Skipped` for Free Flight mode. Skipped events log a provenance entry but do not affect prerequisites unless flagged `critical`.

Events publish status updates to the HUD queue so the UI can render upcoming windows, active tasks, and overdue penalties.

## Resource Models (First Pass)
- **Power:** Track fuel cell output, battery state of charge, and load draw. Inputs come from checklists (switch configurations) and event effects. Failure thresholds: low reactant reserves, fuel cell ΔP.
- **Propellant:** Distinguish SPS, RCS (CSM & LM), and ascent/descent stage prop. Autopilot scripts consume prop at defined rates with stochastic jitter disabled for determinism.
- **Thermal:** Represent PTC as a regulating mechanism for `heat_balance` derived from sun exposure. Without PTC, cryo boiloff increases, feeding back into power reserves.
- **Communications:** Windows encode DSN station availability and orientation requirements. Missed windows delay PAD deliveries and can escalate failure classes for time-critical updates.

Each resource exposes interfaces for `apply_delta(value, source)` and emits alerts when thresholds cross caution/warning bands. These alerts feed both the scheduler (to trigger remedial events) and the HUD (for player awareness).

The current prototype seeds the resource model with launch-day consumable budgets parsed from `docs/data/consumables.json`, ensuring simulated deltas have a realistic baseline.

## PTC Control Loop Specification
- **Objective:** Maintain a slow 0.3°/s roll to evenly distribute heating and preserve cryo tanks.
- **Sensors:** Current attitude quaternion, sun vector, roll rate gyros.
- **Controller:** PD controller with quantized RCS pulses (0.5 s minimum). Gains tuned to avoid limit cycling.
- **Autopilot Behavior:**
  - Entry: verify craft is out of burns and communications windows permit rotation.
  - Engage: fire RCS jets to reach target roll rate, then schedule pulse trains to maintain rate.
  - Monitor: integrate thermal model; if cryo boiloff trend exceeds threshold, increase duty cycle.
  - Exit: triggered by upcoming burns, checklists, or manual abort.
- **Manual Assist:** Crew can fire discrete pulses; the controller updates its state estimate accordingly to prevent fighting pilot inputs.

PTC status becomes an event in the scheduler with success criteria "roll rate within tolerance for 95% of the monitoring window". Failure injects a `thermal_drift` penalty and increases power draw via elevated boiloff.

## HUD & Telemetry Hooks
- **Time Block:** Display GET, MET, and time to next critical event.
- **Event Stack:** Show top N `Armed`/`Active` events with colored status indicators and deadlines.
- **Resources:** Render gauges for power (SOA %, reactant minutes), propellant (per tank), thermal balance, and comm window countdown.
- **PTC Widget:** Visualize roll rate vs. target with caution/warning bands.
- **Log Feed:** Append scheduler messages (event start/end, failures, autopilot transitions) for debugging and eventual voiceover alignment.

The HUD can be console-based during M1—rendered as a simple text grid updated each frame—before migrating to a graphical display in later milestones.

## Implementation Snapshot — JS Prototype Harness
- **Entrypoint:** [`js/src/index.js`](../../js/src/index.js) initializes the mission datasets, scheduler, and resource model, then marches the simulation to a target GET at a deterministic 20 Hz cadence.
- **Data ingestion:** [`js/src/data/missionDataLoader.js`](../../js/src/data/missionDataLoader.js) parses the M0 CSVs without external dependencies, loads autopilot JSON payloads, estimates their durations, and assembles checklist maps consumed by the runtime.
- **Scheduler loop:** [`js/src/sim/eventScheduler.js`](../../js/src/sim/eventScheduler.js) transitions events through `pending → armed → active → complete/failed`, applies success/failure effects into the resource system, and emits GET-stamped log entries that backstop the upcoming HUD.
- **Checklist management:** [`js/src/sim/checklistManager.js`](../../js/src/sim/checklistManager.js) binds crew procedures to active events, auto-advancing step acknowledgement on a deterministic cadence while logging metrics for manual override tooling.
- **Resource feedback:** [`js/src/sim/resourceSystem.js`](../../js/src/sim/resourceSystem.js) models aggregate power margin, cryo boiloff drift, Passive Thermal Control state, and baseline consumable budgets while logging hourly snapshots to quantify divergence when PTC is skipped. The system now also records minute-resolution history buffers (`historySnapshot()`) for power, propellant, thermal, and communications metrics so trend widgets can render the same telemetry used by the HUD and scoring hooks.
- **Autopilot runner:** [`js/src/sim/autopilotRunner.js`](../../js/src/sim/autopilotRunner.js) replays the JSON guidance scripts, logs attitude/ullage/throttle commands, and applies SPS/LM/RCS propellant consumption into the shared resource model so burn metrics surface for HUD/scoring modules.
- **Orbit propagator:** [`js/src/sim/orbitPropagator.js`](../../js/src/sim/orbitPropagator.js) integrates two-body motion via RK4, switches patched-conic segments, accumulates Δv impulses from autopilot completion summaries, and publishes periapsis/apoapsis/period telemetry and history samples for the HUD and Navigation view.
- **Manual actions:** [`js/src/sim/manualActionQueue.js`](../../js/src/sim/manualActionQueue.js) replays scripted manual inputs—checklist acknowledgements, resource deltas, and propellant burns—so regression runs can mimic human intervention deterministically.
- **Logging:** [`js/src/logging/missionLogger.js`](../../js/src/logging/missionLogger.js) streams mission events to stdout and can export the run to JSON for deterministic replay validation once the HUD arrives.

### Known Gaps Before M1 Completion
- Manual action scripts now cover checklist overrides and resource deltas, and the CLI can record auto crew acknowledgements into reusable scripts; the parity harness in [`js/src/tools/runParityCheck.js`](../../js/src/tools/runParityCheck.js) replays those recordings, highlights event/resource/autopilot diffs, and now compares event timelines—next steps hook its reports into automated regression gating.
- Consumable budgets seed the resource model, yet PAD-driven deltas and long-horizon trending analytics still need to be wired into the scheduler for scoring.
- Failure hooks now capture the taxonomy metadata (classification, penalties, recovery actions) from `failures.csv`, and the scheduler consumes `failure_cascades.json` to apply resource penalties and arm recovery events when faults latch. Continue expanding cascade coverage as additional failure modes are ingested.
- Autopilot runner currently assumes constant mass-flow rates per propulsion system; calibrate against PAD timelines and hook tolerances into the failure taxonomy so underburn/overburn conditions propagate meaningfully.
- Deterministic log replay/regression tooling is not yet capturing frame-by-frame state, leaving validation to manual CLI runs.

## Validation & Testing
- **Determinism Check:** Run the same 6-hour mission slice twice and confirm byte-identical state logs.
- **Resource Drift Test:** Simulate PTC off vs. on and verify expected divergence in cryo/power reserves after 3 hours.
- **Event Ordering Test:** Ensure prerequisites prevent out-of-order activation by injecting deliberate delays.
- **Failure Trigger Test:** Force the PTC failure condition and validate that downstream events (e.g., "Shedding Loads") arm correctly.

Passing these validations signals readiness to move into Milestone M2 for guidance and docking mechanics.
