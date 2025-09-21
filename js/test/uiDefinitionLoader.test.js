import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { loadUiDefinitions } from '../src/data/uiDefinitionLoader.js';
import { parseGET } from '../src/utils/time.js';

describe('loadUiDefinitions', () => {
  test('parses panel, checklist, and workspace bundles', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-def-'));

    try {
      const panels = {
        version: 1,
        panels: [
          {
            id: 'CSM_TEST',
            name: 'Test Panel',
            craft: 'CSM',
            layout: {
              schematic: 'test.svg',
              hotspots: [
                { controlId: 'CTRL_A', x: 10, y: 20, width: 30, height: 40 },
              ],
            },
            controls: [
              {
                id: 'CTRL_A',
                label: 'Control A',
                type: 'toggle',
                states: [
                  { id: 'OFF', label: 'Off', drawKw: 0 },
                  { id: 'ON', label: 'On', drawKw: 0.5 },
                ],
                defaultState: 'OFF',
                dependencies: [{ type: 'circuitBreaker', id: 'CB_TEST' }],
                effects: [{ type: 'flag', id: 'flag_test', value: true }],
              },
            ],
            alerts: [
              { id: 'ALERT_TEST', severity: 'caution', message: 'Test alert' },
            ],
          },
        ],
      };

      const checklists = {
        version: 1,
        checklists: [
          {
            id: 'CHK_TEST',
            title: 'Test Checklist',
            phase: 'Translunar',
            role: 'CMP',
            nominalGet: '000:10:00',
            steps: [
              {
                id: 'CHK_TEST_STEP_1',
                order: 1,
                callout: 'Perform test step',
                panel: 'CSM_TEST',
                controls: [
                  {
                    controlId: 'CTRL_A',
                    targetState: 'ON',
                    verification: 'indicator',
                  },
                ],
                dskyMacro: 'V16N65_TEST',
                manualOnly: true,
                prerequisites: ['event:TEST'],
                effects: [{ type: 'flag', id: 'flag_complete', value: true }],
                notes: 'Test note',
              },
            ],
          },
        ],
      };

      const workspaces = {
        version: 1,
        presets: [
          {
            id: 'TEST_WS',
            name: 'Test Workspace',
            description: 'Workspace for tests',
            viewport: { minWidth: 1280, minHeight: 720, hudPinned: true },
            tiles: [
              {
                id: 'tile1',
                window: 'trajectoryCanvas',
                x: 0,
                y: 0,
                width: 0.5,
                height: 0.5,
              },
            ],
            tileMode: { snap: 16, grid: [12, 8], focus: { retainHud: true, animationMs: 250 } },
          },
        ],
      };

      await fs.writeFile(
        path.join(tempDir, 'panels.json'),
        `${JSON.stringify(panels, null, 2)}\n`,
        'utf8',
      );
      await fs.writeFile(
        path.join(tempDir, 'checklists.json'),
        `${JSON.stringify(checklists, null, 2)}\n`,
        'utf8',
      );
      await fs.writeFile(
        path.join(tempDir, 'workspaces.json'),
        `${JSON.stringify(workspaces, null, 2)}\n`,
        'utf8',
      );

      const result = await loadUiDefinitions(tempDir);

      assert.equal(result.panels.items.length, 1);
      const panel = result.panels.items[0];
      assert.equal(panel.id, 'CSM_TEST');
      assert.equal(panel.controlsById.size, 1);
      const control = panel.controlsById.get('CTRL_A');
      assert.ok(control);
      assert.equal(control.statesById.get('ON').drawKw, 0.5);
      assert.equal(panel.hotspotsByControl.get('CTRL_A').width, 30);

      assert.equal(result.checklists.items.length, 1);
      const checklist = result.checklists.map.get('CHK_TEST');
      assert.ok(checklist);
      assert.equal(checklist.nominalGet, '000:10:00');
      assert.equal(checklist.nominalGetSeconds, parseGET('000:10:00'));
      const step = checklist.stepsByOrder.get(1);
      assert.equal(step.panelId, 'CSM_TEST');
      assert.equal(step.controls[0].controlId, 'CTRL_A');
      assert.deepEqual(step.prerequisites, ['event:TEST']);

      assert.equal(result.workspaces.items.length, 1);
      const workspace = result.workspaces.map.get('TEST_WS');
      assert.ok(workspace);
      assert.equal(workspace.tiles[0].width, 0.5);
      assert.equal(workspace.viewport.minWidth, 1280);
      assert.equal(workspace.tiles[0].constraints, null);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test('returns empty bundles when files are missing', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-def-empty-'));
    try {
      const result = await loadUiDefinitions(tempDir);
      assert.equal(result.panels.items.length, 0);
      assert.equal(result.checklists.items.length, 0);
      assert.equal(result.workspaces.items.length, 0);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
