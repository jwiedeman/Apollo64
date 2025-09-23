import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePerformance, evaluatePerformanceSnapshot } from '../src/tools/analyzePerformance.js';
import { parseGET } from '../src/utils/time.js';

const SHORT_RUN_GET = parseGET('002:00:00');

test('analyzePerformance collects performance metrics and logs', async () => {
  const report = await analyzePerformance({
    untilSeconds: SHORT_RUN_GET,
    quiet: true,
  });

  assert.ok(report.performance, 'performance snapshot should be present');
  assert.ok(report.evaluation, 'evaluation results should be present');
  assert.ok(Array.isArray(report.evaluation.alerts), 'evaluation should expose alerts array');
  assert.ok(Array.isArray(report.logs?.entries), 'log entries should be captured');
  assert.ok(report.logs.entries.length > 0, 'at least one performance log entry should exist');
});

test('evaluatePerformanceSnapshot flags warnings for exceeded thresholds', () => {
  const snapshot = {
    tick: {
      averageMs: 60,
      drift: { maxAbsMs: 3.2 },
    },
    hud: {
      renderMs: { average: 50, max: 70 },
      drop: { maxConsecutive: 4, total: 5 },
    },
    audio: { maxQueuedTotal: 2 },
    input: { maxLatencyMs: 150, averageLatencyMs: 90 },
  };

  const evaluation = evaluatePerformanceSnapshot(snapshot);
  assert.ok(evaluation.alerts.length > 0, 'threshold breaches should produce alerts');
  assert.ok(
    evaluation.alerts.some((alert) => alert.id === 'hudRenderMaxMs' && alert.severity === 'warning'),
    'HUD render max should trigger a warning',
  );
  assert.ok(!evaluation.passed, 'warnings should mark the evaluation as not passed');
});
