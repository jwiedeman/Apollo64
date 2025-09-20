import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { ResourceSystem } from '../src/sim/resourceSystem.js';
import { parseGET } from '../src/utils/time.js';
import { AudioCueBinder } from '../src/audio/audioCueBinder.js';

const AUDIO_FIXTURE = {
  version: 1,
  buses: [
    { id: 'alerts' },
    { id: 'telemetry' },
  ],
  categories: [
    { id: 'alert', bus: 'alerts', defaultPriority: 95 },
    { id: 'telemetry', bus: 'telemetry', defaultPriority: 50 },
  ],
  cues: [
    { id: 'alerts.master_alarm', category: 'alert' },
    { id: 'telemetry.dsn_acquire', category: 'telemetry' },
  ],
};

describe('ResourceSystem delta-v tracking', () => {
  test('maintains per-stage margins, adjustments, and metrics', () => {
    const system = new ResourceSystem(null, {
      consumables: {
        propellant: {
          csm_sps: { initial_kg: 1000, reserve_kg: 200, usable_delta_v_mps: 2000 },
          lm_descent: { initial_kg: 500, reserve_kg: 50, usable_delta_v_mps: 800 },
          lm_ascent: { initial_kg: 300, reserve_kg: 30, usable_delta_v_mps: 1200 },
        },
      },
    });

    const { delta_v: deltaVState } = system.state;
    assert.equal(deltaVState.total.margin_mps, 4000);
    assert.equal(system.state.delta_v_margin_mps, 4000);
    assert.equal(deltaVState.stages.csm_sps.margin_mps, 2000);
    assert.equal(deltaVState.stages.lm_descent.margin_mps, 800);
    assert.equal(deltaVState.stages.lm_ascent.margin_mps, 1200);

    system.applyEffect({ delta_v_margin_mps: -50 }, {
      getSeconds: 0,
      source: 'test',
      type: 'adjustment',
    });

    assert.equal(system.state.delta_v.stages.csm_sps.margin_mps, 1950);
    assert.equal(system.state.delta_v.stages.csm_sps.adjustment_mps, -50);
    assert.equal(system.state.delta_v_margin_mps, 3950);
    assert.equal(system.metrics.deltaV.usedMps, 50);

    system.applyEffect({ propellant: { csm_sps_kg: -160 } }, {
      getSeconds: 10,
      source: 'test',
      type: 'propellant',
    });

    assert.equal(system.state.propellant.csm_sps_kg, 840);
    assert.equal(system.state.delta_v.stages.csm_sps.base_mps, 1600);
    assert.equal(system.state.delta_v.stages.csm_sps.margin_mps, 1550);
    assert.equal(system.state.delta_v_margin_mps, 3550);
    assert.equal(system.metrics.deltaV.usedMps, 450);

    system.applyEffect({ delta_v: { stages: { lm_descent: { adjustment_mps: -20 } } } }, {
      getSeconds: 20,
      source: 'test',
      type: 'adjustment',
    });

    assert.equal(system.state.delta_v.stages.lm_descent.adjustment_mps, -20);
    assert.equal(system.state.delta_v.stages.lm_descent.margin_mps, 780);
    assert.equal(system.state.delta_v_margin_mps, 3530);
    assert.equal(system.metrics.deltaV.usedMps, 470);

    system.applyEffect({ propellant: { lm_descent_kg: -135 } }, {
      getSeconds: 30,
      source: 'test',
      type: 'propellant',
    });

    assert.equal(system.state.propellant.lm_descent_kg, 365);
    assert.equal(system.state.delta_v.stages.lm_descent.base_mps, 560);
    assert.equal(system.state.delta_v.stages.lm_descent.margin_mps, 540);
    assert.equal(system.state.delta_v_margin_mps, 3290);
    assert.equal(system.metrics.deltaV.usedMps, 710);

    system.applyEffect({ delta_v: { stages: { lm_descent: 30 } } }, {
      getSeconds: 40,
      source: 'test',
      type: 'adjustment',
    });

    assert.equal(system.state.delta_v.stages.lm_descent.adjustment_mps, 10);
    assert.equal(system.state.delta_v.stages.lm_descent.margin_mps, 570);
    assert.equal(system.state.delta_v_margin_mps, 3320);
    assert.equal(system.metrics.deltaV.usedMps, 710);
    assert.equal(system.metrics.deltaV.recoveredMps, 30);

    const snapshot = system.snapshot();
    assert.equal(snapshot.delta_v.total.margin_mps, 3320);
    assert.equal(snapshot.delta_v.stages.lm_descent.adjustment_mps, 10);
    assert.equal(snapshot.metrics.deltaV.usedMps, 710);
    assert.equal(snapshot.metrics.deltaV.recoveredMps, 30);
  });
});


describe('ResourceSystem failures', () => {
  test('records failure breadcrumbs from resource state', () => {
    const system = new ResourceSystem(null);
    system.state.ptc_active = false;
    system.state.thermal_balance_state = 'IDLE';
    system.state.cryo_boiloff_rate_pct_per_hr = 2.4;
    system.state.power_margin_pct = 42.5;

    system.applyEffect({ failure_id: 'FAIL_THERMAL_PTC_LATE' }, {
      getSeconds: 18 * 3600,
      source: 'COAST_001',
      type: 'failure',
    });

    const snapshot = system.snapshot();
    const failure = snapshot.failures.find((entry) => entry.id === 'FAIL_THERMAL_PTC_LATE');
    assert.ok(failure);
    assert.ok(failure.breadcrumb);
    assert.match(failure.breadcrumb.summary, /PTC/);
    assert.ok(Array.isArray(failure.breadcrumb.chain));
    assert.ok(failure.breadcrumb.chain.length >= 1);
  });

  test('records autopilot failure breadcrumbs with context', () => {
    const system = new ResourceSystem(null, {
      consumables: {
        propellant: {
          csm_sps: { initial_kg: 1000, reserve_kg: 200, usable_delta_v_mps: 2000 },
        },
      },
    });

    system.applyEffect({ failure_id: 'FAIL_TLI_UNDERBURN' }, {
      getSeconds: 200,
      source: 'TLI_002',
      type: 'failure',
      context: {
        autopilotSummary: {
          autopilotId: 'PGM_06_TLI',
          deviations: { deltaVMps: -12.4 },
          metrics: { deltaVMps: 3125 },
          expected: { deltaVMps: 3137.4 },
          propulsion: { tankKey: 'csm_sps_kg' },
        },
      },
    });

    const snapshot = system.snapshot();
    const failure = snapshot.failures.find((entry) => entry.id === 'FAIL_TLI_UNDERBURN');
    assert.ok(failure);
    assert.ok(failure.breadcrumb);
    assert.match(failure.breadcrumb.summary, /Autopilot PGM_06_TLI/);
    assert.ok(Array.isArray(failure.breadcrumb.chain));
    assert.ok(failure.breadcrumb.chain.some((item) => item.id === 'stage_margin'));
  });
});

describe('ResourceSystem communications cues', () => {
  test('normalizes schedule audio cues and exposes them in state', () => {
    const system = new ResourceSystem(null);
    system.configureCommunicationsSchedule([
      {
        id: 'PASS_A',
        get_open: '100:00:00',
        get_close: '100:20:00',
        cue_on_acquire: 'telemetry.dsn_acquire',
        cue_on_loss: 'telemetry.dsn_loss',
        cue_channel_on_acquire: 'telemetry',
        cue_channel_on_loss: 'telemetry',
      },
    ]);

    const scheduleSnapshot = system.communicationsSchedule;
    assert.equal(scheduleSnapshot.length, 1);
    const [pass] = scheduleSnapshot;
    assert.equal(pass.cueOnAcquire, 'telemetry.dsn_acquire');
    assert.equal(pass.cueOnLoss, 'telemetry.dsn_loss');
    assert.equal(pass.cueChannelOnAcquire, 'telemetry');
    assert.equal(pass.cueChannelOnLoss, 'telemetry');

    const initialSnapshot = system.snapshot();
    assert.equal(initialSnapshot.communications.next_pass_cue_on_acquire, 'telemetry.dsn_acquire');
    assert.equal(initialSnapshot.communications.next_pass_cue_channel, 'telemetry');

    const openSeconds = parseGET('100:00:00');
    system.update(1, openSeconds);
    const activeSnapshot = system.snapshot();
    assert.equal(activeSnapshot.communications.cue_on_acquire, 'telemetry.dsn_acquire');
    assert.equal(activeSnapshot.communications.cue_channel_on_acquire, 'telemetry');
    assert.equal(activeSnapshot.communications.cue_on_loss, 'telemetry.dsn_loss');
    assert.equal(activeSnapshot.communications.cue_channel_on_loss, 'telemetry');

    const closeSeconds = parseGET('100:21:00');
    system.update(closeSeconds - openSeconds, closeSeconds);
    const afterSnapshot = system.snapshot();
    assert.equal(afterSnapshot.communications.cue_on_acquire, null);
    assert.equal(afterSnapshot.communications.cue_on_loss, null);
    assert.equal(afterSnapshot.communications.next_pass_cue_on_acquire, null);
  });
});

describe('ResourceSystem audio binder integration', () => {
  test('emits communications acquire and loss triggers', () => {
    const binder = new AudioCueBinder(AUDIO_FIXTURE);
    const system = new ResourceSystem(null, { audioBinder: binder });
    system.configureCommunicationsSchedule([
      {
        id: 'PASS_BINDER',
        get_open: '150:00:00',
        get_close: '150:05:00',
        cue_on_acquire: 'telemetry.dsn_acquire',
        cue_on_loss: 'telemetry.dsn_acquire',
        cue_channel_on_acquire: 'telemetry',
        cue_channel_on_loss: 'telemetry',
      },
    ]);

    const openSeconds = parseGET('150:00:00');
    system.update(1, openSeconds);
    let triggers = binder.drainPending();
    assert.equal(triggers.length, 1);
    assert.equal(triggers[0].metadata.type, 'acquire');
    assert.equal(triggers[0].busId, 'telemetry');

    const closeSeconds = parseGET('150:05:00');
    system.update(closeSeconds - openSeconds, closeSeconds);
    triggers = binder.drainPending();
    assert.equal(triggers.length, 1);
    assert.equal(triggers[0].metadata.type, 'loss');
  });

  test('emits failure trigger when catalog specifies a cue', () => {
    const binder = new AudioCueBinder(AUDIO_FIXTURE);
    const system = new ResourceSystem(null, { audioBinder: binder });
    system.configureFailures([
      { failure_id: 'FAIL_AUDIO', classification: 'Hard', audio_cue_failure: 'alerts.master_alarm' },
    ]);

    system.applyEffect({ failure_id: 'FAIL_AUDIO' }, {
      getSeconds: 50,
      source: 'TEST_EVENT',
      type: 'failure',
    });

    const triggers = binder.drainPending();
    assert.equal(triggers.length, 1);
    assert.equal(triggers[0].cueId, 'alerts.master_alarm');
    assert.equal(triggers[0].severity, 'failure');
    assert.equal(triggers[0].metadata.failureId, 'FAIL_AUDIO');
  });
});
