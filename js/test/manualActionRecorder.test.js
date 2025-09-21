import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { ManualActionRecorder } from '../src/logging/manualActionRecorder.js';

describe('ManualActionRecorder workspace integration', () => {
  test('records workspace events and exposes them in stats and exports', () => {
    const recorder = new ManualActionRecorder();

    recorder.recordWorkspaceEvent({
      type: 'tile.mutate',
      getSeconds: 120,
      presetId: 'NAV_DEFAULT',
      view: 'navigation',
      tileId: 'navball',
      mutation: { x: 0.62, width: 0.35 },
      quantized: { x: 0.625, width: 0.35 },
      pointer: 'mouse',
      source: 'cli',
    });

    const stats = recorder.stats();
    assert.equal(stats.workspace.total, 1);
    assert.equal(stats.workspace.byType.length, 1);
    assert.equal(stats.workspace.byType[0].type, 'tile.mutate');

    const snapshot = recorder.workspaceSnapshot();
    assert.equal(snapshot.total, 1);
    assert.equal(snapshot.entries[0].tileId, 'navball');
    assert.equal(snapshot.entries[0].presetId, 'NAV_DEFAULT');
    assert.equal(snapshot.entries[0].mutation.x, 0.62);
    assert.ok(snapshot.entries[0].quantized);

    const payload = recorder.toJSON();
    assert.equal(payload.metadata.workspace_events_recorded, 1);
    assert.ok(Array.isArray(payload.workspace));
    assert.equal(payload.workspace.length, 1);
    const exported = payload.workspace[0];
    assert.equal(exported.tile_id, 'navball');
    assert.equal(exported.preset_id, 'NAV_DEFAULT');
    assert.equal(exported.mutation.width, 0.35);
    assert.ok(exported.quantized);
  });
});
