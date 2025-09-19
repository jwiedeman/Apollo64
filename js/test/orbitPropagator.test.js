import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { OrbitPropagator } from '../src/sim/orbitPropagator.js';
import { EARTH_BODY, createCircularOrbitState } from '../src/config/orbit.js';

function propagateFor(propagator, durationSeconds, stepSeconds = 0.05) {
  const steps = Math.max(1, Math.floor(durationSeconds / stepSeconds));
  let current = propagator.summary().epochSeconds ?? 0;
  for (let i = 0; i < steps; i += 1) {
    current += stepSeconds;
    propagator.update(stepSeconds, { getSeconds: current });
  }
}

describe('OrbitPropagator', () => {
  test('maintains circular orbit within tolerance', () => {
    const altitude = 200_000;
    const initialState = createCircularOrbitState({ altitudeMeters: altitude });
    const propagator = new OrbitPropagator({
      primaryBody: EARTH_BODY,
      initialState,
      history: { enabled: false },
    });

    propagateFor(propagator, 600);

    const summary = propagator.summary();
    const radius = summary.position.radius;
    const expectedRadius = EARTH_BODY.radius + altitude;
    assert.ok(Math.abs(radius - expectedRadius) < 5_000);
  });

  test('records delta-v impulses and adjusts orbital elements', () => {
    const initialState = createCircularOrbitState({ altitudeMeters: 185_000 });
    const propagator = new OrbitPropagator({
      primaryBody: EARTH_BODY,
      initialState,
      history: { enabled: false },
    });

    const before = propagator.summary();
    const initialApoapsis = before.elements.apoapsisAltitude ?? before.position.altitude;

    propagator.applyDeltaV(10, { frame: 'prograde', getSeconds: 10 });

    const after = propagator.summary();
    assert.ok(after.metrics.totalDeltaVMps > 0);
    assert.equal(after.metrics.lastImpulse?.frame, 'prograde');
    assert.ok((after.elements.apoapsisAltitude ?? 0) > (initialApoapsis ?? 0));
  });

  test('captures history samples when enabled', () => {
    const propagator = new OrbitPropagator({
      primaryBody: EARTH_BODY,
      history: { enabled: true, sampleIntervalSeconds: 30, maxSamples: 20 },
    });

    propagateFor(propagator, 180);

    const history = propagator.historySnapshot();
    assert.ok(history.meta.enabled);
    assert.ok(history.samples.length >= 2);
    assert.ok(history.samples.every((sample) => typeof sample.altitudeKm === 'number'));
  });
});
