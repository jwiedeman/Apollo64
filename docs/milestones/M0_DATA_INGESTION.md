# Milestone M0 — Historical Ingestion & Event Data Creation

Milestone M0 bootstraps the simulator with structured mission data extracted from the Apollo 11 primary sources. The objective is to deliver normalized CSV packs and reference notes that later milestones can consume without revisiting the raw material.

## Deliverables
- Canonical Apollo 11 timeline anchored to Ground Elapsed Time (GET) in one-minute resolution.
- Event CSV describing mission beats, prerequisites, autopilot hooks, and failure consequences.
- Checklist CSV mirroring the Apollo 11 Flight Plan and supporting callouts.
- PAD uplink dataset for guidance, burns, and consumables updates.
- Provenance log linking each derived record to its page/paragraph in the source documents.

## Source Inventory
| Source | Coverage | Notes |
| --- | --- | --- |
| Apollo 11 Flight Plan (Final) | Timelines, checklists, crew cues | Primary driver for event sequencing and procedure text. |
| Apollo 11 Flight Journal | Narrative timeline, GET anchors, voice transcripts | Use to cross-check durations, callouts, and anomaly notes. |
| Mission Operations Report | Burn performance, MCC schedules, trajectory data | Supplies tolerances, Δv budgets, and midcourse windows. |
| Systems handbooks & MOCR notes | Subsystem limitations, fault responses | Useful for failure taxonomy elaboration. |

## Ingestion Pipeline
1. **Digitize & OCR** — Ensure all PDFs have searchable text; correct OCR artifacts around GET stamps, degrees, and checklist numbering.
2. **Timeline Extraction** — Build a spreadsheet keyed by GET in `HHH:MM:SS` capturing start/stop times for each procedure. Use Flight Plan as baseline and annotate differences observed in Flight Journal.
3. **Checklist Breakdown** — Split checklists into atomic steps. Each entry keeps: `checklist_id`, `step_number`, `action`, `expected_response`, `crew_role`, `reference`.
4. **PAD Parsing** — Extract PAD cards (TLI, MCC, LOI, TEI, etc.) into structured fields: `pad_id`, `purpose`, `GET_delivery`, `parameters`, `valid_until`, `source_ref`.
5. **Autopilot Script Hooks** — Flag steps where autopilot or guidance programs engage. Record necessary parameters (e.g., `PGM`, `target_attitude`, `thrust_profile`).
6. **Failure Notes** — Capture conditions and resulting penalties directly from Flight Journal and MOCR. Map them to `failure_id` entries for later simulation hooks.
7. **Export CSVs** — Convert the curated sheets into machine-readable CSV packs stored under `docs/data/` (to be created during M0 execution).
8. **Validation Sweep** — Run scripts to verify chronological ordering, dependency closure, and GET uniqueness. Spot-check against published GET anchors (TLI 002:44:14, LOI 075:50:00, Landing 102:45:40).

## Data Schemas

### Events (`events.csv`)
| Field | Description |
| --- | --- |
| `event_id` | Unique identifier (`phase_sequence`, e.g., `TLI_001`). |
| `phase` | High-level phase label (`Launch`, `Translunar`, `LOI`, etc.). |
| `get_open` / `get_close` | Earliest/latest GET window for the event. |
| `craft` | `CSM`, `LM`, or `Joint`. |
| `system` | Subsystem focus (`Guidance`, `Power`, `Comms`, `Thermal`, `Navigation`). |
| `prerequisites` | Comma-delimited `event_id`s that must be completed. |
| `autopilot_script` | Optional reference to `autopilots.csv`. |
| `checklist_id` | Links to the crew checklist steps. |
| `success_effects` | Δ-resource outcomes when within tolerance (JSON blob). |
| `failure_effects` | Consequences when missed or late (JSON blob referencing `failure_id`). |
| `notes` | Freeform clarifications or voice call excerpts. |

### Checklists (`checklists.csv`)
| Field | Description |
| --- | --- |
| `checklist_id` | Identifier tied to Flight Plan section (e.g., `FP_2-8`). |
| `title` | Human-readable name. |
| `GET_nominal` | Nominal GET for reference. |
| `crew_role` | `CDR`, `CMP`, `LMP`, `Joint`. |
| `step_number` | Sequential step index. |
| `action` | The command or verification performed. |
| `expected_response` | Anticipated meter/indicator result. |
| `reference` | Source citation (page/paragraph). |

### Autopilot Scripts (`autopilots.csv`)
| Field | Description |
| --- | --- |
| `autopilot_id` | Identifier (`PGM_06_TLI`). |
| `description` | Summary of the maneuver. |
| `script_path` | Relative path to JSON script with detailed time/thrust points. |
| `entry_conditions` | Required craft state before engagement. |
| `termination_conditions` | Condition to exit the script (Δv met, GET limit, manual abort). |
| `tolerances` | Acceptable deviation ranges for scoring and failure evaluation. |

### Failures (`failures.csv`)
| Field | Description |
| --- | --- |
| `failure_id` | Unique identifier for linking from events. |
| `classification` | `Recoverable`, `Hard`, or `Technical`. |
| `trigger` | Condition that causes the failure. |
| `immediate_effect` | Instantaneous outcome (e.g., `Δv_margin -= 10`). |
| `ongoing_penalty` | Time-based degradation. |
| `recovery_actions` | Steps the crew may take. |
| `source_ref` | Provenance citation. |

## Output Structure
- `docs/data/events.csv`
- `docs/data/checklists.csv`
- `docs/data/autopilots.csv`
- `docs/data/failures.csv`
- `docs/data/pads.csv`
- `docs/data/provenance.md`

Each CSV should include a header row, adhere to UTF-8, and avoid Excel artifacts (smart quotes, tabs). `provenance.md` lists each dataset row range with citations (Flight Plan page, Journal entry time).

### Current Dataset Status
- Launch through LOI-2 circularization (GET ≤ 081:00:00) populated across all CSV packs with representative data.
- Autopilot JSON assets under `docs/data/autopilots/` now cover TLI, MCC-1/2/3/4, and LOI-1/2 and are referenced by the metadata CSV.
- Provenance log documents the specific Flight Plan, Flight Journal, and Mission Operations Report sections leveraged to date.

## Tooling Recommendations
- Use a lightweight Python ingestion script (`scripts/ingest/` to be created later) to convert annotated spreadsheets into CSV, preserving GET formatting and verifying dependencies.
- Adopt unit-style checks that confirm: monotonically increasing GET within phases, valid references between events/checklists/failures, and PAD times falling inside corresponding event windows.
- Commit the ingestion notebooks or scripts alongside the CSV exports for reproducibility.

## Acceptance Criteria
- All milestone deliverables exist and pass validation scripts without manual edits.
- Sample queries ("find all events blocking LOI", "list all power-related failures during translunar coast") can be answered directly from the CSVs.
- The project README references the data location and ingestion approach for contributors joining after M0.
