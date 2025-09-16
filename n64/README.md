# N64 Port Workspace

The N64 build will reuse the systems proven in the JS prototype while targeting libdragon for homebrew-friendly development.

Key preparation tasks:

- Define data formats that the fixed-step engine can load efficiently from cartridge or ROM, reusing the CSV schemas produced during Milestone M0 (see [`../docs/milestones/M0_DATA_INGESTION.md`](../docs/milestones/M0_DATA_INGESTION.md)).
- Outline rendering constraints for wireframe/line-based scenes and HUD overlays.
- Plan controller mappings, save infrastructure, and performance budgets as captured in the project plan and informed by the scheduler/loop specification for Milestone M1 ([`../docs/milestones/M1_CORE_SYSTEMS.md`](../docs/milestones/M1_CORE_SYSTEMS.md)).

Implementation will begin after the prototype establishes validated mission data and control loops.
