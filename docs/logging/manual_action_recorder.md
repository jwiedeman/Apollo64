# Manual Action Recorder & Replay Pipeline

The manual action recorder captures every checklist acknowledgement,
panel control change, and DSKY macro executed during a run so the
simulator can replay the same mission slice deterministically in parity
tests, UI prototypes, and future training modes. It complements the
manual action queue data contract and the mission log architecture by
exporting the exact actions that the auto crew performed (or that a
tester entered manually) as a JSON script ready to feed back into the
simulation.

## Recorder Instrumentation

`ManualActionRecorder` tracks four streams of inputs—checklist
acknowledgements, panel controls, DSKY entries, and workspace mutations—while keeping
roll-up metrics for reporting and regression
difs.【F:js/src/logging/manualActionRecorder.js†L1-L760】 The recorder
exposes lightweight `recordChecklistAck()`, `recordPanelControl()`,
`recordDskyEntry()`, and `recordWorkspaceEvent()` helpers so subsystems
can append GET-stamped
entries without knowing about the eventual export format. Workspace
events capture tile mutations, override toggles, and input remaps with
GET stamps, mirroring the mission log `workspace:*` entries for parity
tooling and CLI exports while preserving the rounded and quantized
coordinates produced by the workspace store so N64 exporters share the
same layout snapshots.【F:js/src/logging/manualActionRecorder.js†L201-L260】【F:js/src/hud/workspaceStore.js†L1-L740】

The recorder is wired into the simulation context at construction time,
allowing the checklist manager and autopilot runner to inject
observations as soon as they happen.【F:js/src/sim/simulationContext.js†L57-L120】
- The checklist manager calls `recordChecklistAck()` whenever a step is
  marked complete, capturing the event ID, checklist ID, step number,
  actor, GET timestamp, and optional note used for parity diagnostics.【F:js/src/sim/checklistManager.js†L326-L344】
- `PanelState` calls `recordPanelControl()` whenever a switch, guard,
  or indicator transitions, capturing actor metadata, previous state,
  and the exact GET so scripted replays can reproduce HUD and panel
  state transitions.【F:js/src/sim/panelState.js†L129-L248】
- The autopilot runner calls `recordDskyEntry()` for every scripted AGC
  command so replayed runs can mirror Verb/Noun pairs, registers, and key
  sequences exactly—even when automation triggered the macro.【F:js/src/sim/autopilotRunner.js†L432-L504】

Because the recorder sits beside the logger, workspace store, audio
binder, and HUD wiring inside `createSimulationContext()`, any new
subsystem can opt into recording without changing CLI plumbing.
Workspace history flows directly from `WorkspaceStore` into
`recordWorkspaceEvent()`, ensuring parity harnesses capture layout
changes alongside checklist automation.【F:js/src/sim/simulationContext.js†L24-L120】【F:js/src/hud/workspaceStore.js†L1-L740】

## Script Assembly & Metrics

During a run the recorder accumulates raw entries and tallies aggregate
metrics (auto vs. manual counts, per-event totals). When callers request
`buildScriptActions()` or `toJSON()`, the recorder:

1. Filters entries when `includeAutoActionsOnly` is enabled (default) so
   parity runs replay only the deterministic auto crew actions.
2. Sorts checklist acknowledgements by GET and event, grouping steps that
   fired within the same 1/20-second tick so a cluster of auto advances
   becomes a single `checklist_ack` action with a `count` field.
3. Converts panel controls into deterministic `panel_control` actions so
   recorded switch activity feeds directly into the manual action
   queue.【F:js/src/logging/manualActionRecorder.js†L221-L260】
4. Converts DSKY entries into deterministic `dsky_entry` actions that
   preserve macro IDs, Verb/Noun labels, register values, and keypress
   sequences.
5. Merges all streams, sorts them chronologically, and emits metadata
   summarising how many actions were recorded, when the script was
   generated, and which actor label the replay should attribute to the
   actions.【F:js/src/logging/manualActionRecorder.js†L123-L260】

The resulting JSON matches the manual action script contract documented
under `docs/data/manual_scripts/`, while the new `workspace[]` array
preserves tile, override, and input changes (including `quantized`/
`previous_quantized` snapshots) for replay tooling. A parallel `panel[]`
array mirrors recorded switch activity so parity runs and future HUD
prototypes can inspect panel history without rehydrating scripts. Parity
runs can ignore the supplemental arrays when feeding actions into the
manual queue or use them to reconstruct HUD layouts and panel states for
deterministic UI and N64 playback.【F:js/src/logging/manualActionRecorder.js†L321-L401】

## CLI Workflow

The CLI entrypoint enables the recorder whenever the user passes
`--record-manual-script <file>`. `index.js` constructs the recorder,
threads it into the simulation context, and, once the run completes,
serialises the aggregated actions to disk with human-readable formatting.
The CLI prints a short summary so testers know how many actions were
captured and where the JSON landed.【F:js/src/index.js†L28-L116】

During the same session testers can supply `--manual-script <file>` to
load a previously recorded script. The simulation context will hydrate a
`ManualActionQueue` from the file and replay the scripted actions instead
of auto-advancing checklist steps, guaranteeing the manual run follows
the same sequence that the recorder captured earlier.【F:js/src/sim/simulationContext.js†L103-L120】

## Parity Harness Integration

`npm run parity` invokes the recorder automatically. The harness runs an
auto-advance pass with the recorder attached, converts the captured
actions into a script, then replays those actions through a second run
with manual advancement disabled. Finally it compares summaries, logs,
and optional progression profiles to flag any divergence. The parity
report includes the recorder statistics and the generated action list so
regression diffs have concrete artefacts to inspect.【F:js/src/tools/runParityCheck.js†L84-L193】

## Future UI & Analytics Hooks

Because the recorder emits actor labels, optional notes, and per-event
counts, future UI work can surface “auto vs. manual” breakdowns in HUD
panes or commander scorecards without reprocessing mission logs. Replay
scripts also allow manual test cases—such as alternate PADs or fault
injections—to be shared between the CLI, browser prototype, and eventual
N64 build while remaining faithful to the Apollo procedures captured in
the mission datasets.
