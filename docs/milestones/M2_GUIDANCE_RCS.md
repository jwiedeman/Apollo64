# Milestone M2 — Guidance, RCS, and Docking Systems

Milestone M2 layers guidance execution, reaction-control modelling, and rendezvous gameplay onto the deterministic core delivered in M1. The milestone concludes when the simulator can fly powered burns under both automation and manual control, model quantized RCS firings for attitude and translation, and support a complete LM ascent rendezvous and docking loop that reflects Apollo 11 tolerances.

## Objectives
- Integrate burn guidance with the fixed-step loop so autopilot scripts and manual inputs generate deterministic thrust and attitude changes.
- Implement an RCS subsystem that models thruster geometry, quantized pulse trains, propellant draw, and controller feedback for both the CSM and LM.
- Stand up rendezvous and docking gameplay, including approach corridors, scoring bands, and failure hooks for off-nominal alignment or prop usage.
- Extend HUD and logging to visualize thrust commands, attitude errors, approach ranges, and propellant reserves in real time.
- Deliver developer tooling for tuning guidance profiles, pulse gains, and docking tolerances using mission data packs from M0.

## Feature Breakdown

### 1. Burn Guidance & Autopilot Execution
- **Script interpreter:** Expand the autopilot runner introduced in M1 to support thrust ramps, trim pulses, and event-driven branching. Scripts include guidance cues (attitude targets, throttle levels, ullage firings) referenced from `docs/data/autopilots/`.
- **Manual control parity:** Allow developers to inject discrete commands (`throttle`, `stage`, `abort`) from the input queue. Manual burns must follow the same integrator and error evaluation as autopilot-driven burns to maintain fairness.
- **State monitoring:** Track Δv achieved, attitude deviation, and GET windows during each burn. Publish results back to the scheduler so success/failure effects propagate into resource and mission state.
- **Failure hooks:** Tie underburn/overburn thresholds to `failures.csv` entries. Autopilot scripts should surface causes (e.g., "ullage skipped", "throttle hold late") in the mission log.

### 2. RCS Attitude & Translation Control
- **Thruster layout:** Encode jet positions, axes, and pulse minimums for the CSM and LM. Use JSON tables (`docs/data/autopilots/` or new `docs/data/thrusters.json`) to avoid hardcoding geometry once the N64 build begins.
- **Pulse quantization:** Model 0.5 s minimum impulses with configurable deadbands. The PD controller from M1 should schedule pulses, clamp firing counts, and feed propellant deltas to the resource model.
- **Mode switching:** Support rotational vs. translational control (e.g., AGC `ATT HOLD` vs. `TRANSLATION`). Include logic for hand controllers, docking reticles, and autopilot takeover when scripted docking sequences run.
- **Thermal and power impact:** Couple high-duty pulse trains to cryo boiloff and power draw to maintain consistency with PTC modelling.
- **Implementation progress:** `RcsController` now converts the thruster geometry pack into deterministic propellant usage and impulse metrics for new `rcs_pulse` autopilot commands, logging axis usage so HUD/score systems can surface RCS activity.

### 3. Rendezvous & Docking Scenario
- **Scenario setup:** Instantiate the LM ascent, phasing, and rendezvous sequence with initial conditions from `docs/data/events.csv` and PAD data. The scheduler should arm the docking minigame after ascent cutoff and platform alignment steps succeed.
- **Approach corridors:** Define range-rate bands, closing velocities, and attitude tolerances for braking gates (e.g., 500 m, 150 m, 30 m checkpoints). Missing a gate triggers recoverable penalties and consumes extra RCS propellant.
- **Docking interface:** Render a simple HUD widget (text or vector) showing crosshair error, closing rate, and capture window countdown. Support manual docking with autopilot assist toggles for attitude hold or braking pulses.
- **Scoring and failure:** Track docking attempts, contact velocity, and latch confirmation. Hard failures include capture velocity >0.4 m/s or propellant exhaustion. Successful docking unlocks the combined stack for TEI prep.

## Data & Tooling Updates
- **Autopilot assets:** Expand JSON profiles with additional metadata (`throttle_ramp`, `attitude_profile`, `translation_sequence`). Create placeholder files for LM ascent guidance and docking assist autopilots if not already present.
- **Thruster configuration:** Reference `docs/data/thrusters.json` for the initial CSM/LM RCS cluster tables (thrust, Isp, cluster angle, control axes) and expand them with refined vectors as tuning data becomes available. These feed both JS prototype calculations and the eventual N64 build.
- **Tuning notebooks:** Plan for Python notebooks under `scripts/ingest/` (or similar) that replay burns and rendezvous sequences, plotting attitude error and propellant usage against historical baselines.

## HUD & Telemetry Enhancements
- Extend the existing HUD with readouts for throttle %, Δv remaining, RCS propellant per tank, and roll/pitch/yaw error.
- Add rendezvous panels showing range, range rate, closing time, and capture status. Color-code thresholds to highlight caution/warning margins.
- Log thruster firings and docking attempts to a mission console for debugging and for voiceover alignment during later milestones.

## Validation & Acceptance Criteria
- **Burn replication:** Replay TLI, MCC-2, and LOI-1 using autopilot scripts and confirm Δv and GET alignment within historical tolerances (±2 s, ±1.5 m/s).
- **Manual/autopilot parity:** Run comparable burns under manual control and ensure resource consumption stays within ±5% of scripted execution when flown nominally.
- **RCS fidelity:** Simulate a 30-minute PTC maintenance window and verify propellant usage matches the expected pulse budget from mission notes.
- **Docking trial:** Execute the LM ascent rendezvous sequence end-to-end, confirming that meeting each corridor gate unlocks the next and that capture occurs within allowable closing velocity.
- **Regression logging:** Ensure deterministic replays of the rendezvous scenario produce byte-identical state logs when seeded identically.

## Dependencies & Handoff
- Requires the event scheduler, resource model, and PTC loop from M1 to be functional.
- Outputs validated guidance and docking systems that M3 will instrument with richer HUD/audio cues and that the N64 port will replicate with libdragon tooling.
- Document tuning parameters and outstanding edge cases so that M4 (N64 port) can budget CPU cycles and input mappings appropriately.
