# Milestone M4 — N64 Port & Performance Validation

Milestone M4 translates the validated JS prototype into a libdragon-powered Nintendo 64 build. The goal is to prove that the
mission systems, HUD, audio, and input loops established in M1–M3 can run within Nintendo 64 hardware budgets while preserving
mission fidelity. The milestone concludes when the N64 target boots into a playable sandbox that can execute a representative
translunar slice (launch through MCC-2) at 30 fps with deterministic state logging, functional HUD/audio output, and Controller
Pak persistence for user settings.

## Objectives
- Port the fixed-step simulation core, scheduler, and resource systems from the JS prototype to C targeting libdragon.
- Implement a wireframe-first renderer capable of drawing the mission HUD, navball, and simplified vehicle meshes at 320×240×30 fps.
- Integrate the audio cue dispatcher with libdragon’s ADPCM streaming pipeline, respecting ROM/RAM budgets.
- Map the control scheme to the N64 controller, including toggles for manual/autopilot control, HUD focus, and accessibility
  adjustments.
- Build a cartridge-friendly data format derived from the M0 CSV packs that supports fast loading and deterministic replay.
- Establish profiling, logging, and soak-test tooling specific to N64 hardware (hardware, emulator, and CI ROM smoke tests).

## Deliverables
- `n64/src/` with the simulation loop, scheduler bindings, resource models, and HUD/audio subsystems translated to libdragon.
- Renderer modules for HUD primitives, navball visualization, vehicle wireframes, and overlay widgets that mirror the JS layout.
- Audio subsystem with cue prioritization, ADPCM asset table, and ducking rules mapped to libdragon mixer channels.
- Input handling layer defining default mappings, remap tables, and Controller Pak persistence of preferences.
- Binary asset pipeline (`tools/pack_n64_assets.py`) converting the CSV datasets and autopilot JSON into packed binary blobs for ROM inclusion.
- Performance logs documenting CPU load, RCP time, audio queue depth, and Controller Pak IO across representative mission slices.

## Engine & Platform Architecture
1. **Code organization**
   - Mirror JS module boundaries: `simulation`, `scheduler`, `resources`, `autopilot`, `hud`, `audio`, `io`. Each compiles into a
     static library archived by the build system for reuse between sandbox ROMs.
   - Maintain deterministic order by scheduling subsystem updates inside a `simulate_frame()` function invoked at 20 Hz. Graphics
     and audio refresh use libdragon’s vertical blank handler to avoid jitter.
2. **Memory model**
   - Allocate a 2 MB static arena partitioned into: 1.0 MB simulation state/log buffers, 512 KB mission data, 256 KB HUD vertex
     pools, 256 KB audio streaming buffers. Remaining memory covers stack and libdragon services.
   - Provide allocators for mission data (`mission_heap`) and transient HUD elements (`hud_pool`) with instrumentation for peak usage.
3. **Data ingestion**
   - Convert `events.csv`, `checklists.csv`, `pads.csv`, `failures.csv`, and autopilot JSON into endian-stable binary packs with
     fixed-width records. Asset packer outputs manifest tables consumed by the runtime loader during boot.
   - Precompute lookup tables (e.g., GET-to-event indices) to minimize per-frame string parsing.

## Rendering Pipeline
- **Graphics setup:** Use libdragon’s `rdp_init()` with double-buffered framebuffers and a shared depth buffer disabled for HUD-first rendering.
- **Geometry:** Store wireframe meshes for the CSM/LM/S-IVB as compact vertex arrays (scaled to 16-bit coordinates). Render via
  F3DEX line lists batched per vehicle state. Include level-of-detail toggles for docking scenes vs. distant views.
- **HUD primitives:** Implement a retained-mode HUD using orthographic projection. Text rendered via 1-bit font atlas stored in
  texture memory; gauge arcs and widgets drawn with line strips and simple filled quads.
- **Navball:** Approximate as a precomputed grid of great-circle lines rotated using the current attitude quaternion. Rendered in
  screen space to avoid expensive world transforms.
- **Frame budget:** Target <12 ms CPU for simulation, <10 ms RCP for rendering. Use instrumentation macros to log `cpu_ms` and
  `rdp_ms` per frame, dumping to serial for emulator capture and to Controller Pak log slots for hardware runs.

## Audio & Telemetry
- **Cue table:** Generate an indexed table mapping scheduler events/failures to audio cue IDs. Cues reference ADPCM assets stored
  in ROM with loop metadata. Provide fallback beep-only cues when ROM budget excludes full voice lines.
- **Streaming:** Use libdragon’s mixer with a dedicated thread filling DMA buffers. Limit concurrent playback to ambience + two
  priority channels (alerts, callouts). Implement ducking by adjusting channel gains when alerts trigger.
- **State logging:** Extend the deterministic log to include audio cue IDs, HUD focus changes, and controller inputs each frame.
  Logs stream over USB (EverDrive) or serial for debugging and can be written to Controller Pak slots at mission checkpoints.

## Input, HUD, and Accessibility Mapping
- **Default bindings:**
  - Analog stick: pitch/yaw attitude control.
  - C-buttons: checklist navigation, HUD tab cycling, and time compression toggles (dev only).
  - D-pad: throttle and translation mode toggles (up/down for throttle, left/right for translation axes).
  - A/B: event acknowledge, autopilot engage/disengage.
  - Z trigger: hold-to-enter translation pulse mode; R trigger: hold-to-enable fine attitude pulses.
  - Start: pause menu with event timeline overview.
- **Remapping:** Implement a configuration screen stored to Controller Pak using checksum-protected blocks. Support inverted axes,
  swap of autopilot/manual toggles, and accessibility modes (high-contrast HUD, caption enable flags).
- **HUD parity:** Match JS layout modules (time block, event stack, resource gauges, maneuver widget, checklist pane, failure alerts).
  Document any N64-specific compromises (reduced checklist line count, condensed log feed) within the source tree README.

## Asset & Build Pipeline
- **Tools:** Add `tools/` scripts (Python 3) for asset packing, ADPCM conversion (using `audioconv64` or ffmpeg wrappers), and ROM
  manifest generation. Provide Makefile targets for `make pack-assets`, `make rom-debug`, and `make rom-release`.
- **Reference:** Follow the pack formats, audio workflow, and manifest contract outlined in [`docs/n64/asset_pipeline.md`](../n64/asset_pipeline.md) when authoring the tooling.
- **Continuous integration:** Set up headless emulator runs (cen64 or ares) to boot the ROM, execute a scripted translunar slice,
  and diff deterministic logs against golden outputs.
- **Versioning:** Embed mission dataset hashes and Git revision metadata into the ROM splash screen for provenance tracking.

## Performance & Testing Strategy
- **Profiling runs:** Execute three mission segments—launch/TLI, translunar coast with PTC, LM ascent rendezvous—and record frame
  times, propellant/power deltas, and log determinism on hardware (EverDrive) and emulator.
- **Stress cases:** Overdrive autopilot pulse cadence, simulate prolonged comm blackout, and inject failure cascades to observe
  HUD/audio load under duress.
- **Soak tests:** Run 24-hour simulated time sessions with Controller Pak logging enabled to surface memory leaks and file system
  fragmentation.
- **Acceptance criteria:** Stable 30 fps in nominal scenarios, no audio underruns, deterministic logs across emulator/hardware,
  and successful persistence/reload of Controller Pak settings.

## Dependencies & Handoff
- Requires datasets from M0, simulation core from M1, guidance/RCS systems from M2, and HUD/audio design from M3.
- Outputs a hardware-proven baseline feeding Milestone M5 content integration and Milestone M6 fidelity tuning.
- Document open issues (e.g., voice asset compression tradeoffs, Controller Pak endurance limits) for prioritization in later
  milestones.
