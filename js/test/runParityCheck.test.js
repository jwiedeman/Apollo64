import test from 'node:test';
import assert from 'node:assert/strict';
import { runParityCheck } from '../src/tools/runParityCheck.js';
import { parseGET } from '../src/utils/time.js';

const ONE_HOUR_GET = parseGET('001:00:00');

test('runParityCheck produces parity between auto and manual runs', async () => {
  const { report, parity } = await runParityCheck({
    untilSeconds: ONE_HOUR_GET,
    quiet: true,
  });

  assert.ok(parity.passed, 'parity result should pass without diffs');
  assert.equal(report.auto.ticks, report.manual.ticks, 'tick counts should match');
  assert.equal(report.auto.finalGet, report.manual.finalGet, 'final GET should match');
  assert.ok(
    report.recorder.actionsGenerated > 0,
    'auto run should record at least one checklist action',
  );
  assert.equal(report.parity.logDiffs.length, 0, 'no log diffs should be reported');
  assert.ok(report.manual.manualActions, 'manual run should expose manual action stats');
});
