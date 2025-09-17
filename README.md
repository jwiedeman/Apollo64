# Apollo 11 Real-Time Mission Simulator

This repository has been reset to develop a real-time Apollo 11 mission simulator that can run both as a browser-based proof of concept and, eventually, as a Nintendo 64 experience. All design goals and roadmap details live in [`docs/PROJECT_PLAN.md`](docs/PROJECT_PLAN.md), with milestone-specific execution notes collected under [`docs/milestones/`](docs/milestones).

## Repository Layout
- `js/` – Workspace for the JavaScript/Web prototype that will validate the mission model and user experience.
- `n64/` – Workspace for the libdragon-powered Nintendo 64 port that inherits the proven systems from the web build.
- `docs/` – Planning and reference material for the project, including the current mission and technology plan.

## Current Progress
- Milestone M0 datasets now cover launch through splashdown, capturing extended Passive Thermal Control maintenance, MCC-1/2/3/4 PAD workflows, LOI-focused navigation realignments, DOI planning, LM separation, powered descent and landing safing, ascent/docking evaluation, TEI preparation and execution, MCC-5 return corrections, entry PAD alignment, service module jettison, and recovery procedures.
- A new `docs/data/consumables.json` pack records baseline power, propellant, and life-support budgets with citations into the Apollo 11 Mission Operations Report and Flight Plan, enabling simulation modules to initialize realistic resource margins.
- Milestone M1 CLI prototype in [`js/src/index.js`](js/src/index.js) ingests the mission datasets, drives the deterministic scheduler/resource loop, auto-advances checklist procedures through the `ChecklistManager`, supports scripted manual overrides via `ManualActionQueue`, tracks detailed consumable deltas inside [`ResourceSystem`](js/src/sim/resourceSystem.js), and can export deterministic mission logs for regression playback.
- Autopilot runner in [`js/src/sim/autopilotRunner.js`](js/src/sim/autopilotRunner.js) replays mission automation sequences, logs attitude/ullage/throttle commands, and applies SPS/LM/RCS propellant usage into the shared `ResourceSystem` while exposing burn metrics for HUD and scoring hooks.
- Milestone M2 planning notes outline guidance, RCS, and docking system requirements in [`docs/milestones/M2_GUIDANCE_RCS.md`](docs/milestones/M2_GUIDANCE_RCS.md) to steer upcoming implementation work.
- Milestone M3 UI, HUD, and audio telemetry planning in [`docs/milestones/M3_UI_AUDIO.md`](docs/milestones/M3_UI_AUDIO.md) defines presentation-layer architecture, cue taxonomy, and accessibility handoff targets for the JS prototype and N64 port.
- Milestone M4 N64 port plan in [`docs/milestones/M4_N64_PORT.md`](docs/milestones/M4_N64_PORT.md) maps the libdragon architecture, rendering/audio budgets, input scheme, and asset pipeline for the hardware build.
- Manual action recorder in [`js/src/logging/manualActionRecorder.js`](js/src/logging/manualActionRecorder.js) can capture auto-advanced checklist steps and export them via the CLI `--record-manual-script` flag for deterministic manual-vs-auto parity runs.

## Immediate Priorities
1. Continue Milestone M0 by transforming the Flight Plan, Flight Journal, and Mission Operations Report into normalized CSV packs as outlined in [`docs/milestones/M0_DATA_INGESTION.md`](docs/milestones/M0_DATA_INGESTION.md), focusing on surface EVA expansions, transearth communications, and automated validation notebooks that consume the new consumable budgets.
2. Extend the Milestone M1 simulation harness with manual/auto parity testing—replaying recorder-generated scripts alongside the auto crew—while continuing autopilot burn calibration (verifying mass-flow assumptions against mission data) and deterministic log replay suites that exercise the manual action queue and resource deltas.
3. Prepare for Milestone M2 execution by deriving thruster configuration tables, validating autopilot script needs, and planning rendezvous tuning sessions following [`docs/milestones/M2_GUIDANCE_RCS.md`](docs/milestones/M2_GUIDANCE_RCS.md).
4. Capture Milestone M3 presentation-layer requirements by prototyping HUD layouts, audio cue routing, and accessibility tooling as described in [`docs/milestones/M3_UI_AUDIO.md`](docs/milestones/M3_UI_AUDIO.md).

## Documentation Map
- [`docs/PROJECT_PLAN.md`](docs/PROJECT_PLAN.md) – High-level scope, pillars, and mission milestones.
- [`docs/milestones/M0_DATA_INGESTION.md`](docs/milestones/M0_DATA_INGESTION.md) – Historical data ingestion workflow and schemas.
- [`docs/milestones/M1_CORE_SYSTEMS.md`](docs/milestones/M1_CORE_SYSTEMS.md) – Core engine, scheduler, and Passive Thermal Control specification.
- [`docs/milestones/M2_GUIDANCE_RCS.md`](docs/milestones/M2_GUIDANCE_RCS.md) – Guidance execution, RCS modelling, and docking gameplay plan.
- [`docs/milestones/M3_UI_AUDIO.md`](docs/milestones/M3_UI_AUDIO.md) – UI, HUD, audio telemetry, and accessibility planning for the prototype and N64 targets.
- [`docs/milestones/M4_N64_PORT.md`](docs/milestones/M4_N64_PORT.md) – N64 port architecture, performance validation plan, and Controller Pak integration roadmap.
- [`docs/data/README.md`](docs/data/README.md) – Normalized mission datasets produced during Milestone M0 (currently covering launch through splashdown).

## Contribution Notes
- Follow the guidelines in [`AGENTS.md`](AGENTS.md) for documentation structure and future implementation phases.
- Document any manual verification performed until automated tests are introduced.
