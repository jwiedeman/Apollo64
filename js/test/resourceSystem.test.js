import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { ResourceSystem } from '../src/sim/resourceSystem.js';

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
