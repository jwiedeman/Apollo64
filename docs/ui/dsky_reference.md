# DSKY Macro Reference for Mission-Critical Procedures

This reference enumerates the Verb/Noun pairs and macro groupings that the UI must expose for checklist-driven DSKY interactions. The combinations below prioritize alignment, burn monitoring, docking support, and entry checks so the "Do Next" shortcut can pre-fill inputs while validating prerequisite panel states. The authoritative data now lives in [`docs/ui/dsky_macros.json`](dsky_macros.json); `AgcRuntime` ingests that pack, enforces prerequisites, mirrors annunciator state, and exposes register snapshots to the HUD and mission log pipeline.

## Macro Catalog

| Macro ID | Verb | Noun | Display Mode | Plain-Language Label | Primary Checklists | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `V06N33_DELTA_V_RESIDUAL` | 06 | 33 | Monitor | ΔV Residuals (X/Y/Z ft/s) | `FP_3-12_TLI_EXEC`, `FP_6-24_LOI2_EXEC`, `FP_8-16_MCC5_EXEC` | Historically used after Programs 11/41; displays remaining velocity components until within tolerance. |
| `V06N36_ATT_ERROR` | 06 | 36 | Monitor | Attitude Error (Roll/Pitch/Yaw) | `FP_3-10_TLI_PREP`, `FP_6-16_LOI_CONFIG`, `FP_7-16_LM_SEP` | Shows orientation offsets vs. guidance platform; gating for burn commit checks. |
| `V06N37_ATT_RATE` | 06 | 37 | Monitor | Body Rates (°/s) | `FP_4-04_PTC`, `FP_7-22_FINAL_APPROACH` | Used to trim PTC roll and monitor LM descent rate damping. |
| `V06N38_TIG_TIMER` | 06 | 38 | Monitor | TIG Countdown / Burn Duration | `FP_3-10_TLI_PREP`, `FP_4-14_MCC1_EXEC`, `FP_8-06_TEI_CONFIG` | Displays time-to-ignition and planned burn time sourced from PADs; triggers caution if countdown drifts. |
| `V16N36_ATTITUDE` | 16 | 36 | Monitor | Present Attitude (IMU angles) | `FP_3-10_TLI_PREP`, `FP_6-16_LOI_CONFIG`, `FP_7-12_SEP_CONFIG` | Presents inertial attitude without target subtraction; used when cross-checking FDAI vs. DSKY. |
| `V16N37_RATES` | 16 | 37 | Monitor | Present Rates (°/s) | `FP_4-04_PTC`, `FP_8-12_PTC_RETURN` | Raw gyro rates used to confirm DAP gain selections. |
| `V21N33_LOAD_DV` | 21 | 33 | Entry | Load ΔV Target (X/Y/Z ft/s) | `FP_3-10_TLI_PREP`, `FP_4-14_MCC1_EXEC`, `FP_6-16_LOI_CONFIG` | Keyboard entry macro that writes PAD-provided ΔV vectors to P30/P41; UI validates SPS bank arm before accepting input. |
| `V21N38_LOAD_TIG` | 21 | 38 | Entry | Load TIG & Duration | `FP_3-10_TLI_PREP`, `FP_6-16_LOI_CONFIG`, `FP_8-06_TEI_CONFIG` | Loads ignition time and burn duration; blocked if TIG falls outside event window. |
| `V25N07_ENTRY_UPDATE` | 25 | 07 | Entry | Update Entry Interface Conditions | `FP_8-06_TEI_CONFIG`, `FP_8-16_MCC5_EXEC` | Accepts retrofire target altitude and corridor angles; ties into entry scoring metrics. |
| `V49N20_STAR_CHECK` | 49 | 20 | Entry | IMU Coarse Align Star Catalog | `FP_3-10_TLI_PREP`, `FP_6-16_LOI_CONFIG` | Supplies star IDs for P52 coarse align; UI prompts for optics panel readiness before launching macro. |
| `V50N18_RNDZ_RANGE` | 50 | 18 | Entry | Update Rendezvous Range/Rate | `FP_7-12_SEP_CONFIG`, `FP_7-16_LM_SEP` | Stores docking radar inputs; cross-checks VHF range to prevent conflicting data. |
| `V63N63_LANDING_RADAR` | 63 | 63 | Monitor | Landing Radar Altitude/Rate | `FP_7-22_FINAL_APPROACH` | Polls LM landing radar registers; requires `LANDING_RADAR` in AUTO and LM comm crosslink active. |

## Macro Behavior Rules

1. **Prerequisite Enforcement:** Macros that alter guidance targets (`V21N33`, `V21N38`, `V25N07`, `V49N20`, `V50N18`) must verify the relevant panel toggles before dispatch. For example, `V21N33_LOAD_DV` checks that SPS banks are armed and that the associated event is within its window before updating the guidance registers.
2. **HUD Integration:** Monitor macros (`V06*`, `V16*`, `V63N63`) emit snapshots to the HUD overlay so the navball, burn widgets, and landing rate tapes display the same values the player sees on the DSKY.
3. **Auto vs. Manual Parity:** When autopilot scripts or manual queue entries execute macros, the mission log records the Verb/Noun, input values, annunciator state, and GET to feed parity reports. Manual entries replay the same pipeline to guarantee deterministic outcomes.
4. **Error Handling:** Invalid entries (e.g., TIG outside event window, ΔV magnitude beyond PAD tolerances) respond with a simulated `OPR ERR` lamp and an actionable console log entry describing the violated constraint.
5. **Controller Hotkeys:** Keyboard/controller bindings map to macro IDs so `Plan Burn` buttons or checklist steps can queue `V21N33` + `V21N38` pairs without forcing players to retype values. The UI reads the curated macro pack to surface applicable shortcuts and disable entries when prerequisites fail.

## Data Representation

Macros referenced here correspond to the `dskyMacro` field in `docs/ui/checklists.json` records. Each macro entry includes:

```json
{
  "id": "V06N33_DELTA_V_RESIDUAL",
  "verb": 6,
  "noun": 33,
  "mode": "monitor",
  "label": "ΔV Residuals",
  "description": "Displays remaining Δv components after burns to confirm guidance residuals are within tolerance.",
  "hudBindings": ["navigation.maneuver.deltaVResidual"],
  "checklists": ["FP_3-12_TLI_EXEC", "FP_6-24_LOI2_EXEC", "FP_8-16_MCC5_EXEC"],
  "requires": [
    { "panel": "CSM_SPS_PROPULSION", "controlId": "SPS_BANK_A_ARM", "state": "ARM" },
    { "panel": "CSM_SPS_PROPULSION", "controlId": "SPS_BANK_B_ARM", "state": "ARM" }
  ],
  "registers": [
    { "id": "R1", "label": "ΔV X", "units": "ft/s" },
    { "id": "R2", "label": "ΔV Y", "units": "ft/s" },
    { "id": "R3", "label": "ΔV Z", "units": "ft/s" }
  ]
}
```

`state` entries may specify either a single `state` or a `states` array to allow multiple valid positions (e.g., VHF transmitter A/B). The UI layer hydrates these macros into keyboard/controller bindings, DSKY keypad shortcuts, autopilot replay scripts, and HUD register panels surfaced by `AgcRuntime`.
