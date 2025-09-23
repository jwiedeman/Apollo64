import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import { mkdtemp, readFile } from 'fs/promises';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

describe('exportUiFrames CLI', () => {
  test('propagates PAD data into exported frames', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'apollo64-ui-'));
    const outputPath = path.join(tmpDir, 'frames.json');
    const scriptPath = fileURLToPath(new URL('../src/tools/exportUiFrames.js', import.meta.url));

    await execFileAsync(process.execPath, [
      scriptPath,
      '--quiet',
      '--start',
      '002:40:00',
      '--until',
      '002:46:00',
      '--interval',
      '60',
      '--max-frames',
      '3',
      '--output',
      outputPath,
    ]);

    const content = await readFile(outputPath, 'utf8');
    const data = JSON.parse(content);

    assert.ok(Array.isArray(data.frames) && data.frames.length > 0, 'Frames should be exported');

    const frameWithPad = data.frames.find(
      (frame) => Array.isArray(frame?.events?.upcoming)
        && frame.events.upcoming.some((event) => event?.pad?.id),
    );

    assert.ok(frameWithPad, 'Expected at least one frame to include PAD data for an upcoming event');

    const eventWithPad = frameWithPad.events.upcoming.find((event) => event?.pad?.id);
    assert.ok(eventWithPad.pad.parameters?.deltaVMetersPerSecond != null);
    assert.ok(eventWithPad.pad.parameters?.tig?.get);

    const frameWithMissionLog = data.frames.find((frame) => frame?.missionLog?.entries?.length > 0);
    assert.ok(frameWithMissionLog, 'Expected mission log entries in exported frames');
    assert.ok(Array.isArray(data.missionLog?.entries), 'Top-level mission log snapshot should be exported');

    assert.ok(Array.isArray(data.manualActions?.timeline?.checklist), 'Manual action checklist timeline should be present');
    assert.ok(
      data.manualActions?.timeline?.summary?.checklist?.total >= 0,
      'Manual action summary should include checklist totals',
    );
    assert.ok(Array.isArray(data.manualActions?.script?.actions), 'Manual action script should include actions array');
    assert.ok(Array.isArray(data.manualActions?.queueHistory), 'Manual action queue history should be exported');

    assert.ok(Array.isArray(data.audioCues), 'Audio cue ledger should be exported');
    assert.ok(data.audioCues.length > 0, 'Expected at least one audio cue in ledger export');

    assert.ok(data.workspace?.state, 'Workspace state should be exported');
    assert.ok(Array.isArray(data.workspace?.events?.entries), 'Workspace events should be included in export');
  });
});
