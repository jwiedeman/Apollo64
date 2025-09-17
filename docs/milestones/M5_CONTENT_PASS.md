# Milestone M5 — Full Mission Content Pass

Milestone M5 transforms the simulator from a representative slice of the Apollo 11 mission into a complete multi-day experience. The focus shifts from new engine features to curating the remaining mission procedures, PADs, autopilot references, and failure hooks so every checklist item and mission beat is represented in the structured datasets.

## Objectives
- Close all outstanding gaps in the mission datasets so events, checklists, PADs, autopilots, failures, and consumables cover GET 000:00:00 through splashdown without placeholders.
- Produce mission graph annotations for optional branches (aborts, contingency MCCs, alternate checklist flows) with clear prerequisites and recovery hooks.
- Verify that every dataset record includes provenance metadata back to the source document or transcript segment.
- Deliver ingest notebooks or scripts that regenerate the CSV/JSON packs and validate them with the automated sweep from Milestone M0.

## Mission Content Backlog

The following content areas require focused extraction and cross-checking before M5 is complete:

### Surface Operations
- **EVA-2 timeline:** Capture the second EVA traverses, sample collection, ALSEP deployment, and closeout procedures. Each checklist entry should reference Flight Journal Day 6 transcripts and Flight Plan Section 7 updates.
- **Surface anomalies & cues:** Add failure hooks for suit delta-P excursions, biomedical telemetry alerts, and timeline slips when geology tasks run long. Map their recovery actions to mission rules (e.g., skip second traverse leg, re-enter early).
- **Crew rest periods:** Record GET anchors for post-EVA sleep cycles, ensuring the scheduler blocks conflicting events and updates consumable trends accordingly.

### Transearth Coast & Entry
- **DSN support analytics:** Expand the transearth communications entries with signal strength trends, handover timing between stations, and resource implications when windows slip.
- **MCC-5 refinement:** Incorporate post-flight dispersion analyses, burn trim options, and the associated failure/recovery steps for missed TIG or underburn cases.
- **Entry corridor management:** Detail the lift vector steering callouts, backup PAD references, and failure cascades for corridor violations or drogue deployment delays.

### Contingency & Optional Branches
- **Abort ladders:** Document key abort opportunities (e.g., TLI+X, LOI no-go, late PDI wave-offs) with their alternate PAD requirements, checklists, and resource deltas.
- **Pad uplink retries:** Model DSN-driven retry cadence for PAD transmissions, including communications blackout propagation into the scheduler and failure taxonomy.
- **Crew-initiated deviations:** Provide explicit manual action hooks for common deviations (e.g., extra P52 alignments, additional consumables surveys) with documented resource effects.

## Data Integration Workflow
1. **Source synthesis:** Continue leveraging the canonical spreadsheets or note-taking environment to collate GET-tagged procedures. Track source references alongside each row.
2. **Notebook automation:** Create Python notebooks under `scripts/ingest/` (or equivalent) that transform annotated sheets into normalized CSV/JSON files. Each notebook should include embedded validation cells that call the shared GET/parsing helpers.
3. **Schema extensions:** When new columns are required (e.g., `abort_branch`, `audio_cue` placeholders, DSN metrics), document them in `docs/data/README.md` and extend the validator in `js/src/tools/validateMissionData.js` so regressions are caught immediately.
4. **Iterative validation:** Run the validator after every major data injection. Capture summary stats (event counts per phase, checklist coverage) to confirm the mission graph stays balanced.
5. **Provenance log updates:** Expand `docs/data/provenance.md` with row ranges covering the new entries and cite the exact Flight Plan pages, Mission Operations Report sections, or Flight Journal timestamps used.

## Tooling & Collaboration Notes
- The ingest notebooks/scripts should support partial regeneration so teams can iterate on a subset (e.g., EVA-2 checklists) without clobbering other packs.
- Document export settings (CSV delimiter, GET formatting, JSON indent rules) so contributors using different tooling produce consistent results.
- Annotate outstanding questions (e.g., ambiguous transcript timing) in `provenance.md` or companion notes to flag research tasks for future updates.
- Coordinate with the HUD/audio planning (Milestone M3) to ensure newly introduced event metadata anticipates upcoming UI cues.

## Validation & Acceptance Criteria
- All mission phases, including optional/contingency paths, exist in the datasets with no placeholder text (`TBD`, `TODO`).
- The ingestion notebooks/scripts run end-to-end to regenerate the packs and finish with a clean `npm run validate:data` pass.
- Sample mission queries—"Which events block LOI if MCC-4 is skipped?", "List all power-related failures during EVA-2"—can be answered directly from the datasets without re-opening the source documents.
- The README and project plan reference the completed datasets and direct contributors to the ingest tooling for reproducible updates.
