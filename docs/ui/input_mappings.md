# UI Input Mapping & Interaction Plan

This plan converts the hotkey outline from [`AGENTS.md`](AGENTS.md) into
implementation-ready bindings for the browser prototype and the eventual
Nintendo 64 build. It establishes deterministic keyboard/controller
mappings, interaction states, and dispatch hooks so the UI remains synced
with mission truth (`ui_frame` snapshots, panel metadata, and the
`ManualActionQueue`) regardless of input device.

## Goals

1. **Deterministic controls** – every binding routes through the shared
   mission action bus so manual/auto parity harnesses capture identical
   events whether the step originated from a keyboard, gamepad, or N64
   controller.
2. **Mission-first interactions** – inputs focus panels, DSKY macros,
   and checklist steps instead of generic UI widgets, ensuring each
   action has a simulator-level effect.
3. **Cross-platform parity** – the same conceptual controls are exposed
   on the web prototype (keyboard/mouse + optional XInput gamepad) and on
   Nintendo 64 hardware, enabling QA scripts and training material to
   reference a single control map.
4. **Accessibility & logging** – every binding emits structured
   `ManualActionQueue` entries (or preview intents) and logs source
   metadata so caption overlays and input remapping menus stay in sync
   with the mission log.

## Global Bindings

| Action | Keyboard/Mouse (Web) | Gamepad (Web) | Nintendo 64 | Notes |
| --- | --- | --- | --- | --- |
| Switch to Navigation view | `1` | `LB + X` | `C-Left` | Focuses Navigation layout, scrolls timeline ribbon to `frame.events.next`. |
| Switch to Controls view | `2` | `LB + Y` | `C-Up` | Keeps active checklist chip highlighted when switching. |
| Switch to Systems view | `3` | `LB + B` | `C-Right` | Pins most recent warning in Systems trends panel. |
| Cycle views | `Tab` / `Shift+Tab` | `LB + RB` | `L` / `R` | Wrap-around cycling; logs `ui:view_changed` with previous/next view. |
| Toggle Tile Mode | `T` | `Select` | `Start` | Loads last workspace preset from [`workspaceStore`](workspace_store.md); Always-On HUD stays pinned. |
| Open Checklist overlay | `C` | `X` (tap) | `B` | Scrolls to active checklist; long press (`>0.5 s`) toggles pin mode. |
| "Do Next" contextual advance | `Space` | `A` | `A` | Dispatches queued manual action (checklist step or DSKY macro) if prerequisites satisfied; otherwise opens related panel. |
| Focus DSKY | `G` | `Y` (hold) | `Z` (hold) | Locks keyboard/gamepad input to DSKY keypad, shows macro tray. |
| Silence master alarm | `M` | `Right Stick Click` | `C-Down` | Sends acknowledgement through audio dispatcher (no state mutation). |
| Pause/resume sim (auth mode) | `P` | `Menu` | `Start + Z` | For controller/testing use only; flagged in mission log for parity review. |
| Increment/decrement time step* | `.` / `,` | `RB + Right/Left` | `R + C-Right` / `R + C-Left` | Available only in Controller/Free Flight modes; honors real-time lock. |

\* Time-step controls require developer mode; production builds expose
resume-only behavior unless authenticity toggles allow compression.

## Navigation View Interactions

| Action | Keyboard/Mouse | Gamepad | Nintendo 64 | Dispatch |
| --- | --- | --- | --- | --- |
| Select timeline marker | Mouse click / `Left`/`Right` + `Enter` | D-pad `Left`/`Right` + `A` | D-pad `Left`/`Right` + `A` | Emits `ui:timeline_focus` (view state) and, when marker references a checklist, enqueues preview manual action. |
| Toggle navball reference (CMC/SCS) | `V` | `RB + X` | `R + C-Up` | Emits `ManualActionQueue` toggle for `CSM_SCS_DAP.SCS_GIMBAL_SEL`. |
| Engage Plan Burn | `B` | `RB + A` | `R + A` | Pre-fills `V21N33`/`V21N38` macros and focuses DSKY; emits preview event when prerequisites missing. |
| Toggle 2D/3D trajectory | `F` | `RB + Y` | `R + B` | Updates Navigation view state only (no simulator effect). |
| Scrub maneuver preview | Click + drag timeline | Right stick horizontal | Analog stick horizontal | Adjusts preview cursor; on release logs `ui:trajectory_preview`. |
| Toggle docking overlay | `D` | `RB + B` | `R + C-Down` | Enables rendezvous cues; emits event for HUD analytics. |

## Controls View Interactions

| Action | Keyboard/Mouse | Gamepad | Nintendo 64 | Dispatch |
| --- | --- | --- | --- | --- |
| Navigate panel rail | `Up`/`Down` / mouse scroll | D-pad `Up`/`Down` | D-pad `Up`/`Down` | Updates focused panel; logs selection for accessibility. |
| Activate highlighted panel | `Enter` / mouse click | `A` | `A` | Scrolls to panel schematic, primes highlighted controls from checklist. |
| Toggle highlighted control | `Space` / mouse click | `A` (while control focused) | `A` (while control focused) | Queues `ManualActionQueue` control toggle; verifies breaker dependencies from `panels.json`. |
| Cycle control focus (panel) | `Tab` / `Shift+Tab` | `RB + Up/Down` | `R + D-pad Up/Down` | Rotates through controls referenced by active checklist step. |
| Acknowledge checklist step | `Enter` / `Space` (on card) | `A` (on card) | `A` (on card) | Dispatches `checklist_ack`; respects `retry_window_seconds`. |
| Mark step as blocked | `Shift+Enter` / context menu | `LB + A` | `L + A` | Adds log entry with reason selector; pauses auto-advance for the step. |
| DSKY keypad digits | `0–9`, `+`, `-`, `Verb`, `Noun`, `Enter`, `Backspace` | Face buttons mapped to keypad (A/B/X/Y = 7/8/9/PRO etc.) | C-buttons + `A`/`B` combinations | Dispatch `dsky_entry` keystrokes; lock engages while DSKY focused. |
| Recall macro tray | `Ctrl+M` | `LB + X` (hold) | `L + C-Up` | Opens macro overlay tied to `docs/ui/dsky_reference.md`; selection sends macro preview prior to PRO commit. |

## Systems View Interactions

| Action | Keyboard/Mouse | Gamepad | Nintendo 64 | Dispatch |
| --- | --- | --- | --- | --- |
| Navigate module tabs | `Left`/`Right` | D-pad `Left`/`Right` | D-pad `Left`/`Right` | Updates Systems subview (Power/Propellant/Thermal/Comms/Trends). |
| Expand resource trend | Mouse click / `Enter` | `A` | `A` | Locks chart to focused channel; requests high-frequency history sample from resource store. |
| Acknowledge caution | `A` / `Enter` on alert list | `A` | `A` | Emits `ui:alert_acknowledged` + optional manual action when acknowledgement clears caution-latched resource. |
| Pin DSN pass | `Shift+P` | `LB + B` | `L + B` | Adds upcoming pass chip to HUD; logs selection for mission log. |
| Export snapshot | `Ctrl+E` | `LB + Y` | `L + C-Right` | Developer toggle that writes JSON trend dump via `exportUiFrames`. |

## Tile Mode Interactions

- **Drag/Resize:**
  - Web: click + drag title bar / resize handles; hold `Shift` to snap to
    grid increments.
  - Gamepad/N64: hold `LB`/`L` and use left stick to move, right stick to
    resize; `A` confirms placement, `B` cancels to previous layout.
- **Focus Mode:** double-click / `F` key / `A` (while holding `LB`/`L`) to
  maximize tile. HUD remains pinned.
- **Workspace Save/Load:** `Ctrl+S` / `LB + Select` / `L + Start` writes the
  current layout to the workspace store; `Ctrl+L` / `LB + Menu` /
  `L + Start` (long press) opens the preset picker documented in
  [`docs/ui/workspaces.json`](workspaces.json).

All tile interactions emit `workspace:update` entries with GET, tile IDs,
 and serialized layout deltas for replay.

## Input State & Remapping

- The input layer maintains a deterministic state machine:
  1. **Idle** – view-level commands available.
  2. **Focused** – when DSKY/panel/tile captures focus; other bindings are
     suppressed until focus is released.
  3. **Modal** – overlays (macro tray, alert detail) consume navigation
     keys; exit via `Esc`/`B`/`C-Down`.
- Remapping UI (future milestone) writes overrides to
  the [`workspaceStore`](workspace_store.md) `inputOverrides` map. Defaults fall back to the mappings in
  this document to keep parity harness inputs aligned.

## Logging & Telemetry Hooks

Every dispatched action records:

```json
{
  "type": "ui_input",
  "get": "HHH:MM:SS",
  "source": "keyboard" | "gamepad" | "n64",
  "view": "navigation" | "controls" | "systems" | "tile",
  "action": "checklist_ack" | "dsky_key" | ...,
  "payload": { ... }
}
```

These entries feed:

- **Mission log** – for deterministic replay comparisons (`runParityCheck`).
- **Accessibility overlays** – to surface captions/tooltips describing the
  invoked action.
- **Commander rating** – manual action counts accumulate under the manual
  bonus metric documented in [`docs/scoring/commander_rating.md`](../scoring/commander_rating.md).

## Implementation Roadmap

1. **Input service scaffolding** – create a shared dispatcher that maps
   DOM/Controller events to high-level commands (`uiInputService.ts`) and
   publishes them on the mission event bus with normalized payloads.
2. **Focus management** – integrate with the UI router so view/tile focus
   updates align with panel schematics and DSKY macros; ensure the
   `ManualActionQueue` receives actions only once per commit.
3. **Parity harness hooks** – extend `runParityCheck` to record simulated
   inputs alongside mission summaries so UI regression tests can replay
   sessions without manual setup.
4. **N64 translation layer** – build a libdragon adapter that converts
   controller button states into the same high-level command IDs, sharing
   the mission event bus contract with the web build.

An initial implementation of the shared dispatcher now lives in
[`js/src/ui/uiInputService.js`](../../js/src/ui/uiInputService.js), with
automated coverage in
[`js/test/uiInputService.test.js`](../../js/test/uiInputService.test.js)
exercising keyboard, gamepad, and N64 mappings. Manual queue dispatch is
handled by [`js/src/ui/uiManualActionDispatcher.js`](../../js/src/ui/uiManualActionDispatcher.js), which logs `ui:manual` events,
routes actions onto `ManualActionQueue`, and is covered by
[`js/test/uiManualActionDispatcher.test.js`](../../js/test/uiManualActionDispatcher.test.js).

This mapping plan keeps future UI work grounded in the mission
procedures, ensuring that every button press ties directly to the
checklists, panels, and telemetry documented across the project plan.
