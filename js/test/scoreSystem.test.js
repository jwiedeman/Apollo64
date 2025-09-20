import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { ScoreSystem } from '../src/sim/scoreSystem.js';

describe('ScoreSystem', () => {
  test('summary aggregates mission metrics into commander rating output', () => {
    const resourceState = {
      power_margin_pct: 48,
      delta_v_margin_mps: 180,
      cryo_boiloff_rate_pct_per_hr: 2.4,
    };

    const metrics = {
      propellantDeltaKg: {
        csm_sps_kg: -40.1234,
        lm_rcs_kg: 0.00000001,
      },
      powerDeltaKw: {
        fuel_cell_load: -0.34567,
      },
      deltaV: {
        usedMps: 12,
        recoveredMps: 3,
      },
    };

    const resourceSystem = {
      state: resourceState,
      snapshot: () => ({
        metrics: {
          propellantDeltaKg: { ...metrics.propellantDeltaKg },
          powerDeltaKw: { ...metrics.powerDeltaKw },
          deltaV: { ...metrics.deltaV },
        },
        failures: [
          { id: 'FAIL_POWER' },
          { id: 'FAIL_POWER' },
          { id: 'FAIL_COMM' },
        ],
      }),
    };

    const scheduler = {
      events: [
        { id: 'EVT_COMMS_SUCCESS', status: 'complete', system: 'comms' },
        { id: 'EVT_COMMS_FAIL', status: 'failed', system: 'communications' },
        { id: 'EVT_PROPULSION', status: 'active', system: 'propulsion' },
        { id: 'EVT_POWER', status: 'pending', system: 'power' },
      ],
    };

    const autopilotStats = { active: 0, metrics: { totalBurnSeconds: 12 } };
    const autopilotRunner = { stats: () => autopilotStats };

    const checklistManager = {
      stats: () => ({
        totals: {
          manualSteps: 5,
          autoSteps: 15,
          acknowledgedSteps: 20,
        },
      }),
    };

    const scoreSystem = new ScoreSystem({
      resourceSystem,
      scheduler,
      autopilotRunner,
      checklistManager,
    });

    scoreSystem.update(1000, 60);

    const summary1 = scoreSystem.summary();
    assert.ok(summary1);
    assert.ok(Array.isArray(summary1.history));
    assert.equal(summary1.history.length, 1);
    assert.equal(summary1.history[0].delta, null);

    scheduler.events[2].status = 'complete';
    scheduler.events[3].status = 'failed';
    resourceState.power_margin_pct = 32;
    resourceState.delta_v_margin_mps = -25;
    resourceState.cryo_boiloff_rate_pct_per_hr = 1.5;

    scoreSystem.update(1060, 60);

    const summary = scoreSystem.summary();

    assert.equal(summary.events.total, 4);
    assert.equal(summary.events.completed, 2);
    assert.equal(summary.events.failed, 2);
    assert.equal(summary.events.pending, 0);
    assert.equal(summary.events.completionRatePct, 50);

    assert.equal(summary.comms.total, 2);
    assert.equal(summary.comms.completed, 1);
    assert.equal(summary.comms.failed, 1);
    assert.equal(summary.comms.hitRatePct, 50);

    assert.equal(summary.resources.minPowerMarginPct, 32);
    assert.equal(summary.resources.maxPowerMarginPct, 48);
    assert.equal(summary.resources.minDeltaVMarginMps, -25);
    assert.equal(summary.resources.maxDeltaVMarginMps, 180);
    assert.equal(summary.resources.thermalViolationSeconds, 60);
    assert.equal(summary.resources.thermalViolationEvents, 1);
    assert.deepEqual(summary.resources.propellantUsedKg, { csm_sps: 40.123 });
    assert.deepEqual(summary.resources.powerDeltaKw, { fuel_cell_load: -0.346 });

    assert.equal(summary.faults.eventFailures, 2);
    assert.equal(summary.faults.resourceFailures, 2);
    assert.equal(summary.faults.totalFaults, 4);
    assert.deepEqual(new Set(summary.faults.resourceFailureIds), new Set(['FAIL_POWER', 'FAIL_COMM']));

    assert.equal(summary.manual.manualSteps, 5);
    assert.equal(summary.manual.autoSteps, 15);
    assert.equal(summary.manual.totalSteps, 20);
    assert.equal(summary.manual.manualFraction, 0.25);

    assert.equal(summary.rating.baseScore, 43.2);
    assert.equal(summary.rating.manualBonus, 2.5);
    assert.equal(summary.rating.commanderScore, 45.7);
    assert.equal(summary.rating.grade, 'F');
    const breakdown = summary.rating.breakdown;
    assert.ok(Math.abs(breakdown.events.weight - 0.4) < 1e-9);
    assert.ok(Math.abs(breakdown.resources.weight - 0.3) < 1e-9);
    assert.ok(Math.abs(breakdown.faults.weight - 0.2) < 1e-9);
    assert.ok(Math.abs(breakdown.manual.weight - 0.1) < 1e-9);

    assert.deepEqual(summary.autopilot, autopilotStats);

    assert.ok(Array.isArray(summary.history));
    assert.equal(summary.history.length, 2);
    const latestHistory = summary.history[summary.history.length - 1];
    assert.equal(latestHistory.commanderScore, summary.rating.commanderScore);
    assert.equal(latestHistory.baseScore, summary.rating.baseScore);
    assert.equal(latestHistory.manualBonus, summary.rating.manualBonus);
    assert.equal(latestHistory.grade, summary.rating.grade);

    assert.ok(latestHistory.delta);
    const commanderDelta = Math.round(
      (summary.rating.commanderScore - summary1.rating.commanderScore) * 10,
    ) / 10;
    const baseDelta = Math.round(
      (summary.rating.baseScore - summary1.rating.baseScore) * 10,
    ) / 10;
    const manualDelta = Math.round(
      (summary.rating.manualBonus - summary1.rating.manualBonus) * 10,
    ) / 10;

    assert.equal(summary.rating.delta.commanderScore, commanderDelta);
    assert.equal(summary.rating.delta.baseScore, baseDelta);
    assert.equal(summary.rating.delta.manualBonus, manualDelta);
    assert.equal(summary.rating.delta.gradeChanged, false);
    assert.equal(latestHistory.delta.commanderScore, commanderDelta);
  });
});
