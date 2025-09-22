import test from 'node:test';
import assert from 'node:assert/strict';
import { RcsController } from '../src/sim/rcsController.js';

test('RcsController usage listener receives cluster metrics', () => {
  const thrusterConfig = {
    craft: [
      {
        id: 'LM',
        name: 'LM',
        propellant_tank: 'lm_rcs_kg',
        rcs: {
          defaults: {
            thrust_newtons: 445,
            isp_seconds: 285,
            min_impulse_seconds: 0.1,
          },
          clusters: [
            {
              id: 'LM_RCS_QUAD_A',
              thrusters: [
                {
                  id: 'LM_RCS_A1',
                  translation_axis: '+X',
                  torque_axes: ['+yaw'],
                  thrust_newtons: 445,
                  isp_seconds: 285,
                },
              ],
            },
          ],
        },
      },
    ],
  };

  const resourceSystem = {
    recordPropellantUsage: () => {},
  };

  const controller = new RcsController(thrusterConfig, resourceSystem, null, {
    defaultImpulseSeconds: 0.1,
  });

  const events = [];
  const unsubscribe = controller.registerUsageListener((payload) => {
    events.push(payload);
  });

  const result = controller.executePulse({
    craftId: 'LM',
    axis: '+X',
    durationSeconds: 0.5,
    count: 2,
    getSeconds: 100,
    autopilotId: 'TEST_AUTOPILOT',
  });

  assert.ok(result.massKg > 0);
  assert.equal(result.craftId, 'LM');
  assert.equal(events.length, 1);
  const usage = events[0];
  assert.equal(usage.autopilotId, 'TEST_AUTOPILOT');
  assert.equal(usage.craftId, 'LM');
  assert.ok(Array.isArray(usage.thrusters));
  assert.equal(usage.thrusters.length, 1);
  const thrusterUsage = usage.thrusters[0];
  assert.equal(thrusterUsage.clusterId, 'LM_RCS_QUAD_A');
  assert.ok(thrusterUsage.durationSeconds > 0);
  assert.ok(thrusterUsage.massKg > 0);

  const stats = controller.stats();
  assert.ok(stats.usageByCluster);
  assert.ok(stats.usageByCluster.LM_RCS_QUAD_A > 0);

  unsubscribe();
});
