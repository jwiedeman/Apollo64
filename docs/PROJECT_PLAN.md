# Apollo 11 Real-Time Simulation Plan

This document captures the high-level design and production roadmap for building a full-mission Apollo 11 simulator that runs in real time with optional automation and realistic failure cascades.

## 0. Fidelity Targets
- **Time axis:** Ground Elapsed Time (GET) matched to the Apollo 11 Flight Plan and Flight Journal. Anchor events such as TLI (~002:44:14 GET) and the barbecue roll (~0.3°/s) must align.
- **Major mission beats:** Earth parking orbit → TLI → transposition/docking/extraction → midcourse corrections → LOI → LM descent/ascent → TEI → reentry.
- **Lunar anchors:** Use Flight Journal timings for LOI and landing (~102:45:40 GET).
- **Historical checklists:** Procedures mirror the Apollo 11 Flight Plan pages and checklist callouts.

## 1. Game Pillars
1. Discipline under time pressure: timed checklists with tolerances.
2. Systemic consequences: missed steps alter power, Δv, thermal, or comms margins.
3. Manual vs. autopilot trade-offs.
4. Low-poly clarity suitable for 320×240 output.

## 2. Player Modes
- **Authenticity Mode:** real-time pacing with pause support.
- **Controller Mode:** developer toggle for 2×–120× time compression.
- **Free Flight:** sandbox entry at any mission phase with configurable margins or injected faults.

## 3. Stage Map Overview
Each event has a window, manual inputs, autopilot scripts, telemetry, and failure outcomes. Key stages:

### A. Launch & Earth Parking Orbit (GET 000:00 → ~002:44)
- Orbit verification and S-band configuration checks.
- Pre-TLI housekeeping: guidance alignment, systems prep. Missed steps lead to PAD errors and reduced Δv margin.

### B. TLI, Transposition, Docking, Extraction (GET ~002:44 → ~004:00)
- Execute TLI burn with timing tolerances.
- Perform transposition and docking; repeated attempts consume RCS propellant.

### C. Translunar Coast & PTC (GET ~004:00 → ~075:50)
- Enable PTC within one hour to manage thermal balance.
- Schedule midcourse corrections (TLI+9h, +24h, LOI−22h, LOI−5h).
- Run routine consumable and comms checklists.

### D. LOI & Lunar Orbit (GET ~075:50)
- LOI-1 burn to capture; underburns raise apoapsis and consume additional fuel during LOI-2.

### E. LM Descent, Landing, Ascent (GET ~100:00 → ~106:00)
- Power-up LM, undock, and perform PDI.
- Land around 102:45:40 GET with low fuel margins.
- Conduct ascent and rendezvous with the CSM.

### F. TEI, Transearth Coast, Reentry (GET ~137:00 → splashdown)
- Execute TEI, repeat PTC management, and manage reentry corridor constraints.

## 4. Feedback Systems
- HUD with MET/GET, upcoming events, Δv remaining, resources, thermal status, comms state, and navball.
- Audio cues for cautions, warnings, and optional voiceovers.
- Text console for PAD uplinks and autopilot feedback.
- Failure breadcrumbs highlighting causal chains (e.g., "PTC OFF → cryo boiloff ↑ → fuel cell ΔP ↓").
- Panel switch maps, DSKY macro catalog, and workspace schemas documented in [`docs/ui/`](ui) to keep UI prerequisites aligned with mission procedures.
- Presentation-layer component boundaries and update cadence are outlined in [`docs/ui/component_architecture.md`](ui/component_architecture.md), while cue categories, priority routing, and asset specs live in [`docs/ui/audio_cue_taxonomy.md`](ui/audio_cue_taxonomy.md) and the dispatcher/mixer blueprint in [`docs/ui/audio_dispatcher_architecture.md`](ui/audio_dispatcher_architecture.md) keeps playback wiring aligned with those datasets for Milestone M3.
- Logging, replay, and accessibility guidelines in [`docs/ui/logging_accessibility_guidelines.md`](ui/logging_accessibility_guidelines.md) ensure HUD, audio, and control layers emit deterministic logs, support replay exports, and meet color/caption/input baselines across web and N64 builds.

## 5. Failure Taxonomy
- **Success:** All milestones within spec.
- **Recoverable failure:** Correctable deviations that cost margins.
- **Hard failure:** Irrecoverable mission loss (crash, power exhaustion, comms blackout at critical time).
- **Technical failure:** Simulation errors (numerical instability, corrupted saves).

## 6. Mission Data & Control Loops
- **Event scheduler:** Deterministic timeline with prerequisites, windows, autopilot scripts, manual ops, and effects.
- **Physics:** Patched-conic two-body model, 20 Hz fixed simulation, RK2/RK4 integration, analytic drag during entry.
- **Attitude & RCS loops:** PD controllers with pulse quantization and PTC maintenance.
- **Resources:** Fuel cell power tied to cryogenic states, CO₂ accumulation, and comms windows governing PAD delivery.
- **Manual input loop:** `ManualActionQueue` mediates checklist acknowledgements, resource deltas, propellant burns, and DSKY macros for parity with automated runs; the UI contract lives in [`docs/ui/manual_actions_reference.md`](ui/manual_actions_reference.md) so future front-ends dispatch deterministic actions against the same schema.

## 7. N64 Implementation Plan
- **Tech stack:** libdragon, 320×240 at 30 fps, wireframe rendering, ADPCM audio.
- **Memory budget:** Code/sim (~1.2 MB), mission data (~0.5 MB), UI (~128 KB), audio (~512 KB), remainder for buffers.
- **Input mapping:** Analog stick for pitch/yaw, shoulders for roll, Z for translation mode, D-pad for throttle, C buttons for checklists and panels.
- **Rendering:** F3DEX line lists for wireframes, HUD overlay with 1-bit font.
- **Persistence:** EEPROM or Controller Pak with CRC-protected saves.

## 8. Content Pipeline
- Source data from Flight Plan, Flight Journal, and Mission Operations Report.
- Convert event CSVs into binary packs for runtime.
- Template PAD generator for uplink messages.
- Fault library with parameterized triggers/remedies.
- Thruster geometry dataset mapping CSM/LM RCS clusters (`docs/data/thrusters.json`) with control axes and baseline thrust/impulse figures for the guidance milestone.

## 9. Telemetry, Scoring, Progression
- Track Δv, propellant, electrical margins, thermal violations, comms hits/misses.
- Commander Rating factors mission success, margins preserved, manual contribution, and faults incurred.
- Unlocks include alternate missions (Apollo 8 flyby, Apollo 13 emergency profile).
- Commander rating implementation details live in [`docs/scoring/commander_rating.md`](scoring/commander_rating.md) so telemetry sources and weighting stay aligned with the simulator.

## 10. QA & Risk Controls
- Deterministic fixed-step sim with linting of event graphs.
- Numerical guards for integrators, thrust limits, and RCS usage.
- Save integrity via rolling slots and CRC.
- Performance tests for line rendering and audio DMA.
- Design-side unit tests for PAD logic and failure cascades.
- JavaScript regression suite (`npm test`) covering autopilot mass flow tracking, manual action queue behaviors, and HUD frame generation to catch automation or UI contract regressions every pass.

## 11. Milestones
Supporting details for each milestone live in [`docs/milestones/`](milestones).

1. **M0:** Historical ingestion and event CSV creation (see [`milestones/M0_DATA_INGESTION.md`](milestones/M0_DATA_INGESTION.md)).
2. **M1:** Core engine (loop, scheduler, resources, PTC) documented in [`milestones/M1_CORE_SYSTEMS.md`](milestones/M1_CORE_SYSTEMS.md).
3. **M2:** Guidance and RCS (burn execution, docking minigame) documented in [`milestones/M2_GUIDANCE_RCS.md`](milestones/M2_GUIDANCE_RCS.md).
4. **M3:** UI/HUD and audio presentation planning captured in [`milestones/M3_UI_AUDIO.md`](milestones/M3_UI_AUDIO.md).
5. **M4:** N64 port and performance tuning documented in [`milestones/M4_N64_PORT.md`](milestones/M4_N64_PORT.md).
6. **M5:** Content pass for the full Apollo 11 mission graph detailed in [`milestones/M5_CONTENT_PASS.md`](milestones/M5_CONTENT_PASS.md).
7. **M6:** Fidelity pass aligning to GET anchors covered in [`milestones/M6_FIDELITY_PASS.md`](milestones/M6_FIDELITY_PASS.md).
8. **M7:** Stability, fault injection, and long-run soak tests defined in [`milestones/M7_STABILITY_FAULTS.md`](milestones/M7_STABILITY_FAULTS.md).

## 12. Stage Consequence Table (Excerpt)

| Phase | Missed/Incorrect Step | Immediate Effect | Ongoing Penalty | Recovery | Fail Class |
| --- | --- | --- | --- | --- | --- |
| Coast | PTC not enabled within 1h | Thermal drift | Cryo boiloff ↑ → power margin ↓ | Enable PTC; shed loads; possible MCC delay | Recoverable |
| TLI | TIG late by 30–60 s | Off-nominal trajectory | MCC Δv ↑ (10–25 m/s) | Execute MCC burns | Recoverable |
| LOI-1 | Underburn >3% | Capture ellipse too high | LOI-2 Δv ↑; CSM prop margin ↓ | Execute precise LOI-2 | Recoverable |
| LM Descent | Horizontal velocity too high <200 m | Dust occlusion; guidance jitter | Hover time ↑; fuel ↓ | Feather with RCS; shallow approach | Recoverable → Hard |
| Reentry | Angle of entry too shallow | Skip-out | Heating risk on second pass | Adjust lift vector (if available) | Hard |

## 13. Initial Build Targets
1. Scheduler + PTC + HUD (no Moon yet).
2. Burn execution + MCC loop (Earth → Moon transfer slice).
3. LOI capture.
4. LM descent sandbox.
5. Integrate full mission graph for multi-day runs.

## 14. Source Notes
- TLI timing and burn length: Flight Journal Day 1.
- PTC rate: Flight Journal Day 2.
- Midcourse windows: Apollo 11 Mission Operations Report.
- LOI timing shifts: Flight Journal Day 4.
- Landing GET: Flight Journal landing transcript (~102:45:40).
- Checklists: Apollo 11 Flight Plan (final).

## 15. TARS' Advice
- Favor wireframe visuals to protect simulation budgets.
- Lock GET anchors early to avoid cascading timeline shifts.
- Autopilot should follow the same rules and incur small inefficiencies.
- Communicate failure causes clearly for multi-day sessions.
- Future work: provide starter CSV schemas and sim headers when implementation begins.
