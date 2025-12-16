/**
 * Purist Apollo Simulation Integration
 *
 * Integrates the DDR-style command timing system, drift mechanics,
 * and micro-procedural accuracy into the Apollo64 simulation.
 *
 * This creates the authentic Apollo mission experience:
 * - Every switch flip matters
 * - Commands must be executed at the right time
 * - Miss your timing and the mission drifts
 * - Full 7+ day real-time simulation possible
 */

import { CommandTimingSystem } from './commandTimingSystem.js';
import { MissionDriftSystem } from './missionDriftSystem.js';
import { formatGET, parseGET } from '../utils/time.js';

/**
 * Mode constants
 */
const SIMULATION_MODES = {
  REALTIME: 'realtime',           // 1:1 real time (7+ days for full mission)
  COMPRESSED_2X: 'compressed_2x',  // 2x speed
  COMPRESSED_4X: 'compressed_4x',  // 4x speed
  COMPRESSED_8X: 'compressed_8x',  // 8x speed
  AUTO_CREW: 'auto_crew',         // Autopilot handles everything
  PLAYBACK: 'playback',           // Pre-recorded mission replay
};

const PLAYBACK_SOURCES = {
  APOLLO_11_NOMINAL: 'apollo_11_nominal',
  APOLLO_11_HISTORICAL: 'apollo_11_historical',
  CUSTOM: 'custom',
};

/**
 * PuristSimulation class
 *
 * Wraps the standard Simulation with DDR-style command input
 * and drift consequences for missed/late commands.
 */
export class PuristSimulation {
  constructor({
    simulation,
    logger = null,
    procedureData = null,
    onCommandRequired = null,
    onCommandResult = null,
    onDriftUpdate = null,
    onMissionStatus = null,
    mode = SIMULATION_MODES.REALTIME,
  } = {}) {
    this.simulation = simulation;
    this.logger = logger;

    // Mode settings
    this.mode = mode;
    this.timeScale = this.#getTimeScale(mode);
    this.isPaused = false;

    // Command timing system
    this.commandTiming = new CommandTimingSystem({
      logger,
      autoMode: mode === SIMULATION_MODES.AUTO_CREW,
      lookAheadSeconds: 30,
      onCommandHit: (data) => this.#onCommandHit(data),
      onCommandMiss: (data) => this.#onCommandMiss(data),
      onDriftChange: (data) => this.#onDriftFromTiming(data),
    });

    // Mission drift system
    this.missionDrift = new MissionDriftSystem({
      logger,
      resourceSystem: simulation.resourceSystem,
      eventScheduler: simulation.scheduler,
      onDriftUpdate: (data) => this.#onDriftUpdate(data),
      onSeverityChange: (data) => this.#onSeverityChange(data),
      onRecoveryNeeded: (data) => this.#onRecoveryNeeded(data),
    });

    // Callbacks
    this.onCommandRequired = typeof onCommandRequired === 'function' ? onCommandRequired : null;
    this.onCommandResult = typeof onCommandResult === 'function' ? onCommandResult : null;
    this.onDriftUpdate = typeof onDriftUpdate === 'function' ? onDriftUpdate : null;
    this.onMissionStatus = typeof onMissionStatus === 'function' ? onMissionStatus : null;

    // Procedure data
    this.procedures = new Map();
    this.loadedProcedures = new Set();

    if (procedureData) {
      this.loadProcedures(procedureData);
    }

    // Session statistics
    this.sessionStats = {
      sessionStartTime: Date.now(),
      simulatedSeconds: 0,
      realSeconds: 0,
      commandsExecuted: 0,
      commandsMissed: 0,
      maxDrift: 0,
      recoveriesInitiated: 0,
      missionStatus: 'nominal',
    };

    // Real-time tracking
    this.lastRealTime = null;
    this.accumulatedRealTime = 0;
  }

  /**
   * Load procedures from JSON data
   */
  loadProcedures(data) {
    if (!data?.procedures) return;

    for (const proc of data.procedures) {
      this.procedures.set(proc.id, proc);
    }

    this.logger?.log(0, `Loaded ${this.procedures.size} micro-procedures`, {
      logSource: 'sim',
      logCategory: 'procedure',
      logSeverity: 'notice',
    });
  }

  /**
   * Set simulation mode
   */
  setMode(mode) {
    this.mode = mode;
    this.timeScale = this.#getTimeScale(mode);
    this.commandTiming.setAutoMode(mode === SIMULATION_MODES.AUTO_CREW);

    this.logger?.log(this.getCurrentGet(), `Mode changed to ${mode}`, {
      logSource: 'sim',
      logCategory: 'mode',
      logSeverity: 'notice',
      timeScale: this.timeScale,
    });
  }

  /**
   * Pause/resume simulation
   */
  setPaused(paused) {
    this.isPaused = paused;
    this.lastRealTime = paused ? null : Date.now();
  }

  /**
   * Get current GET (Ground Elapsed Time)
   */
  getCurrentGet() {
    return this.simulation.clock?.getCurrent() ?? 0;
  }

  /**
   * Main update loop - call this each frame
   */
  update(realDeltaMs = null) {
    if (this.isPaused) return;

    const now = Date.now();

    // Calculate real time delta
    if (realDeltaMs === null) {
      if (this.lastRealTime === null) {
        this.lastRealTime = now;
        return;
      }
      realDeltaMs = now - this.lastRealTime;
    }
    this.lastRealTime = now;

    // Convert to simulation delta based on time scale
    const simDeltaSeconds = (realDeltaMs / 1000) * this.timeScale;
    const currentGet = this.getCurrentGet();

    // Update command timing system
    this.commandTiming.update(currentGet, simDeltaSeconds);

    // Update drift system
    this.missionDrift.update(currentGet, simDeltaSeconds);

    // Check for upcoming procedures that need to be loaded
    this.#checkUpcomingProcedures(currentGet);

    // Update session stats
    this.sessionStats.realSeconds += realDeltaMs / 1000;
    this.sessionStats.simulatedSeconds = currentGet;

    // Emit command requirements for upcoming commands
    this.#emitUpcomingCommands(currentGet);

    // Update mission status
    this.#updateMissionStatus(currentGet);
  }

  /**
   * Execute a command (player input)
   */
  executeCommand(commandType, commandId, context = {}) {
    const currentGet = this.getCurrentGet();
    const result = this.commandTiming.executeCommand(commandType, commandId, currentGet, context);

    if (result.success) {
      this.sessionStats.commandsExecuted += 1;

      // Also trigger the actual simulation action (panel control, DSKY entry, etc.)
      this.#executeSimulationAction(commandType, commandId, context);
    }

    if (this.onCommandResult) {
      this.onCommandResult({
        ...result,
        commandType,
        commandId,
        getSeconds: currentGet,
      });
    }

    return result;
  }

  /**
   * Get active commands for display
   */
  getActiveCommands() {
    return this.commandTiming.getActiveCommands();
  }

  /**
   * Get upcoming commands
   */
  getUpcomingCommands(limit = 10) {
    return this.commandTiming.getUpcomingCommands(this.getCurrentGet(), limit);
  }

  /**
   * Get timeline for rendering
   */
  getTimeline(windowSeconds = 15) {
    return this.commandTiming.getTimeline(this.getCurrentGet(), windowSeconds);
  }

  /**
   * Get drift state
   */
  getDriftState() {
    return {
      timing: this.commandTiming.getDrift(),
      mission: this.missionDrift.getDriftState(),
    };
  }

  /**
   * Get recommended recoveries
   */
  getRecommendedRecoveries() {
    return this.missionDrift.getRecommendedRecoveries();
  }

  /**
   * Initiate a recovery action
   */
  initiateRecovery(recoveryId) {
    const result = this.missionDrift.initiateRecovery(recoveryId, {
      getSeconds: this.getCurrentGet(),
    });

    if (result.success) {
      this.sessionStats.recoveriesInitiated += 1;
    }

    return result;
  }

  /**
   * Get session statistics
   */
  getSessionStats() {
    return {
      ...this.sessionStats,
      currentGet: this.getCurrentGet(),
      currentGetFormatted: formatGET(this.getCurrentGet()),
      mode: this.mode,
      timeScale: this.timeScale,
      isPaused: this.isPaused,
      commandStats: this.commandTiming.getStats(),
      driftStats: this.missionDrift.getStats(),
    };
  }

  /**
   * Get full simulation state for UI rendering
   */
  getSimulationState() {
    const currentGet = this.getCurrentGet();

    return {
      get: formatGET(currentGet),
      getSeconds: currentGet,
      phase: this.#getCurrentPhase(currentGet),
      mode: this.mode,
      timeScale: this.timeScale,
      isPaused: this.isPaused,

      // Command state
      activeCommands: this.getActiveCommands(),
      upcomingCommands: this.getUpcomingCommands(5),
      timeline: this.getTimeline(),

      // Drift state
      drift: this.getDriftState(),
      recommendedRecoveries: this.getRecommendedRecoveries(),

      // Session
      stats: this.getSessionStats(),

      // Resources (from wrapped simulation)
      resources: this.simulation.resourceSystem?.snapshot() ?? null,

      // Scheduler state
      events: this.simulation.scheduler?.stats() ?? null,

      // Score
      score: this.simulation.scoreSystem?.summary() ?? null,
    };
  }

  /**
   * Serialize state for saving
   */
  serialize() {
    return {
      mode: this.mode,
      commandTimingState: this.commandTiming.serialize(),
      driftState: this.missionDrift.serialize(),
      sessionStats: { ...this.sessionStats },
      loadedProcedures: Array.from(this.loadedProcedures),
    };
  }

  /**
   * Load state from save
   */
  deserialize(data) {
    if (!data) return;

    if (data.mode) this.setMode(data.mode);
    if (data.commandTimingState) this.commandTiming.deserialize(data.commandTimingState);
    if (data.driftState) this.missionDrift.deserialize(data.driftState);
    if (data.sessionStats) this.sessionStats = { ...this.sessionStats, ...data.sessionStats };
    if (data.loadedProcedures) this.loadedProcedures = new Set(data.loadedProcedures);
  }

  // Private methods

  #getTimeScale(mode) {
    switch (mode) {
      case SIMULATION_MODES.REALTIME: return 1;
      case SIMULATION_MODES.COMPRESSED_2X: return 2;
      case SIMULATION_MODES.COMPRESSED_4X: return 4;
      case SIMULATION_MODES.COMPRESSED_8X: return 8;
      case SIMULATION_MODES.AUTO_CREW: return 1;
      case SIMULATION_MODES.PLAYBACK: return 1;
      default: return 1;
    }
  }

  #checkUpcomingProcedures(currentGet) {
    // Look ahead 60 seconds for procedures to load
    const lookAhead = 60;

    for (const [procId, proc] of this.procedures) {
      if (this.loadedProcedures.has(procId)) continue;

      const procStart = proc.getStartSeconds ?? 0;
      if (procStart <= currentGet + lookAhead && procStart > currentGet - 10) {
        // Load this procedure's commands
        this.#loadProcedureCommands(proc);
        this.loadedProcedures.add(procId);

        this.logger?.log(currentGet, `Loaded procedure: ${proc.name}`, {
          logSource: 'sim',
          logCategory: 'procedure',
          logSeverity: 'notice',
          procedureId: procId,
          commandCount: proc.commands?.length ?? 0,
        });
      }
    }
  }

  #loadProcedureCommands(procedure) {
    if (!procedure.commands) return;

    for (const cmd of procedure.commands) {
      this.commandTiming.queueCommand({
        ...cmd,
        procedureId: procedure.id,
        procedureName: procedure.name,
        crewRole: cmd.crewRole ?? procedure.crewRole,
      });
    }
  }

  #emitUpcomingCommands(currentGet) {
    if (!this.onCommandRequired) return;

    const upcoming = this.commandTiming.getUpcomingCommands(currentGet, 3);
    for (const cmd of upcoming) {
      if (cmd.secondsUntil <= 5 && cmd.secondsUntil > 4) {
        // 5 second warning
        this.onCommandRequired({
          warning: '5_seconds',
          command: cmd,
          getSeconds: currentGet,
        });
      }
    }

    const active = this.commandTiming.getActiveCommands();
    if (active.length > 0) {
      this.onCommandRequired({
        warning: 'active',
        commands: active,
        getSeconds: currentGet,
      });
    }
  }

  #executeSimulationAction(commandType, commandId, context) {
    // Bridge to the actual simulation systems
    const currentGet = this.getCurrentGet();

    switch (commandType) {
      case 'SWITCH':
      case 'BUTTON':
        if (context.panel && context.control && context.expectedState) {
          this.simulation.panelState?.setControlState(
            context.panel,
            context.control,
            context.expectedState,
            { getSeconds: currentGet, actor: 'PLAYER', source: 'command_timing' }
          );
        }
        break;

      case 'DSKY':
        if (this.simulation.agcRuntime && (context.verb || context.noun)) {
          this.simulation.agcRuntime.executeEntry({
            verb: context.verb,
            noun: context.noun,
            actor: 'PLAYER',
          }, { getSeconds: currentGet, source: 'command_timing' });
        }
        break;

      case 'CALLOUT':
        // Callouts just need acknowledgment, no simulation action
        break;

      case 'VERIFY':
        // Verification acknowledged
        break;

      default:
        break;
    }
  }

  #onCommandHit(data) {
    this.logger?.log(this.getCurrentGet(), `Command hit: ${data.command.commandId} - ${data.grade.name}`, {
      logSource: 'sim',
      logCategory: 'command',
      logSeverity: 'notice',
      grade: data.grade.id,
      deltaMs: data.timing.deltaMs,
      streak: data.streak,
    });
  }

  #onCommandMiss(data) {
    this.sessionStats.commandsMissed += 1;

    this.logger?.log(this.getCurrentGet(), `Command MISSED: ${data.command.commandId}`, {
      logSource: 'sim',
      logCategory: 'command',
      logSeverity: 'warning',
      driftDelta: data.driftDelta,
      totalDrift: data.totalDrift,
    });
  }

  #onDriftFromTiming(data) {
    // Sync timing drift to mission drift system
    this.missionDrift.addDrift('TIMING', data.driftDelta, {
      getSeconds: this.getCurrentGet(),
      source: 'command_timing',
      reason: data.cause,
    });
  }

  #onDriftUpdate(data) {
    if (Math.abs(data.drift) > this.sessionStats.maxDrift) {
      this.sessionStats.maxDrift = Math.abs(data.drift);
    }

    if (this.onDriftUpdate) {
      this.onDriftUpdate(data);
    }
  }

  #onSeverityChange(data) {
    this.logger?.log(this.getCurrentGet(), `Drift severity: ${data.current}`, {
      logSource: 'sim',
      logCategory: 'drift',
      logSeverity: data.escalated ? 'warning' : 'notice',
      previous: data.previous,
      current: data.current,
    });

    if (data.escalated && data.current === 'CRITICAL') {
      this.sessionStats.missionStatus = 'critical';
    }
  }

  #onRecoveryNeeded(data) {
    this.logger?.log(this.getCurrentGet(), 'Recovery recommended', {
      logSource: 'sim',
      logCategory: 'drift',
      logSeverity: 'warning',
      severity: data.severity,
      recommendations: data.recommendations.length,
    });
  }

  #updateMissionStatus(currentGet) {
    const drift = this.missionDrift.getDriftState();

    let status = 'nominal';
    if (drift.severity === 'MINOR') status = 'minor_deviation';
    else if (drift.severity === 'MODERATE') status = 'moderate_deviation';
    else if (drift.severity === 'SIGNIFICANT') status = 'significant_deviation';
    else if (drift.severity === 'MAJOR') status = 'major_deviation';
    else if (drift.severity === 'CRITICAL') status = 'critical';

    if (status !== this.sessionStats.missionStatus) {
      this.sessionStats.missionStatus = status;

      if (this.onMissionStatus) {
        this.onMissionStatus({
          status,
          getSeconds: currentGet,
          drift,
        });
      }
    }
  }

  #getCurrentPhase(getSeconds) {
    // Determine mission phase based on GET
    if (getSeconds < 700) return 'Launch';
    if (getSeconds < 10000) return 'Earth Orbit';
    if (getSeconds < 12000) return 'Translunar Injection';
    if (getSeconds < 270000) return 'Translunar Coast';
    if (getSeconds < 290000) return 'Lunar Orbit Insertion';
    if (getSeconds < 360000) return 'Lunar Orbit';
    if (getSeconds < 370000) return 'LM Descent';
    if (getSeconds < 450000) return 'Lunar Surface';
    if (getSeconds < 470000) return 'LM Ascent';
    if (getSeconds < 500000) return 'Trans-Earth Injection';
    if (getSeconds < 700000) return 'Trans-Earth Coast';
    return 'Entry & Recovery';
  }
}

export { SIMULATION_MODES, PLAYBACK_SOURCES };
