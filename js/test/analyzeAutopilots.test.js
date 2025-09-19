import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeAutopilotRuns } from '../src/tools/analyzeAutopilots.js';
import { parseGET } from '../src/utils/time.js';

const SHORT_RUN_GET = parseGET('003:30:00');

test('analyzeAutopilotRuns captures TLI burn metrics', async () => {
  const report = await analyzeAutopilotRuns({
    untilSeconds: SHORT_RUN_GET,
    quiet: true,
  });

  assert.ok(Array.isArray(report.runs), 'report runs should be an array');
  const tli = report.runs.find((run) => run.eventId === 'TLI_002');
  assert.ok(tli, 'expected TLI_002 event to appear in analysis');
  assert.equal(tli.autopilotId, 'PGM_06_TLI');
  assert.equal(tli.eventStatus, 'complete');
  assert.equal(tli.autopilotStatus, 'complete');
  assert.ok(tli.metrics, 'metrics should be captured');
  assert.ok(tli.expected?.burnSeconds > 0, 'expected burnSeconds should be positive');
  assert.equal(tli.autopilotReason, 'duration_complete');
  assert.equal(tli.padId, 'PAD_TLI_002');
});

test('analyzeAutopilotRuns filters by autopilot id', async () => {
  const report = await analyzeAutopilotRuns({
    untilSeconds: SHORT_RUN_GET,
    quiet: true,
    autopilotIds: ['PGM_06_TLI'],
  });

  assert.ok(report.runs.length > 0, 'filtered report should include at least one run');
  for (const run of report.runs) {
    assert.equal(run.autopilotId, 'PGM_06_TLI');
  }
});
