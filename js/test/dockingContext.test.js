import test from 'node:test';
import assert from 'node:assert/strict';
import { DockingContext } from '../src/sim/dockingContext.js';
import { parseGET, formatGET } from '../src/utils/time.js';

test('DockingContext tracks gate progress and RCS duty cycle', () => {
  const dockingConfig = {
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

  const resourceSystem = {
    state: { propellant: { lm_rcs_kg: 110.2, csm_rcs_kg: 280.5 } },
    budgets: {
      propellant: {
        lm_rcs: { initial_kg: 138 },
        csm_rcs: { initial_kg: 320 },
      },
    },
  };

  const thrusterConfig = {
    craft: [
      {
        id: 'LM',
        rcs: {
          clusters: [
            { id: 'LM_RCS_QUAD_A', thrusters: [] },
            { id: 'LM_RCS_QUAD_B', thrusters: [] },
          ],
        },
      },
    ],
  };

  const docking = new DockingContext({
    config: dockingConfig,
    resourceSystem,
    thrusterConfig,
  });

  const openSeconds = parseGET('125:40:00');
  const closeSeconds = parseGET('128:30:00');
  const activationSeconds = parseGET('125:50:00');
  const event = {
    id: 'LM_ASCENT_030',
    status: 'active',
    getOpenSeconds: openSeconds,
    getCloseSeconds: closeSeconds,
    activationTimeSeconds: activationSeconds,
    expectedDurationSeconds: 7200,
  };
  const scheduler = {
    getEventById: (id) => (id === 'LM_ASCENT_030' ? event : null),
  };

  const usageTime = parseGET('126:44:00');
  docking.recordRcsUsage({
    getSeconds: usageTime,
    thrusters: [
      {
        id: 'LM_RCS_A1',
        clusterId: 'LM_RCS_QUAD_A',
        pulses: 4,
        durationSeconds: 0.4,
        massKg: 0.6,
      },
    ],
  });

  const currentGetSeconds = parseGET('126:45:00');
  docking.update(currentGetSeconds, { scheduler });

  const snapshot = docking.snapshot();
  assert.ok(snapshot);
  assert.equal(snapshot.eventId, 'LM_ASCENT_030');
  assert.equal(snapshot.activeGateId, 'GATE_150M');
  assert.ok(snapshot.progress > 0.4 && snapshot.progress < 0.7);
  assert.ok(snapshot.rangeMeters < dockingConfig.startRangeMeters);
  assert.equal(snapshot.closingRateMps, -0.9);
  assert.equal(snapshot.predictedContactVelocityMps, -0.2);

  const gate150 = snapshot.gates.find((gate) => gate.id === 'GATE_150M');
  assert.ok(gate150);
  assert.equal(gate150.status, 'active');
  assert.ok(gate150.progress > 0 && gate150.progress <= 1);
  assert.equal(gate150.deadlineSeconds, openSeconds + (closeSeconds - openSeconds) * 0.7);
  assert.equal(gate150.deadlineGet, formatGET(gate150.deadlineSeconds));

  const rcs = snapshot.rcs;
  assert.ok(rcs);
  assert.equal(rcs.propellantKgRemaining.lm_rcs, 110.2);
  assert.equal(rcs.propellantKgBudget.lm_rcs, 138);
  const quadA = rcs.quads.find((quad) => quad.id === 'LM_RCS_QUAD_A');
  assert.ok(quadA);
  assert.ok(quadA.dutyCyclePct === null || quadA.dutyCyclePct > 0);

  // Complete the event and ensure gates mark complete.
  event.status = 'complete';
  event.completionTimeSeconds = parseGET('127:20:00');
  docking.update(event.completionTimeSeconds, { scheduler });
  const finalSnapshot = docking.snapshot();
  assert.ok(finalSnapshot);
  assert.equal(finalSnapshot.progress, 1);
  const contactGate = finalSnapshot.gates.find((gate) => gate.id === 'GATE_CONTACT');
  assert.ok(contactGate);
  assert.equal(contactGate.status, 'complete');
});
