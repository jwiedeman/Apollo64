import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { UiFrameBuilder } from '../src/hud/uiFrameBuilder.js';

describe('UiFrameBuilder', () => {
  test('summarizes scheduler, resources, autopilot, and checklist state', () => {
    const builder = new UiFrameBuilder({
      includeResourceHistory: true,
      upcomingLimit: 1,
      activeChecklistLimit: 1,
    });

    const resourceSnapshot = {
      propellant: {
        csm_sps_kg: 90,
        csm_rcs_kg: 35,
        lm_descent_kg: 12,
        lm_ascent_kg: 4,
      },
      budgets: {
        propellant: {
          csm_sps: { initial_kg: 120, reserve_kg: 18 },
          csm_rcs: { initial_kg: 45, reserve_kg: 8 },
          lm_descent: { initial_kg: 50, reserve_kg: 10 },
          lm_ascent: { initial_kg: 40, reserve_kg: 5 },
        },
      },
      delta_v_margin_mps: 3950,
      delta_v: {
        total: {
          margin_mps: 3950,
          base_mps: 4000,
          adjustment_mps: -50,
          usable_delta_v_mps: 4000,
        },
        stages: {
          csm_sps: {
            margin_mps: 1950,
            base_mps: 2000,
            adjustment_mps: -50,
            usable_delta_v_mps: 2000,
            label: 'CSM SPS',
            tank: 'csm_sps_kg',
          },
          lm_descent: {
            margin_mps: 800,
            base_mps: 800,
            adjustment_mps: 0,
            usable_delta_v_mps: 800,
            tank: 'lm_descent_kg',
          },
          lm_ascent: {
            margin_mps: 1200,
            base_mps: 1200,
            adjustment_mps: 0,
            usable_delta_v_mps: 1200,
            label: 'LM APS',
            tank: 'lm_ascent_kg',
          },
        },
      },
      power_margin_pct: 18,
      cryo_boiloff_rate_pct_per_hr: 3.1,
      power: {
        fuel_cell_load_kw: 3.2,
        fuel_cell_output_kw: 3.6,
      },
      thermal_balance_state: 'PTC_STABLE',
      metrics: {
        deltaV: { usedMps: 12.5, recoveredMps: 1.5 },
      },
      failures: [
        {
          id: 'FAIL_COMM_PASS_MISSED',
          classification: 'Recoverable',
          trigger: 'DSN window skipped',
        },
      ],
    };

    const resourceHistory = {
      meta: {
        enabled: true,
        sampleIntervalSeconds: 60,
        durationSeconds: 3600,
        maxSamples: 4,
        lastSampleSeconds: 90,
      },
      power: [{ seconds: 90, margin_pct: 18 }],
      thermal: [],
      communications: [],
      propellant: {
        csm_sps: [{ seconds: 90, remainingKg: 90 }],
      },
    };

    const scoreSummary = {
      missionDurationSeconds: 90,
      events: {
        total: 4,
        completed: 3,
        failed: 1,
        pending: 0,
        completionRatePct: 75,
      },
      comms: {
        total: 2,
        completed: 1,
        failed: 1,
        hitRatePct: 50,
      },
      resources: {
        minPowerMarginPct: 12,
        maxPowerMarginPct: 55,
        minDeltaVMarginMps: -20,
        maxDeltaVMarginMps: 4,
        thermalViolationSeconds: 120,
        thermalViolationEvents: 1,
        propellantUsedKg: { csm_sps: 8.5 },
        powerDeltaKw: { fuel_cells: -0.4 },
      },
      faults: {
        eventFailures: 1,
        resourceFailures: 2,
        totalFaults: 3,
        resourceFailureIds: ['FAIL_COMM_PASS_MISSED', 'FAIL_POWER_LOW'],
      },
      manual: {
        manualSteps: 4,
        autoSteps: 6,
        totalSteps: 10,
        manualFraction: 0.4,
      },
      rating: {
        baseScore: 72.5,
        manualBonus: 4.0,
        commanderScore: 76.5,
        grade: 'C',
        breakdown: {
          events: { score: 0.8, weight: 0.4 },
          resources: { score: 0.65, weight: 0.3 },
          faults: { score: 0.5, weight: 0.2 },
          manual: { score: 0.4, weight: 0.1 },
        },
      },
    };

    const frame = builder.build(90, {
      scheduler: {
        stats: () => ({
          counts: { active: 2 },
          upcoming: [
            { id: 'EVT1', phase: 'TLI', status: 'scheduled', opensAtSeconds: 120 },
            { id: 'EVT2', phase: 'PTC', status: 'queued', opensAtSeconds: 180 },
          ],
        }),
      },
      resourceSystem: {
        snapshot: () => resourceSnapshot,
        historySnapshot: () => resourceHistory,
      },
      autopilotRunner: {
        stats: () => ({
          active: 1,
          started: 2,
          completed: 1,
          aborted: 0,
          totalBurnSeconds: 15,
          totalUllageSeconds: 4,
          totalRcsImpulseNs: 120,
          totalRcsPulses: 6,
          totalDskyEntries: 2,
          propellantKgByTank: { csm_sps_kg: 42 },
          activeAutopilots: [
            {
              eventId: 'EVT1',
              autopilotId: 'PGM_TLI',
              propulsion: 'csm_sps',
              elapsedSeconds: 10,
              remainingSeconds: 20,
              currentThrottle: 0.75,
              nextCommandInSeconds: 5,
              throttleTarget: 1,
              throttleRamp: null,
              rcsPulses: 2,
              rcsImpulseNs: 50,
              rcsKg: 1.2,
              dskyEntries: 1,
            },
          ],
          primary: {
            eventId: 'EVT1',
            autopilotId: 'PGM_TLI',
            remainingSeconds: 20,
            currentThrottle: 0.75,
          },
        }),
      },
      checklistManager: {
        stats: () => ({
          totals: {
            active: 2,
            completed: 1,
            aborted: 0,
            acknowledgedSteps: 6,
            autoSteps: 3,
            manualSteps: 3,
          },
          active: [
            {
              eventId: 'EVT1',
              checklistId: 'CHK1',
              title: 'TLI Prep',
              crewRole: 'CDR',
              completedSteps: 3,
              totalSteps: 5,
              nextStepNumber: 4,
              nextStepAction: 'SCS to AUTO',
              autoAdvancePending: false,
            },
            {
              eventId: 'EVT2',
              checklistId: 'CHK2',
              title: 'PTC Entry',
              crewRole: 'CMP',
              completedSteps: 1,
              totalSteps: 4,
              nextStepNumber: 2,
              nextStepAction: 'Enable PTC',
              autoAdvancePending: true,
            },
          ],
        }),
      },
      manualQueue: {
        stats: () => ({
          scheduled: 3,
          pending: 1,
          executed: 5,
          failed: 0,
          retried: 1,
          acknowledgedSteps: 4,
          resourceDeltas: 2,
          propellantBurns: 1,
          dskyEntries: 0,
        }),
      },
      scoreSystem: {
        summary: () => scoreSummary,
      },
    });

    assert.equal(frame.time.getSeconds, 90);
    assert.equal(frame.events.upcoming.length, 1);
    assert.equal(frame.events.next.id, 'EVT1');
    assert.equal(frame.events.next.tMinusLabel, 'T-000:00:30');

    const deltaVSummary = frame.resources.deltaV;
    assert.equal(deltaVSummary.totalMps, 3950);
    assert.equal(deltaVSummary.totalBaseMps, 4000);
    assert.equal(deltaVSummary.totalAdjustmentMps, -50);
    assert.equal(deltaVSummary.csmSpsMps, 1950);
    assert.equal(deltaVSummary.usedMps, 12.5);
    assert.equal(deltaVSummary.recoveredMps, 1.5);
    assert.equal(deltaVSummary.primaryStageId, 'csm_sps');
    assert.equal(deltaVSummary.stages.csm_sps.marginMps, 1950);
    assert.equal(deltaVSummary.stages.lm_descent.label, 'LM Descent');

    const propellant = frame.resources.propellant.tanks;
    assert.equal(propellant.csm_sps.percentRemaining, 75);
    assert.equal(propellant.lm_descent.status, 'caution');
    assert.equal(propellant.lm_ascent.status, 'warning');

    const warningIds = frame.alerts.warnings.map((alert) => alert.id).sort();
    assert.deepEqual(warningIds, ['cryo_boiloff_high', 'power_margin_low', 'propellant_lm_ascent']);

    const cautionIds = frame.alerts.cautions.map((alert) => alert.id);
    assert.deepEqual(cautionIds, ['propellant_lm_descent']);

    assert.equal(frame.autopilot.primary.autopilotId, 'PGM_TLI');
    assert.equal(frame.autopilot.activeAutopilots.length, 1);

    assert.equal(frame.checklists.active.length, 1);
    assert.equal(frame.checklists.chip.eventId, 'EVT1');

    assert.ok(frame.resourceHistory);
    assert.equal(frame.resourceHistory.meta.enabled, true);
    assert.equal(frame.resourceHistory.power.length, 1);

    assert.ok(frame.score);
    assert.equal(frame.score.rating.commanderScore, 76.5);
    assert.equal(frame.score.rating.grade, 'C');
    assert.equal(frame.score.events.completed, 3);
    assert.deepEqual(frame.score.resources.propellantUsedKg, { csm_sps: 8.5 });
    assert.deepEqual(frame.score.faults.resourceFailureIds, [
      'FAIL_COMM_PASS_MISSED',
      'FAIL_POWER_LOW',
    ]);
  });
});
