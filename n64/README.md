# N64 Port Workspace

The N64 build will reuse the systems proven in the JS prototype while targeting libdragon for homebrew-friendly development.
Detailed milestone planning lives in [`../docs/milestones/M4_N64_PORT.md`](../docs/milestones/M4_N64_PORT.md).

Key preparation tasks:

- Define data formats that the fixed-step engine can load efficiently from cartridge or ROM, reusing the CSV schemas produced during Milestone M0 (see [`../docs/milestones/M0_DATA_INGESTION.md`](../docs/milestones/M0_DATA_INGESTION.md)).
- Follow the ROM asset pipeline detailed in [`../docs/n64/asset_pipeline.md`](../docs/n64/asset_pipeline.md) when packing mission data, UI definitions, audio cues, and profile defaults for libdragon builds.
- Outline rendering constraints for wireframe/line-based scenes and HUD overlays.
- Mirror the UI/HUD and audio telemetry plan captured in [`../docs/milestones/M3_UI_AUDIO.md`](../docs/milestones/M3_UI_AUDIO.md) while budgeting for 320×240 output, libdragon audio DMA, and Controller Pak storage of accessibility toggles.
- Plan controller mappings, save infrastructure, and performance budgets as captured in the project plan and informed by the scheduler/loop specification for Milestone M1 ([`../docs/milestones/M1_CORE_SYSTEMS.md`](../docs/milestones/M1_CORE_SYSTEMS.md)).

Implementation will begin after the prototype establishes validated mission data and control loops.
