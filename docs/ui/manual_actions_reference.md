# Manual Interaction & Action Queue Contract

The presentation layer drives manual checklist acknowledgements, resource tweaks, and DSKY inputs through the deterministic `ManualActionQueue`. This reference documents the runtime contract so UI components, ingestion tooling, and regression harnesses schedule actions consistently with the simulator’s expectations.

## Execution Flow

1. The simulation context instantiates `ManualActionQueue` with pointers to the checklist manager and resource system whenever manual scripts are loaded or UI layers inject actions at runtime.【F:js/src/sim/simulationContext.js†L25-L143】
2. Actions are sorted by GET and evaluated every simulation tick. The queue tracks success, failure, and retry counts while logging each execution for post-run analysis.【F:js/src/sim/manualActionQueue.js†L16-L167】
3. Successful actions mutate mission state (acknowledging checklist steps, applying resource deltas, logging DSKY macros) and append entries to the queue’s history buffer so UI tooling can surface deterministic feedback to the player.【F:js/src/sim/manualActionQueue.js†L171-L317】
4. Optional retry windows let the UI enqueue steps slightly ahead of an event’s activation. The queue automatically defers execution until prerequisites resolve or the retry window closes.【F:js/src/sim/manualActionQueue.js†L101-L333】

The `ManualActionRecorder` mirrors this pipeline by capturing auto-driven steps, DSKY macros, and `workspace:*` events, grouping them into the same action schema while exposing a separate workspace timeline so parity runs and UI playback can reuse the data.【F:js/src/logging/manualActionRecorder.js†L1-L656】

## Action Schema

Each queue entry is a JSON object with a `type`, GET timestamp (`get` / `get_seconds`), optional identifier, and optional retry window. The queue normalizes field aliases (e.g., `tank` vs. `tank_key`) so UI code can follow the authoring conventions already used by manual scripts.【F:js/src/sim/manualActionQueue.js†L336-L605】 Key action types:

- **`checklist_ack`** – Acknowledge one or more pending checklist steps for an active event. Requires `event_id`; supports `count`, `actor`, `note`, and retry windows when the step may not yet be available.【F:js/src/sim/manualActionQueue.js†L360-L373】【F:js/src/sim/manualActionQueue.js†L171-L217】
- **`resource_delta`** – Apply an arbitrary effect payload (matching event success/failure JSON) to the resource model. Useful for scripted load sheds, cryo adjustments, or telemetry overrides.【F:js/src/sim/manualActionQueue.js†L220-L242】【F:js/src/sim/manualActionQueue.js†L375-L381】
- **`propellant_burn`** – Subtract propellant mass from a named tank (`csm_rcs`, `lm_descent`, etc.). Pounds are converted automatically; failures can be retried if the tank is momentarily unavailable.【F:js/src/sim/manualActionQueue.js†L244-L268】【F:js/src/sim/manualActionQueue.js†L382-L397】
- **`dsky_entry`** – Log a DSKY macro or verb/noun sequence along with optional register contents or keypress sequences. Entries always emit a mission log payload so UI panes and parity harnesses observe identical AGC inputs.【F:js/src/sim/manualActionQueue.js†L270-L317】【F:js/src/sim/manualActionQueue.js†L398-L426】

Refer to [`docs/data/manual_scripts/README.md`](../data/manual_scripts/README.md) for authoring examples. UI dispatchers can reuse the same JSON without additional wrapping.

## Scheduling & Retry Guidance

- **Immediate actions:** Use the current GET (or add a small offset ≤ one tick) when dispatching player interactions. The queue processes all ready actions before advancing the simulation clock, guaranteeing deterministic outcomes even when several steps trigger on the same tick.【F:js/src/sim/manualActionQueue.js†L84-L133】
- **Retry windows:** For checklist buttons that may be pressed before an event arms, attach `retry_window_seconds` so the queue retries until the window closes. The action fails only when the retry window expires without prerequisites resolving.【F:js/src/sim/manualActionQueue.js†L101-L205】【F:js/src/sim/manualActionQueue.js†L319-L333】
- **Sequencing:** When enqueuing multiple actions for the same GET (e.g., DSKY macro then checklist acknowledgement), set deterministic IDs so the queue can maintain insertion order via its internal sort (`internalId`).【F:js/src/sim/manualActionQueue.js†L76-L82】
- **Metrics & History:** Call `manualActionQueue.stats()` for HUD telemetry (pending vs. executed counts, acknowledgements, etc.) and `historySnapshot()` to feed timeline widgets or debugging overlays.【F:js/src/sim/manualActionQueue.js†L135-L151】

## UI Integration Points

- **Action dispatcher:** Wrap `manualActionQueue.addAction()` in a UI service so panel toggles, DSKY macros, and checklist buttons enqueue normalized actions. The dispatcher should attach `actor` identifiers (`CMP`, `CDR`, `UI`) to preserve crew attribution inside the mission log.【F:js/src/sim/manualActionQueue.js†L68-L121】【F:js/src/sim/manualActionQueue.js†L189-L217】
- **Recorder bridge:** When UI interactions occur, forward the same metadata to `ManualActionRecorder` so parity scripts and replay exports capture user-driven steps alongside the queue execution.【F:js/src/logging/manualActionRecorder.js†L32-L409】
- **Error surfacing:** Queue failures return reasons (`event_inactive`, `propellant_unavailable`, etc.) which the UI can surface via console toast or checklist tooltips by inspecting the latest history entry.【F:js/src/sim/manualActionQueue.js†L113-L205】
- **Persistence:** Manual action recordings include grouped checklist acknowledgements and DSKY entries with formatted GET labels. Exporting recorder output yields a ready-to-run script for regression harnesses or tutorial playback.【F:js/src/logging/manualActionRecorder.js†L189-L220】【F:js/src/logging/manualActionRecorder.js†L236-L409】

## Recommended UI Hooks

1. **Checklist lane:** When the player acknowledges a step, enqueue a `checklist_ack` action with the current GET and actor tag, then optimistically mark the step complete while listening for queue failure feedback.
2. **Panel toggles affecting resources:** For actions that toggle breakers or pumps outside of scripted effects, enqueue a `resource_delta` describing the expected change so the deterministic resource model aligns with the player’s intent.
3. **DSKY macro buttons:** Bind macros to `dsky_entry` actions pre-filled with registers and sequence lists drawn from [`docs/ui/dsky_reference.md`](dsky_reference.md). Display queue status (pending/executed) in the Controls view to reinforce deterministic AGC inputs.
4. **Parity tooling:** Offer a developer toggle that streams recorder output to disk, enabling rapid creation of manual scripts that mirror UI sessions and can be replayed via `npm run parity`.

Aligning UI dispatch logic with this contract keeps manual interactions deterministic, preserves parity between auto and manual runs, and readies the mission data for both the browser prototype and the future N64 build.
