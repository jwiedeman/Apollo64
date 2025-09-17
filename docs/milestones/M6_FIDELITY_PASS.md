# Milestone M6 — Historical Fidelity & Calibration Pass

Milestone M6 focuses on validating the simulator against Apollo 11 historical data. After the mission graph is complete, this pass tightens every numeric assumption—timelines, Δv, propellant usage, communications windows, and environmental models—so the experience aligns with documented tolerances.

## Objectives
- Align major GET anchors (TLI, LOI, PDI, landing, TEI, entry interface, splashdown) to within documented tolerances when the simulator is flown nominally.
- Calibrate propulsion, thermal, and power models against Mission Operations Report data and post-flight analysis.
- Validate communications coverage, PAD timing, and DSN shift rotations to mirror the historical mission.
- Capture calibration notes and tunable parameters so deviations are explicit and reproducible.

## Timeline & Trajectory Alignment
- **Anchor verification:** Cross-check event activations against Flight Journal transcripts and the official Flight Plan timeline. Produce a table highlighting expected vs. simulated GET for all major milestones.
- **Autopilot retiming:** Compare burn profiles (TLI, MCC series, LOI, DOI, PDI, LM ascent, TEI, MCC-5, entry) against documented TIG, duration, and achieved Δv. Adjust script step durations, throttle ramps, and ullage timing until the delta is within ±2 seconds and ±1.5 m/s.
- **Coast phasing:** Validate passive thermal control cadence, navigation realignments, and rendezvous phasing burns to ensure the mission clock stays synchronized through long coast segments.
- **Event slack documentation:** Record any intentional slack (e.g., checklist buffering, autopilot warm-ups) needed to maintain timeline accuracy so the HUD can surface it to the player.

## Resource & Environmental Calibration
- **Propellant tracking:** Use Mission Operations Report propellant consumption tables to tune mass-flow coefficients, RCS impulse budgets, and residual margins. Add assertions to the resource system to flag when runs deviate by more than ±3% from the historical trend.
- **Power systems:** Model fuel cell loads, cryogenic boiloff, and battery usage against documented telemetry. Introduce configurable load profiles for EVA support equipment, comms high-gain modes, and PTC off-nominal cases.
- **Thermal modelling:** Validate PTC effectiveness and thermal drift penalties with historical cryo pressure trends. Ensure failure cascades (e.g., prolonged PTC outage) match documented risk envelopes.
- **Life support:** Align oxygen, water, and LiOH consumption with EVA timelines and cabin repress events. Capture adjustments required when EVA timing slips during scenario testing.

## Communications & PAD Delivery
- **DSN coverage:** Overlay simulated antenna handovers with DSN schedule tables. Confirm no planned PAD or critical event occurs outside an available window when flown nominally.
- **PAD timing:** Validate uplink and execution times for guidance updates, ensuring the scheduler enforces the same guard bands used historically.
- **Voice & telemetry cues:** Cross-reference logged audio cue timestamps (from M3 planning) with transcript segments to guarantee the simulator honours mission cadence.

## Tooling & Workflow Enhancements
- Build calibration notebooks that ingest simulation logs, compute error metrics, and visualize deviations against historical baselines. Store them under `scripts/calibration/` (or similar) with clear execution instructions.
- Extend `npm run validate:data` or companion scripts to assert known calibration thresholds (e.g., `landing_get_error < 5s`).
- Introduce configuration files capturing tunable constants (mass-flow multipliers, controller gains, PTC coefficients) and document their provenance.
- Capture calibration runs as deterministic log archives so future regressions can be diffed without replaying the entire mission manually.

## Validation & Acceptance Criteria
- Nominal simulation runs match the historical timeline within agreed tolerances for all milestone anchors.
- Resource telemetry (propellant, power, thermal, life support) stays within ±3% of documented values over the full mission, with deviations explained and documented.
- Communications windows never miss scheduled PAD deliveries in nominal runs; deliberate deviations trigger the correct failure cascades.
- Calibration notebooks produce summary reports used during review, and any parameter tweaks are checked into version control with citations.
- README and milestone documentation summarize the calibration status and direct contributors to the notebooks and configuration files for reproducible tuning.
