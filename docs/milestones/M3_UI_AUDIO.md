# Milestone M3 — UI, HUD, and Audio Telemetry

Milestone M3 layers a mission-ready presentation stack onto the deterministic simulator delivered in M1 and the guidance/RCS
systems planned for M2. The milestone concludes when the JS prototype can visualize the mission timeline, resources, and vehicle
state in real time while emitting audio cues, logs, and accessibility affordances that prepare the content pipeline for the N64
port.

## Objectives
- Build a modular UI architecture that consumes scheduler/resource state and renders prioritized mission context at 20 Hz.
- Expose checklist, event, and failure feedback loops through HUD widgets, log feeds, and developer tooling.
- Establish the audio event pipeline, including historical callouts, caution/warning tones, and configurable alert routing.
- Document cross-platform considerations so the eventual N64 build can reproduce the UI and audio layer within its budgets.

## Deliverables
- UI state aggregator and presentation layer design notes for the JS prototype (component tree, update cadence, data bindings) documented in [`docs/ui/component_architecture.md`](../ui/component_architecture.md).
- HUD layout specifications including timing blocks, event stack, resource gauges, and maneuver widgets.
- Audio cue taxonomy mapped to mission events and failure classes with playback priority rules and asset references, captured in [`docs/ui/audio_cue_taxonomy.md`](../ui/audio_cue_taxonomy.md).
- Committed Apollo 11 cue catalog at [`docs/data/audio_cues.json`](../data/audio_cues.json) with buses, categories, metadata, and sources wired into the loader/validator so UI and dispatcher work can reference a single dataset.
- Logging, replay, and accessibility guidelines covering color use, captioning, and control remapping hooks.
- Panel hierarchy, DSKY macro catalog, and JSON data schema references in [`docs/ui/`](../ui) to guide panel highlighting, DSKY macros, and tile-mode presets.

## UI Architecture & Data Flow
1. **State aggregation:**
   - Subscribe to scheduler, resource, autopilot, and failure evaluators introduced in M1/M2.
   - Normalize updates into a single `ui_frame` payload with timestamps, active events, resource deltas, checklist progress, and
     active maneuvers.
   - `UiFrameBuilder` (`js/src/hud/uiFrameBuilder.js`) now implements this aggregation, exposing deterministic frames consumed by the CLI HUD and future view layers (see [`docs/ui/ui_frame_reference.md`](../ui/ui_frame_reference.md)).
   - Guarantee deterministic ordering by applying mutations during the simulation loop’s `refresh_hud` pass.
2. **Component layers:**
   - **Core HUD:** Static layout sized for 320×240, rendering via HTML/CSS/Canvas in the JS build and line primitives on N64.
   - **Overlays:** Contextual widgets (docking reticle, burn monitor, entry corridor) toggled by scheduler signals.
   - **Console feed:** Scrollback buffer capturing event activations, autopilot transitions, failure breadcrumbs, and PAD
     deliveries. Include filtering toggles for debugging vs. player mode.
3. **Data bindings & performance:**
   - Use immutable snapshots or diffed updates to avoid tearing at 20 Hz.
   - Document expected update sizes so the N64 renderer can budget DMA bandwidth for HUD vertices/textures.

### HUD Layout Guidelines
| Module | Content | Notes |
| --- | --- | --- |
| Time Block | GET, MET, countdown to next critical event | Syncs to scheduler anchors, supports pause/time compression indicators. |
| Event Stack | Top 3–5 armed/active events with status, deadline, checklist link | Color-code by risk (nominal, caution, overdue); include autopilot engagement iconography. |
| Resource Gauges | Power, propellant (per tank), thermal margin, comm window timer | Use consistent units and caution/warning bands derived from resource model thresholds. |
| Maneuver Widget | Burn/attitude/PTC telemetry, Δv remaining, attitude error | Switch between burn, PTC, rendezvous, or entry modes based on scheduler flags. |
| Checklist Pane | Active checklist title, current step, expected response | Support manual step acknowledgement with keyboard/controller bindings. |
| Failure Alerts | Caution/warning summary with breadcrumbs | Link back to console log entries and recommended recovery actions. |

### Interaction & Accessibility Considerations
- Provide keyboard/controller shortcuts for checklist step acknowledgement, HUD tab cycling, and log filtering.
- Support color-blind-friendly palettes and high-contrast mode toggles.
- Offer optional text-to-speech or caption overlays for major audio cues in the JS prototype; document N64 feasibility (e.g.,
  limited ROM for voice playback vs. text subtitles).

## Audio Pipeline & Cue Taxonomy
1. **Cue categories:**
   - **Ambient bed:** Cabin hum, radio static loops keyed to craft mode.
   - **Mission callouts:** Historical CapCom dialogue for major events (e.g., "Go for TLI") with timing offsets from the dataset.
   - **Alerts:** Caution/warning tones, master alarm, guidance program change beeps.
   - **UI feedback:** Button/select sounds, checklist acknowledgement ticks.
   - The committed `audio_cues.json` pack enumerates these categories with routing, ducking, and cue metadata that the dispatcher will consume directly.
2. **Event wiring:**
   - Extend the mission data packs with cue IDs (`audio_cue` fields in events/failures) without altering schema yet; document the
     proposed columns and JSON bindings for later ingestion scripts.
   - Build a dispatcher that consumes scheduler/failure notifications and enqueues cues with priority (alerts > callouts >
     ambience > UI).
   - Support ducking rules so alerts temporarily attenuate ambience and voice playback.
3. **Asset pipeline:**
   - JS prototype: Use Web Audio API with preloaded buffers, dynamic gain nodes for ducking, and sample-accurate scheduling.
   - N64 port: Target ADPCM-compressed mono assets, 22.05 kHz sampling, streaming via libdragon’s audio DMA. Budget memory for
     simultaneous playback (e.g., 3 concurrent cues + ambience).
   - Document naming conventions, loudness targets (-16 LUFS integrated), and loop point definitions to streamline conversion.

## Logging, Replay, and Developer Tooling
- Extend the existing mission log format to include UI focus changes, audio cue triggers, and checklist interactions with GET
  stamps.
- Provide a replay mode that consumes recorded logs to validate HUD/audio behavior without re-running the full simulation.
- Define debug overlays (frame time graph, resource delta inspector) that can be toggled independently of the player HUD.
- Capture profiling metrics (render time, audio queue depth) each minute to confirm budgets before porting to the N64.

## Validation & Acceptance Criteria
- Run a six-hour translunar slice and verify the HUD refreshes deterministically with no dropped frames or stale data.
- Trigger PTC, MCC, LOI, and docking sequences to confirm contextual overlays appear/disappear according to scheduler flags.
- Fire representative failure hooks (power margin low, comm blackout) and ensure alerts play with correct priority and visual
  emphasis.
- Validate that audio ducking and simultaneous cue playback stay within headroom limits (no clipping, <1 dB gain overshoot).
- Confirm replay logs reproduce identical HUD states and audio cue order when re-run.

## Dependencies & Handoff
- Requires the scheduler, resource models, autopilot runners, and docking logic from M1/M2.
- Outputs UI/audio specifications, cue mappings, and tooling that Milestone M4 (N64 port) will translate into libdragon
  render/audio code.
- Document outstanding gaps (e.g., missing voice assets, accessibility stretch goals) for prioritization during M5 content
  integration.
