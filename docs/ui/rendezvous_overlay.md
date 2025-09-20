# Rendezvous & Docking Overlay Specification

The rendezvous overlay extends the Milestone M3 presentation layer so the
Navigation and Controls views can guide the Apollo 11 crew through LM ascent,
phasing, braking gates, and final docking. It ties directly to the Milestone M2
guidance goals (quantized RCS pulses, docking approach corridors) and keeps the
UI grounded in the mission checklists captured in `docs/ui/checklists.json` and
the event graph published in `docs/data/events.csv`.

## Design Principles

* **Procedural truth first.** Every cue on the overlay references an
  authoritative mission data source: rendezvous events, checklist steps, PAD
  parameters, or RCS propellant telemetry.
* **Three-pane rhythm.** The overlay is an augmentation of the Navigation and
  Controls panes—not a modal detour. The Always-On HUD continues to display GET,
  comms, and resource margins while the overlay adds docking-specific context.
* **Deterministic playback.** Overlay state must be reproducible from
  `ui_frame` snapshots, the attitude/trajectory streams, and mission logs so
  parity runs and eventual N64 replays match the browser prototype.

## Activation States

| Stage | Trigger | UI Behavior |
| --- | --- | --- |
| **Approach Planning** | `events.csv` entry `LM_ASCENT_020` arms and the
  checklist lane enters `FP_7-22_FINAL_APPROACH`. | Navigation view pins the
  rendezvous timeline, highlights braking gates (500 m, 150 m, 30 m), and shows
  phasing PAD deltas. Controls view primes the Docking panel with the current
  checklist step. |
| **Terminal Phase Initiation (TPI)** | Autopilot summary for `PGM_LM_ASCENT`
  marks SPS cutoff *and* the manual queue acknowledges the TPI checklist step. |
  Overlay displays the TPI vector chip (range, range rate, TIG) and activates
  the braking gate timers. |
| **Final Approach** | Range < 200 m and `FP_7-24_FINAL_APPROACH` steps are
  complete. | Docking reticle snaps into the navball inset, aligning pitch/yaw
  error needles to the docking target quaternion. Maneuver widget switches to a
  `DOCK` badge showing residual Δv and RCS usage for the current gate. |
| **Soft Dock** | Event `LM_ASCENT_030` completes. | Overlay logs a "SOFT DOCK" badge,
  pulses the master alarm lamp to indicate capture verification, and queues the
  post-docking checklist chip. |
| **Hard Dock/Latches** | Checklist step `FP_7-26_LM_DOCK` acknowledged. |
  Overlay fades range-rate indicators, keeps tunnel pressure gauge visible, and
  releases the Systems view to focus on repress/transfer tasks. |

## Overlay Regions

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Always-On HUD band (unchanged)                                               │
├─────────────┬───────────────────────────┬────────────────────────────────────┤
│ Gate Stack  │ Navball + Docking Reticle │ Range/Rate & RCS Capsule            │
├─────────────┴───────────────────────────┴────────────────────────────────────┤
│ Timeline Scrubber with Braking Gates & Audio Cue Markers                     │
└──────────────────────────────────────────────────────────────────────────────┘
```

* **Gate Stack (left rail):**
  - Shows the active braking gate (`500m`, `150m`, `30m`, `CONTACT`).
  - Each gate displays the required range rate, tolerance band, remaining time
    to gate, and checklist linkage (tap to jump the checklist lane).
  - Gate chip flashes yellow if range-rate error exceeds 25% of tolerance;
    flashes red when a failure hook from `failures.csv` fires.
* **Navball + Docking Reticle (center):**
  - Navball continues to render attitude gridlines.
  - Docking reticle overlay adds crosshair, closure needles, and a roll
    alignment tape derived from `attitudeStream`.
  - A "VHF LINK" badge appears when `communications.current.station` is not
    `VHF`, warning that docking radar data may be stale.
* **Range/Rate & RCS Capsule (right):**
  - Shows current range (m), closing rate (m/s), lateral rate, and predicted
    contact velocity.
  - RCS capsule displays quad status, average duty cycle in the last 60 seconds,
    propellant remaining vs. budget, and caution icons when a quad is disabled.
  - Manual input meter mirrors the Manual Action Monitor, listing queued pulses
    or throttle overrides pending execution.
* **Timeline Scrubber (bottom):**
  - Extends the Navigation timeline ribbon with gate markers, audio cue IDs,
    and autopilot termination points.
  - Scrubber highlights where voice callouts (`audio_cues.json`) trigger so
    designers can line up transcripts with gating.

## Data & Telemetry Inputs

| Data Source | Fields Used | Notes |
| --- | --- | --- |
| `ui_frame.events.upcoming` | Active rendezvous events, gate deadlines. |
| `ui_frame.autopilot.primary` | Current autopilot status, Δv residuals, RCS
  propellant usage per tank. |
| `ui_frame.resources.communications` | VHF link state, DSN conflict detection. |
| `trajectoryStream` | Range, range rate, lateral error, TPI vector, capture
  corridor geometry. |
| `attitudeStream` | Current quaternion, body rates for reticle alignment. |
| `resourceHistory.propellant` | 10-minute RCS usage trend for the capsule. |
| `missionLog` | Gate entry/exit events, checklist acknowledgements, autopilot
  transitions, audio cue triggers. |
| `panels.json` (`LM_RNDZ_PANEL`, `CSM_DOCKING_PANEL`) | Control states for
  docking aids; dependencies feed caution lamps. |
| `docking_gates.json` | Ordered gate definitions, target closure rates,
  checklist linkage. | Loaded by the HUD builder so the overlay mirrors the Flight Plan braking gates. |

`UiFrameBuilder` must populate a `frame.docking` block when rendezvous events
are armed:

```json
{
  "activeGate": "GATE_150M",
  "gates": [
    {
      "id": "GATE_500M",
      "rangeMeters": 500,
      "targetRateMps": -2.4,
      "tolerance": { "plus": 0.8, "minus": 0.4 },
      "deadlineSeconds": 356400.0,
      "checklistId": "FP_7-22_FINAL_APPROACH",
      "status": "complete"
    },
    {
      "id": "GATE_150M",
      "rangeMeters": 150,
      "targetRateMps": -0.9,
      "tolerance": { "plus": 0.3, "minus": 0.2 },
      "deadlineSeconds": 356520.0,
      "checklistId": "FP_7-24_FINAL_APPROACH",
      "status": "active"
    }
  ],
  "rangeMeters": 142.3,
  "closingRateMps": -0.92,
  "lateralRateMps": 0.12,
  "predictedContactVelocityMps": 0.37,
  "rcs": {
    "quads": [
      { "id": "LM_QUAD_A", "enabled": true, "dutyCyclePct": 12.4 },
      { "id": "LM_QUAD_B", "enabled": true, "dutyCyclePct": 9.8 }
    ],
    "propellantKgRemaining": { "lm_rcs": 112.4 },
    "propellantKgBudget": { "lm_rcs": 138.0 }
  }
}
```

## Interactions & Hotkeys

| Action | Desktop | Gamepad | N64 Mapping | Behavior |
| --- | --- | --- | --- | --- |
| Toggle docking overlay | `D` | `RB + B` | `R + C-Down` | Enables/disabled
  overlay; persists per workspace and logs `missionLog` entry. |
| Cycle gates | `Shift + Scroll` | `RB + Right Stick` | `R + C-Left/C-Right` |
  Focuses previous/next gate, scrolls checklist lane accordingly. |
| Pulse RCS fine rate | `F` | `RB + X` | `R + A` | Queues a manual action with
  `propellant_burn` payload referencing the active gate for telemetry. |
| Request autopilot assist | `Ctrl + A` | `LB + Y` | `L + C-Up` | Dispatches a
  manual queue entry toggling the docking autopilot; overlay shows assist badge. |
| Mark gate reviewed | `Enter` | `A` (held) | `Start + A` | Clears warning
  highlight without muting future alerts. Logs acknowledgement in mission log.

The overlay respects the accessibility guidance: high-contrast color palette,
caption feed for voice callouts (docking reticle includes textual cues), and
time-scrubbing limited to preview-only (no time warp).

## Audio & Failure Hooks

* Gate transitions trigger voice callouts (`audio_cues.json` IDs
  `callouts.rendezvous_gate_500`, `callouts.contact_light`).
* When `failures.csv` entries `FAIL_DOCK_APPROACH_FAST` or
  `FAIL_DOCK_PROP_LOW` latch, overlay shows animated caution bars and routes a
  caution tone via the audio dispatcher blueprint.
* Manual acknowledgement of a failure logs a "Gate override" entry and dims the
  caution until the checklist instructs corrective action.

## Acceptance Checklist

1. Activate `npm run export:ui-frames -- --until 110:00:00` and confirm exported
   frames include the `docking` block once the rendezvous sequence arms.
2. Replay the parity harness with the LM ascent manual script and verify
   overlay metrics (`range`, `closingRate`, gate statuses) match between auto
   and manual runs.
3. Trigger a deliberate over-speed at the 150 m gate; validate that
   `FAIL_DOCK_APPROACH_FAST` surfaces in the overlay, Systems view fault log,
   and audio dispatcher.
4. Toggle VHF power off via panel controls during final approach; overlay must
   raise the "VHF LINK" badge and the communications lamp should pulse caution.
5. Capture the overlay state via deterministic log replay to ensure N64 builds
   can reconstruct the same cues without running the full simulation loop.

Documenting the rendezvous overlay at this fidelity keeps the UI, audio, and
simulation layers synchronized as Milestones M2 and M3 come online, ensuring the
hardcore docking workflow remains authentic on both the browser and N64 builds.
