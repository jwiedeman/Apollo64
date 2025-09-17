# Apollo 11 Panel Hierarchy & Switch Map

This document inventories the control panels that the Milestone M3 UI must visualize and simulate. It focuses on the "left rail" selection targets called out in the UI layout brief and extends the list with the Lunar Module stations that become active after docking separation. Each panel includes 4–8 mission-critical controls, the checklist steps that exercise them, and notes on the telemetry or simulation hooks required to enforce procedural truth.

## Panel Index

| Panel ID | Title | Craft | Primary Checklists | Notes |
| --- | --- | --- | --- | --- |
| `CSM_FLIGHT_CONTROL` | Flight Control & Guidance | CSM | `FP_3-10_TLI_PREP`, `FP_4-04_PTC`, `FP_8-12_PTC_RETURN` | Guidance, IMU, and attitude management during burns/PTC. |
| `CSM_RCS_MANAGEMENT` | RCS Management | CSM | `FP_5-04_PTC_TRIM`, `FP_6-16_LOI_CONFIG`, `FP_8-06_TEI_CONFIG` | Quad enables, ullage prep, and roll control for coast operations. |
| `CSM_ELECTRICAL_POWER` | Electrical Power | CSM | `FP_5-02_CONS_CHECK`, `FP_5-20_CONS_LOG2`, `FP_8-16_MCC5_EXEC` | Fuel cells, batteries, and bus ties governing resource margins. |
| `CSM_CRYO_ECS` | Cryogenics & ECS | CSM | `FP_4-04_PTC`, `FP_5-02_CONS_CHECK`, `FP_5-20_CONS_LOG2` | Cryo stirring, fans, and suit loop management tied to thermal drift. |
| `CSM_SPS_PROPULSION` | SPS Propellant Management | CSM | `FP_4-14_MCC1_EXEC`, `FP_6-16_LOI_CONFIG`, `FP_6-24_LOI2_EXEC` | SPS bank arming, gimbal heaters, and tank pressurization. |
| `CSM_COMMUNICATIONS` | Communications & Tracking | CSM | `FP_3-10_TLI_PREP`, `FP_7-12_SEP_CONFIG`, `FP_8-06_TEI_CONFIG` | S-band, VHF, and high-gain pointing for PAD deliveries and rendezvous. |
| `CSM_SCS_DAP` | SCS & DAP Authority | CSM | `FP_3-12_TLI_EXEC`, `FP_6-16_LOI_CONFIG`, `FP_8-12_PTC_RETURN` | SCS takeover logic, DAP rate modes, and redundant attitude holds. |
| `CSM_CB_LEFT` | Circuit Breakers (Left) | CSM | `FP_3-10_TLI_PREP`, `FP_5-02_CONS_CHECK`, `FP_6-16_LOI_CONFIG` | Power distribution for guidance, comm, and SPS subsystems. |
| `CSM_CB_RIGHT` | Circuit Breakers (Right) | CSM | `FP_5-20_CONS_LOG2`, `FP_7-12_SEP_CONFIG`, `FP_8-06_TEI_CONFIG` | Power distribution for ECS, RCS heaters, and docking aids. |
| `LM_DESCENT_PANELS` | LM Descent Activation | LM | `FP_7-16_LM_SEP`, `FP_7-22_FINAL_APPROACH` | Descent engine arm, landing radar, and attitude handover. |
| `LM_SYSTEMS_MONITOR` | LM Systems & ECS | LM | `FP_7-16_LM_SEP`, `FP_7-22_FINAL_APPROACH` | Suit loop, ECS cooling, and ascent stage safing prior to docking. |

## Panel Details

### CSM Flight Control & Guidance (`CSM_FLIGHT_CONTROL`)
- **Location:** Main Display Console (MDC) rows 1–3.
- **Role:** Configures Command Module Computer (CMC) authority, IMU alignment, and FDAI source selection.
- **Primary Checklists:** `FP_3-10_TLI_PREP`, `FP_4-04_PTC`, `FP_8-12_PTC_RETURN`.
- **Critical Controls:**

| Control ID | Label | States | Checklist Links | Simulation Notes |
| --- | --- | --- | --- | --- |
| `CMC_MODE` | CMC MODE | `OFF`, `STBY`, `AUTO`, `FREE` | `FP_3-10_TLI_PREP` step 2 | Drives AGC availability; `OFF/STBY` suspend autopilot scripts and DSKY macros. |
| `IMU_FINE_ALIGN` | IMU FINE ALIGN | `SLEW`, `ALIGN` | `FP_3-10_TLI_PREP` step 1 | Unlocks alignment routines; enforces prerequisite before P52 macros run. |
| `FDAI_SOURCE` | FDAI SOURCE | `CMC`, `SCS` | `FP_4-04_PTC` step 3 | Determines navball authority displayed in HUD navball widget. |
| `ATTITUDE_HOLD` | ATT HOLD | `AUTO`, `SCS`, `CMC` | `FP_8-12_PTC_RETURN` step 1 | Governs autopilot vs manual hold; interacts with SCS panel toggles. |
| `DAP_RATE` | DAP RATE | `LOW`, `MED`, `HIGH` | `FP_8-06_TEI_CONFIG` (auto step) | Selects DAP gain set; influences RCS pulse quantization. |
| `FDAI_SCALE` | FDAI SCALE | `5°`, `10°`, `20°` | `FP_5-04_PTC_TRIM` reference | Sets navball sensitivity used by PTC micro-adjust UI cues. |

### CSM RCS Management (`CSM_RCS_MANAGEMENT`)
- **Location:** Left equipment bay, row of RCS selectors.
- **Role:** Enables quads, heaters, and roll control used for ullage, docking, and PTC.
- **Primary Checklists:** `FP_5-04_PTC_TRIM`, `FP_6-16_LOI_CONFIG`, `FP_8-06_TEI_CONFIG`.

| Control ID | Label | States | Checklist Links | Simulation Notes |
| --- | --- | --- | --- | --- |
| `RCS_QUAD_ENABLE_A` | QUAD A | `OFF`, `ON` | `FP_5-04_PTC_TRIM` step 2 | Disabling a quad reduces available torques; triggers caution overlay when autopilot expects all quads. |
| `RCS_QUAD_ENABLE_B` | QUAD B | `OFF`, `ON` | `FP_8-06_TEI_CONFIG` step 2 | Same logic as quad A; data logged for consumables reports. |
| `RCS_HELIUM_ISOL` | HELIUM ISOL | `CLOSED`, `OPEN` | `FP_6-16_LOI_CONFIG` step 2 | Prerequisite for SPS ullage; ensures tank pressurization timeline consistent with events. |
| `RCS_HEATER_A` | HEATER A | `OFF`, `AUTO` | `FP_5-20_CONS_LOG2` step 1 | Impacts cryo boil-off and prop temperature modeling. |
| `RCS_DIRECT_ULLAGE` | ULLAGE COMMAND | `AUTO`, `MANUAL` | `FP_6-16_LOI_CONFIG` step 1 | When MANUAL, autopilot requires manual queue events for ullage pulses. |
| `PTC_TRIM_RATE` | PTC RATE | `0.3°/S`, `OFF` | `FP_4-04_PTC` step 3 | Controls barbecue roll setpoint; ties into HUD barbecue indicator. |

### CSM Electrical Power (`CSM_ELECTRICAL_POWER`)
- **Location:** Left equipment bay, electrical power panel.
- **Role:** Manages fuel cells, batteries, and bus ties critical to consumables modeling.
- **Primary Checklists:** `FP_5-02_CONS_CHECK`, `FP_5-20_CONS_LOG2`, `FP_8-16_MCC5_EXEC`.

| Control ID | Label | States | Checklist Links | Simulation Notes |
| --- | --- | --- | --- | --- |
| `FUEL_CELL_REACTANT_A` | FUEL CELL O2/H2 A | `CLOSE`, `OPEN` | `FP_5-02_CONS_CHECK` step 1 | Closing isolates a fuel cell; reduces available kW in resource system. |
| `MAIN_BUS_TIE` | BUS TIE | `OPEN`, `TIE` | `FP_8-16_MCC5_EXEC` step 2 | Governs cross-feed between buses; toggles cause resource alarms if loads exceed margins. |
| `INV_1_SELECT` | INVERTER 1 | `OFF`, `MAIN A`, `MAIN B` | `FP_5-20_CONS_LOG2` step 1 | Controls AC distribution; triggers caution when both inverters off. |
| `BATTERY_CHARGE` | BATTERY CHARGE | `OFF`, `MAIN A`, `MAIN B` | `FP_8-12_PTC_RETURN` supporting step | Maintains reentry batteries; drains bus at 5 A when active. |
| `FUEL_CELL_HEATER` | FUEL CELL TEMP | `OFF`, `AUTO` | `FP_5-20_CONS_LOG2` step 2 | Affects cryo boil-off rate; tracked in consumables metrics. |
| `EPS_LOAD_SHED` | LOAD SHED | `NOMINAL`, `ESSENTIAL` | `FP_4-04_PTC` caution rule | Switches off non-essential loads; triggers UI overlay highlighting disabled panels. |

### CSM Cryogenics & ECS (`CSM_CRYO_ECS`)
- **Location:** Right equipment bay cryo/ECS panel.
- **Role:** Controls cryogenic fans, stirrers, and suit/cabin loop devices required for thermal stability.
- **Primary Checklists:** `FP_4-04_PTC`, `FP_5-02_CONS_CHECK`, `FP_5-20_CONS_LOG2`.

| Control ID | Label | States | Checklist Links | Simulation Notes |
| --- | --- | --- | --- | --- |
| `O2_FAN_A` | O2 FAN A | `OFF`, `AUTO` | `FP_5-02_CONS_CHECK` step 1 | Influences oxygen tank stratification; high-level telemetry updates resource trends. |
| `H2_FAN_A` | H2 FAN A | `OFF`, `AUTO` | `FP_5-20_CONS_LOG2` step 1 | Similar to O2; enables cryo mixing events consumed by autopilot logic. |
| `CRYO_STIR` | CRYO STIR | `OFF`, `STIR` | `FP_5-20_CONS_LOG2` step 2 | When `STIR`, triggers short-lived load spike and updates cryo telemetry table. |
| `CABIN_FAN` | CABIN FAN | `OFF`, `FAN 1`, `FAN 2` | `FP_5-02_CONS_CHECK` step 3 | Impacts CO₂ accumulation modeling; drives ECS caution alarms. |
| `SUIT_FAN_SELECT` | SUIT FAN | `OFF`, `A`, `B` | `FP_7-12_SEP_CONFIG` (CMP) | Required before LM separation to ensure suit loop redundancy. |
| `GLYCOL_PUMP` | GLYCOL PUMP | `OFF`, `PRIMARY`, `SECONDARY` | `FP_4-04_PTC` step 3 | Alters thermal balance; ensures PTC effectiveness modeling. |

### CSM SPS Propellant Management (`CSM_SPS_PROPULSION`)
- **Location:** SPS propellant panel on lower equipment bay.
- **Role:** Prepares SPS banks, gimbals, and pressurization for major burns.
- **Primary Checklists:** `FP_4-14_MCC1_EXEC`, `FP_6-16_LOI_CONFIG`, `FP_6-24_LOI2_EXEC`.

| Control ID | Label | States | Checklist Links | Simulation Notes |
| --- | --- | --- | --- | --- |
| `SPS_BANK_A_ARM` | BANK A ARM | `SAFE`, `ARM` | `FP_6-16_LOI_CONFIG` step 1 | Required before autopilot can ignite SPS; missing arm triggers failure effects. |
| `SPS_BANK_B_ARM` | BANK B ARM | `SAFE`, `ARM` | `FP_4-14_MCC1_EXEC` step 1 | Mirrors bank A for redundancy; tracked individually in resource system. |
| `SPS_HEL_PRESS` | HELIUM PRESS | `CLOSED`, `OPEN` | `FP_6-16_LOI_CONFIG` step 2 | Governs tank pressurization timeline; interacts with RCS ullage command. |
| `SPS_VALVE_ARM` | MAIN VALVE | `CLOSED`, `ARM` | `FP_6-24_LOI2_EXEC` step 1 | Unlocks main valves; autopilot aborts if left closed at TIG. |
| `SPS_GIMBAL_A` | GIMBAL MOTOR A | `OFF`, `AUTO` | `FP_4-14_MCC1_EXEC` step 1 | Enables gimbal tracking; tied to autopilot error tolerance. |
| `SPS_GIMBAL_B` | GIMBAL MOTOR B | `OFF`, `AUTO` | `FP_4-16_MCC1_EVAL` | Provides redundancy; failure triggers caution lamp. |
| `ULLAGE_TIMER` | ULLAGE TIMER | `AUTO`, `MANUAL` | `FP_6-16_LOI_CONFIG` step 3 | Determines autopilot vs manual ullage; manual requires queued actions. |

### CSM Communications & Tracking (`CSM_COMMUNICATIONS`)
- **Location:** MDC and Lower Equipment Bay comm panels.
- **Role:** Maintains S-band, VHF, and high-gain coverage for PADs and rendezvous operations.
- **Primary Checklists:** `FP_3-10_TLI_PREP`, `FP_7-12_SEP_CONFIG`, `FP_8-06_TEI_CONFIG`.

| Control ID | Label | States | Checklist Links | Simulation Notes |
| --- | --- | --- | --- | --- |
| `S_BAND_POWER` | S-BAND POWER | `OFF`, `LOW`, `HIGH` | `FP_3-10_TLI_PREP` step 3 | Controls DSN availability; low power reduces comm margin in telemetry packs. |
| `OMNI_ANT_SELECT` | OMNI ANTENNA | `A`, `B`, `C`, `D` | `FP_4-04_PTC` step 3 | Selection updates antenna pointing model; autopilot logs switch time. |
| `HIGH_GAIN_TRACK` | HIGH GAIN | `AUTO`, `MANUAL`, `SCAN` | `FP_8-06_TEI_CONFIG` step 1 | Drives high-gain tracking loop; manual requires manual action queue input. |
| `VHF_XMTR` | VHF XMTR | `OFF`, `A`, `B` | `FP_7-12_SEP_CONFIG` step 3 | Required for LM/CSM proximity; UI warns if inactive during docking. |
| `UPLINK_VOICE` | UPLINK VOICE | `OFF`, `UPLINK`, `INTERCOM` | `FP_5-02_CONS_CHECK` reference | Determines voice routing; toggles audio cue priority. |
| `DATA_RECORDER` | DSE STATUS | `OFF`, `ON`, `PLAYBACK` | `FP_5-20_CONS_LOG2` step 3 | Links to telemetry logging; `PLAYBACK` streams stored data to DSN. |

### CSM SCS & DAP Authority (`CSM_SCS_DAP`)
- **Location:** MDC right side and SCS mode selectors.
- **Role:** Provides manual attitude control fallback and DAP reconfiguration.
- **Primary Checklists:** `FP_3-12_TLI_EXEC`, `FP_6-16_LOI_CONFIG`, `FP_8-12_PTC_RETURN`.

| Control ID | Label | States | Checklist Links | Simulation Notes |
| --- | --- | --- | --- | --- |
| `SCS_MODE` | SCS MODE | `STBY`, `ATT HOLD`, `RATE CMD` | `FP_3-12_TLI_EXEC` step 1 | Determines autopilot fallback; `RATE CMD` adds damping to manual pulses. |
| `SCS_ENG_ARM` | SCS ENGINE ARM | `SAFE`, `ARM` | `FP_6-16_LOI_CONFIG` step 1 | Allows SCS to ignite SPS if CMC fails; flagged in autopilot summary. |
| `DAP_CONFIG` | DAP CONFIG | `CSM 1`, `CSM 2`, `DOCKED` | `FP_7-12_SEP_CONFIG` step 1 | Selects mass properties; gating for autopilot thruster usage tables. |
| `SCS_GIMBAL_SEL` | SCS GIMBAL | `CMC`, `SCS` | `FP_4-14_MCC1_EXEC` step 1 | Reroutes gimbal authority; ensures autopilot stops commanding when SCS owns control. |
| `AUTO_MANUAL_TRIM` | TRIM CMD | `AUTO`, `MANUAL` | `FP_8-12_PTC_RETURN` step 1 | Manual trim requires manual queue input for thruster pulses. |
| `ABORT_STAGE_SELECT` | ABORT MODE | `CMC`, `SCS`, `MAN` | `FP_7-16_LM_SEP` caution | Preps for abort scenarios; ties into failure taxonomy to escalate warnings. |

### CSM Circuit Breakers — Left Panel (`CSM_CB_LEFT`)
- **Location:** Left-hand circuit breaker panel rows 1–6.
- **Role:** Supplies power to guidance, comms, and propulsion avionics. The UI must surface dependencies when breakers are pulled during load shedding.
- **Primary Checklists:** `FP_3-10_TLI_PREP`, `FP_5-02_CONS_CHECK`, `FP_6-16_LOI_CONFIG`.

| Breaker ID | Label | Circuits Powered | Checklist Links | Simulation Notes |
| --- | --- | --- | --- | --- |
| `CB_FDAI` | FDAI & IMU | FDAI, IMU align electronics | `FP_3-10_TLI_PREP` step 1 | Must be closed before IMU align; open breaker forces HUD navball to fallback mode. |
| `CB_CMC` | CMC COMPUTER | AGC core + DSKY | `FP_3-10_TLI_PREP` step 2 | Opening suspends autopilots, DSKY macros, and checklists requiring AGC input. |
| `CB_SPS_GIMBAL` | SPS GIMBAL MOTORS | Gimbal motors A/B | `FP_4-14_MCC1_EXEC` step 1 | Breaker trips disable gimbal switches; autopilot aborts if open at TIG. |
| `CB_S_BAND` | S-BAND POWER | Up/down link electronics | `FP_3-10_TLI_PREP` step 3 | Opening reduces comm margins; flagged on HUD caution lamp. |
| `CB_DSE` | DATA STORAGE | Data Storage Equipment | `FP_5-20_CONS_LOG2` step 3 | Required for mission log playback; off breaker disables console log recording. |
| `CB_FUEL_CELL` | FUEL CELL CTRL | Fuel cell controllers | `FP_5-02_CONS_CHECK` step 1 | Without power, resource system marks cell offline and reduces kW budget. |

### CSM Circuit Breakers — Right Panel (`CSM_CB_RIGHT`)
- **Location:** Right-hand circuit breaker panel rows 7–12.
- **Role:** Covers ECS loads, RCS heaters, docking aids, and lighting.
- **Primary Checklists:** `FP_5-20_CONS_LOG2`, `FP_7-12_SEP_CONFIG`, `FP_8-06_TEI_CONFIG`.

| Breaker ID | Label | Circuits Powered | Checklist Links | Simulation Notes |
| --- | --- | --- | --- | --- |
| `CB_RCS_HEATERS` | RCS HTRS | RCS quad heaters | `FP_6-16_LOI_CONFIG` step 2 | Required for prop conditioning; open breaker forces RCS heater toggles to fail closed. |
| `CB_SUITS_FANS` | SUIT FAN | Suit/cabin loop motors | `FP_5-02_CONS_CHECK` step 3 | Trips cause CO₂ alarm escalation in HUD caution lamp. |
| `CB_DOCKING_LIGHTS` | DOCK LIGHTS | Rendezvous lights | `FP_7-12_SEP_CONFIG` step 1 | Controls docking light availability; UI toggles highlight to pilot. |
| `CB_VHF` | VHF COMMS | VHF TX/RX | `FP_7-12_SEP_CONFIG` step 3 | Without breaker, VHF switch has no effect; docking checklists warn user. |
| `CB_ENTRY_MON` | ENTRY MON | EMS and entry displays | `FP_8-06_TEI_CONFIG` step 3 | Trip disables reentry timeline overlays; flagged as high-risk caution. |
| `CB_LM_TUNNEL` | LM TUNNEL FAN | Tunnel vent fan | `FP_7-16_LM_SEP` step 1 | Required before docking tunnel open/close operations. |

### LM Descent Activation (`LM_DESCENT_PANELS`)
- **Location:** LM upper panel (panels 1/2) used during separation, station-keeping, and powered descent.
- **Role:** Arms descent engine, landing radar, and autopilot logic once the LM is powered up.
- **Primary Checklists:** `FP_7-16_LM_SEP`, `FP_7-22_FINAL_APPROACH`.

| Control ID | Label | States | Checklist Links | Simulation Notes |
| --- | --- | --- | --- | --- |
| `DPS_ENGINE_ARM` | DESCENT ENGINE ARM | `SAFE`, `ARM` | `FP_7-16_LM_SEP` step 2 | Required for Program 63/64 ignition; autopilot aborts landing if safe. |
| `LANDING_RADAR` | LNDG RADAR | `OFF`, `STBY`, `AUTO` | `FP_7-22_FINAL_APPROACH` step 1 | Drives landing radar availability; gating for altitude cues in HUD. |
| `MODE_CONTROL` | MODE CONTROL | `AUTO`, `ATT HOLD`, `RATE CMD` | `FP_7-22_FINAL_APPROACH` step 2 | Works with LM PGNS autopilot; manual requires manual queue. |
| `ABORT_STAGE` | ABORT STAGE | `ASCENT`, `DESCENT` | `FP_7-22_FINAL_APPROACH` caution | Sets stage for abort mode; toggles feed failure taxonomy (hard vs recoverable). |
| `DPS_HEATERS` | DPS HTRS | `OFF`, `ON` | `FP_7-16_LM_SEP` step 1 | Conditions propellant; ties into consumable heating loads. |
| `RCS_QUAD_ENABLE_FWD` | RCS QUADS | `OFF`, `ON` | `FP_7-16_LM_SEP` step 2 | Controls LM quads; telemetry ensures docking translation thrusters ready. |

### LM Systems & ECS (`LM_SYSTEMS_MONITOR`)
- **Location:** LM ECS and cabin systems panels.
- **Role:** Maintains suit loop, glycol cooling, and comm crosslinks during LM operations.
- **Primary Checklists:** `FP_7-16_LM_SEP`, `FP_7-22_FINAL_APPROACH`.

| Control ID | Label | States | Checklist Links | Simulation Notes |
| --- | --- | --- | --- | --- |
| `SUIT_FLOW` | SUIT FLOW | `CABIN`, `SUIT`, `EVA` | `FP_7-16_LM_SEP` step 3 | Determines LM suit loop; UI warns if mismatched with EVA readiness. |
| `GLYCOL_PUMP_SELECT` | GLYCOL PUMP | `PRIMARY`, `SECONDARY` | `FP_7-16_LM_SEP` step 3 | Controls LM cooling; resource model adjusts heat rejection. |
| `CABIN_REPRESS` | CABIN REPRESS | `CLOSE`, `OPEN` | `FP_7-16_LM_SEP` step 4 | Governs docking tunnel operations; interacts with failure taxonomy for leaks. |
| `ECS_WATER_SEP` | WATER SEP | `OFF`, `ON` | `FP_5-02_CONS_CHECK` LM extension | Drains humidity; toggling updates ECS moisture metrics. |
| `LM_BAT_TIE` | BATTERY TIE | `OPEN`, `TIE` | `FP_7-16_LM_SEP` step 1 | Connects LM descent/ascent batteries; ensures autopilot has power margin. |
| `LM_COMM_XLINK` | COMM CROSSLINK | `OFF`, `ON` | `FP_7-12_SEP_CONFIG` (LM side) | Maintains LM↔CSM voice/telemetry; UI caution if disabled when separation active. |

## Integration Notes

- Every control enumerated above maps to a `panels.json` entry with `states`, `prerequisites`, and `effects` describing how the simulation toggles propagate into the scheduler and resource systems.
- Checklist steps reference controls by their `controlId` values, enabling the UI to highlight prerequisite switches automatically and block DSKY macros until the correct state is achieved.
- Circuit breaker dependencies should be expressed explicitly so the UI can gray out downstream controls whenever a parent breaker opens.
- Telemetry hooks (`resource`, `propellant`, `thermal`) must connect to the existing `ResourceSystem` metrics to keep the HUD bars and caution lamps synchronized with panel operations.
- The LM panels inherit the same data structures but use `craft: "LM"` to support craft-specific layouts and DAP mass configurations.
