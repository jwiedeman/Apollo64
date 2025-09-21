# N64 Asset & Build Pipeline

This guide expands Milestone M4 by describing how the browser-first datasets convert into ROM-ready bundles for the libdragon build. The intent is to reuse the CSV/JSON packs maintained for the JS prototype while producing compact binaries, audio assets, and manifests that the Nintendo 64 runtime can stream efficiently.

## Goals
- Keep the N64 assets byte-for-byte traceable back to the research datasets under `docs/data/` and the UI definition bundles in `docs/ui/`.
- Produce deterministic binary packs so simulation parity checks can diff JS and N64 runs using shared hashes.
- Budget ROM and RAM consumption ahead of time, avoiding last-minute compromises when the renderer, audio pipeline, or logging buffers expand.
- Share tooling between notebook-driven ingestion (`scripts/ingest/`) and the ROM build so an updated dataset flows through validation, packing, and parity checks with minimal manual intervention.

## Source Data & Versioning
1. **Historical datasets** – `events.csv`, `checklists.csv`, `pads.csv`, `autopilots/`, `failures.csv`, `communications_trends.json`, and the consumables baseline feed the mission timeline, automation, and resource systems.
2. **UI definitions** – `docs/ui/checklists.json`, `panels.json`, `dsky_macros.json`, `workspaces.json`, and `hud_layout.md` inform layout metadata, checklist highlighting, and workspace presets required by Tile Mode.
3. **Audio catalog** – `docs/data/audio_cues.json` plus cue-channel bindings referenced by mission data determine which ADPCM assets must be present in ROM.
4. **Profile/scoring hooks** – `docs/sim/score_system.md` and `docs/sim/progression_service.md` drive commander rating thresholds and unlock metadata that must persist across runs.

For traceability the packer writes a `manifest.json` alongside each ROM build capturing:
- Source dataset revision hashes (Git commit + SHA256 per file).
- Tooling version (Git hash of `tools/pack_n64_assets.py` and libdragon revision).
- Build options (e.g., stripped vs. debug logging buffers, audio quality tier).

The N64 runtime displays the manifest hash on the splash screen and stores it inside Controller Pak logs to simplify QA triage.

## Binary Pack Layout
All binary blobs adopt a shared little-endian header: `struct PackHeader { char magic[4]; uint16_t version; uint16_t entryCount; uint32_t tableOffset; uint32_t payloadOffset; }`. The `magic` tag identifies the pack (e.g., `"MTIM"` for mission timeline). Tables contain fixed-width records so the loader can index without heap churn.

### Mission Timeline (`mission_timeline.bin`)
- **Table fields:** `event_id`, `window_open_s`, `window_close_s`, `autopilot_id`, `checklist_id`, `flags_required`, `flags_set`, `failure_id`, `audio_cue_id`.
- **Payload:** variable-length prerequisite arrays and PAD references stored as offsets into a string pool.
- **Notes:** Pre-computed seconds-from-launch values avoid parsing GET strings during play. PAD payloads convert to fixed-point for fast DSKY pre-fill.

### Checklist Pack (`checklists.bin`)
- **Table fields:** `checklist_id`, `phase`, `role`, `nominal_get_s`, `step_count`, `first_step_index`.
- **Step table:** contiguous `CheckStep` structures with `panel_id`, `control_mask`, `dsky_macro_id`, tolerance fields, and highlight metadata for HUD overlays.
- **Notes:** Control masks map directly to the switch-state bitfields described in [`docs/ui/panels.json`](../ui/panels.json), letting the libdragon UI validate toggles without string comparisons.

### Autopilot Scripts (`autopilots.bin`)
- **Table fields:** `autopilot_id`, `event_id`, `command_offset`, `command_length`, `expected_delta_v_cmps`, `expected_duration_cs`.
- **Payload:** concatenated command bytes in the same schema consumed by the JS runner (throttle ramps, RCS pulses, attitude holds) with alignment padding for DMA.
- **Notes:** The loader hydrates scripts into a ring buffer shared with the simulation loop. Tolerances mirror the PAD metadata so burn verification can reuse the JS logic verbatim.

### Communications & Trends (`telemetry.bin`)
- **Table fields:** DSN pass windows, signal strength, power delta, and comms cue bindings.
- **History payload:** compressed (delta-encoded) per-minute power/thermal/propellant histories sized for four-hour UI trends.
- **Notes:** Enables the Systems view to render the same charts documented in [`docs/ui/performance_telemetry.md`](../ui/performance_telemetry.md) without recalculating on-device.

### Audio Cue Table (`audio.tbl`)
- **Table fields:** `cue_id`, `category`, `bus`, `cooldown_cs`, `priority`, `asset_offset`, `asset_length`, `loop_flag`.
- **Notes:** The dispatcher module reads this table during boot and links it to libdragon mixer channels. Asset offsets point into an ADPCM blob described below.

### UI Layout Presets (`ui_workspaces.bin`)
- **Table fields:** `workspace_id`, `tile_count`, `flags` (e.g., Navigation/Controls/Systems defaults).
- **Payload:** `Tile` entries with normalized positions/sizes, minimum constraints, and associated component IDs. Tile IDs align with `docs/ui/workspaces.json` to keep parity with the web prototype.

### Profiles & Progression (`profile_defaults.bin`)
- **Table fields:** `profile_version`, `score_thresholds`, `unlock_flags`, `caption_defaults`, `control_mappings`.
- **Notes:** Seeded during first boot or when the Controller Pak lacks a valid save. Mirrors the schema referenced in [`docs/sim/progression_service.md`](../sim/progression_service.md).

## Audio Conversion Workflow
1. Export source WAV/FLAC files into `_input/audio/` with metadata (cue ID, loop points, gain recommendations) in `audio_manifest.csv`.
2. Run `tools/pack_n64_assets.py --audio` to:
   - Normalize to mono, 22.05 kHz using ffmpeg.
   - Apply cue-specific gain adjustments.
   - Convert to libdragon ADPCM via `audioconv64`, capturing loop samples when applicable.
   - Update `audio.tbl` with offsets and durations while verifying cooldown/priority constraints from `audio_cues.json`.
3. Inspect the generated `audio_report.txt` summarizing cumulative ROM usage per bus, peak concurrent channel counts, and cues trimmed due to budget limits.

## Build Workflow
1. **Prepare datasets:** Execute the ingestion notebooks (`docs/data/INGESTION_PIPELINE.md`) and run `npm run validate:data` followed by the parity harness to ensure JS and datasets remain healthy.
2. **Pack assets:** `make pack-assets` invokes `tools/pack_n64_assets.py` which emits the binary packs into `n64/assets/` and refreshes the manifest. The tool accepts `--dataset-dir`, `--ui-dir`, `--audio-dir`, and `--profile-dir` overrides for automation.
3. **Compile ROMs:**
   - `make rom-debug` links against libdragon with asserts, verbose logging, and USB debug enabled. Packs copy verbatim from `n64/assets/`.
   - `make rom-release` strips debug logs, compresses the mission timeline using LZ4 (optional), and enforces ROM size budgets (target <32 MB).
4. **Publish artefacts:** Generated ROMs land under `_build/rom/`. Manifest and log snapshots accompany each ROM for archival.

## Validation & Parity Checks
- **Pack integrity:** The packer writes CRC32 per blob and a global SHA256 recorded inside `manifest.json`. The ROM verifies CRCs at boot, falling back to a safe mode when validation fails.
- **Cross-build parity:** A CLI utility `tools/compare_packs.py` diff-checks the packed binaries against the JS datasets (e.g., step counts, PAD parameters). Run this during CI alongside the JS regression suite.
- **Runtime parity:** Nightly jobs boot the debug ROM in cen64/ares, run scripted segments (`launch → MCC-2`, `LOI-1`, `TEI`), and compare deterministic logs against JS exports (`npm run export:ui-frames`). Divergence flags potential packing or fixed-point conversion bugs early.
- **Audio QA:** The audio report surfaces cues dropped due to ROM limits; reviewers update `audio_cues.json` or adjust loop parameters accordingly before merging.

## Next Steps
- Implement `tools/pack_n64_assets.py` with modular writers for each blob described above, sharing schema definitions with the JS validator to prevent drift.
- Add documentation for the runtime loaders in `n64/src/` once implementation begins, referencing the pack layouts and manifest contract defined here.
- Extend CI scripts to call `make pack-assets` before ROM builds, archiving manifests and pack reports for milestone sign-off.

Coordinating the ROM asset pipeline now ensures the Milestone M4 port inherits the simulator’s deterministic behaviour while respecting the Nintendo 64’s storage and memory constraints.
