# Failure Breadcrumb Architecture

The failure breadcrumb subsystem distills raw fault latches into short causal
summaries that can surface inside the HUD alert tray, Systems fault log, and
mission log exports without requiring players to parse the full resource state.
It complements the taxonomy published in `docs/data/failures.csv` by attaching
contextual telemetry (PTC status, burn deltas, comm window timing, etc.) to each
failure entry as soon as it is recorded by the simulator.【F:js/src/sim/failureBreadcrumbs.js†L107-L345】【F:docs/data/failures.csv†L1-L40】

## Goals

- **Surface actionable context.** Breadcrumbs translate power/thermal drift,
  burn deviations, and missed comm passes into human-readable summaries that
  highlight root causes and immediate penalties.【F:js/src/sim/failureBreadcrumbs.js†L107-L307】
- **Share a deterministic payload.** Both the CLI HUD and future UI layers rely
  on the same summary/chain structure, ensuring alerts remain consistent across
  presentation targets.【F:js/src/hud/uiFrameBuilder.js†L941-L986】
- **Support regression tooling.** Mission logs and parity reports inherit the
  breadcrumb metadata, enabling automated checks to reason about cascading
  failures without replaying raw telemetry.【F:js/src/sim/resourceSystem.js†L459-L488】

## Inputs & Data Sources

1. **Failure taxonomy.** The CSV catalog supplies classification, trigger text,
   immediate/ongoing penalties, and recovery guidance for every fault. The
   breadcrumb generator reuses this metadata when no specialized handler exists
   for a failure ID.【F:docs/data/failures.csv†L1-L40】【F:js/src/sim/failureBreadcrumbs.js†L309-L325】
2. **Resource state.** Snapshot values (power margin, cryo boil-off rate,
   communications schedule, Δv stages) provide the numeric inputs rendered in
   breadcrumb chains.【F:js/src/sim/failureBreadcrumbs.js†L107-L307】
3. **Autopilot summaries.** When burns finish, the autopilot runner forwards
   achieved vs. expected metrics so burn-related failures can report Δv shortfall
   and remaining stage margins alongside the taxonomy text.【F:js/src/sim/failureBreadcrumbs.js†L166-L250】

## Generator Map

`createFailureBreadcrumb` uses a lookup table to dispatch failure IDs to the
appropriate formatter. PTC drift and skipped barbecue roll sequences flow into
`buildPtcBreadcrumb`, burn shortfalls use `buildBurnBreadcrumb`, missed Deep
Space Network passes trigger `buildCommunicationsBreadcrumb`, and any unhandled
ID falls back to a simple taxonomy-based summary.【F:js/src/sim/failureBreadcrumbs.js†L309-L364】

## Specialized Breadcrumbs

- **PTC drift / missed activation.** The generator inspects the thermal state,
  cryogenic boil-off, and power margin to narrate how delayed Passive Thermal
  Control impacts consumables, emitting chain entries that show boil-off and
  power trends at a glance.【F:js/src/sim/failureBreadcrumbs.js†L107-L163】
- **Burn deviations.** Burn breadcrumbs synthesize autopilot deviation metrics,
  stage-specific Δv margins, and overall reserve to highlight whether the crew is
  consuming emergency budget or skipping corrections entirely.【F:js/src/sim/failureBreadcrumbs.js†L166-L250】
- **Communications misses.** DSN failures report the missed station, current
  signal strength, power margin delta, and time until the next window so operators
  can decide whether to shed loads or reschedule PAD deliveries.【F:js/src/sim/failureBreadcrumbs.js†L253-L307】
- **Fallback path.** Unknown or taxonomy-only failures return a concise summary
  built from the catalog metadata or failure notes, guaranteeing that every fault
  still exposes a breadcrumb object.【F:js/src/sim/failureBreadcrumbs.js†L309-L364】

Each breadcrumb emits a `summary` string for the HUD’s alert chip and a `chain`
array with structured entries (label, value, trend, raw numbers) that the Systems
pane can render as a causal walkthrough.【F:js/src/sim/failureBreadcrumbs.js†L127-L244】

## Resource System Integration

`ResourceSystem.recordFailure()` calls `createFailureBreadcrumb` whenever it
latches or updates a failure. The generated summary is stored alongside the
failure entry, logged with the taxonomy metadata, and exposed through
`snapshot()` so downstream consumers receive the breadcrumb on the next HUD
frame.【F:js/src/sim/resourceSystem.js†L459-L488】

## HUD & Export Consumption

`UiFrameBuilder` clones the breadcrumb object into every HUD frame, placing it in
`frame.alerts.failures[]` and the fault log data so the Navigation/Systems views
can render the summary text and causal chain without touching the live resource
state.【F:js/src/hud/uiFrameBuilder.js†L941-L986】 Mission log exports and parity
reports inherit the same object graph, keeping regression artefacts aligned with
what players see in real time.【F:js/src/tools/exportUiFrames.js†L31-L124】

## Extending the System

1. Add the new failure to `docs/data/failures.csv` with trigger text, penalties,
   and recovery guidance.
2. Implement a specialized generator (or reuse an existing one) inside
   `failureBreadcrumbs.js`, registering it in the `GENERATORS` table.
3. Ensure the subsystem that detects the failure passes any additional context
   (e.g., propellant tank key, communications window details) so the breadcrumb
   can render useful metrics.
4. Run the mission validator and HUD exporters to confirm the breadcrumb appears
   in simulator logs and UI frames.
