import { formatGET } from '../utils/time.js';

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
  historyLimit: 64,
  historyStepSeconds: 60,
  deltaLogThreshold: 0.5,
  manualTimelineBucketSeconds: 300,
  manualTimelineLimit: 64,
};

export class ScoreSystem {
  constructor(
    {
      resourceSystem = null,
      scheduler = null,
      autopilotRunner = null,
      checklistManager = null,
      manualQueue = null,
      logger = null,
    } = {},
    options = {},
  ) {
    const {
      weights,
      resourceWeights,
      historyLimit = DEFAULT_OPTIONS.historyLimit,
      historyStepSeconds = DEFAULT_OPTIONS.historyStepSeconds,
      deltaLogThreshold = DEFAULT_OPTIONS.deltaLogThreshold,
      manualTimelineBucketSeconds = DEFAULT_OPTIONS.manualTimelineBucketSeconds,
      manualTimelineLimit = DEFAULT_OPTIONS.manualTimelineLimit,
      ...restOptions
    } = options ?? {};

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
    this.logger = logger ?? null;

    this.historyLimit = Math.max(0, Number(historyLimit) || 0);
    this.historyStepSeconds = Number.isFinite(historyStepSeconds)
      ? Math.max(0, Number(historyStepSeconds))
      : DEFAULT_OPTIONS.historyStepSeconds;
    this.deltaLogThreshold = Number.isFinite(deltaLogThreshold)
      ? Math.max(0, Math.abs(Number(deltaLogThreshold)))
      : DEFAULT_OPTIONS.deltaLogThreshold;
    this.manualTimelineBucketSeconds = Number.isFinite(manualTimelineBucketSeconds)
      && manualTimelineBucketSeconds > 0
      ? Number(manualTimelineBucketSeconds)
      : DEFAULT_OPTIONS.manualTimelineBucketSeconds;
    this.manualTimelineLimit = Number.isFinite(manualTimelineLimit)
      ? Math.max(0, Number(manualTimelineLimit))
      : DEFAULT_OPTIONS.manualTimelineLimit;

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

    this.scoreHistory = [];
    this.lastHistorySampleSeconds = null;
    this.lastRating = null;
    this.lastDelta = null;
    this.cachedSummary = null;
    this.cachedSummarySeconds = null;
    this.manualTimelineBuckets = new Map();
    this.manualTimelineKeys = [];
    this.lastManualStepCount = null;
    this.lastAutoStepCount = null;
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

    const checklistStats = this.checklistManager?.stats?.();
    if (checklistStats?.totals) {
      this.#updateManualTimelineFromTotals(checklistStats.totals, currentGetSeconds);
    }

    this.#ensureInitialized();
    this.#updateResourceMetrics(dtSeconds);
    this.#updateEventStatus();
    this.#captureScoreTelemetry(currentGetSeconds);
  }

  summary() {
    let baseSummary = null;
    if (
      this.cachedSummary
      && (this.cachedSummarySeconds ?? null) === (this.lastUpdateGetSeconds ?? null)
    ) {
      baseSummary = this.cachedSummary;
    } else {
      baseSummary = this.#computeBaseSummary();
      this.cachedSummary = baseSummary;
      this.cachedSummarySeconds = this.lastUpdateGetSeconds ?? null;
    }

    return this.#enrichSummary(baseSummary);
  }

  #computeBaseSummary() {
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

    const manualTimeline = this.#cloneManualTimeline();

    const summary = {
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
        timelineBucketSeconds: this.manualTimelineBucketSeconds,
        timeline: manualTimeline,
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

    return summary;
  }

  #enrichSummary(baseSummary) {
    if (!baseSummary || typeof baseSummary !== 'object') {
      return null;
    }

    const summary = {
      missionDurationSeconds: baseSummary.missionDurationSeconds ?? null,
      events: { ...baseSummary.events },
      comms: { ...baseSummary.comms },
      resources: {
        ...baseSummary.resources,
        propellantUsedKg: baseSummary.resources?.propellantUsedKg
          ? { ...baseSummary.resources.propellantUsedKg }
          : {},
        powerDeltaKw: baseSummary.resources?.powerDeltaKw
          ? { ...baseSummary.resources.powerDeltaKw }
          : {},
      },
      faults: {
        ...baseSummary.faults,
        resourceFailureIds: Array.isArray(baseSummary.faults?.resourceFailureIds)
          ? [...baseSummary.faults.resourceFailureIds]
          : [],
      },
      manual: { ...baseSummary.manual },
      rating: {
        ...baseSummary.rating,
        breakdown: {
          events: baseSummary.rating?.breakdown?.events
            ? { ...baseSummary.rating.breakdown.events }
            : null,
          resources: baseSummary.rating?.breakdown?.resources
            ? { ...baseSummary.rating.breakdown.resources }
            : null,
          faults: baseSummary.rating?.breakdown?.faults
            ? { ...baseSummary.rating.breakdown.faults }
            : null,
          manual: baseSummary.rating?.breakdown?.manual
            ? { ...baseSummary.rating.breakdown.manual }
            : null,
        },
      },
      autopilot: baseSummary.autopilot ?? null,
    };

    const history = this.#cloneScoreHistory();
    if (history.length > 0) {
      summary.history = history;
    }

    if (Array.isArray(baseSummary.manual?.timeline)) {
      summary.manual.timeline = baseSummary.manual.timeline.map((entry) => ({ ...entry }));
    } else {
      summary.manual.timeline = [];
    }

    const delta = this.#cloneScoreDelta(this.lastDelta);
    if (delta) {
      if (!summary.rating) {
        summary.rating = {};
      }
      summary.rating.delta = delta;
    }

    return summary;
  }

  #captureScoreTelemetry(currentGetSeconds) {
    if (!Number.isFinite(currentGetSeconds)) {
      return;
    }

    const summary = this.#computeBaseSummary();
    this.cachedSummary = summary;
    this.cachedSummarySeconds = currentGetSeconds;

    this.#updateScoreTrend(summary, currentGetSeconds);
  }

  #updateScoreTrend(summary, currentGetSeconds) {
    if (!summary || typeof summary !== 'object') {
      return;
    }

    const rating = summary.rating ?? {};
    const commanderScore = this.#coerceNumber(rating.commanderScore);
    const baseScore = this.#coerceNumber(rating.baseScore);
    const manualBonus = this.#coerceNumber(rating.manualBonus);
    const breakdown = rating.breakdown ?? {};

    const previous = this.lastRating ?? null;
    const previousBreakdown = previous?.breakdown ?? null;

    let commanderDelta = null;
    if (Number.isFinite(commanderScore) && Number.isFinite(previous?.commanderScore)) {
      commanderDelta = commanderScore - previous.commanderScore;
    }

    let baseDelta = null;
    if (Number.isFinite(baseScore) && Number.isFinite(previous?.baseScore)) {
      baseDelta = baseScore - previous.baseScore;
    }

    let manualDelta = null;
    if (Number.isFinite(manualBonus) && Number.isFinite(previous?.manualBonus)) {
      manualDelta = manualBonus - previous.manualBonus;
    }

    const breakdownScores = this.#extractBreakdownScores(breakdown);
    const breakdownDelta = previous
      ? this.#computeBreakdownDelta(breakdownScores, previousBreakdown)
      : null;

    const grade = typeof rating.grade === 'string' ? rating.grade : null;
    const previousGrade = typeof previous?.grade === 'string' ? previous.grade : null;
    const gradeChanged = Boolean(grade) && Boolean(previousGrade) && grade !== previousGrade;

    const shouldLogDelta = this.logger
      && previous
      && commanderDelta != null
      && Math.abs(commanderDelta) >= this.deltaLogThreshold;

    if (shouldLogDelta) {
      const severity = commanderDelta >= 0 ? 'notice' : 'warning';
      this.logger.log(currentGetSeconds, this.#formatScoreDeltaMessage(commanderDelta, commanderScore), {
        logSource: 'sim',
        logCategory: 'score',
        logSeverity: severity,
        event: 'score_delta',
        delta: this.#round(commanderDelta, 1),
        baseDelta: this.#round(baseDelta, 1),
        manualBonusDelta: this.#round(manualDelta, 1),
        commanderScore: this.#round(commanderScore, 1),
        baseScore: this.#round(baseScore, 1),
        manualBonus: this.#round(manualBonus, 1),
        grade,
        breakdownDelta: this.#roundBreakdownDelta(breakdownDelta),
      });
    }

    if (this.logger && gradeChanged && previousGrade) {
      const severity = this.#gradeRank(grade) >= this.#gradeRank(previousGrade) ? 'notice' : 'warning';
      this.logger.log(currentGetSeconds, `Commander grade ${previousGrade} → ${grade}`, {
        logSource: 'sim',
        logCategory: 'score',
        logSeverity: severity,
        event: 'grade_change',
        previousGrade,
        grade,
        previousCommanderScore: Number.isFinite(previous?.commanderScore)
          ? this.#round(previous.commanderScore, 1)
          : null,
        commanderScore: this.#round(commanderScore, 1),
      });
    }

    const shouldSampleHistory =
      this.scoreHistory.length === 0
      || (
        this.historyStepSeconds > 0
        && (!Number.isFinite(this.lastHistorySampleSeconds)
          || currentGetSeconds - this.lastHistorySampleSeconds >= this.historyStepSeconds - 1e-6)
      )
      || gradeChanged
      || shouldLogDelta;

    const breakdownClone = this.#cloneBreakdown(breakdown);
    const deltaEntry = this.#buildScoreDelta({
      commanderDelta,
      baseDelta,
      manualDelta,
      breakdownDelta,
      gradeChanged,
      grade,
      previousGrade,
    });

    if (shouldSampleHistory) {
      const historyEntry = {
        getSeconds: Number.isFinite(currentGetSeconds) ? currentGetSeconds : null,
        commanderScore: Number.isFinite(commanderScore) ? this.#round(commanderScore, 1) : null,
        baseScore: Number.isFinite(baseScore) ? this.#round(baseScore, 1) : null,
        manualBonus: Number.isFinite(manualBonus) ? this.#round(manualBonus, 1) : null,
        grade,
        breakdown: breakdownClone,
        delta: deltaEntry,
      };

      this.scoreHistory.push(historyEntry);
      if (this.scoreHistory.length > this.historyLimit && this.historyLimit > 0) {
        const excess = this.scoreHistory.length - this.historyLimit;
        this.scoreHistory.splice(0, excess);
      }
      this.lastHistorySampleSeconds = currentGetSeconds;
    }

    this.lastRating = {
      commanderScore: Number.isFinite(commanderScore) ? commanderScore : null,
      baseScore: Number.isFinite(baseScore) ? baseScore : null,
      manualBonus: Number.isFinite(manualBonus) ? manualBonus : null,
      grade,
      breakdown: breakdownScores,
    };

    this.lastDelta = deltaEntry;
  }

  #updateManualTimelineFromTotals(totals, currentGetSeconds) {
    if (!totals) {
      return;
    }

    const manualValue = this.#coerceNumber(totals.manualSteps);
    const autoValue = this.#coerceNumber(totals.autoSteps);

    if (!Number.isFinite(currentGetSeconds)) {
      if (Number.isFinite(manualValue)) {
        this.lastManualStepCount = manualValue;
      }
      if (Number.isFinite(autoValue)) {
        this.lastAutoStepCount = autoValue;
      }
      return;
    }

    let manualDelta = 0;
    if (Number.isFinite(manualValue)) {
      if (this.lastManualStepCount == null) {
        this.lastManualStepCount = manualValue;
      }
      manualDelta = manualValue - this.lastManualStepCount;
      if (manualDelta < 0) {
        manualDelta = 0;
      }
    }

    let autoDelta = 0;
    if (Number.isFinite(autoValue)) {
      if (this.lastAutoStepCount == null) {
        this.lastAutoStepCount = autoValue;
      }
      autoDelta = autoValue - this.lastAutoStepCount;
      if (autoDelta < 0) {
        autoDelta = 0;
      }
    }

    if (manualDelta > 0 || autoDelta > 0) {
      this.#addManualTimelineSample(currentGetSeconds, manualDelta, autoDelta);
    }

    if (Number.isFinite(manualValue)) {
      this.lastManualStepCount = manualValue;
    }
    if (Number.isFinite(autoValue)) {
      this.lastAutoStepCount = autoValue;
    }
  }

  #addManualTimelineSample(getSeconds, manualDelta, autoDelta) {
    if ((manualDelta ?? 0) <= 0 && (autoDelta ?? 0) <= 0) {
      return;
    }
    if (!Number.isFinite(this.manualTimelineBucketSeconds) || this.manualTimelineBucketSeconds <= 0) {
      return;
    }
    if (!Number.isFinite(getSeconds)) {
      return;
    }

    const bucketSize = this.manualTimelineBucketSeconds;
    const bucketStart = Math.floor(getSeconds / bucketSize) * bucketSize;
    const bucketEnd = bucketStart + bucketSize;

    let bucket = this.manualTimelineBuckets.get(bucketStart);
    if (!bucket) {
      bucket = {
        startSeconds: bucketStart,
        endSeconds: bucketEnd,
        manualSteps: 0,
        autoSteps: 0,
      };
      this.manualTimelineBuckets.set(bucketStart, bucket);
      this.#insertManualTimelineKey(bucketStart);
      this.#trimManualTimeline();
    }

    if (manualDelta > 0) {
      bucket.manualSteps += manualDelta;
    }
    if (autoDelta > 0) {
      bucket.autoSteps += autoDelta;
    }
  }

  #insertManualTimelineKey(bucketStart) {
    if (this.manualTimelineKeys.includes(bucketStart)) {
      return;
    }
    if (this.manualTimelineKeys.length === 0 || bucketStart >= this.manualTimelineKeys[this.manualTimelineKeys.length - 1]) {
      this.manualTimelineKeys.push(bucketStart);
      return;
    }
    const index = this.manualTimelineKeys.findIndex((key) => bucketStart < key);
    if (index === -1) {
      this.manualTimelineKeys.push(bucketStart);
    } else {
      this.manualTimelineKeys.splice(index, 0, bucketStart);
    }
  }

  #trimManualTimeline() {
    if (this.manualTimelineLimit <= 0) {
      return;
    }
    while (this.manualTimelineKeys.length > this.manualTimelineLimit) {
      const removed = this.manualTimelineKeys.shift();
      if (removed != null) {
        this.manualTimelineBuckets.delete(removed);
      }
    }
  }

  #cloneManualTimeline() {
    if (this.manualTimelineKeys.length === 0) {
      return [];
    }
    const timeline = [];
    for (const key of this.manualTimelineKeys) {
      const bucket = this.manualTimelineBuckets.get(key);
      if (!bucket) {
        continue;
      }
      timeline.push({
        startSeconds: bucket.startSeconds,
        endSeconds: bucket.endSeconds,
        manualSteps: bucket.manualSteps,
        autoSteps: bucket.autoSteps,
      });
    }
    return timeline;
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

  #formatScoreDeltaMessage(delta, commanderScore) {
    if (!Number.isFinite(delta) || !Number.isFinite(commanderScore)) {
      return 'Commander score updated';
    }
    const sign = delta >= 0 ? '+' : '';
    return `Commander score ${sign}${this.#round(delta, 1)} → ${this.#round(commanderScore, 1)}`;
  }

  #extractBreakdownScores(breakdown) {
    const result = {};
    if (!breakdown || typeof breakdown !== 'object') {
      return result;
    }
    for (const key of ['events', 'resources', 'faults', 'manual']) {
      const entry = breakdown[key];
      result[key] = this.#coerceNumber(entry?.score);
    }
    return result;
  }

  #computeBreakdownDelta(current = {}, previous = {}) {
    const delta = {};
    for (const key of ['events', 'resources', 'faults', 'manual']) {
      const currentValue = this.#coerceNumber(current?.[key]);
      const previousValue = this.#coerceNumber(previous?.[key]);
      if (Number.isFinite(currentValue) && Number.isFinite(previousValue)) {
        delta[key] = currentValue - previousValue;
      } else {
        delta[key] = Number.isFinite(currentValue) ? currentValue : null;
      }
    }
    return delta;
  }

  #cloneBreakdown(breakdown) {
    const clone = {};
    if (!breakdown || typeof breakdown !== 'object') {
      for (const key of ['events', 'resources', 'faults', 'manual']) {
        clone[key] = null;
      }
      return clone;
    }
    for (const key of ['events', 'resources', 'faults', 'manual']) {
      const entry = breakdown[key];
      if (!entry || typeof entry !== 'object') {
        clone[key] = null;
        continue;
      }
      clone[key] = {
        score: this.#coerceNumber(entry.score) != null ? this.#round(entry.score, 3) : null,
        weight: this.#coerceNumber(entry.weight) != null ? this.#round(entry.weight, 3) : null,
      };
    }
    return clone;
  }

  #roundBreakdownDelta(delta) {
    if (!delta || typeof delta !== 'object') {
      return null;
    }
    const result = {};
    let hasValue = false;
    for (const key of ['events', 'resources', 'faults', 'manual']) {
      const value = this.#coerceNumber(delta[key]);
      if (Number.isFinite(value)) {
        result[key] = this.#round(value, 3);
        hasValue = true;
      } else {
        result[key] = null;
      }
    }
    return hasValue ? result : null;
  }

  #buildScoreDelta({
    commanderDelta = null,
    baseDelta = null,
    manualDelta = null,
    breakdownDelta = null,
    gradeChanged = false,
    grade = null,
    previousGrade = null,
  } = {}) {
    const delta = {
      commanderScore: Number.isFinite(commanderDelta) ? this.#round(commanderDelta, 1) : null,
      baseScore: Number.isFinite(baseDelta) ? this.#round(baseDelta, 1) : null,
      manualBonus: Number.isFinite(manualDelta) ? this.#round(manualDelta, 1) : null,
      breakdown: this.#roundBreakdownDelta(breakdownDelta),
      gradeChanged: Boolean(gradeChanged),
      grade: grade ?? null,
      previousGrade: previousGrade ?? null,
    };

    const meaningful =
      delta.commanderScore != null
      || delta.baseScore != null
      || delta.manualBonus != null
      || (delta.breakdown && Object.values(delta.breakdown).some((value) => value != null))
      || delta.gradeChanged;

    return meaningful ? delta : null;
  }

  #cloneScoreHistory() {
    if (!Array.isArray(this.scoreHistory)) {
      return [];
    }
    return this.scoreHistory.map((entry) => ({
      getSeconds: entry.getSeconds ?? null,
      commanderScore: entry.commanderScore ?? null,
      baseScore: entry.baseScore ?? null,
      manualBonus: entry.manualBonus ?? null,
      grade: entry.grade ?? null,
      breakdown: this.#cloneBreakdown(entry.breakdown),
      delta: this.#cloneScoreDelta(entry.delta),
    }));
  }

  #cloneScoreDelta(delta) {
    if (!delta || typeof delta !== 'object') {
      return null;
    }
    const clone = {
      commanderScore: delta.commanderScore ?? null,
      baseScore: delta.baseScore ?? null,
      manualBonus: delta.manualBonus ?? null,
      breakdown: delta.breakdown ? { ...delta.breakdown } : null,
      gradeChanged: Boolean(delta.gradeChanged),
      grade: delta.grade ?? null,
      previousGrade: delta.previousGrade ?? null,
    };

    const hasValue =
      clone.commanderScore != null
      || clone.baseScore != null
      || clone.manualBonus != null
      || (clone.breakdown && Object.values(clone.breakdown).some((value) => value != null))
      || clone.gradeChanged;

    return hasValue ? clone : null;
  }

  #gradeRank(grade) {
    switch (grade) {
      case 'A':
        return 5;
      case 'B':
        return 4;
      case 'C':
        return 3;
      case 'D':
        return 2;
      case 'F':
        return 1;
      default:
        return 0;
    }
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
