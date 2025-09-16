# Apollo 11 Real-Time Mission Simulator

This repository has been reset to develop a real-time Apollo 11 mission simulator that can run both as a browser-based proof of concept and, eventually, as a Nintendo 64 experience. All design goals and roadmap details live in [`docs/PROJECT_PLAN.md`](docs/PROJECT_PLAN.md), with milestone-specific execution notes collected under [`docs/milestones/`](docs/milestones).

## Repository Layout
- `js/` – Workspace for the JavaScript/Web prototype that will validate the mission model and user experience.
- `n64/` – Workspace for the libdragon-powered Nintendo 64 port that inherits the proven systems from the web build.
- `docs/` – Planning and reference material for the project, including the current mission and technology plan.

## Immediate Priorities
1. Complete Milestone M0 by transforming the Flight Plan, Flight Journal, and Mission Operations Report into normalized CSV packs as outlined in [`docs/milestones/M0_DATA_INGESTION.md`](docs/milestones/M0_DATA_INGESTION.md).
2. Stand up Milestone M1 core systems—scheduler, resource models, and Passive Thermal Control loop—per [`docs/milestones/M1_CORE_SYSTEMS.md`](docs/milestones/M1_CORE_SYSTEMS.md).
3. Use the JS prototype to tune event windows, failure cascades, and HUD feedback before targeting the N64 platform.

## Documentation Map
- [`docs/PROJECT_PLAN.md`](docs/PROJECT_PLAN.md) – High-level scope, pillars, and mission milestones.
- [`docs/milestones/M0_DATA_INGESTION.md`](docs/milestones/M0_DATA_INGESTION.md) – Historical data ingestion workflow and schemas.
- [`docs/milestones/M1_CORE_SYSTEMS.md`](docs/milestones/M1_CORE_SYSTEMS.md) – Core engine, scheduler, and Passive Thermal Control specification.

## Contribution Notes
- Follow the guidelines in [`AGENTS.md`](AGENTS.md) for documentation structure and future implementation phases.
- Document any manual verification performed until automated tests are introduced.
