# Apollo 11 Real-Time Mission Simulator

This repository has been reset to develop a real-time Apollo 11 mission simulator that can run both as a browser-based proof of concept and, eventually, as a Nintendo 64 experience. All design goals and roadmap details live in [`docs/PROJECT_PLAN.md`](docs/PROJECT_PLAN.md), with milestone-specific execution notes collected under [`docs/milestones/`](docs/milestones).

## Repository Layout
- `js/` – Workspace for the JavaScript/Web prototype that will validate the mission model and user experience.
- `n64/` – Workspace for the libdragon-powered Nintendo 64 port that inherits the proven systems from the web build.
- `docs/` – Planning and reference material for the project, including the current mission and technology plan.

## Current Progress
- Milestone M0 datasets now cover launch through splashdown, capturing extended Passive Thermal Control maintenance, MCC-1/2/3/4 PAD workflows, LOI-focused navigation realignments, DOI planning, LM separation, powered descent and landing safing, ascent/docking evaluation, TEI preparation and execution, MCC-5 return corrections, entry PAD alignment, service module jettison, and recovery procedures.
- Milestone M2 planning notes outline guidance, RCS, and docking system requirements in [`docs/milestones/M2_GUIDANCE_RCS.md`](docs/milestones/M2_GUIDANCE_RCS.md) to steer upcoming implementation work.

## Immediate Priorities
1. Continue Milestone M0 by transforming the Flight Plan, Flight Journal, and Mission Operations Report into normalized CSV packs as outlined in [`docs/milestones/M0_DATA_INGESTION.md`](docs/milestones/M0_DATA_INGESTION.md), focusing on surface EVA expansions, transearth communications, and validation tooling.
2. Stand up Milestone M1 core systems—scheduler, resource models, and Passive Thermal Control loop—per [`docs/milestones/M1_CORE_SYSTEMS.md`](docs/milestones/M1_CORE_SYSTEMS.md).
3. Prepare for Milestone M2 execution by deriving thruster configuration tables, validating autopilot script needs, and planning rendezvous tuning sessions following [`docs/milestones/M2_GUIDANCE_RCS.md`](docs/milestones/M2_GUIDANCE_RCS.md).

## Documentation Map
- [`docs/PROJECT_PLAN.md`](docs/PROJECT_PLAN.md) – High-level scope, pillars, and mission milestones.
- [`docs/milestones/M0_DATA_INGESTION.md`](docs/milestones/M0_DATA_INGESTION.md) – Historical data ingestion workflow and schemas.
- [`docs/milestones/M1_CORE_SYSTEMS.md`](docs/milestones/M1_CORE_SYSTEMS.md) – Core engine, scheduler, and Passive Thermal Control specification.
- [`docs/milestones/M2_GUIDANCE_RCS.md`](docs/milestones/M2_GUIDANCE_RCS.md) – Guidance execution, RCS modelling, and docking gameplay plan.
- [`docs/data/README.md`](docs/data/README.md) – Normalized mission datasets produced during Milestone M0 (currently covering launch through splashdown).

## Contribution Notes
- Follow the guidelines in [`AGENTS.md`](AGENTS.md) for documentation structure and future implementation phases.
- Document any manual verification performed until automated tests are introduced.
