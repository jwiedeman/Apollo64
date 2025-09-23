import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { PerformanceTracker } from '../src/sim/performanceTracker.js';
import { MissionLogger } from '../src/logging/missionLogger.js';

describe('PerformanceTracker', () => {
  test('aggregates tick, hud, audio, and input metrics', () => {
    const tracker = new PerformanceTracker({ tickRate: 20 });

    tracker.recordTick(52, { getSeconds: 10 });
    tracker.recordTick(48, { getSeconds: 11 });
    tracker.recordHudRender({ durationMs: 6.4, getSeconds: 600, scheduledGetSeconds: 600, dropped: 0 });
    tracker.recordHudRender({ durationMs: 5.8, getSeconds: 1210, scheduledGetSeconds: 1200, dropped: 1 });
    tracker.recordAudioStats({ activeBuses: { alerts: 1, voice: 1 }, queuedBuses: { alerts: 2 } }, { getSeconds: 12 });
    tracker.recordInputLatency(42, { getSeconds: 13 });

    const snapshot = tracker.snapshot();
    assert.ok(snapshot, 'expected a performance snapshot');
    assert.equal(snapshot.tick.count, 2);
    assert.ok(snapshot.tick.averageMs != null, 'tick average should be recorded');
    assert.equal(snapshot.hud.renderCount, 2);
    assert.equal(snapshot.hud.drop.total, 1);
    assert.equal(snapshot.audio.lastActiveTotal, 2);
    assert.equal(snapshot.audio.maxQueuedTotal, 2);
    assert.equal(snapshot.input.count, 1);
    assert.equal(snapshot.input.lastLatencyMs, 42);
    assert.ok(snapshot.overview.tickAvgMs != null, 'overview should include tick average');
  });

  test('logs performance snapshots on interval and flush', () => {
    const logger = new MissionLogger({ silent: true });
    const tracker = new PerformanceTracker({ logger, tickRate: 20, logIntervalSeconds: 60 });

    tracker.recordTick(50, { getSeconds: 0 });
    tracker.maybeLog(0);
    tracker.recordTick(51, { getSeconds: 61 });
    tracker.maybeLog(61);
    tracker.flush(120);

    const entries = logger.getEntries((entry) => entry.context?.logCategory === 'performance');
    assert.ok(entries.length >= 2, 'expected performance log entries to be recorded');
    for (const entry of entries) {
      assert.equal(entry.context.logSource, 'ui');
      assert.equal(entry.context.logCategory, 'performance');
      assert.ok(entry.context.snapshot, 'performance entry should include snapshot payload');
    }
  });
});

