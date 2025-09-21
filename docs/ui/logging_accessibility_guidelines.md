# Logging, Replay, and Accessibility Guidelines

This guide fulfills the Milestone M3 requirement to formalize how the
presentation layer captures mission truth, replays sessions, and
maintains accessibility parity between the browser prototype and the
future Nintendo 64 build. The intent is to keep the three-pane UI,
Always-On HUD, and audio layer grounded in the simulator while ensuring
players and developers can review every mission beat without sacrificing
accessibility or determinism.

## 1. Logging Contract

All runtime logging funnels through the deterministic mission event bus
so UI code, automation, and parity tooling share the same vocabulary.
New UI-facing instrumentation extends the existing
[`MissionLogger`](../../js/src/logging/missionLogger.js) records and
feeds the manual action recorder, audio dispatcher, and HUD exporters.

### 1.1 Log Entry Shape

Each UI emission conforms to the common envelope:

| Field | Type | Notes |
| --- | --- | --- |
| `timestampGet` | string | `HHH:MM:SS` at the time of emission. |
| `timestampSeconds` | number | Raw GET seconds for deterministic ordering. |
| `category` | enum | `event`, `checklist`, `manual`, `autopilot`, `audio`, `ui`, `accessibility`, or `system`. |
| `source` | enum | `sim`, `ui`, `cli`, `replay`, `n64`. |
| `severity` | enum&#124;null | `info`, `notice`, `caution`, `warning`, `failure` (mirrors alert lamp logic). |
| `message` | string | Human-readable summary. |
| `context` | object | Structured payload (IDs, control states, cue IDs, accessibility flags). |

Simulator subsystems now populate the envelope fields directly via
`logCategory`, `logSeverity`, and `logSource` context metadata so the
[`MissionLogAggregator`](../../js/src/logging/missionLogAggregator.js)
and UI consumers no longer rely on string heuristics to classify
entries. Manual, autopilot, checklist, and resource logs all emit these
tags at the source, keeping downstream filtering deterministic.

### 1.2 Event Sources

- **UI interactions:** Panel toggles, DSKY macros, checklist
  acknowledgements, workspace changes, audio cue dismissals, and HUD
  filter actions publish `source: 'ui'` entries. Each message includes
  the originating control, requested state, verification outcome, and
  the checklist step ID if relevant.
- **Automation bridge:** When the UI triggers the autopilot (e.g.,
  "Plan Burn"), emit paired log entries: one for the UI request and one
  for the resulting simulator acknowledgement. The autopilot entry
  references the UI log via `context.correlationId` so parity tooling
  can trace causality.
- **Accessibility toggles:** High-contrast mode, caption overlays,
  font-scale adjustments, controller remaps, and audio ducking changes
  generate `category: 'accessibility'` entries and mark
  `context.persisted = true` when the setting is saved to profile JSON.
- **Audio cues:** The dispatcher logs cue playback, ducking actions, and
  caption text. Replays can verify audio order without the actual sound
  assets.

### 1.3 Recorder Integration

- Pipe every `source: 'ui'` action into
  [`ManualActionRecorder`](../../js/src/logging/manualActionRecorder.js)
  with the same GET, action type, and payload used by the simulator so
  parity runs (`npm run parity`) can recreate interactive sessions.
- Record workspace layout changes and accessibility toggles via
  `ManualActionRecorder.recordWorkspaceEvent()` so parity runs capture
  the same `workspace:*` payloads exported by the store, keeping tile
  layouts, overrides, and input remaps deterministic across replays.【F:js/src/logging/manualActionRecorder.js†L201-L260】【F:js/src/hud/workspaceStore.js†L1-L740】
- The recorder persists UI supplements alongside mission action scripts
  (e.g., `actionsUi[]`) so regression tooling can choose to reenact UI
  gestures or simply validate their presence.

## 2. Replay & Export Pipelines

### 2.1 Frame Capture

- `UiFrameBuilder` continues to emit deterministic `ui_frame` snapshots
  documented in [`ui_frame_reference.md`](ui_frame_reference.md).
- The UI exporter (`npm run export:ui-frames`) appends the log stream,
  manual actions, and audio cue ledger to the exported JSON payload.
  Each dataset maintains consistent IDs so the browser prototype and N64
  renderer can reconstruct session playback without rerunning the
  simulation.

### 2.2 Playback Modes

1. **Developer Replay:** Loads `ui_frames`, log entries, manual action
   scripts, and audio cue history. Plays them back at original cadence or
   accelerated for debugging. Supports frame stepping, log scrubbing, and
   overlaying accessibility annotations (e.g., caption text visibility).
2. **Player Debrief:** Consumes the same payload but filters to mission
   highlights, crew actions, and scoring deltas. High-contrast and
   caption settings persist so debrief remains accessible.
3. **CI Parity:** Automated harness replays exported actions into a
   headless simulation and diffs log/category counts, audio cue order,
   and accessibility toggles to ensure no regression drifts occur.

### 2.3 Storage & Provenance

- Session exports include provenance metadata: simulator build hash,
  dataset versions (`docs/data/provenance.md` entries), and UI schema
  versions. The metadata allows historical comparisons as datasets
  evolve.
- Store exports under `out/replays/<mission-id>/YYYYMMDD_HHMMSS/` to keep
  long runs organized. Provide rotation utilities that archive or purge
  older sessions without losing provenance history.

## 3. Accessibility Baselines

### 3.1 Color & Contrast

- **Baseline palette:** Use the HUD colors defined in
  [`hud_layout.md`](hud_layout.md) with minimum contrast ratio 4.5:1 for
  text and 3:1 for graphical indicators. Provide a high-contrast toggle
  that boosts ratios to ≥7:1, darkens backgrounds, and outlines critical
  gauges.
- **Status colors:** Pair color cues with shape/iconography so the N64
  line renderer and color-blind players retain state awareness. Example:
  caution triangles vs. warning octagons alongside amber/red hues.
- **Flash thresholds:** Avoid flashing faster than 3 Hz. For master
  alarm pulses use fade-in/out transitions instead of hard blinks.

### 3.2 Typography & Layout

- Default font size ≥14 px on desktop, scaled proportionally for 320×240
  N64 output. Provide font scaling presets (90%, 100%, 125%, 150%) that
  reflow panel lists, timeline ribbons, and checklist lanes without
  clipping.
- Maintain focus outlines for keyboard/controller navigation. Tab order
  mirrors the Always-On HUD → active view components → console dock
  layout to respect mission priority.
- Ensure tile mode obeys minimum sizes and aspect hints from
  [`hud_layout.md`](hud_layout.md). High-contrast mode enforces thicker
  drag handles and larger close buttons for accessibility.

### 3.3 Input Remapping

- Publish a remapping UI that binds actions to keyboard, gamepad, or N64
  controller inputs. Actions map to `ManualActionQueue` verbs so parity
  scripts capture the resulting mission operations instead of raw input
  codes.
- Provide presets: `Apollo Keyboard`, `Controller Classic`, `Left-Handed`,
  and `N64 Heritage`. Each preset documents default bindings in the
  mission log when selected.
- Support chord detection (e.g., `Shift+Enter` for PRO, `Ctrl+Space` for
  Do Next) with configurable hold thresholds to avoid accidental
  activation during high-pressure sequences.

### 3.4 Audio & Captioning

- Every audio cue in `docs/data/audio_cues.json` carries caption text,
  priority, and duration. The dispatcher renders captions in a dedicated
  overlay respecting font scale and high-contrast settings.
- Provide independent volume sliders (Master, Ambience, Callouts, Alerts,
  UI) plus a "duck alerts" toggle that reduces ambient volume during
  caution/warning playback.
- Offer text-to-speech fallback for cues lacking recorded audio. The
  fallback logs a `severity: 'notice'` entry so localization runs can
  identify missing voice assets.

### 3.5 Motion & Cognitive Load

- Allow reduced-motion mode that swaps camera pans for cross-fades and
  disables parallax effects in the trajectory canvas. Timeline ribbon
  auto-scroll becomes step-wise instead of continuous.
- Provide checklist pacing options: standard (`15 s`), accessibility
  (`30 s`), or manual. The UI logs the pacing change with crew role so
  scoring metrics can factor accommodations without penalizing players.
- Surface context hints ("Next: Align IMU") as optional overlays. Toggle
  states persist per profile and are logged for parity runs.

## 4. Implementation Roadmap

| Phase | Scope | Key Tasks |
| --- | --- | --- |
| **P1 – Logging Foundation** | Extend CLI & JS prototype | Wire UI actions into mission log & recorder, add accessibility toggles, export augmented `ui_frames`. |
| **P2 – Browser HUD** | Interactive prototype | Implement logging overlay, caption renderer, input remap UI, high-contrast & reduced-motion toggles, replay viewer (see [`replay_viewer.md`](replay_viewer.md)). |
| **P3 – N64 Port Alignment** | libdragon build | Serialize UI logs/captions into compact ring buffers, map accessibility toggles to Controller Pak saves, and confirm HUD legibility at 320×240. |
| **P4 – Regression Harness** | Automation | Integrate replay payloads into CI, diff log categories, and compare caption sequences/audio order for deterministic parity. |

Dependencies: P1 requires the existing mission logger, manual action
recorder, and `ui_frame` exporter. P2 adds the browser rendering layer.
P3 relies on libdragon storage hooks. P4 waits until replay exports are
stable in P1/P2.

## 5. Validation Checklist

- [ ] Manual UI run populates mission log with panel toggles, DSKY
      macros, accessibility toggles, and audio cues at the correct GETs.
- [ ] Exported replay packages contain `ui_frames`, log entries, manual
      actions, audio cue ledger, and metadata with consistent IDs.
- [ ] Replaying an exported session reproduces HUD states, caption
      sequences, and accessibility toggles deterministically (verified by
      parity harness diff).
- [ ] High-contrast, font scaling, and reduced-motion settings pass WCAG
      2.1 AA criteria in desktop browser tests and remain legible on the
      N64 target resolution.
- [ ] Caption overlay remains synchronized with audio cues within ±0.2 s
      across real-time and time-compressed playback.

These guidelines ensure the mission presentation stack remains auditable,
replayable, and accessible while honoring Apollo 11 procedures on every
platform.
