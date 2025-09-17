const DEFAULT_WEIGHTS = {
  events: 0.4,
  resources: 0.3,
  faults: 0.2,
  manual: 0.1,
};

const DEFAULT_RESOURCE_WEIGHTS = {
  power: 0.5,
  deltaV: 0.3,
  thermal: 0.2,
};

const DEFAULT_OPTIONS = {
  powerIdealPct: 55,
  powerWarningPct: 25,
  deltaVIdealMps: 0,
  deltaVFailureMps: -120,
  thermalViolationRate: 2.0,
  thermalCriticalSeconds: 3600,
  faultBaseline: 6,
  minTrackingEpsilon: 1e-6,
};

export class ScoreSystem {
  constructor(
    {
      resourceSystem = null,
      scheduler = null,
      autopilotRunner = null,
      checklistManager = null,
      manualQueue = null,
    } = {},
    options = {},
  ) {
    const { weights, resourceWeights, ...restOptions } = options ?? {};

    this.options = { ...DEFAULT_OPTIONS, ...restOptions };
    this.weights = this.#normalizeWeightMap(weights ?? DEFAULT_WEIGHTS, DEFAULT_WEIGHTS);
    this.resourceWeights = this.#normalizeWeightMap(
      resourceWeights ?? DEFAULT_RESOURCE_WEIGHTS,
      DEFAULT_RESOURCE_WEIGHTS,
    );

    this.resourceSystem = resourceSystem;
    this.scheduler = scheduler;
    this.autopilotRunner = autopilotRunner;
    this.checklistManager = checklistManager;
    this.manualQueue = manualQueue;

    this.eventStatus = new Map();
    this.initializedEvents = false;
    this.totalEvents = 0;
    this.completedEvents = 0;
    this.failedEvents = 0;
    this.commsEvents = { total: 0, completed: 0, failed: 0 };

    this.minPowerMarginPct = Infinity;
    this.maxPowerMarginPct = -Infinity;
    this.minDeltaVMarginMps = Infinity;
    this.maxDeltaVMarginMps = -Infinity;
    this.thermalViolationSeconds = 0;
    this.thermalViolationEvents = 0;
    this.thermalViolationActive = false;

    this.missionDurationSeconds = 0;
    this.lastUpdateGetSeconds = null;
  }

  attachManualQueue(manualQueue) {
    this.manualQueue = manualQueue;
  }

  attachScheduler(scheduler) {
    this.scheduler = scheduler;
    this.initializedEvents = false;
  }

  update(
    currentGetSeconds,
    dtSeconds = 0,
    {
      resourceSystem = null,
      scheduler = null,
      autopilotRunner = null,
      checklistManager = null,
      manualQueue = null,
    } = {},
  ) {
    if (resourceSystem) {
      this.resourceSystem = resourceSystem;
    }
    if (scheduler) {
      if (scheduler !== this.scheduler) {
        this.scheduler = scheduler;
        this.initializedEvents = false;
      }
    }
    if (autopilotRunner) {
      this.autopilotRunner = autopilotRunner;
    }
    if (checklistManager) {
      this.checklistManager = checklistManager;
    }
    if (manualQueue) {
      this.manualQueue = manualQueue;
    }

    if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) {
      if (Number.isFinite(this.lastUpdateGetSeconds)) {
        dtSeconds = Math.max(0, currentGetSeconds - this.lastUpdateGetSeconds);
      } else {
        dtSeconds = 0;
      }
    }

    this.lastUpdateGetSeconds = currentGetSeconds;
    if (Number.isFinite(currentGetSeconds)) {
      this.missionDurationSeconds = Math.max(this.missionDurationSeconds, currentGetSeconds);
    }

    this.#ensureInitialized();
    this.#updateResourceMetrics(dtSeconds);
    this.#updateEventStatus();
  }

  summary() {
    const resourceSnapshot = this.resourceSystem?.snapshot?.() ?? null;
    const metrics = resourceSnapshot?.metrics ?? null;
    const propellantDelta = metrics?.propellantDeltaKg ?? {};
    const powerDelta = metrics?.powerDeltaKw ?? {};
    const resourceFailureEntries = Array.isArray(resourceSnapshot?.failures)
      ? resourceSnapshot.failures
      : [];
    const resourceFailureIds = resourceFailureEntries
      .map((failure) => (failure && typeof failure === 'object' ? failure.id ?? null : failure))
      .filter((id) => typeof id === 'string' && id.length > 0);
    const uniqueResourceFailureIds = Array.from(new Set(resourceFailureIds));
    const autopilotStats = this.autopilotRunner?.stats?.() ?? null;

    const checklistStats = this.checklistManager?.stats?.() ?? null;
    const checklistTotals = checklistStats?.totals ?? {};
    const manualSteps = checklistTotals.manualSteps ?? 0;
    const autoSteps = checklistTotals.autoSteps ?? 0;
    const acknowledgedSteps = checklistTotals.acknowledgedSteps ?? manualSteps + autoSteps;
    const totalSteps = acknowledgedSteps;
    const manualFraction = totalSteps > 0 ? manualSteps / totalSteps : 0;
    const manualScore = totalSteps > 0 ? clamp(manualFraction, 0, 1) : 0;

    const eventCompletionRate = this.totalEvents > 0 ? this.completedEvents / this.totalEvents : 1;
    const eventScore = clamp(eventCompletionRate, 0, 1);

    const faultCount = this.failedEvents + uniqueResourceFailureIds.length;
    const faultScore = this.#computeFaultScore(faultCount);
    const resourceScore = this.#computeResourceScore();

    const baseScore =
      (eventScore * this.weights.events +
        resourceScore * this.weights.resources +
        faultScore * this.weights.faults) *
      100;
    const manualBonus = manualScore * this.weights.manual * 100;
    const commanderScore = clamp(baseScore + manualBonus, 0, 100);

    const eventsPending = Math.max(
      0,
      this.totalEvents - (this.completedEvents + this.failedEvents),
    );
    const completionRatePct = this.totalEvents > 0
      ? this.#round(eventCompletionRate * 100, 1)
      : null;
    const commHitRate = this.commsEvents.total > 0
      ? this.#round((this.commsEvents.completed / this.commsEvents.total) * 100, 1)
      : null;

    const manualFractionRounded = totalSteps > 0 ? this.#round(manualFraction, 3) : null;

    return {
      missionDurationSeconds: this.#round(this.missionDurationSeconds, 3),
      events: {
        total: this.totalEvents,
        completed: this.completedEvents,
        failed: this.failedEvents,
        pending: eventsPending,
        completionRatePct,
      },
      comms: {
        total: this.commsEvents.total,
        completed: this.commsEvents.completed,
        failed: this.commsEvents.failed,
        hitRatePct: commHitRate,
      },
      resources: {
        minPowerMarginPct: this.#isFinite(this.minPowerMarginPct)
          ? this.#round(this.minPowerMarginPct, 1)
          : null,
        maxPowerMarginPct: this.#isFinite(this.maxPowerMarginPct)
          ? this.#round(this.maxPowerMarginPct, 1)
          : null,
        minDeltaVMarginMps: this.#isFinite(this.minDeltaVMarginMps)
          ? this.#round(this.minDeltaVMarginMps, 1)
          : null,
        maxDeltaVMarginMps: this.#isFinite(this.maxDeltaVMarginMps)
          ? this.#round(this.maxDeltaVMarginMps, 1)
          : null,
        thermalViolationSeconds: this.#round(this.thermalViolationSeconds, 1),
        thermalViolationEvents: this.thermalViolationEvents,
        propellantUsedKg: this.#computePropellantUsage(propellantDelta),
        powerDeltaKw: this.#roundEntries(powerDelta, 3),
      },
      faults: {
        eventFailures: this.failedEvents,
        resourceFailures: uniqueResourceFailureIds.length,
        resourceFailureIds: uniqueResourceFailureIds,
        totalFaults: faultCount,
      },
      manual: {
        manualSteps,
        autoSteps,
        totalSteps,
        manualFraction: manualFractionRounded,
      },
      rating: {
        baseScore: this.#round(baseScore, 1),
        manualBonus: this.#round(manualBonus, 1),
        commanderScore: this.#round(commanderScore, 1),
        grade: this.#grade(commanderScore),
        breakdown: {
          events: { score: this.#round(eventScore, 3), weight: this.weights.events },
          resources: { score: this.#round(resourceScore, 3), weight: this.weights.resources },
          faults: { score: this.#round(faultScore, 3), weight: this.weights.faults },
          manual: { score: this.#round(manualScore, 3), weight: this.weights.manual },
        },
      },
      autopilot: autopilotStats,
    };
  }

  #ensureInitialized() {
    if (this.initializedEvents) {
      return;
    }
    const events = this.scheduler?.events ?? null;
    if (!Array.isArray(events) || events.length === 0) {
      return;
    }

    this.eventStatus.clear();
    this.totalEvents = 0;
    this.completedEvents = 0;
    this.failedEvents = 0;
    this.commsEvents = { total: 0, completed: 0, failed: 0 };

    for (const event of events) {
      if (!event?.id) {
        continue;
      }
      this.totalEvents += 1;
      if (this.#isCommsEvent(event)) {
        this.commsEvents.total += 1;
      }
      this.eventStatus.set(event.id, event.status);
      if (event.status === 'complete') {
        this.completedEvents += 1;
        if (this.#isCommsEvent(event)) {
          this.commsEvents.completed += 1;
        }
      } else if (event.status === 'failed') {
        this.failedEvents += 1;
        if (this.#isCommsEvent(event)) {
          this.commsEvents.failed += 1;
        }
      }
    }

    this.initializedEvents = true;
  }

  #updateEventStatus() {
    const events = this.scheduler?.events ?? null;
    if (!Array.isArray(events) || events.length === 0) {
      return;
    }

    for (const event of events) {
      if (!event?.id) {
        continue;
      }
      const previous = this.eventStatus.get(event.id);
      if (previous === event.status) {
        continue;
      }

      this.eventStatus.set(event.id, event.status);

      if (event.status === 'complete') {
        this.completedEvents += 1;
        if (this.#isCommsEvent(event)) {
          this.commsEvents.completed += 1;
        }
      } else if (event.status === 'failed') {
        this.failedEvents += 1;
        if (this.#isCommsEvent(event)) {
          this.commsEvents.failed += 1;
        }
      }
    }
  }

  #updateResourceMetrics(dtSeconds) {
    const state = this.resourceSystem?.state ?? null;
    if (!state) {
      return;
    }

    const powerMargin = this.#coerceNumber(state.power_margin_pct);
    if (Number.isFinite(powerMargin)) {
      this.minPowerMarginPct = Math.min(this.minPowerMarginPct, powerMargin);
      this.maxPowerMarginPct = Math.max(this.maxPowerMarginPct, powerMargin);
    }

    const deltaV = this.#coerceNumber(state.delta_v_margin_mps);
    if (Number.isFinite(deltaV)) {
      this.minDeltaVMarginMps = Math.min(this.minDeltaVMarginMps, deltaV);
      this.maxDeltaVMarginMps = Math.max(this.maxDeltaVMarginMps, deltaV);
    }

    const cryoRate = this.#coerceNumber(state.cryo_boiloff_rate_pct_per_hr);
    const threshold = this.options.thermalViolationRate ?? DEFAULT_OPTIONS.thermalViolationRate;
    if (Number.isFinite(cryoRate) && cryoRate > threshold) {
      this.thermalViolationSeconds += dtSeconds;
      if (!this.thermalViolationActive) {
        this.thermalViolationEvents += 1;
        this.thermalViolationActive = true;
      }
    } else {
      this.thermalViolationActive = false;
    }
  }

  #computeResourceScore() {
    const weights = this.resourceWeights;
    const powerScore = this.#normalizeHighIsGood(
      this.minPowerMarginPct,
      this.options.powerWarningPct,
      this.options.powerIdealPct,
    );
    const deltaVScore = this.#normalizeDeltaV(
      this.minDeltaVMarginMps,
      this.options.deltaVFailureMps,
      this.options.deltaVIdealMps,
    );
    const thermalScore = this.#normalizeLowIsGood(
      this.thermalViolationSeconds,
      0,
      this.options.thermalCriticalSeconds,
    );

    return (
      powerScore * weights.power +
      deltaVScore * weights.deltaV +
      thermalScore * weights.thermal
    );
  }

  #computeFaultScore(faultCount) {
    if (!Number.isFinite(faultCount) || faultCount <= 0) {
      return 1;
    }
    const baseline = this.options.faultBaseline ?? DEFAULT_OPTIONS.faultBaseline;
    if (!(baseline > 0)) {
      return faultCount === 0 ? 1 : 0;
    }
    const ratio = faultCount / baseline;
    return clamp(1 - ratio, 0, 1);
  }

  #normalizeHighIsGood(value, warning, ideal) {
    if (!Number.isFinite(value)) {
      return 1;
    }
    if (Number.isFinite(ideal) && value >= ideal) {
      return 1;
    }
    if (Number.isFinite(warning) && value <= warning) {
      return 0;
    }
    if (!Number.isFinite(ideal) || !Number.isFinite(warning) || ideal === warning) {
      return 1;
    }
    const range = ideal - warning;
    if (range <= 0) {
      return value >= ideal ? 1 : 0;
    }
    return clamp((value - warning) / range, 0, 1);
  }

  #normalizeDeltaV(value, failure, ideal) {
    if (!Number.isFinite(value)) {
      return 1;
    }
    if (!Number.isFinite(failure)) {
      failure = -120;
    }
    if (!Number.isFinite(ideal)) {
      ideal = 0;
    }
    if (value >= ideal) {
      return 1;
    }
    if (value <= failure) {
      return 0;
    }
    const range = ideal - failure;
    if (range <= 0) {
      return value >= ideal ? 1 : 0;
    }
    return clamp((value - failure) / range, 0, 1);
  }

  #normalizeLowIsGood(value, minimum, maximum) {
    if (!Number.isFinite(value)) {
      return 1;
    }
    if (!Number.isFinite(maximum) || maximum <= minimum) {
      return value <= minimum ? 1 : 0;
    }
    if (value <= minimum) {
      return 1;
    }
    if (value >= maximum) {
      return 0;
    }
    return clamp(1 - (value - minimum) / (maximum - minimum), 0, 1);
  }

  #computePropellantUsage(deltaMap) {
    if (!deltaMap || typeof deltaMap !== 'object') {
      return {};
    }
    const result = {};
    for (const [key, value] of Object.entries(deltaMap)) {
      const numeric = this.#coerceNumber(value);
      if (!Number.isFinite(numeric) || Math.abs(numeric) <= this.options.minTrackingEpsilon) {
        continue;
      }
      const normalizedKey = this.#normalizeTankKey(key);
      result[normalizedKey] = this.#round(Math.abs(numeric), 3);
    }
    return result;
  }

  #roundEntries(map, digits = 3) {
    if (!map || typeof map !== 'object') {
      return {};
    }
    const result = {};
    for (const [key, value] of Object.entries(map)) {
      const numeric = this.#coerceNumber(value);
      if (!Number.isFinite(numeric)) {
        continue;
      }
      result[key] = this.#round(numeric, digits);
    }
    return result;
  }

  #grade(score) {
    if (!Number.isFinite(score)) {
      return null;
    }
    if (score >= 90) {
      return 'A';
    }
    if (score >= 80) {
      return 'B';
    }
    if (score >= 70) {
      return 'C';
    }
    if (score >= 60) {
      return 'D';
    }
    return 'F';
  }

  #normalizeWeightMap(weightMap, fallback) {
    const merged = { ...fallback };
    if (weightMap && typeof weightMap === 'object') {
      for (const [key, value] of Object.entries(weightMap)) {
        if (Number.isFinite(value) && value >= 0) {
          merged[key] = value;
        }
      }
    }
    let sum = 0;
    for (const value of Object.values(merged)) {
      if (Number.isFinite(value) && value > 0) {
        sum += value;
      }
    }
    if (!(sum > 0)) {
      return { ...fallback };
    }
    const normalized = {};
    for (const [key, value] of Object.entries(merged)) {
      normalized[key] = Number.isFinite(value) && value > 0 ? value / sum : 0;
    }
    return normalized;
  }

  #coerceNumber(value) {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'string') {
      const parsed = Number(value.trim());
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  #round(value, digits = 2) {
    if (!Number.isFinite(value)) {
      return null;
    }
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }

  #normalizeTankKey(key) {
    if (!key) {
      return key;
    }
    return key.endsWith('_kg') ? key.slice(0, -3) : key;
  }

  #isCommsEvent(event) {
    const system = typeof event?.system === 'string' ? event.system.toLowerCase() : '';
    return system === 'comms' || system === 'communications';
  }

  #isFinite(value) {
    return Number.isFinite(value) && Math.abs(value) !== Infinity;
  }
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}
