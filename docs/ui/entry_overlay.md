# Entry Corridor Overlay Specification

The entry corridor overlay extends the Milestone M3 presentation
layer so crews can monitor Apollo 11's transearth burns, corridor
alignment, blackout expectations, and recovery milestones without
leaving the Navigation or Systems views. It complements the
Always-On HUD described in `hud_layout.md`, honours the
checklist-driven rhythm defined in `checklists.json`, and keeps all
copy rooted in the timelines captured in `docs/data/events.csv`,
`pads.csv`, and the failure taxonomy.

## Design Principles

* **Mission timeline first.** Every element points back to an event,
  checklist step, PAD entry, or failure hook. The overlay never
  invents standalone timers or gauges.
* **Persistent situational awareness.** The Always-On HUD remains
  visible; the overlay augments the primary pane with corridor
  context and splashdown cues without obscuring GET, comms, or
  caution lamps.
* **Deterministic playback.** Overlay state must be reproducible
  from `ui_frame` snapshots, trajectory/history feeds, and mission
  logs so parity harnesses and the future N64 build match the browser
  prototype byte-for-byte.

## Activation States

| Stage | Trigger | UI Behaviour |
| --- | --- | --- |
| **Corridor Prep** | Event `RETURN_020` (Entry Update) arms and checklist `FP_8-20_ENTRY_UPD` activates. | Overlay appears in Navigation view with corridor bands, EMS tape preview, and PAD delta readouts. Systems view pins the comms tracker to DSN blackout handovers. |
| **Final TEI Review** | Event `RETURN_022` completes and the manual queue acknowledges the "Verify entry PAD" checklist step. | Burn widgets hide, replaced with corridor centreline, allowable angle bands, and drag/modulation predictions. |
| **Entry Interface** | GET ≥ `frame.entry.entryInterfaceSeconds` (derived from PAD) and event `ENTRY_001` arms. | Heat-rate gauge animates from predicted to measured; blackout countdown begins; Systems view locks the thermal panel into high-contrast mode. |
| **Blackout Window** | `communications.current.mode` equals `BLACKOUT` and event `ENTRY_002` is active. | Overlay dims telemetry except for inertial velocity, displays "Comm Blackout" banner, and pulses recovery ETA chip. |
| **Reacquisition / Drogue Deploy** | Mission log entry with category `telemetry` and tag `comms_reacquired`, or event `ENTRY_002` completes. | Overlay fades blackout banner, flashes "COMM AOS" cue, highlights recovery vessel badge, and resumes live G-load tape. |
| **Splashdown & Recovery** | Event `ENTRY_003` completes and checklist `FP_9-08_RECOVERY` is armed. | Overlay collapses corridor visuals, shows recovery timeline (swim team, hatch open, crew out), then hides once recovery checklist acknowledged. |

## Layout Regions

```
┌────────────────────────────────────────────────────────────────────┐
│ Always-On HUD (unchanged)                                          │
├─────────────┬───────────────────────────┬───────────────────────────┤
│ Corridor    │ EMS / G-Load & Range Tape │ Recovery Timeline         │
│ Bands       │                           │                           │
├─────────────┴───────────────────────────┴───────────────────────────┤
│ Timeline Scrubber with PAD markers & comm blackout band            │
└────────────────────────────────────────────────────────────────────┘
```

* **Corridor Bands (left column):**
  - Displays target entry angle with ±0.3° corridor limits and
    emergency lift-down corridor using data from `pads.csv` and
    `frame.entry.corridor`.
  - Shows current vs. predicted downrange and crossrange errors.
  - Colour shifts to caution (amber) when absolute error >70% of
    tolerance; warning (red) when exceeding tolerance and the failure
    taxonomy indicates `FAIL_ENTRY_CORRIDOR`.
* **EMS / G-Load & Range Tape (centre):**
  - Emulates the Entry Monitoring System scroll, plotting current
    velocity vs. altitude and predicted blackout span.
  - Displays live G-load bar with caution markers from
    `frame.entry.gLoad` and PAD maxima.
  - Includes range-to-splashdown countdown and residual velocity from
    `trajectoryStream`.
* **Recovery Timeline (right column):**
  - Lists recovery vessel, helicopter launch, swimmer drop, and crew
    egress steps tied to `ENTRY_003` checklist references.
  - Each chip links back to Systems view comms panel and logs
    acknowledgements.
* **Timeline Scrubber (bottom):**
  - Extends the Navigation ribbon with PAD markers (`PAD_ENTRY_001`),
    MCC-5 residuals, blackout start/end, and recovery anchor GETs.
  - Audio cue icons indicate when `audio_cues.json` callouts ("CapCom:
    you are Go for entry") fire.

## Data & Telemetry Inputs

| Source | Fields Used | Notes |
| --- | --- | --- |
| `ui_frame.entry` | Derived corridor data, blackout estimates, recovery schedule | New payload populated by `UiFrameBuilder` when entry events arm. |
| `docs/ui/entry_overlay.json` | Corridor offsets, blackout window, G-load thresholds, recovery milestones | Authoritative config consumed by the frame builder so Navigation/Systems overlays align with PAD timelines. |
| `ui_frame.resources.communications` | DSN mode, signal strength, blackout timers | Drives comm banner and Always-On HUD lamp sync. |
| `trajectoryStream` | Velocity, altitude, downrange, crossrange samples | Feeds EMS tape and corridor error calculations. |
| `resourceHistory.thermal` | Heat-rate trend proxy | Optional sparklines for Systems view toggles. |
| `missionLog` | Telemetry events (`comms_reacquired`, `drogue_deploy`) and failure breadcrumbs | Aligns overlay chips with logged cues. |
| `pads.csv` (`PAD_ENTRY_001`) | Target entry angle, blackout duration, splashdown coordinates | Normalized via `normalizePadParameters`. |
| `failures.csv` (`FAIL_ENTRY_CORRIDOR`, `FAIL_TEI_UNDERBURN`) | Corridor excursion warnings | Determines caution vs. warning severity. |

`UiFrameBuilder` must expose a deterministic `frame.entry` block:

```json
{
  "entryInterfaceSeconds": 507600.0,
  "corridor": {
    "targetDegrees": -6.50,
    "toleranceDegrees": 0.35,
    "currentDegrees": -6.42,
    "downrangeErrorKm": -12.4,
    "crossrangeErrorKm": 4.1
  },
  "blackout": {
    "startsAtSeconds": 507720.0,
    "endsAtSeconds": 507930.0,
    "remainingSeconds": 125.4
  },
  "ems": {
    "velocityFtPerSec": 36000,
    "altitudeFt": 250000,
    "predictedSplashdownSeconds": 508560.0
  },
  "gLoad": {
    "current": 3.8,
    "max": 6.7,
    "caution": 5.5,
    "warning": 6.3
  },
  "recovery": [
    { "id": "SWIMMER_DROP", "getSeconds": 508620.0, "status": "pending" },
    { "id": "HATCH_OPEN", "getSeconds": 508800.0, "status": "pending" }
  ]
}
```

## Interactions & Hotkeys

| Action | Desktop | Gamepad | N64 Mapping | Behaviour |
| --- | --- | --- | --- | --- |
| Toggle entry overlay | `E` | `RB + Y` | `R + C-Up` | Shows/hides overlay; state persists per workspace and logs mission entry. |
| Cycle recovery milestones | `Shift + Scroll` | `RB + Right Stick` | `R + C-Left/C-Right` | Focuses previous/next recovery chip; highlights matching checklist step. |
| Acknowledge blackout briefing | `Enter` | `A` (held) | `Start + A` | Marks blackout briefing reviewed; clears warning tint but does not silence comm alerts. |
| Request PAD replay | `P` | `LB + X` | `L + C-Down` | Emits manual queue `dsky_entry` for `V37N63` (EMS set) using PAD data; overlay shows replay badge until mission log confirms completion. |
| Mark splashdown confirmed | `Space` | `B` | `B` | Queues manual acknowledgement for recovery checklist; overlay collapses after confirmation. |

Overlay controls respect the accessibility baseline: high-contrast mode
adds hatch patterns to corridor bands, captions summarise audio cues, and
screen-reader regions mirror the Always-On HUD order so time-critical
metrics remain discoverable.

## Implementation Notes

1. `UiFrameBuilder` already attaches docking data; extend it to detect
   entry-related events and synthesise the `frame.entry` payload using
   PAD metadata, `trajectory` snapshots, and the structured config in
   `docs/ui/entry_overlay.json` so corridor offsets and G-load profiles
   stay deterministic.
2. Mission log aggregator should emit structured entries (`category:
   'entry'`) for blackout start/end, G-load exceedances, and recovery
   confirmations so the overlay and console dock stay in sync.
3. Validator (`npm run validate:data`) must confirm `entry_overlay`
   recovery IDs reference checklist steps or mission events, similar to
   existing docking gate checks.
4. Systems view modules reuse the same `frame.entry` data to highlight
   entry corridor gauges when the overlay is active, ensuring both panes
   share consistent telemetry.

This specification keeps the transearth finale grounded in mission
truth—PAD parameters, comm windows, failure consequences—while giving
players a deterministic, legible overlay for the most time-critical
minutes of the Apollo 11 mission.
