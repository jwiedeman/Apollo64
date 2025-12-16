/**
 * Tests for Purist Apollo Simulation Systems
 *
 * These tests verify the DDR-style command timing system,
 * mission drift mechanics, and the purist simulation integration.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  CommandTimingSystem,
  TIMING_GRADES,
  COMMAND_TYPES,
  COMMAND_LANES,
  MISSION_PHASES,
} from '../src/sim/commandTimingSystem.js';

import {
  MissionDriftSystem,
  DRIFT_SEVERITY,
  DRIFT_CATEGORIES,
} from '../src/sim/missionDriftSystem.js';

import {
  PuristSimulation,
  SIMULATION_MODES,
  APOLLO_11_EVENTS,
} from '../src/sim/puristSimulation.js';

describe('CommandTimingSystem', () => {
  let timing;

  beforeEach(() => {
    timing = new CommandTimingSystem({
      puristMode: true,
      missionPhase: 'EARTH_ORBIT',
    });
  });

  describe('initialization', () => {
    it('should initialize with default values', () => {
      assert.equal(timing.driftSeconds, 0);
      assert.equal(timing.stats.totalCommands, 0);
      assert.equal(timing.autoMode, false);
      assert.equal(timing.puristMode, true);
    });

    it('should have all timing grades defined', () => {
      assert.ok(TIMING_GRADES.PERFECT);
      assert.ok(TIMING_GRADES.GREAT);
      assert.ok(TIMING_GRADES.GOOD);
      assert.ok(TIMING_GRADES.OK);
      assert.ok(TIMING_GRADES.LATE);
      assert.ok(TIMING_GRADES.MISS);
    });

    it('should have all command types with criticality', () => {
      for (const [key, type] of Object.entries(COMMAND_TYPES)) {
        assert.ok(type.id, `${key} should have id`);
        assert.ok(type.icon, `${key} should have icon`);
        assert.ok(type.criticality, `${key} should have criticality`);
        assert.ok(typeof type.defaultWindowMult === 'number', `${key} should have windowMult`);
      }
    });

    it('should have mission phases defined', () => {
      assert.ok(MISSION_PHASES.LAUNCH);
      assert.ok(MISSION_PHASES.DESCENT);
      assert.ok(MISSION_PHASES.ENTRY);
      assert.equal(MISSION_PHASES.DESCENT.windowMult, 0.4); // Tighter windows during descent
    });
  });

  describe('queueCommand', () => {
    it('should queue a command and increment totalCommands', () => {
      const id = timing.queueCommand({
        commandId: 'TEST_SWITCH',
        type: 'SWITCH',
        getSeconds: 100,
        description: 'Test switch',
        crewRole: 'CDR',
      });

      assert.ok(id);
      assert.equal(timing.stats.totalCommands, 1);
      assert.equal(timing.pendingCommands.length, 1);
    });

    it('should sort commands by target time', () => {
      timing.queueCommand({ commandId: 'CMD_3', getSeconds: 300 });
      timing.queueCommand({ commandId: 'CMD_1', getSeconds: 100 });
      timing.queueCommand({ commandId: 'CMD_2', getSeconds: 200 });

      assert.equal(timing.pendingCommands[0].commandId, 'CMD_1');
      assert.equal(timing.pendingCommands[1].commandId, 'CMD_2');
      assert.equal(timing.pendingCommands[2].commandId, 'CMD_3');
    });

    it('should assign lane based on crew role', () => {
      timing.queueCommand({ commandId: 'CDR_CMD', crewRole: 'CDR', getSeconds: 100 });
      timing.queueCommand({ commandId: 'CMP_CMD', crewRole: 'CMP', getSeconds: 101 });
      timing.queueCommand({ commandId: 'LMP_CMD', crewRole: 'LMP', getSeconds: 102 });

      assert.equal(timing.pendingCommands[0].lane, COMMAND_LANES.CDR);
      assert.equal(timing.pendingCommands[1].lane, COMMAND_LANES.CMP);
      assert.equal(timing.pendingCommands[2].lane, COMMAND_LANES.LMP);
    });
  });

  describe('loadCommands', () => {
    it('should load multiple commands at once', () => {
      timing.loadCommands([
        { commandId: 'CMD_1', getSeconds: 100 },
        { commandId: 'CMD_2', getSeconds: 200 },
        { commandId: 'CMD_3', getSeconds: 300 },
      ]);

      assert.equal(timing.stats.totalCommands, 3);
      assert.equal(timing.pendingCommands.length, 3);
    });
  });

  describe('update and activation', () => {
    beforeEach(() => {
      timing.loadCommands([
        { commandId: 'CMD_1', getSeconds: 100 },
        { commandId: 'CMD_2', getSeconds: 200 },
      ]);
    });

    it('should move commands to active when in look-ahead window', () => {
      timing.update(80, 0.05); // 80 seconds, 30 second look-ahead = 110, CMD_1 should activate

      assert.equal(timing.activeCommands.length, 1);
      assert.equal(timing.activeCommands[0].commandId, 'CMD_1');
      assert.equal(timing.pendingCommands.length, 1);
    });

    it('should not activate commands outside look-ahead window', () => {
      timing.update(50, 0.05); // 50 seconds, 30 second look-ahead = 80, no commands

      assert.equal(timing.activeCommands.length, 0);
      assert.equal(timing.pendingCommands.length, 2);
    });
  });

  describe('executeCommand', () => {
    beforeEach(() => {
      timing.loadCommands([
        { commandId: 'TEST_CMD', type: 'SWITCH', getSeconds: 100 },
      ]);
      timing.update(80, 0.05); // Activate the command
    });

    it('should return success and grade for perfect timing', () => {
      const result = timing.executeCommand('SWITCH', 'TEST_CMD', 100.1);

      assert.ok(result.success);
      assert.equal(result.grade.id, 'PERFECT');
      assert.equal(timing.stats.perfect, 1);
      assert.equal(timing.stats.currentStreak, 1);
    });

    it('should return success and grade for good timing', () => {
      const result = timing.executeCommand('SWITCH', 'TEST_CMD', 101.2);

      assert.ok(result.success);
      assert.equal(result.grade.id, 'GOOD');
      assert.equal(timing.stats.good, 1);
    });

    it('should return failure for no matching command', () => {
      const result = timing.executeCommand('SWITCH', 'WRONG_CMD', 100);

      assert.equal(result.success, false);
      assert.equal(result.reason, 'no_matching_command');
    });

    it('should update streak on consecutive hits', () => {
      timing.loadCommands([
        { commandId: 'CMD_2', type: 'SWITCH', getSeconds: 200 },
        { commandId: 'CMD_3', type: 'SWITCH', getSeconds: 300 },
      ]);

      timing.executeCommand('SWITCH', 'TEST_CMD', 100.1);
      timing.update(180, 0.05);
      timing.executeCommand('SWITCH', 'CMD_2', 200.1);
      timing.update(280, 0.05);
      timing.executeCommand('SWITCH', 'CMD_3', 300.1);

      assert.equal(timing.stats.currentStreak, 3);
      assert.equal(timing.stats.maxStreak, 3);
    });
  });

  describe('missed commands', () => {
    beforeEach(() => {
      timing.loadCommands([
        { commandId: 'TEST_CMD', type: 'SWITCH', getSeconds: 100 },
      ]);
      timing.update(80, 0.05); // Activate
    });

    it('should mark command as missed after window expires', () => {
      // Advance past the miss window (6 seconds for LATE grade)
      timing.update(107, 0.05);

      assert.equal(timing.activeCommands.length, 0);
      assert.equal(timing.missedCommands.length, 1);
      assert.equal(timing.stats.missed, 1);
      assert.equal(timing.stats.currentStreak, 0);
    });

    it('should apply drift penalty for missed commands', () => {
      timing.update(107, 0.05);

      assert.ok(timing.driftSeconds > 0);
      assert.ok(timing.stats.totalDriftAccumulated > 0);
    });
  });

  describe('mission phase affects timing', () => {
    it('should have tighter windows during DESCENT phase', () => {
      const descentTiming = new CommandTimingSystem({
        puristMode: true,
        missionPhase: 'DESCENT',
      });

      const coastTiming = new CommandTimingSystem({
        puristMode: true,
        missionPhase: 'TRANSLUNAR',
      });

      const descentWindow = descentTiming.getAdjustedWindow(1000, 'SWITCH');
      const coastWindow = coastTiming.getAdjustedWindow(1000, 'SWITCH');

      assert.ok(descentWindow < coastWindow, 'Descent windows should be tighter');
    });
  });

  describe('auto mode', () => {
    it('should automatically execute commands in auto mode', () => {
      const autoTiming = new CommandTimingSystem({
        autoMode: true,
      });

      autoTiming.loadCommands([
        { commandId: 'CMD_1', getSeconds: 100 },
      ]);

      autoTiming.update(80, 0.05); // Activate
      autoTiming.update(100, 0.05); // Should auto-execute

      assert.equal(autoTiming.completedCommands.length, 1);
      assert.equal(autoTiming.stats.perfect, 1);
    });
  });

  describe('getTimeline', () => {
    it('should return formatted timeline for rendering', () => {
      timing.loadCommands([
        { commandId: 'CMD_1', type: 'SWITCH', getSeconds: 100, crewRole: 'CDR' },
        { commandId: 'CMD_2', type: 'DSKY', getSeconds: 110, crewRole: 'CMP' },
      ]);

      timing.update(90, 0.05);
      const timeline = timing.getTimeline(95, 30);

      assert.ok(timeline.currentGetSeconds);
      assert.ok(Array.isArray(timeline.commands));
      assert.ok(timeline.drift);
      assert.ok(timeline.stats);
    });
  });

  describe('serialization', () => {
    it('should serialize and deserialize state', () => {
      timing.loadCommands([
        { commandId: 'CMD_1', getSeconds: 100 },
      ]);
      timing.update(80, 0.05);
      timing.executeCommand(null, 'CMD_1', 100.1);

      const serialized = timing.serialize();
      assert.ok(serialized.stats);
      assert.ok(Array.isArray(serialized.completedCommands));

      const newTiming = new CommandTimingSystem();
      newTiming.deserialize(serialized);

      assert.equal(newTiming.stats.perfect, timing.stats.perfect);
      assert.equal(newTiming.completedCommands.length, timing.completedCommands.length);
    });
  });
});

describe('MissionDriftSystem', () => {
  let drift;

  beforeEach(() => {
    drift = new MissionDriftSystem();
  });

  describe('initialization', () => {
    it('should initialize with zero drift', () => {
      assert.equal(drift.drift.TIMING, 0);
      assert.equal(drift.drift.TRAJECTORY, 0);
      assert.equal(drift.drift.ATTITUDE, 0);
      assert.equal(drift.currentSeverity, 'NOMINAL');
    });

    it('should have all drift categories defined', () => {
      assert.ok(DRIFT_CATEGORIES.TIMING);
      assert.ok(DRIFT_CATEGORIES.TRAJECTORY);
      assert.ok(DRIFT_CATEGORIES.ATTITUDE);
      assert.ok(DRIFT_CATEGORIES.THERMAL);
      assert.ok(DRIFT_CATEGORIES.CONSUMABLES);
    });
  });

  describe('addDrift', () => {
    it('should add drift to specified category', () => {
      drift.addDrift('TIMING', 10, { source: 'test' });

      assert.equal(drift.drift.TIMING, 10);
      assert.equal(drift.history.length, 1);
    });

    it('should update severity when threshold crossed', () => {
      drift.addDrift('TIMING', 35, { source: 'test' });
      drift.update(100, 0.05);

      assert.equal(drift.currentSeverity, 'MODERATE');
    });

    it('should reject unknown category', () => {
      const result = drift.addDrift('UNKNOWN', 10);

      assert.equal(result.success, false);
      assert.equal(result.reason, 'unknown_category');
    });
  });

  describe('drift rates', () => {
    it('should apply drift rates over time', () => {
      drift.setDriftRate('ATTITUDE', 0.1);
      drift.update(100, 10); // 10 seconds

      assert.ok(drift.drift.ATTITUDE > 0);
    });
  });

  describe('recovery actions', () => {
    it('should initiate recovery when drift exists', () => {
      drift.addDrift('TRAJECTORY', 10);
      const result = drift.initiateRecovery('TRAJECTORY_CORRECTION', { getSeconds: 100 });

      assert.ok(result.success);
      assert.ok(result.estimatedRecovery > 0);
      assert.equal(drift.pendingRecoveries.length, 1);
    });

    it('should reject recovery when no drift', () => {
      const result = drift.initiateRecovery('TRAJECTORY_CORRECTION', { getSeconds: 100 });

      assert.equal(result.success, false);
      assert.equal(result.reason, 'no_drift_to_recover');
    });

    it('should complete recovery after duration', () => {
      drift.addDrift('TRAJECTORY', 10);
      drift.initiateRecovery('TRAJECTORY_CORRECTION', { getSeconds: 100 });

      // Advance past completion time (30 seconds)
      drift.update(135, 0.05);

      assert.equal(drift.pendingRecoveries.length, 0);
      assert.ok(drift.drift.TRAJECTORY < 10);
    });
  });

  describe('getDriftState', () => {
    it('should return comprehensive drift state', () => {
      drift.addDrift('TIMING', 15);
      const state = drift.getDriftState();

      assert.ok(state.drift);
      assert.ok(state.severity);
      assert.ok(Array.isArray(state.categories));
      assert.equal(state.categories.length, Object.keys(DRIFT_CATEGORIES).length);
    });
  });
});

describe('PuristSimulation', () => {
  let purist;
  let mockSimulation;

  beforeEach(() => {
    mockSimulation = {
      clock: {
        getCurrent: () => 0,
        setCurrent: (val) => {},
      },
      resourceSystem: null,
      scheduler: null,
    };

    purist = new PuristSimulation({
      simulation: mockSimulation,
      mode: SIMULATION_MODES.INTERACTIVE,
      puristMode: true,
    });
  });

  describe('initialization', () => {
    it('should initialize in interactive mode by default', () => {
      assert.equal(purist.mode, SIMULATION_MODES.INTERACTIVE);
      assert.equal(purist.isPaused, true);
      assert.equal(purist.currentPhase, 'PRELAUNCH');
    });

    it('should have Apollo 11 events defined', () => {
      assert.ok(APOLLO_11_EVENTS.LAUNCH === 0);
      assert.ok(APOLLO_11_EVENTS.LANDING > 0);
      assert.ok(APOLLO_11_EVENTS.SPLASHDOWN > APOLLO_11_EVENTS.LANDING);
    });
  });

  describe('mode settings', () => {
    it('should set time scale based on mode', () => {
      purist.setMode(SIMULATION_MODES.COMPRESSED_8X);
      assert.equal(purist.timeScale, 8);

      purist.setMode(SIMULATION_MODES.COMPRESSED_60X);
      assert.equal(purist.timeScale, 60);
    });

    it('should enable auto mode for AUTO_CREW', () => {
      purist.setMode(SIMULATION_MODES.AUTO_CREW);
      assert.equal(purist.commandTiming.autoMode, true);
    });
  });

  describe('loadProcedures', () => {
    it('should load procedures from data', () => {
      purist.loadProcedures({
        procedures: [
          { id: 'PROC_1', name: 'Test', commands: [] },
          { id: 'PROC_2', name: 'Test 2', commands: [] },
        ],
      });

      assert.equal(purist.procedures.size, 2);
    });
  });

  describe('executeCommand', () => {
    beforeEach(() => {
      purist.commandTiming.loadCommands([
        { commandId: 'TEST_CMD', type: 'SWITCH', getSeconds: 100 },
      ]);
      purist.commandTiming.update(80, 0.05);
    });

    it('should execute command and update stats', () => {
      const result = purist.executeCommand('SWITCH', 'TEST_CMD');

      assert.ok(result.success);
      assert.equal(purist.sessionStats.commandsExecuted, 1);
    });
  });

  describe('getEstimatedCompletion', () => {
    it('should return mission completion estimates', () => {
      mockSimulation.clock.getCurrent = () => 100000; // ~28 hours
      const est = purist.getEstimatedCompletion();

      assert.ok(est.missionSecondsRemaining > 0);
      assert.ok(est.percentComplete > 0);
      assert.ok(est.percentComplete < 100);
    });
  });

  describe('getAvailableEvents', () => {
    it('should return list of mission events', () => {
      const events = purist.getAvailableEvents();

      assert.ok(Array.isArray(events));
      assert.ok(events.length > 10);
      assert.ok(events.some((e) => e.name === 'LANDING'));
    });
  });

  describe('skipToEvent', () => {
    it('should skip to named event', () => {
      let setCalled = false;
      mockSimulation.clock.setCurrent = (val) => {
        setCalled = true;
        assert.equal(val, APOLLO_11_EVENTS.TLI_START);
      };

      const result = purist.skipToEvent('TLI_START');

      assert.ok(result.success);
      assert.ok(setCalled);
    });

    it('should fail for unknown event', () => {
      const result = purist.skipToEvent('UNKNOWN_EVENT');

      assert.equal(result.success, false);
    });
  });

  describe('getSimulationState', () => {
    it('should return comprehensive simulation state', () => {
      const state = purist.getSimulationState();

      assert.ok(state.get);
      assert.ok(state.phase);
      assert.ok(state.mode);
      assert.ok(Array.isArray(state.activeCommands));
      assert.ok(state.drift);
      assert.ok(state.stats);
    });
  });

  describe('serialization', () => {
    it('should serialize and deserialize state', () => {
      purist.sessionStats.commandsExecuted = 5;
      purist.milestones.add('LAUNCH');

      const serialized = purist.serialize();

      const newPurist = new PuristSimulation({
        simulation: mockSimulation,
      });
      newPurist.deserialize(serialized);

      assert.equal(newPurist.sessionStats.commandsExecuted, 5);
    });
  });
});

describe('Integration: Command Timing + Drift', () => {
  it('should sync timing drift to mission drift system', () => {
    const mockSim = {
      clock: { getCurrent: () => 100 },
    };

    const purist = new PuristSimulation({
      simulation: mockSim,
      mode: SIMULATION_MODES.INTERACTIVE,
    });

    // Load a command
    purist.commandTiming.loadCommands([
      { commandId: 'CMD_1', type: 'SWITCH', getSeconds: 100 },
    ]);
    purist.commandTiming.update(80, 0.05);

    // Miss the command by waiting too long
    purist.commandTiming.update(107, 0.05);

    // The timing system should have generated drift
    assert.ok(purist.commandTiming.driftSeconds > 0);
  });
});
