# UI Component Architecture Blueprint

This blueprint captures how the JavaScript prototype will organize the
Navigation, Controls, Systems, and Tile Mode presentations around the
shared `ui_frame` contract. It complements [`hud_layout.md`](hud_layout.md)
by focusing on component boundaries, update cadence, and the data flows
that keep the three-pane rhythm aligned with mission truth.

## Goals

- Present a deterministic, low-latency view of mission state that mirrors
the Apollo checklist cadence documented in `docs/PROJECT_PLAN.md`.
- Keep the Always-On HUD visible across Navigation/Controls/Systems/Tiles
  so GET, upcoming events, Δv, resources, and alarms remain in view.
- Reuse the same component tree for the web and N64 builds, differing only
  in the rendering primitives (DOM/Canvas vs. libdragon line lists).
- Allow rapid focus shifts (keyboard/controller hotkeys) without tearing
  or desynchronizing with the simulation loop.

## Frame Ingestion Pipeline

1. **Simulation Loop:** `Simulation.run()` advances the mission at a fixed
   tick rate (default 20 Hz) and notifies the HUD layer once per
   `renderIntervalSeconds` (default 600 s for the CLI, lower for the visual
   HUD).
2. **UiFrameBuilder:** `hud/uiFrameBuilder.js` snapshots scheduler,
   resource, checklist, manual action, and autopilot state into a
   deterministic `ui_frame` payload (see
   [`ui_frame_reference.md`](ui_frame_reference.md)).
3. **Presentation Store:** The UI keeps a read-only store (immutable frame
   cache) keyed by `generatedAtSeconds`. Views subscribe to the latest
   frame; diffing happens at the pane boundary so widgets only re-render
   when their subtree changes.
4. **Renderers:** Navigation, Controls, Systems, and Tile Mode renderers
   consume the normalized frame plus pane-specific derived data (e.g.,
   plotted trajectories, checklist callouts).

All panes treat `ui_frame` as the single source of truth. Side effects
(switch toggles, DSKY macros) dispatch actions back to the simulation via
an input bus that mirrors the `ManualActionQueue` so manual/autopilot
parity stays intact.

## Component Tree Overview

```
<App>
  <AlwaysOnHud>
    <TimeBlock />
    <EventStack />
    <ResourceBands />
    <ManeuverWidget />
    <ChecklistChip />
    <CommsLamp />
    <AlarmCluster />
  </AlwaysOnHud>
  <ViewRouter>
    <NavigationView /> | <ControlsView /> | <SystemsView />
  </ViewRouter>
  <TileWorkspace />
  <ConsoleDock />
  <HotkeyOverlay />
</App>
```

- **App:** Bootstraps frame subscription, keyboard/controller bindings,
  and persistence (workspace JSON, checklist completion).
- **AlwaysOnHud:** Anchored band that never unmounts. Consumes the time,
  events, resources, communications, and alerts slices of the frame. Lamp
  states (caution/warning/failure) inherit resource thresholds from the
  `ResourceSystem`.
- **ViewRouter:** Switches between Navigation/Controls/Systems panes.
  `Tab`/`Shift+Tab` (or controller shoulder buttons) advance views; `1/2/3`
  jump directly.
- **TileWorkspace:** Hidden by default; toggled via `T`. Inherits the same
  widget components but wraps them in a draggable/resizable manager that
  saves presets to `workspaces.json`.
- **ConsoleDock:** Scrollback log for mission events, autopilot transitions,
  manual queue actions, and audio cue triggers. Chips filter by category
  (All / Events / Autopilot / Audio / Failures).
- **HotkeyOverlay:** Briefly surfaces when users invoke shortcuts, aiding
  learnability and controller remapping.

## Navigation View

| Region | Components | Data Bindings |
| --- | --- | --- |
| Trajectory Canvas | `<TrajectoryPlot />` | `frame.events.upcoming`, mission ephemeris stream (patched conics) |
| Navball / Attitude | `<Navball />`, `<PtcIndicator />` | `frame.autopilot`, `frame.resources.thermal`, attitude quaternions |
| State Vector | `<StateVectorPanel />` | `frame.resources.deltaV`, guidance errors, current burn metrics |
| Timeline Ribbon | `<TimelineRibbon />` | Scheduler history, upcoming events (5-entry window) |

Interactions push actions onto the manual queue: selecting a timeline
marker focuses the checklist and primes DSKY macros.

## Controls View

| Region | Components | Data Bindings |
| --- | --- | --- |
| Panel Rail | `<PanelList />` | Checklist metadata, `panels.json` hierarchy |
| Active Panel | `<PanelDiagram />`, `<SwitchTooltip />` | Panel control states, checklist highlights, dependencies |
| DSKY | `<DskyShell />`, `<VerbNounDisplay />` | AGC program state, macro previews, manual input buffer |
| Checklist Lane | `<ChecklistScroller />`, `<StepCard />` | Active checklist from `frame.checklists`, manual queue feedback |

DSKY macros validate required switch states (`panels.json` dependencies)
before dispatching AGC commands. Failed predicates light the relevant
controls and surface recovery hints.

## Systems View

| Region | Components | Data Bindings |
| --- | --- | --- |
| Power Buses | `<PowerGrid />` | `frame.resources.power`, fuel cell telemetry, caution thresholds |
| Propellant Overview | `<PropellantDeck />` | Tank metrics (`frame.resources.propellant.tanks`), burn totals |
| Thermal / Cryo | `<ThermalPanel />` | Cryo boiloff, tank temperatures, PTC status |
| Comms Windows | `<CommsSchedule />` | `frame.resources.communications.current/next`, DSN availability |
| Trends & Fault Log | `<TrendGraphs />`, `<FaultTimeline />` | Resource history buffers, mission failures |

## Tile Mode Windows

Tile Mode reuses the widgets above as draggable tiles. Layout metadata
comes from `workspaces.json`; users can save/load presets. Focus mode
fills the viewport with a single tile while the Always-On HUD remains
pinned per the instructions in [`AGENTS.md`](AGENTS.md).

## Update Cadence & Performance Targets

- **Frame Rate:** The interactive HUD targets 20 Hz updates; heavy charts
  (trajectory plot, trend graphs) may internally throttle to 5–10 Hz while
  interpolating between frames.
- **Animation Budget:** Transitions and tile drags aim for <8 ms/frame on
  desktop browsers, leaving headroom for simulation work. N64 builds budget
  ≤1 ms of RSP time for HUD line lists per frame.
- **Diff Strategy:** Widgets compare shallow hashes of their frame slices
  to avoid re-rendering unchanged data. Manual queue acknowledgements feed
  optimistic UI updates, rolling back if the simulation rejects an action.

## Accessibility Hooks

- Keyboard/controller mappings follow the hotkey guide in
  [`AGENTS.md`](AGENTS.md) and `hud_layout.md`. Tooltips display shortcut
  hints when users hover or focus interactive controls.
- High-contrast mode swaps the HUD palette and thickens vector strokes.
  The toggle lives in the Console Dock menu and persists in workspace
  presets.
- Checklist narration exposes SR-friendly status strings (e.g.,
  “Checklist: P52 Realign, Step 4 of 9, Awaiting IMU Gimbal Null”). Voice
  playback hooks route through the audio dispatcher detailed in
  [`audio_cue_taxonomy.md`](audio_cue_taxonomy.md).

## Persistence & Replay

- **Workspace State:** Saved to `workspaces.json` via the ingestion
  pipeline so curated layouts ship with the game while players can export
  personal presets.
- **Checklist Progress:** Stored per mission run in log files, enabling the
  parity harness to replay manual sessions with identical UI state.
- **Console Log:** Frame-aligned entries allow replay tooling to reconstruct
  HUD panels and audio cues deterministically, satisfying Milestone M3
  regression requirements.

This architecture keeps mission truth centralized, ensures the Always-On
HUD remains authoritative, and prepares both the web and N64 builds for
shared UI assets without duplicating logic per platform.
