# UI Data Schemas for Panels, Checklists, and Workspaces

The upcoming UI layer consumes structured JSON packs that describe procedures, panel topology, and tile layouts. This document defines the schemas for `checklists.json`, `panels.json`, and `workspaces.json` so tooling and runtime code share a single source of truth.

## 1. `checklists.json`

Each checklist groups procedural steps under a mission phase and references panel controls or DSKY macros. The format mirrors the existing CSV content while adding structured metadata for the UI.

```json
{
  "id": "FP_3-10_TLI_PREP",
  "title": "Pre-TLI Housekeeping",
  "phase": "Translunar",
  "role": "Joint",
  "nominalGet": "002:35:00",
  "source": {
    "document": "Flight Plan",
    "page": "3-10"
  },
  "steps": [
    {
      "id": "FP_3-10_TLI_PREP_S01",
      "order": 1,
      "callout": "Align IMU per P52",
      "panel": "CSM_FLIGHT_CONTROL",
      "controls": [
        {
          "controlId": "IMU_FINE_ALIGN",
          "targetState": "ALIGN",
          "verification": "gimbalAnglesNulled"
        }
      ],
      "dskyMacro": "V49N20_STAR_CHECK",
      "manualOnly": false,
      "notes": "Require optics cover open before launching macro.",
      "prerequisites": ["event:TLI_001"],
      "effects": [
        { "type": "flag", "id": "imuAligned", "value": true }
      ]
    }
  ]
}
```

### Field Reference

- `id` (string, required): Stable checklist identifier matching mission data.
- `phase` (enum): Mission slice (`Launch`, `Translunar`, `LunarOrbit`, `Surface`, `Transearth`, `Entry`).
- `role` (enum): `CDR`, `CMP`, `LMP`, or `Joint` for UI filtering.
- `nominalGet` (string): GET timestamp `HHH:MM:SS` used for scheduling and timeline highlights.
- `source` (object): Optional provenance (`document`, `page`, `citation`).
- `steps` (array): Ordered step definitions.
  - `panel` (string): `panels.json` identifier to highlight.
  - `controls` (array): Control requirements. Each control supports `targetState`, optional `verification` token, and `tolerance` for analog controls.
  - `dskyMacro` (string|null): Macro ID from `dsky_reference` when the step pre-fills AGC values.
  - `manualOnly` (boolean): When `true`, autopilot scripts skip the step even if manual queue is active.
  - `prerequisites` (array): References to events (`event:*`), flags (`flag:*`), or resource thresholds (`resource:power.mainA>=0.5`).
  - `effects` (array): State mutations triggered on completion (e.g., set flags, adjust scoring, trigger follow-on events).
  - `notes` (string): Rich-text hints for UI tooltips.

## 2. `panels.json`

The panel pack enumerates switch layouts, state machines, and dependencies for both CSM and LM stations. Schematics feed the visual layer while metadata drives checklist validation.

```json
{
  "id": "CSM_SPS_PROPULSION",
  "name": "SPS Propellant Management",
  "craft": "CSM",
  "layout": {
    "schematic": "csm_sps_panel.svg",
    "hotspots": [
      { "controlId": "SPS_BANK_A_ARM", "x": 412, "y": 118, "width": 48, "height": 64 },
      { "controlId": "SPS_BANK_B_ARM", "x": 492, "y": 118, "width": 48, "height": 64 }
    ]
  },
  "controls": [
    {
      "id": "SPS_BANK_A_ARM",
      "type": "toggle",
      "label": "Bank A Arm",
      "states": [
        { "id": "SAFE", "label": "SAFE", "drawKw": 0 },
        { "id": "ARM", "label": "ARM", "drawKw": 0.02 }
      ],
      "defaultState": "SAFE",
      "dependencies": [
        { "type": "circuitBreaker", "id": "CB_SPS_GIMBAL" }
      ],
      "telemetry": {
        "resource": "propellant.spsPressurization",
        "flag": "spsBankAArmed"
      },
      "effects": [
        { "type": "autopilot", "id": "enableSpsIgnition" }
      ]
    }
  ],
  "alerts": [
    {
      "id": "SPS_BANKS_NOT_ARMED",
      "severity": "caution",
      "trigger": {
        "all": [
          { "control": "SPS_BANK_A_ARM", "state": "SAFE" },
          { "control": "SPS_BANK_B_ARM", "state": "SAFE" },
          { "flag": "spsBurnArmed" }
        ]
      },
      "message": "SPS banks not armed for scheduled burn"
    }
  ]
}
```

### Field Reference

- `layout.hotspots`: Pixel coordinates (relative to schematic asset) for click/tap regions.
- `controls` objects include:
  - `type`: `toggle`, `rotary`, `enum`, `momentary`, or `analog`.
  - `states`: Enumerated positions with `id`, optional `label`, and telemetry deltas (`drawKw`, `propellantKg`, `heatKw`).
  - `defaultState`: Boot-time configuration used by the simulator.
  - `dependencies`: Requirements such as circuit breakers or prerequisite controls (e.g., `control`: `CMC_MODE`, `state`: `AUTO`).
  - `telemetry`: Pointers into mission state (resource channels, boolean flags, caution/warning lamps).
  - `effects`: Actions fired on state change (e.g., enable autopilot, publish HUD event).
- `alerts`: Optional caution/warning definitions evaluated per tick for UI lamp updates.

## 3. `workspaces.json`

Workspace packs define preset tile arrangements for the three primary views and tile mode presets. Layouts are resolution-agnostic by using relative sizing and aspect hints. The first preset bundle ships in [`workspaces.json`](workspaces.json) and covers Navigation, Docking Ops, Systems Night Watch, and Entry Corridor layouts described in the HUD specification.

```json
{
  "id": "NAV_DEFAULT",
  "name": "Navigation View",
  "viewport": {
    "minWidth": 1280,
    "minHeight": 720,
    "hudPinned": true
  },
  "tiles": [
    {
      "id": "trajectory",
      "window": "trajectoryCanvas",
      "x": 0,
      "y": 0,
      "width": 0.58,
      "height": 0.65,
      "minWidth": 0.45,
      "minHeight": 0.45,
      "constraints": { "aspectRatio": 1.4 }
    },
    {
      "id": "navball",
      "window": "navball",
      "x": 0.58,
      "y": 0,
      "width": 0.42,
      "height": 0.4,
      "constraints": { "aspectRatio": 1 }
    },
    {
      "id": "timeline",
      "window": "timelineRibbon",
      "x": 0,
      "y": 0.65,
      "width": 1,
      "height": 0.15,
      "constraints": { "minHeight": 0.12 }
    },
    {
      "id": "stateVector",
      "window": "stateVector",
      "x": 0.58,
      "y": 0.4,
      "width": 0.42,
      "height": 0.25
    }
  ],
  "tileMode": {
    "snap": 16,
    "grid": [12, 8],
    "focus": {
      "retainHud": true,
      "animationMs": 250
    }
  }
}
```

### Field Reference

- `viewport` describes minimum supported resolution and whether the HUD is pinned.
- `tiles` array lists movable/resizable windows:
  - `window` identifies the content widget (`trajectoryCanvas`, `navball`, `checklistLane`, `powerBuses`, etc.).
  - `x`, `y`, `width`, `height` are normalized (0.0–1.0) coordinates relative to the viewport.
  - `constraints` include `minWidth`, `minHeight`, `aspectRatio`, and `maximizedOnly` flags.
  - Optional `panelFocus` metadata can highlight a panel when the tile is active (e.g., focusing on `powerBuses` opens `CSM_ELECTRICAL_POWER`).
- `tileMode` configures drag/resize helpers:
  - `snap` sets grid snapping in pixels (JS build) or units (N64 tile grid).
  - `grid` defines a default column/row template for quick layout resets.
  - `focus` determines whether the HUD remains pinned during full-screen focus and the transition animation timing.

## Integration Workflow

1. **Source of Truth:** The ingestion pipeline converts annotated CSV notebooks into the JSON structures above, preserving provenance and checklist ordering while enriching records with UI-specific metadata.
2. **Validation:** `validateMissionData.js` gains schema checks to ensure checklist steps reference valid panels, controls, and macros. Separate JSON Schema documents (Draft 2020-12) will be generated to support CI validation.
3. **Runtime Consumption:** `createSimulationContext` loads the packs, injecting control metadata into the checklist manager so auto/manual steps block until panel states satisfy prerequisites. Tile presets drive the upcoming UI layout manager.
4. **Portability:** The N64 build will consume the same JSON (converted to binary packs) so layout constraints, panel dependencies, and macro definitions stay consistent across platforms.
