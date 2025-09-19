# Resource System & Consumables Model

The resource system tracks the Apollo 11 stack's electrical, thermal, propellant,
life-support, and communications states so mission events, manual actions, and
UI layers consume a single source of truth. It absorbs dataset baselines from
Milestone M0, reconciles propellant draw with Δv budgets, records failure
cascades, and exposes history buffers that satisfy the telemetry obligations in
the project plan.

## Responsibilities

- Maintain the authoritative resource state vector (power, propellant, life
  support, communications, Δv margins, Passive Thermal Control status, failure
  registry) and expose immutable snapshots for downstream systems.【F:js/src/sim/resourceSystem.js†L1-L211】【F:js/src/sim/resourceSystem.js†L594-L655】
- Track derived metrics such as propellant deltas, power load changes, and
  Δv usage/recovery totals for scoring, HUD alerts, and regression artefacts.【F:js/src/sim/resourceSystem.js†L82-L139】【F:js/src/sim/resourceSystem.js†L602-L611】
- Sample rolling history buffers (power, thermal, communications, propellant)
  for Systems view trend widgets and exported HUD fixtures.【F:js/src/sim/resourceSystem.js†L90-L139】【F:js/src/sim/resourceSystem.js†L612-L666】
- Surface deterministic logs when state changes occur so mission replays and
  parity tooling retain provenance for every adjustment.【F:js/src/sim/resourceSystem.js†L486-L522】【F:js/src/sim/resourceSystem.js†L1194-L1231】

## Initialization & Data Sources

`createSimulationContext` seeds the resource system with mission datasets:

- Consumables budgets initialise tank loads, battery SOC, and life-support
  inventories using `docs/data/consumables.json` values (power outputs, reserve
  propellant masses, oxygen/water stocks).【F:js/src/sim/simulationContext.js†L34-L76】【F:docs/data/consumables.json†L1-L42】
- Communications schedules derive from
  `docs/data/communications_trends.json`, enabling Deep Space Network pass
  tracking, handover metadata, and power deltas.【F:js/src/sim/simulationContext.js†L34-L76】【F:docs/data/communications_trends.json†L1-L27】
- The failure taxonomy in `docs/data/failures.csv` populates the resource
  failure catalog so events can latch cascading penalties with historical
  context.【F:js/src/sim/simulationContext.js†L34-L76】【F:docs/data/failures.csv†L1-L20】

Mission data loading is handled by `loadMissionData`, which parses the CSV/JSON
packs referenced above before `createSimulationContext` constructs the
`ResourceSystem` instance.【F:js/src/data/missionDataLoader.js†L1-L88】

## Runtime State & History

The constructor normalises options (log cadence, history sampling, initial
state overrides), clones the default state template, and records whether history
buffers should capture telemetry.【F:js/src/sim/resourceSystem.js†L1-L139】 When
history is enabled, the system immediately stores a sample so HUD exports begin
with a baseline reading.【F:js/src/sim/resourceSystem.js†L132-L139】

`update(dtSeconds, getSeconds)` runs every simulation tick to model Passive
Thermal Control drift/recovery, advance communications schedules, capture
history samples, and emit periodic "Resource snapshot" log entries. Drift rates
penalise power margin and cryogenic boil-off when PTC is unstable; recovery
rates reverse the trend once the state returns to `PTC_STABLE`/`PTC_TUNED`.【F:js/src/sim/resourceSystem.js†L400-L525】

Snapshots expose deep-cloned state, budgets, failure entries, metrics, and
history metadata. `historySnapshot()` returns the rolling buffers so the UI and
export tools can embed the same telemetry without touching the live state.【F:js/src/sim/resourceSystem.js†L594-L666】

## Propellant & Δv Budgets

Consumable configuration builds stage metadata for the CSM SPS, LM descent, and
LM ascent systems, mapping tanks to Δv budgets. As propellant changes arrive,
`ResourceSystem` recalculates base and margin values per stage and clamps them
against usable Δv thresholds to keep the Always-On HUD in sync with fuel
reserves.【F:js/src/sim/resourceSystem.js†L140-L367】

`recordPropellantUsage()` normalises tank keys, validates availability, updates
state, and logs deltas; it also feeds derived Δv metrics so scoring and HUD
consumers can distinguish between used and recovered margin.【F:js/src/sim/resourceSystem.js†L511-L585】【F:js/src/sim/resourceSystem.js†L1206-L1250】 Autopilot throttle
integrators, ullage windows, RCS controllers, and manual action scripts all call
this helper, ensuring scripted burns and player-driven translations subtract
propellant through the same accounting path.【F:js/src/sim/autopilotRunner.js†L520-L608】【F:js/src/sim/rcsController.js†L160-L214】【F:js/src/sim/manualActionQueue.js†L240-L302】

Delta-V margin adjustments can also arrive via event effects (e.g., PAD updates
or planner interventions). `#adjustDeltaVStage` and `#applyDeltaVMarginDelta`
convert requested adjustments into stage-specific margin changes, record usage
or recovery totals, and emit log entries referencing the source event for audit
trails.【F:js/src/sim/resourceSystem.js†L1048-L1167】

## Effects & Failure Tracking

Mission events, manual actions, and failure cascades apply structured effects to
the resource system. `applyEffect()` walks nested objects, updates primitive
fields (accumulating deltas for metrics), and handles special cases such as
failure IDs or Δv adjustments.【F:js/src/sim/resourceSystem.js†L212-L382】 Events
call this helper on success/failure so checklist outcomes can trim margins,
latched faults, or restore reserves in line with the mission plan.【F:js/src/sim/eventScheduler.js†L180-L236】

Failures are latched through `recordFailure()`, which normalises IDs, merges
catalog metadata, tracks first/last occurrence GET stamps, records notes, and
emits log entries for mission archives and HUD fault lanes.【F:js/src/sim/resourceSystem.js†L336-L466】 The resulting entries are
mirrored into resource snapshots, giving Systems view panels the classification,
penalty, and recovery guidance needed to visualise cascading issues.【F:js/src/sim/resourceSystem.js†L594-L655】

## Communications Scheduling

Communications schedules are normalised into timeline entries with GET open/close
seconds, station metadata, signal strength, handover intervals, and power deltas
for each Deep Space Network pass.【F:js/src/sim/resourceSystem.js†L140-L211】【F:js/src/sim/resourceSystem.js†L1256-L1389】 During `update()`, the resource
system locates the active pass, toggles state flags, applies temporary fuel-cell
load adjustments, tracks time remaining/progress, and records immediate history
samples so telemetry widgets reflect handovers in real time.【F:js/src/sim/resourceSystem.js†L1186-L1320】 When a pass ends the
power delta is unwound and the next scheduled window is surfaced to HUD
consumers, matching the progression data captured in the communications trends
pack.【F:js/src/sim/resourceSystem.js†L1321-L1412】

## Integration Points

- `Simulation.run()` updates the resource system every tick before HUD refreshes,
  ensuring event schedulers, manual queues, and score trackers consume the same
  resource state.【F:js/src/sim/simulation.js†L22-L87】
- `UiFrameBuilder` pulls `snapshot()`/`historySnapshot()` outputs to populate the
  Always-On HUD, Systems trend panes, propellant bars, and failure log sections
  documented in the UI plan.【F:js/src/hud/uiFrameBuilder.js†L40-L128】
- `ScoreSystem.summary()` derives commander rating inputs (minimum power/Δv
  margins, propellant usage, resource failure IDs) from the resource system’s
  metrics, aligning scoring telemetry with HUD reporting.【F:js/src/sim/scoreSystem.js†L120-L198】
- Autopilot and manual action flows consume shared propellant accounting, while
  the RCS controller forwards pulse usage to the same metrics, guaranteeing parity
  between automated and player-driven manoeuvres.【F:js/src/sim/autopilotRunner.js†L520-L608】【F:js/src/sim/manualActionQueue.js†L240-L302】【F:js/src/sim/rcsController.js†L160-L214】
- Mission log aggregation captures the resource snapshots emitted on the log
  cadence, allowing parity harnesses and replay exports to attach deterministic
  consumables traces to each run.【F:js/src/sim/resourceSystem.js†L486-L522】【F:js/src/logging/missionLogAggregator.js†L1-L164】

## Extensibility Notes

- Additional tanks or Δv stages can be registered by extending
  `DELTA_V_STAGE_CONFIG` and providing matching entries in the consumables pack;
  the helper methods automatically build budgets and history channels for new
  stages.【F:js/src/sim/resourceSystem.js†L60-L211】
- Communications modelling can incorporate new pass attributes (e.g., uplink
  latency, antenna modes) by expanding the schedule normalisation helpers and
  history payload without affecting current consumers thanks to the cloned
  snapshot contract.【F:js/src/sim/resourceSystem.js†L1256-L1412】
- When new failure modes arrive, add them to `failures.csv` and feed the catalog
  into the resource system; UI and scoring layers will automatically surface the
  metadata captured during `recordFailure()` runs.【F:js/src/sim/resourceSystem.js†L336-L466】【F:docs/data/failures.csv†L1-L20】

This architecture keeps consumable budgets, Δv planning, DSN coverage, and fault
tracking aligned with the mission datasets, matching the project plan’s demand
for systemic consequences and accessible telemetry.
