import test from 'node:test';
import assert from 'node:assert/strict';
import { runParityCheck } from '../src/tools/runParityCheck.js';
import { parseGET } from '../src/utils/time.js';

const ONE_HOUR_GET = parseGET('001:00:00');

test('runParityCheck produces parity between auto and manual runs', async () => {
  const { report, parity } = await runParityCheck({
    untilSeconds: ONE_HOUR_GET,
    quiet: true,
  });

  assert.ok(parity.passed, 'parity result should pass without diffs');
  assert.equal(report.auto.ticks, report.manual.ticks, 'tick counts should match');
  assert.equal(report.auto.finalGet, report.manual.finalGet, 'final GET should match');
  assert.ok(
    report.recorder.actionsGenerated > 0,
    'auto run should record at least one checklist action',
  );
  assert.equal(report.parity.logDiffs.length, 0, 'no log diffs should be reported');
  assert.ok(report.manual.manualActions, 'manual run should expose manual action stats');
  assert.equal(parity.progression, null, 'progression parity should be disabled by default');
});

test('runParityCheck maintains progression parity when a profile is provided', async () => {
  const baseProfile = {
    commanderId: 'TESTER',
    missions: {
      APOLLO11_PARITY: { completions: 2, bestGrade: 'B', bestScore: 88.5 },
    },
    unlocks: {
      apollo8: { unlocked: true, unlockedAt: '2024-03-20T00:00:00Z' },
    },
    achievements: [{ id: 'MISSION_PATCH_GALLERY', timestamp: '2024-03-19T00:00:00Z' }],
    streaks: { capcomPerfectRuns: 1 },
  };

  const { report, parity } = await runParityCheck({
    untilSeconds: ONE_HOUR_GET,
    quiet: true,
    useProfile: true,
    progressionProfile: baseProfile,
    missionId: 'APOLLO11_PARITY',
    isFullMission: true,
  });

  assert.ok(parity.passed, 'parity should still pass when progression is checked');
  assert.ok(parity.progression, 'progression parity results should be present');
  assert.equal(parity.progression.profileDiffs.length, 0);
  assert.equal(parity.progression.unlockDiffs.length, 0);
  assert.equal(parity.progression.achievementDiffs.length, 0);
  assert.ok(report.progression?.enabled, 'report should record that progression parity ran');
  assert.equal(report.progression.missionId, 'APOLLO11_PARITY');
});
