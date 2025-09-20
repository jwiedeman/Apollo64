import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { TextHud } from '../src/hud/textHud.js';

describe('TextHud', () => {
  test('includes docking summary when present', () => {
    const frameBuilder = {
      build: () => ({
        events: { counts: {} },
        resources: {},
        autopilot: null,
        trajectory: null,
        alerts: {},
        docking: {
          activeGateId: 'GATE_150M',
          rangeMeters: 142.3,
          closingRateMps: -0.92,
          gates: [
            { id: 'GATE_500M', label: '500 m braking gate', status: 'complete', timeRemainingSeconds: -30, overdue: true },
            { id: 'GATE_150M', label: '150 m braking gate', status: 'active', timeRemainingSeconds: 90 },
          ],
          rcs: {
            propellantKgRemaining: { lm_rcs: 112.4 },
            quads: [
              { id: 'LM_QUAD_A', enabled: true, dutyCyclePct: 12.4 },
              { id: 'LM_QUAD_B', enabled: false },
            ],
          },
        },
      }),
    };

    const hud = new TextHud({ frameBuilder, enabled: true, renderIntervalSeconds: 1 });
    hud.update(1000, {});

    const snapshot = hud.stats().lastSnapshot;
    assert.ok(snapshot, 'expected a snapshot after update');
    assert.match(snapshot.message, /Dock 150 m braking gate/);
    assert.match(snapshot.message, /142m/);
    assert.match(snapshot.message, /-0\.92m\/s/);
    assert.match(snapshot.message, /T-000:01:30/);
    assert.match(snapshot.message, /RCS 112kg/);
    assert.match(snapshot.message, /off:LM_QUAD_B/);
  });
});

