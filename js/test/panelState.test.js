import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { PanelState } from '../src/sim/panelState.js';
import { createTestLogger } from './testUtils.js';

const SAMPLE_BUNDLE = {
  version: 2,
  description: 'Test panel bundle',
  panels: [
    {
      id: 'MAIN_PANEL',
      name: 'Main Panel',
      craft: 'CSM',
      tags: ['core'],
      controls: [
        {
          id: 'SWITCH_A',
          label: 'Switch A',
          type: 'toggle',
          defaultState: 'closed',
          states: [
            { id: 'closed', label: 'Closed' },
            { id: 'open', label: 'Open' },
          ],
        },
        {
          id: 'SWITCH_B',
          label: 'Switch B',
          type: 'toggle',
          defaultState: 'off',
          states: [
            { id: 'off', label: 'Off' },
            { id: 'on', label: 'On' },
          ],
        },
      ],
    },
    {
      id: 'AUX_PANEL',
      name: 'Auxiliary Panel',
      craft: 'CSM',
      tags: ['aux'],
      controls: [
        {
          id: 'GUARD',
          label: 'Guard',
          type: 'toggle',
          states: [
            { id: 'closed', label: 'Closed' },
            { id: 'open', label: 'Open' },
          ],
        },
      ],
    },
  ],
};

describe('PanelState', () => {
  test('loads panel definitions and exposes control state queries', () => {
    const panelState = new PanelState({ bundle: SAMPLE_BUNDLE });

    const panels = panelState.listPanels();
    assert.equal(panels.length, 2);
    assert.equal(panels[0].id, 'MAIN_PANEL');
    assert.equal(panels[0].name, 'Main Panel');

    const allControls = panelState.listControls();
    assert.equal(allControls.length, 3);
    assert.equal(allControls[0].controlId, 'SWITCH_A');
    assert.ok(Array.isArray(allControls[0].states));
    assert.equal(allControls[0].states.length, 2);

    const mainControls = panelState.listControls('MAIN_PANEL');
    assert.equal(mainControls.length, 2);
    assert.equal(mainControls[1].controlId, 'SWITCH_B');

    const initialState = panelState.getControlState('MAIN_PANEL', 'SWITCH_A');
    assert.equal(initialState.stateId, 'closed');
    assert.equal(initialState.stateLabel, 'Closed');
    assert.equal(initialState.updatedAtSeconds, null);

    const stats = panelState.stats();
    assert.equal(stats.totalPanels, 2);
    assert.equal(stats.totalControls, 3);
    assert.equal(stats.changes, 0);
    assert.equal(stats.historyCount, 0);
  });

  test('updates control state, records history, and produces snapshots', () => {
    const logger = createTestLogger();
    const recorded = [];
    const recorder = {
      recordPanelControl: (entry) => recorded.push(entry),
    };

    const panelState = new PanelState({
      bundle: SAMPLE_BUNDLE,
      logger,
      recorder,
      historyLimit: 2,
    });

    panelState.setTimeProvider(() => 123);

    const firstChange = panelState.setControlState('MAIN_PANEL', 'SWITCH_A', 'open', {
      actor: 'MANUAL_CREW',
      note: 'Initial toggle',
    });
    assert.equal(firstChange.success, true);
    assert.equal(firstChange.changed, true);
    assert.equal(firstChange.stateId, 'open');
    assert.equal(panelState.getControlState('MAIN_PANEL', 'SWITCH_A').stateId, 'open');
    assert.equal(logger.entries.length, 1);
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].panelId, 'MAIN_PANEL');
    assert.equal(recorded[0].stateId, 'open');
    assert.equal(recorded[0].actor, 'MANUAL_CREW');
    assert.equal(recorded[0].note, 'Initial toggle');
    assert.equal(recorded[0].getSeconds, 123);

    const noChange = panelState.setControlState('MAIN_PANEL', 'SWITCH_A', 'open', {
      actor: 'MANUAL_CREW',
    });
    assert.equal(noChange.success, true);
    assert.equal(noChange.changed, false);
    assert.equal(panelState.historySnapshot().length, 1);

    panelState.setControlState('MAIN_PANEL', 'SWITCH_A', 'closed', {
      getSeconds: 200,
      actor: 'AUTO_CREW',
    });
    panelState.setControlState('MAIN_PANEL', 'SWITCH_B', 'on', {
      getSeconds: 300,
      actor: 'MANUAL_CREW',
      note: 'Switch on',
    });

    const history = panelState.historySnapshot();
    assert.equal(history.length, 2);
    assert.equal(history[0].controlId, 'SWITCH_A');
    assert.equal(history[0].stateId, 'closed');
    assert.equal(history[1].controlId, 'SWITCH_B');
    assert.equal(history[1].stateId, 'on');

    const stats = panelState.stats();
    assert.equal(stats.changes, 3);
    assert.equal(stats.historyCount, 2);
    assert.equal(stats.lastUpdateSeconds, 300);

    const snapshot = panelState.snapshot();
    assert.equal(snapshot.summary.totalPanels, 2);
    assert.equal(snapshot.summary.totalControls, 3);
    assert.equal(snapshot.summary.changes, 3);
    assert.equal(snapshot.panels.MAIN_PANEL.controls.SWITCH_A.stateId, 'closed');
    assert.equal(snapshot.panels.MAIN_PANEL.controls.SWITCH_B.stateId, 'on');

    const snapshotWithHistory = panelState.snapshot({ includeHistory: true, historyLimit: 1 });
    assert.ok(Array.isArray(snapshotWithHistory.history));
    assert.equal(snapshotWithHistory.history.length, 1);
    assert.equal(snapshotWithHistory.history[0].controlId, 'SWITCH_B');

    const serialized = panelState.serialize();
    assert.ok(Array.isArray(serialized.history));
    assert.equal(serialized.history.length, 2);
  });

  test('handles invalid identifiers and states gracefully', () => {
    const panelState = new PanelState({ bundle: SAMPLE_BUNDLE });

    const unknownPanel = panelState.setControlState('UNKNOWN', 'SWITCH_A', 'open');
    assert.equal(unknownPanel.success, false);
    assert.equal(unknownPanel.reason, 'unknown_control');

    const invalidPanel = panelState.setControlState(null, 'SWITCH_A', 'open');
    assert.equal(invalidPanel.success, false);
    assert.equal(invalidPanel.reason, 'invalid_identifier');

    const unknownControl = panelState.setControlState('MAIN_PANEL', 'UNKNOWN', 'open');
    assert.equal(unknownControl.success, false);
    assert.equal(unknownControl.reason, 'unknown_control');

    const unknownState = panelState.setControlState('MAIN_PANEL', 'SWITCH_A', 'invalid');
    assert.equal(unknownState.success, false);
    assert.equal(unknownState.reason, 'unknown_state');
  });
});
