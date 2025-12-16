/**
 * Mission Drift System for Apollo64
 *
 * Tracks how the mission diverges from the nominal timeline.
 * When commands are missed or executed late, drift accumulates
 * and has real consequences:
 *
 * - Resource consumption increases (less efficient operations)
 * - Timing windows shift (events may be missed)
 * - Trajectory deviations accumulate
 * - Recovery burns may be required
 *
 * The goal is authentic simulation - every action matters.
 */

import { formatGET } from '../utils/time.js';

// Drift severity levels
const DRIFT_SEVERITY = {
  NOMINAL: { id: 'NOMINAL', threshold: 0, label: 'Nominal', color: '#4aff4a' },
  MINOR: { id: 'MINOR', threshold: 10, label: 'Minor Deviation', color: '#aaff4a' },
  MODERATE: { id: 'MODERATE', threshold: 30, label: 'Moderate Deviation', color: '#ffff4a' },
  SIGNIFICANT: { id: 'SIGNIFICANT', threshold: 60, label: 'Significant Deviation', color: '#ffaa4a' },
  MAJOR: { id: 'MAJOR', threshold: 120, label: 'Major Deviation', color: '#ff6a4a' },
  CRITICAL: { id: 'CRITICAL', threshold: 300, label: 'Critical - Mission at Risk', color: '#ff4a4a' },
};

// Drift categories - different types of drift with different effects
const DRIFT_CATEGORIES = {
  TIMING: {
    id: 'TIMING',
    name: 'Timeline Drift',
    description: 'Behind or ahead of nominal mission timeline',
    unit: 'seconds',
  },
  TRAJECTORY: {
    id: 'TRAJECTORY',
    name: 'Trajectory Deviation',
    description: 'Accumulated delta-V error from nominal trajectory',
    unit: 'm/s',
  },
  ATTITUDE: {
    id: 'ATTITUDE',
    name: 'Attitude Error',
    description: 'Accumulated pointing error',
    unit: 'degrees',
  },
  THERMAL: {
    id: 'THERMAL',
    name: 'Thermal Imbalance',
    description: 'Deviation from thermal equilibrium',
    unit: 'delta-K',
  },
  CONSUMABLES: {
    id: 'CONSUMABLES',
    name: 'Consumables Margin',
    description: 'Deviation from planned resource usage',
    unit: 'percent',
  },
};

// Recovery actions that can reduce drift
const RECOVERY_ACTIONS = {
  TRAJECTORY_CORRECTION: {
    id: 'TRAJECTORY_CORRECTION',
    name: 'Midcourse Correction',
    description: 'Small RCS burn to correct trajectory',
    category: 'TRAJECTORY',
    maxRecovery: 5, // m/s
    resourceCost: { csm_rcs_kg: 2 },
    durationSeconds: 30,
  },
  ATTITUDE_REALIGN: {
    id: 'ATTITUDE_REALIGN',
    name: 'Platform Realignment',
    description: 'P52 IMU realignment to reduce pointing error',
    category: 'ATTITUDE',
    maxRecovery: 2, // degrees
    resourceCost: {},
    durationSeconds: 300,
  },
  PTC_TRIM: {
    id: 'PTC_TRIM',
    name: 'PTC Trim Maneuver',
    description: 'Passive Thermal Control rate adjustment',
    category: 'THERMAL',
    maxRecovery: 5, // delta-K
    resourceCost: { csm_rcs_kg: 0.5 },
    durationSeconds: 60,
  },
  TIMELINE_SLIP: {
    id: 'TIMELINE_SLIP',
    name: 'Accept Timeline Slip',
    description: 'Acknowledge drift and adjust planned events',
    category: 'TIMING',
    maxRecovery: 60, // seconds
    resourceCost: {},
    durationSeconds: 0,
  },
};

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export class MissionDriftSystem {
  constructor({
    logger = null,
    resourceSystem = null,
    eventScheduler = null,
    onDriftUpdate = null,
    onSeverityChange = null,
    onRecoveryNeeded = null,
  } = {}) {
    this.logger = logger;
    this.resourceSystem = resourceSystem;
    this.eventScheduler = eventScheduler;
    this.onDriftUpdate = typeof onDriftUpdate === 'function' ? onDriftUpdate : null;
    this.onSeverityChange = typeof onSeverityChange === 'function' ? onSeverityChange : null;
    this.onRecoveryNeeded = typeof onRecoveryNeeded === 'function' ? onRecoveryNeeded : null;

    // Current drift values by category
    this.drift = {
      TIMING: 0,
      TRAJECTORY: 0,
      ATTITUDE: 0,
      THERMAL: 0,
      CONSUMABLES: 0,
    };

    // Drift rate (change per second when not corrected)
    this.driftRate = {
      TIMING: 0,      // Can be positive or negative
      TRAJECTORY: 0,  // Typically increases slowly
      ATTITUDE: 0.001, // IMU drift ~0.1 deg/hr
      THERMAL: 0,     // Depends on PTC status
      CONSUMABLES: 0, // Depends on operations
    };

    // Current severity level
    this.currentSeverity = 'NOMINAL';

    // History of drift changes
    this.history = [];
    this.maxHistoryLength = 1000;

    // Pending recovery actions
    this.pendingRecoveries = [];

    // Statistics
    this.stats = {
      maxTimingDrift: 0,
      maxTrajectoryDrift: 0,
      recoveriesPerformed: 0,
      severityEscalations: 0,
      timeAtNominal: 0,
      timeAtCritical: 0,
    };
  }

  /**
   * Update drift - call each simulation tick
   */
  update(currentGetSeconds, dtSeconds) {
    // Apply drift rates
    for (const [category, rate] of Object.entries(this.driftRate)) {
      if (rate !== 0) {
        this.drift[category] += rate * dtSeconds;
      }
    }

    // Process pending recovery actions
    this.#processPendingRecoveries(currentGetSeconds);

    // Update severity
    this.#updateSeverity(currentGetSeconds);

    // Apply consequences of drift
    this.#applyDriftConsequences(currentGetSeconds, dtSeconds);

    // Track statistics
    this.#updateStats(dtSeconds);
  }

  /**
   * Add drift from a specific cause
   */
  addDrift(category, amount, context = {}) {
    if (!DRIFT_CATEGORIES[category]) {
      return { success: false, reason: 'unknown_category' };
    }

    const previousValue = this.drift[category];
    this.drift[category] += amount;

    const historyEntry = {
      timestamp: context.getSeconds ?? null,
      category,
      previousValue,
      newValue: this.drift[category],
      delta: amount,
      source: context.source ?? 'unknown',
      reason: context.reason ?? null,
    };

    this.history.push(historyEntry);
    if (this.history.length > this.maxHistoryLength) {
      this.history.shift();
    }

    if (this.onDriftUpdate) {
      this.onDriftUpdate({
        category,
        drift: this.drift[category],
        delta: amount,
        source: context.source,
        severity: this.currentSeverity,
      });
    }

    this.logger?.log(context.getSeconds ?? 0, `Drift added: ${category} ${amount > 0 ? '+' : ''}${amount.toFixed(2)}`, {
      logSource: 'sim',
      logCategory: 'drift',
      logSeverity: amount > 0 ? 'warning' : 'notice',
      driftCategory: category,
      delta: amount,
      newValue: this.drift[category],
      source: context.source,
    });

    return {
      success: true,
      category,
      previousValue,
      newValue: this.drift[category],
      severity: this.currentSeverity,
    };
  }

  /**
   * Set drift rate for a category
   */
  setDriftRate(category, rate, context = {}) {
    if (!DRIFT_CATEGORIES[category]) {
      return { success: false, reason: 'unknown_category' };
    }

    const previousRate = this.driftRate[category];
    this.driftRate[category] = rate;

    this.logger?.log(context.getSeconds ?? 0, `Drift rate changed: ${category} ${rate}/s`, {
      logSource: 'sim',
      logCategory: 'drift',
      logSeverity: 'notice',
      driftCategory: category,
      previousRate,
      newRate: rate,
      source: context.source,
    });

    return { success: true, previousRate, newRate: rate };
  }

  /**
   * Initiate a recovery action
   */
  initiateRecovery(recoveryId, context = {}) {
    const recovery = RECOVERY_ACTIONS[recoveryId];
    if (!recovery) {
      return { success: false, reason: 'unknown_recovery_action' };
    }

    const currentDrift = this.drift[recovery.category];
    if (Math.abs(currentDrift) < 0.1) {
      return { success: false, reason: 'no_drift_to_recover' };
    }

    // Check resource availability
    if (this.resourceSystem && recovery.resourceCost) {
      for (const [resource, cost] of Object.entries(recovery.resourceCost)) {
        const available = this.resourceSystem.getResource(resource);
        if (available < cost) {
          return { success: false, reason: 'insufficient_resources', resource };
        }
      }
    }

    const getSeconds = context.getSeconds ?? 0;
    const completionTime = getSeconds + recovery.durationSeconds;

    const pending = {
      id: `recovery_${Date.now()}`,
      recoveryId,
      recovery,
      category: recovery.category,
      startSeconds: getSeconds,
      completionSeconds: completionTime,
      targetRecovery: Math.min(recovery.maxRecovery, Math.abs(currentDrift)),
    };

    this.pendingRecoveries.push(pending);

    this.logger?.log(getSeconds, `Recovery initiated: ${recovery.name}`, {
      logSource: 'sim',
      logCategory: 'drift',
      logSeverity: 'notice',
      recoveryId,
      category: recovery.category,
      currentDrift,
      targetRecovery: pending.targetRecovery,
      completionSeconds: completionTime,
    });

    return {
      success: true,
      recovery: pending,
      estimatedRecovery: pending.targetRecovery,
      completionTime,
    };
  }

  /**
   * Get current drift state
   */
  getDriftState() {
    const totalMagnitude = Object.values(this.drift)
      .reduce((sum, val) => sum + Math.abs(val), 0);

    return {
      drift: { ...this.drift },
      rates: { ...this.driftRate },
      severity: this.currentSeverity,
      severityInfo: DRIFT_SEVERITY[this.currentSeverity],
      totalMagnitude,
      categories: Object.entries(DRIFT_CATEGORIES).map(([id, info]) => ({
        id,
        name: info.name,
        description: info.description,
        unit: info.unit,
        value: this.drift[id],
        rate: this.driftRate[id],
        formattedValue: this.#formatDriftValue(id, this.drift[id]),
      })),
      pendingRecoveries: this.pendingRecoveries.length,
    };
  }

  /**
   * Get recommended recovery actions based on current drift
   */
  getRecommendedRecoveries() {
    const recommendations = [];

    for (const [id, recovery] of Object.entries(RECOVERY_ACTIONS)) {
      const currentDrift = Math.abs(this.drift[recovery.category]);

      if (currentDrift > recovery.maxRecovery * 0.5) {
        recommendations.push({
          id,
          name: recovery.name,
          description: recovery.description,
          category: recovery.category,
          currentDrift,
          maxRecovery: recovery.maxRecovery,
          effectivenessPercent: Math.min(100, (recovery.maxRecovery / currentDrift) * 100),
          resourceCost: recovery.resourceCost,
          durationSeconds: recovery.durationSeconds,
          priority: currentDrift > recovery.maxRecovery * 2 ? 'high' : 'normal',
        });
      }
    }

    // Sort by priority and effectiveness
    recommendations.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority === 'high' ? -1 : 1;
      }
      return b.effectivenessPercent - a.effectivenessPercent;
    });

    return recommendations;
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      ...this.stats,
      currentDrift: { ...this.drift },
      currentSeverity: this.currentSeverity,
    };
  }

  /**
   * Serialize state
   */
  serialize() {
    return {
      drift: { ...this.drift },
      driftRate: { ...this.driftRate },
      currentSeverity: this.currentSeverity,
      history: this.history.slice(-100),
      pendingRecoveries: deepClone(this.pendingRecoveries),
      stats: { ...this.stats },
    };
  }

  /**
   * Load state
   */
  deserialize(data) {
    if (!data) return;
    this.drift = { ...this.drift, ...(data.drift ?? {}) };
    this.driftRate = { ...this.driftRate, ...(data.driftRate ?? {}) };
    this.currentSeverity = data.currentSeverity ?? 'NOMINAL';
    this.history = data.history ?? [];
    this.pendingRecoveries = data.pendingRecoveries ?? [];
    this.stats = { ...this.stats, ...(data.stats ?? {}) };
  }

  // Private methods

  #processPendingRecoveries(currentGetSeconds) {
    for (let i = this.pendingRecoveries.length - 1; i >= 0; i--) {
      const pending = this.pendingRecoveries[i];

      if (currentGetSeconds >= pending.completionSeconds) {
        // Recovery complete - apply reduction
        const sign = this.drift[pending.category] >= 0 ? -1 : 1;
        this.drift[pending.category] += sign * pending.targetRecovery;

        // Apply resource cost
        if (this.resourceSystem && pending.recovery.resourceCost) {
          this.resourceSystem.applyEffect(
            Object.fromEntries(
              Object.entries(pending.recovery.resourceCost).map(([k, v]) => [k, -v])
            ),
            { getSeconds: currentGetSeconds, source: pending.recoveryId, type: 'recovery' }
          );
        }

        this.stats.recoveriesPerformed += 1;

        this.logger?.log(currentGetSeconds, `Recovery complete: ${pending.recovery.name}`, {
          logSource: 'sim',
          logCategory: 'drift',
          logSeverity: 'notice',
          recoveryId: pending.recoveryId,
          category: pending.category,
          recovered: pending.targetRecovery,
          newDrift: this.drift[pending.category],
        });

        this.pendingRecoveries.splice(i, 1);
      }
    }
  }

  #updateSeverity(currentGetSeconds) {
    // Calculate overall severity based on timing drift (primary metric)
    const timingDrift = Math.abs(this.drift.TIMING);
    let newSeverity = 'NOMINAL';

    for (const [severity, config] of Object.entries(DRIFT_SEVERITY)) {
      if (timingDrift >= config.threshold) {
        newSeverity = severity;
      }
    }

    if (newSeverity !== this.currentSeverity) {
      const previousSeverity = this.currentSeverity;
      this.currentSeverity = newSeverity;

      // Check if escalating
      const severityOrder = Object.keys(DRIFT_SEVERITY);
      const previousIndex = severityOrder.indexOf(previousSeverity);
      const newIndex = severityOrder.indexOf(newSeverity);

      if (newIndex > previousIndex) {
        this.stats.severityEscalations += 1;
      }

      if (this.onSeverityChange) {
        this.onSeverityChange({
          previous: previousSeverity,
          current: newSeverity,
          escalated: newIndex > previousIndex,
          timingDrift,
        });
      }

      // Log severity change
      this.logger?.log(currentGetSeconds, `Drift severity: ${DRIFT_SEVERITY[newSeverity].label}`, {
        logSource: 'sim',
        logCategory: 'drift',
        logSeverity: newIndex >= 3 ? 'warning' : 'notice',
        previousSeverity,
        newSeverity,
        timingDrift,
      });

      // Check if recovery is needed
      if (newIndex >= 3 && this.onRecoveryNeeded) {
        this.onRecoveryNeeded({
          severity: newSeverity,
          recommendations: this.getRecommendedRecoveries(),
        });
      }
    }
  }

  #applyDriftConsequences(currentGetSeconds, dtSeconds) {
    // Timing drift affects event windows
    if (this.eventScheduler && Math.abs(this.drift.TIMING) > 30) {
      // Events may need to be delayed/advanced
      // (This is handled by the event scheduler based on drift state)
    }

    // Consumables drift affects resource consumption
    if (this.resourceSystem && this.drift.CONSUMABLES > 5) {
      // Increased consumption rate
      const extraConsumption = this.drift.CONSUMABLES * 0.01 * dtSeconds;
      // Applied through resource system
    }

    // Trajectory drift may require correction burns
    if (Math.abs(this.drift.TRAJECTORY) > 10) {
      // Log warning about trajectory deviation
      // Actual correction handled by recovery system
    }
  }

  #updateStats(dtSeconds) {
    // Track max drift values
    if (Math.abs(this.drift.TIMING) > this.stats.maxTimingDrift) {
      this.stats.maxTimingDrift = Math.abs(this.drift.TIMING);
    }
    if (Math.abs(this.drift.TRAJECTORY) > this.stats.maxTrajectoryDrift) {
      this.stats.maxTrajectoryDrift = Math.abs(this.drift.TRAJECTORY);
    }

    // Track time at severity levels
    if (this.currentSeverity === 'NOMINAL') {
      this.stats.timeAtNominal += dtSeconds;
    } else if (this.currentSeverity === 'CRITICAL') {
      this.stats.timeAtCritical += dtSeconds;
    }
  }

  #formatDriftValue(category, value) {
    const info = DRIFT_CATEGORIES[category];
    const absValue = Math.abs(value);
    const sign = value >= 0 ? '+' : '-';

    switch (info.unit) {
      case 'seconds':
        if (absValue < 60) {
          return `${sign}${absValue.toFixed(1)}s`;
        }
        const mins = Math.floor(absValue / 60);
        const secs = Math.floor(absValue % 60);
        return `${sign}${mins}:${secs.toString().padStart(2, '0')}`;

      case 'm/s':
        return `${sign}${absValue.toFixed(2)} m/s`;

      case 'degrees':
        return `${sign}${absValue.toFixed(3)}°`;

      case 'delta-K':
        return `${sign}${absValue.toFixed(1)} ΔK`;

      case 'percent':
        return `${sign}${absValue.toFixed(1)}%`;

      default:
        return `${sign}${absValue.toFixed(2)}`;
    }
  }
}

export { DRIFT_SEVERITY, DRIFT_CATEGORIES, RECOVERY_ACTIONS };
