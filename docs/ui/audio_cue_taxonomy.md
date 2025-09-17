# Audio Cue Taxonomy & Routing Plan

This document defines how the simulator categorizes, prioritizes, and
routes audio cues during Milestone M3. It aligns with the HUD and
component architecture notes so mission events, failures, and user
interactions share a consistent soundscape that can later be ported to
the Nintendo 64 audio mixer.

## Objectives

- Map the mission timeline, checklist flow, and failure taxonomy to a
  deterministic audio event table.
- Establish a priority-driven dispatcher that balances ambience, voice,
  alerts, and UI feedback without clipping or starving critical cues.
- Document asset requirements, loudness targets, and looping guidelines
  for both the Web Audio prototype and libdragon (ADPCM) port.
- Capture dataset hooks so ingestion scripts can annotate mission packs
  with cue identifiers.

## Cue Categories

| Category | Examples | Trigger Sources | Notes |
| --- | --- | --- | --- |
| **Alerts** | Master alarm, master caution, guidance mode change beeps | `ResourceSystem` thresholds, `failures.csv`, autopilot runner | Highest priority; interrupt ambience and voice as needed. |
| **Mission Callouts** | "Go for TLI", "You are Go for Docking", EVA timeline callouts | `events.csv` (`audio_cue` field), PAD deliveries, manual queue acknowledgements | Follow historical cadence; include subtitles/log entries. |
| **Checklist Feedback** | Step complete ticks, invalid toggle buzz | Checklist manager transitions, DSKY macro validation | Surface within Controls view; duck under alerts but above ambience. |
| **Ambient Beds** | Cabin hum, radio static, LM powerdown hum | Scheduler state (CSM/LM active), craft docking state, time of mission | Persist until replaced; fade/duck around alerts. |
| **UI Interactions** | Tile drag snap, workspace save confirmation, console filter toggles | UI component events | Short <250 ms cues; never pre-empt higher categories. |
| **Telemetry Hints** | DSN acquisition tone, PTC entry beep, burn start/stop chirps | Event scheduler, autopilot runner, communications scheduler | Provide additional situational awareness; share priority with checklist feedback. |

## Priority & Mixing Rules

1. **Alert Stack (Priority 100–80):** Master alarms (100) pre-empt all
   other cues and mute ambience until resolved. Caution/warning tones
   (90–80) duck ambience by −12 dB and voice by −6 dB while playing.
2. **Mission Callouts (70–60):** Routed to the dialogue bus. Alerts can
   interrupt; otherwise callouts play sequentially. Provide 0.5 s of
   silence between callouts to avoid crowding transcripts.
3. **Telemetry & Checklist (50–40):** Share a mid-priority bus. When
   simultaneous, telemetry hints queue ahead of checklist confirmation
   ticks so maneuver cues remain intelligible.
4. **UI Interactions (30):** Fire immediately unless the channel already
   plays an interaction cue; in that case, retrigger after 100 ms to avoid
   stutter.
5. **Ambience (10):** Looped beds that fade in/out over 3 s. Alert
   categories can temporarily mute or duck them, after which ambience
   recovers to −16 LUFS integrated.

Each cue registers `{ priority, bus, duckingRules, cooldownSeconds }` so
runtime systems can enforce deterministic mixing without dynamic
allocation.

## Dataset Integration

- **Events CSV:** Add optional `audio_cue` (string) and `audio_channel`
  (enum) columns. Example values:
  - `audio_cue`: `calouts.go_for_tli`
  - `audio_channel`: `dialogue`
- **Failures CSV:** Introduce `audio_cue_warning` / `audio_cue_failure`
  fields referencing alert IDs (e.g., `alerts.master_alarm`).
- **Checklists CSV:** Allow `audio_cue_complete` for steps requiring
  bespoke confirmations (e.g., docking latch).
- **Communications Trends JSON:** Append `cue_on_acquire` and
  `cue_on_loss` to trigger DSN tones during handovers.

The ingestion notebooks emit consolidated cue tables under
`docs/data/audio_cues.json` (planned) listing cue metadata
(`id`, `category`, `assets`, `loop`, `lengthSeconds`, `loudnessLufs`).
`validateMissionData.js` will parse the new columns, ensuring cue IDs map
back to this pack and enforcing allowable channel names.

## Runtime Dispatcher

1. **Event Listener:** Subscribes to scheduler, resource, checklist, and
   UI domains. Each signal emits `{ id, priority, bus, payload }`.
2. **Deduplication:** Repeated cues within `cooldownSeconds` are collapsed
   unless flagged `allowRetrigger` (e.g., manual caution button).
3. **Queue Manager:** Maintains per-bus queues ordered by priority and
   timestamp. Alerts bypass the queue and claim the output immediately.
4. **Renderer Binding:**
   - **Web:** Web Audio API with GainNode hierarchies (`master > bus > cue`).
   - **N64:** Pre-allocated libdragon voices per bus (alerts, dialogue,
     telemetry, UI, ambience). Ducking modifies bus gain values stored in
     a fixed-point table to avoid floating-point cost.
5. **Logging:** Every cue dispatch writes an entry to the mission log and
   console dock (`type: 'audio', id, priority, source`). Replay tools can
   reconstruct the audio timeline without real-time synthesis.

## Asset Specifications

- **Format:**
  - Web: 48 kHz 16-bit PCM WAV masters, converted to Ogg for distribution.
  - N64: 22.05 kHz mono ADPCM (Yamaha ADPCM-A) with loop points aligned to
    zero crossings.
- **Loudness:** Normalize to −16 LUFS integrated, peak ≤ −1 dBFS. Alerts
  may peak at −3 dBFS for clarity but respect the integrated target.
- **Length:** Target <4 s for alerts and telemetry cues, <15 s for callouts
  (matching transcript length), ambience loops ~60 s before repeating.
- **Naming:** `category_subcategory_identifier__version.ext` (e.g.,
  `alert_master_alarm__v1.wav`). Replay logs reference cue IDs, not file
  names, allowing asset iteration without touching mission data.

## Accessibility & Localization

- Provide subtitle text and phonetic hints in `audio_cues.json` for all
  dialogue. The UI surfaces transcripts in the Console Dock and optional
  caption overlay.
- Expose a master "Text-to-Speech" toggle that mirrors callouts via
  synthesized speech for accessibility or placeholder use before VO
  recording completes.
- Keep cue metadata language-agnostic; localization swaps the asset path
  while preserving cue IDs and scheduling rules.

## Outstanding Tasks

- Author ingestion notebooks to populate `audio_cues.json` from annotated
  callout scripts and alert tables.
- Extend `validateMissionData.js` with schema checks once the cue fields
  land in the datasets.
- Prototype the dispatcher in the JS build, initially logging cue order
  and ducking operations to validate timing before integrating actual audio
  playback.

This taxonomy ensures mission-critical alerts retain priority while still
supporting immersive ambience, historical callouts, and responsive UI
feedback across both delivery platforms.
