# Progression Service & Unlock Evaluation

`ProgressionService` persists commander profiles and translates commander rating
summaries into campaign/challenge unlocks and achievements. The service ensures
progression logic stays deterministic by normalising stored data, replaying the
same evaluation rules, and exposing serialization helpers for CLI runs and
future save systems.【F:js/src/sim/progressionService.js†L3-L367】

## Profile Model

Profiles store commander identity, mission history, unlock flags, earned
achievements, and running streaks. `#normalizeProfile()` sanitises any supplied
payload, populating defaults when fields are missing so downstream code never
has to guard against absent dictionaries or arrays.【F:js/src/sim/progressionService.js†L79-L122】 The normalised profile becomes
mutable state inside the service and is cloned when returned via `getProfile()`
or `resetProfile()` to prevent external mutation.【F:js/src/sim/progressionService.js†L124-L131】

`loadFromFile()`/`saveToFile()` wrap JSON persistence, letting the CLI and parity
harness share commander profiles across runs. Both throw when a storage path is
missing so callers do not accidentally write to an undefined location.【F:js/src/sim/progressionService.js†L133-L152】

## Evaluation Pipeline

`evaluateRun(summary, context)` consumes the score-system summary and optional
contextual flags (mission ID, real-time/compression stats, replay metadata). It
extracts the grade, commander score, resource minima, manual involvement, event
counts, and optional autopilot deviation metrics, coalescing numeric strings into
numbers via `#coerceNumber()` to avoid implicit `NaN` propagation.【F:js/src/sim/progressionService.js†L154-L177】【F:js/src/sim/progressionService.js†L354-L366】

The method updates mission stats—incrementing completion counts, tracking best
scores/grades, and persisting event totals—and records the completion timestamp
for provenance.【F:js/src/sim/progressionService.js†L179-L257】 It also maintains a
`capcomPerfectRuns` streak whenever autopilot deviations stay under 10%, feeding
achievement logic that rewards consistent guidance accuracy.【F:js/src/sim/progressionService.js†L259-L266】

With mission context assembled, the service evaluates unlock requirements across
campaign branches and challenge modes. Definitions combine commander grade,
fault totals, manual participation, power/Δv margins, and time-compression usage
so the resulting unlock map mirrors the project plan’s scoring goals.【F:js/src/sim/progressionService.js†L19-L57】【F:js/src/sim/progressionService.js†L268-L297】 Unlocks are persisted with timestamps and summary
metadata for UI presentation.

Achievements use a similar pattern: each definition validates the current
context (full mission completion, perfect autopilot streak, exported UI frames)
and, when satisfied, appends a timestamped record without re-awarding existing
entries.【F:js/src/sim/progressionService.js†L59-L322】 The returned payload includes the
updated profile snapshot plus arrays describing new unlocks and achievements,
ready for CLI output or future save-game dialogs.【F:js/src/sim/progressionService.js†L205-L221】

## Grade Comparison Helpers

`#gradeAtLeast()` and `#gradeValue()` provide consistent ordering across the
letter-grade scale (including `+/-` variants). Unlock rules use these helpers to
compare the current grade against thresholds like `B` or `A-`, guaranteeing that
progression remains stable even when new missions introduce alternative grading
bands.【F:js/src/sim/progressionService.js†L324-L351】

## Usage

- The CLI creates a `ProgressionService` before each run, loading profiles from
the default location unless `--no-profile` is supplied. After the simulation it
calls `evaluateRun()`, saves the profile when requested, and prints any unlocks
or achievements earned during the session.【F:js/src/index.js†L15-L89】【F:js/src/index.js†L110-L153】
- The parity harness can inject a base profile (or reuse the same file) so auto
and manual replays prove they produce identical progression updates before code
changes ship.【F:js/src/tools/runParityCheck.js†L10-L199】
- Future front-ends can embed the same service for save-game menus, using the
profile snapshot to render unlock grids while keeping all evaluation logic inside
this deterministic module.

By capturing mission outcomes in a stable profile format, the progression
service bridges the score system, unlock roadmap, and persistence layers described
throughout the project plan.
