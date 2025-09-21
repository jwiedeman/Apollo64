# Commander Scorecard Specification

The commander scorecard turns the deterministic telemetry emitted by
`ScoreSystem` into a Systems-view dashboard that tracks mission grade,
resource margins, and manual participation in real time. It elaborates on
the Always-On HUD capsule described in [`hud_layout.md`](hud_layout.md)
and the data bindings listed in
[`view_data_bindings.md`](view_data_bindings.md) so the upcoming web UI
and Nintendo 64 build render identical score feedback using the
`ui_frame.score` payload documented in
[`ui_frame_reference.md`](ui_frame_reference.md).

## Goals

1. **Surface the score contract.** Visualise the base score, manual
   bonus, and grade calculated by `ScoreSystem` without recomputing from
   raw telemetry.
2. **Expose contributing factors.** Highlight how events, resources,
   faults, and manual participation influence the grade so crews know
   where to recover margin.
3. **Track history.** Show recent power/Δv minima, thermal violations,
   and manual-vs-auto cadence with timestamps to support mission review
   and parity logs.
4. **Cross-platform parity.** Keep layout, thresholds, and interactions
   feasible for both the browser prototype and libdragon HUD while
   logging every acknowledgement for replay scripts and commander
   progression tracking.

## Data Dependencies

| Source | Fields Used | Notes |
| --- | --- | --- |
| `ui_frame.score` | Grade, base score, manual bonus, metric breakdown, resource minima, fault counts, manual participation | Authoritative input; do not recompute weights client-side. |
| `ui_frame.score.history[]` | Time-indexed commander score samples with component breakdowns and deltas | Powers the rolling score timeline and contextual annotations. |
| `ui_frame.score.manual.timeline` + `timelineBucketSeconds` | Bucketed manual vs. auto step counts | Drives the manual participation sparkline and tooltip copy (5-minute buckets by default). |
| `ui_frame.score.rating.delta` | Latest score delta and grade-change metadata | Drives header toasts, mission log markers, and recovery recommendations. |
| `ui_frame.resources` | Live power/Δv margins, propellant status | Used for inline gauges and tooltips referencing current vs. minimum values. |
| `resourceHistory` (optional) | Minute-resolution power, Δv, thermal trends | Drives sparklines under the resource section; builder must enable history in export/debug modes. |
| `missionLog` | Score-change entries, fault breadcrumbs, manual acknowledgements | Provides context for sudden score drops and fuels the “Recent impacts” list. |
| `ProgressionService` summary (optional) | Unlock state, achievements tied to grade thresholds | Displayed in tooltip/secondary panel when available to show commander progression. |

## Layout Structure

```
┌──────────────────────────────────────────────────────────────┐
│ Grade Header  │ Manual Participation Gauge │ Score Timeline │
├──────────────────────────────────────────────────────────────┤
│ Event/Resource/Fault Breakdown Bars                          │
├───────────────┬──────────────────────────────┬───────────────┤
│ Resource Min   │ Manual vs. Auto Sparkline   │ Fault Ledger  │
│ Sparklines     │                             │               │
└───────────────┴──────────────────────────────┴───────────────┘
```

### 1. Grade Header
- Displays grade letter, commander score (0–100), base score, and manual
  bonus. Grade badge colour follows HUD palette (`A`=green, `B`=blue,
  `C`=amber, `D/F`=red) with high-contrast hatch support.
- Includes `missionDurationSeconds` formatted as `HHH:MM:SS` and the
  most recent score change delta (e.g., “−4.2 pts: SPS banks not armed”).
- Tooltip lists the weight table from `rating.breakdown` so players see
  exact percent contributions.

### 2. Manual Participation Gauge
- Radial or horizontal bar showing `manual.manualFraction` with ticks at
  25%, 50%, 75%. When manual fraction drops below the configured bonus
  threshold (default 10%), a caution icon appears alongside a tip to
  take manual control of upcoming checklists.
- Hover/focus surfaces raw `manualSteps` vs. `autoSteps`. N64 builds use
  stacked bars for clarity at low resolution.

### 3. Score Timeline
- Rolling 30-minute history built from `score.history[]` entries. Each
  sample includes GET, commander/base/manual scores, and the component
  breakdown from the score system so the UI can surface precise
  contributions without recomputing.
- When a history entry carries a `delta`, annotate the timeline with the
  label (e.g., “Manual bonus +1.0”, “Fault penalty −5.5”). Grade changes
  from `rating.delta` should pin a badge at the corresponding history
  sample.
- Clicking a marker scrolls the Systems view fault log to the matching
  mission log entry.

### 4. Breakdown Bars
- Three horizontal bars for events, resources, and faults using the
  normalised scores from `rating.breakdown`. Each bar shows current
  score, weight, and delta from previous frame.
- Bars include inline callouts when `events.completionRatePct` or
  `faults.totalFaults` cross thresholds (≥90% completion = success
  ribbon; ≥4 faults = warning).
- Manual contribution bar doubles as manual gauge when the Always-On HUD
  capsule is collapsed.

### 5. Resource Min Sparklines
- Two sparklines summarising `resources.minPowerMarginPct` and
  `resources.minDeltaVMarginMps` vs. current values from
  `ui_frame.resources`. Each sample references the GET from
  `resourceHistory` or falls back to the frame timestamp.
- Threshold bands (warning/caution) derive from `ScoreSystem`
  configuration to keep scoring and visuals in sync. When thermal
  violations occur, overlay hatch sections annotated with
  `resources.thermalViolationSeconds`.

### 6. Manual vs. Auto Sparkline
- Binary strip chart rendered from `score.manual.timeline`, using
  `timelineBucketSeconds` to size each bucket (defaults to 300 seconds
  when provided by the score system). Tooltips display
  `startGet`–`endGet` with the manual/auto counts for the bucket.
- When the timeline is empty (e.g., prior to the first manual action),
  collapse to a single bar reflecting the current
  `manual.manualFraction` so the widget still communicates participation.
- Live indicator pulses when a manual acknowledgement is pending in
  `frame.manualQueue`.

### 7. Fault Ledger
- Tabular list of `faults.resourceFailureIds` with severity, first/last
  GET (from mission log breadcrumbs), and recovery checklist reference.
- Entries support acknowledgement; selecting one marks the fault as
  reviewed (emits `ui:scorecard_ack`) and scrolls the Systems fault log.

## States & Thresholds

| Condition | Trigger | UI Response |
| --- | --- | --- |
| **Nominal** | Commander score ≥ 85 and no active warnings | Grade badge glows steady; score timeline uses neutral colour. |
| **Caution** | Commander score between 70–84 or manual fraction <10% | Badge pulses amber; manual gauge displays “Consider manual ops” tooltip; Always-On HUD capsule inherits caution tint. |
| **Warning** | Commander score <70 or `faults.totalFaults` ≥6 | Badge flashes red, scoreboard banner shows “Mission at risk” copy, audio dispatcher queues caution cue via `audio_cues.json`. |
| **Grade Change** | `rating.delta.gradeChanged` is `true` | Mission log receives `score:grade_change` entry; the scorecard header surfaces the delta payload (previous grade, new grade, commander score) for quick review. |

Thresholds come from `ScoreSystem` defaults (see
[`docs/scoring/commander_rating.md`](../scoring/commander_rating.md)) so
any tuning changes propagate automatically to the UI.

## Interactions & Logging

- **Acknowledge review:** Pressing the “Mark reviewed” button logs
  `ui_input` with `action: 'scorecard_ack'` and clears the caution tint
  until the next negative delta.
- **Drill into impacts:** Clicking timeline markers or breakdown callouts
  focuses the Systems fault log and checklist lane, helping crews recover
  missed steps.
- **Export snapshot:** Developer toggle writes the current scorecard
  slice into `exportUiFrames` metadata for regression comparisons.
- Every interaction emits mission log entries (`logSource: 'ui'`,
  `logCategory: 'score'`) so parity harnesses can replay acknowledgements
  and ensure scoring deltas remain deterministic.

## Implementation Checklist

1. Extend the Systems view renderer with `<CommanderScorecard />` using
   the layout above; reuse Always-On capsule styles for grade badges.
2. Subscribe to `ui_frame.score` and optional `resourceHistory`; cache
   the last N samples (default 6) for timeline/sparkline rendering.
3. Compare successive frames to compute score deltas; annotate mission
   log markers when the delta magnitude exceeds 1.0 point.
4. Wire manual gauge and breakdown bars to emit warnings based on
   thresholds derived from `ScoreSystem.summary()` metadata rather than
   hard-coded values.
5. Publish UI interactions through the input service so acknowledgements
   and drill-downs feed the mission log and manual action recorder for
   parity (`runParityCheck`) coverage.
6. For the N64 port, translate the same layout into tile-friendly
   display-list primitives (grade badge sprite, fixed-width bar charts);
   reuse colour ramps defined for the Systems view to minimise texture
   memory.

This specification anchors the commander scorecard to the simulator’s
scoring runtime, providing clear, deterministic feedback on mission
performance while remaining portable across the browser prototype and
future Nintendo 64 build.
