# Workspace Store & Tile Layout Persistence

The workspace store manages every layout preset, tile mutation, and
accessibility override for the presentation layer defined in
[`hud_layout.md`](hud_layout.md) and powered by the Always-On HUD
contract from [`ui_frame_reference.md`](ui_frame_reference.md). It keeps
the Navigation/Controls/Systems views, Tile Mode, and preset exports in
sync with the simulator so developers, players, and the N64 port all
operate on identical workspace data.

## Goals

1. **Authoritative layouts** – load the curated presets in
   [`workspaces.json`](workspaces.json) and expose them through a single
   API so the web prototype, ingestion notebooks, and parity tooling use
   the same geometry.
2. **Deterministic mutations** – record tile moves, resizes, focus
   transitions, and accessibility toggles with GET stamps. Every change
   feeds the mission log (`workspace:update` entries) and manual action
   recorder for replay parity.
3. **Portable persistence** – serialize overrides to JSON (CLI export,
   browser download, Controller Pak) while preserving upstream preset
   metadata so contributors can diff changes against the committed
   baseline.
4. **Cross-platform budget awareness** – surface layout complexity and
   active widget counts so the eventual N64 build can enforce limits
   (tile cap, text banding, memory for cached trajectories).

## State Model

The store exposes reactive getters for UI components and plain objects
for persistence. A representative state snapshot looks like:

```json
{
  "version": 1,
  "activePresetId": "NAV_DEFAULT",
  "activeView": "navigation",
  "tiles": {
    "trajectory": { "x": 0, "y": 0, "width": 0.58, "height": 0.65 },
    "navball": { "x": 0.58, "y": 0, "width": 0.42, "height": 0.4 },
    "timeline": { "x": 0, "y": 0.65, "width": 1, "height": 0.15 }
  },
  "overrides": {
    "hudPinned": true,
    "highContrast": false,
    "captionMode": "minimal"
  },
  "inputOverrides": {
    "keyboard": {},
    "controller": {},
    "n64": {}
  },
  "history": [
    { "type": "tile.move", "tileId": "navball", "get": "003:12:44" },
    { "type": "tile.focus", "tileId": "trajectory", "get": "003:12:45" }
  ]
}
```

- `tiles` stores normalized geometry for every active window (Navigation
  layouts omit Systems-only tiles until the view switches).
- `overrides` captures workspace-wide toggles: HUD pin state, high
  contrast, caption verbosity, and other accessibility options described
  in [`logging_accessibility_guidelines.md`](logging_accessibility_guidelines.md).
- `inputOverrides` mirrors the input mapping layer documented in
  [`input_mappings.md`](input_mappings.md), enabling future remapping UI
  to persist per-profile bindings.
- `history` retains the last N mutations (default 32) so the manual
  action recorder can emit deterministic `workspace:update` payloads and
  replay scripts can reconstruct layouts without diffing entire blobs.

## Lifecycle

1. **Bootstrap** – During simulator startup, the loader reads
   `workspaces.json`, validates it against the schema in
   [`json_schemas.md`](json_schemas.md), and seeds the store with each
   preset. Validation errors block the run and surface through
   `npm run validate:data` to protect downstream builds.
2. **Preset activation** – Switching views (`1/2/3` keys or controller
   shortcuts) calls `workspaceStore.activatePreset(viewId)` which copies
   the curated layout into `tiles`, applies saved overrides, and emits a
   `workspace:preset_loaded` mission log entry.
3. **Tile mutation** – Drag/resize/focus operations invoke
   `workspaceStore.mutateTile(tileId, patch, context)`; the store clamps
   values to preset constraints, merges the patch, records the history
   entry, and emits a `workspace:update` log with GET, tile metadata, and
   pointer device (keyboard/gamepad/N64) for parity checks.
4. **Override toggles** – HUD pin, high contrast, caption verbosity, and
   input remaps call `workspaceStore.updateOverride(key, value)`.
   Overrides persist across presets and propagate to the Always-On HUD in
   the next frame.
5. **Persistence/export** – The CLI and browser builds expose
   `workspaceStore.serialize()` to emit a JSON blob containing the active
   preset ID, overrides, and custom tiles. Developers can commit curated
   presets by copying the `presets` array into `workspaces.json`; players
   store per-profile overrides under `_profiles/<name>/workspace.json`.
6. **Replay/import** – Manual action scripts and parity harnesses can
   call `workspaceStore.applySerialized(state, { merge: true })` to load
   recorded overrides without overwriting curated presets, ensuring HUD
   playback matches the original session.

## Event & Telemetry Hooks

| Event | Payload | Consumers |
| --- | --- | --- |
| `workspace:preset_loaded` | `presetId`, `view`, `source` | Mission log, accessibility narrator (announces layout change), parity harness. |
| `workspace:update` | `tileId`, `mutation`, `pointer`, `view`, `get` | Manual action recorder, HUD console dock, regression diffs. |
| `workspace:override_changed` | `key`, `value`, `source` | Audio captions, HUD palette swap, accessibility export. |
| `workspace:input_override` | `device`, `binding`, `action` | Input mapper UI, parity harness (records remap for replays). |

Every event writes to the mission log with `logSource: 'ui'` and
`logCategory: 'workspace'`, preserving deterministic ordering alongside
checklist, audio, and AGC traffic.

## Budget & Platform Constraints

- **Tile cap:** Desktop builds allow up to 12 simultaneous tiles; N64
  builds target 6 to stay within display list limits. The store exposes
  `workspaceStore.capacity` so layouts can disable unused widgets when
  exceeding the platform cap.
- **Geometry precision:** Tiles store four-decimal normalized values.
  N64 builds quantize to 1/40 increments (8 px at 320×240) when emitting
  display lists; the store tracks both the raw normalized values and the
  quantized coordinates for platform exporters.
- **Persistence size:** Controller Pak exports target <8 KB per profile.
  The serializer drops mutation history and trims override defaults when
  writing to Pak or EEPROM while leaving the CLI/browser exports intact.

## Integration Checklist

1. Implement `workspaceStore.js` under `js/src/hud/` with reactive
   getters (`getActivePreset()`, `getTiles()`, `onChange(callback)`).
2. Wire Navigation/Controls/Systems routers to
   `workspaceStore.activatePreset(viewId)` so layout swaps stay
   deterministic.
3. Feed tile drag/resize handlers through `workspaceStore.mutateTile`
   and dispatch mission log entries (include GET via
   `UiFrameBuilder.currentGet`).
4. Extend `ManualActionRecorder` to capture `workspace:update` events for
   parity replay.
5. Update the validator (`npm run validate:data`) to ensure every preset
   references valid widget IDs, honors platform capacity limits, and
   provides descriptions for accessibility logs.
6. Provide CLI commands (`npm run export:workspace`) and UI download
   buttons that call `workspaceStore.serialize()` for curated layouts or
   player overrides.
7. Mirror the store in the libdragon build by writing a lightweight C
   struct and JSON parser that maps to the same schema so presets remain
   portable.

With the workspace store defined, the upcoming UI implementation can
confidently manage Tile Mode, accessibility toggles, and replay exports
knowing every mutation flows through a deterministic, documented channel.
