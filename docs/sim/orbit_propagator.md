# Orbit Propagator & Trajectory Telemetry

The orbit propagator is the deterministic bridge between burn execution, mission
state, and the HUD data contract promised in the project plan. It converts the
simulator's guidance outputs into a continuously updated two-body state vector,
logs the applied Δv history, and exposes orbital elements so Navigation and
Systems views can stay aligned with real-world Apollo telemetry. This reference
documents how the current JS prototype implements the propagator, how it hooks
into the simulation loop, and how UI layers consume the resulting data.

## Goals

- Maintain a high-fidelity two-body solution (Earth or Moon primary) without
  sacrificing determinism or performance on a 20 Hz simulation loop.
- Capture burn impulses from autopilot summaries so Δv accumulation, periapsis
  shifts, and skip-out risks are visible to the HUD and scoring subsystems.
- Provide history buffers and alert metadata that downstream widgets can render
  without re-deriving orbital mechanics.

## Runtime Components

### Propagator lifecycle

`OrbitPropagator` accepts a primary body definition, an initial state, and
history preferences. The constructor normalizes the requested body, seeds the
state vector with the configured position/velocity, resets elapsed time/GET, and
allocates a capped impulse log plus optional history buffer.【F:js/src/sim/orbitPropagator.js†L13-L76】
Default options target an Earth-centered circular parking orbit with samples
collected once per minute (360 entries ≈ six hours) so translation to lunar
segments simply swaps the primary body/state before simulation hand-off.【F:js/src/config/orbit.js†L1-L34】

### Integration loop

Each simulation tick calls `update(dtSeconds, {getSeconds, acceleration})`, which
splits the requested timestep into ≤5 second substeps and applies a classic RK4
integrator with gravity from the active body plus any external acceleration
vector (future gravity assists or manual impulses). Time bookkeeping advances
GET for the current frame, and a history sample is recorded when the cadence
threshold is met.【F:js/src/sim/orbitPropagator.js†L139-L285】【F:js/src/sim/orbitPropagator.js†L344-L398】

### Impulse tracking & orbital elements

`applyDeltaV` resolves direction (explicit vector, frame axis such as prograde,
retrograde, or radial) and adds the impulse to the velocity state while logging
magnitude, frame, metadata, and GET. Metrics retain the running Δv sum and the
most recent impulse; `registerImpulse` allows other subsystems to forward
precomputed vectors into the same machinery. History samples are forced whenever
an impulse lands so burns leave an immediate mark in trend buffers.【F:js/src/sim/orbitPropagator.js†L169-L249】

`summary()` packages the current inertial vectors, derived orbital elements, and
energy metrics, using `computeOrbitalElements` to emit eccentricity, inclination,
RAAN, argument of periapsis, true anomaly, periapsis/apoapsis altitudes, and
orbital period when bound. This snapshot is the canonical source for HUD state
vector cards, trajectory widgets, and regression reports.【F:js/src/sim/orbitPropagator.js†L90-L492】

`historySnapshot()` returns the rolling telemetry buffer (radius, altitude,
speed, km/s) alongside metadata describing the sampling cadence. UI consumers
can pull the buffer directly or rely on the frame builder to attach it when
requested.【F:js/src/sim/orbitPropagator.js†L126-L285】

## Simulation Integration

- **Autopilot hand-off:** `createSimulationContext()` registers an
  `autopilotSummaryHandler` that inspects each completed burn, extracts its Δv,
  and calls `applyDeltaV` with the burn completion GET and autopilot metadata so
the propagator mirrors the executed maneuver log.【F:js/src/sim/simulationContext.js†L100-L156】
- **Main loop:** `Simulation.run()` advances the propagator every tick (after the
  scheduler processes events) and forwards the propagator instance to the HUD
  update so frame builders can access summaries and history without touching the
  integrator directly.【F:js/src/sim/simulation.js†L34-L101】
- **Final summaries:** When a run halts, the simulation logs the propagator
  summary alongside event/resource stats, giving parity harnesses and future CI
  jobs a deterministic record of orbit state for comparisons.【F:js/src/sim/simulation.js†L93-L142】

## UI & Telemetry Consumption

`UiFrameBuilder` calls `orbit.summary()` (or consumes a cached summary supplied
by callers), converts the numeric fields into display-friendly units, attaches
history samples when available, and merges any periapsis warnings or failures
into the global alert buckets before returning the `frame.trajectory` payload.【F:js/src/hud/uiFrameBuilder.js†L84-L137】【F:js/src/hud/uiFrameBuilder.js†L582-L666】
The trajectory block is documented in the shared `ui_frame` schema so Navigation
view widgets can render altitude, speed, orbital period, and Δv totals without
inspecting raw propagator state.【F:docs/ui/ui_frame_reference.md†L191-L214】

Navigation bindings treat `frame.trajectory` as the authoritative state vector
while `trajectoryStream` (a planned high-frequency sample feed) handles canvas
interpolation. The state vector panel, timeline ribbon, and burn overlay all
reference this block alongside autopilot metadata and PAD entries to keep
procedures aligned with mission truth.【F:docs/ui/view_data_bindings.md†L16-L52】

Periapsis guard bands inside the frame builder translate the propagator’s
periapsis altitude into caution (`≤120 km`), warning (`≤85 km`), or failure
(below the body surface) alerts that surface in the Always-On HUD lamp stack and
Systems trend panels, ensuring reentry corridor and lunar orbit margins remain
visible to operators.【F:js/src/hud/uiFrameBuilder.js†L608-L666】

## Extensibility Notes

- **Body transitions:** `setPrimaryBody()` and `setState()` support switching to
  lunar SOI or free-return trajectories mid-run; future mission slices can call
  these helpers when scheduler events hand the stack to the Moon or Earth return
  frame.【F:js/src/sim/orbitPropagator.js†L53-L78】
- **External forces:** The `acceleration` argument on `update()` leaves room for
  drag approximations during entry or third-body perturbations in later
  milestones without destabilizing the deterministic integrator.【F:js/src/sim/orbitPropagator.js†L139-L167】
- **Telemetry exports:** Because history samples retain GET stamps and speed/alt
  traces, export tools (e.g., `exportUiFrames`) can bundle the same data for UI
  prototyping, accessibility reviews, or notebook analysis without replaying the
  simulation.

This architecture keeps trajectory truth synchronized across autopilot logs,
HUD widgets, and regression tooling, satisfying the project plan's requirement
for orbit/entry fidelity while leaving hooks for multi-body refinements during
later milestones.
