import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { WorkspaceStore } from '../src/hud/workspaceStore.js';
import { MissionLogger } from '../src/logging/missionLogger.js';

describe('WorkspaceStore', () => {
  test('activates presets by view and emits mission log entries', () => {
    let now = 100;
    const logger = new MissionLogger({ silent: true });
    const store = new WorkspaceStore({
      bundle: createWorkspaceBundle(),
      logger,
      timeProvider: () => now,
    });

    const initialState = store.getState();
    assert.equal(initialState.activePresetId, 'NAV_DEFAULT');
    assert.equal(initialState.activeView, null);

    now = 125;
    const changed = store.activateView('controls');
    assert.equal(changed, true);

    const state = store.getState();
    assert.equal(state.activePresetId, 'DOCKING');
    assert.equal(state.activeView, 'controls');
    assert.ok(state.tiles.docking);

    const entries = logger.getEntries();
    const lastEntry = entries[entries.length - 1];
    assert.ok(lastEntry);
    assert.equal(lastEntry.message, 'Workspace preset activated');
    assert.equal(lastEntry.context.eventType, 'workspace:preset_loaded');
    assert.equal(lastEntry.context.presetId, 'DOCKING');
    assert.equal(lastEntry.context.view, 'controls');
  });

  test('mutates tiles within constraints and records history', () => {
    let now = 200;
    const logger = new MissionLogger({ silent: true });
    const store = new WorkspaceStore({
      bundle: createWorkspaceBundle(),
      logger,
      timeProvider: () => now,
    });

    now = 210;
    const result = store.mutateTile(
      'trajectory',
      { x: 0.9, y: -0.5, width: 0.2, height: 2 },
      { pointer: 'mouse', source: 'drag' },
    );

    assert.ok(result);
    assert.ok(result.width >= 0.4, 'width respects min constraint');
    assert.ok(result.height <= 1, 'height clamped to viewport');
    assert.ok(result.x <= 0.6 + 1e-6, 'x clamped to viewport width');
    assert.equal(result.y, 0, 'y clamped to zero when negative');

    const state = store.getState();
    const tile = state.tiles.trajectory;
    assert.equal(tile.width, result.width);
    assert.equal(tile.x, result.x);

    const history = state.history;
    const historyEntry = history[history.length - 1];
    assert.ok(historyEntry);
    assert.equal(historyEntry.type, 'tile.mutate');
    assert.equal(historyEntry.pointer, 'mouse');
    assert.equal(historyEntry.source, 'drag');

    const entries = logger.getEntries();
    const lastEntry = entries[entries.length - 1];
    assert.ok(lastEntry);
    assert.equal(lastEntry.context.eventType, 'workspace:update');
    assert.equal(lastEntry.context.tileId, 'trajectory');
    assert.equal(lastEntry.context.pointer, 'mouse');
  });

  test('serializes state and applies overrides to a new store', () => {
    let now = 300;
    const bundle = createWorkspaceBundle();
    const store = new WorkspaceStore({
      bundle,
      timeProvider: () => now,
    });

    store.updateOverride('hudPinned', false);
    store.updateInputOverride('keyboard', 'toggleTileMode', 'KeyT');
    store.mutateTile('navball', { x: 0.62, width: 0.35 });

    const snapshot = store.serialize();

    let otherNow = 10;
    const imported = new WorkspaceStore({
      bundle,
      timeProvider: () => otherNow,
    });

    const applied = imported.applySerialized(snapshot, { silent: true });
    assert.equal(applied, true);

    const state = imported.getState();
    assert.equal(state.overrides.hudPinned, false);
    assert.equal(state.inputOverrides.keyboard.toggleTileMode, 'KeyT');
    assert.ok(Math.abs(state.tiles.navball.x - snapshot.tiles.navball.x) < 1e-6);
    assert.ok(Math.abs(state.tiles.navball.width - snapshot.tiles.navball.width) < 1e-6);
  });
});

function createWorkspaceBundle() {
  const presets = [
    {
      id: 'NAV_DEFAULT',
      name: 'Navigation View',
      viewport: { minWidth: 1280, minHeight: 720, hudPinned: true },
      tiles: [
        {
          id: 'trajectory',
          window: 'trajectoryCanvas',
          x: 0,
          y: 0,
          width: 0.58,
          height: 0.65,
          constraints: { minWidth: 0.4, minHeight: 0.45 },
        },
        {
          id: 'navball',
          window: 'navball',
          x: 0.58,
          y: 0,
          width: 0.42,
          height: 0.4,
          constraints: { minWidth: 0.3 },
        },
      ],
    },
    {
      id: 'DOCKING',
      name: 'Docking Ops',
      viewport: { minWidth: 1280, minHeight: 720, hudPinned: true },
      tiles: [
        {
          id: 'docking',
          window: 'dockingOverlay',
          x: 0,
          y: 0,
          width: 0.55,
          height: 0.6,
          constraints: { minWidth: 0.45, minHeight: 0.45 },
        },
        {
          id: 'manualQueue',
          window: 'manualActionMonitor',
          x: 0.55,
          y: 0,
          width: 0.45,
          height: 0.25,
        },
      ],
    },
  ];

  return {
    version: 1,
    items: presets,
    map: new Map(presets.map((preset) => [preset.id, preset])),
    totalTiles: presets.reduce((total, preset) => total + preset.tiles.length, 0),
  };
}
