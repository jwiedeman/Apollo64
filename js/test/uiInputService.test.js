import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { UiInputService } from '../src/ui/uiInputService.js';
import { MissionLogger } from '../src/logging/missionLogger.js';
import { MissionEventBus } from '../src/ui/missionEventBus.js';

describe('UiInputService', () => {
  test('maps keyboard commands and updates state', () => {
    let now = 0;
    const logger = new MissionLogger({ silent: true });
    const bus = new MissionEventBus();
    const service = new UiInputService({ timeProvider: () => now, logger, eventBus: bus });

    const seen = [];
    const unsubscribe = service.onAnyCommand((event) => seen.push(event));

    now = 10;
    const navEvent = service.handleInput({ device: 'keyboard', key: '1', code: 'Digit1' });
    assert.ok(navEvent);
    assert.equal(navEvent.commandId, 'view:navigation');
    assert.equal(service.getState().view, 'navigation');

    now = 20;
    const controlsEvent = service.handleInput({ device: 'keyboard', key: '2', code: 'Digit2' });
    assert.equal(controlsEvent.commandId, 'view:controls');
    assert.equal(service.getState().view, 'controls');

    now = 30;
    const panelEvent = service.handleInput({ device: 'keyboard', key: 'ArrowDown', code: 'ArrowDown' });
    assert.equal(panelEvent.commandId, 'controls:panel_next');
    assert.equal(service.getState().controlsPanelIndex, 1);

    now = 40;
    const activateEvent = service.handleInput({ device: 'keyboard', key: 'Enter', code: 'Enter' });
    assert.equal(activateEvent.commandId, 'controls:activate_panel');
    assert.equal(service.getState().focusTarget, 'panel');

    now = 50;
    const toggleEvent = service.handleInput({ device: 'keyboard', key: ' ', code: 'Space' });
    assert.equal(toggleEvent.commandId, 'controls:toggle_control');
    assert.equal(service.getState().controlsLastActionAt, 50);

    now = 60;
    const cycleEvent = service.handleInput({ device: 'keyboard', key: 'Tab', code: 'Tab' });
    assert.equal(cycleEvent.commandId, 'controls:cycle_control_focus');
    assert.equal(service.getState().controlsControlIndex, 1);

    now = 70;
    const releaseEvent = service.handleInput({ device: 'keyboard', key: 'Escape', code: 'Escape' });
    assert.equal(releaseEvent.commandId, 'focus:release');
    assert.equal(service.getState().focusTarget, null);
    assert.equal(service.getState().mode, 'idle');

    unsubscribe();
    assert.ok(seen.length >= 6);
    assert.equal(logger.getEntries().length >= 6, true);
  });

  test('routes DSKY inputs when focused and emits bus events', () => {
    let now = 100;
    const bus = new MissionEventBus();
    const service = new UiInputService({ timeProvider: () => now, eventBus: bus });

    const busEvents = [];
    bus.on('ui:command:dsky:key', (event) => busEvents.push(event));

    now = 110;
    const focusEvent = service.handleInput({ device: 'keyboard', key: 'g', code: 'KeyG' });
    assert.equal(focusEvent.commandId, 'dsky:focus');
    assert.equal(service.getState().focusTarget, 'dsky');

    now = 120;
    const verbEvent = service.handleInput({ device: 'keyboard', key: 'v', code: 'KeyV' });
    assert.equal(verbEvent.commandId, 'dsky:key');
    assert.equal(verbEvent.payload.key, 'VERB');

    now = 130;
    const digitEvent = service.handleInput({ device: 'keyboard', key: '1', code: 'Digit1' });
    assert.equal(digitEvent.commandId, 'dsky:key');
    assert.equal(digitEvent.payload.key, '1');
    assert.equal(service.getState().dskyBuffer.length >= 2, true);

    now = 140;
    const macroEvent = service.handleInput({ device: 'keyboard', key: 'm', code: 'KeyM', ctrlKey: true });
    assert.equal(macroEvent.commandId, 'dsky:macro_tray');
    assert.equal(service.getState().modalTarget, 'macroTray');

    now = 150;
    service.handleInput({ device: 'keyboard', key: 'Escape', code: 'Escape' });
    assert.equal(service.getState().focusTarget, null);
    assert.equal(service.getState().modalTarget, null);

    assert.ok(busEvents.length >= 2);
  });

  test('supports gamepad mappings and history limits', () => {
    let now = 0;
    const service = new UiInputService({ timeProvider: () => now, historyLimit: 2 });

    now = 5;
    const viewEvent = service.handleInput({ device: 'gamepad', buttons: ['LB', 'Y'] });
    assert.equal(viewEvent.commandId, 'view:controls');
    assert.equal(service.getState().view, 'controls');

    now = 10;
    const panelEvent = service.handleInput({ device: 'gamepad', buttons: ['DOWN'] });
    assert.equal(panelEvent.commandId, 'controls:panel_next');
    assert.equal(service.getState().controlsPanelIndex, 1);

    now = 15;
    service.handleInput({ device: 'gamepad', buttons: ['Y'], hold: true });
    assert.equal(service.getState().focusTarget, 'dsky');

    now = 18;
    const macroEvent = service.handleInput({ device: 'gamepad', buttons: ['LB', 'X'], hold: true });
    assert.equal(macroEvent.commandId, 'dsky:macro_tray');

    const history = service.getHistory();
    assert.equal(history.length, 2);
    assert.equal(history[history.length - 1].commandId, 'dsky:macro_tray');
  });
});
