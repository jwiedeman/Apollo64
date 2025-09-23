import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { EventScheduler } from '../src/sim/eventScheduler.js';
import { ResourceSystem } from '../src/sim/resourceSystem.js';
import { createTestLogger } from './testUtils.js';

describe('EventScheduler failure cascades', () => {
  it('applies cascade resource effects and arms follow-up events', () => {
    const logger = createTestLogger();
    const resourceSystem = new ResourceSystem(logger);
    const failureCascades = new Map([
      ['FAIL_TEST', {
        id: 'FAIL_TEST',
        resourceEffects: { power_margin_pct: -5 },
        repeatable: false,
        applyOnce: false,
        armEvents: [
          {
            eventId: 'RECOVERY_EVENT',
            allowBeforeWindow: true,
            autoActivate: false,
            offsetSeconds: 0,
            logMessage: 'Cascade armed recovery event',
          },
        ],
        log: { message: 'Cascade applied', severity: 'warning' },
        tags: [],
        notes: null,
        metadata: null,
      }],
    ]);

    const events = [
      {
        id: 'FAIL_EVENT',
        phase: 'Test',
        getOpenSeconds: 0,
        getCloseSeconds: 5,
        prerequisites: [],
        autopilotId: null,
        checklistId: null,
        padId: null,
        successEffects: {},
        failureEffects: { failure_id: 'FAIL_TEST' },
      },
      {
        id: 'RECOVERY_EVENT',
        phase: 'Test',
        getOpenSeconds: 20,
        getCloseSeconds: 30,
        prerequisites: [],
        autopilotId: null,
        checklistId: null,
        padId: null,
        successEffects: {},
        failureEffects: {},
      },
    ];

    const scheduler = new EventScheduler(events, new Map(), resourceSystem, logger, {
      failureCascades,
    });

    scheduler.update(0, 1);
    scheduler.update(6, 1);

    const failEvent = scheduler.getEventById('FAIL_EVENT');
    assert.equal(failEvent.status, 'failed');
    const recoveryEvent = scheduler.getEventById('RECOVERY_EVENT');
    assert.ok(['armed', 'active'].includes(recoveryEvent.status));
    assert.ok(Array.isArray(recoveryEvent.cascadeTriggers));
    assert.equal(recoveryEvent.cascadeTriggers.length, 1);

    const snapshot = resourceSystem.snapshot();
    assert.equal(snapshot.power_margin_pct, 95);

    assert.ok(
      logger.entries.some((entry) => entry.message.includes('Cascade applied')),
      'expected cascade log entry',
    );
  });

  it('skips repeated application when cascade is not repeatable', () => {
    const logger = createTestLogger();
    const resourceSystem = new ResourceSystem(logger);
    const failureCascades = new Map([
      ['FAIL_REPEAT', {
        id: 'FAIL_REPEAT',
        resourceEffects: { power_margin_pct: -2 },
        repeatable: false,
        applyOnce: false,
        armEvents: [],
        log: null,
        tags: [],
        notes: null,
        metadata: null,
      }],
    ]);

    const events = [
      {
        id: 'EVENT_ONE',
        phase: 'Test',
        getOpenSeconds: 0,
        getCloseSeconds: 5,
        prerequisites: [],
        successEffects: {},
        failureEffects: { failure_id: 'FAIL_REPEAT' },
      },
      {
        id: 'EVENT_TWO',
        phase: 'Test',
        getOpenSeconds: 10,
        getCloseSeconds: 15,
        prerequisites: [],
        successEffects: {},
        failureEffects: { failure_id: 'FAIL_REPEAT' },
      },
    ];

    const scheduler = new EventScheduler(events, new Map(), resourceSystem, logger, {
      failureCascades,
    });

    scheduler.update(0, 1);
    scheduler.update(6, 1);
    scheduler.update(16, 1);
    scheduler.update(17, 1);

    const snapshot = resourceSystem.snapshot();
    assert.equal(snapshot.power_margin_pct, 98);
  });

  it('allows repeatable cascades to stack when enabled', () => {
    const logger = createTestLogger();
    const resourceSystem = new ResourceSystem(logger);
    const failureCascades = new Map([
      ['FAIL_REPEAT', {
        id: 'FAIL_REPEAT',
        resourceEffects: { power_margin_pct: -1 },
        repeatable: true,
        applyOnce: false,
        armEvents: [],
        log: null,
        tags: [],
        notes: null,
        metadata: null,
      }],
    ]);

    const events = [
      {
        id: 'EVENT_A',
        phase: 'Test',
        getOpenSeconds: 0,
        getCloseSeconds: 5,
        prerequisites: [],
        successEffects: {},
        failureEffects: { failure_id: 'FAIL_REPEAT' },
      },
      {
        id: 'EVENT_B',
        phase: 'Test',
        getOpenSeconds: 10,
        getCloseSeconds: 15,
        prerequisites: [],
        successEffects: {},
        failureEffects: { failure_id: 'FAIL_REPEAT' },
      },
    ];

    const scheduler = new EventScheduler(events, new Map(), resourceSystem, logger, {
      failureCascades,
    });

    scheduler.update(0, 1);
    scheduler.update(6, 1);
    scheduler.update(16, 1);
    scheduler.update(17, 1);

    const snapshot = resourceSystem.snapshot();
    assert.equal(snapshot.power_margin_pct, 98);
  });
});
