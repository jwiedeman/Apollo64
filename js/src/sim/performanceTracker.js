import { formatGET } from '../utils/time.js';

const DEFAULT_LOG_INTERVAL_SECONDS = 60;

function createStats() {
  return {
    count: 0,
    total: 0,
    min: null,
    max: null,
    last: null,
  };
}

function addSample(stats, value) {
  if (!Number.isFinite(value)) {
    return false;
  }
  stats.count += 1;
  stats.total += value;
  stats.last = value;
  if (stats.min == null || value < stats.min) {
    stats.min = value;
  }
  if (stats.max == null || value > stats.max) {
    stats.max = value;
  }
  return true;
}

function average(stats) {
  if (!stats || stats.count === 0) {
    return null;
  }
  return stats.total / stats.count;
}

function round(value, decimals = 3) {
  if (!Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function sumObjectValues(map) {
  if (!map || typeof map !== 'object') {
    return 0;
  }
  let total = 0;
  for (const value of Object.values(map)) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      total += numeric;
    }
  }
  return total;
}

export class PerformanceTracker {
  constructor({
    logger = null,
    tickRate = 20,
    hudIntervalSeconds = null,
    logIntervalSeconds = DEFAULT_LOG_INTERVAL_SECONDS,
  } = {}) {
    this.logger = logger ?? null;
    this.tickRate = Number.isFinite(tickRate) && tickRate > 0 ? tickRate : 20;
    this.expectedTickMs = 1000 / this.tickRate;
    this.hudIntervalSeconds = Number.isFinite(hudIntervalSeconds) && hudIntervalSeconds > 0
      ? hudIntervalSeconds
      : null;
    this.logIntervalSeconds = Number.isFinite(logIntervalSeconds) && logIntervalSeconds > 0
      ? logIntervalSeconds
      : DEFAULT_LOG_INTERVAL_SECONDS;

    this.tickStats = createStats();
    this.tickDriftStats = createStats();
    this.hudRenderStats = createStats();
    this.hudRenderStats.lastGetSeconds = null;
    this.hudRenderStats.lastScheduledGetSeconds = null;
    this.hudDrops = {
      total: 0,
      consecutive: 0,
      maxConsecutive: 0,
      lastDropCount: 0,
      lastDroppedAtSeconds: null,
    };

    this.audioStats = {
      lastActiveTotal: 0,
      lastQueuedTotal: 0,
      maxActiveTotal: 0,
      maxQueuedTotal: 0,
      lastSampledAtSeconds: null,
    };

    this.inputLatencyStats = createStats();

    this.lastTickGetSeconds = null;
    this.lastLogGetSeconds = null;
  }

  recordTick(durationMs, { getSeconds = null } = {}) {
    if (!Number.isFinite(durationMs)) {
      return;
    }
    addSample(this.tickStats, durationMs);
    const driftMs = durationMs - this.expectedTickMs;
    addSample(this.tickDriftStats, driftMs);
    if (Number.isFinite(getSeconds)) {
      this.lastTickGetSeconds = getSeconds;
    }
  }

  recordHudRender({
    durationMs = null,
    getSeconds = null,
    scheduledGetSeconds = null,
    dropped = 0,
  } = {}) {
    if (Number.isFinite(durationMs)) {
      addSample(this.hudRenderStats, durationMs);
    }
    if (Number.isFinite(getSeconds)) {
      this.hudRenderStats.lastGetSeconds = getSeconds;
    }
    if (Number.isFinite(scheduledGetSeconds)) {
      this.hudRenderStats.lastScheduledGetSeconds = scheduledGetSeconds;
    }

    const dropCount = Number.isFinite(dropped) && dropped > 0 ? Math.floor(dropped) : 0;
    if (dropCount > 0) {
      this.hudDrops.total += dropCount;
      this.hudDrops.consecutive += 1;
      if (this.hudDrops.consecutive > this.hudDrops.maxConsecutive) {
        this.hudDrops.maxConsecutive = this.hudDrops.consecutive;
      }
      this.hudDrops.lastDropCount = dropCount;
      this.hudDrops.lastDroppedAtSeconds = Number.isFinite(getSeconds)
        ? getSeconds
        : this.hudDrops.lastDroppedAtSeconds;
    } else {
      this.hudDrops.consecutive = 0;
      this.hudDrops.lastDropCount = 0;
    }
  }

  recordHudSkipped({ scheduledGetSeconds = null } = {}) {
    if (Number.isFinite(scheduledGetSeconds)) {
      this.hudRenderStats.lastScheduledGetSeconds = scheduledGetSeconds;
    }
  }

  recordAudioStats(stats = {}, { getSeconds = null } = {}) {
    if (!stats || typeof stats !== 'object') {
      return;
    }
    const activeTotal = sumObjectValues(stats.activeBuses ?? stats.active);
    const queuedTotal = sumObjectValues(stats.queuedBuses ?? stats.queued);

    this.audioStats.lastActiveTotal = activeTotal;
    this.audioStats.lastQueuedTotal = queuedTotal;
    if (activeTotal > this.audioStats.maxActiveTotal) {
      this.audioStats.maxActiveTotal = activeTotal;
    }
    if (queuedTotal > this.audioStats.maxQueuedTotal) {
      this.audioStats.maxQueuedTotal = queuedTotal;
    }
    if (Number.isFinite(getSeconds)) {
      this.audioStats.lastSampledAtSeconds = getSeconds;
    }
  }

  recordInputLatency(latencyMs, { getSeconds = null } = {}) {
    if (!Number.isFinite(latencyMs)) {
      return;
    }
    addSample(this.inputLatencyStats, latencyMs);
    if (Number.isFinite(getSeconds)) {
      this.inputLatencyStats.lastGetSeconds = getSeconds;
    }
  }

  maybeLog(getSeconds) {
    if (!this.logger || !Number.isFinite(getSeconds)) {
      return;
    }
    if (!this.#hasSamples()) {
      return;
    }
    if (this.logIntervalSeconds <= 0) {
      return;
    }
    if (this.lastLogGetSeconds == null) {
      this.lastLogGetSeconds = getSeconds;
      this.logger.logPerformance(getSeconds, this.summary(), { message: 'UI performance snapshot' });
      return;
    }
    if (getSeconds - this.lastLogGetSeconds >= this.logIntervalSeconds - 1e-6) {
      this.lastLogGetSeconds = getSeconds;
      this.logger.logPerformance(getSeconds, this.summary(), { message: 'UI performance snapshot' });
    }
  }

  flush(getSeconds = null) {
    if (!this.logger || !this.#hasSamples()) {
      return;
    }
    const targetSeconds = Number.isFinite(getSeconds)
      ? getSeconds
      : this.lastTickGetSeconds
        ?? this.hudRenderStats.lastGetSeconds
        ?? this.audioStats.lastSampledAtSeconds
        ?? 0;
    this.lastLogGetSeconds = targetSeconds;
    this.logger.logPerformance(targetSeconds, this.summary(), { message: 'UI performance summary' });
  }

  snapshot() {
    const tickAverage = average(this.tickStats);
    const driftAverage = average(this.tickDriftStats);
    const hudAverage = average(this.hudRenderStats);
    const inputAverage = average(this.inputLatencyStats);
    const lastRenderSeconds = this.hudRenderStats.lastGetSeconds ?? null;
    const lastScheduledSeconds = this.hudRenderStats.lastScheduledGetSeconds ?? null;

    const snapshot = {
      generatedAtSeconds: this.lastTickGetSeconds
        ?? lastRenderSeconds
        ?? this.audioStats.lastSampledAtSeconds
        ?? null,
      tick: {
        count: this.tickStats.count,
        expectedMs: round(this.expectedTickMs),
        averageMs: round(tickAverage),
        maxMs: round(this.tickStats.max),
        minMs: round(this.tickStats.min),
        lastMs: round(this.tickStats.last),
        drift: {
          averageMs: round(driftAverage),
          maxMs: round(this.tickDriftStats.max),
          minMs: round(this.tickDriftStats.min),
          lastMs: round(this.tickDriftStats.last),
          maxAbsMs: round(Math.max(
            Math.abs(this.tickDriftStats.max ?? 0),
            Math.abs(this.tickDriftStats.min ?? 0),
          )),
        },
      },
      hud: {
        renderCount: this.hudRenderStats.count,
        renderMs: {
          average: round(hudAverage),
          max: round(this.hudRenderStats.max),
          min: round(this.hudRenderStats.min),
          last: round(this.hudRenderStats.last),
        },
        drop: {
          total: this.hudDrops.total,
          consecutive: this.hudDrops.consecutive,
          maxConsecutive: this.hudDrops.maxConsecutive,
          last: this.hudDrops.lastDropCount,
          lastDroppedAtSeconds: this.hudDrops.lastDroppedAtSeconds ?? null,
          lastDroppedAt: Number.isFinite(this.hudDrops.lastDroppedAtSeconds)
            ? formatGET(this.hudDrops.lastDroppedAtSeconds)
            : null,
        },
        lastRenderGetSeconds: lastRenderSeconds,
        lastRenderGet: Number.isFinite(lastRenderSeconds) ? formatGET(lastRenderSeconds) : null,
        lastScheduledGetSeconds: lastScheduledSeconds,
        lastScheduledGet: Number.isFinite(lastScheduledSeconds)
          ? formatGET(lastScheduledSeconds)
          : null,
      },
      audio: {
        lastActiveTotal: this.audioStats.lastActiveTotal,
        lastQueuedTotal: this.audioStats.lastQueuedTotal,
        maxActiveTotal: this.audioStats.maxActiveTotal,
        maxQueuedTotal: this.audioStats.maxQueuedTotal,
        lastSampledAtSeconds: this.audioStats.lastSampledAtSeconds,
        lastSampledAt: Number.isFinite(this.audioStats.lastSampledAtSeconds)
          ? formatGET(this.audioStats.lastSampledAtSeconds)
          : null,
      },
      input: {
        count: this.inputLatencyStats.count,
        averageLatencyMs: round(inputAverage),
        maxLatencyMs: round(this.inputLatencyStats.max),
        minLatencyMs: round(this.inputLatencyStats.min),
        lastLatencyMs: round(this.inputLatencyStats.last),
        lastLatencyGetSeconds: this.inputLatencyStats.lastGetSeconds ?? null,
        lastLatencyGet: Number.isFinite(this.inputLatencyStats.lastGetSeconds)
          ? formatGET(this.inputLatencyStats.lastGetSeconds)
          : null,
      },
      logging: {
        intervalSeconds: this.logIntervalSeconds,
        lastLogGetSeconds: this.lastLogGetSeconds,
        lastLogGet: Number.isFinite(this.lastLogGetSeconds) ? formatGET(this.lastLogGetSeconds) : null,
      },
    };

    if (Number.isFinite(snapshot.generatedAtSeconds)) {
      snapshot.generatedAt = formatGET(snapshot.generatedAtSeconds);
    }

    if (this.hudIntervalSeconds != null) {
      snapshot.hud.intervalSeconds = this.hudIntervalSeconds;
    }

    snapshot.overview = this.#buildOverview(snapshot);

    return snapshot;
  }

  summary() {
    return this.snapshot();
  }

  #buildOverview(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') {
      return null;
    }
    return {
      tickAvgMs: snapshot.tick?.averageMs ?? null,
      tickMaxMs: snapshot.tick?.maxMs ?? null,
      tickDriftMaxAbsMs: snapshot.tick?.drift?.maxAbsMs ?? null,
      hudAvgMs: snapshot.hud?.renderMs?.average ?? null,
      hudMaxMs: snapshot.hud?.renderMs?.max ?? null,
      hudDrops: snapshot.hud?.drop?.total ?? 0,
      hudMaxDropStreak: snapshot.hud?.drop?.maxConsecutive ?? 0,
      audioMaxActive: snapshot.audio?.maxActiveTotal ?? 0,
      audioMaxQueued: snapshot.audio?.maxQueuedTotal ?? 0,
      inputAvgMs: snapshot.input?.averageLatencyMs ?? null,
      inputMaxMs: snapshot.input?.maxLatencyMs ?? null,
    };
  }

  #hasSamples() {
    return this.tickStats.count > 0
      || this.hudRenderStats.count > 0
      || this.audioStats.maxActiveTotal > 0
      || this.audioStats.maxQueuedTotal > 0
      || this.inputLatencyStats.count > 0;
  }
}

