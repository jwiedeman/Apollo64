import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { AudioCueBinder } from '../src/audio/audioCueBinder.js';

const TEST_CATALOG = {
  version: 1,
  buses: [
    { id: 'alerts', name: 'Alerts' },
    { id: 'dialogue', name: 'Dialogue' },
    { id: 'telemetry', name: 'Telemetry' },
    { id: 'ui', name: 'UI' },
  ],
  categories: [
    { id: 'alert', name: 'Alerts', bus: 'alerts', defaultPriority: 95 },
    { id: 'callout', name: 'Callouts', bus: 'dialogue', defaultPriority: 70 },
    { id: 'telemetry', name: 'Telemetry', bus: 'telemetry', defaultPriority: 50 },
    { id: 'ui', name: 'UI Feedback', bus: 'ui', defaultPriority: 30 },
  ],
  cues: [
    { id: 'alerts.master_alarm', name: 'Master Alarm', category: 'alert', priority: 100, lengthSeconds: 2.1 },
    { id: 'callout.go_for_tli', name: 'Go for TLI', category: 'callout', lengthSeconds: 3.5 },
    { id: 'telemetry.ptc_entry', name: 'PTC Entry', category: 'telemetry', lengthSeconds: 1.0 },
    { id: 'ui.checklist_tick', name: 'Checklist Tick', category: 'ui', lengthSeconds: 0.3 },
  ],
};

describe('AudioCueBinder', () => {
  test('records event triggers with resolved bus and metadata', () => {
    const binder = new AudioCueBinder(TEST_CATALOG);

    const trigger = binder.recordEvent(
      {
        id: 'TLI_001',
        audioCueId: 'callout.go_for_tli',
        audioChannel: 'dialogue',
        phase: 'Launch',
      },
      { getSeconds: 1000, status: 'active' },
    );

    assert.ok(trigger);
    assert.equal(trigger.cueId, 'callout.go_for_tli');
    assert.equal(trigger.busId, 'dialogue');
    assert.equal(trigger.metadata.eventId, 'TLI_001');
    assert.equal(trigger.metadata.phase, 'Launch');
    assert.equal(trigger.metadata.status, 'active');
    assert.equal(trigger.cue.priority, 70);
    assert.equal(binder.peekPending().length, 1);
  });

  test('records checklist completions with actor metadata and drains queue', () => {
    const binder = new AudioCueBinder(TEST_CATALOG);

    binder.recordChecklistStep(
      { id: 'CL_01', title: 'Test Checklist', crewRole: 'CDR', eventId: 'EVT_1' },
      { stepNumber: 3, action: 'Latch', expectedResponse: 'Locked', audioCueComplete: 'ui.checklist_tick' },
      { getSeconds: 2000, actor: 'CREW' },
    );

    const pending = binder.drainPending();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].cueId, 'ui.checklist_tick');
    assert.equal(pending[0].metadata.stepNumber, 3);
    assert.equal(pending[0].metadata.actor, 'CREW');
    assert.equal(binder.peekPending().length, 0);
  });

  test('records failure triggers once and prefers failure cue over warning', () => {
    const binder = new AudioCueBinder(TEST_CATALOG);

    const trigger = binder.recordFailure(
      {
        id: 'FAIL_TEST',
        classification: 'Hard',
        audioCueWarning: 'telemetry.ptc_entry',
        audioCueFailure: 'alerts.master_alarm',
        occurrences: 1,
        note: 'Test failure',
        source: 'EVT',
      },
      { getSeconds: 3000, severity: 'failure', isNew: true },
    );

    assert.ok(trigger);
    assert.equal(trigger.cueId, 'alerts.master_alarm');
    assert.equal(trigger.severity, 'failure');
    assert.equal(trigger.metadata.classification, 'Hard');

    const repeat = binder.recordFailure(
      {
        id: 'FAIL_TEST',
        classification: 'Hard',
        audioCueWarning: 'telemetry.ptc_entry',
        audioCueFailure: 'alerts.master_alarm',
        occurrences: 2,
      },
      { getSeconds: 3020 },
    );

    assert.equal(repeat, null);
  });

  test('records communications acquire and loss cues with channel hints', () => {
    const binder = new AudioCueBinder(TEST_CATALOG);

    binder.recordCommunications(
      {
        id: 'PASS_A',
        station: 'DSS-14',
        cueOnAcquire: 'telemetry.ptc_entry',
        cueChannelOnAcquire: 'telemetry',
      },
      { getSeconds: 4000, type: 'acquire' },
    );

    binder.recordCommunications(
      {
        id: 'PASS_A',
        station: 'DSS-14',
        cueOnLoss: 'telemetry.ptc_entry',
        cueChannelOnLoss: 'telemetry',
      },
      { getSeconds: 4200, type: 'loss' },
    );

    const pending = binder.drainPending();
    assert.equal(pending.length, 2);
    assert.equal(pending[0].metadata.type, 'acquire');
    assert.equal(pending[1].metadata.type, 'loss');
    assert.equal(pending[0].busId, 'telemetry');
  });
});
