import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { ReplayStore } from '../src/ui/replayStore.js';

function createSampleBundle() {
  return {
    metadata: { export: 'demo' },
    summary: { ticks: 100 },
    frames: [
      { generatedAtSeconds: 0, time: { getSeconds: 0 } },
      { generatedAtSeconds: 10, time: { getSeconds: 10 } },
      { generatedAtSeconds: 20, time: { getSeconds: 20 } },
      { generatedAtSeconds: 35, time: { getSeconds: 35 } },
    ],
    missionLog: {
      entries: [
        { id: 'log-start', timestampSeconds: 0, category: 'system', severity: 'info', message: 'Start' },
        { id: 'log-event', timestampSeconds: 15, category: 'event', severity: 'notice', message: 'Event armed' },
        { id: 'log-warning', timestampSeconds: 32, category: 'resource', severity: 'warning', message: 'Power low' },
      ],
    },
    manualActions: {
      actions: [
        { id: 'ack-1', type: 'checklist_ack', get_seconds: 12, actor: 'MANUAL_CREW' },
        { id: 'ack-2', type: 'checklist_ack', get_seconds: 18, actor: 'AUTO_CREW' },
        { id: 'ack-3', type: 'dsky_entry', get_seconds: 40, actor: 'MANUAL_CREW' },
      ],
    },
    audioCues: [
      { id: 'cue-alert', cueId: 'MASTER_ALARM', getSeconds: 14, category: 'alert' },
      { id: 'cue-callout', cueId: 'PAD_DELIVERY', getSeconds: 22, category: 'callout' },
    ],
  };
}

describe('ReplayStore', () => {
  test('loads bundle data and seeks to nearest frame', () => {
    const store = new ReplayStore();
    const info = store.loadBundle(createSampleBundle());

    assert.equal(info.frameCount, 4);
    assert.equal(info.logCount, 3);
    assert.equal(info.manualCount, 3);
    assert.equal(info.audioCount, 2);

    const current = store.getCurrentFrame();
    assert.ok(current);
    assert.equal(current.generatedAtSeconds, 0);

    const changed = store.seekToTime(16);
    assert.equal(changed, true);
    const afterSeek = store.getCurrentFrame();
    assert.ok(afterSeek);
    assert.equal(afterSeek.generatedAtSeconds, 10);
    assert.ok(Math.abs(store.getCurrentTime() - 16) < 1e-6);

    const range = store.getFrameRange();
    assert.deepEqual(range, { start: 0, end: 35 });
  });

  test('advances playback and steps between frames', () => {
    const store = new ReplayStore();
    store.loadBundle(createSampleBundle());

    store.setPlaybackState({ playing: true, speed: 1 });
    store.update(11);
    let frame = store.getCurrentFrame();
    assert.equal(frame.generatedAtSeconds, 10);

    store.update(15);
    frame = store.getCurrentFrame();
    assert.equal(frame.generatedAtSeconds, 20);

    store.step(1);
    frame = store.getCurrentFrame();
    assert.equal(frame.generatedAtSeconds, 35);

    store.step(-2);
    frame = store.getCurrentFrame();
    assert.equal(frame.generatedAtSeconds, 10);
  });

  test('reports manual action stats and upcoming annotations', () => {
    const store = new ReplayStore();
    store.loadBundle(createSampleBundle());

    store.seekToTime(10);

    const manualFraction = store.getManualFraction();
    assert.ok(manualFraction != null);
    assert.ok(Math.abs(manualFraction - (2 / 3)) < 1e-6);

    const stats = store.getManualActionStats();
    assert.deepEqual(stats, { manual: 2, auto: 1, unknown: 0 });

    const upcoming = store.getUpcomingAnnotations({ fromTime: 10, limit: 5 });
    assert.equal(upcoming.length, 5);
    assert.deepEqual(
      upcoming.map((entry) => [entry.type, entry.id]),
      [
        ['manual', 'ack-1'],
        ['audio', 'cue-alert'],
        ['log', 'log-event'],
        ['manual', 'ack-2'],
        ['audio', 'cue-callout'],
      ],
    );

    const range = store.getAnnotationsInRange(10, 25);
    assert.deepEqual(
      range.map((entry) => [entry.type, entry.id]),
      [
        ['manual', 'ack-1'],
        ['audio', 'cue-alert'],
        ['log', 'log-event'],
        ['manual', 'ack-2'],
        ['audio', 'cue-callout'],
      ],
    );
  });

  test('handles listeners and metadata access', () => {
    const store = new ReplayStore();
    store.loadBundle(createSampleBundle());

    let notified = 0;
    const unsubscribe = store.onChange(() => {
      notified += 1;
    });

    store.seekToTime(18);
    assert.ok(notified > 0);

    unsubscribe();
    const before = notified;
    store.seekToTime(20);
    assert.equal(notified, before);

    const meta = store.getMetadata();
    const summary = store.getSummary();
    assert.equal(meta.export, 'demo');
    assert.equal(summary.ticks, 100);

    const logSummary = store.getMissionLogSummary();
    assert.ok(Array.isArray(logSummary.entries));
    assert.equal(logSummary.entries.length, 3);
  });
});

