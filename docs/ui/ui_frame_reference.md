# UI Frame Snapshot Reference

The JavaScript prototype emits normalized `ui_frame` payloads via
[`UiFrameBuilder`](../../js/src/hud/uiFrameBuilder.js). These snapshots supply the
Navigation, Controls, and Systems views with consistent mission state at each HUD
refresh. This reference documents the structure of the frame so future UI code,
ingestion notebooks, and the Nintendo 64 renderer consume the same schema.

## Frame Lifecycle

- **Builder:** `UiFrameBuilder` aggregates scheduler, resource, autopilot, checklist,
  and manual queue state. The builder runs inside the simulation loop (currently via
  `TextHud`) and can be instantiated independently for UI tests.
- **Cadence:** The builder itself has no internal timer; call `build(getSeconds, context)`
  whenever a new frame is required. The CLI HUD invokes it according to
  `renderIntervalSeconds` (default 600 s) and caches the latest frame for logging.
- **Determinism:** Inputs are read-only snapshots from the simulation systems. No
  builder method mutates upstream objects; consumers may safely cache frames for
  replay and parity checks.
- **Exporter:** The CLI at [`js/src/tools/exportUiFrames.js`](../../js/src/tools/exportUiFrames.js)
  records mission runs into ordered frame sequences (with metadata + summary) so UI
  prototyping, accessibility audits, and regression fixtures rely on the same
  `ui_frame` schema as the live HUD, now including the commander rating `score`
  block emitted during the run.

## Top-Level Shape

```json
{
  "generatedAtSeconds": 5400,
  "time": { "get": "001:30:00", "getSeconds": 5400, "met": "001:30:00", "metSeconds": 5400 },
  "events": { ... },
  "resources": { ... },
  "autopilot": { ... },
  "checklists": { ... },
  "manualQueue": { ... },
  "trajectory": { ... },
  "docking": { ... },
  "entry": { ... },
  "alerts": { "warnings": [], "cautions": [], "failures": [] },
  "audio": { ... },
  "score": { ... },
  "missionLog": { ... },
  "resourceHistory": { ... }
}
```

All numeric fields use SI units (seconds, kilograms, percent) unless noted.
Strings representing GET values are formatted as `HHH:MM:SS`.

`resourceHistory` appears only when the builder is configured with
`includeResourceHistory: true`. The payload mirrors
[`ResourceSystem.historySnapshot()`](../../js/src/sim/resourceSystem.js), providing
minute-resolution samples for power, thermal, propellant, and communications
metrics so trend widgets can consume the same telemetry as the HUD.

### `time`

| Field | Type | Description |
| --- | --- | --- |
| `getSeconds` | number | Ground elapsed time at frame generation. |
| `get` | string | Human-readable GET (`HHH:MM:SS`). |
| `metSeconds` | number | Mission elapsed time (currently identical to `getSeconds`). |
| `met` | string | Human-readable MET label. |

### `events`

| Field | Type | Description |
| --- | --- | --- |
| `counts.pending` | number | Scheduler events waiting to arm. |
| `counts.armed` | number | Events inside their start window but not yet active. |
| `counts.active` | number | Currently executing events. |
| `counts.complete` | number | Completed events. |
| `counts.failed` | number | Failed events. |
| `upcoming[]` | array | Next events (bounded by `upcomingLimit`, default 3). Each entry includes `id`, `phase`, `status`, `opensAt`, `opensAtSeconds`, `tMinusSeconds`, `tMinusLabel`, and `isOverdue`. |
| `next` | object&#124;null | Alias of `upcoming[0]` for convenience. |
| `next.pad` | object&#124;null | When present, summarizes the PAD metadata linked to the upcoming event (see PAD summary below). |

### `resources`

| Field | Type | Description |
| --- | --- | --- |
| `power.marginPct` | number&#124;null | Power margin percentage. |
| `power.loadKw` | number&#124;null | Current fuel-cell load (kW). |
| `power.outputKw` | number&#124;null | Aggregate fuel-cell output (kW). |
| `thermal.cryoBoiloffRatePctPerHr` | number&#124;null | Cryogenic boil-off rate. |
| `thermal.state` | string&#124;null | Thermal balance label (e.g., `PTC_STABLE`). |
| `thermal.ptcActive` | boolean&#124;null | Passive Thermal Control status. |
| `deltaV.totalMps` | number&#124;null | Remaining Δv margin across all propulsion stages (m/s). |
| `deltaV.totalBaseMps` | number&#124;null | Base Δv computed from current propellant loads before penalties/bonuses. |
| `deltaV.totalAdjustmentMps` | number&#124;null | Net adjustments applied by failures, manual penalties, or bonuses (m/s). |
| `deltaV.totalUsableMps` | number&#124;null | Total Δv theoretically available from configured stages (m/s). |
| `deltaV.usedMps` | number&#124;null | Δv consumed via propellant draw (m/s). |
| `deltaV.recoveredMps` | number&#124;null | Δv margin regained from propellant additions or positive adjustments (m/s). |
| `deltaV.primaryStageId` | string&#124;null | Stage the HUD should emphasize (defaults to `csm_sps` when present). |
| `deltaV.primaryStageMps` | number&#124;null | Δv margin for the emphasized stage (m/s). |
| `deltaV.csmSpsMps` | number&#124;null | Convenience alias for the CSM SPS stage margin. |
| `deltaV.legacyCsmSpsMps` | number&#124;null | Legacy SPS-only margin retained for backward compatibility. |
| `deltaV.stages` | object | Map of propulsion stage IDs to detailed margin entries (see below). |
| `propellant.tanks` | object | Keyed by tank (`csm_sps`, `csm_rcs`, `lm_descent`, `lm_ascent`, `lm_rcs`). Each entry reports `label`, `remainingKg`, `initialKg`, `reserveKg`, `percentRemaining`, `percentAboveReserve`, `status`, and `statusMessage`. |
| `propellant.metrics` | object | Aggregate burn totals accumulated during the run. |
| `lifeSupport.*` | number&#124;null | Oxygen (kg), water (kg), lithium hydroxide canisters, and CO₂ partial pressure (mmHg). |
| `communications.active` | boolean | Indicates whether a DSN pass is currently active. |
| `communications.nextWindowOpenGet` | string&#124;null | Upcoming DSN window GET label (`HHH:MM:SS`). |
| `communications.timeUntilNextWindowSeconds` | number&#124;null | Seconds until the next DSN pass opens (or `null` if none scheduled). |
| `communications.timeUntilNextWindowLabel` | string&#124;null | Human-readable countdown for the next DSN pass (e.g., `T-00:42:00`). |
| `communications.lastPadId` | string&#124;null | Identifier for the most recent PAD uplink. |
| `communications.scheduleCount` | number | Count of passes loaded from `communications_trends.json`. |
| `communications.current` | object&#124;null | Active DSN pass summary (see below). |
| `communications.next` | object&#124;null | Upcoming DSN pass summary (see below). |
| `alerts` | object | Lists warnings/cautions/failures derived from resource thresholds and mission failures. |

#### `communications.current`

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Active pass identifier. |
| `station` | string&#124;null | DSN station currently supporting the mission. |
| `nextStation` | string&#124;null | Planned handover station once the pass completes. |
| `openGet` / `closeGet` | string&#124;null | Window open/close labels (`HHH:MM:SS`). |
| `openSeconds` / `closeSeconds` | number&#124;null | Window open/close times in seconds. |
| `durationSeconds` | number&#124;null | Total scheduled duration for the pass. |
| `timeRemainingSeconds` | number&#124;null | Seconds remaining before the pass closes. |
| `timeRemainingLabel` | string&#124;null | Countdown label (e.g., `T-00:12:30`). |
| `timeSinceOpenSeconds` | number&#124;null | Seconds elapsed since the pass opened. |
| `timeSinceOpenLabel` | string&#124;null | Elapsed label formatted as `T+HHH:MM:SS`. |
| `progress` | number&#124;null | Normalized progress through the pass `[0,1]`. |
| `signalStrengthDb` | number&#124;null | Received signal strength in dB. |
| `downlinkRateKbps` | number&#124;null | Downlink rate for the pass. |
| `handoverMinutes` | number&#124;null | Planned handover duration. |
| `powerMarginDeltaKw` | number&#124;null | Power margin delta reported by the dataset. |
| `powerLoadDeltaKw` | number&#124;null | Load delta applied to the resource model while the pass is active. |

Each entry in `events.upcoming[]` now exposes `padId` (raw string) and `pad` (summarized object) so the UI can load TIG, Δv, attitude, and other PAD cues without re-querying the dataset.

#### `communications.next`

| Field | Type | Description |
| --- | --- | --- |
| `id` | string&#124;null | Identifier for the next DSN pass. |
| `station` | string&#124;null | Station expected to acquire the spacecraft. |
| `openGet` | string&#124;null | GET when the next pass opens. |
| `openSeconds` | number&#124;null | Seconds when the next pass opens. |
| `timeUntilOpenSeconds` | number&#124;null | Seconds until the next pass opens. |
| `timeUntilOpenLabel` | string&#124;null | Countdown label for the next pass. |

#### `resources.deltaV.stages.<stageId>`

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Stage identifier (e.g., `csm_sps`, `lm_descent`, `lm_ascent`). |
| `label` | string&#124;null | Human-readable stage label supplied by consumables data or runtime effects. |
| `marginMps` | number&#124;null | Remaining Δv margin for the stage after adjustments (m/s). |
| `baseMps` | number&#124;null | Base Δv computed from current propellant mass (m/s). |
| `adjustmentMps` | number&#124;null | Adjustment applied on top of the base margin (positive or negative). |
| `usableMps` | number&#124;null | Total usable Δv budget for the stage derived from consumables (m/s). |
| `percentAvailable` | number&#124;null | Remaining percentage of the stage's usable Δv budget. |
| `tank` | string&#124;null | Propellant tank key powering the stage (e.g., `csm_sps_kg`). |

### `autopilot`

| Field | Type | Description |
| --- | --- | --- |
| `active` | number | Count of currently running autopilot scripts. |
| `started` | number | Total autopilots started during the run. |
| `completed` | number | Total autopilots completed. |
| `aborted` | number | Total autopilots aborted. |
| `totalBurnSeconds` | number | Aggregate burn time. |
| `totalUllageSeconds` | number | Aggregate ullage time. |
| `totalRcsImpulseNs` | number | Aggregate RCS impulse delivered (Newton-seconds). |
| `totalRcsPulses` | number | Aggregate RCS pulse firings counted across all thrusters. |
| `propellantKgByTank` | object | Propellant consumption keyed by tank ID. |
| `activeAutopilots[]` | array | Up to `activeAutopilotLimit` entries summarizing active scripts (each entry now exposes `rcsPulses`, `rcsImpulseNs`, and `rcsKg`). |
| `primary` | object&#124;null | The active script with the smallest remaining time. |
| `primary.pad` | object&#124;null | PAD summary for the primary event when available. |
| `activeAutopilots[].pad` | object&#124;null | PAD summary for each active event, mirroring the structure described below. |

### `checklists`

| Field | Type | Description |
| --- | --- | --- |
| `totals.active` | number | Active checklist count. |
| `totals.completed` | number | Completed checklist count. |
| `totals.pending` | number | Pending checklist count. |
| `active[]` | array | Active checklist summaries (bounded by `activeChecklistLimit`). |
| `chip` | object&#124;null | Checklist chip metadata for the Always-On HUD (event ID, checklist ID, crew role, next step number/action, steps remaining, `autoAdvancePending`). |
| `active[].pad` | object&#124;null | PAD summary for each active event when a `pad_id` is defined. |
| `chip.pad` | object&#124;null | PAD summary for the chip-selected event when available. |

### `manualQueue`

Mirrors `ManualActionQueue.stats()` with counts for scheduled, pending, executed, failed, retried actions plus checklist acknowledgements and resource deltas injected by the manual queue.

### `trajectory`

Summarizes the current orbit state as reported by the patched-conic propagator.

| Field | Type | Description |
| --- | --- | --- |
| `body.id` / `body.name` | string&#124;null | Identifier/name for the active primary body (e.g., `earth`, `Earth`). |
| `altitude.meters` | number&#124;null | Radius minus body radius in meters. |
| `altitude.kilometers` | number&#124;null | Convenience conversion of altitude to kilometers. |
| `radiusKm` | number&#124;null | Distance from the primary body center in kilometers. |
| `speed.metersPerSecond` | number&#124;null | Current inertial speed. |
| `speed.kilometersPerSecond` | number&#124;null | Speed expressed in km/s. |
| `elements.eccentricity` | number&#124;null | Orbital eccentricity. |
| `elements.inclinationDeg` | number&#124;null | Inclination in degrees. |
| `elements.raanDeg` | number&#124;null | Right ascension of ascending node in degrees. |
| `elements.argumentOfPeriapsisDeg` | number&#124;null | Argument of periapsis in degrees. |
| `elements.trueAnomalyDeg` | number&#124;null | True anomaly in degrees. |
| `elements.periapsisKm` | number&#124;null | Periapsis altitude above the primary body (km). |
| `elements.apoapsisKm` | number&#124;null | Apoapsis altitude above the primary body (km) when defined. |
| `elements.semiMajorAxisKm` | number&#124;null | Semi-major axis in kilometers. |
| `elements.periodMinutes` | number&#124;null | Orbital period in minutes for bounded orbits. |
| `metrics.totalDeltaVMps` | number&#124;null | Cumulative Δv applied via recorded impulses (m/s). |
| `metrics.lastImpulse` | object&#124;null | Metadata for the latest applied Δv impulse (`magnitude`, `frame`, `appliedAtSeconds`). |
| `alerts` | object | Orbit-specific cautions/warnings (`orbit_periapsis_low`) and failures (`orbit_periapsis_below_surface`). These entries are merged into the top-level `alerts` buckets. |
| `history` | object&#124;null | Optional history sample payload (meta + samples) mirroring `OrbitPropagator.historySnapshot()`.

### `docking`

Optional rendezvous summary emitted when docking events are armed. The
structure mirrors [`docking_gates.json`](docking_gates.json) and the
runtime status consumed by the rendezvous overlay in
[`rendezvous_overlay.md`](rendezvous_overlay.md).

| Field | Type | Description |
| --- | --- | --- |
| `eventId` | string&#124;null | Event identifier associated with the docking sequence (`LM_ASCENT_030`, etc.). |
| `activeGateId` | string&#124;null | Identifier of the gate currently highlighted by the HUD (`GATE_150M`, etc.). |
| `startRangeMeters` / `endRangeMeters` | number&#124;null | Configured approach range endpoints pulled from `docking_gates.json`. |
| `notes` | string&#124;null | Reference notes or provenance copied from the gate definition pack. |
| `progress` | number&#124;null | Overall 0–1 fraction of the rendezvous timeline (derived from event windows or supplied status). |
| `rangeMeters` | number&#124;null | Current range between vehicles. |
| `closingRateMps` | number&#124;null | Relative closing rate (m/s). |
| `lateralRateMps` | number&#124;null | Cross-range rate (m/s). |
| `predictedContactVelocityMps` | number&#124;null | Forecast contact velocity based on current closure profile. |
| `gates[]` | array | Ordered braking gate definitions with live status metadata. |
| `rcs` | object&#124;null | Aggregated RCS quad enable states, duty cycles, and propellant budgets. |
| `version` | number&#124;null | Version marker propagated from `docking_gates.json` when present. |

Each entry in `gates[]` exposes:

| Field | Type | Description |
| --- | --- | --- |
| `id` / `label` | string | Identifier and human-readable label. |
| `rangeMeters` | number | Target range for the braking gate. |
| `targetRateMps` | number | Desired closing rate. |
| `tolerance` | object | `{ plus, minus }` tolerance bands (m/s). |
| `activationProgress` / `completionProgress` | number&#124;null | 0–1 fractions describing where the gate activates/completes within the sequence. |
| `checklistId` | string&#124;null | Linked checklist for highlighting in Controls view. |
| `deadlineSeconds` / `deadlineGet` | number&#124;string&#124;null | Calculated deadline for satisfying the gate. |
| `status` | string&#124;null | `pending`, `active`, `complete`, or `overdue`. |
| `progress` | number&#124;null | Live completion fraction. |
| `timeRemainingSeconds` | number&#124;null | Seconds remaining before the gate deadline elapses. |
| `completedAtSeconds` | number&#124;null | GET seconds when the gate completed. |
| `overdue` | boolean&#124;null | Indicates the deadline has passed without completion. |

The `rcs` object (when present) contains:

- `quads[]` – entries with `id`, `enabled`, and `dutyCyclePct`.
- `propellantKgRemaining` – map of tank → kilograms remaining.
- `propellantKgBudget` – map of tank → baseline docking budget (kg).

### `entry`

Frames now expose deterministic entry telemetry for the TEI → recovery
sequence, combining PAD metadata, the orbit snapshot, and the structured
overlay config in [`docs/ui/entry_overlay.json`](entry_overlay.json). The
payload powers the corridor overlay defined in
[`entry_overlay.md`](entry_overlay.md).

| Field | Type | Description |
| --- | --- | --- |
| `entryInterfaceSeconds` | number&#124;null | GET seconds for the predicted entry interface (`PAD_ENTRY_001`). |
| `entryInterfaceGet` | string&#124;null | GET label (`HHH:MM:SS`) for the predicted entry interface. |
| `corridor` | object&#124;null | Corridor geometry with pre-computed offsets driven by entry event status. |
| `corridor.targetDegrees` | number&#124;null | PAD flight-path angle target (degrees). |
| `corridor.toleranceDegrees` | number&#124;null | Corridor half-width (degrees) from overlay config. |
| `corridor.currentDegrees` | number&#124;null | Active corridor angle (degrees) after applying the current state offset. |
| `corridor.downrangeErrorKm` | number&#124;null | Estimated downrange error (km) for the current state. |
| `corridor.crossrangeErrorKm` | number&#124;null | Estimated crossrange error (km) for the current state. |
| `blackout` | object&#124;null | Comm blackout summary derived from the overlay config. |
| `blackout.status` | string&#124;null | `pending`, `active`, or `complete` relative to the blackout window. |
| `blackout.startsAtSeconds` | number&#124;null | GET seconds when blackout begins. |
| `blackout.startsAtGet` | string&#124;null | GET label for blackout start. |
| `blackout.endsAtSeconds` | number&#124;null | GET seconds when blackout ends. |
| `blackout.endsAtGet` | string&#124;null | GET label for blackout end. |
| `blackout.remainingSeconds` | number&#124;null | Seconds until blackout begins or ends (whichever is next). |
| `ems` | object&#124;null | Entry Monitoring System snapshot. |
| `ems.velocityFtPerSec` | number&#124;null | Current orbital velocity converted to ft/s (falls back to overlay target). |
| `ems.altitudeFt` | number&#124;null | Current orbital altitude converted to ft (falls back to overlay target). |
| `ems.predictedSplashdownSeconds` | number&#124;null | Predicted splashdown GET seconds from overlay config. |
| `ems.predictedSplashdownGet` | string&#124;null | GET label for predicted splashdown. |
| `gLoad` | object&#124;null | Current/max/caution/warning G-load metrics. |
| `gLoad.current` | number&#124;null | State-driven g-load approximation (g). |
| `gLoad.max` | number&#124;null | Expected peak g-load (g). |
| `gLoad.caution` | number&#124;null | Caution threshold (g). |
| `gLoad.warning` | number&#124;null | Warning threshold (g). |
| `recovery[]` | array | Ordered recovery milestones from the overlay config. |
| `recovery[].id` | string | Milestone identifier (e.g., `DROGUE_DEPLOY`). |
| `recovery[].label` | string&#124;null | Human-readable label for UI chips. |
| `recovery[].getSeconds` | number&#124;null | Nominal GET seconds for the milestone. |
| `recovery[].get` | string&#124;null | Nominal GET label for the milestone. |
| `recovery[].status` | string | `pending`, `acknowledged`, or `complete` based on GET offsets and event progress. |

When `entry` is absent the UI should continue rendering the standard
Navigation/System panes without the overlay.

### `alerts`


- `warnings[]`: Resource or failure conditions in warning state (e.g., low SPS propellant, cryo boil-off exceeding thresholds).
- `cautions[]`: Advisory conditions approaching warning levels.
- `failures[]`: Failure summaries (id, classification, trigger, immediate/ongoing penalties, recovery guidance, first/last GET stamps, occurrences, sources, notes) mirrored from the `ResourceSystem` failure registry along with breadcrumb metadata for HUD fault lanes.

#### `alerts.failures[]`

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Failure identifier from `docs/data/failures.csv`. |
| `classification` | string&#124;null | Taxonomy classification (Recoverable, Hard, Technical). |
| `trigger` | string&#124;null | Summary of the condition that latched the failure. |
| `immediateEffect` | string&#124;null | Immediate effect text pulled from the taxonomy or triggering effect metadata. |
| `ongoingPenalty` | string&#124;null | Ongoing penalty description when present. |
| `recoveryActions` | string&#124;null | Recommended recovery actions for the crew. |
| `firstTriggered` | string&#124;null | GET label for the first time the failure latched during the run. |
| `lastTriggered` | string&#124;null | GET label for the most recent occurrence. |
| `occurrences` | number&#124;null | Count of how many times the failure has been latched this run. |
| `sources[]` | array | Event IDs or subsystems that produced the failure. |
| `notes[]` | array | Additional notes captured by the resource system when the failure latched. |
| `breadcrumb` | object&#124;null | Optional breadcrumb summary with `summary` text and `chain[]` entries describing cause/effect nodes for HUD displays. |
| `metadata` | object&#124;null | Raw metadata object recorded with the failure (e.g., manual override details). |

### `audio`

Summarizes the audio cue pipeline so the HUD, caption layer, and future UI
widgets can react to binder triggers and dispatcher playback state. Lists are
bounded by the builder options `audioPendingLimit`, `audioActiveLimit`, and
`audioQueueLimit` (defaults: 8/4/4).

| Field | Type | Description |
| --- | --- | --- |
| `binder.totalTriggers` | number&#124;null | Total cue triggers recorded by the binder during the run. |
| `binder.pendingCount` | number&#124;null | Number of unresolved triggers still queued in the binder. |
| `binder.lastCueId` | string&#124;null | Last cue ID published to the binder. |
| `binder.lastTriggeredAtSeconds` | number&#124;null | GET seconds for the last binder trigger. |
| `binder.lastTriggeredAt` | string&#124;null | Human-readable GET label for the last trigger. |
| `dispatcher.played` | number&#124;null | Total cue playbacks started by the dispatcher. |
| `dispatcher.stopped` | number&#124;null | Total playbacks stopped (complete, pre-empted, or cancelled). |
| `dispatcher.suppressed` | number&#124;null | Cues dropped due to cooldown or concurrency rules. |
| `dispatcher.dropped` | number&#124;null | Cues dropped because queues exceeded configured limits. |
| `dispatcher.lastCueId` | string&#124;null | Last cue started by the dispatcher. |
| `dispatcher.lastStartedAtSeconds` | number&#124;null | GET seconds when the last cue started playback. |
| `dispatcher.lastStartedAt` | string&#124;null | Human-readable GET label for the last playback start. |
| `dispatcher.activeBuses` | object | Map of bus IDs to counts of currently active playbacks. |
| `dispatcher.queuedBuses` | object | Map of bus IDs to queued trigger counts. |
| `pending[]` | array&#124;null | Recent binder triggers awaiting dispatcher processing (fields include `cueId`, `severity`, `busId`, `sourceType`, `sourceId`, `triggeredAtSeconds`, `triggeredAt`, `metadata`). |
| `active[]` | array&#124;null | Current dispatcher playbacks (`cueId`, `busId`, `categoryId`, `severity`, `priority`, `loop`, `startedAtSeconds`, `startedAt`, `metadata`). |
| `queued[]` | array&#124;null | Normalized dispatcher queue entries ordered by priority and GET (`cueId`, `busId`, `severity`, `priority`, `triggeredAtSeconds`, `triggeredAt`, `metadata`). |

Each entry in `pending[]`, `active[]`, and `queued[]` includes
`triggeredAtSeconds`/`triggeredAt` (or `startedAtSeconds`/`startedAt` for
active playback) so caption overlays and automation tooling can align audio
cues with HUD updates without re-querying the dispatcher.

### `score`

Summarizes the commander rating aggregates maintained by the simulation
score system so UI components can display mission performance without
recomputing from raw telemetry.

| Field | Type | Description |
| --- | --- | --- |
| `missionDurationSeconds` | number&#124;null | Mission duration evaluated by the score system. |
| `events.*` | number&#124;null | Totals for scheduled, completed, failed, and pending events plus completion rate (`completionRatePct`). |
| `comms.*` | number&#124;null | DSN pass totals, completions, failures, and hit rate. |
| `resources.minPowerMarginPct` | number&#124;null | Minimum power margin observed. |
| `resources.maxPowerMarginPct` | number&#124;null | Maximum power margin observed. |
| `resources.minDeltaVMarginMps` | number&#124;null | Minimum Δv margin recorded. |
| `resources.maxDeltaVMarginMps` | number&#124;null | Maximum Δv margin recorded. |
| `resources.thermalViolationSeconds` | number&#124;null | Total seconds above thermal violation thresholds. |
| `resources.thermalViolationEvents` | number&#124;null | Number of distinct thermal violation events. |
| `resources.propellantUsedKg` | object | Aggregated propellant usage keyed by tank (kg). |
| `resources.powerDeltaKw` | object | Power deltas keyed by subsystem (kW). |
| `faults.eventFailures` | number&#124;null | Event failures counted by the score system. |
| `faults.resourceFailures` | number&#124;null | Resource failures counted by the score system. |
| `faults.totalFaults` | number&#124;null | Combined failure count. |
| `faults.resourceFailureIds[]` | array | Distinct failure IDs contributing to the totals. |
| `manual.manualSteps` | number&#124;null | Checklist steps acknowledged manually. |
| `manual.autoSteps` | number&#124;null | Checklist steps advanced automatically. |
| `manual.totalSteps` | number&#124;null | Total checklist steps assessed by the score system. |
| `manual.manualFraction` | number&#124;null | Fraction of manual checklist participation (0–1). |
| `rating.commanderScore` | number&#124;null | Commander score (0–100). |
| `rating.grade` | string&#124;null | Letter grade derived from the commander score. |
| `rating.baseScore` | number&#124;null | Base score before manual bonus. |
| `rating.manualBonus` | number&#124;null | Bonus applied for manual participation. |
| `rating.breakdown.*` | object&#124;null | Weight/score pairs for events, resources, faults, and manual contribution. |

### `missionLog`

Deterministic console feed assembled from the mission logger via the
[`MissionLogAggregator`](../../js/src/logging/missionLogAggregator.js). Entries
are ordered by GET and limited by the builder option `missionLogLimit`
(default 50) so the HUD console, export harness, and replay tools share the same
payload.

| Field | Type | Description |
| --- | --- | --- |
| `entries[]` | array | Mission log entries with `id`, `sequence`, `timestampSeconds`, `timestampGet`, `category`, `source`, `severity`, `message`, and `context`. |
| `totalCount` | number | Total entries retained by the aggregator during the run. |
| `filteredCount` | number | Count of entries included in this frame (bounded by `missionLogLimit`). |
| `categories` | object | Map of category → count for the filtered entries. |
| `severities` | object | Map of severity → count (`info`, `notice`, `caution`, `warning`, `failure`). |
| `lastTimestampSeconds` | number&#124;null | GET seconds for the most recent entry. |
| `lastTimestampGet` | string&#124;null | GET label (`HHH:MM:SS`) for the most recent entry. |

Each entry exposes the original simulator context (event IDs, autopilot IDs,
checklist references, etc.). Consumers should treat the nested `context` object
as read-only metadata and rely on `category`/`severity` for filtering and alert
styling. Simulator subsystems now tag mission log emissions with
`logCategory`, `logSeverity`, and `logSource` metadata so these fields
arrive pre-classified rather than inferred from the message string.

### `resourceHistory`

When present, this object mirrors `ResourceSystem.historySnapshot()` and exposes
time-series buffers for Systems view trend widgets.

- `meta.enabled` (boolean) – Whether tracking is active in the simulator.
- `meta.sampleIntervalSeconds` / `meta.durationSeconds` – Sampling cadence and
  retention window.
- `power[]` – Entries containing `timeSeconds`, `powerMarginPct`,
  `fuelCellLoadKw`, `fuelCellOutputKw`, `batteryChargePct`, and
  `reactantMinutes`.
- `thermal[]` – Entries containing `timeSeconds`,
  `cryoBoiloffRatePctPerHr`, `thermalState`, and `ptcActive`.
- `communications[]` – Entries containing `timeSeconds`, `active`,
  `currentPassId`, `currentStation`, `timeRemainingSeconds`,
  `timeSinceOpenSeconds`, `progress`, `nextPassId`,
  `timeUntilNextWindowSeconds`, `signalStrengthDb`, `downlinkRateKbps`, and
  `powerLoadDeltaKw`.
- `propellant.{tankId}[]` – Tank-specific arrays with `timeSeconds`,
  `remainingKg`, `initialKg`, `reserveKg`, `percentRemaining`, and
  `percentAboveReserve`.

## Customization Hooks

`UiFrameBuilder` accepts the same thresholds used by `TextHud`:

```js
const builder = new UiFrameBuilder({
  upcomingLimit: 5,
  warningPowerMarginPct: 25,
  activeChecklistLimit: 3,
  propellantKeys: ['csm_sps_kg', 'csm_rcs_kg', 'lm_descent_kg', 'lm_ascent_kg', 'lm_rcs_kg'],
});
```

Providing matching options to `TextHud` keeps console logging, HUD widgets, and
future browser/N64 views in lockstep.

## Usage Example

```js
const builder = new UiFrameBuilder();
const frame = builder.build(currentGetSeconds, {
  scheduler: simulation.scheduler,
  resourceSystem: simulation.resourceSystem,
  autopilotRunner: simulation.autopilotRunner,
  checklistManager: simulation.checklistManager,
  manualQueue: simulation.manualActionQueue,
});
console.log(frame.events.next, frame.resources.power);
```

Store or serialize frames as needed; they are deterministic summaries that can be
replayed for regression testing or UI development without rerunning the simulation.
#### PAD Summary Structure

`events.upcoming[].pad`, `autopilot.primary.pad`, `autopilot.activeAutopilots[].pad`, and
`checklists.*.pad` share a common structure derived from `pads.csv`:

| Field | Type | Description |
| --- | --- | --- |
| `id` | string&#124;null | PAD identifier (e.g., `PAD_TLI_002`). |
| `purpose` | string&#124;null | Human-readable PAD purpose description. |
| `delivery.get` | string&#124;null | GET when the PAD was delivered. |
| `delivery.getSeconds` | number&#124;null | Delivery GET expressed in seconds. |
| `validUntil.get` | string&#124;null | GET when the PAD expires. |
| `validUntil.getSeconds` | number&#124;null | Expiration GET expressed in seconds. |
| `source` | string&#124;null | Source reference for provenance. |
| `parameters.tig.get` | string&#124;null | TIG string from the PAD. |
| `parameters.tig.getSeconds` | number&#124;null | TIG converted to seconds. |
| `parameters.deltaVFtPerSec` | number&#124;null | Δv magnitude in ft/s when provided. |
| `parameters.deltaVMetersPerSecond` | number&#124;null | Δv magnitude in m/s (converted when only ft/s provided). |
| `parameters.burnDurationSeconds` | number&#124;null | Planned burn duration. |
| `parameters.attitude` | string&#124;null | Attitude callout from the PAD. |
| `parameters.rangeToTargetNm` | number&#124;null | Range-to-target (nm) when provided. |
| `parameters.flightPathAngleDeg` | number&#124;null | Flight path angle (degrees) when provided. |
| `parameters.vInfinityFtPerSec` | number&#124;null | Asymptotic velocity magnitude in ft/s when provided. |
| `parameters.vInfinityMetersPerSecond` | number&#124;null | Asymptotic velocity magnitude in m/s (converted when only ft/s provided). |
| `parameters.notes` | string&#124;null | Free-form notes captured with the PAD. |
| `parameters.raw` | object | Raw parameter payload parsed from `pads.csv`. |
