# Ingestion Notebook Workspace

This directory will collect the reproducible notebooks and helper scripts that convert the annotated Apollo 11 research assets into the normalized CSV and JSON packs used by the simulator. Milestone M0 identifies the raw sources, target schemas, and validation expectations; the goal of this workspace is to translate that guidance into versioned tooling that keeps the dataset trustworthy as it expands (see `docs/milestones/M0_DATA_INGESTION.md`).

## Planned Notebook Set

The ingestion workflow is intentionally modular so new data slices and contingency branches can be onboarded without rewriting earlier steps.

| Notebook | Purpose | Key Outputs |
| --- | --- | --- |
| `timeline_extraction.ipynb` | Parse Flight Plan and Flight Journal GET stamps into a canonical minute-by-minute ledger while flagging conflicts for manual review. | Intermediate timeline table (`_build/timeline.parquet`) and a diff report against previously committed exports. |
| `checklist_builder.ipynb` | Transform checklist annotations into atomic steps with crew roles, expected responses, and citations. | `docs/data/checklists.csv` refresh plus checklist provenance appendix updates. |
| `pad_parser.ipynb` | Capture PAD cards, normalize parameters, and derive validity windows. | Updated `docs/data/pads.csv` and supplemental JSON describing parameter semantics for downstream validation. |
| `autopilot_catalog.ipynb` | Convert annotated burn profiles into JSON command sequences, record propulsion metadata, and stitch tolerances into the CSV catalog. | JSON files under `docs/data/autopilots/` and the accompanying `docs/data/autopilots.csv` row updates. |
| `thruster_geometry.ipynb` | Encode the CSM and LM RCS cluster layout, thrust levels, and control axes for use by the guidance/RCS milestone. | `docs/data/thrusters.json` and supporting geometry notes. |
| `failure_taxonomy.ipynb` | Aggregate failure callouts from the Flight Journal and MOCR notes into the structured taxonomy. | `docs/data/failures.csv` refresh plus inline links for recovery actions. |
| `communications_trends.ipynb` | Maintain the Deep Space Network analytics, ensuring GET windows, handovers, and signal strength trends stay synchronized with event data. | `docs/data/communications_trends.json` and summary dashboards for regression review. |
| `consumables_budget.ipynb` | Track baseline power, propellant, and life support budgets, pulling deltas from Mission Operations Report tables. | `docs/data/consumables.json` revisions and variance plots that feed the validation CLI. |

Notebooks will share helper modules for GET parsing, prerequisite resolution, and provenance logging so they stay aligned with the validator and avoid schema drift.

## Helper Modules

A lightweight Python package (`ingestlib`) will live alongside the notebooks and expose:

- **GET utilities** – conversions between `HHH:MM:SS` strings, floating-minute offsets, and pandas `Timedelta` objects.
- **Schema guards** – dataclass-backed representations of events, checklists, PADs, autopilots, and failures mirroring the definitions documented for Milestone M0.
- **Reference resolvers** – helpers that verify prerequisites, autopilot IDs, checklist links, and failure references before export.
- **Provenance logging** – wrappers that write row ranges and source citations into `docs/data/provenance.md` with consistent formatting.

The package will be imported by each notebook to minimize duplicated logic and make it easier to transition the ingestion flow into headless scripts later.

## Execution Workflow

1. **Annotate Sources** – Update the research spreadsheets/OCR documents, capture new GET anchors, and mark provenance references.
2. **Run Notebooks** – Execute the relevant notebook(s) in order, supplying the annotated sources and committing regenerated CSV/JSON outputs.
3. **Validate** – Execute `npm run validate:data` from the JS workspace to run the automated sweep before committing changes (see `docs/data/VALIDATION_CHECKS.md`).
4. **Review Diffs** – Inspect git diffs for large structural changes, confirm provenance updates, and run parity checks where applicable.

Future automation can convert the notebooks into CLI tasks, but keeping the notebooks checked in first ensures the ingestion logic remains auditable and editable as the datasets evolve.
