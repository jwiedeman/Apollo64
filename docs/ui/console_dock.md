# Console Dock & Mission Log Overlay Specification

The console dock is the shared log surface for the Navigation, Controls,
and Systems panes. It promotes the mission log produced by
[`MissionLogAggregator`](../../js/src/logging/missionLogAggregator.js)
and the `ui_frame.missionLog` payload emitted by
[`UiFrameBuilder`](../../js/src/hud/uiFrameBuilder.js) into a
filterable, caption-aware overlay that keeps crews synchronized with
scheduler, checklist, audio, and accessibility events. The dock replaces
adhoc printouts with a deterministic, replayable feed that mirrors the
historic loop cadence while supporting modern accessibility, search, and
parity tooling.

## Goals

1. **Mission-first visibility** – every entry traces back to logged
   simulation facts (event transitions, checklist acknowledgements,
   autopilot updates, audio cues, manual inputs, score changes) so crews
   can act without reopening raw datasets.
2. **Deterministic filtering** – the dock mirrors the category/severity
   classification performed by the aggregator, exposing the same counts
   and filter semantics to the UI, CLI HUD, and regression harnesses.
3. **Caption & accessibility parity** – captions, haptics, and audio mute
   toggles ride alongside the entries that triggered them, matching the
   logging/accessibility guidance.
4. **Replay-ready** – entries, filters, and scroll position serialize with
   `exportUiFrames`/parity reports so replays render the same console
   experience frame-for-frame on web and N64 targets.

## Layout & Regions

```
┌──────────────────────────────────────────────────────────────┐
│ Console Header                                                │
│ • Filter chips (All, Events, Checklist, Manual, Autopilot,    │
│   Audio, Resource, Score, System, Accessibility)              │
│ • Severity toggles (All, Notice, Caution, Warning, Failure)   │
│ • Search box + bookmark toggle                                │
├──────────────────────────────────────────────────────────────┤
│ Scrollback list                                               │
│ [timestamp] [category pill] message text …                    │
│ • Inline chips (event id, checklist id, cue id, actor)        │
│ • Caption transcript / PAD preview blocks                     │
│ • Optional waveform badge when audio cue triggered            │
├──────────────────────────────────────────────────────────────┤
│ Footer bar                                                    │
│ • “Jump to now” button when scrolled back                     │
│ • GET scrub summary (oldest/newest visible entries)           │
│ • Export/Copy controls (dev only)                             │
└──────────────────────────────────────────────────────────────┘
```

- **Header chips** display badge counts sourced from
  `missionLog.categories` / `missionLog.severities`. Counts update even
  when a filter is active so operators know how much was suppressed.
- **Scrollback entries** render newest-to-oldest (bottom anchored by
  default). The UI highlights the most recent entry (`missionLog.last…`)
  and shows a fade when the user scrolls away from “live” mode.
- **Footer** exposes navigation controls that mirror CLI shortcuts
  (jump-to-now, copy visible entries) while exposing GET bounds so crews
  know exactly which window they are reviewing.

## Data Binding

| UI Element | Source | Notes |
| --- | --- | --- |
| Filter badges | `ui_frame.missionLog.categories`, `ui_frame.missionLog.severities`, plus `filteredCount` | Badge counts show both total and filtered totals so users can see suppressed classes. |
| Scrollback entries | `ui_frame.missionLog.entries[]` | Each entry includes `timestampSeconds`, `timestampGet`, `category`, `severity`, `message`, `source`, `context`. Context drives inline chips (event/checklist IDs, cue IDs, PAD references, manual actors). |
| Live indicator | `ui_frame.missionLog.lastTimestampSeconds` and latest frame `time.getSeconds` | When `lastTimestampSeconds` < `frame.time.getSeconds - 5`, show “Paused” banner. |
| Audio badges | `ui_frame.audio` queue summaries | Entries tagged `category === 'audio'` display playback bus, cue ID, and ducking state. |
| Caption blocks | `context.caption` or `context.transcript` when present | Render transcript text beneath the log line, respecting caption verbosity settings. |
| Accessibility hints | `context.accessibility` payload | Inline chip showing caption mode, TTS playback status, or colour-contrast adjustments requested. |
| Search matches | Local filter against `entries` | Highlight rows whose message/context match query; also dim badge counts to reflect matches. |

The dock never mutates the log. Filters request a new snapshot from the
aggregator with the chosen category/severity/search parameters so parity
runs and CLI tooling observe identical subsets.【F:js/src/logging/missionLogAggregator.js†L42-L131】【F:js/src/hud/uiFrameBuilder.js†L463-L520】

## Interaction Model

| Action | Keyboard | Gamepad | N64 Mapping | Behaviour |
| --- | --- | --- | --- | --- |
| Toggle filter chip | `1`–`9` or click | `LB + face button` | `L + C-*` | Applies category filter via aggregator snapshot; badge pulse confirms active filter. |
| Toggle severity | `Shift+1`–`Shift+4` | `RB + face button` | `R + C-*` | Adds/removes severity filter; warning/failure chips pulse red/amber when active. |
| Search | `/` focuses search field | Virtual keyboard | `Start + B` | Incremental search highlights matches and updates footer summary (`filteredCount`). |
| Jump to now | `End` | `Y` | `C-Down` | Scrolls to newest entry, clears paused indicator. |
| Bookmark entry | `B` (with entry focused) | `X` | `C-Left` | Pins entry ID to workspace profile for later recall; bookmark badge appears in gutter. |
| Copy selection | `Ctrl+C` | `LB + Menu` | `L + Start` | Copies selected rows as plain text/JSON (dev mode). |
| Follow context | `Enter` | `A` | `A` | For entries with `eventId`/`checklistId`, jumps relevant pane (timeline, checklist lane) and logs `ui_input` action. |
| Toggle captions | `C` (while entry focused) | `RB + A` | `R + A` | Cycles caption verbosity (`off`, `brief`, `verbatim`), writing preference to accessibility settings. |

All interactions emit structured mission log entries tagged `source: 'ui'`
and `category: 'ui'` so parity harnesses replay the same focus, filter,
and acknowledgement actions.【F:js/src/logging/missionLogAggregator.js†L66-L131】

## Integration Hooks

- **Timeline ribbon:** selecting a console entry with `eventId`/`padId`
  scrolls the Navigation timeline to the corresponding marker and pulses
  the Always-On HUD checklist chip.
- **Checklist lane:** entries tagged `checklist` queue a preview in the
  Controls lane; acknowledging the checklist step clears the log entry’s
  caution tint.
- **Audio dispatcher:** `audio` entries show bus/priority metadata and a
  mute toggle that routes to the dispatcher’s per-bus gain controls while
  logging the acknowledgement for replay parity.
- **Manual queue monitor:** entries tagged `manual` expose “Retry” or
  “View queue” buttons when `context.status === 'failure'`. Selecting
  them focuses the manual queue timeline widget.
- **Scorecard:** `score` entries surface commander grade deltas and offer
  a “Mark reviewed” action that writes the acknowledgement back to the
  score system log.

## Accessibility & Captioning

The dock inherits baseline requirements from
[`logging_accessibility_guidelines.md`](logging_accessibility_guidelines.md):

- Caption playback follows cue priority and user-selected verbosity.
- Colour/shape coding for categories respects high-contrast mode
  (category pills add icons/hatching to differentiate).
- Screen-reader order follows chronological ordering regardless of
  visual scroll position; focus shortcuts cycle entries with ARIA live
  regions for new messages.
- Haptic metadata (`context.hapticPatternId`) surfaces in tooltip text so
  accessibility testers can confirm mapping without hardware.

## Persistence & Replay

- Workspace presets store active filters, search terms, bookmark IDs, and
  caption mode so layouts persist across sessions.
- `exportUiFrames` writes the visible log slice plus filter state into
  each frame’s metadata when `includeMissionLog` is enabled, enabling the
  replay viewer to reconstruct the same console view.
- Parity harness reports attach the filtered log diff when manual vs.
  auto runs diverge, making it easy to inspect the exact entry delta in
  the dock UI.

## Implementation Notes

1. The dock subscribes to the shared frame store and recomputes derived
   filters locally; when filters change it requests a fresh aggregator
   snapshot so counts stay synchronized across UI, CLI, and export
   tooling.【F:js/src/logging/missionLogAggregator.js†L66-L131】
2. Scrolling uses a virtualization list (web) or fixed window (N64) to
   keep performance predictable even when `maxEntries` is large (default
   1000). The viewport size matches the HUD layout spec.
3. Developer tooling exposes a “since GET” slider that forwards
   `sinceSeconds` into the aggregator, useful for capturing log slices
   for documentation/regression attachments.
4. Audio mute/acknowledge buttons delegate to the audio dispatcher but
   never drop the log entry—acknowledged cues remain visible with a
   strike-through badge so replays reflect the mute action.
5. When mission log ingestion encounters unknown categories or severities
   the dock still renders the entry, tagging it as `system`/`info` while
   logging a console warning so dataset authors can correct the source.

This specification ensures the console dock remains a primary mission
instrument: deterministic, accessible, and fully integrated with the
Apollo 11 simulator’s logging, audio, and replay toolchain.
