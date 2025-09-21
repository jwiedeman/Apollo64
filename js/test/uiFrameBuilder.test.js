import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { UiFrameBuilder } from '../src/hud/uiFrameBuilder.js';
import { EARTH_BODY } from '../src/config/orbit.js';
import { formatGET, parseGET } from '../src/utils/time.js';

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
      communications: {
        active: true,
        current_pass_id: 'PASS_A',
        current_station: 'Honeysuckle Creek',
        current_next_station: 'Goldstone',
        current_window_open_get: '137:20:00',
        current_window_close_get: '138:05:00',
        current_window_open_seconds: 100,
        current_window_close_seconds: 200,
        current_window_time_remaining_s: 300,
        current_pass_duration_s: 2700,
        current_pass_progress: 0.5,
        time_since_window_open_s: 1200,
        signal_strength_db: 22,
        downlink_rate_kbps: 16,
        handover_minutes: 12,
        power_margin_delta_kw: -0.1,
        power_load_delta_kw: -0.1,
        cue_on_acquire: 'telemetry.dsn_acquire',
        cue_on_loss: 'telemetry.dsn_loss',
        cue_channel_on_acquire: 'telemetry',
        cue_channel_on_loss: 'telemetry',
        next_pass_id: 'PASS_B',
        next_station: 'Goldstone',
        next_window_open_get: '142:30:00',
        next_window_open_seconds: 500,
        time_until_next_window_s: 400,
        schedule_count: 3,
        next_pass_cue_on_acquire: 'telemetry.dsn_acquire',
        next_pass_cue_channel: 'telemetry',
      },
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
        commanderScore: 78.5,
        grade: 'B',
        breakdown: {
          events: { score: 0.8, weight: 0.4 },
          resources: { score: 0.65, weight: 0.3 },
          faults: { score: 0.5, weight: 0.2 },
          manual: { score: 0.4, weight: 0.1 },
        },
        delta: {
          commanderScore: 2.0,
          baseScore: 1.5,
          manualBonus: 0.5,
          breakdown: { events: 0.2, resources: 0.1, faults: -0.05, manual: 0.02 },
          gradeChanged: true,
          grade: 'B',
          previousGrade: 'C',
        },
      },
      history: [
        {
          getSeconds: 30,
          commanderScore: 76.5,
          baseScore: 71.0,
          manualBonus: 4.0,
          grade: 'C',
          breakdown: {
            events: { score: 0.75, weight: 0.4 },
            resources: { score: 0.6, weight: 0.3 },
            faults: { score: 0.48, weight: 0.2 },
            manual: { score: 0.35, weight: 0.1 },
          },
          delta: {
            commanderScore: 1.5,
            baseScore: 1.0,
            manualBonus: 0.5,
            breakdown: { events: 0.1, resources: 0.05, faults: -0.02, manual: 0.01 },
            gradeChanged: false,
            grade: 'C',
            previousGrade: 'C',
          },
        },
      ],
    };

    const audioBinder = {
      statsSnapshot: () => ({
        totalTriggers: 5,
        pendingCount: 2,
        lastCueId: 'alerts.master_alarm',
        lastTriggeredAtSeconds: 85,
      }),
      peekPending: () => [
        {
          cueId: 'telemetry.dsn_acquire',
          severity: 'notice',
          triggeredAtSeconds: 80,
          busId: 'telemetry',
          sourceType: 'communications',
          sourceId: 'PASS_B',
          metadata: { passId: 'PASS_B' },
        },
        {
          cueId: 'alerts.master_alarm',
          severity: 'failure',
          triggeredAtSeconds: 85,
          busId: 'alerts',
          sourceType: 'failure',
          sourceId: 'FAIL_POWER_LOW',
          metadata: { failureId: 'FAIL_POWER_LOW' },
        },
      ],
    };

    const audioDispatcher = {
      statsSnapshot: () => ({
        played: 3,
        stopped: 1,
        suppressed: 0,
        dropped: 0,
        lastCueId: 'alerts.master_alarm',
        lastStartedAtSeconds: 86,
        activeBuses: { alerts: 1 },
        queuedBuses: { alerts: 1 },
      }),
      getBusState: (busId) => {
        if (busId === 'alerts') {
          return {
            active: [
              {
                cueId: 'alerts.master_alarm',
                categoryId: 'alerts',
                priority: 60,
                startedAtSeconds: 86,
                loop: false,
                trigger: { severity: 'failure', metadata: { failureId: 'FAIL_POWER_LOW' } },
              },
            ],
            queue: [
              {
                cueId: 'dialogue.go_for_tli',
                categoryId: 'dialogue',
                priority: 10,
                triggeredAtSeconds: 87,
                severity: 'notice',
                metadata: { eventId: 'EVT1' },
              },
            ],
          };
        }
        return { active: [], queue: [] };
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
      audioBinder,
      audioDispatcher,
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

    assert.ok(frame.audio);
    assert.equal(frame.audio.binder.lastCueId, 'alerts.master_alarm');
    assert.equal(frame.audio.binder.pendingCount, 2);
    assert.ok(Array.isArray(frame.audio.pending));
    assert.equal(frame.audio.pending[1].cueId, 'alerts.master_alarm');
    assert.equal(frame.audio.dispatcher.activeBuses.alerts, 1);
    assert.ok(Array.isArray(frame.audio.active));
    assert.equal(frame.audio.active[0].cueId, 'alerts.master_alarm');
    assert.ok(Array.isArray(frame.audio.queued));
    assert.equal(frame.audio.queued[0].cueId, 'dialogue.go_for_tli');

    const communications = frame.resources.communications;
    assert.equal(communications.active, true);
    assert.equal(communications.current.audioCueOnAcquire, 'telemetry.dsn_acquire');
    assert.equal(communications.current.audioChannelOnLoss, 'telemetry');
    assert.equal(communications.next.cueOnAcquire, 'telemetry.dsn_acquire');
    assert.equal(communications.nextPassCueOnAcquire, 'telemetry.dsn_acquire');

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
    assert.equal(frame.score.rating.commanderScore, 78.5);
    assert.equal(frame.score.rating.grade, 'B');
    assert.equal(frame.score.events.completed, 3);
    assert.deepEqual(frame.score.resources.propellantUsedKg, { csm_sps: 8.5 });
    assert.deepEqual(frame.score.faults.resourceFailureIds, [
      'FAIL_COMM_PASS_MISSED',
      'FAIL_POWER_LOW',
    ]);

    assert.ok(Array.isArray(frame.score.history));
    assert.equal(frame.score.history.length, 1);
    const historyEntry = frame.score.history[0];
    assert.equal(historyEntry.getSeconds, 30);
    assert.equal(historyEntry.get, '000:00:30');
    assert.equal(historyEntry.commanderScore, 76.5);
    assert.ok(historyEntry.delta);
    assert.equal(historyEntry.delta.commanderScore, 1.5);
    assert.equal(historyEntry.delta.breakdown.events, 0.1);

    assert.ok(frame.score.rating.delta);
    assert.equal(frame.score.rating.delta.commanderScore, 2.0);
    assert.equal(frame.score.rating.delta.gradeChanged, true);
    assert.equal(frame.score.rating.delta.previousGrade, 'C');
    assert.equal(frame.missionLog, null);
  });

  test('summarizes docking overlay state', () => {
    const dockingConfig = {
      version: 1,
      eventId: 'LM_ASCENT_030',
      startRangeMeters: 500,
      endRangeMeters: 0,
      notes: 'Apollo 11 braking gates',
      gates: [
        {
          id: 'GATE_500M',
          label: '500 m braking gate',
          rangeMeters: 500,
          targetRateMps: -2.4,
          tolerance: { plus: 0.8, minus: 0.4 },
          activationProgress: 0.0,
          completionProgress: 0.3,
          checklistId: 'FP_7-32_RNDZ_DOCK',
          sources: ['Apollo 11 Flight Plan p. 7-32'],
        },
        {
          id: 'GATE_150M',
          label: '150 m braking gate',
          rangeMeters: 150,
          targetRateMps: -0.9,
          tolerance: { plus: 0.3, minus: 0.2 },
          activationProgress: 0.3,
          completionProgress: 0.7,
          checklistId: 'FP_7-32_RNDZ_DOCK',
          sources: ['Apollo 11 Flight Plan p. 7-32'],
        },
        {
          id: 'GATE_CONTACT',
          label: 'Contact gate',
          rangeMeters: 0,
          targetRateMps: -0.2,
          tolerance: { plus: 0.05, minus: 0.05 },
          activationProgress: 0.9,
          completionProgress: 1.0,
          checklistId: 'FP_7-32_RNDZ_DOCK',
          sources: ['Apollo 11 Flight Plan p. 7-32'],
        },
      ],
    };

    const eventList = [
      {
        id: 'LM_ASCENT_030',
        getOpenSeconds: parseGET('125:40:00'),
        getCloseSeconds: parseGET('128:30:00'),
      },
    ];

    const builder = new UiFrameBuilder({ docking: dockingConfig, events: eventList });

    const dockingState = {
      eventId: 'LM_ASCENT_030',
      progress: 0.65,
      rangeMeters: 120.4,
      closingRateMps: -0.82,
      lateralRateMps: 0.05,
      predictedContactVelocityMps: 0.21,
      gates: [
        { id: 'GATE_500M', status: 'complete', completedAtSeconds: parseGET('126:35:00') },
        { id: 'GATE_150M', status: 'active', progress: 0.62 },
      ],
      rcs: {
        quads: [
          { id: 'LM_QUAD_A', enabled: true, dutyCyclePct: 12.5 },
          { id: 'LM_QUAD_B', enabled: false, dutyCyclePct: 9.8 },
        ],
        propellantKgRemaining: { lm_rcs: 110.2 },
        propellantKgBudget: { lm_rcs: 138.0 },
      },
    };

    const currentGetSeconds = parseGET('126:45:00');
    const frame = builder.build(currentGetSeconds, {
      scheduler: {
        getEventById: (id) => eventList.find((event) => event.id === id) ?? null,
      },
      docking: dockingState,
      resourceSystem: { snapshot: () => ({}) },
    });

    assert.ok(frame.docking);
    const docking = frame.docking;
    assert.equal(docking.eventId, 'LM_ASCENT_030');
    assert.equal(docking.activeGateId, 'GATE_150M');
    assert.equal(docking.activeGate, 'GATE_150M');
    assert.equal(docking.startRangeMeters, 500);
    assert.equal(docking.endRangeMeters, 0);
    assert.equal(docking.notes, 'Apollo 11 braking gates');
    assert.equal(docking.rangeMeters, 120.4);
    assert.equal(docking.closingRateMps, -0.82);
    assert.equal(docking.lateralRateMps, 0.05);
    assert.equal(docking.predictedContactVelocityMps, 0.21);
    assert.equal(docking.progress, 0.65);
    assert.ok(docking.rcs);
    assert.deepEqual(docking.rcs.quads, [
      { id: 'LM_QUAD_A', enabled: true, dutyCyclePct: 12.5 },
      { id: 'LM_QUAD_B', enabled: false, dutyCyclePct: 9.8 },
    ]);
    assert.deepEqual(docking.rcs.propellantKgRemaining, { lm_rcs: 110.2 });
    assert.deepEqual(docking.rcs.propellantKgBudget, { lm_rcs: 138.0 });

    assert.equal(docking.gates.length, dockingConfig.gates.length);
    assert.deepEqual(
      docking.gates.map((gate) => gate.id),
      ['GATE_500M', 'GATE_150M', 'GATE_CONTACT'],
    );

    const gate500 = docking.gates.find((gate) => gate.id === 'GATE_500M');
    assert.equal(gate500.status, 'complete');
    assert.equal(gate500.deadlineGet, formatGET(parseGET('126:31:00')));
    assert.equal(gate500.deadlineSeconds, parseGET('126:31:00'));
    assert.deepEqual(gate500.sources, ['Apollo 11 Flight Plan p. 7-32']);

    const gate150 = docking.gates.find((gate) => gate.id === 'GATE_150M');
    assert.equal(gate150.status, 'active');
    assert.equal(gate150.progress, 0.62);
    assert.equal(gate150.deadlineSeconds, parseGET('127:39:00'));

    const gateContact = docking.gates.find((gate) => gate.id === 'GATE_CONTACT');
    assert.equal(gateContact.status, 'pending');
    assert.equal(gateContact.checklistId, 'FP_7-32_RNDZ_DOCK');
  });

  test('summarizes entry overlay state', () => {
    const padEntryId = 'PAD_ENTRY';
    const entryInterfaceSeconds = parseGET('195:11:00');
    const padMap = new Map([
      [
        padEntryId,
        {
          id: padEntryId,
          purpose: 'Entry PAD review',
          parameters: {
            entryInterface: {
              get: '195:11:00',
              getSeconds: entryInterfaceSeconds,
            },
            flightPathAngleDeg: -6.5,
          },
        },
      ],
    ]);

    const entryEvents = {
      padReview: 'RETURN_030',
      finalAlign: 'RETURN_031',
      serviceModuleJettison: 'ENTRY_001',
      entryMonitoring: 'ENTRY_002',
      recovery: 'ENTRY_003',
    };

    const entryConfig = {
      padId: padEntryId,
      events: entryEvents,
      corridor: {
        toleranceDegrees: 0.35,
        default: {
          angleOffsetDeg: 0.15,
          downrangeErrorKm: 40,
          crossrangeErrorKm: -12,
        },
        states: [
          {
            event: 'padReview',
            status: 'complete',
            angleOffsetDeg: 0.02,
            downrangeErrorKm: 12,
            crossrangeErrorKm: -3,
          },
          {
            event: 'entryMonitoring',
            status: 'active',
            angleOffsetDeg: -0.01,
            downrangeErrorKm: 3,
            crossrangeErrorKm: 1,
          },
          {
            event: 'recovery',
            status: 'complete',
            angleOffsetDeg: 0,
            downrangeErrorKm: 0,
            crossrangeErrorKm: 0,
          },
        ],
      },
      blackout: {
        startGet: '195:16:24',
        endGet: '195:19:54',
      },
      gLoad: {
        max: 6.7,
        caution: 5.5,
        warning: 6.3,
        states: [
          { event: 'serviceModuleJettison', status: 'active', value: 1.2 },
          { event: 'entryMonitoring', status: 'active', value: 3.6 },
          { event: 'recovery', status: 'complete', value: 1.0 },
        ],
      },
      ems: {
        targetVelocityFtPerSec: 36000,
        targetAltitudeFt: 250000,
        predictedSplashdownSeconds: parseGET('195:23:00'),
      },
      recoveryTimeline: [
        {
          id: 'DROGUE_DEPLOY',
          label: 'Drogues Deploy',
          get: '195:21:10',
          ackOffsetSeconds: 0,
          completeOffsetSeconds: 60,
        },
        {
          id: 'HATCH_OPEN',
          label: 'Hatch Open',
          get: '195:24:30',
          ackOffsetSeconds: 0,
          completeOffsetSeconds: 90,
        },
      ],
    };

    const eventList = [
      {
        id: 'RETURN_030',
        status: 'complete',
        activationTimeSeconds: parseGET('195:12:00'),
        completionTimeSeconds: parseGET('195:13:30'),
        padId: padEntryId,
      },
      {
        id: 'RETURN_031',
        status: 'complete',
        activationTimeSeconds: parseGET('195:14:00'),
        completionTimeSeconds: parseGET('195:15:30'),
      },
      {
        id: 'ENTRY_001',
        status: 'complete',
        activationTimeSeconds: parseGET('195:15:40'),
        completionTimeSeconds: parseGET('195:16:10'),
      },
      {
        id: 'ENTRY_002',
        status: 'active',
        activationTimeSeconds: parseGET('195:16:20'),
      },
      {
        id: 'ENTRY_003',
        status: 'pending',
      },
    ];

    const builder = new UiFrameBuilder({ entry: entryConfig, pads: padMap, events: eventList });

    const currentGetSeconds = parseGET('195:17:30');
    const blackoutEndSeconds = parseGET('195:19:54');
    const frame = builder.build(currentGetSeconds, {
      scheduler: {
        stats: () => ({ counts: { pending: 0, active: 0, complete: 0 }, upcoming: [] }),
        getEventById: (id) => eventList.find((event) => event.id === id) ?? null,
      },
      resourceSystem: { snapshot: () => ({}) },
    });

    assert.ok(frame.entry);
    const entry = frame.entry;
    assert.equal(entry.entryInterfaceSeconds, entryInterfaceSeconds);
    assert.equal(entry.entryInterfaceGet, formatGET(entryInterfaceSeconds));

    assert.ok(entry.corridor);
    assert.equal(entry.corridor.targetDegrees, -6.5);
    assert.equal(entry.corridor.toleranceDegrees, 0.35);
    assert.equal(entry.corridor.currentDegrees, -6.51);
    assert.equal(entry.corridor.downrangeErrorKm, 3);
    assert.equal(entry.corridor.crossrangeErrorKm, 1);

    assert.ok(entry.blackout);
    assert.equal(entry.blackout.status, 'active');
    assert.equal(entry.blackout.startsAtSeconds, parseGET('195:16:24'));
    assert.equal(entry.blackout.startsAtGet, '195:16:24');
    assert.equal(entry.blackout.endsAtSeconds, blackoutEndSeconds);
    assert.equal(entry.blackout.endsAtGet, '195:19:54');
    assert.equal(entry.blackout.remainingSeconds, blackoutEndSeconds - currentGetSeconds);

    assert.ok(entry.ems);
    assert.equal(entry.ems.velocityFtPerSec, 36000);
    assert.equal(entry.ems.altitudeFt, 250000);
    assert.equal(entry.ems.predictedSplashdownSeconds, parseGET('195:23:00'));
    assert.equal(entry.ems.predictedSplashdownGet, '195:23:00');

    assert.ok(entry.gLoad);
    assert.equal(entry.gLoad.current, 3.6);
    assert.equal(entry.gLoad.max, 6.7);
    assert.equal(entry.gLoad.caution, 5.5);
    assert.equal(entry.gLoad.warning, 6.3);

    assert.ok(Array.isArray(entry.recovery));
    assert.equal(entry.recovery.length, 2);
    const [drogue, hatch] = entry.recovery;
    assert.equal(drogue.id, 'DROGUE_DEPLOY');
    assert.equal(drogue.status, 'pending');
    assert.equal(drogue.get, '195:21:10');
    assert.equal(drogue.getSeconds, parseGET('195:21:10'));
    assert.equal(hatch.id, 'HATCH_OPEN');
    assert.equal(hatch.status, 'pending');
    assert.equal(hatch.get, '195:24:30');
    assert.equal(hatch.getSeconds, parseGET('195:24:30'));
  });

  test('enriches checklist summaries with UI definitions and workspace presets', () => {
    const panelDefinition = {
      id: 'CSM_TEST',
      name: 'Test Panel',
      craft: 'CSM',
      controls: [],
      controlsById: new Map(),
      hotspotsByControl: new Map(),
    };
    const controlDefinition = {
      id: 'CTRL_A',
      label: 'Control A',
      type: 'toggle',
      defaultState: 'OFF',
      states: [
        { id: 'OFF', label: 'Off', drawKw: 0 },
        { id: 'ON', label: 'On', drawKw: 0.5 },
      ],
      statesById: new Map([
        ['OFF', { id: 'OFF', label: 'Off', drawKw: 0 }],
        ['ON', { id: 'ON', label: 'On', drawKw: 0.5 }],
      ]),
    };
    panelDefinition.controls.push(controlDefinition);
    panelDefinition.controlsById.set('CTRL_A', controlDefinition);
    panelDefinition.hotspotsByControl.set('CTRL_A', {
      controlId: 'CTRL_A',
      x: 10,
      y: 20,
      width: 30,
      height: 40,
    });

    const stepDefinition = {
      id: 'CHK_STEP',
      order: 1,
      callout: 'Test callout',
      panelId: 'CSM_TEST',
      controls: [
        { controlId: 'CTRL_A', targetState: 'ON', verification: 'indicator' },
      ],
      dskyMacro: 'V16N65_TEST',
      manualOnly: false,
      prerequisites: ['event:TEST'],
      effects: [{ type: 'flag', id: 'flag', value: true }],
      notes: 'Test note',
    };

    const checklistDefinition = {
      id: 'CHK_TEST',
      title: 'Test Checklist',
      phase: 'Translunar',
      role: 'CMP',
      nominalGet: '000:05:00',
      nominalGetSeconds: parseGET('000:05:00'),
      steps: [stepDefinition],
      stepsById: new Map([[stepDefinition.id, stepDefinition]]),
      stepsByOrder: new Map([[1, stepDefinition]]),
      totalSteps: 1,
      tags: ['test'],
      source: { document: 'Flight Plan', page: '3-10' },
    };

    const workspaceDefinition = {
      id: 'WS_TEST',
      name: 'Workspace',
      description: 'Test workspace',
      viewport: { minWidth: 1280, minHeight: 720, hudPinned: true },
      tiles: [
        { id: 'tile1', window: 'trajectoryCanvas', x: 0, y: 0, width: 0.5, height: 0.5 },
      ],
    };

    const builder = new UiFrameBuilder({
      uiPanels: { items: [panelDefinition], map: new Map([[panelDefinition.id, panelDefinition]]) },
      uiChecklists: {
        items: [checklistDefinition],
        map: new Map([[checklistDefinition.id, checklistDefinition]]),
      },
      uiWorkspaces: {
        items: [workspaceDefinition],
        map: new Map([[workspaceDefinition.id, workspaceDefinition]]),
      },
      activeChecklistLimit: 2,
    });

    const frame = builder.build(0, {
      scheduler: { stats: () => ({ counts: {}, upcoming: [] }) },
      checklistManager: {
        stats: () => ({
          totals: {
            active: 1,
            completed: 0,
            aborted: 0,
            acknowledgedSteps: 0,
            autoSteps: 0,
            manualSteps: 0,
          },
          active: [
            {
              eventId: 'EVT_TEST',
              checklistId: 'CHK_TEST',
              title: 'Test Checklist',
              crewRole: 'CMP',
              completedSteps: 0,
              totalSteps: 1,
              nextStepNumber: 1,
              nextStepAction: 'Test callout',
              autoAdvancePending: false,
            },
          ],
        }),
      },
    });

    const active = frame.checklists.active[0];
    assert.equal(active.definition.phase, 'Translunar');
    assert.equal(active.definition.totalSteps, 1);
    assert.equal(active.nextStepDefinition.controls[0].targetStateLabel, 'On');
    assert.equal(active.nextStepDefinition.controls[0].control.hotspot.width, 30);
    assert.deepEqual(active.nextStepDefinition.prerequisites, ['event:TEST']);

    const chip = frame.checklists.chip;
    assert.ok(chip.definition);
    assert.equal(chip.nextStepDefinition.controls[0].control.label, 'Control A');

    assert.ok(frame.ui);
    assert.equal(frame.ui.workspaces.length, 1);
    const workspace = frame.ui.workspaces[0];
    assert.equal(workspace.id, 'WS_TEST');
    assert.equal(workspace.tileCount, 1);
    assert.equal(workspace.viewport.minWidth, 1280);
    assert.strictEqual(workspace.viewport.hudPinned, true);
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
