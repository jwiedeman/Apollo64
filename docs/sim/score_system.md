# Score System & Commander Rating Runtime

`ScoreSystem` converts raw mission telemetry into the commander rating summary
that ships with every simulation run. The module tracks event completion,
resource margins, manual participation, and communications performance each
simulation tick so the summary and grade reported by the CLI, parity harness,
and upcoming UI remain deterministic across platforms.【F:js/src/sim/scoreSystem.js†L1-L236】

## Responsibilities

- Normalise weighting and tuning knobs (event/resource/fault/manual weights,
power/Δv/thermal thresholds, tracking epsilon) when constructed so score outputs
reflect project-plan targets without ad-hoc constants scattered around the
engine.【F:js/src/sim/scoreSystem.js†L1-L68】
- Subscribe to the mission subsystems—`ResourceSystem`, `EventScheduler`,
`AutopilotRunner`, checklist manager, and optional manual queue—and reattach if
those dependencies change while a run is in progress.【F:js/src/sim/scoreSystem.js†L25-L125】
- Maintain aggregate event and communications counts, keeping comms-specific
completion rates available for telemetry widgets and progression unlock checks.【F:js/src/sim/scoreSystem.js†L51-L307】
- Track minimum/maximum power and Δv margins plus thermal violation windows
from the resource state every tick, recording how long cryogenic boil-off rates
exceeded thresholds so thermal penalties mirror milestone requirements.【F:js/src/sim/scoreSystem.js†L310-L339】
- Convert resource/fault/manual metrics into weighted scores, combine them with
the base weighting, apply the manual bonus, and emit commander ratings with the
full breakdown (event/resource/fault/manual scores, base vs. bonus, grade).【F:js/src/sim/scoreSystem.js†L127-L236】【F:js/src/sim/scoreSystem.js†L341-L451】【F:js/src/sim/scoreSystem.js†L468-L479】

## Update Flow

`update(getSeconds, dt, context)` runs every simulation tick. It refreshes any
provided subsystem references, derives `dtSeconds` when callers omit it, and
records the current mission duration. The method initialises event/comms
counters on first run, updates resource metrics, and then inspects scheduler
state changes to keep completion/failure counts aligned with the live
timeline.【F:js/src/sim/scoreSystem.js†L79-L339】

The event initialisation path scans the scheduler’s event list once, seeding the
status map and comms totals. Subsequent updates only react when an event’s
status changes, preventing double counting as the mission advances.【F:js/src/sim/scoreSystem.js†L240-L339】

## Summary Output

Calling `summary()` returns the commander rating payload consumed by the CLI,
parity harness, and UI frame builder. The structure includes:

- Mission duration, event totals, pending counts, and completion percentages.
- Communications hit rate derived from comm-tagged events.
- Resource snapshot (min/max power %, min/max Δv margin, thermal violation
time and counts, rounded propellant/power deltas).
- Fault aggregates (event failures plus unique resource failure IDs).
- Manual step totals and fractional participation.
- Rating block containing base score, manual bonus, commander score, grade, and
per-weight breakdowns alongside the latest autopilot statistics.【F:js/src/sim/scoreSystem.js†L127-L236】

Manual-only fields (manual fraction, bonus, grade) allow parity tooling to
ignore expected differences between automated and manual replays while still
surfacing manual participation for scoring and unlock logic.

## Scoring Helpers

Utility methods keep scoring deterministic and clamped:

- `#normalizeHighIsGood`, `#normalizeDeltaV`, and `#normalizeLowIsGood` convert
raw metrics into 0–1 scores using tuned thresholds for power, Δv, and thermal
states.【F:js/src/sim/scoreSystem.js†L341-L435】
- `#computeFaultScore` penalises missions relative to the configurable fault
baseline, collapsing both event failures and resource alerts into a single
metric.【F:js/src/sim/scoreSystem.js†L153-L156】【F:js/src/sim/scoreSystem.js†L341-L376】
- `#computePropellantUsage` and `#roundEntries` ensure resource deltas only
surface meaningful figures, trimming noise below the configured epsilon.【F:js/src/sim/scoreSystem.js†L437-L466】
- `#grade(score)` maps commander scores to letter grades (`A`–`F`), keeping
grading consistent for progression and UI displays.【F:js/src/sim/scoreSystem.js†L468-L479】

## Integration Points

- `Simulation.run()` calls `summary()` at halt, logging the commander rating and
making the data available to the CLI, parity harness, and mission log exports.
- `UiFrameBuilder` embeds the same payload inside each `ui_frame`, enabling the
HUD scorecard widgets and progression pop-ups defined in the UI planning
documents.
- `ProgressionService.evaluateRun()` consumes the commander score, fault totals,
manual fraction, and resource minima recorded by the score system, so keeping
this module deterministic is critical for unlock parity.【F:js/src/sim/progressionService.js†L154-L221】

This runtime contract ensures the project’s scoring pillar—discipline under time
pressure with transparent consequences—remains anchored to deterministic
telemetry throughout the simulator.
