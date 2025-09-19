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

These notebooks rely on the `ingestlib` helper package for GET parsing, prerequisite resolution, and provenance logging so they stay aligned with the validator and avoid schema drift.

## Helper Modules

The `ingestlib` Python package now ships with the workspace and consolidates the shared notebook helpers:

- **`ingestlib.time`** – canonical Ground Elapsed Time parsing/formatting helpers that mirror the simulator's expectations.
- **`ingestlib.records`** – dataclass-backed representations of events, checklists, autopilots, PADs, failures, audio cues, UI checklists/panels/workspaces, and the combined `MissionData` container.
- **`ingestlib.loader`** – CSV/JSON loaders that resolve file paths relative to `docs/data/` (and `docs/ui/` for presentation bundles) and return typed records ready for analysis, including the audio routing and UI definition packs.
- **`ingestlib.validation`** – reusable structural checks (window ordering, reference resolution, autopilot script health, PAD GET parsing).
- **`ingestlib.provenance`** – utilities for composing Markdown tables that document row ranges and source citations.

```python
# Ensure PYTHONPATH includes scripts/ingest when running outside the notebooks.
from pathlib import Path
from ingestlib import load_mission_data, validate_mission_data
from ingestlib.provenance import ProvenanceBuilder

data_dir = Path('..') / 'docs' / 'data'
ui_dir = Path('..') / 'docs' / 'ui'
mission = load_mission_data(data_dir, ui_dir=ui_dir)
issues = validate_mission_data(mission)

if issues:
    for issue in issues:
        print(issue.level, issue.category, issue.message, issue.context)

provenance = ProvenanceBuilder()
provenance.add('events.csv', 'TLI_001–TLI_005', 'Flight Plan p. 3-10 – 3-16')
print(provenance.to_markdown())
```

Import these modules directly from notebooks to stay aligned with the committed dataset schemas and the JS validator.

## Execution Workflow

1. **Annotate Sources** – Update the research spreadsheets/OCR documents, capture new GET anchors, and mark provenance references.
2. **Run Notebooks** – Execute the relevant notebook(s) in order, supplying the annotated sources and committing regenerated CSV/JSON outputs.
3. **Validate** – Execute `npm run validate:data` from the JS workspace to run the automated sweep before committing changes (see `docs/data/VALIDATION_CHECKS.md`).
4. **Review Diffs** – Inspect git diffs for large structural changes, confirm provenance updates, and run parity checks where applicable.

Future automation can convert the notebooks into CLI tasks, but keeping the notebooks checked in first ensures the ingestion logic remains auditable and editable as the datasets evolve.
