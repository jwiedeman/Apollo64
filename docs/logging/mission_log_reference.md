# Mission Log Architecture & Data Contract

The simulator treats the mission log as the canonical narrative of every
GET-stamped change in the mission state. This reference explains how log
entries are captured, normalised, and distributed so the CLI, HUD,
regression tooling, and future UI layers stay deterministic across web
and Nintendo 64 builds.

## Logging Pipeline

1. **Emission** – Subsystems call `MissionLogger.log(getSeconds, message,
   context)` to register events. Each entry stores the raw timestamp,
   string message, and arbitrary context payload. Unless `silent` is
   enabled, the logger mirrors the line to the console with a formatted
   GET prefix for developer runs.【F:js/src/logging/missionLogger.js†L5-L27】
2. **Persistence** – CLI sessions invoke `MissionLogger.flushToFile()`
   when `--log-file` is supplied, writing the collected entries to JSON
   so parity harnesses and analysts can diff logs between runs.【F:js/src/index.js†L1-L52】【F:js/src/logging/missionLogger.js†L29-L46】
3. **Aggregation** – `MissionLogAggregator` subscribes to the logger and
   converts raw entries into categorised records with unique IDs, GET
   strings, and filtered views. It retains the most recent `maxEntries`
   (default 1000) to keep HUD snapshots bounded.【F:js/src/logging/missionLogAggregator.js†L3-L110】

## Metadata Contract

`MissionLogAggregator` normalises context metadata so downstream
consumers do not need bespoke heuristics:

- **Categories** – `logCategory`, `category`, or `type` fields map to a
  curated set (`event`, `checklist`, `manual`, `autopilot`, `audio`,
  `ui`, `accessibility`, `entry`, `system`, `score`, `resource`). Unknown values
  fall back to `system` after keyword inspection of the message.【F:js/src/logging/missionLogAggregator.js†L9-L203】
- **Severities** – `logSeverity` or `severity` collapse onto the
  canonical `info`, `notice`, `caution`, `warning`, or `failure` bands.
  Messages lacking explicit metadata inherit the aggregator’s
  `defaultSeverity` (`info`).【F:js/src/logging/missionLogAggregator.js†L22-L229】
- **Sources** – `logSource` designates the emitting subsystem (`sim`,
  `ui`, `cli`, `replay`, `n64`, `audio`). Entries without a source tag
  default to `sim`, ensuring replay exports can distinguish between
  runtime and tooling noise.【F:js/src/logging/missionLogAggregator.js†L232-L251】
- **Identity** – Emitters may supply `logId` to guarantee stable IDs; if
  omitted the aggregator generates sequential `log-000001` style values
  so UI clients can diff entries across frames.【F:js/src/logging/missionLogAggregator.js†L118-L158】

Subsystems already emit metadata following this contract:

- `EventScheduler` reports arming, activation, completion, and failure
  transitions with `logCategory: 'event'` so procedures surface clearly
  in the log stack.【F:js/src/sim/eventScheduler.js†L110-L218】
- `ManualActionQueue` records manual overrides (`manual` category) with
  actor tags and retry reasons, keeping UI parity scripts in sync.【F:js/src/sim/manualActionQueue.js†L61-L252】
- `AutopilotRunner` logs engagement, abort, and summary lines under the
  `autopilot` category for guidance debugging.【F:js/src/sim/autopilotRunner.js†L46-L167】
- `ResourceSystem` adds `resource` updates and failure cascades so power,
  Δv, and communications alerts inherit structured metadata.【F:js/src/sim/resourceSystem.js†L347-L367】
- `Simulation.run()` records the final halt summary as a `system` entry,
  embedding aggregated stats (resource snapshot, score summary, mission
  log excerpt) for post-run analysis.【F:js/src/sim/simulation.js†L93-L141】

## Snapshot & Consumption Flow

Calling `MissionLogAggregator.snapshot()` returns the filtered entries,
category/severity counts, and the most recent timestamp. HUD builders
request snapshots with a configurable limit so UI panes can show the
latest log traffic while tracking how many entries were trimmed.【F:js/src/logging/missionLogAggregator.js†L58-L110】

`UiFrameBuilder` consumes either the aggregator or a raw entry list,
normalises each record (timestamps, default categories/sources), and
exposes summary statistics in the `missionLog` block alongside resource,
score, and communications telemetry. These frames back the text HUD,
export tooling, and upcoming browser/N64 presentations.【F:js/src/hud/uiFrameBuilder.js†L345-L508】

The simulation passes the aggregator through every HUD update tick and
includes a truncated snapshot in the returned summary, guaranteeing CLI
runs, automated tests, and exported UI frames all observe the same log
ordering.【F:js/src/sim/simulation.js†L34-L141】

## CLI & Export Workflow

`js/src/index.js` wires the logger/aggregator pair into the command-line
prototype: it announces startup configuration, runs the requested GET
window, prints the mission summary, and optionally writes the mission
log to disk. The exported JSON aligns with the aggregator contract, so
parity harnesses (`npm run parity`) and UI exporters can ingest the same
structure without additional transformation.【F:js/src/index.js†L1-L52】【F:js/src/sim/simulation.js†L93-L141】

## Authoring Guidelines

- Always include `logCategory`, `logSeverity`, and `logSource` when
  logging new events to avoid heuristic fallback and to keep the UI
  filters meaningful.
- Prefer concise messages with structured context instead of embedding
  JSON in the string; the aggregator preserves the context object for UI
  consumers.【F:js/src/logging/missionLogAggregator.js†L92-L110】
- Reuse existing categories where possible. If a new category is
  required, extend `KNOWN_CATEGORIES` and update any HUD filters that
  expect the canonical set.【F:js/src/logging/missionLogAggregator.js†L9-L203】
- Keep emission rates reasonable; while the aggregator trims to 1000
  entries, excessive chatter can still flood HUD panes and parity diffs.

This contract keeps the mission narrative consistent across the CLI,
HUD, regression harnesses, and future front-ends while anchoring every
line of telemetry to deterministic metadata.
