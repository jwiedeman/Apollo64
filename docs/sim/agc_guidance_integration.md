# AGC & DSKY Integration Blueprint

This blueprint describes how the simulator will emulate the Apollo Guidance Computer (AGC) and its DSKY interface so checklist-driven procedures, autopilot programs, and manual overrides remain deterministic across the JS prototype and the future N64 port. It extends the Milestone M1/M2 control-loop plans and the UI/DSKY data contracts by specifying runtime components, data flow, and validation hooks required to make AGC interactions a first-class part of the mission model.

## Goals

1. **Deterministic program execution** – mirror AGC program sequencing, register updates, and alarm surfaces using the same GET-timestamped mission truth that drives the scheduler and autopilot runner.
2. **Shared DSKY contract** – expose verb/noun display registers, keypad input, and macro dispatch through a single data/API surface consumed by the UI, CLI HUD, manual action queue, and autopilot scripts.
3. **Mission dataset parity** – reuse PAD, checklist, and failure taxonomy metadata so AGC operations inherit the same tolerances, prerequisites, and recovery hooks documented in the mission datasets.
4. **Replay & parity friendly** – ensure every AGC interaction is logged with context so manual vs. auto parity runs and future CI checks can diff behaviour byte-for-byte.

## Runtime Architecture

```
Event Scheduler / Autopilot Runner / ManualActionQueue
        │            │                     │
        └───────→ AGC Command Bus ────────┘
                        │
                AGC Runtime Core
                        │
        ┌───────────────┴───────────────┐
        │                               │
   DSKY Display Driver            Mission Log / Recorder
        │                               │
 UI Frame Builder ↔ HUD / UI      Parity Harness / Replays
```

### AGC Runtime Core
- Maintains program state (`currentProgram`, `majorMode`, `subMode`), critical registers (R1–R3, Delta-V accumulators, timers), and alarm flags.
- Executes a lightweight instruction scheduler that consumes high-level opcodes derived from PAD/checklist metadata (e.g., `LOAD_DV`, `LOAD_TIG`, `READ_RESIDUALS`, `SET_DAP_CONFIG`).
- Integrates with the orbit propagator and resource system to surface computed values such as Δv residuals, TIG countdowns, body rates, and range/rate predictions for rendezvous programs.
- Publishes derived telemetry back to the event scheduler (for success/failure checks) and the HUD (`UiFrameBuilder`) so UI widgets mirror DSKY registers.

### AGC Command Bus
- Normalises inputs from `ManualActionQueue` (`dsky_entry` actions), checklist auto-advance hooks, and autopilot scripts.
- Applies prerequisite guards declared in `docs/ui/dsky_reference.md` and `docs/ui/panels.json` before mutating AGC state, logging predicate failures as caution-class events.
- Supports queued macros (e.g., `V21N33` + `V21N38`) so Plan Burn workflows remain atomic even when manual inputs are interleaved with automation.

### DSKY Display Driver
- Mirrors the AGC register set into seven-segment style display payloads for the UI.
- Emits annunciator lamp state (PRO, KEY REL, OPR ERR, TEMP, GIMBAL LOCK) based on AGC runtime flags and failure taxonomy inputs.
- Produces keypad echo events so UI components and CLI logs show staged inputs before they are committed.

### Mission Logging & Replay Hooks
- Every AGC command, response, and alarm produces a structured mission log entry (`logSource: 'agc'`) with GET, verb/noun, macro ID, and payload.
- Manual action recorder captures AGC commands alongside checklist acknowledgements so parity runs replay both the manual and guidance streams simultaneously.
- Exported UI frames include `frame.agc` slices (registers, active macro queue, annunciator state) for UI prototyping and regression fixtures.

## Integration with Existing Systems

| System | Interaction | Notes |
| --- | --- | --- |
| Event Scheduler | Uses AGC state to gate event completion (e.g., verifying `Program 41` registers before declaring a burn ready). | Failure entries such as `FAIL_MCC2_PAD_MISSED` subscribe to AGC register updates to raise alarms immediately. |
| Autopilot Runner | Emits `agcCommand` messages when automation pre-fills PAD values or switches major modes (P30 ↔ P41 ↔ P63). | Runner waits for AGC acknowledgement (`PRO` lamp) before advancing to thrust commands. |
| ManualActionQueue | Queues `dsky_entry` actions that flow through the AGC command bus; retry windows respect event arming windows. | Metrics already count DSKY entries for parity reporting. |
| Resource System | Consumes AGC-generated Δv residuals and body-rate predictions to update resource margins and caution thresholds. | Δv shortfalls trigger the same `createFailureBreadcrumb` chain logged today. |
| HUD / UI | `UiFrameBuilder` attaches AGC register, program, and alarm state so Navigation/Controls views can render verb/noun displays and annunciators. | Always-On HUD checklist chip includes AGC macro hints supplied by the AGC runtime. |
| Score System | Records AGC alarm occurrences and PAD reload counts as part of the commander rating breakdown. | Manual bonus credits manual DSKY entries logged via AGC. |

## Data Dependencies

- **PAD datasets (`docs/data/pads.csv`)** supply TIG, Δv, and corridor parameters that macros load into the AGC.
- **Checklist metadata (`docs/data/checklists.csv`, `docs/ui/checklists.json`)** references `dsky_macro` IDs so procedures automatically queue the appropriate verbs/nouns.
- **Panel definitions (`docs/ui/panels.json`)** define prerequisite switch states (e.g., SPS banks armed) enforced before AGC commands mutate state.
- **DSKY macro catalog (`docs/ui/dsky_reference.md`)** remains the authoritative list of macros, labels, and prerequisite guards consumed by the command bus.
- **Failure taxonomy (`docs/data/failures.csv`)** includes AGC-related entries (PAD missed, program alarms) that subscribe to runtime events.

## Implementation Roadmap

1. **Phase A – Runtime Scaffold**
   - Implement AGC state container, register model, and annunciator tracking in the JS prototype (`js/src/sim/agcRuntime.js`, new module).
   - Expose a typed command bus API consumed by `ManualActionQueue` and `AutopilotRunner`.
   - Log commands/alarms through the mission logger and recorder, and surface basic register dumps in the CLI HUD.
2. **Phase B – PAD & Checklist Plumbing**
   - Wire PAD ingestion so `missionDataLoader` pre-computes opcode payloads (Δv vectors, TIG, duration) for AGC macros.
   - Update `validateMissionData` to ensure every checklist step referencing a DSKY macro maps to a defined AGC command and prerequisite controls.
   - Teach `AutopilotRunner` to wait on AGC acknowledgement events before executing burns, respecting the same tolerances as manual entry.
3. **Phase C – UI & HUD Integration**
   - Extend `UiFrameBuilder` with `agc` slices (registers, macro queue, annunciator lamps, program status) consumed by the Navigation navball overlay and Controls DSKY widget.
   - Add CLI HUD output summarizing active program, verb/noun, and alarms for long-running headless sessions.
   - Update `exportUiFrames` fixtures to include AGC state so front-end prototypes can render DSKY displays without connecting to a live sim.
4. **Phase D – N64 Alignment & Persistence**
   - Mirror the AGC runtime in the N64 workspace (libdragon module) with identical command payloads and annunciator logic.
   - Reserve Controller Pak storage for last-used AGC settings/macros so saved sessions persist DSKY state.
   - Document cross-platform nuances (e.g., reduced character set, annunciator lamp rendering) in the N64 port milestone doc.

## Validation Strategy

- **Unit tests** – cover command parsing, prerequisite enforcement, register updates, annunciator transitions, and error handling using synthetic PAD/checklist payloads.
- **Integration tests** – reuse parity harness to replay mission slices with AGC macros and confirm manual vs. automated runs produce identical AGC logs and register traces.
- **Dataset sweeps** – extend `npm run validate:data` to flag missing macros, undefined prerequisites, or PAD references lacking AGC payloads.
- **Mission drills** – run representative scenarios (TLI PAD load, MCC-2 update, LOI execution, P63/P64 handoff, entry corridor updates) and review AGC log/annunciator output against historical transcripts.
- **Failure exercises** – intentionally inject PAD omissions or incorrect entries to verify failure taxonomy triggers, annunciator lamps, and recovery checklist arming.

## Documentation & Handoff Notes

- Update `README.md` and `docs/PROJECT_PLAN.md` whenever AGC functionality lands so contributors know the runtime exists and how to interact with it.
- Keep `docs/ui/dsky_reference.md` and `docs/ui/checklists.json` synchronized with AGC runtime changes; include schema updates in `docs/ui/json_schemas.md`.
- When exporting new mission datasets, ensure provenance entries in `docs/data/provenance.md` cite the transcripts or PAD scans that informed AGC payloads.
- Coordinate with the audio dispatcher plan so AGC program alarms trigger the correct cue (`PROGRAM_ALARM`, `OPR_ERR`) and caption payloads.

This blueprint keeps AGC interactions anchored to the same deterministic mission data that drives the rest of the simulator, ensuring the DSKY feels authentic whether the run is automated, manually flown, or replayed months later on a Nintendo 64.
