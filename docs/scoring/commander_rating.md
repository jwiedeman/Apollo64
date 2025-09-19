# Commander Rating & Progression Metrics

The commander rating system translates the simulator's telemetry into a weighted
score that reflects mission execution quality, resource stewardship, and crew
participation. It fulfils the Project Plan's Section 9 goals by producing a
single summary grade while exposing the individual metrics needed for
progression unlocks (alternate missions, fault-driven scenarios, etc.).

## Telemetry Inputs

`ScoreSystem` ingests data each simulation tick from the scheduler,
`ResourceSystem`, checklist manager, and autopilot runner. The tracker monitors:

- **Event completions:** total/completed/failed/pending counts plus a derived
  completion percentage.
- **Communications reliability:** counts of communications-focused events and
  the percentage that finished within tolerance.
- **Resource margins:** minimum/maximum power margin (%), Δv reserve (m/s),
  cumulative thermal violation time (seconds above the cryo boil-off threshold),
  and propellant/power deltas pulled from `ResourceSystem.metrics`.
- **Fault accumulation:** total scheduler failures plus unique resource failure IDs
  (with taxonomy metadata) registered during the run.
- **Manual involvement:** acknowledged checklist steps attributed to manual
  actors vs. the auto crew or scripted manual queues.

## Rating Formula

The score is divided into a base component and an explicit manual bonus:

- **Base score (max 90 points):**
  - Events (40%) – completion rate across the active mission slice.
  - Resources (30%) – weighted mix of minimum power margin (50%), minimum Δv
    margin (30%), and thermal stability (20%).
  - Faults (20%) – penalty relative to a baseline of six aggregate failures
    (event + resource).
- **Manual bonus (max 10 points):** proportion of manual checklist steps vs.
  total acknowledgements. Fully automated runs earn zero bonus while
  all-manual runs receive the full 10 points.

Scores are clamped to 0–100 and mapped to grades (`A ≥ 90`, `B ≥ 80`, `C ≥ 70`,
`D ≥ 60`, `F < 60`). Manual bonus and grade are emitted separately so parity
comparisons can focus on the base score while still reporting manual deltas.

## Output Structure

`Simulation.run()` includes the score summary and the CLI prints a condensed
view. The full payload (also logged in parity reports) resembles:

```json
{
  "missionDurationSeconds": 54000.0,
  "events": {"total": 128, "completed": 110, "failed": 3, "pending": 15, "completionRatePct": 85.9},
  "comms": {"total": 14, "completed": 13, "failed": 1, "hitRatePct": 92.9},
  "resources": {
    "minPowerMarginPct": 38.4,
    "minDeltaVMarginMps": -8.5,
    "thermalViolationSeconds": 180.0,
    "propellantUsedKg": {"csm_sps": 152.4, "csm_rcs": 12.1}
  },
  "faults": {"eventFailures": 3, "resourceFailures": 1, "resourceFailureIds": ["FAIL_TLI_UNDERBURN"], "totalFaults": 4},
  "manual": {"manualSteps": 24, "autoSteps": 86, "totalSteps": 110, "manualFraction": 0.218},
  "rating": {
    "baseScore": 83.6,
    "manualBonus": 2.2,
    "commanderScore": 85.8,
    "grade": "B",
    "breakdown": {
      "events": {"score": 0.86, "weight": 0.4},
      "resources": {"score": 0.78, "weight": 0.3},
      "faults": {"score": 0.33, "weight": 0.2},
      "manual": {"score": 0.218, "weight": 0.1}
    }
  }
}
```

Parity comparisons ignore manual-only fields (`manual`, manual bonus, grade) so
auto vs. scripted-manual replays can differ in crew involvement without
producing false failures.

## Integration Notes

- CLI runs (`npm start`) display the condensed score after HUD statistics, and
  parity reports now embed the base score to support regression gating.
- Unlock logic (future work) can read the commander score and component metrics
  to gate alternate missions (Apollo 8 flyby, Apollo 13 emergency) while also
  rewarding high manual participation.
- Progression thresholds and persistence expectations are detailed in
  [`progression_unlocks.md`](progression_unlocks.md), ensuring score outputs map
  cleanly onto campaign gates, challenge variants, and cosmetic rewards across
  both platforms.
- Future scoring extensions can add mission-specific modifiers (e.g., landing
  fuel reserves, docking attempt count) by extending `ScoreSystem.summary()`
  without altering the top-level rating contract.

This scoring layer keeps telemetry calculations deterministic while providing a
player-facing grade that reflects the project pillars: disciplined timeline
execution, systemic consequences, and meaningful manual input.
