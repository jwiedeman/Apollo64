import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { ManualActionQueue } from '../src/sim/manualActionQueue.js';
import { createTestLogger } from './testUtils.js';

describe('ManualActionQueue', () => {
  test('processes checklist acknowledgements, propellant burns, and resource deltas', () => {
    const eventState = {
      eventId: 'EVT_MANUAL',
      steps: [
        { stepNumber: 1, action: 'Step 1', acknowledged: false },
        { stepNumber: 2, action: 'Step 2', acknowledged: false },
      ],
    };

    const acknowledgedSteps = [];
    const checklistManager = {
      getEventState: (eventId) => (eventId === eventState.eventId ? eventState : null),
      acknowledgeNextStep: (eventId, getSeconds, { actor, note }) => {
        if (eventId !== eventState.eventId) {
          return false;
        }
        const next = eventState.steps.find((step) => !step.acknowledged);
        if (!next) {
          return false;
        }
        next.acknowledged = true;
        next.acknowledgedAt = getSeconds;
        next.actor = actor;
        next.note = note;
        acknowledgedSteps.push({ ...next });
        return true;
      },
      stats: () => ({
        totals: { active: 1 },
        active: [],
      }),
    };

    const propellantUpdates = [];
    const resourceEffects = [];
    const resourceSystem = {
      recordPropellantUsage: (tankKey, amountKg, metadata) => {
        propellantUpdates.push({ tankKey, amountKg, metadata });
        return true;
      },
      applyEffect: (effect, metadata) => {
        resourceEffects.push({ effect, metadata });
      },
    };

    const logger = createTestLogger();

    const queue = new ManualActionQueue(
      [
        { type: 'checklist_ack', event_id: 'EVT_MANUAL', get: 10, count: 2, note: 'Checklist sync' },
        { type: 'propellant_burn', tank: 'csm_rcs', amount_kg: 1.25, get: 12, note: 'RCS trim' },
        {
          type: 'resource_delta',
          get: 15,
          note: 'Power shed',
          effect: { power: { fuel_cell_load_kw: -0.3 } },
        },
      ],
      { logger, checklistManager, resourceSystem },
    );

    queue.update(10);
    queue.update(12);
    queue.update(15);

    const stats = queue.stats();
    assert.equal(stats.pending, 0);
    assert.equal(stats.executed, 3);
    assert.equal(stats.acknowledgedSteps, 2);
    assert.equal(stats.propellantBurns, 1);
    assert.equal(stats.resourceDeltas, 1);
    assert.ok(Array.isArray(stats.pendingActions));
    assert.equal(stats.pendingActions.length, 0);
    assert.ok(Array.isArray(stats.history));
    assert.equal(stats.history.length, 3);
    assert.equal(stats.history[0].status, 'success');

    assert.equal(propellantUpdates.length, 1);
    assert.deepEqual(propellantUpdates[0], {
      tankKey: 'csm_rcs_kg',
      amountKg: 1.25,
      metadata: {
        getSeconds: 12,
        source: 'propellant_burn_1',
        note: 'RCS trim',
      },
    });

    assert.equal(resourceEffects.length, 1);
    assert.deepEqual(resourceEffects[0], {
      effect: { power: { fuel_cell_load_kw: -0.3 } },
      metadata: {
        getSeconds: 15,
        source: 'resource_delta_2',
        type: 'manual',
        context: null,
      },
    });

    assert.equal(acknowledgedSteps.length, 2);
    assert.deepEqual(
      acknowledgedSteps.map((step) => step.stepNumber),
      [1, 2],
    );
  });

  test('executes panel control actions when panel state is provided', () => {
    const appliedControls = [];
    const panelState = {
      setControlState: (panelId, controlId, stateId, context) => {
        appliedControls.push({ panelId, controlId, stateId, context });
        if (panelId === 'PANEL_MAIN' && controlId === 'SWITCH_A') {
          return {
            success: true,
            changed: true,
            panelId,
            controlId,
            stateId,
            stateLabel: 'OPEN',
            previousStateId: 'CLOSED',
          };
        }
        return { success: false, reason: 'unknown_control' };
      },
    };

    const logger = createTestLogger();
    const queue = new ManualActionQueue(
      [
        {
          type: 'panel_control',
          id: 'PANEL_ACTION_1',
          panel_id: 'PANEL_MAIN',
          control_id: 'SWITCH_A',
          state_id: 'OPEN',
          get: 5,
          note: 'Flip switch',
        },
      ],
      { logger, panelState },
    );

    queue.update(5);

    assert.equal(appliedControls.length, 1);
    assert.deepEqual(appliedControls[0], {
      panelId: 'PANEL_MAIN',
      controlId: 'SWITCH_A',
      stateId: 'OPEN',
      context: {
        getSeconds: 5,
        actor: 'MANUAL_CREW',
        source: 'PANEL_ACTION_1',
        note: 'Flip switch',
      },
    });

    const history = queue.historySnapshot();
    assert.equal(history.length, 1);
    assert.deepEqual(history[0].details, {
      panelId: 'PANEL_MAIN',
      controlId: 'SWITCH_A',
      stateId: 'OPEN',
      stateLabel: 'OPEN',
      previousStateId: 'CLOSED',
      changed: true,
    });

    const stats = queue.stats();
    assert.equal(stats.panelControls, 1);
    assert.equal(stats.executed, 1);
    assert.ok(Array.isArray(stats.history));
    assert.equal(stats.history.length, 1);
    assert.equal(stats.history[0].details.stateLabel, 'OPEN');
  });
});
