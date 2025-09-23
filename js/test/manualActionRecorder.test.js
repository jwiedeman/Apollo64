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

  test('produces timeline snapshots with checklist and DSKY history', () => {
    const recorder = new ManualActionRecorder();

    recorder.recordChecklistAck({
      eventId: 'EVT_A',
      checklistId: 'CHK_A',
      stepNumber: 1,
      getSeconds: 120,
      actor: 'AUTO_CREW',
      note: 'Auto complete',
    });

    recorder.recordChecklistAck({
      eventId: 'EVT_A',
      checklistId: 'CHK_A',
      stepNumber: 2,
      getSeconds: 125,
      actor: 'MANUAL_CREW',
      note: 'Manual assist',
    });

    recorder.recordDskyEntry({
      id: 'DSKY_CUSTOM',
      eventId: 'EVT_A',
      getSeconds: 126,
      verb: 37,
      noun: 62,
      program: 'P37',
      registers: { r1: '12345' },
      sequence: ['VERB 37', 'NOUN 62'],
      actor: 'AUTO_CREW',
    });

    const snapshot = recorder.timelineSnapshot();

    assert.ok(snapshot.summary);
    assert.equal(snapshot.summary.checklist.total, 2);
    assert.equal(snapshot.summary.dsky.total, 1);

    assert.equal(snapshot.checklist.length, 2);
    assert.equal(snapshot.checklist[0].eventId, 'EVT_A');
    assert.equal(snapshot.checklist[1].actor, 'MANUAL_CREW');
    assert.equal(snapshot.checklist[0].get, '000:02:00');

    assert.equal(snapshot.dsky.length, 1);
    assert.equal(snapshot.dsky[0].id, 'DSKY_CUSTOM');
    assert.equal(snapshot.dsky[0].verb, 37);
    assert.equal(snapshot.dsky[0].sequenceData.length, 2);
  });

  test('records panel control entries and exports them to scripts and snapshots', () => {
    const recorder = new ManualActionRecorder({ includeNotes: true });

    recorder.recordPanelControl({
      panelId: 'MAIN_PANEL',
      controlId: 'SWITCH_A',
      stateId: 'OPEN',
      stateLabel: 'Open',
      previousStateId: 'CLOSED',
      previousStateLabel: 'Closed',
      getSeconds: 210,
      actor: 'AUTO_CREW',
      note: 'Auto toggled',
    });

    recorder.recordPanelControl({
      panelId: 'AUX_PANEL',
      controlId: 'SWITCH_B',
      stateId: 'ON',
      getSeconds: 215,
      actor: 'MANUAL_CREW',
    });

    const stats = recorder.stats();
    assert.equal(stats.panel.total, 2);
    assert.equal(stats.panel.auto, 1);
    assert.equal(stats.panel.manual, 1);

    const script = recorder.buildScriptActions();
    const panelActions = script.filter((action) => action.type === 'panel_control');
    assert.equal(panelActions.length, 1);
    const [autoPanelAction] = panelActions;
    assert.equal(autoPanelAction.panel_id, 'MAIN_PANEL');
    assert.equal(autoPanelAction.control_id, 'SWITCH_A');
    assert.equal(autoPanelAction.state_id, 'OPEN');
    assert.equal(autoPanelAction.previous_state_id, 'CLOSED');
    assert.equal(autoPanelAction.state_label, 'Open');
    assert.equal(autoPanelAction.note, 'Auto toggled');

    const timeline = recorder.timelineSnapshot({ includePanels: true });
    assert.ok(Array.isArray(timeline.panels));
    assert.equal(timeline.panels.length, 2);
    assert.equal(timeline.panels[0].panelId, 'MAIN_PANEL');
    assert.equal(timeline.panels[0].stateLabel, 'Open');
    assert.equal(timeline.panels[1].actor, 'MANUAL_CREW');

    const json = recorder.toJSON();
    assert.equal(json.metadata.panel_controls_recorded, 2);
    assert.ok(Array.isArray(json.panel));
    assert.equal(json.panel.length, 2);
    assert.equal(json.panel[0].panel_id, 'MAIN_PANEL');
    assert.equal(json.panel[0].state_label, 'Open');
  });
});
