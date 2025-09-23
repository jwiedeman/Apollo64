import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { analyzeAudioLedger, DEFAULT_SEVERITY_WEIGHTS } from '../src/tools/audioValidation.js';

const TEST_CATALOG = {
  buses: [
    { id: 'alerts', maxConcurrent: 1 },
    { id: 'dialogue', maxConcurrent: 1 },
    { id: 'ambience', maxConcurrent: 2 },
  ],
  categories: [
    { id: 'alert', bus: 'alerts', cooldownSeconds: 2 },
    { id: 'callout', bus: 'dialogue', defaultPriority: 70 },
    { id: 'ambient', bus: 'ambience', defaultPriority: 10 },
  ],
  cues: [
    { id: 'alerts.master_alarm', category: 'alert', priority: 0, cooldownSeconds: 2 },
    { id: 'callouts.go', category: 'callout', priority: 70 },
    { id: 'ambient.cabin', category: 'ambient', priority: 10 },
  ],
};

describe('analyzeAudioLedger', () => {
  test('detects bus concurrency and cooldown violations', () => {
    const ledger = [
      {
        id: 1,
        cueId: 'alerts.master_alarm',
        categoryId: 'alert',
        busId: 'alerts',
        severity: 'failure',
        priority: DEFAULT_SEVERITY_WEIGHTS.failure,
        startedAtSeconds: 10,
        endedAtSeconds: 15,
        status: 'completed',
      },
      {
        id: 2,
        cueId: 'alerts.master_alarm',
        categoryId: 'alert',
        busId: 'alerts',
        severity: 'failure',
        priority: DEFAULT_SEVERITY_WEIGHTS.failure,
        startedAtSeconds: 11,
        endedAtSeconds: 12,
        status: 'completed',
      },
    ];

    const analysis = analyzeAudioLedger(ledger, TEST_CATALOG);

    assert.equal(analysis.concurrency.violations.length, 1);
    assert.equal(analysis.concurrency.violations[0].busId, 'alerts');
    assert.equal(analysis.concurrency.violations[0].observed > 1, true);
    assert.equal(analysis.cooldownViolations.length, 2);
    assert.deepEqual(
      analysis.cooldownViolations.map((violation) => violation.type),
      ['cue', 'category'],
    );
    assert.equal(analysis.isHealthy, false);
  });

  test('flags priority mismatches when playback priority deviates from catalog expectations', () => {
    const ledger = [
      {
        id: 3,
        cueId: 'callouts.go',
        categoryId: 'callout',
        busId: 'dialogue',
        severity: 'notice',
        priority: 20,
        startedAtSeconds: 30,
        endedAtSeconds: 33,
        status: 'completed',
      },
    ];

    const analysis = analyzeAudioLedger(ledger, TEST_CATALOG);

    assert.equal(analysis.priorityMismatches.length, 1);
    assert.equal(analysis.priorityMismatches[0].cueId, 'callouts.go');
    assert.notEqual(Math.abs(analysis.priorityMismatches[0].delta) <= 1e-3, true);
    assert.equal(analysis.isHealthy, false);
  });

  test('summarizes ledger stats when entries satisfy catalog rules', () => {
    const ledger = [
      {
        id: 'ambient-1',
        cueId: 'ambient.cabin',
        categoryId: 'ambient',
        busId: 'ambience',
        severity: 'info',
        priority: 10,
        startedAtSeconds: 0,
        endedAtSeconds: 60,
        status: 'completed',
      },
      {
        id: 'callout-1',
        cueId: 'callouts.go',
        categoryId: 'callout',
        busId: 'dialogue',
        severity: 'notice',
        priority: 75,
        startedAtSeconds: 90,
        endedAtSeconds: 93,
        status: 'completed',
      },
    ];

    const analysis = analyzeAudioLedger(ledger, TEST_CATALOG);

    assert.equal(analysis.isHealthy, true);
    assert.equal(analysis.concurrency.violations.length, 0);
    assert.equal(analysis.cooldownViolations.length, 0);
    assert.equal(analysis.priorityMismatches.length, 0);

    const dialogueSummary = analysis.concurrency.byBus.find((entry) => entry.busId === 'dialogue');
    assert.ok(dialogueSummary);
    assert.equal(dialogueSummary.maxObserved, 1);

    const severityCounts = analysis.counts.bySeverity.reduce((map, entry) => ({
      ...map,
      [entry.severity]: entry.count,
    }), {});
    assert.equal(severityCounts.info, 1);
    assert.equal(severityCounts.notice, 1);
    assert.equal(analysis.timeline.earliestStart, '000:00:00');
  });
});

