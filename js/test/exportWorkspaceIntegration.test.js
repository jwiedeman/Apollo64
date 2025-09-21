import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import { mkdtemp, readFile } from 'fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);

describe('exportWorkspace CLI', () => {
  test('serializes presets with overrides disabled history', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'apollo64-workspace-'));
    const outputPath = path.join(tmpDir, 'workspace.json');
    const scriptPath = fileURLToPath(new URL('../src/tools/exportWorkspace.js', import.meta.url));

    await execFileAsync(process.execPath, [
      scriptPath,
      '--quiet',
      '--output',
      outputPath,
      '--preset',
      'NAV_DEFAULT',
      '--override',
      'highContrast=true',
      '--no-history',
    ]);

    const content = await readFile(outputPath, 'utf8');
    const data = JSON.parse(content);

    assert.equal(data.metadata.includeHistory, false);
    assert.equal(data.workspace.activePresetId, 'NAV_DEFAULT');
    assert.equal(data.workspace.overrides.highContrast, true);
    assert.ok(!data.workspace.history, 'History should be omitted when --no-history provided');
  });
});
