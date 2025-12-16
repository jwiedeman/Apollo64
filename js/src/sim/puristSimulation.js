/**
 * Purist Apollo Simulation Integration
 *
 * This is NOT a game. This is a simulation.
 *
 * Philosophy:
 * - No shortcuts. Every switch flip, every callout, every DSKY entry.
 * - Real-time by default. The full mission takes ~8 days.
 * - Commands arrive DDR-style. Miss them, and you drift from nominal.
 * - Historical playback shows exactly what the crew did.
 * - Interactive mode lets you try to match or beat their timing.
 *
 * The goal is authenticity, not progression. There are no unlocks,
 * no achievements, no power-ups. There is only the mission.
 *
 * References:
 * - Apollo 11 Flight Plan (NASA document)
 * - Apollo 11 Flight Journal
 * - Apollo 11 Surface Journal
 * - AS-506 Mission Operations Report
 */

import { CommandTimingSystem, MISSION_PHASES } from './commandTimingSystem.js';
import { MissionDriftSystem } from './missionDriftSystem.js';
import { formatGET, parseGET } from '../utils/time.js';

/**
 * Mode constants
 */
const SIMULATION_MODES = {
  REALTIME: 'realtime',           // 1:1 real time (195+ hours for full mission)
  COMPRESSED_2X: 'compressed_2x',  // 2x speed (~4 days)
  COMPRESSED_4X: 'compressed_4x',  // 4x speed (~2 days)
  COMPRESSED_8X: 'compressed_8x',  // 8x speed (~1 day)
  COMPRESSED_60X: 'compressed_60x', // 1 minute = 1 hour (~3 hours)
  AUTO_CREW: 'auto_crew',         // Watch mode - see the mission unfold
  PLAYBACK: 'playback',           // Historical playback with crew actions
  INTERACTIVE: 'interactive',     // You are the crew - execute all commands
};

const PLAYBACK_SOURCES = {
  APOLLO_11_NOMINAL: 'apollo_11_nominal',   // Planned timeline
  APOLLO_11_HISTORICAL: 'apollo_11_historical', // What actually happened
  APOLLO_12_NOMINAL: 'apollo_12_nominal',
  APOLLO_13_NOMINAL: 'apollo_13_nominal',   // With abort scenario
  CUSTOM: 'custom',
};

// Time markers for the Apollo 11 mission (GET in seconds)
const APOLLO_11_EVENTS = {
  LAUNCH: 0,
  MECO: 162,                      // Main Engine Cutoff (S-IC)
  S2_IGNITION: 164,
  S2_CUTOFF: 549,
  S_IVB_IGNITION: 554,
  S_IVB_CUTOFF_1: 700,            // Earth orbit insertion
  TLI_START: 9834,                // 002:44:16 GET
  TLI_CUTOFF: 10178,              // S-IVB cutoff for TLI
  CSM_SEP: 11400,                 // CSM/S-IVB separation
  TD_E: 12300,                    // Transposition & docking
  LM_EXTRACTION: 14700,
  MCC_1: 41400,                   // Midcourse correction 1
  LOI_1: 272949,                  // 075:49:50 GET
  LOI_2: 284529,                  // 079:02:09 GET
  DOI: 353769,                    // 098:16:09 GET - Descent orbit insertion
  PDI: 369180,                    // 102:33:00 GET - Powered descent
  LANDING: 370014,                // 102:45:40 GET
  EVA_START: 378938,              // 105:14:38 GET
  FIRST_STEP: 379788,             // 109:24:48 GET
  EVA_END: 387900,                // 107:45:00 GET (approx)
  LIFTOFF_MOON: 409170,           // 124:22:00 GET
  DOCKING: 412170,                // 128:03:00 GET
  LM_JETTISON: 421200,            // 130:09:31 GET
  TEI: 440535,                    // 135:23:42 GET
  MCC_5: 517320,                  // Midcourse correction 5
  ENTRY_INTERFACE: 682470,        // 195:03:05 GET
  SPLASHDOWN: 689100,             // 195:18:35 GET
};

/**
 * PuristSimulation class
 *
 * This is the heart of the Apollo simulator. It wraps the standard
 * simulation engine with DDR-style command timing, creating an
 * experience where every action matters.
 *
 * Three primary modes:
 * 1. INTERACTIVE - You execute commands as they arrive (default)
 * 2. PLAYBACK - Watch historical crew actions
 * 3. AUTO_CREW - Autopilot handles everything, you observe
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
    onPhaseChange = null,
    onMilestone = null,
    mode = SIMULATION_MODES.INTERACTIVE,
    puristMode = true,
  } = {}) {
    this.simulation = simulation;
    this.logger = logger;

    // Mode settings
    this.mode = mode;
    this.timeScale = this.#getTimeScale(mode);
    this.isPaused = true; // Start paused, waiting for launch
    this.puristMode = puristMode;

    // Current mission phase
    this.currentPhase = 'PRELAUNCH';

    // Command timing system - the DDR engine
    this.commandTiming = new CommandTimingSystem({
      logger,
      autoMode: mode === SIMULATION_MODES.AUTO_CREW || mode === SIMULATION_MODES.PLAYBACK,
      puristMode,
      lookAheadSeconds: 30,
      missionPhase: this.currentPhase,
      onCommandHit: (data) => this.#onCommandHit(data),
      onCommandMiss: (data) => this.#onCommandMiss(data),
      onDriftChange: (data) => this.#onDriftFromTiming(data),
      onCommandApproaching: (data) => this.#onCommandApproaching(data),
    });

    // Mission drift system - consequences of missed commands
    this.missionDrift = new MissionDriftSystem({
      logger,
      resourceSystem: simulation?.resourceSystem,
      eventScheduler: simulation?.scheduler,
      onDriftUpdate: (data) => this.#onDriftUpdate(data),
      onSeverityChange: (data) => this.#onSeverityChange(data),
      onRecoveryNeeded: (data) => this.#onRecoveryNeeded(data),
    });

    // Callbacks
    this.onCommandRequired = typeof onCommandRequired === 'function' ? onCommandRequired : null;
    this.onCommandResult = typeof onCommandResult === 'function' ? onCommandResult : null;
    this.onDriftUpdate = typeof onDriftUpdate === 'function' ? onDriftUpdate : null;
    this.onMissionStatus = typeof onMissionStatus === 'function' ? onMissionStatus : null;
    this.onPhaseChange = typeof onPhaseChange === 'function' ? onPhaseChange : null;
    this.onMilestone = typeof onMilestone === 'function' ? onMilestone : null;

    // Procedure data
    this.procedures = new Map();
    this.loadedProcedures = new Set();

    if (procedureData) {
      this.loadProcedures(procedureData);
    }

    // Mission milestones achieved
    this.milestones = new Set();

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
      phaseChanges: 0,
      milestonesReached: 0,
    };

    // Real-time tracking
    this.lastRealTime = null;
    this.accumulatedRealTime = 0;
  }

  /**
   * Determine mission phase from GET seconds
   */
  #getMissionPhaseFromGet(getSeconds) {
    if (getSeconds < 0) return 'PRELAUNCH';
    if (getSeconds < APOLLO_11_EVENTS.S_IVB_CUTOFF_1) return 'LAUNCH';
    if (getSeconds < APOLLO_11_EVENTS.TLI_START) return 'EARTH_ORBIT';
    if (getSeconds < APOLLO_11_EVENTS.TLI_CUTOFF) return 'TLI';
    if (getSeconds < APOLLO_11_EVENTS.LOI_1) return 'TRANSLUNAR';
    if (getSeconds < APOLLO_11_EVENTS.LOI_2 + 3600) return 'LOI';
    if (getSeconds < APOLLO_11_EVENTS.PDI) return 'LUNAR_ORBIT';
    if (getSeconds < APOLLO_11_EVENTS.LANDING) return 'DESCENT';
    if (getSeconds < APOLLO_11_EVENTS.LIFTOFF_MOON) return 'SURFACE';
    if (getSeconds < APOLLO_11_EVENTS.DOCKING) return 'ASCENT';
    if (getSeconds < APOLLO_11_EVENTS.TEI) return 'RENDEZVOUS';
    if (getSeconds < APOLLO_11_EVENTS.TEI + 600) return 'TEI';
    if (getSeconds < APOLLO_11_EVENTS.ENTRY_INTERFACE) return 'TRANSEARTH';
    return 'ENTRY';
  }

  /**
   * Check and update mission phase
   */
  #updateMissionPhase(getSeconds) {
    const newPhase = this.#getMissionPhaseFromGet(getSeconds);
    if (newPhase !== this.currentPhase) {
      const oldPhase = this.currentPhase;
      this.currentPhase = newPhase;
      this.sessionStats.phaseChanges += 1;

      // Update command timing system
      this.commandTiming.setMissionPhase(newPhase);

      // Log phase change
      this.logger?.log(getSeconds, `Phase: ${MISSION_PHASES[newPhase]?.description ?? newPhase}`, {
        logSource: 'sim',
        logCategory: 'phase',
        logSeverity: 'notice',
        previousPhase: oldPhase,
        newPhase,
      });

      // Callback
      if (this.onPhaseChange) {
        this.onPhaseChange({
          previous: oldPhase,
          current: newPhase,
          getSeconds,
          description: MISSION_PHASES[newPhase]?.description,
        });
      }
    }
  }

  /**
   * Check for mission milestones
   */
  #checkMilestones(getSeconds) {
    for (const [name, time] of Object.entries(APOLLO_11_EVENTS)) {
      if (!this.milestones.has(name) && getSeconds >= time) {
        this.milestones.add(name);
        this.sessionStats.milestonesReached += 1;

        this.logger?.log(getSeconds, `Milestone: ${name}`, {
          logSource: 'sim',
          logCategory: 'milestone',
          logSeverity: 'notice',
          milestone: name,
          plannedGet: time,
          actualGet: getSeconds,
          delta: getSeconds - time,
        });

        if (this.onMilestone) {
          this.onMilestone({
            name,
            plannedGet: time,
            actualGet: getSeconds,
            delta: getSeconds - time,
          });
        }
      }
    }
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
   * This is where the DDR magic happens
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

    // Update mission phase (affects timing strictness)
    this.#updateMissionPhase(currentGet);

    // Check for milestones
    this.#checkMilestones(currentGet);

    // Update command timing system - the DDR engine
    this.commandTiming.update(currentGet, simDeltaSeconds);

    // Update drift system - consequences of missed commands
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
      case SIMULATION_MODES.COMPRESSED_60X: return 60;
      case SIMULATION_MODES.AUTO_CREW: return 1;
      case SIMULATION_MODES.PLAYBACK: return 1;
      case SIMULATION_MODES.INTERACTIVE: return 1;
      default: return 1;
    }
  }

  #onCommandApproaching(data) {
    // Called when a command is about to enter the hit zone
    if (this.onCommandRequired) {
      this.onCommandRequired({
        warning: 'approaching',
        command: data.command,
        secondsUntil: data.secondsUntil,
        getSeconds: this.getCurrentGet(),
      });
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
    // Return human-readable phase name
    const phaseId = this.#getMissionPhaseFromGet(getSeconds);
    return MISSION_PHASES[phaseId]?.description ?? phaseId;
  }

  /**
   * Get estimated mission completion time
   */
  getEstimatedCompletion() {
    const currentGet = this.getCurrentGet();
    const remaining = APOLLO_11_EVENTS.SPLASHDOWN - currentGet;
    const realTimeRemaining = remaining / this.timeScale;

    return {
      missionSecondsRemaining: remaining,
      realSecondsRemaining: realTimeRemaining,
      percentComplete: (currentGet / APOLLO_11_EVENTS.SPLASHDOWN) * 100,
      estimatedRealHours: realTimeRemaining / 3600,
    };
  }

  /**
   * Skip to a specific mission event (for testing/demo)
   */
  skipToEvent(eventName) {
    const eventTime = APOLLO_11_EVENTS[eventName];
    if (eventTime !== undefined && this.simulation?.clock) {
      this.simulation.clock.setCurrent?.(eventTime);
      this.loadedProcedures.clear(); // Reset loaded procedures
      return { success: true, getSeconds: eventTime };
    }
    return { success: false, reason: 'unknown_event' };
  }

  /**
   * Get list of available events for skipping
   */
  getAvailableEvents() {
    return Object.entries(APOLLO_11_EVENTS).map(([name, time]) => ({
      name,
      getSeconds: time,
      get: formatGET(time),
      phase: this.#getMissionPhaseFromGet(time),
    }));
  }
}

export { SIMULATION_MODES, PLAYBACK_SOURCES, APOLLO_11_EVENTS };
