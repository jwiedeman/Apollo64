# UI Layer Implementation Guide

Scope: This file applies to `docs/ui/` and any future UI-facing implementation notes derived from it.

## Purpose
- Preserve the simulation-first mission flow while introducing a three-pane presentation layer that can ship alongside backend work.
- Maintain the "hardcore checklist" rhythm by ensuring every interaction aligns with mission procedures and existing simulator truth sources.
- Provide actionable layout, interaction, and state-management requirements for the upcoming browser prototype (and eventual N64 port).

## Always-On HUD (Persistent Across Layouts)
- Display GET / MET, the next scheduled event with T-minus, Δv remaining per stage, propulsion & power bars, and the alarm/caution lamp at all times.
- Surface a compact PTC (barbecue roll) indicator, comms link state, and the active checklist step chip. Clicking the chip must navigate to the relevant panel or pre-fill the DSKY input.

## View 1 — Navigation (Orbit & Trajectory)
### Purpose
Provide instant awareness of current vs. planned trajectory and stage upcoming maneuvers.

### Regions
- **Trajectory Canvas:** Earth/Moon patched conics with planned vs. actual paths and maneuver nodes.
- **Navball / Attitude:** Pitch/yaw/roll with rate vectors plus a PTC roll-rate ring.
- **State Vector:** Apoapsis/periapsis, TIG, Δv, burn duration, and current errors.
- **Timeline Ribbon:** TLI, MCCs, LOI, PDI, TEI, entry corridor, PAD deliveries, and comm windows.

### Interactions
- Clicking a timeline marker focuses the plot and pre-stages the relevant checklist.
- Toggle controls for 2D/3D projections and Earth-centric vs. Lunar-centric frames.
- "Plan burn" button pre-fills the DSKY with the target Verb/Noun pair.

## View 2 — Controls (Panels + DSKY)
### Purpose
Enable checklist-driven operations, switch manipulation, and AGC input without ambiguity.

### Regions
- **Panel List (left rail):** Flight Control, RCS Management, Cryogenics, ECS, Electrical Power, SPS Propellant Management, Comm, SCS, and Circuit Breakers (left/right).
- **Active Panel Schematic (center):** Flat diagram with numbered toggles; checklist-relevant toggles highlight and dependencies render as thin links.
- **DSKY (right):** Verb/Noun keypad, displays, PRO/KEY REL buttons, and program status line.
- **Checklist Lane (top/bottom):** Infinite scroll with steps that jump to panels or pre-fill DSKY sequences.

### Behavioral Rules
- Physical switch truth is authoritative—DSKY programs will not execute until prerequisite switches (engine arm, gimbal motors, etc.) are satisfied.
- Checklist steps can expose DSKY macros (e.g., "Autonull RCS for PTC") with prerequisite validation.
- Every toggle surfaces live draw/heat/propellant deltas inline when changed.

## View 3 — Systems (Power / Thermal / Comms / Prop)
### Purpose
Expose health, margins, faults, and causal breadcrumbs over time.

### Regions
- **Power Buses:** DC/AC buses, inverters, fuel cells, batteries with live flow and load indicators.
- **Propellant Overview:** SPS & RCS (A/B quads) and LM tanks (when docked) with pressures and temperatures.
- **Thermal & Cryo:** Tank temperatures/pressures, boil-off rate, PTC status.
- **Comms Windows & Modes:** Antenna pointing/mode and link budget states (okay/weak/out).
- **Trends + Fault Log:** 2–4 hour history of margins with causal breadcrumbs (e.g., "PTC OFF 1h → boiloff +8% → Fuel cell ΔV down").

## Tile Mode — Draggable/Resizable Workspace
### Purpose
Offer a power-user layout with movable tiles and saveable workspaces such as Docking, Entry, and Coast.

### Available Windows
Trajectory Canvas, Navball, State Vector, DSKY, Active Panel, Panel List, Checklist, Power Buses, Prop Overview, Thermal/Cryo, Comms, Trends/Fault Log, and a Text Console for PADs.

### Rules
- Enforce minimum sizes and aspect hints (e.g., navball square, timeline wide).
- Focus mode allows any tile to occupy the full screen while the HUD stays pinned.
- Workspace layouts save/load as JSON so users can share bespoke configurations.

## Controls & Hotkeys (PC Baseline)
- `1` / `2` / `3`: Switch to Navigation / Controls / Systems (Tab cycles).
- `T`: Toggle Tile Mode.
- `C`: Open Checklist; `Enter` marks the step complete.
- `P`: Open panel palette; `↑`/`↓` navigate; `Enter` activates the panel schematic.
- `G`: Focus DSKY; keypad numbers enter Verb/Noun; `Enter` acts as PRO; `Backspace` acts as KEY REL.
- `Space`: Contextual "Do Next" that jumps to the next checklist step or DSKY macro.
- `,` / `.`: Time step controls (respect real-time lock when enabled).

## Information Architecture Summary
- **Navigation View:** Decides—vectors and timing with light staging controls.
- **Controls View:** Acts—switches, DSKY, and checklist rails.
- **Systems View:** Explains—margins, causal history, and logging.

## Implementation Notes
- Prefer Canvas or WebGL for the trajectory canvas; SVG/Canvas for panel schematics to keep vectors crisp.
- Use CSS Grid with a lightweight drag/resize helper for layout; export/import workspace JSON blobs.
- Centralize mission truth in a shared store (signals/observables) so every view consumes authoritative switch states, AGC program status, and margin data.
- Define DSKY macros via tables that validate switch predicates before dispatching AGC routines.

## Next Deliverables
- Panel hierarchy draft covering the ~10 primary panels, their 4–8 critical toggles, and checklist links.
- DSKY subset (Verb/Noun pairs) with plain-language labels for display, alignment, burns, docking, and entry checks.
- JSON schemas:
  - `checklists.json` – Stage → Step → Panel → switches[] | dsky_macro.
  - `panels.json` – Panel definitions with switch predicates/side effects.
  - `workspaces.json` – Window layout definitions for Tile Mode presets.

