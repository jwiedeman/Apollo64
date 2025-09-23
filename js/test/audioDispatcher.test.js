import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { AudioCueBinder } from '../src/audio/audioCueBinder.js';
import { AudioDispatcher, NullAudioMixer } from '../src/audio/audioDispatcher.js';
import { ManualActionRecorder } from '../src/logging/manualActionRecorder.js';

const TEST_CATALOG = {
  version: 1,
  buses: [
    { id: 'alerts', maxConcurrent: 1, ducking: [{ target: 'ambience', gainDb: -12 }] },
    { id: 'dialogue', maxConcurrent: 1 },
    { id: 'ambience', maxConcurrent: 1 },
  ],
  categories: [
    { id: 'alert', bus: 'alerts', defaultPriority: 95, cooldownSeconds: 1 },
    { id: 'callout', bus: 'dialogue', defaultPriority: 70, cooldownSeconds: 0.5 },
    { id: 'ambient', bus: 'ambience', defaultPriority: 10 },
  ],
  cues: [
    { id: 'alerts.master_alarm', category: 'alert', priority: 100, lengthSeconds: 2.0 },
    { id: 'callouts.go', category: 'callout', lengthSeconds: 3.0 },
    { id: 'ambient.cabin', category: 'ambient', lengthSeconds: 60.0, loop: true },
  ],
};

describe('AudioDispatcher', () => {
  test('plays cues drained from binder and updates mixer', () => {
    const binder = new AudioCueBinder(TEST_CATALOG);
    const mixer = new NullAudioMixer();
    const dispatcher = new AudioDispatcher(TEST_CATALOG, mixer, { binder });

    binder.recordEvent(
      {
        id: 'EVT_1',
        audioCueId: 'callouts.go',
        phase: 'Launch',
      },
      { getSeconds: 120, status: 'active' },
    );

    dispatcher.update(120);

    assert.equal(mixer.playCalls.length, 1);
    const playCall = mixer.playCalls[0];
    assert.equal(playCall.cue.id, 'callouts.go');
    assert.equal(playCall.options.busId, 'dialogue');

    const stats = dispatcher.statsSnapshot();
    assert.equal(stats.played, 1);
    assert.equal(stats.activeBuses.dialogue, 1);
    assert.equal(stats.queuedBuses.dialogue, 0);
  });

  test('suppresses cues during cooldown windows', () => {
    const binder = new AudioCueBinder(TEST_CATALOG);
    const mixer = new NullAudioMixer();
    const dispatcher = new AudioDispatcher(TEST_CATALOG, mixer, { binder });

    binder.recordEvent({ id: 'EVT_ALERT', audioCueId: 'alerts.master_alarm' }, { getSeconds: 10 });
    dispatcher.update(10);
    assert.equal(mixer.playCalls.length, 1);

    binder.recordEvent({ id: 'EVT_ALERT_2', audioCueId: 'alerts.master_alarm' }, { getSeconds: 10.5 });
    dispatcher.update(10.5);

    assert.equal(mixer.playCalls.length, 1, 'second alert suppressed by cooldown');
    const stats = dispatcher.statsSnapshot();
    assert.ok(stats.suppressed > 0, `expected suppressed count > 0, received ${stats.suppressed}`);
  });

  test('preempts lower priority playback when bus saturated', () => {
    const binder = new AudioCueBinder(TEST_CATALOG);
    const mixer = new NullAudioMixer();
    const dispatcher = new AudioDispatcher(TEST_CATALOG, mixer, { binder });

    // Start ambient loop
    binder.recordEvent({ id: 'EVT_AMBIENT', audioCueId: 'ambient.cabin' }, { getSeconds: 0 });
    dispatcher.update(0);
    assert.equal(mixer.playCalls.length, 1);
    assert.equal(dispatcher.getBusState('ambience').active.length, 1);

    // Trigger alert that should duck ambience
    binder.recordEvent({ id: 'EVT_ALERT', audioCueId: 'alerts.master_alarm' }, { getSeconds: 5 });
    dispatcher.update(5);

    assert.equal(mixer.playCalls.length, 2);
    const gains = mixer.gainChanges.filter((change) => change.busId === 'ambience');
    assert.ok(gains.length > 0, 'ambience bus gain adjusted by ducking');
  });

  test('queues second dialogue cue until first completes', () => {
    const binder = new AudioCueBinder(TEST_CATALOG);
    const mixer = new NullAudioMixer();
    const dispatcher = new AudioDispatcher(TEST_CATALOG, mixer, { binder });

    binder.recordEvent({ id: 'EVT_1', audioCueId: 'callouts.go' }, { getSeconds: 0 });
    dispatcher.update(0);
    assert.equal(mixer.playCalls.length, 1);

    binder.recordEvent({ id: 'EVT_2', audioCueId: 'callouts.go' }, { getSeconds: 1 });
    dispatcher.update(1);

    assert.equal(dispatcher.getBusState('dialogue').queue.length > 0, true);

    // Advance beyond length to clear first cue
    dispatcher.update(10);

    assert.equal(mixer.playCalls.length, 2, 'queued cue eventually played');
  });

  test('records playback ledger entries with start and stop metadata', () => {
    const binder = new AudioCueBinder(TEST_CATALOG);
    const mixer = new NullAudioMixer();
    const dispatcher = new AudioDispatcher(TEST_CATALOG, mixer, { binder });

    binder.recordEvent(
      { id: 'EVT_LEDGER', audioCueId: 'callouts.go', audioChannel: 'dialogue' },
      { getSeconds: 12, status: 'active', severity: 'notice' },
    );

    dispatcher.update(12);

    let ledger = dispatcher.ledgerSnapshot();
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].cueId, 'callouts.go');
    assert.equal(ledger[0].sourceType, 'event');
    assert.equal(ledger[0].status, 'playing');
    assert.equal(ledger[0].startedAtSeconds, 12);

    dispatcher.stopAll('export_complete', 15);

    ledger = dispatcher.ledgerSnapshot();
    assert.equal(ledger[0].status, 'stopped');
    assert.equal(ledger[0].stopReason, 'export_complete');
    assert.equal(ledger[0].endedAtSeconds, 15);
    assert.ok(ledger[0].durationSeconds > 0);
  });

  test('notifies manual action recorder about playback lifecycle', () => {
    const binder = new AudioCueBinder(TEST_CATALOG);
    const mixer = new NullAudioMixer();
    const recorder = new ManualActionRecorder();
    const dispatcher = new AudioDispatcher(TEST_CATALOG, mixer, { binder, recorder });

    binder.recordEvent({ id: 'EVT_REC', audioCueId: 'callouts.go' }, { getSeconds: 20, status: 'active' });

    dispatcher.update(20);

    const snapshot = recorder.audioSnapshot();
    assert.equal(snapshot.total, 1);
    assert.equal(snapshot.entries[0].cueId, 'callouts.go');
    assert.equal(snapshot.entries[0].status, 'playing');

    dispatcher.stopAll('test_stop', 24);

    const finalSnapshot = recorder.audioSnapshot();
    assert.equal(finalSnapshot.entries[0].status, 'stopped');
    assert.equal(finalSnapshot.entries[0].stopReason, 'test_stop');
    assert.equal(finalSnapshot.entries[0].endedAtSeconds, 24);
  });
});
