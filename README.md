# Apollo 11 Real-Time Mission Simulator

This repository has been reset to develop a real-time Apollo 11 mission simulator that can run both as a browser-based proof of concept and, eventually, as a Nintendo 64 experience. All design goals and roadmap details live in [`docs/PROJECT_PLAN.md`](docs/PROJECT_PLAN.md).

## Repository Layout
- `js/` – Workspace for the JavaScript/Web prototype that will validate the mission model and user experience.
- `n64/` – Workspace for the libdragon-powered Nintendo 64 port that inherits the proven systems from the web build.
- `docs/` – Planning and reference material for the project, including the current mission and technology plan.

## Immediate Priorities
1. Build out documentation and data ingestion (Flight Plan, Flight Journal, Mission Operations Report).
2. Prototype the deterministic mission scheduler, resource models, and PTC control loop in the JS build.
3. Use the prototype to tune event windows, failure cascades, and HUD feedback before targeting the N64 platform.

## Contribution Notes
- Follow the guidelines in [`AGENTS.md`](AGENTS.md) for documentation structure and future implementation phases.
- Document any manual verification performed until automated tests are introduced.
