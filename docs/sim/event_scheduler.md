# Event Scheduler & Mission Timeline Control

The event scheduler advances the Apollo 11 mission plan, gating each timeline
entry on prerequisites, checklist progress, and automation results so the
simulation stays synchronized with mission data, resource effects, and HUD/score
consumers.

## Responsibilities

- Normalise mission events at construction time, resolving autopilot scripts,
  checklist availability, expected durations, and PAD references before the
  timeline begins advancing.【F:js/src/sim/eventScheduler.js†L11-L57】
- Drive the pending → armed → active → complete/failed state machine every tick,
  updating checklists and autopilot runners in lockstep with the mission
  clock.【F:js/src/sim/eventScheduler.js†L82-L217】
- Apply mission effects and propagate autopilot summaries/failures so resource
  budgets, fault logs, and downstream analytics reflect the current event
  outcome.【F:js/src/sim/eventScheduler.js†L200-L337】
- Publish timeline telemetry (counts, upcoming events, activation/completion
  GET) and allow external subscribers to react to autopilot
  completions.【F:js/src/sim/eventScheduler.js†L250-L361】

## Event Preparation & Duration Estimation

`prepareEvent()` inspects each dataset entry, resolves the autopilot ID from the
mission pack, checks whether an associated checklist exists, and caches metadata
such as PAD IDs and duration requirements. Duration heuristics fall back to the
checklist manager's estimates or window-based timing when explicit values are not
provided, ensuring both manual and automated procedures acquire sensible timers
for completion checks.【F:js/src/sim/eventScheduler.js†L37-L80】

## Tick Loop & State Machine

Each call to `update()` advances checklists (if present), then walks the event
list to arm entries once prerequisites and GET windows open, activate them when
execution begins, and monitor for completion or timeout. Autopilot runners are
updated alongside the loop so scripted burns progress while events wait for
checklist confirmation or timer gates.【F:js/src/sim/eventScheduler.js†L82-L217】
`arePrerequisitesComplete()` verifies upstream events finished before arming,
preventing downstream procedures from starting early.【F:js/src/sim/eventScheduler.js†L236-L248】

## Checklist, Autopilot, and Resource Integrations

Activating an event notifies the checklist manager so timed procedures inherit
window metadata, and launches the relevant autopilot script when one is
available.【F:js/src/sim/eventScheduler.js†L142-L160】 Upon completion, the
scheduler finalizes the checklist, applies success effects to the resource
system, and emits autopilot summaries to registered observers, keeping Δv,
propellant, and PAD analytics synchronized across systems.【F:js/src/sim/eventScheduler.js†L193-L217】
`Simulation.run()` invokes `scheduler.update()` before resource and HUD refreshes
so every downstream consumer operates on the latest event state.【F:js/src/sim/simulation.js†L34-L141】

## Failure Handling & Tolerance Enforcement

Window expiry calls `maybeFail()` to abort events that missed their close
threshold, while explicit failure paths funnel through `failEvent()` to log the
outcome, abort automation if required, attach autopilot summaries, and apply
failure effects to the resource system and checklist manager.【F:js/src/sim/eventScheduler.js†L220-L337】
Automation results pass through `evaluateAutopilotTolerance()`, which compares
burn duration, propellant usage, and Δv deviations against per-script tolerances
and triggers failures when metrics drift beyond allowed thresholds—preserving the
mission plan's fidelity targets.【F:js/src/sim/eventScheduler.js†L370-L512】

## Telemetry & External Hooks

`scheduler.stats()` exposes aggregate status counts, a capped list of upcoming
windows, and activation/completion GET stamps for UI frames and mission
summaries.【F:js/src/sim/eventScheduler.js†L250-L295】 `registerAutopilotSummaryHandler()`
and `#emitAutopilotSummary()` allow external systems—such as the orbit
propagator hook registered in `createSimulationContext()`—to subscribe to burn
summaries without mutating scheduler internals.【F:js/src/sim/eventScheduler.js†L31-L361】【F:js/src/sim/simulationContext.js†L100-L133】
`getEventById()` exposes the normalized event map for HUD widgets, scoring, and
testing utilities that need direct access to mission metadata.【F:js/src/sim/eventScheduler.js†L363-L368】

## Extensibility Notes

Tolerance helpers coerce numeric strings, support both metric and imperial Δv
limits, and return structured deviation metadata so future analytics can display
per-metric drift with minimal additional wiring.【F:js/src/sim/eventScheduler.js†L370-L512】
New automation consumers can register summary handlers when building the
simulation context, letting additional analytics modules react to burn results in
parallel with the orbit propagator.【F:js/src/sim/eventScheduler.js†L31-L361】【F:js/src/sim/simulationContext.js†L100-L133】
This architecture keeps mission timeline control deterministic while satisfying the
project plan's requirement for systemic consequences tied to event execution.
