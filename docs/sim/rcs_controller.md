# RCS Controller Architecture & Thruster Integration

The `RcsController` turns the mission thruster catalog into deterministic reaction-control pulses for autopilot scripts, manual action queues, and upcoming UI interactions. It normalizes thruster geometry, computes propellant draw and impulse totals, feeds those deltas into the resource model, and exposes summary metrics for HUD and scoring consumers.【F:js/src/sim/rcsController.js†L10-L239】

## Responsibilities
- Ingest the shared thruster dataset, capturing craft defaults, cluster membership, translation/torque axes, and per-thruster performance metadata so subsequent pulses can resolve authoritative geometry without re-reading JSON at runtime.【F:js/src/sim/rcsController.js†L242-L315】【F:docs/data/thrusters.json†L2-L160】
- Execute quantized RCS pulses on demand, selecting thrusters by craft, axis, torque requirement, or explicit ID list, applying duty-cycle/impulse guards, and calculating aggregate mass and impulse totals for the selected jets.【F:js/src/sim/rcsController.js†L52-L223】【F:js/src/sim/rcsController.js†L317-L373】
- Record propellant usage against the appropriate tank and emit structured mission log entries so resource margins, failure cascades, and parity harnesses stay aligned with manual and automated firings.【F:js/src/sim/rcsController.js†L175-L223】【F:js/src/sim/resourceSystem.js†L529-L573】
- Maintain cumulative metrics (mass, pulses, impulse, usage by tank/craft/axis) that downstream HUD and analytics layers can sample via `stats()` snapshots.【F:js/src/sim/rcsController.js†L229-L239】【F:js/src/sim/rcsController.js†L404-L422】

## Thruster Dataset Ingestion
The controller consumes `docs/data/thrusters.json`, which lists each vehicle, default thrust/ISP/impulse values, and every RCS cluster with labeled translation and torque axes.【F:docs/data/thrusters.json†L2-L160】 During construction the controller normalizes identifiers, stores craft-level defaults, associates tanks, and indexes thrusters by craft, translation axis, and torque axis for fast lookups.【F:js/src/sim/rcsController.js†L242-L315】 This preprocessing lets runtime pulses resolve the proper jets even when scripts only specify a body axis or rely on vehicle defaults.

## Pulse Execution Pipeline
When a pulse request arrives (from an autopilot command or the manual queue), the controller:
1. Normalizes craft IDs, axis strings, tank keys, thruster ID lists, counts, durations, duty cycles, and optional limits.【F:js/src/sim/rcsController.js†L52-L111】
2. Resolves candidate thrusters using explicit IDs when provided, otherwise by intersecting translation/torque axes and narrowing to the requested craft where possible.【F:js/src/sim/rcsController.js†L317-L373】
3. Calculates effective impulse duration per thruster by combining dataset defaults with per-command overrides and duty cycle constraints, rejecting thrusters lacking valid thrust/ISP data.【F:js/src/sim/rcsController.js†L112-L148】
4. Integrates mass flow and impulse for each selected thruster, accumulating totals for the pulse batch.【F:js/src/sim/rcsController.js†L137-L149】
5. Applies resource updates and metrics when propellant mass was consumed, otherwise logs diagnostic warnings for unresolved geometry or zero-duration pulses.【F:js/src/sim/rcsController.js†L151-L223】

### Propellant Accounting & Logging
Successful pulses call `ResourceSystem.recordPropellantUsage()` with normalized tank keys, the consumed mass, and contextual metadata (event ID, craft, axis, duty cycle).【F:js/src/sim/rcsController.js†L175-L189】【F:js/src/sim/resourceSystem.js†L529-L573】 The controller logs both failures (no thrusters, zero mass) and successful firings with severity-tagged entries so mission logs, HUD alerts, and parity exports capture the same chronology.【F:js/src/sim/rcsController.js†L80-L223】

## Telemetry & Metrics
`stats()` exposes total pulses, impulse, mass, usage per tank/craft, axis pulse counts, and catalog sizes so HUD widgets and analytics can render RCS consumption trends without re-deriving them from the raw mission log.【F:js/src/sim/rcsController.js†L229-L239】【F:js/src/sim/rcsController.js†L404-L422】 Because metrics aggregate every executed pulse, they naturally align with manual vs. auto parity checks and scoring deltas that sample the same counters.

## Integration Points
The simulation context wires the controller alongside the resource system and autopilot runner, ensuring thruster geometry is available before scripts execute and that propellant deltas immediately affect mission state.【F:js/src/sim/simulationContext.js†L53-L156】 Autopilot `rcs_pulse` commands delegate to `executePulse`, forwarding craft/axis metadata and harvesting mass, impulse, and pulse counts for burn summaries and scoring metrics.【F:js/src/sim/autopilotRunner.js†L340-L420】 Manual action queue entries can invoke the same API, and the returned data feeds the resource model, mission logs, and score system in lockstep with automated maneuvers.

## Authoring & Future Extensions
- Thruster IDs referenced by autopilot scripts or manual tools must match the canonical dataset to avoid skipped pulses; use axes instead of explicit IDs when possible so new geometry refinements do not invalidate scripts.【F:docs/data/thrusters.json†L25-L160】【F:js/src/sim/rcsController.js†L317-L373】
- Upcoming guidance tuning can extend the dataset with refined moment arms, duty-cycle limits, or craft-specific defaults; the controller already respects per-thruster overrides and clamps user-supplied duty cycles to safe bounds.【F:docs/data/thrusters.json†L18-L24】【F:js/src/sim/rcsController.js†L102-L133】【F:js/src/sim/rcsController.js†L296-L373】
- Additional telemetry (e.g., nozzle temperature or pulse jitter) can be layered onto the metrics accumulator without altering the public API, keeping HUD consumers backwards compatible.【F:js/src/sim/rcsController.js†L404-L422】

By centralizing thruster geometry, pulse execution, and propellant accounting, the controller anchors Milestone M2’s guidance and docking work to a single, deterministic implementation that both automated scripts and future UI layers can trust.
