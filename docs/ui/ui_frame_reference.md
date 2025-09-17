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
  "alerts": { "warnings": [], "cautions": [], "failures": [] }
}
```

All numeric fields use SI units (seconds, kilograms, percent) unless noted.
Strings representing GET values are formatted as `HHH:MM:SS`.

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

### `resources`

| Field | Type | Description |
| --- | --- | --- |
| `power.marginPct` | number&#124;null | Power margin percentage. |
| `power.loadKw` | number&#124;null | Current fuel-cell load (kW). |
| `power.outputKw` | number&#124;null | Aggregate fuel-cell output (kW). |
| `thermal.cryoBoiloffRatePctPerHr` | number&#124;null | Cryogenic boil-off rate. |
| `thermal.state` | string&#124;null | Thermal balance label (e.g., `PTC_STABLE`). |
| `thermal.ptcActive` | boolean&#124;null | Passive Thermal Control status. |
| `deltaV.totalMps` | number&#124;null | Remaining Δv margin (m/s). |
| `deltaV.usedMps` | number&#124;null | Δv consumed via SPS propellant draw (m/s). |
| `deltaV.recoveredMps` | number&#124;null | Δv margin regained from propellant additions (m/s). |
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

#### `communications.next`

| Field | Type | Description |
| --- | --- | --- |
| `id` | string&#124;null | Identifier for the next DSN pass. |
| `station` | string&#124;null | Station expected to acquire the spacecraft. |
| `openGet` | string&#124;null | GET when the next pass opens. |
| `openSeconds` | number&#124;null | Seconds when the next pass opens. |
| `timeUntilOpenSeconds` | number&#124;null | Seconds until the next pass opens. |
| `timeUntilOpenLabel` | string&#124;null | Countdown label for the next pass. |

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

### `checklists`

| Field | Type | Description |
| --- | --- | --- |
| `totals.active` | number | Active checklist count. |
| `totals.completed` | number | Completed checklist count. |
| `totals.pending` | number | Pending checklist count. |
| `active[]` | array | Active checklist summaries (bounded by `activeChecklistLimit`). |
| `chip` | object&#124;null | Checklist chip metadata for the Always-On HUD (event ID, checklist ID, crew role, next step number/action, steps remaining, `autoAdvancePending`). |

### `manualQueue`

Mirrors `ManualActionQueue.stats()` with counts for scheduled, pending, executed, failed, retried actions plus checklist acknowledgements and resource deltas injected by the manual queue.

### `alerts`

- `warnings[]`: Resource or failure conditions in warning state (e.g., low SPS propellant, cryo boil-off exceeding thresholds).
- `cautions[]`: Advisory conditions approaching warning levels.
- `failures[]`: Failure summaries (id, classification, trigger, immediate/ongoing penalties, recovery guidance, first/last GET stamps, occurrences, sources, notes) mirrored from the `ResourceSystem` failure registry.

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
| `metadata` | object&#124;null | Raw metadata object recorded with the failure (e.g., manual override details). |

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
