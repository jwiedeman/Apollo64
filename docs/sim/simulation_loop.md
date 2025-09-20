# Simulation Loop & Context Assembly

This reference explains how the mission simulation is wired together inside the
JavaScript prototype. It focuses on the `createSimulationContext` helper that
assembles every subsystem from the mission datasets and the `Simulation` runner
that advances the fixed-step loop at 20 Hz.

## Context Builder Responsibilities

`createSimulationContext` loads the committed mission datasets, instantiates the
subsystems that consume them, and returns a bundle with the configured
`Simulation` plus each component that higher-level tooling might need.【F:js/src/sim/simulationContext.js†L31-L213】 The helper:

- Resolves the data directory, pulls the mission packs, and prepares a mission
  log aggregator for downstream HUD/logging consumers.【F:js/src/sim/simulationContext.js†L31-L55】
- Builds the audio pipeline (cue binder, null mixer, dispatcher) so scheduler,
  checklist, resource, and HUD layers can enqueue cues during the run.【F:js/src/sim/simulationContext.js†L50-L70】
- Creates checklist, resource, RCS, AGC, and autopilot modules, wiring in shared
  dependencies such as the manual action recorder and the audio binder.【F:js/src/sim/simulationContext.js†L57-L83】
- Configures orbital propagation and the text HUD/`UiFrameBuilder`, passing along
  mission metadata needed for overlays and UI exports.【F:js/src/sim/simulationContext.js†L85-L101】
- Optionally constructs a `ManualActionQueue` from inline actions or a recorded
  script so parity runs can replay deterministic crew inputs.【F:js/src/sim/simulationContext.js†L103-L120】
- Registers orbit-propagation hooks that apply Δv from completed autopilot
  summaries, keeping the propagator synchronized with executed burns.【F:js/src/sim/simulationContext.js†L122-L142】
- Instantiates the event scheduler with autopilot, failure, checklist, and audio
  bindings, and prepares the score system to track commander rating inputs.【F:js/src/sim/simulationContext.js†L144-L164】
- Returns every configured subsystem alongside the `Simulation`, audio mixer,
  and caller-facing options so tooling (CLI runner, exporters, parity harnesses)
  can reuse the shared state without reinitializing it.【F:js/src/sim/simulationContext.js†L166-L213】

## Tick Cadence & Clock

The `Simulation` constructor creates a `SimulationClock` that stores the current
GET, tick rate, and derived `dt` in seconds.【F:js/src/sim/simulation.js†L4-L37】【F:js/src/sim/simulationClock.js†L1-L15】 Each
call to `advance()` moves the clock forward by `dt`, preserving deterministic
time steps for every subsystem.【F:js/src/sim/simulationClock.js†L1-L15】

## Frame Update Order

`Simulation.run()` advances the mission until the requested GET, executing the
subsystems in a strict order each tick so side effects remain predictable:

1. Replay any queued manual actions for the current tick.【F:js/src/sim/simulation.js†L44-L48】
2. Step the event scheduler to trigger new events, autopilot scripts, and
   checklist activity.【F:js/src/sim/simulation.js†L49-L50】
3. Update the orbit propagator, advancing position history and logging planned
   vs. actual trajectories.【F:js/src/sim/simulation.js†L50-L52】
4. Update the resource system so consumables, communications windows, failures,
   and Δv margins stay in sync with active events.【F:js/src/sim/simulation.js†L53-L53】
5. Invoke the score system to capture mission rating metrics for the current
   tick, using scheduler/resource/manual state as inputs.【F:js/src/sim/simulation.js†L54-L61】
6. Drain the audio dispatcher, giving it the cue binder’s queue for the frame.【F:js/src/sim/simulation.js†L63-L64】
7. Refresh the HUD/Text HUD using aggregated scheduler, resource, autopilot,
   checklist, manual queue, RCS, AGC, score, orbit, log, and audio state.【F:js/src/sim/simulation.js†L66-L80】
8. Invoke an optional `onTick` callback for instrumentation or early exits.【F:js/src/sim/simulation.js†L82-L103】
9. Advance the simulation clock by one tick before repeating.【F:js/src/sim/simulation.js†L104-L105】

This ordering ensures manual actions and scheduler effects are applied before
resource accounting, audio dispatch, and HUD refreshes, mirroring the intended
simulator data flow.

## Logging & Summary Outputs

When the loop halts, the simulation compiles a snapshot covering event counts,
resource state, checklist/manual/autopilot/AGC/HUD summaries, score results,
orbit metrics, mission log headlines, and audio stats. The logger records the
summary at the final GET and the aggregated data is returned to the caller so
CLI tools or regression harnesses can inspect mission health without re-running
the simulation.【F:js/src/sim/simulation.js†L108-L171】

## Configuration Surface

Callers can adjust tick rate, log intervals, checklist automation, manual action
sources, HUD options, orbit tuning, and more via the `createSimulationContext`
parameters. The helper also echoes key configuration choices—like checklist
automation, manual script path, and the number of seeded manual actions—inside
the returned options block for telemetry and logging purposes.【F:js/src/sim/simulationContext.js†L21-L44】【F:js/src/sim/simulationContext.js†L166-L213】
