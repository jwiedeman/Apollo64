# Audio Dispatcher Architecture & Implementation Plan

This blueprint documents how the Apollo 11 simulator will translate the
structured cue catalog (`docs/data/audio_cues.json`) into deterministic
playback across the web prototype and the future Nintendo 64 build.
It extends the taxonomy work in [`audio_cue_taxonomy.md`](audio_cue_taxonomy.md)
by defining runtime pipelines, integration points with the mission
scheduler, and tooling expectations so audio feedback remains a first-class
mission signal rather than an afterthought.

## Goals

1. **Deterministic playback** – cues trigger from mission truth (events,
   failures, manual actions) with reproducible ordering and timing.
2. **Priority-aware mixing** – alerts pre-empt ambience, mission callouts
   duck lower-priority beds, and UI feedback never obscures caution tones.
3. **Cross-platform parity** – Web Audio and libdragon builds consume the
   same cue metadata, routing rules, and logging contract.
4. **Accessible feedback** – playback emits caption/haptic hooks described
   in [`logging_accessibility_guidelines.md`](logging_accessibility_guidelines.md).

## Runtime Inputs & Data Flow

```
Mission Systems → Event/Fault Bus → Audio Binder → Dispatcher → Mixer
                                             ↘ Logger/Recorder
```

- **Cue catalog** – `audio_cues.json` supplies bus/category metadata,
  routing priorities, ducking matrices, cooldowns, and asset manifests.
- **Scheduler hooks** – events (`events.csv`), failures (`failures.csv`),
  autopilot transitions, checklist acknowledgements, and manual queue
  actions publish cue IDs via an `audio_cue` (single) or `audio_cues`
  (array) property. Binder utilities resolve these IDs into dispatcher
  requests.
- **Context payload** – each trigger carries metadata (GET, source,
  linked event/checklist ID, severity, playback hints). UI surfaces this
  context for captions and HUD lamp tooltips.

## System Components

### 1. Audio Binder

A lightweight module that lives beside the scheduler/resource systems.
Responsibilities:

- Normalize trigger payloads (single ID vs. array) into dispatcher-ready
  requests.
- Enforce optional predicates defined in the cue catalog (e.g., only play
  `MASTER_ALARM` when `alert.severity === 'warning'`).
- Attach provenance (event ID, failure ID, checklist step) for logging
  and caption output.

### 2. Dispatcher Core

The dispatcher accepts normalized requests and routes them through three
queues: **alerts**, **mission callouts**, and **ambient/UI**. Each request
stores:

| Field | Purpose |
| --- | --- |
| `cueId` | Maps to `audio_cues.json` entry. |
| `priority` | Derived from catalog category weight and trigger severity. |
| `source` | Event/failure/manual identifier for logging. |
| `context` | Structured metadata for captions/HUD. |
| `expiresAt` | Optional GET when the cue becomes irrelevant. |

Processing rules:

1. Fetch catalog entry and evaluate cooldown windows (global + per cue).
2. Resolve routing target (bus/channel) and ducking behavior.
3. Preload/stream asset if not already cached.
4. Schedule playback with deterministic offset (default 0 s, optional
   positive delay for transcripts that historically followed a call).
5. Emit log entry (`AudioCueTriggered`) with GET, cue ID, source, and
   mixing decisions.

### 3. Mixer Abstraction

Provides platform-specific playback primitives while sharing the same
interface:

```ts
interface AudioMixer {
  preload(cue: CueMetadata): Promise<void>;
  play(cue: CueMetadata, options: PlaybackOptions): PlaybackHandle;
  stop(handle: PlaybackHandle, reason: string): void;
  setGain(busId: string, value: number, rampSeconds?: number): void;
}
```

- **Web build** – implemented with Web Audio API nodes (GainNode for
  buses, BiquadFilter for radio EQ, ConvolverNode for comm reverb).
- **N64 build** – wraps libdragon's audio streaming. Assets convert to
  mono ADPCM at 22.05 kHz; bus gains map to per-channel volume commands.

### 4. Logger & Recorder

All playback events append to the mission log (`source: 'audio'`) and the
manual action recorder's companion audio stream. The recorder stores cue
IDs, GET, duration, and ducking state so parity harnesses and replay tools
can reconstruct the soundscape alongside HUD frames.

## Trigger Matrix

| Trigger Source | Example Cue | Notes |
| --- | --- | --- |
| Event activation | `MISSION_GO_TLI` | Optionally delayed to match CapCom transcript timing. |
| Failure latch | `MASTER_ALARM` | Raises alert lamp, forces ducking of ambience/UI channels. |
| Checklist step complete | `CHECKLIST_ACK` | Quiet tick routed to UI bus; suppressed when manual queue auto-advances. |
| Autopilot transition | `PROGRAM_ALARM` | Optional playback when guidance programs switch (P63 ↔ P64). |
| Manual queue error | `INPUT_ERROR` | Short chirp with caption “INVALID INPUT”. |
| Communications window open | `COMMS_ACQUIRE` | Loops until DSN pass closes, crossfading stations. |

Developers attach cue references during dataset authoring or runtime by
setting `event.audio_cue = 'MISSION_GO_TLI'` or by publishing an
`AudioTrigger` message to the event bus.

## Priority, Ducking, and Concurrency

- **Priority bands** – alerts > mission callouts > ambience > UI.
- **Ducking** – each catalog entry defines duck targets and attenuation in
  dB. Dispatcher ensures one duck action per frame to avoid zipper noise.
- **Concurrency caps** – default max simultaneous cues: 4 (alert, callout,
  ambience, UI). Additional requests either queue or replace lowest
  priority playback based on catalog `stealMode` (`queue`, `drop`, `steal`).
- **Loop management** – ambience/comm loops specify `loop: true` and
  optional crossfade duration. Dispatcher crossfades station loops during
  DSN handovers.

## Accessibility Hooks

- Every trigger publishes caption text and category to the accessibility
  overlay described in `logging_accessibility_guidelines.md`.
- Optional haptic metadata (`hapticPatternId`) allows future controllers
  to vibrate in sync with alerts.
- Volume presets (master, alerts, ambience, UI) persist in workspace
  profiles and Controller Pak saves.

## Implementation Roadmap

1. **Phase A – Data plumbing**
   - Extend mission datasets with `audio_cue` references where missing.
   - Add binder utilities (`audioTriggers.js`) that wrap scheduler/failure
     emissions and surface `AudioTrigger` messages on the mission event
     bus.
2. **Phase B – Web prototype**
   - Implement Web Audio mixer with bus graph, ducking matrix, and
     waveform preloading.
   - Integrate dispatcher into CLI HUD for headless testing (logs only).
   - Build `npm run validate:audio` CLI to replay cue triggers and verify
     cooldown/priority rules against catalog metadata.
3. **Phase C – UI integration**
   - Hook Always-On HUD master alarm button to dispatcher mute/resume.
   - Surface captions in console dock, align highlight color with cue
     category.
   - Record playback events in `exportUiFrames` metadata for UI
     prototyping.
4. **Phase D – N64 port alignment**
   - Translate dispatcher API to libdragon: implement double-buffered
     ADPCM streaming, per-bus gain scheduling, and ducking via volume
     ramps.
   - Budget ROM/RAM usage per cue category, documenting loop lengths and
     reuse (e.g., share cabin hum between modes).

## Testing & Tooling

- **Unit tests** – ensure priority queue ordering, cooldown enforcement,
  and ducking math (gain ramps) behave deterministically.
- **Golden mission replay** – run a 6-hour translunar slice, capture
  audio trigger log, and diff against golden JSON to guard regressions.
- **Waveform linting** – add script to scan asset loudness (target -16
  LUFS integrated, peak ≤ -1 dBFS) to guarantee consistent playback
  between sources.

## Integration with Documentation

- Cue definitions, routing, and ducking matrices remain the source of
  truth in `audio_cues.json` and `audio_cue_taxonomy.md`.
- This dispatcher plan informs the Milestone M3 deliverables described in
  [`docs/milestones/M3_UI_AUDIO.md`](../milestones/M3_UI_AUDIO.md) and
  guides the libdragon implementation tasks in
  [`docs/milestones/M4_N64_PORT.md`](../milestones/M4_N64_PORT.md).
- Update the README and project plan whenever new dispatcher capabilities
  (e.g., haptics, adaptive ambience) land so contributors understand the
  audio pipeline surface area.

By codifying the dispatcher before implementation, the team can add cues,
automate validation, and wire the HUD/audio controls with confidence that
both the browser prototype and N64 build will share the same mission-first
soundscape.
