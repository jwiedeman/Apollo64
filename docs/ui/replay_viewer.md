# Mission Replay Viewer Specification

The mission replay viewer turns the deterministic exports produced by
`UiFrameBuilder`, the mission logger, and the manual action recorder into
an interactive review tool. It lets flight controllers, testers, and
players re-examine Apollo 11 mission runs without rerunning the
simulation while keeping the three-pane rhythm—Navigation, Controls,
Systems—and the Always-On HUD cadence intact.

## Goals

1. **Procedure awareness** – Timeline scrubbing, checklist context, and
   failure breadcrumbs remain aligned with the flight plan so reviews
   reinforce correct mission cadence rather than becoming free-form video
   playback.
2. **Deterministic parity** – The viewer consumes the exact
   `ui_frames`, log records, manual action scripts, and audio cue ledger
   that `npm run export:ui-frames` emits, ensuring every platform (CLI,
   browser, N64) can reproduce identical states.
3. **Accessibility-first** – Caption overlays, high-contrast palettes,
   and reduced-motion toggles mirror the runtime accessibility settings
   captured in the export so reviewers experience the mission exactly as
   the crew did.
4. **Cross-platform portability** – The layout and controls translate to
   both the browser prototype and a libdragon-driven N64 build, sharing
   the same input bindings documented in [`input_mappings.md`](input_mappings.md).

## Data Inputs

| Source | Description | Usage |
| --- | --- | --- |
| `metadata` | Export provenance (`gitHash`, dataset hashes, export cadence). | Displayed in the session header and stored in shareable reports. |
| `frames[]` | Ordered `ui_frame` payloads with scheduler, resource, checklist, AGC, score, and audio summaries. | Drives primary playback, timeline thumbnails, and view widgets. |
| `logs[]` | Mission log entries (`category`, `source`, `severity`, `context`). | Feeds console overlays, annotation markers, and filter chips. |
| `manualActions[]` | Deterministic manual queue actions (`checklist_ack`, `dsky_entry`, etc.). | Highlights manual vs. auto control segments and fuels parity warnings. |
| `audioCues[]` | Dispatcher ledger (`cueId`, `busId`, ducking info, captions). | Powers caption strip, audio timeline, and mute/solo controls. |
| `workspaceLayouts[]` (optional) | Saved tile/workspace snapshots at export time. | Restores reviewer-selected layouts for tile mode playback. |

Exports missing optional arrays still load—the viewer simply hides the
associated controls while logging a deterministic warning entry.

## Layout Overview

```text
┌──────────────────────────────────────────────────────────────┐
│ Always-On HUD (mirrors runtime band; playback clock shown)   │
├──────────────────────────────────────────────────────────────┤
│ Viewport Tabs: Navigation | Controls | Systems | Tile Mode    │
├──────────────────────────────────────────────────────────────┤
│ Active View (widget grid identical to runtime layout)        │
├──────────────────────────────────────────────────────────────┤
│ Timeline & Annotation Rail                                   │
│  - GET scrub bar with checkpoint markers                     │
│  - Checklist/Failure/Audio chips                             │
│  - Manual vs. Auto heatmap                                   │
├──────────────────────────────────────────────────────────────┤
│ Console Dock (filterable log, caption overlay, parity notes) │
└──────────────────────────────────────────────────────────────┘
```

The Always-On HUD uses interpolated playback GET while the viewer is
paused or scrubbing so countdowns and Δv readouts remain meaningful.
Selecting Navigation/Controls/Systems switches the replay viewport to
the same layout defined in [`hud_layout.md`](hud_layout.md); tile mode
restores any saved workspace or defaults to the presets in
[`workspaces.json`](workspaces.json).

## Timeline & Playback Controls

| Control | Behaviour |
| --- | --- |
| **Scrub Bar** | Dragging seeks to the nearest frame, with sub-second interpolation for gauges driven by deltas. Displays GET tooltips and phase labels sourced from `frame.events`. |
| **Play / Pause** | Toggles continuous playback at 1× speed. Holding the keybinding (or controller button) engages fast-forward (4×) while pressed. |
| **Step ±** | Bumps one frame forward/back. Holding emits repeated steps; capped at 20 Hz to preserve deterministic ordering. |
| **Bookmark Jump** | Cycling through event/failure/audio bookmarks jumps to the next marker and focuses the relevant widget (timeline ribbon, checklist lane, fault log). |
| **Manual/Auto Filter** | Heatmap under the scrub bar shows manual vs. auto segments using `manualActions`. Toggling “Auto only” hides manual acknowledgements to isolate baseline behaviour. |

Playback controls honour the input bindings in `input_mappings.md`:
`Space`/`A` toggles play, `Left`/`Right` step, `LB/RB` cycle bookmarks,
and `T` toggles tile mode.

## Annotation Layers

- **Checklist overlays:** When manual or auto acknowledgements occur,
the checklist lane flashes the relevant step card and displays actor
labels. Clicking the annotation opens the Controls view focused on the
linked panel or DSKY macro.
- **Failure breadcrumbs:** Failure log chips appear on the timeline with
severity colours. Selecting a chip opens the Systems view fault log and
displays recovery notes sourced from `frame.alerts` and
`logs[].context.breadcrumb`.
- **Audio cues:** Caption markers show cue IDs, categories, and ducking
effects. Solo/mute toggles replay captions without audio for silent
reviews or accessibility audits.
- **Commander score:** Grade changes inject timeline markers referencing
the scorecard spec. Selecting a marker opens the Systems view scorecard
in detail mode for the active frame.

All annotations emit replay log entries (`source: 'replay'`) so reviewers
can export a secondary summary of inspected points.

## Accessibility & Parity Hooks

- **Caption fidelity:** Caption strip replays the `audioCues[]` captions
with the same timing offsets used at runtime. Reduced-motion mode fades
between caption entries instead of sliding.
- **High-contrast toggle:** Applies the same palette as runtime
high-contrast mode. When enabled, the viewer logs the toggle and
persists it in the session metadata so future replays honour the choice.
- **Input remap respect:** If the export recorded remapped bindings, the
viewer displays the active profile and allows switching among saved
presets. Inputs continue to dispatch the same high-level actions so
parity harness scripts remain valid.
- **Parity warnings:** When manual actions are missing (e.g., export only
contains auto crew data), the viewer surfaces a parity banner prompting
users to run `npm run parity` or export manual scripts for comparison.

## Export & Sharing

- **Snapshot export:** Captures the current frame, log excerpt, and
selected annotations to Markdown/JSON so testers can attach concise
replay notes to bug reports or milestone reviews.
- **Session manifest:** The viewer writes a manifest referencing the
source export, applied accessibility settings, bookmarks, and notes.
Manifests live beside the original export and can be replayed to restore
review context on any platform.
- **N64 considerations:** The console build omits freeform text input but
stores bookmarks (frame index + reason codes) and accessibility toggles
on Controller Pak. A desktop companion tool can convert the manifest to
Markdown when verbose reporting is required.

## Implementation Checklist

1. Extend the export payload to include optional workspace snapshots and
   input remap metadata (already supported by the ingestion helpers).
2. Build a `ReplayStore` service that streams frames/logs to the viewport
   and exposes derived selectors (current frame, upcoming annotation,
   manual fraction).
3. Reuse existing view components (`NavigationView`, `ControlsView`,
   `SystemsView`) in read-only mode, disabling interactions that would
   mutate the simulation.
4. Implement bookmark/annotation managers that read from `logs[]`,
   `manualActions[]`, and `audioCues[]`, ensuring deterministic ordering
   by GET and sequence number.
5. Hook accessibility toggles into the viewer shell, logging changes via
   the mission log contract described in
   [`logging_accessibility_guidelines.md`](logging_accessibility_guidelines.md).
6. Provide CLI glue (`npm run replay -- --input out/ui_frames.json`) that
   launches the viewer and points it at a specific export bundle.

By grounding the replay viewer in the same mission truth used during the
run, reviewers can trace checklist adherence, resource trends, and audio
cues without diverging from Apollo 11 procedures. The shared layout and
input contracts guarantee that discoveries made in the browser prototype
carry straight into the N64 build and future automation suites.
