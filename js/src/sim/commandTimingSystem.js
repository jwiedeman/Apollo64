/**
 * Command Timing System for Apollo64
 *
 * DDR/Guitar Hero style command input system for purist Apollo simulation.
 * Commands scroll down the timeline and must be executed within precise windows.
 * Missing or late commands cause mission drift - real consequences, no game-y shortcuts.
 *
 * Philosophy: This is NOT an incremental game. This is a real-time simulation
 * of the Apollo mission where every switch flip, every callout, every DSKY entry
 * happens at the historically accurate time. You're not "progressing" - you're
 * reliving the mission moment by moment.
 *
 * Timing windows are based on actual crew response times from Apollo transcripts.
 * Critical commands (burns, staging events) have tighter windows.
 */

import { formatGET } from '../utils/time.js';

// Timing window grades calibrated to real crew performance
// Apollo astronauts typically responded within 2-3 seconds to calls
const TIMING_GRADES = {
  PERFECT: { id: 'PERFECT', name: 'Perfect', windowMs: 250, driftFactor: 0, scoreMult: 1.0, feedback: 'Nominal' },
  GREAT: { id: 'GREAT', name: 'Great', windowMs: 750, driftFactor: 0.05, scoreMult: 0.95, feedback: 'On time' },
  GOOD: { id: 'GOOD', name: 'Good', windowMs: 1500, driftFactor: 0.15, scoreMult: 0.85, feedback: 'Acceptable' },
  OK: { id: 'OK', name: 'OK', windowMs: 3000, driftFactor: 0.35, scoreMult: 0.6, feedback: 'Delayed' },
  LATE: { id: 'LATE', name: 'Late', windowMs: 6000, driftFactor: 0.6, scoreMult: 0.3, feedback: 'Behind schedule' },
  MISS: { id: 'MISS', name: 'Miss', windowMs: Infinity, driftFactor: 1.0, scoreMult: 0, feedback: 'Missed' },
};

// Command types with visual representation and criticality
// Criticality affects timing window strictness
const COMMAND_TYPES = {
  SWITCH: {
    id: 'SWITCH',
    name: 'Switch',
    icon: '▢',
    color: '#4a9eff',
    description: 'Toggle switch or circuit breaker',
    criticality: 'normal',
    defaultWindowMult: 1.0,
  },
  BUTTON: {
    id: 'BUTTON',
    name: 'Button',
    icon: '●',
    color: '#ff6b4a',
    description: 'Momentary pushbutton',
    criticality: 'high',
    defaultWindowMult: 0.8,
  },
  DSKY: {
    id: 'DSKY',
    name: 'DSKY',
    icon: '▣',
    color: '#4aff6b',
    description: 'DSKY Verb/Noun entry',
    criticality: 'high',
    defaultWindowMult: 0.9,
  },
  DIAL: {
    id: 'DIAL',
    name: 'Dial',
    icon: '◎',
    color: '#ffc04a',
    description: 'Rotary control adjustment',
    criticality: 'normal',
    defaultWindowMult: 1.2,
  },
  THROTTLE: {
    id: 'THROTTLE',
    name: 'Throttle',
    icon: '▲',
    color: '#ff4aff',
    description: 'Engine throttle control',
    criticality: 'critical',
    defaultWindowMult: 0.5,
  },
  RCS: {
    id: 'RCS',
    name: 'RCS',
    icon: '✦',
    color: '#4affff',
    description: 'RCS translation/rotation input',
    criticality: 'high',
    defaultWindowMult: 0.7,
  },
  CALLOUT: {
    id: 'CALLOUT',
    name: 'Callout',
    icon: '◇',
    color: '#ffffff',
    description: 'Voice callout - acknowledge',
    criticality: 'low',
    defaultWindowMult: 1.5,
  },
  VERIFY: {
    id: 'VERIFY',
    name: 'Verify',
    icon: '✓',
    color: '#aaffaa',
    description: 'Monitor and confirm status',
    criticality: 'normal',
    defaultWindowMult: 1.3,
  },
  ABORT: {
    id: 'ABORT',
    name: 'Abort',
    icon: '⚠',
    color: '#ff0000',
    description: 'Abort system actuation',
    criticality: 'critical',
    defaultWindowMult: 0.3,
  },
  STAGING: {
    id: 'STAGING',
    name: 'Staging',
    icon: '◆',
    color: '#ff8800',
    description: 'Stage separation sequence',
    criticality: 'critical',
    defaultWindowMult: 0.4,
  },
  BURN: {
    id: 'BURN',
    name: 'Burn',
    icon: '▲',
    color: '#ff4400',
    description: 'Engine ignition/cutoff',
    criticality: 'critical',
    defaultWindowMult: 0.3,
  },
  COMM: {
    id: 'COMM',
    name: 'Comm',
    icon: '◈',
    color: '#88ff88',
    description: 'Communications check/response',
    criticality: 'low',
    defaultWindowMult: 2.0,
  },
};

// Command lane positions mapped to crew stations
// Like Guitar Hero frets - commands scroll into these lanes
const COMMAND_LANES = {
  CDR: 0,           // Commander (left couch / LM left)
  CMP: 1,           // Command Module Pilot (center couch)
  LMP: 2,           // Lunar Module Pilot (right couch / LM right)
  JOINT: 3,         // Shared commands (any crew member)
  CAPCOM: 4,        // CapCom callouts to acknowledge
};

// Map crew roles to lanes for visual display
const CREW_ROLE_TO_LANE = {
  CDR: COMMAND_LANES.CDR,
  CMP: COMMAND_LANES.CMP,
  LMP: COMMAND_LANES.LMP,
  Joint: COMMAND_LANES.JOINT,
  JOINT: COMMAND_LANES.JOINT,
  CAPCOM: COMMAND_LANES.CAPCOM,
  Houston: COMMAND_LANES.CAPCOM,
};

// Mission phases for context-aware timing
const MISSION_PHASES = {
  PRELAUNCH: { id: 'PRELAUNCH', windowMult: 1.5, description: 'Pre-launch checks' },
  LAUNCH: { id: 'LAUNCH', windowMult: 0.5, description: 'Launch to orbit' },
  EARTH_ORBIT: { id: 'EARTH_ORBIT', windowMult: 1.0, description: 'Earth orbit checkout' },
  TLI: { id: 'TLI', windowMult: 0.6, description: 'Trans-Lunar Injection' },
  TRANSLUNAR: { id: 'TRANSLUNAR', windowMult: 1.5, description: 'Coast to Moon' },
  LOI: { id: 'LOI', windowMult: 0.6, description: 'Lunar Orbit Insertion' },
  LUNAR_ORBIT: { id: 'LUNAR_ORBIT', windowMult: 1.0, description: 'Lunar orbit operations' },
  DESCENT: { id: 'DESCENT', windowMult: 0.4, description: 'Powered descent' },
  SURFACE: { id: 'SURFACE', windowMult: 1.2, description: 'Lunar surface EVA' },
  ASCENT: { id: 'ASCENT', windowMult: 0.5, description: 'Lunar ascent' },
  RENDEZVOUS: { id: 'RENDEZVOUS', windowMult: 0.7, description: 'LM/CSM rendezvous' },
  TEI: { id: 'TEI', windowMult: 0.6, description: 'Trans-Earth Injection' },
  TRANSEARTH: { id: 'TRANSEARTH', windowMult: 1.5, description: 'Coast to Earth' },
  ENTRY: { id: 'ENTRY', windowMult: 0.5, description: 'Atmospheric entry' },
};

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export class CommandTimingSystem {
  constructor({
    logger = null,
    onCommandHit = null,
    onCommandMiss = null,
    onDriftChange = null,
    onCommandApproaching = null,
    onComboAchieved = null,
    lookAheadSeconds = 30,
    autoMode = false,
    puristMode = true,
    missionPhase = 'EARTH_ORBIT',
  } = {}) {
    this.logger = logger;
    this.onCommandHit = typeof onCommandHit === 'function' ? onCommandHit : null;
    this.onCommandMiss = typeof onCommandMiss === 'function' ? onCommandMiss : null;
    this.onDriftChange = typeof onDriftChange === 'function' ? onDriftChange : null;
    this.onCommandApproaching = typeof onCommandApproaching === 'function' ? onCommandApproaching : null;
    this.onComboAchieved = typeof onComboAchieved === 'function' ? onComboAchieved : null;

    this.lookAheadSeconds = lookAheadSeconds;
    this.autoMode = autoMode;
    this.puristMode = puristMode; // In purist mode, every command matters
    this.missionPhase = missionPhase;

    // Command queue - commands waiting to be executed
    this.pendingCommands = [];

    // Active commands - commands in the timing window
    this.activeCommands = [];

    // Completed commands - for history/scoring
    this.completedCommands = [];

    // Missed commands
    this.missedCommands = [];

    // Current mission drift (0 = nominal, positive = behind schedule)
    this.driftSeconds = 0;
    this.maxDriftSeconds = 120; // 2 minutes max drift - tighter for purist mode

    // Combo system (for visual feedback, not gamification)
    this.combo = {
      current: 0,
      best: 0,
      perfectStreak: 0,
      lastGrade: null,
      multiplier: 1.0,
    };

    // Scoring - historical accuracy tracking
    this.stats = {
      totalCommands: 0,
      perfect: 0,
      great: 0,
      good: 0,
      ok: 0,
      late: 0,
      missed: 0,
      currentStreak: 0,
      maxStreak: 0,
      totalDriftAccumulated: 0,
      criticalCommandsHit: 0,
      criticalCommandsMissed: 0,
      avgResponseMs: 0,
      responseTimes: [],
    };

    // Real-time visual state for DDR-style display
    this.visualState = {
      hitZoneFlash: 0,
      lastHitGrade: null,
      lastHitTime: 0,
      comboBreak: false,
      approachingCount: 0,
    };

    // Internal ID counter
    this._nextId = 0;
  }

  /**
   * Set current mission phase - affects timing strictness
   */
  setMissionPhase(phase) {
    if (MISSION_PHASES[phase]) {
      this.missionPhase = phase;
      this.logger?.log(0, `Mission phase: ${MISSION_PHASES[phase].description}`, {
        logSource: 'sim',
        logCategory: 'timing',
        logSeverity: 'notice',
        phase,
      });
    }
  }

  /**
   * Get phase-adjusted timing window
   */
  getAdjustedWindow(baseWindowMs, commandType) {
    const phaseMult = MISSION_PHASES[this.missionPhase]?.windowMult ?? 1.0;
    const typeMult = COMMAND_TYPES[commandType]?.defaultWindowMult ?? 1.0;
    return baseWindowMs * phaseMult * typeMult;
  }

  /**
   * Load commands from a procedure/checklist
   */
  loadCommands(commands) {
    for (const cmd of commands) {
      this.queueCommand(cmd);
    }
    this.pendingCommands.sort((a, b) => a.targetGetSeconds - b.targetGetSeconds);
  }

  /**
   * Queue a single command
   */
  queueCommand(rawCommand) {
    const command = this.#normalizeCommand(rawCommand);
    this.pendingCommands.push(command);
    this.pendingCommands.sort((a, b) => a.targetGetSeconds - b.targetGetSeconds);
    this.stats.totalCommands += 1;
    return command.id;
  }

  /**
   * Update the timing system - call each simulation tick
   */
  update(currentGetSeconds, dtSeconds = 0) {
    // Move pending commands to active when they enter the look-ahead window
    this.#activatePendingCommands(currentGetSeconds);

    // Check for missed commands (past their window)
    this.#checkMissedCommands(currentGetSeconds);

    // In auto mode, execute commands automatically
    if (this.autoMode) {
      this.#autoExecuteCommands(currentGetSeconds);
    }
  }

  /**
   * Execute a command (player input)
   * @param {string} commandType - Type of command (SWITCH, DSKY, etc.)
   * @param {string} commandId - Specific command identifier
   * @param {number} currentGetSeconds - Current GET
   * @param {object} context - Additional context (panel, control, etc.)
   */
  executeCommand(commandType, commandId, currentGetSeconds, context = {}) {
    // Find matching active command
    const commandIndex = this.activeCommands.findIndex((cmd) =>
      (cmd.type === commandType || !commandType) &&
      (cmd.commandId === commandId || cmd.panelControl === commandId || !commandId)
    );

    if (commandIndex === -1) {
      // No matching command - this is an extraneous input
      this.logger?.log(currentGetSeconds, 'Extraneous command input', {
        logSource: 'sim',
        logCategory: 'timing',
        logSeverity: 'notice',
        commandType,
        commandId,
      });
      return { success: false, reason: 'no_matching_command' };
    }

    const command = this.activeCommands[commandIndex];
    const grade = this.#calculateGrade(command, currentGetSeconds);

    // Remove from active
    this.activeCommands.splice(commandIndex, 1);

    // Record completion
    command.executedAtSeconds = currentGetSeconds;
    command.grade = grade.id;
    command.timing = {
      targetSeconds: command.targetGetSeconds,
      actualSeconds: currentGetSeconds,
      deltaMs: (currentGetSeconds - command.targetGetSeconds) * 1000,
    };

    this.completedCommands.push(command);

    // Update stats
    this.stats[grade.id.toLowerCase()] += 1;

    if (grade.id === 'MISS') {
      this.stats.currentStreak = 0;
    } else {
      this.stats.currentStreak += 1;
      if (this.stats.currentStreak > this.stats.maxStreak) {
        this.stats.maxStreak = this.stats.currentStreak;
      }
    }

    // Apply drift
    const driftDelta = this.#calculateDrift(command, grade, currentGetSeconds);
    if (driftDelta !== 0) {
      this.driftSeconds += driftDelta;
      this.stats.totalDriftAccumulated += Math.abs(driftDelta);

      if (this.onDriftChange) {
        this.onDriftChange({
          driftSeconds: this.driftSeconds,
          driftDelta,
          cause: 'command_timing',
          command: command.id,
          grade: grade.id,
        });
      }
    }

    // Emit hit event
    if (this.onCommandHit) {
      this.onCommandHit({
        command,
        grade,
        timing: command.timing,
        streak: this.stats.currentStreak,
        driftDelta,
      });
    }

    this.logger?.log(currentGetSeconds, `Command ${command.commandId} executed: ${grade.name}`, {
      logSource: 'sim',
      logCategory: 'timing',
      logSeverity: grade.id === 'MISS' || grade.id === 'LATE' ? 'warning' : 'notice',
      commandId: command.commandId,
      grade: grade.id,
      deltaMs: command.timing.deltaMs,
      streak: this.stats.currentStreak,
    });

    return {
      success: true,
      grade,
      timing: command.timing,
      streak: this.stats.currentStreak,
      driftDelta,
    };
  }

  /**
   * Get commands currently in the active window
   */
  getActiveCommands() {
    return this.activeCommands.map((cmd) => ({
      id: cmd.id,
      commandId: cmd.commandId,
      type: cmd.type,
      lane: cmd.lane,
      description: cmd.description,
      targetGetSeconds: cmd.targetGetSeconds,
      targetGet: formatGET(cmd.targetGetSeconds),
      panel: cmd.panel,
      control: cmd.control,
      expectedState: cmd.expectedState,
      priority: cmd.priority,
      crewRole: cmd.crewRole,
    }));
  }

  /**
   * Get upcoming commands (in look-ahead window)
   */
  getUpcomingCommands(currentGetSeconds, limit = 10) {
    const windowEnd = currentGetSeconds + this.lookAheadSeconds;
    return this.pendingCommands
      .filter((cmd) => cmd.targetGetSeconds <= windowEnd)
      .slice(0, limit)
      .map((cmd) => ({
        id: cmd.id,
        commandId: cmd.commandId,
        type: cmd.type,
        lane: cmd.lane,
        description: cmd.description,
        targetGetSeconds: cmd.targetGetSeconds,
        targetGet: formatGET(cmd.targetGetSeconds),
        secondsUntil: cmd.targetGetSeconds - currentGetSeconds,
        panel: cmd.panel,
        control: cmd.control,
        crewRole: cmd.crewRole,
      }));
  }

  /**
   * Get the command timeline for rendering (DDR-style scrolling display)
   */
  getTimeline(currentGetSeconds, windowSeconds = 15) {
    const windowStart = currentGetSeconds - 5; // Show some past commands
    const windowEnd = currentGetSeconds + windowSeconds;

    const timeline = [];

    // Add completed recent commands (fading out)
    for (const cmd of this.completedCommands.slice(-10)) {
      if (cmd.executedAtSeconds >= windowStart) {
        timeline.push({
          ...this.#formatTimelineCommand(cmd, currentGetSeconds),
          status: 'completed',
          grade: cmd.grade,
        });
      }
    }

    // Add missed recent commands
    for (const cmd of this.missedCommands.slice(-5)) {
      if (cmd.missedAtSeconds >= windowStart) {
        timeline.push({
          ...this.#formatTimelineCommand(cmd, currentGetSeconds),
          status: 'missed',
          grade: 'MISS',
        });
      }
    }

    // Add active commands (in window)
    for (const cmd of this.activeCommands) {
      timeline.push({
        ...this.#formatTimelineCommand(cmd, currentGetSeconds),
        status: 'active',
      });
    }

    // Add upcoming commands
    for (const cmd of this.pendingCommands) {
      if (cmd.targetGetSeconds > windowEnd) {
        break;
      }
      if (cmd.targetGetSeconds >= currentGetSeconds) {
        timeline.push({
          ...this.#formatTimelineCommand(cmd, currentGetSeconds),
          status: 'pending',
        });
      }
    }

    // Sort by target time
    timeline.sort((a, b) => a.targetGetSeconds - b.targetGetSeconds);

    return {
      currentGetSeconds,
      windowStart,
      windowEnd,
      commands: timeline,
      drift: {
        seconds: this.driftSeconds,
        formatted: this.#formatDrift(),
        severity: this.#getDriftSeverity(),
      },
      stats: this.getStats(),
    };
  }

  /**
   * Get current stats
   */
  getStats() {
    return {
      ...this.stats,
      driftSeconds: this.driftSeconds,
      driftFormatted: this.#formatDrift(),
      accuracy: this.stats.totalCommands > 0
        ? (this.stats.perfect + this.stats.great + this.stats.good) / this.stats.totalCommands
        : 1,
      perfectRate: this.stats.totalCommands > 0
        ? this.stats.perfect / this.stats.totalCommands
        : 0,
    };
  }

  /**
   * Get current drift status
   */
  getDrift() {
    return {
      seconds: this.driftSeconds,
      formatted: this.#formatDrift(),
      severity: this.#getDriftSeverity(),
      maxSeconds: this.maxDriftSeconds,
      percentOfMax: Math.min(1, Math.abs(this.driftSeconds) / this.maxDriftSeconds),
    };
  }

  /**
   * Set auto mode (autopilot executes commands automatically)
   */
  setAutoMode(enabled) {
    this.autoMode = enabled;
  }

  /**
   * Reset drift (for recovery scenarios)
   */
  resetDrift(amount = null) {
    if (amount === null) {
      this.driftSeconds = 0;
    } else {
      this.driftSeconds -= amount;
    }
  }

  /**
   * Serialize state for persistence
   */
  serialize() {
    return {
      pendingCommands: deepClone(this.pendingCommands),
      activeCommands: deepClone(this.activeCommands),
      completedCommands: deepClone(this.completedCommands.slice(-100)),
      missedCommands: deepClone(this.missedCommands.slice(-50)),
      driftSeconds: this.driftSeconds,
      stats: { ...this.stats },
      _nextId: this._nextId,
    };
  }

  /**
   * Load state from persistence
   */
  deserialize(data) {
    if (!data) return;
    this.pendingCommands = data.pendingCommands ?? [];
    this.activeCommands = data.activeCommands ?? [];
    this.completedCommands = data.completedCommands ?? [];
    this.missedCommands = data.missedCommands ?? [];
    this.driftSeconds = data.driftSeconds ?? 0;
    this.stats = { ...this.stats, ...(data.stats ?? {}) };
    this._nextId = data._nextId ?? 0;
  }

  // Private methods

  #normalizeCommand(raw) {
    const id = raw.id ?? `cmd_${this._nextId++}`;
    const targetSeconds = this.#parseGetSeconds(raw.get ?? raw.getSeconds ?? raw.targetGetSeconds ?? 0);
    const crewRole = raw.crewRole ?? raw.crew_role ?? 'Joint';
    const commandType = raw.type ?? 'SWITCH';
    const typeInfo = COMMAND_TYPES[commandType] ?? COMMAND_TYPES.SWITCH;

    return {
      id,
      commandId: raw.commandId ?? raw.command_id ?? raw.controlId ?? id,
      type: commandType,
      lane: raw.lane ?? CREW_ROLE_TO_LANE[crewRole] ?? COMMAND_LANES.JOINT,
      description: raw.description ?? raw.action ?? '',
      targetGetSeconds: targetSeconds,
      windowOverrideMs: raw.windowMs ?? raw.window_ms ?? null,
      panel: raw.panel ?? raw.panelId ?? null,
      control: raw.control ?? raw.controlId ?? null,
      expectedState: raw.expectedState ?? raw.expected_state ?? raw.stateId ?? null,
      expectedValue: raw.expectedValue ?? raw.expected_value ?? null,
      crewRole,
      priority: raw.priority ?? 'normal',
      criticality: raw.criticality ?? typeInfo.criticality ?? 'normal',
      driftWeight: raw.driftWeight ?? raw.drift_weight ?? this.#getCriticalityWeight(typeInfo.criticality),
      audioHint: raw.audioHint ?? raw.audio_hint ?? null,
      prerequisites: raw.prerequisites ?? [],
      // DSKY-specific fields
      verb: raw.verb ?? null,
      noun: raw.noun ?? null,
      // RCS-specific fields
      axis: raw.axis ?? null,
      magnitude: raw.magnitude ?? null,
      // Visual fields
      typeIcon: typeInfo.icon,
      typeColor: typeInfo.color,
    };
  }

  #getCriticalityWeight(criticality) {
    switch (criticality) {
      case 'critical': return 3.0;
      case 'high': return 2.0;
      case 'normal': return 1.0;
      case 'low': return 0.5;
      default: return 1.0;
    }
  }

  #parseGetSeconds(value) {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      // Parse HH:MM:SS format
      const parts = value.split(':').map(Number);
      if (parts.length === 3) {
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
      }
      return parseFloat(value) || 0;
    }
    return 0;
  }

  #activatePendingCommands(currentGetSeconds) {
    const windowEnd = currentGetSeconds + this.lookAheadSeconds;

    while (this.pendingCommands.length > 0) {
      const cmd = this.pendingCommands[0];

      // If command is in the future beyond look-ahead, stop
      if (cmd.targetGetSeconds > windowEnd) {
        break;
      }

      // Move to active
      this.pendingCommands.shift();
      this.activeCommands.push(cmd);
    }
  }

  #checkMissedCommands(currentGetSeconds) {
    const missWindow = TIMING_GRADES.LATE.windowMs / 1000;

    for (let i = this.activeCommands.length - 1; i >= 0; i--) {
      const cmd = this.activeCommands[i];
      const timeSinceTarget = currentGetSeconds - cmd.targetGetSeconds;

      if (timeSinceTarget > missWindow) {
        // Command was missed
        this.activeCommands.splice(i, 1);

        cmd.missedAtSeconds = currentGetSeconds;
        cmd.grade = 'MISS';
        this.missedCommands.push(cmd);

        this.stats.missed += 1;
        this.stats.currentStreak = 0;

        // Apply full drift penalty
        const driftDelta = cmd.driftWeight * TIMING_GRADES.MISS.driftFactor * 10;
        this.driftSeconds += driftDelta;
        this.stats.totalDriftAccumulated += driftDelta;

        if (this.onCommandMiss) {
          this.onCommandMiss({
            command: cmd,
            driftDelta,
            totalDrift: this.driftSeconds,
          });
        }

        if (this.onDriftChange) {
          this.onDriftChange({
            driftSeconds: this.driftSeconds,
            driftDelta,
            cause: 'missed_command',
            command: cmd.id,
          });
        }

        this.logger?.log(currentGetSeconds, `Command ${cmd.commandId} MISSED`, {
          logSource: 'sim',
          logCategory: 'timing',
          logSeverity: 'warning',
          commandId: cmd.commandId,
          targetGet: formatGET(cmd.targetGetSeconds),
          driftDelta,
        });
      }
    }
  }

  #autoExecuteCommands(currentGetSeconds) {
    // In auto mode, execute commands at their target time (perfectly)
    for (let i = this.activeCommands.length - 1; i >= 0; i--) {
      const cmd = this.activeCommands[i];

      if (currentGetSeconds >= cmd.targetGetSeconds) {
        this.executeCommand(cmd.type, cmd.commandId, cmd.targetGetSeconds, {
          auto: true,
        });
      }
    }
  }

  #calculateGrade(command, currentGetSeconds) {
    const deltaMs = Math.abs(currentGetSeconds - command.targetGetSeconds) * 1000;

    // Get phase and type multipliers
    const phaseMult = MISSION_PHASES[this.missionPhase]?.windowMult ?? 1.0;
    const typeInfo = COMMAND_TYPES[command.type];
    const typeMult = typeInfo?.defaultWindowMult ?? 1.0;

    // Use custom window if specified, otherwise apply multipliers
    const windowOverride = command.windowOverrideMs;

    for (const grade of Object.values(TIMING_GRADES)) {
      let window;
      if (windowOverride) {
        window = windowOverride * (grade.windowMs / TIMING_GRADES.PERFECT.windowMs);
      } else {
        // Purist mode uses tighter windows, non-purist relaxes them
        const puristMult = this.puristMode ? 1.0 : 1.5;
        window = grade.windowMs * phaseMult * typeMult * puristMult;
      }

      if (deltaMs <= window) {
        return grade;
      }
    }

    return TIMING_GRADES.MISS;
  }

  #calculateDrift(command, grade, currentGetSeconds) {
    const delta = currentGetSeconds - command.targetGetSeconds;
    const baseDrift = delta * grade.driftFactor * command.driftWeight;

    // Late commands add drift, early commands can slightly reduce drift
    if (delta > 0) {
      return Math.max(0, baseDrift);
    } else {
      // Early execution can recover a tiny bit of drift
      return Math.min(0, baseDrift * 0.1);
    }
  }

  #formatTimelineCommand(cmd, currentGetSeconds) {
    const typeInfo = COMMAND_TYPES[cmd.type] ?? COMMAND_TYPES.SWITCH;

    return {
      id: cmd.id,
      commandId: cmd.commandId,
      type: cmd.type,
      typeIcon: typeInfo.icon,
      typeColor: typeInfo.color,
      typeName: typeInfo.name,
      lane: cmd.lane,
      description: cmd.description,
      targetGetSeconds: cmd.targetGetSeconds,
      targetGet: formatGET(cmd.targetGetSeconds),
      secondsFromNow: cmd.targetGetSeconds - currentGetSeconds,
      panel: cmd.panel,
      control: cmd.control,
      expectedState: cmd.expectedState,
      crewRole: cmd.crewRole,
      priority: cmd.priority,
    };
  }

  #formatDrift() {
    const absSeconds = Math.abs(this.driftSeconds);
    const sign = this.driftSeconds >= 0 ? '+' : '-';

    if (absSeconds < 60) {
      return `${sign}${absSeconds.toFixed(1)}s`;
    }

    const minutes = Math.floor(absSeconds / 60);
    const seconds = Math.floor(absSeconds % 60);
    return `${sign}${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  #getDriftSeverity() {
    const absSeconds = Math.abs(this.driftSeconds);

    if (absSeconds < 10) return 'nominal';
    if (absSeconds < 30) return 'minor';
    if (absSeconds < 60) return 'moderate';
    if (absSeconds < 180) return 'significant';
    return 'critical';
  }
}

export { TIMING_GRADES, COMMAND_TYPES, COMMAND_LANES, CREW_ROLE_TO_LANE, MISSION_PHASES };
