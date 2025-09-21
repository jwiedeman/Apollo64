import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { ManualActionQueue } from '../src/sim/manualActionQueue.js';
import { MissionEventBus } from '../src/ui/missionEventBus.js';
import { MissionLogger } from '../src/logging/missionLogger.js';
import { ManualActionRecorder } from '../src/logging/manualActionRecorder.js';
import { UiManualActionDispatcher } from '../src/ui/uiManualActionDispatcher.js';

describe('UiManualActionDispatcher', () => {
  test('queues checklist acknowledgements and emits events', () => {
    let now = 120;
    const queue = new ManualActionQueue();
    const logger = new MissionLogger({ silent: true });
    const eventBus = new MissionEventBus();
    const recorder = new ManualActionRecorder({ includeAutoActionsOnly: false });
    const dispatcher = new UiManualActionDispatcher({
      manualActionQueue: queue,
      logger,
      eventBus,
      recorder,
      timeProvider: () => now,
      recordIntents: true,
    });

    const seen = [];
    eventBus.on('ui:manual', (event) => seen.push(event));

    now = 150;
    const event = dispatcher.dispatchChecklistAck({
      eventId: 'EVENT_A',
      count: 2,
      note: 'CMP advance',
      checklistId: 'CHECK_A',
      stepNumber: 4,
      retryWindowSeconds: 5,
      actor: 'CMP',
    });

    assert.ok(event);
    assert.equal(event.type, 'checklist_ack');
    assert.equal(event.actor, 'CMP');
    assert.equal(event.payload.eventId, 'EVENT_A');
    assert.equal(event.payload.count, 2);
    assert.equal(event.payload.checklistId, 'CHECK_A');
    assert.equal(event.timestampSeconds, 150);
    assert.equal(event.timestamp, '000:02:30');

    const queued = queue.queue.find((item) => item.id === event.id);
    assert.ok(queued);
    assert.equal(queued.type, 'checklist_ack');
    assert.equal(queued.eventId, 'EVENT_A');
    assert.equal(queued.count, 2);
    assert.equal(queued.actor, 'CMP');
    assert.equal(queued.retryUntilSeconds, 155);

    assert.equal(seen.length, 1);
    assert.equal(seen[0].id, event.id);
    assert.equal(dispatcher.getHistory().length, 1);

    const logEntry = logger
      .getEntries()
      .find((entry) => entry.context?.actionId === event.id && entry.context?.actionType === 'checklist_ack');
    assert.ok(logEntry);

    const recorderStats = recorder.stats();
    assert.equal(recorderStats.checklist.manual, 1);
  });

  test('queues DSKY entries with macro metadata', () => {
    let now = 200;
    const queue = new ManualActionQueue();
    const logger = new MissionLogger({ silent: true });
    const eventBus = new MissionEventBus();
    const recorder = new ManualActionRecorder({ includeAutoActionsOnly: false });
    const dispatcher = new UiManualActionDispatcher({
      manualActionQueue: queue,
      logger,
      eventBus,
      recorder,
      timeProvider: () => now,
      recordIntents: true,
    });

    const typedEvents = [];
    eventBus.on('ui:manual:dsky_entry', (event) => typedEvents.push(event));

    now = 245;
    const event = dispatcher.dispatchDskyEntry({
      macroId: 'V37N63',
      verb: 21,
      noun: 33,
      program: 'P63',
      registers: { r1: '00111', R2: 42 },
      sequence: ['VERB', '21', 'NOUN', '33'],
      note: 'EMS set',
      actor: 'CDR',
      eventId: 'EVENT_PAD',
      autopilotId: 'AUTO_TLI',
    });

    assert.ok(event);
    assert.equal(event.type, 'dsky_entry');
    assert.equal(event.actor, 'CDR');
    assert.equal(event.payload.macroId, 'V37N63');
    assert.equal(event.payload.verb, 21);
    assert.equal(event.payload.noun, 33);
    assert.equal(event.payload.program, 'P63');
    assert.deepEqual(event.payload.registers, { R1: '00111', R2: '42' });
    assert.deepEqual(event.payload.sequence, ['VERB', '21', 'NOUN', '33']);
    assert.equal(event.payload.eventId, 'EVENT_PAD');
    assert.equal(event.payload.autopilotId, 'AUTO_TLI');

    const queued = queue.queue.find((item) => item.id === event.id);
    assert.ok(queued);
    assert.equal(queued.macroId, 'V37N63');
    assert.equal(queued.verb, 21);
    assert.equal(queued.noun, 33);
    assert.equal(queued.program, 'P63');
    assert.deepEqual(queued.registers, { R1: '00111', R2: '42' });
    assert.deepEqual(queued.sequence, ['VERB', '21', 'NOUN', '33']);

    assert.equal(typedEvents.length, 1);
    assert.equal(typedEvents[0].id, event.id);

    const recorderStats = recorder.stats();
    assert.equal(recorderStats.dsky.manual, 1);
  });

  test('queues resource and propellant actions and respects history limits', () => {
    let now = 0;
    const queue = new ManualActionQueue();
    const dispatcher = new UiManualActionDispatcher({
      manualActionQueue: queue,
      timeProvider: () => now,
      historyLimit: 2,
    });

    now = 10;
    const resourceEvent = dispatcher.dispatch({
      type: 'resource_delta',
      effect: { power: { csm_fuel_cell: -0.3 } },
      note: 'Load shed',
    });
    assert.ok(resourceEvent);
    assert.equal(resourceEvent.type, 'resource_delta');
    assert.deepEqual(queue.queue[0].effect, { power: { csm_fuel_cell: -0.3 } });

    now = 20;
    const propellantEvent = dispatcher.dispatch({
      type: 'propellant_burn',
      tank: 'csm_rcs',
      amountKg: 0.5,
    });
    assert.ok(propellantEvent);
    assert.equal(propellantEvent.type, 'propellant_burn');
    assert.equal(queue.queue[1].tankKey, 'csm_rcs_kg');
    assert.equal(queue.queue[1].amountKg, 0.5);

    now = 30;
    dispatcher.dispatchPropellantBurn({ tank: 'lm_rcs', amountLb: 1 });

    const history = dispatcher.getHistory();
    assert.equal(history.length, 2);
    assert.equal(history[0].type, 'propellant_burn');
    assert.equal(history[1].type, 'propellant_burn');
  });

  test('throws when queue is missing or required fields absent', () => {
    const dispatcher = new UiManualActionDispatcher();
    assert.throws(() => dispatcher.dispatchChecklistAck({ eventId: 'MISSING_QUEUE' }), /Manual action queue is not configured/);

    const queue = new ManualActionQueue();
    const configured = new UiManualActionDispatcher({ manualActionQueue: queue });
    assert.throws(() => configured.dispatchChecklistAck({}), /requires an eventId/);
    assert.throws(() => configured.dispatchPropellantBurn({ tank: 'csm_rcs' }), /numeric amount/);
    assert.throws(() => configured.dispatchDskyEntry({ verb: 16 }), /requires a macroId or both verb and noun/);
  });
});
