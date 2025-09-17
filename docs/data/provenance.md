# Data Provenance

This log links each dataset to the Apollo 11 primary sources used during ingestion.

## `events.csv`
- `LAUNCH_001`–`LAUNCH_020`: Apollo 11 Flight Plan, Section 2 (pp. 2-5 to 2-18) for launch timeline checkpoints.
- `TLI_001`–`TLI_003`: Apollo 11 Flight Plan, Section 3 (pp. 3-10 to 3-20) and Flight Journal Day 1 timeline annotations.
- `COAST_001`: Flight Journal Day 1 (004:45 GET Passive Thermal Control entry) for timing and effects.
- `COAST_002`–`COAST_021`: Apollo 11 Flight Plan Section 4 (pp. 4-6 to 5-5) for PTC maintenance and consumables tracking, Apollo 11 Mission Operations Report Section 3.3 for MCC-1 scheduling, and Flight Journal Day 2 commentary for execution notes.
- `COAST_022`–`COAST_032`: Apollo 11 Flight Plan Section 5 (pp. 5-6 to 5-16) for navigation realignments and MCC-2 procedures, Apollo 11 Mission Operations Report Section 3.3 for MCC-2 targeting, and Flight Journal Day 2–3 commentary for the go/no-go decision.
- `COAST_040`–`COAST_071`: Apollo 11 Flight Plan Sections 5–6 (pp. 5-18 to 6-16) for extended PTC trending, consumables logging, MCC-3/4 preparation, and LOI configuration steps, Mission Operations Report Section 3.4 for midcourse correction budgets, and Flight Journal Day 3 commentary for LOI approach context.
- `LOI_001`–`LOI_005`: Apollo 11 Flight Plan Section 6 (pp. 6-14 to 6-26) for LOI PAD procedures and burn monitoring, Apollo 11 Mission Operations Report Section 3.4 for burn performance, and Flight Journal Day 4 transcripts for timing and evaluation callouts.
- `LM_PREP_001`–`LM_DESCENT_002`: Apollo 11 Flight Plan Section 7 (pp. 7-4 to 7-16) for LM activation, DOI planning, and separation procedures, supplemented by Flight Journal Day 5 timeline entries covering DOI execution and undocking status.
- `LM_DESCENT_010`–`LM_DESCENT_013`: Apollo 11 Flight Plan Section 7 (pp. 7-18 to 7-24) for PDI targeting, landing guidance, and post-landing safing, with Flight Journal Day 5 commentary providing manual descent cues.
- `LM_SURFACE_020`–`LM_SURFACE_050`: Apollo 11 Flight Plan Section 7 (pp. 7-26 to 7-30) for EVA prep/egress/traverse/closeout procedures and Flight Journal Day 5 EVA transcripts for timing and surface task annotations.
- `LM_ASCENT_020`–`LM_ASCENT_030`: Apollo 11 Flight Plan Section 7 (pp. 7-28 to 7-36) and Flight Journal Day 5 rendezvous logs for ascent preparation, ignition, and docking events.
- `RETURN_001`–`RETURN_014`: Apollo 11 Flight Plan Section 7 (p. 7-34 LM jettison) and Section 8 (pp. 8-4 to 8-12) for TEI PAD preparation, burn execution, and Passive Thermal Control return, supplemented by Flight Journal Day 6 TEI callouts.
- `RETURN_020`–`RETURN_031`: Apollo 11 Flight Plan Section 8 (pp. 8-14 to 8-22) covering MCC-5, entry PAD updates, and pre-entry alignments, with Mission Operations Report Section 3.7 for MCC-5 dispersions and Flight Journal Day 6–7 transcripts for evaluation notes.
- `RETURN_COMM_015`, `RETURN_COMM_023`: Apollo 11 Flight Plan Section 8 (pp. 8-13 and 8-17) DSN schedule tables and Flight Journal Day 6 transearth communications transcripts for high-gain configuration and PAD update context.
- `ENTRY_001`–`ENTRY_003`: Apollo 11 Flight Plan Section 9 (pp. 9-4 to 9-8) for service module jettison, entry monitoring, and splashdown procedures, along with Flight Journal Day 8 reentry timeline entries.

## `checklists.csv`
- `FP_2-5_LAUNCH`, `FP_2-16_ORBIT`: Apollo 11 Flight Plan pages 2-5 through 2-17.
- `FP_3-10_TLI_PREP`, `FP_3-12_TLI_EXEC`, `FP_3-18_TD`: Flight Plan pages 3-10 through 3-20 with cross-checks against Flight Journal transcripts.
- `FP_4-04_PTC`: Flight Plan Section 4 (pages 4-4 through 4-6) Passive Thermal Control procedures.
- `FP_4-06_PTC_MON`, `FP_4-12_MCC1_PAD`, `FP_4-14_MCC1_EXEC`, `FP_4-16_MCC1_EVAL`: Flight Plan pages 4-6 through 4-16 and Apollo 11 Mission Operations Report Section 3.3 for MCC-1 references, supplemented by Flight Journal Day 2 notes.
- `FP_5-02_CONS_CHECK`, `FP_5-04_PTC_TRIM`: Flight Plan Section 5 (pages 5-2 through 5-5) for coast-phase consumables and thermal maintenance.
- `FP_5-06_P52_REALIGN`, `FP_5-08_P23_NAV`, `FP_5-12_MCC2_PAD`, `FP_5-14_MCC2_EVAL`, `FP_5-16_MCC2_EXEC`: Flight Plan Section 5 (pages 5-6 through 5-16) for navigation updates and MCC-2 procedures, Apollo 11 Mission Operations Report Section 3.3 for targeting context, and Flight Journal Day 2–3 commentary for execution and skip rationale.
- `FP_5-18_PTC_LONG`, `FP_5-20_CONS_LOG2`: Flight Plan Section 5 (pages 5-18 through 5-20) for long-duration PTC trending and consumables logging guidance.
- `FP_6-02_MCC3_PAD` – `FP_6-12_MCC4_EXEC`: Flight Plan Section 6 (pages 6-2 through 6-12) for MCC-3/4 checklists, Apollo 11 Mission Operations Report Section 3.4 for Δv budgets, and Flight Journal Day 3 entries for evaluation notes.
- `FP_6-14_LOI_PAD` – `FP_6-26_LOI2_EVAL`: Flight Plan Section 6 (pages 6-14 through 6-26) for LOI PAD loading, configuration, execution, and evaluation steps, supplemented by Flight Journal Day 4 transcripts and Mission Operations Report Section 3.4 performance summaries.
- `FP_7-04_LM_ACTIVATE` – `FP_7-32_RNDZ_DOCK`: Apollo 11 Flight Plan Section 7 (pages 7-4 through 7-32) for LM activation, DOI setup, separation, powered descent, landing safing, ascent preparation, and rendezvous procedures, supplemented by Flight Journal Day 5 commentary and Mission Operations Report Sections 3.5–3.6 for performance notes.
- `FP_7-26_EVA_PREP` – `FP_7-30_EVA_CLOSEOUT`: Apollo 11 Flight Plan Section 7 (pages 7-26 through 7-30) and Flight Journal Day 5 EVA coverage for suit donning, egress, traverse, and repress procedures.
- `FP_7-34_LM_JETT`, `FP_8-04_TEI_PAD` – `FP_8-22_ENTRY_ALIGN`: Apollo 11 Flight Plan Section 7 LM jettison checklist and Section 8 (pages 8-4 through 8-22) for TEI preparation, burn execution, MCC-5, entry PAD updates, and pre-entry alignments, corroborated by Flight Journal Day 6–7 transcripts.
- `FP_8-13_TRANSCOMM_A`, `FP_8-17_TRANSCOMM_B`: Apollo 11 Flight Plan Section 8 DSN support schedule (pp. 8-13, 8-17) and Flight Journal Day 6 communications loops for transearth pass procedures.
- `FP_9-04_SM_SEP` – `FP_9-08_RECOVERY`: Apollo 11 Flight Plan Section 9 (pages 9-4 through 9-8) for service module separation, entry monitoring, and post-landing procedures with Flight Journal Day 8 recovery notes.

## `autopilots.csv` & autopilot JSON
- `PGM_06_TLI`: Derived from the TLI PAD on Flight Plan page 3-14 and the Apollo 11 Flight Journal burn summary (002:44:14 GET start, 347-second duration).
- `PGM_MCC1`: Timed profile synthesized from the Apollo 11 Mission Operations Report Section 3.3 (MCC-1 targeting) and Flight Journal Day 2 descriptions of burn duration and ullage usage.
- `PGM_MCC2`: Profile drafted from the Apollo 11 Mission Operations Report Section 3.3 planned MCC-2 solution with contextual timing from Flight Journal Day 3 (evaluation and skip notes).
- `PGM_MCC3`, `PGM_MCC4`: Built from Apollo 11 Mission Operations Report Section 3.4 midcourse correction budgets and Flight Plan Section 6 MCC-3/4 execution cues.
- `PGM_LOI1`, `PGM_LOI2`: Derived from Apollo 11 Flight Plan Section 6 LOI PAD data and Flight Journal Day 4 burn transcripts, with Mission Operations Report Section 3.4 providing performance references.
- `PGM_DOI`, `PGM_LM_PDI`, `PGM_LM_ASCENT`: Based on Apollo 11 Flight Plan Section 7 PAD tables for DOI, powered descent, and ascent, along with Flight Journal Day 5 transcripts describing burn timelines and throttle management.

## `consumables.json`
- `power.fuel_cells`, `power.batteries`: Apollo 11 Mission Operations Report Table 3-II for fuel cell output, reactant endurance, and battery capacity margins.
- `propellant.csm_sps`, `propellant.csm_rcs`: Mission Operations Report Tables 3-IV and 3-V documenting Service Module SPS and RCS propellant loads and reserves.
- `propellant.lm_descent`, `propellant.lm_ascent`, `propellant.lm_rcs`: Mission Operations Report Table 3-VI LM consumable table for descent/ascent propellant and RCS margins.
- `life_support.oxygen`, `life_support.water`: Mission Operations Report Table 3-VII and Section 3.8 consumables narratives for oxygen and water budgets.
- `life_support.lithium_hydroxide`: Apollo 11 Flight Plan Section 4 environmental control notes enumerating LiOH canister availability.
- `communications.dsn_shift_hours`, `communications.next_window_open_get`: Apollo 11 Flight Plan Section 4 DSN schedule summary establishing the 8-hour rotation and first post-TLI uplink window.
- `PGM_TEI`, `PGM_MCC5`: Informed by Apollo 11 Flight Plan Section 8 TEI and MCC-5 PAD tables, Mission Operations Report Section 3.7 correction budgets, and Flight Journal Day 6 burn commentary.

## `failures.csv`
- Failure triggers and effects reference the Apollo 11 Mission Operations Report Section 3 (trajectory dispersions) and Flight Journal Day 1 commentary on docking retries and PTC thermal management.
- Additional failure hooks for MCC-1 prep/execution, PTC drift, and consumables logging cite Apollo 11 Flight Plan Sections 4–5, Mission Operations Report Section 3.3, and Flight Journal Day 2 timeline callouts.
- MCC-2 evaluation and burn contingencies leverage Apollo 11 Flight Plan Section 5 guidance, Mission Operations Report Section 3.3 dispersions, and Flight Journal Day 2–3 coverage of the go/no-go decision.
- MCC-3/4 and LOI-related failure hooks draw from Apollo 11 Flight Plan Section 6 procedures, Mission Operations Report Section 3.4 dispersion analyses, and Flight Journal Day 3–4 commentary on LOI preparation and execution.
- LM activation, DOI, powered descent, landing, ascent, and rendezvous failure definitions cite Apollo 11 Flight Plan Section 7 procedures, Flight Journal Day 5 commentary, and Mission Operations Report Sections 3.5–3.6 for dispersion impacts.
- Surface EVA and transearth communications failure hooks reference Apollo 11 Flight Plan Section 7 EVA procedures (pp. 7-26 to 7-30), Section 8 DSN schedules (pp. 8-13, 8-17), and Flight Journal Day 5–6 transcripts for timeline constraints.
- TEI, transearth coast, entry, and recovery failure hooks cite Apollo 11 Flight Plan Sections 8–9 for procedural thresholds, Mission Operations Report Sections 3.7–3.9 for dispersion analyses, and Flight Journal Day 6–8 entries for execution outcomes.

## `pads.csv`
- `PAD_TLI_002`: Flight Plan page 3-14 (TLI PAD parameters).
- `PAD_MCC1_001`: Apollo 11 Mission Operations Report Section 3.3 (Midcourse Correction 1 planning).
- `PAD_MCC2_001`: Apollo 11 Mission Operations Report Section 3.3 (Midcourse Correction 2 planning) with timing context from Flight Journal Day 3.
- `PAD_MCC3_001`, `PAD_MCC4_001`: Apollo 11 Mission Operations Report Section 3.4 MCC-3/4 budgets with timing cues from Flight Journal Day 3 LOI approach updates.
- `PAD_LOI1_001`, `PAD_LOI2_001`: Apollo 11 Flight Plan Section 6 LOI PAD tables and Flight Journal Day 4 burn commentary for execution timing.
- `PAD_DOI_001`: Apollo 11 Flight Plan Section 7 DOI PAD data with supporting timing from Flight Journal Day 5.
- `PAD_PDI_001`: Apollo 11 Flight Plan Section 7 PDI targeting tables and Flight Journal Day 5 descent transcript for throttle cues.
- `PAD_ASCENT_001`: Apollo 11 Flight Plan Section 7 ascent PAD data supplemented by Flight Journal Day 5 ascent and rendezvous updates.
- `PAD_TEI_001`, `PAD_MCC5_001`, `PAD_ENTRY_001`: Apollo 11 Flight Plan Section 8 TEI and entry PAD tables, Mission Operations Report Section 3.7 MCC-5 budgets, and Flight Journal Day 6–8 commentary for timing and parameter verification.
