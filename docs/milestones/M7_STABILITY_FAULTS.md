# Milestone M7 — Stability, Fault Injection, and Soak Testing

Milestone M7 hardens the simulator for release-quality reliability. With mission content and calibration in place, the focus shifts to proving deterministic behavior across multi-day runs, exercising the failure taxonomy, and ensuring saves/logs remain intact under stress.

## Objectives
- Execute long-duration simulations (≥195 GET hours) without crashes, runaway resource errors, or desynchronization.
- Validate that every failure hook can be triggered intentionally and recovers or terminates the mission according to plan.
- Establish automated soak suites that replay nominal, off-nominal, and fault-injected scenarios deterministically.
- Confirm save/load integrity, log completeness, and regression tooling resilience.

## Test Matrix & Soak Strategy
- **Nominal endurance runs:** Weekly full-mission simulations with autopilot/manual parity scripts, verifying identical logs and resource traces.
- **Stress permutations:** Time-compression sweeps (2×, 4×, 8×, 16×, 60×), manual override heavy runs (frequent manual checklist acknowledgements, manual burns), and mixed autopilot/manual control sequences.
- **Edge-case slices:** Focused runs for high-risk segments (TLI to MCC-2, LOI through landing, LM ascent rendezvous, transearth reentry) with repeated seeds to catch race conditions.
- **Platform variability:** Document performance and determinism checks across Node.js versions for the JS build and hardware/emu combinations for the N64 port once available.

## Fault Injection Coverage
- **Scheduler faults:** Delay or skip events, inject stale prerequisites, and confirm cascading penalties and recovery events activate as documented.
- **Autopilot anomalies:** Force ullage failures, throttle mis-tracks, or cutoffs. Validate Δv deltas and failure classifications align with mission data.
- **Resource excursions:** Simulate cryo leaks, fuel cell degradation, RCS jet failures, or excessive PTC drift. Ensure alerts, HUD cues, and remedial checklists engage.
- **Communications outages:** Block PAD deliveries, degrade DSN windows, and introduce noisy telemetry to confirm fallback procedures and scoring implications.
- **Save/load resilience:** Serialize mid-fault states, reload, and confirm the simulation resumes with consistent scheduler/resource state.

Each injected fault should log the trigger, affected systems, and observed recovery steps with GET stamps for auditability.

## Observability & Tooling
- **Metrics capture:** Extend mission logs with structured fields for frame time, scheduler queue depth, autopilot command backlog, and resource guard-band violations.
- **Health dashboards:** Provide scripts that aggregate soak test logs into summaries (mean FPS, maximum resource deviation, failure counts) to spot regressions quickly.
- **Alerting:** Define thresholds for soak failures (e.g., simulation loop latency >50 ms, parity drift >1e-6) and integrate them with CI notifications or dashboards.
- **Determinism audits:** Automate byte-level comparisons of log archives between runs with identical seeds. Document accepted tolerances for floating-point drift, if any.

## Automation & Infrastructure
- Stand up nightly CI jobs that execute representative soak scenarios and publish artifacts (logs, parity reports, screenshots once HUD/UI exist).
- Schedule manual deep-dive sessions for newly added faults or mission branches to confirm coverage.
- Maintain a catalogue of known issues with reproduction steps, affected datasets, and mitigation strategies for transparency.
- Coordinate with localization/accessibility stakeholders to ensure UI/audio additions from M3 remain stable under long runs and recover gracefully from restarts.

## Validation & Acceptance Criteria
- All planned soak scenarios complete without unhandled exceptions, memory leaks, or deterministic drift outside documented tolerances.
- Every failure hook has a reproducible test case, log snippet, and recovery status documented in `docs/data/provenance.md` or a dedicated fault notebook.
- Save files generated at key GET checkpoints reload successfully and resume autopilot/manual sequences without divergence.
- CI or automation dashboards surface pass/fail status for soak suites, and README/milestone documentation points contributors to the workflow for ongoing maintenance.
