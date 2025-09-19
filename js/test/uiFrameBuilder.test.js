import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { UiFrameBuilder } from '../src/hud/uiFrameBuilder.js';
import { EARTH_BODY } from '../src/config/orbit.js';

describe('UiFrameBuilder', () => {
  test('summarizes scheduler, resources, autopilot, and checklist state', () => {
    const padMap = new Map([
      [
        'PAD_EVT1',
        {
          id: 'PAD_EVT1',
          purpose: 'Translunar Injection Burn',
          deliveryGet: '000:05:00',
          deliveryGetSeconds: 300,
          validUntilGet: '000:10:00',
          validUntilSeconds: 600,
          parameters: {
            tig: { get: '000:07:30', getSeconds: 450 },
            deltaVFtPerSec: 10030,
            deltaVMetersPerSecond: 3058.944,
            burnDurationSeconds: 347,
            attitude: 'R000/P000/Y000',
            rangeToTargetNm: 2150,
            notes: 'Test pad values',
            raw: { TIG: '000:07:30' },
          },
        },
      ],
    ]);

    const eventList = [
      { id: 'EVT1', padId: 'PAD_EVT1' },
      { id: 'EVT_CHECK', padId: 'PAD_EVT1' },
      { id: 'EVT_AUTOP', padId: 'PAD_EVT1' },
    ];

    const builder = new UiFrameBuilder({
      includeResourceHistory: true,
      upcomingLimit: 1,
      activeChecklistLimit: 1,
      pads: padMap,
      events: eventList,
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
          breadcrumb: {
            summary: 'Missed DSN pass → next window 45m',
            chain: [
              { id: 'station', label: 'Station', value: 'Honeysuckle' },
              { id: 'power_delta', label: 'Power margin impact', value: '-0.10 kW' },
            ],
          },
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

    const orbitSummary = {
      body: { id: 'earth', name: 'Earth' },
      position: { radius: 6_778_000, altitude: 400_000 },
      velocity: { speed: 7_670 },
      elements: {
        eccentricity: 0.0012,
        inclinationDeg: 31.5,
        raanDeg: 45.1,
        argumentOfPeriapsisDeg: 12.3,
        trueAnomalyDeg: 90.4,
        periapsisAltitude: 200_000,
        apoapsisAltitude: 210_000,
        semiMajorAxis: 6_978_000,
        periodSeconds: 5_500,
      },
      metrics: {
        totalDeltaVMps: 10.5,
        lastImpulse: { magnitude: 5.2, frame: 'prograde', appliedAtSeconds: 600 },
      },
      timeSeconds: 600,
      epochSeconds: 600,
    };

    const orbitHistory = {
      meta: { enabled: true, sampleIntervalSeconds: 60, maxSamples: 4, lastSampleSeconds: 120 },
      samples: [
        { seconds: 0, altitude: 400_000, altitudeKm: 400, radius: 6_778_000, speed: 7_670, speedKmPerSec: 7.67 },
        { seconds: 120, altitude: 400_500, altitudeKm: 400.5, radius: 6_778_500, speed: 7_660, speedKmPerSec: 7.66 },
      ],
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
        getEventById: (id) => eventList.find((event) => event.id === id) ?? null,
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
              eventId: 'EVT_AUTOP',
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
            eventId: 'EVT_AUTOP',
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
      orbit: {
        summary: () => orbitSummary,
        historySnapshot: () => orbitHistory,
      },
      scoreSystem: {
        summary: () => scoreSummary,
      },
    });

    assert.equal(frame.time.getSeconds, 90);
    assert.equal(frame.events.upcoming.length, 1);
    assert.equal(frame.events.next.id, 'EVT1');
    assert.equal(frame.events.next.tMinusLabel, 'T-000:00:30');
    assert.equal(frame.events.next.pad.id, 'PAD_EVT1');
    assert.equal(frame.events.next.pad.parameters.tig.get, '000:07:30');

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

    const resourceFailures = frame.resources.alerts.failures;
    assert.equal(resourceFailures.length, 1);
    const [resourceFailure] = resourceFailures;
    assert.equal(resourceFailure.id, 'FAIL_COMM_PASS_MISSED');
    assert.ok(resourceFailure.breadcrumb);
    assert.equal(resourceFailure.breadcrumb.summary, 'Missed DSN pass → next window 45m');
    assert.deepEqual(resourceFailure.breadcrumb.chain[0], { id: 'station', label: 'Station', value: 'Honeysuckle' });

    assert.equal(frame.autopilot.primary.autopilotId, 'PGM_TLI');
    assert.equal(frame.autopilot.activeAutopilots.length, 1);
    assert.equal(frame.autopilot.primary.pad.id, 'PAD_EVT1');
    assert.equal(frame.autopilot.activeAutopilots[0].pad.id, 'PAD_EVT1');

    assert.equal(frame.checklists.active.length, 1);
    assert.equal(frame.checklists.chip.eventId, 'EVT1');
    assert.equal(frame.checklists.active[0].pad.id, 'PAD_EVT1');
    assert.equal(frame.checklists.chip.pad.id, 'PAD_EVT1');

    assert.ok(frame.resourceHistory);
    assert.equal(frame.resourceHistory.meta.enabled, true);
    assert.equal(frame.resourceHistory.power.length, 1);
    assert.ok(frame.trajectory);
    assert.equal(frame.trajectory.body.id, 'earth');
    assert.equal(frame.trajectory.altitude.kilometers, 400);
    assert.equal(frame.trajectory.elements.periapsisKm, 200);
    assert.equal(frame.trajectory.elements.periodMinutes, 91.67);
    assert.equal(frame.trajectory.metrics.totalDeltaVMps, 10.5);
    assert.equal(frame.trajectory.metrics.lastImpulse.magnitude, 5.2);
    assert.strictEqual(frame.trajectory.history, orbitHistory);

    assert.ok(frame.score);
    assert.equal(frame.score.rating.commanderScore, 76.5);
    assert.equal(frame.score.rating.grade, 'C');
    assert.equal(frame.score.events.completed, 3);
    assert.deepEqual(frame.score.resources.propellantUsedKg, { csm_sps: 8.5 });
    assert.deepEqual(frame.score.faults.resourceFailureIds, [
      'FAIL_COMM_PASS_MISSED',
      'FAIL_POWER_LOW',
    ]);
    assert.equal(frame.missionLog, null);
  });

  test('flags low periapsis without duplicating alerts', () => {
    function buildFrame(periapsisAltitudeMeters) {
      const builder = new UiFrameBuilder();
      const orbitSummary = {
        body: { id: 'earth', name: 'Earth' },
        position: {
          radius: EARTH_BODY.radius + periapsisAltitudeMeters,
          altitude: periapsisAltitudeMeters,
        },
        velocity: { speed: 7_670 },
        elements: {
          eccentricity: 0.001,
          inclinationDeg: 30,
          raanDeg: 45,
          argumentOfPeriapsisDeg: 12,
          trueAnomalyDeg: 90,
          periapsisAltitude: periapsisAltitudeMeters,
          apoapsisAltitude: periapsisAltitudeMeters + 50_000,
          semiMajorAxis: EARTH_BODY.radius + periapsisAltitudeMeters + 25_000,
          periodSeconds: 5_400,
        },
        metrics: {},
      };

      return builder.build(0, {
        scheduler: { stats: () => ({ counts: {}, upcoming: [] }) },
        resourceSystem: { snapshot: () => ({ propellant: {}, budgets: {} }) },
        orbitSummary,
      });
    }

    const warningFrame = buildFrame(40_000);
    assert.equal(warningFrame.alerts.failures.length, 0);
    assert.equal(warningFrame.alerts.cautions.length, 0);
    assert.equal(warningFrame.alerts.warnings.length, 1);
    assert.equal(warningFrame.alerts.warnings[0].id, 'orbit_periapsis_low');

    const cautionFrame = buildFrame(100_000);
    assert.equal(cautionFrame.alerts.failures.length, 0);
    assert.equal(cautionFrame.alerts.warnings.length, 0);
    assert.equal(cautionFrame.alerts.cautions.length, 1);
    assert.equal(cautionFrame.alerts.cautions[0].id, 'orbit_periapsis_low');

    const failureFrame = buildFrame(-1_000);
    assert.equal(failureFrame.alerts.warnings.length, 0);
    assert.equal(failureFrame.alerts.cautions.length, 0);
    assert.equal(failureFrame.alerts.failures.length, 1);
    assert.equal(failureFrame.alerts.failures[0].id, 'orbit_periapsis_below_surface');
  });

  test('includes mission log summary when aggregator provided', () => {
    const builder = new UiFrameBuilder();
    const missionLogSource = {
      snapshot: ({ limit }) => ({
        entries: [
          {
            id: 'log-000001',
            sequence: 1,
            timestampSeconds: 120,
            timestampGet: '000:02:00',
            category: 'event',
            source: 'sim',
            severity: 'info',
            message: 'Event EVT_TEST complete',
            context: { eventId: 'EVT_TEST' },
          },
        ],
        totalCount: 5,
        filteredCount: limit ?? 1,
        filteredCategories: { event: 1 },
        filteredSeverities: { info: 1 },
        lastTimestampSeconds: 120,
        lastTimestampGet: '000:02:00',
      }),
    };

    const frame = builder.build(200, {
      missionLog: missionLogSource,
      scheduler: { stats: () => ({ counts: {}, upcoming: [] }) },
      resourceSystem: { snapshot: () => ({}) },
    });

    assert.ok(frame.missionLog);
    assert.equal(frame.missionLog.totalCount, 5);
    assert.equal(frame.missionLog.entries.length, 1);
    assert.equal(frame.missionLog.entries[0].id, 'log-000001');
    assert.equal(frame.missionLog.entries[0].category, 'event');
    assert.deepEqual(frame.missionLog.categories, { event: 1 });
    assert.equal(frame.missionLog.lastTimestampGet, '000:02:00');
  });
});
