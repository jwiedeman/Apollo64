# UI Performance Telemetry & Instrumentation Plan

The presentation layer needs deterministic instrumentation so the web prototype,
the CLI harness, and the future Nintendo 64 build can prove that HUD refreshes,
view transitions, audio dispatch, and input handling stay within their budgets.
This plan details the metrics, logging hooks, and analysis workflow that keep
Milestone M3 (UI/audio) and Milestone M4 (N64 port) aligned with the simulator's
fixed-step expectations.

## Goals

1. **Real-time observability** – expose per-frame render timings, dropped-frame
   counts, audio queue depth, and input latency so regressions surface before
   they reach parity harnesses or long-run missions.
2. **Deterministic exports** – record the same telemetry in CLI HUD snapshots,
   `ui_frame` exports, and replay bundles so performance analysis is reproducible
   across platforms.
3. **N64 budget tracking** – mirror the instrumentation on libdragon builds,
   logging CPU/RDP usage and audio DMA headroom to Controller Pak or serial
   output without perturbing the 30 fps target.

## Metric Inventory

| Metric | Source | Notes |
| --- | --- | --- |
| `frame.renderMs` | Browser renderer / CLI HUD | Time from frame dispatch to UI render completion.
| `frame.diffCount` | View diffing layer | Widgets that re-rendered during the frame; higher counts hint at layout churn.
| `hud.dropCount` | HUD scheduler | Number of skipped HUD refreshes caused by backpressure.
| `audio.queueDepth` | Audio dispatcher | Active plus queued cues per bus; highlights when alerts sit behind lower-priority playback.
| `input.latencyMs` | Input dispatcher | Delay between the hardware event timestamp and `ManualActionQueue` enqueue.
| `sim.tickDriftMs` | Simulation clock | Difference between expected and actual tick cadence while the UI renders.
| `n64.cpuMs` / `n64.rdpMs` | Libdragon profiler | Per-frame CPU and RDP usage on Nintendo 64 builds.

Metrics adopt SI units and roll into minute-resolution aggregates for trend
widgets. Instantaneous samples feed developer overlays.

## Instrumentation Layers

1. **Simulation tick hooks:** Extend `Simulation.run()` and
   `UiFrameBuilder` to capture tick duration (`sim.tickDriftMs`), HUD drop counts,
   and audio queue depth each time a frame is generated.
2. **UI shell timers:** Web builds wrap `requestAnimationFrame` callbacks and
   tile-mode layout diffs to populate `frame.renderMs` and `frame.diffCount`.
3. **Input service telemetry:** The shared input dispatcher timestamps hardware
   events before dispatch and logs the enqueue GET for manual actions to compute
   `input.latencyMs`.
4. **Audio dispatcher stats:** `audioDispatcher.stats()` publishes per-bus
   queue depth, ducking actions, and cooldown skips so HUD overlays and mission
   logs can flag saturation.
5. **N64 profiling hooks:** Libdragon builds compile with lightweight timers that
   write CPU/RDP usage to a ring buffer. Export routines flush the buffer to
   Controller Pak slots or serial dumps during pause screens.

## Logging & Export Workflow

- **Mission log:** Every minute, emit a `ui_performance` entry summarizing
  rolling averages (render time, diff count, input latency) alongside peak audio
  queue depth and dropped HUD frames. Entries include `source: 'ui'` and
  `category: 'performance'` for filterable replay analysis.
- **`ui_frame` payload:** Attach a `performance` block with the most recent
  samples plus rolling averages so CLI exports and replay viewer timelines can
  plot them without replaying raw logs.
- **CLI HUD:** Display a developer overlay (hidden by default) that prints the
  latest metrics when `--hud-debug` is enabled, matching the instrumentation
  described in [`docs/ui/hud_layout.md`](hud_layout.md).
- **Parity harness:** When `npm run parity` executes, compare the recorded
  performance metrics between auto/manual runs to ensure manual UI actions do not
  introduce drift.

## Alerting & Thresholds

| Condition | Threshold | Response |
| --- | --- | --- |
| Render time spike | `frame.renderMs > 45` ms (web) | Log `warning` entry, highlight Always-On HUD band amber.
| HUD drop streak | `hud.dropCount ≥ 3` consecutive frames | Emit `performance` caution and attach breadcrumb referencing active view.
| Audio queue saturation | `audio.queueDepth.alerts > 1` | Trigger console dock banner instructing designers to adjust ducking.
| Input latency | `input.latencyMs > 120` ms | Log parity warning; replay viewer flags manual entries exceeding the budget.
| N64 CPU budget | `n64.cpuMs > 12` ms | Record Controller Pak bookmark prompting optimisation; CLI warns during ROM export.

Thresholds follow N64 30 fps budgets and browser comfort limits while leaving
headroom for future optimisation.

## Analysis Tooling

- **`npm run analyze:performance` (planned):** Replays a mission slice,
  writes CSV/JSON performance logs, and highlights threshold breaches.
- **Notebook integration:** Extend `scripts/ingest` notebooks with optional
  performance charts by reading the exported metrics from CLI runs. Useful for
  milestone reports.
- **Replay viewer overlays:** The timeline heatmap renders render-time and
  audio-queue bands alongside manual/auto heatmaps so reviewers correlate
  performance regressions with mission events.

## N64 Deployment Notes

- Disable expensive timers in release builds; retain them for debug ROMs and
  automated soak tests.
- Instrumentation writes compressed summaries (e.g., 16-bit fixed-point ms values)
  to minimize Controller Pak usage (<4 KB per 6-hour slice).
- Provide a developer hotkey (`Start + L`) to dump the current performance ring
  buffer over serial for emulator capture.

## Implementation Checklist

1. Add `performance` structs to `UiFrameBuilder` and expose recent samples
   alongside the existing HUD payload.
2. Extend `MissionLogger` helpers to standardize `ui_performance` entries and
   update `MissionLogAggregator` so the new category inherits filter metadata.
3. Implement optional CLI flags (`--hud-debug`, `--profile-performance`) that
   enable overlays or CSV output without affecting default runs.
4. Update `exportUiFrames` to persist performance metrics in metadata and each
   frame entry when the builder provides them.
5. Mirror the metric definitions in the N64 build, writing profiles to
   Controller Pak or serial dumps for offline analysis.
6. Document regression expectations in [`docs/testing/REGRESSION_PLAN.md`](../testing/REGRESSION_PLAN.md)
   once the CLI tooling lands so future contributors run the same checks.

This instrumentation plan keeps presentation performance measurable and
reproducible, ensuring that UI and audio fidelity stay aligned with the simulator
across both browser and Nintendo 64 targets.
