# Autopilot Runner & Burn Execution

The autopilot runner turns the timeline-driven scripts authored in
`docs/data/autopilots/` into deterministic propulsion, RCS, and DSKY
activity. It keeps burn execution aligned with the mission scheduler,
resource model, HUD, and scoring layers so automated sequences behave the
same way every time they are replayed.

## Responsibilities

- Load the active event's script, normalise sequencing, and track state
  (throttle, ullage windows, metrics) for each concurrently running
  autopilot.【F:js/src/sim/autopilotRunner.js†L11-L110】
- Advance every active script each tick, dispatching discrete commands
  and integrating continuous effects such as throttle mass flow, ullage
  RCS usage, and burn timers.【F:js/src/sim/autopilotRunner.js†L113-L224】【F:js/src/sim/autopilotRunner.js†L546-L621】
- Accumulate propellant draw, ullage usage, RCS impulse, and DSKY macro
  counts so downstream systems receive authoritative telemetry.【F:js/src/sim/autopilotRunner.js†L400-L499】【F:js/src/sim/autopilotRunner.js†L546-L621】【F:js/src/sim/autopilotRunner.js†L839-L845】
- Emit mission log entries for every engagement, command, and completion
  while producing per-event summaries that capture achieved vs. expected
  metrics and tolerances.【F:js/src/sim/autopilotRunner.js†L46-L161】【F:js/src/sim/autopilotRunner.js†L676-L1235】

## Script Ingestion & Activation

`EventScheduler` hands the runner events as soon as their windows open,
which causes the runner to copy and sort the script sequence, resolve
propulsion metadata, and seed per-event metrics before logging the
engagement.【F:js/src/sim/eventScheduler.js†L133-L161】【F:js/src/sim/autopilotRunner.js†L57-L110】
`start()` guards against duplicate activations and validates that the
script payload exists, writing a failure log when a dataset is
incomplete.【F:js/src/sim/autopilotRunner.js†L37-L55】 Expected burn length
automatically derives from event metadata, explicit script durations, or
sequence contents, keeping the scheduler's timers aligned with automation
runtime.【F:js/src/sim/autopilotRunner.js†L63-L110】【F:js/src/sim/autopilotRunner.js†L702-L723】

Every simulation tick the scheduler calls `update(getSeconds, dt)`,
allowing the runner to process any commands whose script time has elapsed
and then integrate throttle/ullage effects for the interval. Completed
scripts are dropped once their commands, throttle ramps, and ullage
windows have all wound down.【F:js/src/sim/eventScheduler.js†L82-L108】【F:js/src/sim/autopilotRunner.js†L239-L674】

## Command Execution & Integrations

The runner understands the command set defined in the autopilot authoring
guide:

- `attitude_hold` logs the new attitude target for guidance loops.【F:js/src/sim/autopilotRunner.js†L260-L271】
- `ullage_fire` opens a timed ullage window and records the request for
  propellant bookkeeping.【F:js/src/sim/autopilotRunner.js†L272-L285】
- `throttle` and `throttle_ramp` mutate the instantaneous throttle, log
  the change, and set up ramp interpolation so continuous propellant
  consumption is accurate.【F:js/src/sim/autopilotRunner.js†L287-L361】
- `rcs_pulse` delegates to `RcsController`, capturing returned mass,
  impulse, and pulse counts while folding the usage into stage metrics
  and the resource model.【F:js/src/sim/autopilotRunner.js†L363-L424】
- `dsky_entry`/`dsky_macro` normalise the payload, log the AGC
  interaction, and forward it to the manual action recorder so parity
  harnesses can reproduce the exact Verb/Noun sequence.【F:js/src/sim/autopilotRunner.js†L426-L499】【F:js/src/logging/manualActionRecorder.js†L64-L108】

Continuous consumption uses the propulsion profile resolved at start-up.
`#applyContinuousEffects()` integrates throttle for the elapsed timestep,
subtracts mass via `ResourceSystem.recordPropellantUsage()`, and applies
ullage draw when a window overlaps the tick. Mass-flow integrals also
feed throttle-seconds metrics so expected-vs-actual comparisons have the
same units as PAD tolerances.【F:js/src/sim/autopilotRunner.js†L546-L621】【F:js/src/sim/autopilotRunner.js†L608-L619】

## Completion, Summaries & Tolerance Checks

When a script finishes (duration reached, ramps settled, ullage cleared),
`#complete()` logs the outcome, removes the state from the active set,
and stores a summary in `completedEvents`. Summaries include raw metrics
(burn seconds, propellant kg, ullage seconds, RCS usage, delta-v
estimates), the propulsion profile, and deviations from the runner's
precomputed expectations.【F:js/src/sim/autopilotRunner.js†L676-L1235】 The
scheduler consumes these summaries to apply success/failure effects,
report results to HUD consumers, and evaluate tolerances. Deviations that
exceed per-event thresholds immediately trigger a failure reason and
propagate the summary context into mission logs and resource effects.【F:js/src/sim/eventScheduler.js†L176-L217】【F:js/src/sim/eventScheduler.js†L370-L432】

External handlers can subscribe to the same summaries. The default
simulation context registers a handler that forwards achieved Δv into the
orbit propagator so patched-conic state stays in sync with automation
results.【F:js/src/sim/simulationContext.js†L100-L133】 Additional handlers
may generate analytics or update mission dashboards without touching the
runner.

## Telemetry Consumers

`stats()` exposes aggregate counters (active scripts, elapsed burn/ullage
seconds, tank usage, RCS totals, DSKY count, next-command timers) plus a
primary-active summary, enabling HUD widgets to show live progress bars
and remaining timers.【F:js/src/sim/autopilotRunner.js†L169-L224】
`UiFrameBuilder` injects these stats into the `ui_frame` payload so the
Always-On HUD, Navigation burn overlay, and Systems propellant panels can
render automation state with matching PAD metadata.【F:js/src/hud/uiFrameBuilder.js†L71-L135】【F:js/src/hud/uiFrameBuilder.js†L668-L704】

`ScoreSystem.summary()` also samples the stats to report mission-wide
propellant usage and automation health as part of the commander rating,
keeping scoring and HUD telemetry grounded in the same source of truth.【F:js/src/sim/scoreSystem.js†L127-L164】

## Extensibility Notes

- Propulsion defaults (mass flow, ullage tanks) can be tuned via runner
  options, while per-script overrides in the dataset are normalised at
  runtime, simplifying ingestion of new vehicle profiles.【F:js/src/sim/autopilotRunner.js†L702-L837】
- New command types should extend `#executeCommand()` and update the
  authoring guide so validation and tooling remain aligned with the
  runtime vocabulary.【F:js/src/sim/autopilotRunner.js†L256-L452】
- Additional summary consumers can be registered through the scheduler's
  `autopilotSummaryHandlers` list, allowing analytics, replay exporters,
  or CI checks to react to automation results without modifying the
  runner itself.【F:js/src/sim/eventScheduler.js†L12-L35】【F:js/src/sim/eventScheduler.js†L340-L361】

This architecture keeps automated burns authoritative, auditable, and in
lockstep with manual parity tooling, satisfying the project plan's goals
for deterministic guidance and mission-wide telemetry.
