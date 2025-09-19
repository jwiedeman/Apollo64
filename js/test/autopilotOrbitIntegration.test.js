import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { AutopilotRunner } from '../src/sim/autopilotRunner.js';
import { EventScheduler } from '../src/sim/eventScheduler.js';
import { OrbitPropagator } from '../src/sim/orbitPropagator.js';
import { EARTH_BODY, createCircularOrbitState } from '../src/config/orbit.js';
import { createTestLogger, sumByKey } from './testUtils.js';

describe('Autopilot and orbit integration', () => {
  test('completed autopilot burns adjust orbit state via delta-v', () => {
    const logger = createTestLogger();
    const propellantUsage = [];
    const resourceSystem = {
      recordPropellantUsage: (tankKey, amountKg, metadata) => {
        propellantUsage.push({ tankKey, amountKg, metadata });
        return true;
      },
      propellantConfig: {
        csm_sps: {
          initialKg: 950,
          reserveKg: 50,
          usableDeltaVMps: 1900,
        },
      },
      deltaVStageByTank: { csm_sps_kg: 'csm_sps' },
      applyEffect: () => {},
    };

    const autopilotRunner = new AutopilotRunner(resourceSystem, logger);

    const initialState = createCircularOrbitState({ altitudeMeters: 185_000 });
    const orbitPropagator = new OrbitPropagator({
      primaryBody: EARTH_BODY,
      initialState,
      history: { enabled: false },
    });

    const before = orbitPropagator.summary();

    const autopilotId = 'PGM_TEST_BURN';
    const autopilotDefinition = {
      id: autopilotId,
      script: {
        title: 'Test SPS Burn',
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
      durationSeconds: 5,
    };

    const event = {
      id: 'EVT_TEST_AUTOPILOT_BURN',
      phase: 'TEST',
      getOpenSeconds: 0,
      getCloseSeconds: 120,
      autopilotId,
    };

    const autopilotMap = new Map([[autopilotId, autopilotDefinition]]);

    let capturedDeltaV = null;
    const appliedImpulses = [];
    const scheduler = new EventScheduler([event], autopilotMap, resourceSystem, logger, {
      autopilotRunner,
      autopilotSummaryHandlers: [
        (evt, summary) => {
          const deltaVMps = summary?.metrics?.deltaVMps ?? null;
          if (!Number.isFinite(deltaVMps) || deltaVMps <= 0) {
            return;
          }
          capturedDeltaV = deltaVMps;
          const impulse = orbitPropagator.applyDeltaV(deltaVMps, {
            frame: 'prograde',
            getSeconds: summary.completedAtSeconds ?? evt?.completionTimeSeconds ?? null,
            metadata: {
              eventId: summary.eventId ?? evt?.id ?? null,
              autopilotId: summary.autopilotId ?? evt?.autopilotId ?? null,
              status: summary.status ?? null,
            },
          });
          if (impulse) {
            appliedImpulses.push(impulse);
          }
        },
      ],
    });

    let currentGet = 0;
    const dtSeconds = 1;
    for (let i = 0; i < 15; i += 1) {
      scheduler.update(currentGet, dtSeconds);
      orbitPropagator.update(dtSeconds, { getSeconds: currentGet + dtSeconds });
      currentGet += dtSeconds;
    }

    const [scheduledEvent] = scheduler.events;
    assert.equal(scheduledEvent.status, 'complete');

    assert.ok(appliedImpulses.length === 1, 'orbit propagator should record exactly one impulse');
    assert.ok(Number.isFinite(capturedDeltaV) && capturedDeltaV > 0, 'autopilot delta-v should be captured');

    const after = orbitPropagator.summary();

    assert.ok(after.metrics.totalDeltaVMps > before.metrics.totalDeltaVMps);
    assert.ok(Math.abs(after.metrics.totalDeltaVMps - capturedDeltaV) < 1e-6);

    assert.ok(after.elements.apoapsisAltitude > before.elements.apoapsisAltitude);
    assert.ok(after.elements.periapsisAltitude >= before.elements.periapsisAltitude - 1);

    const lastImpulse = after.metrics.lastImpulse;
    assert.ok(lastImpulse, 'last impulse should be recorded');
    assert.equal(lastImpulse.metadata?.eventId, event.id);
    assert.equal(lastImpulse.metadata?.autopilotId, autopilotId);
    assert.equal(lastImpulse.metadata?.status, 'complete');

    const totalPropellantUsed = sumByKey(propellantUsage, 'amountKg');
    assert.ok(totalPropellantUsed > 0);
  });
});
