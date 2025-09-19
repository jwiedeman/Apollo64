import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { ProgressionService } from '../src/sim/progressionService.js';

function createSummary({
  grade = 'B',
  commanderScore = 85.2,
  totalFaults = 0,
  manualFraction = 0.4,
  minPowerMarginPct = 42.5,
  minDeltaVMarginMps = -3.2,
  eventsCompleted = 10,
  eventsTotal = 10,
  eventsPending = 0,
  manualSteps = 8,
  autoSteps = 12,
} = {}) {
  return {
    rating: {
      grade,
      commanderScore,
    },
    faults: {
      totalFaults,
      eventFailures: totalFaults,
      resourceFailures: 0,
      resourceFailureIds: [],
    },
    manual: {
      manualFraction,
      manualSteps,
      autoSteps,
      totalSteps: manualSteps + autoSteps,
    },
    events: {
      total: eventsTotal,
      completed: eventsCompleted,
      failed: totalFaults,
      pending: eventsPending,
      completionRatePct: eventsTotal > 0 ? (eventsCompleted / eventsTotal) * 100 : null,
    },
    resources: {
      minPowerMarginPct,
      minDeltaVMarginMps,
      thermalViolationSeconds: 0,
      thermalViolationEvents: 0,
      propellantUsedKg: {},
      powerDeltaKw: {},
    },
  };
}

describe('ProgressionService', () => {
  test('updates mission stats and unlocks campaign milestones', () => {
    const clock = () => '2024-03-21T00:00:00Z';
    const service = new ProgressionService({ clock });
    const summary = createSummary({ grade: 'B', commanderScore: 88.1, totalFaults: 2 });

    const result = service.evaluateRun(summary, { missionId: 'APOLLO11_FULL', isFullMission: true });

    assert.equal(result.mission.completions, 1);
    assert.equal(result.mission.bestGrade, 'B');
    assert.equal(result.mission.bestScore, 88.1);
    assert.equal(result.profile.missions.APOLLO11_FULL.completions, 1);

    const unlockIds = result.unlocks.map((entry) => entry.id);
    assert.ok(unlockIds.includes('free_flight'));
    assert.ok(!unlockIds.includes('apollo13'));

    const achievementIds = result.achievements.map((entry) => entry.id);
    assert.ok(achievementIds.includes('MISSION_PATCH_GALLERY'));
  });

  test('unlocks Apollo 8 campaign branch with grade B and ≤3 faults', () => {
    const service = new ProgressionService({ clock: () => '2024-03-22T00:00:00Z' });
    const summary = createSummary({ grade: 'B', commanderScore: 90.5, totalFaults: 3 });

    const { unlocks } = service.evaluateRun(summary, { missionId: 'APOLLO11_TUTORIAL' });
    const ids = unlocks.map((entry) => entry.id);
    assert.ok(ids.includes('apollo8'));
  });

  test('manual fraction unlocks manual ops challenge even with lower grade', () => {
    const service = new ProgressionService();
    const summary = createSummary({ grade: 'C', manualFraction: 0.6, commanderScore: 70 });
    const { unlocks } = service.evaluateRun(summary, { missionId: 'APOLLO11_SEGMENT' });
    assert.ok(unlocks.some((entry) => entry.id === 'free_flight'));
    assert.ok(!unlocks.some((entry) => entry.id === 'manual_ops'));

    const summary2 = createSummary({ grade: 'B', manualFraction: 0.4, commanderScore: 82 });
    const result2 = service.evaluateRun(summary2, { missionId: 'APOLLO11_SEGMENT' });
    assert.ok(result2.unlocks.some((entry) => entry.id === 'manual_ops'));
  });

  test('time compression unlock requires sustained high-rate play', () => {
    const service = new ProgressionService();
    const summary = createSummary({ grade: 'B', commanderScore: 87 });
    const result = service.evaluateRun(summary, {
      missionId: 'APOLLO11_HIGH_RATE',
      maxTimeCompression: 5,
      timeAtOrAbove4xSeconds: 3 * 3600,
    });
    assert.ok(result.unlocks.some((entry) => entry.id === 'time_compression'));
  });

  test('CapCom voice pack unlocks after three perfect autopilot runs', () => {
    const service = new ProgressionService();
    const summary = createSummary({ grade: 'A', commanderScore: 95 });

    for (let i = 0; i < 2; i += 1) {
      const result = service.evaluateRun(summary, {
        missionId: `APOLLO11_PASS_${i}`,
        autopilotDeviationMaxPct: 5,
      });
      assert.ok(!result.achievements.some((entry) => entry.id === 'CAPCOM_VOICE_PACK'));
    }

    const finalResult = service.evaluateRun(summary, {
      missionId: 'APOLLO11_PASS_3',
      autopilotDeviationMaxPct: 4.5,
    });

    assert.ok(finalResult.achievements.some((entry) => entry.id === 'CAPCOM_VOICE_PACK'));
  });

  test('telemetry overlay achievement requires export flag and grade threshold', () => {
    const service = new ProgressionService();
    const summary = createSummary({ grade: 'B', commanderScore: 80 });
    const result = service.evaluateRun(summary, {
      missionId: 'APOLLO11_EXPORT',
      exportedUiFrames: true,
    });
    assert.ok(result.achievements.some((entry) => entry.id === 'TELEMETRY_OVERLAYS'));
  });
});

