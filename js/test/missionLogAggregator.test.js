import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { MissionLogger } from '../src/logging/missionLogger.js';
import { MissionLogAggregator } from '../src/logging/missionLogAggregator.js';

describe('MissionLogAggregator', () => {
  test('normalizes mission log entries with inferred categories', () => {
    const logger = new MissionLogger({ silent: true });
    const aggregator = new MissionLogAggregator(logger, { maxEntries: 20 });

    logger.log(10, 'Event EVT1 armed', { eventId: 'EVT1' });
    logger.log(20, 'Manual checklist override executed', {
      checklistId: 'CHK1',
      actor: 'CMP',
    });
    logger.log(30, 'Failure latched FAIL_COMMS', {
      failureId: 'FAIL_COMMS',
      severity: 'failure',
    });

    const snapshot = aggregator.snapshot();
    assert.equal(snapshot.totalCount, 3);
    assert.equal(snapshot.entries.length, 3);

    const [eventEntry, manualEntry, failureEntry] = snapshot.entries;
    assert.equal(eventEntry.category, 'event');
    assert.equal(eventEntry.source, 'sim');
    assert.equal(eventEntry.severity, 'info');
    assert.equal(manualEntry.category, 'manual');
    assert.equal(manualEntry.severity, 'info');
    assert.equal(failureEntry.category, 'system');
    assert.equal(failureEntry.severity, 'failure');
    assert.ok(failureEntry.timestampGet);
  });

  test('respects limit and produces count summaries', () => {
    const logger = new MissionLogger({ silent: true });
    const aggregator = new MissionLogAggregator(logger, { maxEntries: 5 });

    for (let i = 0; i < 8; i += 1) {
      logger.log(i * 5, `Autopilot burn sample ${i}`, { autopilotId: 'PGM_TEST' });
    }

    const snapshot = aggregator.snapshot({ limit: 3 });
    assert.equal(snapshot.totalCount, 5);
    assert.equal(snapshot.entries.length, 3);
    assert.equal(snapshot.filteredCount, 3);
    assert.equal(snapshot.categories.autopilot, 5);
    assert.equal(snapshot.filteredCategories.autopilot, 3);
  });
});
