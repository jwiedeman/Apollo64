import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { AutopilotRunner } from '../src/sim/autopilotRunner.js';
import { createTestLogger, sumByKey } from './testUtils.js';

describe('AutopilotRunner', () => {
  test('records throttle usage, ullage, and completion summaries', () => {
    const propellantCalls = [];
    const resourceSystem = {
      recordPropellantUsage: (tankKey, amountKg, metadata) => {
        propellantCalls.push({ tankKey, amountKg, metadata });
        return true;
      },
      propellantConfig: {
        csm_sps: {
          initialKg: 950,
          reserveKg: 50,
          usableDeltaVMps: 1900,
          tankKey: 'csm_sps_kg',
        },
      },
      deltaVStageByTank: { csm_sps_kg: 'csm_sps' },
    };

    const logger = createTestLogger();
    const runner = new AutopilotRunner(resourceSystem, logger);

    const event = {
      id: 'EVT_TEST',
      autopilotId: 'PGM_TEST',
      autopilot: {
        script: {
          title: 'Throttle Calibration',
          sequence: [
            { time: 0, command: 'throttle', level: 1 },
            { time: 5, command: 'throttle', level: 0 },
          ],
        },
        propulsion: {
          type: 'test_sps',
          tank: 'csm_sps',
          mass_flow_kg_per_s: 10,
        },
      },
    };

    runner.start(event, 100);

    for (let time = 101; time < 105; time += 1) {
      runner.update(time);
    }

    runner.update(105 - 2e-6);
    runner.update(105.5);

    const summary = runner.consumeEventSummary(event.id);

    assert.ok(summary, 'summary should be recorded after completion');
    assert.equal(summary.status, 'complete');
    assert.ok(Math.abs(summary.metrics.burnSeconds - 5) < 1e-3);
    assert.ok(Math.abs(summary.metrics.propellantKg - 50) < 1e-3);
    assert.ok(Math.abs(summary.metrics.throttleIntegralSeconds - 5) < 1e-3);
    assert.ok(Math.abs(summary.deviations.burnSeconds) < 1e-3);
    assert.ok(Math.abs(summary.deviations.propellantKg) < 1e-3);
    assert.ok(Math.abs(summary.metrics.deltaVMps - (1900 / 900) * 50) < 1e-3);
    assert.ok(Math.abs(summary.expected.deltaVMps - summary.metrics.deltaVMps) < 1e-3);
    assert.ok(Math.abs(summary.deviations.deltaVMps) < 1e-3);

    assert.ok(Math.abs(runner.metrics.totalBurnSeconds - 5) < 1e-3);
    assert.ok(Math.abs(runner.metrics.totalThrottleIntegralSeconds - 5) < 1e-3);
    assert.equal(runner.metrics.totalUllageSeconds, 0);

    assert.ok(propellantCalls.length >= 4);
    assert.ok(propellantCalls.every((call) => call.tankKey === 'csm_sps_kg'));
    assert.ok(Math.abs(sumByKey(propellantCalls, 'amountKg') - 50) < 1e-3);
    assert.ok(propellantCalls.every((call) => call.metadata.note === 'autopilot_throttle'));
  });
});
