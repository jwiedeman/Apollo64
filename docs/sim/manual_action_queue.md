# Manual Action Queue Architecture

The manual action queue bridges scripted crew activity with the
scheduler, resource, and guidance subsystems so manual and automated
runs share a deterministic contract. It executes checklist
acknowledgements, resource adjustments, propellant bookkeeping, and DSKY
macros at defined Ground Elapsed Times (GET) while preserving rich
telemetry for logs, scorekeeping, and upcoming UI work.【F:js/src/sim/manualActionQueue.js†L16-L156】

## Core Responsibilities

- **Deterministic scheduling.** Actions are normalized, sorted by GET,
and executed when the simulation clock reaches their window. Retry
windows and next-attempt timestamps allow scripts to follow events that
arm slightly later than the target time.【F:js/src/sim/manualActionQueue.js†L86-L143】
- **Mission system integration.** Checklist acknowledgements flow through
the `ChecklistManager`, resource deltas apply to the shared `ResourceSystem`,
propellant burns consume tank inventories, and DSKY entries drive the AGC
runtime when available so manual inputs mutate the same state as
autopilot and UI interactions.【F:js/src/sim/manualActionQueue.js†L184-L361】
- **Metrics & history.** The queue tracks scheduled, executed, retried,
and failed counts plus per-action-type tallies, exposing snapshots for
HUD frames, summaries, and scoring.【F:js/src/sim/manualActionQueue.js†L27-L156】

## Scheduling & Retry Behaviour

Each simulation tick advances the queue, executing every action whose
next attempt time is within epsilon of the current GET. Actions marked
for retry are rescheduled using either the simulation `dt` or the
configured retry interval, bounded by optional `retry_until` windows.
Failures with no remaining retry budget fall through to the history log
for later diagnostics.【F:js/src/sim/manualActionQueue.js†L94-L143】【F:js/src/sim/manualActionQueue.js†L364-L378】

The queue consumes JSON payloads either supplied directly or loaded from
a script on disk. `fromFile()` accepts arrays or `{ actions: [] }`
wrappers, validates structure, and emits a log line summarizing the
scheduled actions so parity harnesses and CLI runs surface script health
early.【F:js/src/sim/manualActionQueue.js†L47-L123】

## Supported Action Types

| Type | Effect | Notes |
| --- | --- | --- |
| `checklist_ack` | Acknowledges one or more steps for an active scheduler event via the checklist manager. Retries until the event arms or the retry window closes. | Logs actor/note metadata and increments acknowledgement metrics.【F:js/src/sim/manualActionQueue.js†L184-L234】 |
| `resource_delta` | Applies arbitrary power/propellant/thermal deltas against the resource system using the same shape as mission event effects. | Validates non-empty payloads and records metrics plus a mission log entry.【F:js/src/sim/manualActionQueue.js†L236-L261】 |
| `propellant_burn` | Deducts propellant from a named tank, retrying if the resource system rejects the usage (e.g., empty tank). | Normalizes tank identifiers and kg/lb quantities before recording consumption metrics.【F:js/src/sim/manualActionQueue.js†L264-L288】【F:js/src/sim/manualActionQueue.js†L405-L441】 |
| `dsky_entry` | Emits DSKY verb/noun payloads or macros, logging the action and forwarding it to the AGC runtime so manual runs exercise the same guidance path as automation. | Normalizes registers, key sequences, and macro IDs; logs for replay and stats accounting.【F:js/src/sim/manualActionQueue.js†L290-L361】 |

Normalization helpers ensure GET fields, macro identifiers, tank keys,
and numeric payloads conform to simulator expectations before the action
enters the queue. This keeps manual scripts resilient to formatting
variance while producing deterministic execution records.【F:js/src/sim/manualActionQueue.js†L381-L650】

## Runtime Integration

`createSimulationContext()` wires the queue alongside the scheduler,
resource system, autopilot runner, AGC runtime, HUD, and scoring stack.
Scripts may be injected programmatically or via `--manual-script`, and
the resulting queue is passed to the simulation loop, score system, and
HUD so every subsystem can observe manual actions in real time.【F:js/src/sim/simulationContext.js†L5-L198】

During the fixed-step loop `Simulation.run()` advances the manual action
queue before scheduler/resource updates, ensuring manual inputs have the
same effect ordering as live crew interactions. Manual stats feed the
halt summary, and HUD updates receive the queue reference for checklist
and overlay widgets.【F:js/src/sim/simulation.js†L4-L171】

## Logging, Recording, and Parity

Every executed action emits a structured mission log entry with
`logSource: 'sim'` / `logCategory: 'manual'`, preserving action IDs,
actors, and notes for replay analysis. The queue also exposes a history
buffer for debugging failures.【F:js/src/sim/manualActionQueue.js†L221-L361】

The optional `ManualActionRecorder` captures auto-advance checklist and
DSKY traffic, aggregates them into deterministic scripts, and can flush
those scripts to disk for parity replays or regression fixtures.【F:js/src/logging/manualActionRecorder.js†L5-L222】 Script
formatting guidelines and CLI usage live in the manual script reference,
which defines action schemas, retry semantics, and parity tooling so
authored scripts remain compatible with the queue.【F:docs/data/manual_scripts/README.md†L1-L156】

Together these components allow researchers to capture historical crew
workflows, replay them deterministically, and compare auto vs. manual
runs without diverging from the simulator’s single source of mission
truth.
