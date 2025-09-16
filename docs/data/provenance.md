# Data Provenance

This log links each dataset to the Apollo 11 primary sources used during ingestion.

## `events.csv`
- `LAUNCH_001`–`LAUNCH_020`: Apollo 11 Flight Plan, Section 2 (pp. 2-5 to 2-18) for launch timeline checkpoints.
- `TLI_001`–`TLI_003`: Apollo 11 Flight Plan, Section 3 (pp. 3-10 to 3-20) and Flight Journal Day 1 timeline annotations.
- `COAST_001`: Flight Journal Day 1 (004:45 GET Passive Thermal Control entry) for timing and effects.
- `COAST_002`–`COAST_021`: Apollo 11 Flight Plan Section 4 (pp. 4-6 to 5-5) for PTC maintenance and consumables tracking, Apollo 11 Mission Operations Report Section 3.3 for MCC-1 scheduling, and Flight Journal Day 2 commentary for execution notes.

## `checklists.csv`
- `FP_2-5_LAUNCH`, `FP_2-16_ORBIT`: Apollo 11 Flight Plan pages 2-5 through 2-17.
- `FP_3-10_TLI_PREP`, `FP_3-12_TLI_EXEC`, `FP_3-18_TD`: Flight Plan pages 3-10 through 3-20 with cross-checks against Flight Journal transcripts.
- `FP_4-04_PTC`: Flight Plan Section 4 (pages 4-4 through 4-6) Passive Thermal Control procedures.
- `FP_4-06_PTC_MON`, `FP_4-12_MCC1_PAD`, `FP_4-14_MCC1_EXEC`, `FP_4-16_MCC1_EVAL`: Flight Plan pages 4-6 through 4-16 and Apollo 11 Mission Operations Report Section 3.3 for MCC-1 references, supplemented by Flight Journal Day 2 notes.
- `FP_5-02_CONS_CHECK`, `FP_5-04_PTC_TRIM`: Flight Plan Section 5 (pages 5-2 through 5-5) for coast-phase consumables and thermal maintenance.

## `autopilots.csv` & `autopilots/PGM_06_TLI.json`
- Derived from the TLI PAD on Flight Plan page 3-14 and the Apollo 11 Flight Journal burn summary (002:44:14 GET start, 347-second duration).
- `PGM_MCC1`: Timed profile synthesized from the Apollo 11 Mission Operations Report Section 3.3 (MCC-1 targeting) and Flight Journal Day 2 descriptions of burn duration and ullage usage.

## `failures.csv`
- Failure triggers and effects reference the Apollo 11 Mission Operations Report Section 3 (trajectory dispersions) and Flight Journal Day 1 commentary on docking retries and PTC thermal management.
- Additional failure hooks for MCC-1 prep/execution, PTC drift, and consumables logging cite Apollo 11 Flight Plan Sections 4–5, Mission Operations Report Section 3.3, and Flight Journal Day 2 timeline callouts.

## `pads.csv`
- `PAD_TLI_002`: Flight Plan page 3-14 (TLI PAD parameters).
- `PAD_MCC1_001`: Apollo 11 Mission Operations Report Section 3.3 (Midcourse Correction 1 planning).
