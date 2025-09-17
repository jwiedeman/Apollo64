# Mission Data Ingestion Pipeline

This note expands on the Milestone M0 roadmap by detailing how future dataset updates should flow from research annotations into the committed CSV and JSON packs. It pairs with the notebooks planned in `scripts/ingest/` so contributors share a consistent mental model of the tooling.

## Source Preparation Checklist

1. **Annotate primary sources** – Update the working spreadsheets with new GET anchors, checklist deltas, and provenance references. Maintain column naming conventions so the notebooks can parse revisions without manual surgery.
2. **Record assumptions** – Capture any interpretation decisions directly in the spreadsheet (e.g., clarifying Flight Journal vs. Flight Plan timing discrepancies) and mirror the summary in `docs/data/provenance.md` when exporting.
3. **Stage raw assets** – Store supporting PDFs, scans, or CSVs in a temporary `_input` staging folder that the notebooks will read. Temporary artifacts should remain uncommitted.

## Notebook Execution Order

The recommended execution order keeps downstream dependencies satisfied:

1. `timeline_extraction.ipynb`
2. `checklist_builder.ipynb`
3. `pad_parser.ipynb`
4. `autopilot_catalog.ipynb`
5. `thruster_geometry.ipynb`
6. `failure_taxonomy.ipynb`
7. `communications_trends.ipynb`
8. `consumables_budget.ipynb`
9. `audio_cues.ipynb`

Running notebooks in this sequence ensures that event windows, checklists, PADs, autopilot metadata, and failure hooks stay synchronized before communications, consumables, and audio cue analytics recalculate their derivatives.

## Shared Notebook Helpers

The helper package under [`scripts/ingest/ingestlib/`](../../scripts/ingest/ingestlib) centralizes GET conversions, typed record objects, dataset loaders, validation routines, and provenance table builders. Import these modules directly from notebooks so the ingestion flow stays aligned with the JS validator and future automation.

```python
# Ensure PYTHONPATH includes scripts/ingest when running this snippet outside the notebook environment.
from pathlib import Path
from ingestlib import load_mission_data, validate_mission_data

mission = load_mission_data(Path('..') / '..' / 'docs' / 'data')
issues = validate_mission_data(mission)
print(f"Validation issues: {len(issues)}")
```

Use `ProvenanceBuilder` from the same package to append table rows to `docs/data/provenance.md` when exporting refreshed CSVs.

## Export & Review Protocol

- **Generated outputs** should land in `_build/` while under review. Once validated, copy the refreshed CSV/JSON files into `docs/data/` and update `docs/data/provenance.md` with row ranges and citations.
- **Diff inspection** is required for each dataset. Confirm that GET windows remain ordered, new prerequisites resolve, and autopilot references still link to existing JSON scripts. When large structural changes appear, add explanatory notes to the pull request summary.
- **Validation** relies on `npm run validate:data` from the JS workspace. Address warnings immediately so the dataset maintains parity with the simulator expectations documented for Milestones M0 and M1.
- **Parity checks** should be run via `npm run parity` when manual action scripts or autopilot entries change, verifying manual/autopilot equivalence across the relevant mission segments.

## Future Automation Hooks

- Extend the `ingestlib` helpers with CLI entrypoints so notebook logic can run headlessly in CI or scheduled regression jobs.
- Add smoke tests that re-run the notebooks in `--execute` mode and assert that regenerated CSVs are byte-identical to the committed versions unless an explicit update is requested.
- Schedule notebook execution in long-running branches to generate regression dashboards (propellant trends, DSN coverage) that can be embedded into milestone reports.

By codifying the ingestion flow, the project can continue expanding the mission datasets without jeopardizing the deterministic behavior that the JS prototype and N64 port rely upon.
