# Progression & Unlock Roadmap

This document extends the telemetry and scoring model described in
[`commander_rating.md`](commander_rating.md) by mapping the simulator's
mission summaries into persistent progression. It follows Section 9 of the
[project plan](../PROJECT_PLAN.md) and establishes the unlock rules that gate
alternate missions, challenge variants, and cosmetic rewards across the JS
prototype and the future N64 build.

## Goals
- Reward disciplined timeline execution, healthy resource margins, and manual
  participation without requiring flawless runs.
- Provide deterministic unlock rules so parity harnesses can validate
  progression states alongside score reports.
- Keep persistence lightweight and cross-platform friendly (JSON profile for
  the JS build, EEPROM/Controller Pak slots for N64) while remaining auditable
  for milestone reviews.
- Surface clear next-step guidance inside the HUD/exported reports so players
  know which objectives remain for new content.

## Telemetry Inputs
Progression consumes the same summary payload emitted by
`ScoreSystem.summary()` and logged in parity/export tools. Key fields include:

- `rating.baseScore`, `rating.commanderScore`, `rating.grade` – primary gate for
  campaign advancement.
- `events.completed`, `events.failed`, `events.pending` – ensure critical beats
  are satisfied before unlocking follow-on phases.
- `resources.minPowerMarginPct`, `resources.minDeltaVMarginMps`,
  `resources.thermalViolationSeconds` – identify runs that stay within defined
  margins.
- `faults.totalFaults`, `faults.resourceFailureIds` – track cascading penalties
  that should block certain unlocks until resolved.
- `manual.manualFraction` – distinguishes automation-only completions from
  manual contributions when unlocking challenge variants.

The parity harness (`npm run parity`) already records the summary block, making
it straightforward to diff unlock state across auto/manual regression runs.

## Unlock Tracks
Progression is divided into three complementary tracks so players always have a
clear goal, whether chasing higher commander ratings or exploring alternate
mission content.

### 1. Mission Campaign
| Unlock | Requirement | Notes |
| --- | --- | --- |
| **Apollo 11 – Full Mission** | Complete the tutorial slice (launch → MCC-1) with grade ≥ `C`. | Baseline experience; ships unlocked by default in developer builds. |
| **Apollo 8 Free Return** | Finish Apollo 11 launch → TEI with grade ≥ `B` and ≤ 3 total faults. | Validates translunar/return guidance before unlocking Apollo 8 data packs. |
| **Apollo 13 Contingency** | Finish Apollo 11 full mission with grade ≥ `A−`, complete all critical events (no pending), and trigger ≤ 1 recoverable fault. | Ensures crews can manage extended failure cascades. |
| **Free Flight Sandbox** | Complete any mission with grade ≥ `B` OR acknowledge ≥ 50% of checklist steps manually. | Opens configurable timeline slices for experimentation. |

### 2. Challenge Variants
| Variant | Requirement | Notes |
| --- | --- | --- |
| **Manual Ops Spotlight** | Achieve manual fraction ≥ 0.35 and grade ≥ `B` on any run. | Emphasizes hand-flown procedures; surfaces manual action recorder exports for tutorials. |
| **Tight Margins Mode** | Keep `minPowerMarginPct ≥ 30` and `minDeltaVMarginMps ≥ -5` while completing with ≤ 2 faults. | Unlocks a scoring modifier that penalizes aggressive consumable use. |
| **Time Compression License** | Execute a mission with `grade ≥ B` while running at ≥ 4× time compression for ≥ 2 continuous hours. | Enables high-rate controller mode from the project plan. |

### 3. Cosmetic & Historical Archives
| Unlock | Requirement | Notes |
| --- | --- | --- |
| **Mission Patch Gallery** | Finish first full-mission run regardless of grade. | Exposes artwork/audio gallery entries. |
| **CapCom Voice Pack** | Replay any burn with tolerance errors ≤ 10% for three consecutive missions. | Grants optional callout variants. |
| **Telemetry Overlays** | Export UI frames (`npm run export:ui-frames`) after a grade ≥ `B` run. | Adds developer overlays (heat maps, mission logs) to Tile Mode presets. |

## Persistence Model
- **Profile schema:**
  ```json
  {
    "commanderId": "ASTRONAUT_01",
    "lastUpdated": "2024-03-20T22:15:00Z",
    "missions": {
      "APOLLO11": {"bestGrade": "A", "bestScore": 94.2, "completions": 3},
      "APOLLO11_TUTORIAL": {"bestGrade": "B", "completions": 5},
      "APOLLO8": {"unlocked": false}
    },
    "unlocks": {
      "apollo8": {"unlocked": true, "viaRun": "2024-03-17T20:11:00Z"},
      "apollo13": {"unlocked": false},
      "manual_ops": {"unlocked": true, "manualFraction": 0.41}
    },
    "achievements": [
      {"id": "MISSION_PATCH_GALLERY", "timestamp": "2024-03-15T18:00:00Z"}
    ]
  }
  ```
- **JS prototype:** Persist profile JSON under `~/.apollo64/profile.json` (configurable
  via environment variable). Expose CLI flags (`--profile`, `--reset-profile`) to
  load/reset progression during regression runs.
- **N64 build:** Mirror the schema using EEPROM (primary) with Controller Pak
  export/import for backups. Store unlock bitfields + checksum for quick boot
  validation. Include developer override flag for milestone demos.

## Unlock Evaluation Flow
1. Simulation completes and `ScoreSystem.summary()` emits mission metrics.
2. `ProgressionService.evaluateRun(summary, context)` determines satisfied
   objectives (campaign thresholds, challenge stats, archive triggers).
3. Updates to the profile are queued and written atomically (JSON write on JS,
   EEPROM transaction on N64). Logs capture `summary.get` ranges and unlock IDs
   for auditing.
4. HUD and CLI export highlight newly unlocked content with tooltips and mission
   log entries (e.g., `Unlocked Apollo 8 Free Return — grade B, faults: 2`).

Deterministic evaluation ensures parity reports can re-run the same summary and
produce identical unlock results, supporting CI validation once automated tests
incorporate progression checks.

## Regression & QA Hooks
- Extend `npm run parity` to optionally load a profile and assert that unlock
  states remain unchanged between auto/manual runs unless explicit criteria are
  met.
- Add snapshot-based tests around `ProgressionService` once implemented, feeding
  captured `summary` fixtures to verify unlock thresholds.
- Include profile diffs when recording regression artifacts so reviewers can
  validate unlock changes alongside mission logs and UI frame exports.

## Roadmap Alignment
- **Milestone M1/M2:** Leverage existing summaries to validate unlock logic
  without UI dependencies; CLI output can display unlock hints.
- **Milestone M3:** Surface unlock progress inside the Systems view scorecard and
  Tile Mode overlays, wiring achievements into the HUD’s Always-On band.
- **Milestone M4:** Map profile persistence onto N64 storage, budgeting EEPROM
  writes and Controller Pak save slots per the port plan.
- **Milestone M5+:** Add alternate mission datasets and challenge modifiers once
  campaign unlocks are validated. Progression gating ensures players approach new
  content with the necessary systems mastery.

This roadmap keeps progression deterministic, audit-ready, and aligned with the
simulation-first ethos of Apollo64 while laying the groundwork for future
mission unlocks and cosmetic rewards.
