# Apollo 11 Mission HUD & View Layout Specification

This document translates the high-level Milestone M3 goals into a concrete HUD and pane layout plan for the browser prototype. It assumes the deterministic simulation core from Milestone M1 and the guidance/RCS hooks planned for Milestone M2 are publishing real-time state snapshots. The layout honors the three-view rhythm (Navigation, Controls, Systems) while keeping the Always-On HUD present across every configuration, including tile mode.

## Always-On HUD (All Views)

The always-on band reserves 64 px at the top of a 1280×720 baseline frame (scaling down to 320×180 for the N64 target). It renders on a separate canvas layer so it can remain visible during pane transitions, popovers, and tile focus mode.

| Region | Contents | Data Source | Interaction Notes |
| --- | --- | --- | --- |
| Time & Event Block | GET, MET, mission phase label, countdown to next critical event, real-time rate indicator (1× / paused / 2×). | Scheduler stats (`formatGET`, `events.upcoming[0]`), simulation clock. | Clicking countdown jumps to the event detail pane. Rate indicator doubles as pause toggle. |
| Maneuver Summary | Current maneuver type (`PTC`, `Burn`, `Docking`, `Entry`), Δv remaining, TIG countdown or roll-rate tape, autopilot state (active / manual). | Autopilot runner stats, resource system metrics (Δv margin, PTC roll). | Clicking toggles the detailed maneuver widget in the active pane; manual mode flashes when throttles or RCS pulses originate from manual queue. |
| Resource Strip | Horizontal gauges for power margin %, thermal drift, SPS propellant %, RCS propellant %, communications window timer. | Resource system snapshot (`power_margin_pct`, `cryo_boiloff_rate_pct_per_hr`, propellant `percentRemaining`, communications `next_window_open_get`). | Gauges pulse yellow/red when crossing caution/warning thresholds defined in `TextHud`. Hover reveals precise values and links to Systems view panels. |
| Checklist Chip | Active checklist id/title, completed steps / total, checklist owner (CDR/CMP/LMP). | Checklist manager stats. | Clicking chips toggles the checklist lane in Controls view or, in tile mode, opens a floating checklist tile. |
| Alert Tray | Caution/warning icons with counts, master alarm indicator, current failure breadcrumb (e.g., “PTC drift → cryo ↑”). | Resource alerts, failure taxonomy feed. | Clicking icon opens the fault log overlay in Systems view; master alarm button silences audio but leaves alert highlighted until resolved. |
| Commander Rating Capsule | Commander score, grade, and manual bonus bar condensed into a chip with tooltip showing completion stats. | `frame.score.rating` and `frame.score.manual`/`frame.score.events` for tooltip copy. | Clicking opens the Systems view scorecard tile; controller long-press pins the scorecard in tile mode. |
| PTC / Attitude Indicator | Miniature navball slice showing roll relative to 0.3°/s target, comm link strength icon. | Autopilot runner state, communications trends dataset. | Clicking navball opens Navigation view with navball tile focused. |

### Layout & Scaling Rules
- **Aspect guard:** Always-On HUD scales horizontally but maintains 64 px height minimum (32 px on N64) to preserve text legibility.
- **Font system:** Use mono-spaced HUD font with drop shadow for readability; expose CSS variables for high-contrast mode.
- **Update cadence:** HUD redraws at simulation HUD cadence (default 600 s) for slow-changing values, but countdown timers tick every frame by interpolating between simulation frames to keep UI smooth without additional sim fetches.

## View 1 — Navigation

Primary pane layout uses a 3-column grid (trajectory canvas wide left, navball top-right, state vector bottom-right, timeline ribbon spanning bottom). Minimum content targets 960×540; smaller screens collapse navball under trajectory.

| Module | Placement | Contents | Data Feed | Interaction |
| --- | --- | --- | --- | --- |
| Trajectory Canvas | Left 60% | Earth/Moon patched conics, current vs. planned path, maneuver nodes, comm cones. | Event scheduler timeline, autopilot queue, communications trends. | Click node to center timeline, double-click to arm “Plan Burn” macro (prefills DSKY). Mouse wheel zooms with inertial scrolling. |
| Navball / Attitude | Top-right | Full FDAI sphere with prograde/retrograde markers, PTC roll ring, attitude error needles. | Guidance state, autopilot runner, resource alerts. | Clicking toggles between AGC- and SCS-driven attitude frames. |
| State Vector Table | Bottom-right | Apoapsis/periapsis, TIG, Δv, burn duration, attitude error, residuals. | PAD dataset, resource metrics. | Copy button copies PAD parameters; warnings highlight residuals beyond tolerance. |
| Timeline Ribbon | Bottom (full width) | Horizontal event timeline with markers for TLI, MCCs, LOI, PDI, TEI, entry corridor, comm windows. | Event scheduler stats, communications dataset. | Clicking marker scrolls checklist lane to relevant entry; dragging scrubs to preview upcoming windows without altering sim time. |
| Console Dock (collapsible) | Bottom overlay | Text feed of mission log, autopilot transitions, PAD deliveries. Detailed behaviour captured in [`console_dock.md`](console_dock.md). | Mission logger stream. | Filter chips (All / Events / Autopilot / Audio). |

### Navigation View Overlays
- **Burn Overlay:** When autopilot or manual burn active, fade in throttle strip, Δv achieved vs. target, residual vector arrow.
- **Docking Overlay:** Adds rendezvous crosshair widget on navball, range/rate tape, approach corridor indicator.
- **Entry Overlay:** Replaces trajectory canvas with entry corridor plot plus EMS tape indicator (detailed in [`entry_overlay.md`](entry_overlay.md)).

## View 2 — Controls

Controls view prioritizes panel schematics and DSKY operations per AGC/flight-plan procedures.

| Module | Placement | Contents | Data Feed | Interaction |
| --- | --- | --- | --- | --- |
| Panel Palette (left rail) | 20% width | Scrollable list of panel categories (Flight Control, RCS, EPS, Cryo, SPS, Communications, SCS, Circuit Breakers). | `panels.json` definitions, active checklist context. | Selecting item focuses schematic and highlights controls referenced by active checklist step. Keyboard `P` opens palette; arrow keys navigate. |
| Active Panel Schematic | Center 50% | SVG schematic with numbered toggles/switches, dependency lines, tooltip with state/reservoir impacts. | `panels.json` + resource system state. | Clicking control toggles state; if prerequisites missing, show inline explanation referencing upstream breaker or panel toggle. |
| DSKY Module | Right 30% | Verb/Noun keypad, triple-register display, program status line, macro shortcuts (Plan Burn, P52 Align). | `dsky_reference` macros, AGC state from simulation (placeholder until AGC integration). | Pressing macro button queues DSKY macro after verifying prerequisites. |
| Checklist Lane | Docked top or bottom | Infinite scroll of active checklists, current step at center with upcoming/previous context, quick-complete button (enter). | Checklist manager auto/manual stats. | Steps referencing a panel auto-scroll palette; macros highlight DSKY buttons. |
| Manual Action Monitor | Optional tile | Shows queued manual script actions with GET countdown, success/failure icons. | Manual action queue stats. | Developers can pause/resume manual queue per step for debugging. |

### Controls View Rules
- Checklist auto-scroll pins the active step under the Always-On HUD’s checklist chip for continuity.
- DSKY macros validate prerequisites defined in `checklists.json` (control states, flags) before dispatch; failure triggers caution overlay and console log entry describing missing prerequisites.
- When autopilot engages a program (e.g., P63), DSKY enters read-only mode, showing autopilot status and target registers until manual override occurs.

## View 3 — Systems

Systems view surfaces health, resource margins, failures, and telemetry trends.

| Module | Placement | Contents | Data Feed | Interaction |
| --- | --- | --- | --- | --- |
| Power Bus Matrix | Upper left | DC/AC bus diagram with inverters, fuel cells, batteries; arrows animate flow and load. | Resource system power state, `panels.json` breaker states. | Clicking element opens panel detail (Electrical Power or Circuit Breakers). Hover shows load, reserve, and failure status. |
| Propellant Overview | Upper right | Tanks for SPS, CSM RCS quads, LM descent/ascent, LM RCS. Bars show % remaining and reserve thresholds. | Resource propellant metrics. | Toggle between percentage and kg; clicking toggles history sparkline overlay for the selected tank. |
| Thermal & Cryo Panel | Mid left | Line chart of cryo boiloff %, suit loop temperatures, glycol pump states, PTC status. | Resource thermal metrics, manual action effects. | Range slider selects time window (last 30 min / 2 hr / mission). |
| Communications Window Tracker | Mid right | Timeline of DSN passes, current station highlight, signal strength gauge. | `communications_trends.json`, event statuses. | Clicking pass adds reminder chip to Always-On HUD; warns if autopilot maneuvers conflict with comm windows. |
| Commander Scorecard | Mid right stack or expandable drawer under comms module | Breakdown of commander score (events/resources/faults/manual), grade badge, trend sparklines for power/Δv minima, manual fraction meter (see [`commander_scorecard.md`](commander_scorecard.md)). | `frame.score` summary plus resource history buffers when enabled. | Buttons log “grade reviewed” acknowledgement to mission log and deep-link to checklist/events contributing to penalties. |
| Trends & Fault Log | Bottom | Scrollable list of resource/failure breadcrumbs with timestamp, severity, recommended recovery action. | Failure taxonomy, resource alerts. | Filtering by subsystem (Power/Thermal/Comms/Prop); entries link to relevant checklist or panel. |

### Systems View Behavior
- When a failure is logged, highlight the associated subsystem module with pulsing border and auto-scroll the fault log to the entry.
- Provide export button to dump last 30 minutes of resource data to JSON for debugging.
- Support comparison mode: side-by-side trending for two metrics (e.g., fuel cell load vs. boiloff) triggered from the trend chart legend.

The scorecard expands the Always-On capsule into a full mission health dashboard: stacked bars highlight event completion, resource margins, and fault counts; sparklines track minimum power and Δv margins vs. thresholds; and manual contribution badges show how much of the checklist cadence remains in crew hands. Acknowledge buttons log reviews to the console for parity with the score system’s deterministic history while keeping operators aware of degrading grades during extended runs.

## Tile Mode — Workspace Presets

Tile mode allows power users to reconfigure panes while the Always-On HUD stays pinned. Default presets stored in `workspaces.json`:

| Preset | Layout Intent | Key Tiles |
| --- | --- | --- |
| `NAV_DEFAULT` | Focus on trajectory planning. | Trajectory canvas (large), navball, timeline ribbon, state vector. |
| `DOCKING` | LM rendezvous operations. | Docking overlay, manual action monitor, propellant overview, comm tracker. |
| `SYSTEMS_NIGHT` | Overnight monitoring of consumables. | Power matrix, thermal trends, commander scorecard, fault log, checklist lane (read-only). |
| `ENTRY` | Reentry corridor checks. | Entry overlay, commander scorecard, communications timeline, resource gauges expanded. |

The preset layouts above are serialized for tooling and runtime loaders in [`workspaces.json`](workspaces.json).

### Tile Mode Rules
- **Grid & Snapping:** Snap to 12×8 grid; minimum tile 2×2 units. Dragging shows ghost outline; releasing triggers smooth animation to final slot.
- **Focus Mode:** Double-click tile to enter focus; Always-On HUD shrinks to 32 px but remains interactive. ESC exits.
- **Workspace Save/Load:** Export layout to JSON with normalized positions (`0.0–1.0`). Import validates compatibility (warns if required widget unavailable on current platform).
- **Controller Mappings:** `LB/RB` cycle tiles, `A` selects, left stick drags with snapping. On N64, d-pad moves focus; C-buttons resize.

## Data Binding & Update Strategy
- **State Aggregator:** Existing `TextHud` pipeline evolves into `ui_frame` builder providing normalized snapshots per tick (or per `renderIntervalSeconds`). Each view consumes derived selectors rather than pulling from core systems directly.
- **Delta Handling:** Use structural sharing (immutable snapshots) so React/Preact/Vanilla components can diff efficiently; N64 renderer will read same payload but translate into vertex commands.
- **Latency:** Keep HUD frame latency under 100 ms by executing UI update after resource/scheduler updates but before autopilot finish logs, ensuring displayed data matches that tick.
- **Fail-safe:** If UI falls behind (e.g., rendering >50 ms), log warning and drop intermediate frames rather than queue; Always-On HUD still shows last-known safe values.

## Accessibility & Audio Integration Hooks
- **High-contrast toggle:** Increases gauge saturation, adds hatch patterns for caution/warning states, and ensures text on gauges meets WCAG AA contrast.
- **Caption strip:** Optional line under console dock summarizing active audio cue (“Master Alarm – SPS bank unarmed”).
- **Haptics placeholders:** Document event → vibration mapping (for future controller support) even if browser build only logs the hook.
- **Screen reader hints:** Provide ARIA labels for key metrics (GET, resource percentages, checklist step) and ensure focus order matches mission workflow.

## Implementation Checklist
1. Extend simulator HUD aggregator to emit `ui_frame` snapshots with scheduler, resource, autopilot, checklist, and failure slices (implemented in [`UiFrameBuilder`](../../js/src/hud/uiFrameBuilder.js)).
2. Build Always-On HUD component with responsive scaling rules and caution thresholds derived from `docs/data/consumables.json` and resource model defaults.
3. Implement view containers (Navigation, Controls, Systems) that subscribe to `ui_frame` updates and manage overlay activation based on scheduler/autopilot states.
4. Wire tile mode presets to JSON loader/saver, validating layout metadata from `workspaces.json` once the schema lands.
5. Hook audio dispatcher so alert tray interactions can silence or replay cues without desynchronizing mission log.
6. Add developer instrumentation (frame time chart, dropped frame counter) accessible via debug overlay to prepare for N64 performance budgeting.

This specification keeps the simulator’s procedural truth front and center while providing the mission discipline cues (checklists, fault breadcrumbs, PTC status) that the Apollo team relied upon. It should be treated as the baseline for the JS implementation and the reference blueprint for translating the presentation layer to the Nintendo 64 build.
