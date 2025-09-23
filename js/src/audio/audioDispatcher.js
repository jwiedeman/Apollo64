import { formatGET } from '../utils/time.js';

const DEFAULT_OPTIONS = {
  logger: null,
  binder: null,
  logSource: 'audio',
  logCategory: 'audio',
  defaultMaxConcurrent: 1,
  defaultCueDurationSeconds: 2,
  maxPendingPerBus: 48,
  maxLedgerEntries: 1024,
  severityWeights: {
    failure: 60,
    warning: 30,
    caution: 15,
    notice: 5,
    info: 0,
  },
  duckingRampSeconds: 0.05,
};

const EPSILON = 1e-6;

function coerceFinite(value, fallback = null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeId(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function dbToGain(db) {
  if (!Number.isFinite(db)) {
    return 1;
  }
  return 10 ** (db / 20);
}

function clone(value) {
  if (!value || typeof value !== 'object') {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

export class NullAudioMixer {
  constructor({ logger = null, logSource = 'audio', logCategory = 'audio' } = {}) {
    this.logger = logger ?? null;
    this.logSource = logSource;
    this.logCategory = logCategory;
    this.playCalls = [];
    this.stopCalls = [];
    this.gainChanges = [];
    this.preloadCalls = [];
    this.handleCounter = 0;
  }

  preload(cue) {
    this.preloadCalls.push({ cue: cue ? { ...cue } : null });
  }

  play(cue, options = {}) {
    const handle = {
      id: `handle-${this.handleCounter += 1}`,
      cueId: cue?.id ?? null,
      busId: options.busId ?? null,
    };
    this.playCalls.push({ cue: cue ? { ...cue } : null, options: { ...options }, handle });
    if (this.logger) {
      this.logger.log(options.startTimeSeconds ?? 0, `Mixer play ${cue?.id ?? 'unknown'}`, {
        logSource: this.logSource,
        logCategory: this.logCategory,
        logSeverity: 'debug',
        busId: options.busId ?? null,
        cueId: cue?.id ?? null,
      });
    }
    return handle;
  }

  stop(handle, reason = 'stop') {
    if (!handle) {
      return;
    }
    this.stopCalls.push({ handle, reason });
  }

  setGain(busId, gain, { rampSeconds = 0 } = {}) {
    this.gainChanges.push({ busId, gain, rampSeconds });
  }

  stats() {
    return {
      plays: this.playCalls.length,
      stops: this.stopCalls.length,
      gainChanges: this.gainChanges.length,
    };
  }
}

export class AudioDispatcher {
  constructor(catalog = null, mixer = null, options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...(options ?? {}) };
    this.logger = this.options.logger ?? null;
    this.logSource = this.options.logSource;
    this.logCategory = this.options.logCategory;
    this.catalog = catalog && typeof catalog === 'object' ? catalog : { buses: [], categories: [], cues: [] };
    this.mixer = mixer ?? new NullAudioMixer({ logger: this.logger, logSource: this.logSource, logCategory: this.logCategory });
    this.binder = this.options.binder ?? null;
    this.recorder = this.options.recorder ?? null;

    this.busMap = new Map();
    this.categoryMap = new Map();
    this.cueMap = new Map();

    this.busState = new Map();
    this.lastCueTrigger = new Map();
    this.lastCategoryTrigger = new Map();
    this.sequence = 0;
    this.playbackCounter = 0;

    this.activeDucks = new Map(); // targetBusId -> { contributions: Map(playbackId, gain), appliedGain }
    this.busGains = new Map();

    this.stats = {
      played: 0,
      stopped: 0,
      suppressed: 0,
      dropped: 0,
      lastCueId: null,
      lastStartedAtSeconds: null,
    };
    this.ledger = [];

    this.#indexCatalog();
  }

  update(currentGetSeconds, { binder = null, triggers = null } = {}) {
    const now = Number.isFinite(currentGetSeconds) ? currentGetSeconds : 0;

    this.#retireCompletedPlaybacks(now);

    const sourceBinder = binder ?? this.binder;
    if (sourceBinder?.drainPending) {
      const drained = sourceBinder.drainPending();
      if (Array.isArray(drained) && drained.length > 0) {
        this.#enqueueTriggers(drained, now);
      }
    }

    if (Array.isArray(triggers) && triggers.length > 0) {
      this.#enqueueTriggers(triggers, now);
    }

    for (const [busId, state] of this.busState.entries()) {
      this.#processBusQueue(busId, state, now);
    }
  }

  stopAll(reason = 'stopAll', currentGetSeconds = null) {
    for (const [busId, state] of this.busState.entries()) {
      const remaining = [];
      for (const record of state.active) {
        this.#stopPlayback(record, reason, currentGetSeconds);
      }
      state.active = remaining;
    }
  }

  statsSnapshot() {
    const active = {};
    const queued = {};
    for (const [busId, state] of this.busState.entries()) {
      active[busId] = state.active.length;
      queued[busId] = state.queue.length;
    }
    return {
      played: this.stats.played,
      stopped: this.stats.stopped,
      suppressed: this.stats.suppressed,
      dropped: this.stats.dropped,
      lastCueId: this.stats.lastCueId,
      lastStartedAtSeconds: this.stats.lastStartedAtSeconds,
      lastStartedAt: this.stats.lastStartedAtSeconds != null
        ? formatGET(this.stats.lastStartedAtSeconds)
        : null,
      activeBuses: active,
      queuedBuses: queued,
    };
  }

  getBusState(busId) {
    return this.busState.get(busId) ?? { queue: [], active: [] };
  }

  #indexCatalog() {
    if (Array.isArray(this.catalog?.buses)) {
      for (const rawBus of this.catalog.buses) {
        const id = normalizeId(rawBus?.id);
        if (!id || this.busMap.has(id)) {
          continue;
        }
        const ducking = Array.isArray(rawBus.ducking)
          ? rawBus.ducking
              .map((entry) => {
                const target = normalizeId(entry?.target ?? entry?.bus);
                const gainDb = coerceFinite(entry?.gainDb ?? entry?.gain_db);
                if (!target || !Number.isFinite(gainDb)) {
                  return null;
                }
                return { targetBusId: target, gainLinear: dbToGain(gainDb) };
              })
              .filter(Boolean)
          : [];
        const maxConcurrent = coerceFinite(rawBus.maxConcurrent ?? rawBus.max_concurrent, this.options.defaultMaxConcurrent);
        this.busMap.set(id, {
          id,
          name: typeof rawBus.name === 'string' ? rawBus.name : null,
          maxConcurrent: Number.isFinite(maxConcurrent) && maxConcurrent > 0 ? maxConcurrent : this.options.defaultMaxConcurrent,
          ducking,
        });
      }
    }

    if (Array.isArray(this.catalog?.categories)) {
      for (const rawCategory of this.catalog.categories) {
        const id = normalizeId(rawCategory?.id);
        if (!id || this.categoryMap.has(id)) {
          continue;
        }
        const busId = normalizeId(rawCategory?.bus);
        this.categoryMap.set(id, {
          id,
          name: typeof rawCategory.name === 'string' ? rawCategory.name : null,
          busId,
          cooldownSeconds: coerceFinite(rawCategory.cooldownSeconds ?? rawCategory.cooldown_seconds, 0) ?? 0,
          defaultPriority: coerceFinite(rawCategory.defaultPriority ?? rawCategory.default_priority, 0) ?? 0,
        });
      }
    }

    if (Array.isArray(this.catalog?.cues)) {
      for (const rawCue of this.catalog.cues) {
        const id = normalizeId(rawCue?.id);
        if (!id || this.cueMap.has(id)) {
          continue;
        }
        const categoryId = normalizeId(rawCue.category);
        const category = categoryId ? this.categoryMap.get(categoryId) ?? null : null;
        const busId = normalizeId(rawCue.bus ?? category?.busId ?? null);
        this.cueMap.set(id, {
          id,
          name: typeof rawCue.name === 'string' ? rawCue.name : null,
          categoryId,
          busId,
          lengthSeconds: coerceFinite(rawCue.lengthSeconds ?? rawCue.length_seconds, null),
          loop: Boolean(rawCue.loop),
          cooldownSeconds: coerceFinite(rawCue.cooldownSeconds ?? rawCue.cooldown_seconds, null),
          priority: coerceFinite(rawCue.priority, category?.defaultPriority ?? 0) ?? 0,
        });
      }
    }
  }

  #retireCompletedPlaybacks(currentGetSeconds) {
    for (const [busId, state] of this.busState.entries()) {
      if (!Array.isArray(state.active) || state.active.length === 0) {
        continue;
      }
      const remaining = [];
      for (const record of state.active) {
        if (record.loop) {
          remaining.push(record);
          continue;
        }
        const endsAt = record.endsAtSeconds ?? null;
        if (endsAt != null && currentGetSeconds + EPSILON >= endsAt) {
          this.#stopPlayback(record, 'complete', currentGetSeconds);
        } else {
          remaining.push(record);
        }
      }
      state.active = remaining;
    }
  }

  #enqueueTriggers(triggers, currentGetSeconds) {
    for (const rawTrigger of triggers) {
      const normalized = this.#normalizeTrigger(rawTrigger, currentGetSeconds);
      if (!normalized) {
        continue;
      }
      const state = this.#ensureBusState(normalized.busId);
      state.queue.push(normalized);
      state.queue.sort((a, b) => this.#compareTriggers(a, b));
      if (state.queue.length > this.options.maxPendingPerBus) {
        state.queue.splice(this.options.maxPendingPerBus);
      }
    }
  }

  #processBusQueue(busId, state, currentGetSeconds) {
    if (!state) {
      return;
    }

    const busConfig = this.busMap.get(busId) ?? { maxConcurrent: this.options.defaultMaxConcurrent, ducking: [] };
    const maxConcurrent = Number.isFinite(busConfig.maxConcurrent) && busConfig.maxConcurrent > 0
      ? busConfig.maxConcurrent
      : this.options.defaultMaxConcurrent;

    while (state.active.length < maxConcurrent) {
      const next = this.#dequeueNextEligibleTrigger(state, currentGetSeconds);
      if (!next) {
        break;
      }
      this.#startPlayback(busId, next, currentGetSeconds);
    }

    if (state.queue.length === 0) {
      return;
    }

    const candidate = this.#peekNextEligibleTrigger(state, currentGetSeconds);
    if (!candidate) {
      return;
    }

    const lowest = this.#selectLowestPriorityActive(state.active);
    if (!lowest) {
      return;
    }

    if (candidate.priority > lowest.priority + EPSILON) {
      this.#stopPlayback(lowest, 'preempted', currentGetSeconds);
      const index = state.active.indexOf(lowest);
      if (index >= 0) {
        state.active.splice(index, 1);
      }
      const next = this.#dequeueNextEligibleTrigger(state, currentGetSeconds);
      if (next) {
        this.#startPlayback(busId, next, currentGetSeconds);
      }
    }
  }

  #startPlayback(busId, trigger, currentGetSeconds) {
    const cueMeta = this.cueMap.get(trigger.cueId) ?? null;
    const busConfig = this.busMap.get(busId) ?? { ducking: [] };
    const startSeconds = trigger.triggeredAtSeconds ?? currentGetSeconds;

    if (this.#isUnderCooldown(trigger, startSeconds)) {
      this.stats.suppressed += 1;
      this.logger?.log(startSeconds ?? 0, `Audio cue ${trigger.cueId} suppressed by cooldown`, {
        logSource: this.logSource,
        logCategory: this.logCategory,
        logSeverity: 'notice',
        cueId: trigger.cueId,
        categoryId: trigger.categoryId,
        busId,
        metadata: trigger.metadata ? clone(trigger.metadata) : null,
      });
      return;
    }

    const record = {
      playbackId: this.playbackCounter += 1,
      handle: null,
      cueId: trigger.cueId,
      categoryId: trigger.categoryId,
      busId,
      priority: trigger.priority,
      startedAtSeconds: startSeconds,
      endsAtSeconds: null,
      loop: Boolean(cueMeta?.loop ?? trigger.cue?.loop ?? false),
      trigger,
      duckTargets: [],
      ledgerEntry: null,
    };

    const lengthSeconds = cueMeta?.lengthSeconds ?? trigger.cue?.lengthSeconds ?? null;
    if (record.loop) {
      record.endsAtSeconds = Number.POSITIVE_INFINITY;
    } else if (Number.isFinite(lengthSeconds) && lengthSeconds > 0) {
      record.endsAtSeconds = startSeconds + lengthSeconds;
    } else {
      record.endsAtSeconds = startSeconds + this.options.defaultCueDurationSeconds;
    }

    this.mixer.preload(trigger.cue);
    record.handle = this.mixer.play(trigger.cue, {
      busId,
      startTimeSeconds: startSeconds,
      loop: record.loop,
      metadata: trigger.metadata ? clone(trigger.metadata) : null,
      severity: trigger.severity,
    });

    this.#applyDucking(busConfig.ducking, record);

    const ledgerEntry = {
      id: record.playbackId,
      cueId: record.cueId,
      categoryId: record.categoryId ?? null,
      busId: record.busId ?? busId,
      severity: trigger.severity ?? 'info',
      priority: record.priority ?? null,
      startedAtSeconds: Number.isFinite(startSeconds) ? startSeconds : null,
      startedAt: Number.isFinite(startSeconds) ? formatGET(startSeconds) : null,
      endedAtSeconds: null,
      endedAt: null,
      durationSeconds: null,
      stopReason: null,
      status: 'playing',
      sourceType: trigger.sourceType ?? null,
      sourceId: trigger.sourceId ?? null,
      metadata: trigger.metadata ? clone(trigger.metadata) : null,
      ducking: record.duckTargets.map((entry) => ({ targetBusId: entry.targetBusId, gain: entry.gain })),
      lengthSeconds: Number.isFinite(record.endsAtSeconds) && Number.isFinite(startSeconds)
        ? Math.max(0, record.endsAtSeconds - startSeconds)
        : null,
    };
    record.ledgerEntry = ledgerEntry;
    this.#appendLedgerEntry(ledgerEntry);

    if (this.recorder?.recordAudioEvent) {
      this.recorder.recordAudioEvent(clone(ledgerEntry));
    }

    const state = this.#ensureBusState(busId);
    state.active.push(record);

    const cooldownSeconds = cueMeta?.cooldownSeconds ?? null;
    if (Number.isFinite(cooldownSeconds) && startSeconds != null) {
      this.lastCueTrigger.set(record.cueId, startSeconds);
    }
    const categoryCooldown = this.categoryMap.get(record.categoryId)?.cooldownSeconds ?? null;
    if (Number.isFinite(categoryCooldown) && startSeconds != null) {
      this.lastCategoryTrigger.set(record.categoryId, startSeconds);
    }

    this.stats.played += 1;
    this.stats.lastCueId = record.cueId;
    this.stats.lastStartedAtSeconds = startSeconds;

    this.logger?.log(startSeconds ?? 0, `Audio cue playback started ${record.cueId}`, {
      logSource: this.logSource,
      logCategory: this.logCategory,
      logSeverity: trigger.severity ?? 'info',
      cueId: record.cueId,
      busId,
      categoryId: record.categoryId,
      loop: record.loop,
      metadata: trigger.metadata ? clone(trigger.metadata) : null,
      priority: record.priority,
    });
  }

  #stopPlayback(record, reason = 'stopped', currentGetSeconds = null) {
    if (!record) {
      return;
    }

    if (record.handle && typeof this.mixer.stop === 'function') {
      this.mixer.stop(record.handle, reason);
    }

    this.#removeDucking(record);

    this.stats.stopped += 1;

    const timestamp = currentGetSeconds ?? record.trigger?.triggeredAtSeconds ?? 0;
    this.logger?.log(timestamp, `Audio cue playback stopped ${record.cueId}`, {
      logSource: this.logSource,
      logCategory: this.logCategory,
      logSeverity: reason === 'preempted' ? 'warning' : 'info',
      cueId: record.cueId,
      busId: record.busId,
      reason,
    });

    if (record.ledgerEntry) {
      const entry = record.ledgerEntry;
      if (Number.isFinite(timestamp)) {
        entry.endedAtSeconds = timestamp;
        entry.endedAt = formatGET(timestamp);
        if (Number.isFinite(entry.startedAtSeconds)) {
          entry.durationSeconds = Math.max(0, timestamp - entry.startedAtSeconds);
        }
      }
      entry.stopReason = reason;
      entry.status = reason === 'complete'
        ? 'completed'
        : reason === 'preempted'
          ? 'preempted'
          : 'stopped';

      if (this.recorder?.recordAudioEvent) {
        this.recorder.recordAudioEvent(clone(entry));
      }
    }
  }

  #normalizeTrigger(rawTrigger, currentGetSeconds) {
    if (!rawTrigger) {
      return null;
    }
    const cueId = normalizeId(rawTrigger.cueId ?? rawTrigger.cue_id ?? rawTrigger.cue?.id ?? rawTrigger.id);
    if (!cueId) {
      return null;
    }

    const cueMeta = this.cueMap.get(cueId) ?? null;
    const categoryId = normalizeId(rawTrigger.categoryId ?? rawTrigger.category_id ?? rawTrigger.cue?.categoryId ?? cueMeta?.categoryId);
    const categoryMeta = categoryId ? this.categoryMap.get(categoryId) ?? null : null;
    let busId = normalizeId(rawTrigger.busId ?? rawTrigger.bus_id ?? rawTrigger.requestedBusId ?? rawTrigger.cue?.busId ?? cueMeta?.busId ?? categoryMeta?.busId);
    if (!busId) {
      busId = 'master';
    }

    const severity = typeof rawTrigger.severity === 'string' ? rawTrigger.severity.toLowerCase() : 'info';
    const priority = this.#resolvePriority(rawTrigger, cueMeta, categoryMeta, severity);
    const triggeredAtSeconds = coerceFinite(rawTrigger.triggeredAtSeconds ?? rawTrigger.getSeconds ?? null, currentGetSeconds);
    const sourceType = typeof rawTrigger.sourceType === 'string'
      ? rawTrigger.sourceType
      : typeof rawTrigger.source_type === 'string'
        ? rawTrigger.source_type
        : null;
    const sourceId = normalizeId(rawTrigger.sourceId ?? rawTrigger.source_id ?? null);

    return {
      cueId,
      busId,
      categoryId,
      severity,
      priority,
      triggeredAtSeconds,
      metadata: rawTrigger.metadata ? clone(rawTrigger.metadata) : null,
      cue: rawTrigger.cue ? { ...rawTrigger.cue } : cueMeta ? {
        id: cueMeta.id,
        name: cueMeta.name,
        categoryId: cueMeta.categoryId,
        busId: cueMeta.busId,
        priority: cueMeta.priority,
        lengthSeconds: cueMeta.lengthSeconds,
        loop: cueMeta.loop,
      } : { id: cueId, categoryId, busId },
      sequence: this.sequence += 1,
      sourceType,
      sourceId,
    };
  }

  #ensureBusState(busId) {
    const id = normalizeId(busId) ?? 'master';
    if (!this.busState.has(id)) {
      this.busState.set(id, { queue: [], active: [] });
    }
    return this.busState.get(id);
  }

  #compareTriggers(a, b) {
    if (a.priority !== b.priority) {
      return b.priority - a.priority;
    }
    const timeA = a.triggeredAtSeconds ?? Number.POSITIVE_INFINITY;
    const timeB = b.triggeredAtSeconds ?? Number.POSITIVE_INFINITY;
    if (timeA !== timeB) {
      return timeA - timeB;
    }
    return a.sequence - b.sequence;
  }

  #dequeueNextEligibleTrigger(state, currentGetSeconds) {
    while (state.queue.length > 0) {
      const next = state.queue.shift();
      if (!next) {
        continue;
      }
      if (this.#isUnderCooldown(next, next.triggeredAtSeconds ?? currentGetSeconds)) {
        this.stats.suppressed += 1;
        this.logger?.log(next.triggeredAtSeconds ?? currentGetSeconds ?? 0, `Audio cue ${next.cueId} suppressed by cooldown`, {
          logSource: this.logSource,
          logCategory: this.logCategory,
          logSeverity: 'notice',
          cueId: next.cueId,
          busId: next.busId,
          categoryId: next.categoryId,
        });
        continue;
      }
      return next;
    }
    return null;
  }

  #peekNextEligibleTrigger(state, currentGetSeconds) {
    for (let index = 0; index < state.queue.length; index += 1) {
      const trigger = state.queue[index];
      if (!trigger) {
        continue;
      }
      if (!this.#isUnderCooldown(trigger, trigger.triggeredAtSeconds ?? currentGetSeconds)) {
        return trigger;
      }
      this.stats.suppressed += 1;
      this.logger?.log(trigger.triggeredAtSeconds ?? currentGetSeconds ?? 0, `Audio cue ${trigger.cueId} suppressed by cooldown`, {
        logSource: this.logSource,
        logCategory: this.logCategory,
        logSeverity: 'notice',
        cueId: trigger.cueId,
        busId: trigger.busId,
        categoryId: trigger.categoryId,
      });
      state.queue.splice(index, 1);
      index -= 1;
    }
    return null;
  }

  #isUnderCooldown(trigger, timestampSeconds) {
    if (!trigger) {
      return false;
    }
    const now = Number.isFinite(timestampSeconds) ? timestampSeconds : null;
    if (now == null) {
      return false;
    }
    const cueMeta = this.cueMap.get(trigger.cueId) ?? null;
    const cueCooldown = Number.isFinite(cueMeta?.cooldownSeconds) ? cueMeta.cooldownSeconds : null;
    if (cueCooldown != null) {
      const lastCue = this.lastCueTrigger.get(trigger.cueId);
      if (Number.isFinite(lastCue) && now < lastCue + cueCooldown - EPSILON) {
        return true;
      }
    }
    const categoryCooldown = Number.isFinite(this.categoryMap.get(trigger.categoryId)?.cooldownSeconds)
      ? this.categoryMap.get(trigger.categoryId).cooldownSeconds
      : null;
    if (categoryCooldown != null) {
      const lastCategory = this.lastCategoryTrigger.get(trigger.categoryId);
      if (Number.isFinite(lastCategory) && now < lastCategory + categoryCooldown - EPSILON) {
        return true;
      }
    }
    return false;
  }

  #selectLowestPriorityActive(active) {
    if (!Array.isArray(active) || active.length === 0) {
      return null;
    }
    let lowest = active[0];
    for (const record of active) {
      if (record.priority < lowest.priority - EPSILON) {
        lowest = record;
      } else if (Math.abs(record.priority - lowest.priority) <= EPSILON) {
        const recordStart = record.startedAtSeconds ?? Number.POSITIVE_INFINITY;
        const lowestStart = lowest.startedAtSeconds ?? Number.POSITIVE_INFINITY;
        if (recordStart > lowestStart + EPSILON) {
          lowest = record;
        }
      }
    }
    return lowest;
  }

  #resolvePriority(trigger, cueMeta, categoryMeta, severity) {
    const base = Number.isFinite(trigger.priority)
      ? Number(trigger.priority)
      : Number.isFinite(trigger.cue?.priority)
        ? Number(trigger.cue.priority)
        : Number.isFinite(cueMeta?.priority)
          ? cueMeta.priority
          : Number.isFinite(categoryMeta?.defaultPriority)
            ? categoryMeta.defaultPriority
            : 0;
    const severityWeight = this.options.severityWeights?.[severity] ?? 0;
    return base + severityWeight;
  }

  #applyDucking(duckRules, record) {
    if (!Array.isArray(duckRules) || duckRules.length === 0) {
      return;
    }
    for (const rule of duckRules) {
      if (!rule || !rule.targetBusId) {
        continue;
      }
      const targetId = rule.targetBusId;
      let duckState = this.activeDucks.get(targetId);
      if (!duckState) {
        duckState = { contributions: new Map(), appliedGain: 1 };
        this.activeDucks.set(targetId, duckState);
      }
      const gain = Number.isFinite(rule.gainLinear) ? Math.min(1, Math.max(0, rule.gainLinear)) : 1;
      duckState.contributions.set(record.playbackId, gain);
      record.duckTargets.push({ targetBusId: targetId, gain });
      this.#updateBusGain(targetId);
    }
  }

  #removeDucking(record) {
    if (!record?.duckTargets) {
      return;
    }
    for (const entry of record.duckTargets) {
      const duckState = this.activeDucks.get(entry.targetBusId);
      if (!duckState) {
        continue;
      }
      duckState.contributions.delete(record.playbackId);
      if (duckState.contributions.size === 0) {
        this.activeDucks.delete(entry.targetBusId);
      }
      this.#updateBusGain(entry.targetBusId);
    }
    record.duckTargets.length = 0;
  }

  #updateBusGain(busId) {
    const duckState = this.activeDucks.get(busId);
    let targetGain = 1;
    if (duckState && duckState.contributions.size > 0) {
      targetGain = Math.min(...duckState.contributions.values());
    }
    const previousGain = this.busGains.get(busId);
    if (previousGain != null && Math.abs(previousGain - targetGain) <= EPSILON) {
      return;
    }
    this.busGains.set(busId, targetGain);
    if (typeof this.mixer.setGain === 'function') {
      this.mixer.setGain(busId, targetGain, { rampSeconds: this.options.duckingRampSeconds });
    }
  }

  #appendLedgerEntry(entry) {
    this.ledger.push(entry);
    const limit = this.options.maxLedgerEntries;
    if (Number.isFinite(limit) && limit > 0 && this.ledger.length > limit) {
      const excess = this.ledger.length - limit;
      if (excess > 0) {
        this.ledger.splice(0, excess);
      }
    }
  }

  ledgerSnapshot({ limit = null } = {}) {
    let entries = this.ledger;
    if (Number.isFinite(limit) && limit >= 0) {
      const start = Math.max(0, entries.length - limit);
      entries = entries.slice(start);
    } else {
      entries = entries.slice();
    }

    return entries.map((entry) => ({
      ...entry,
      metadata: entry.metadata ? clone(entry.metadata) : null,
      ducking: Array.isArray(entry.ducking)
        ? entry.ducking.map((duck) => ({ ...duck }))
        : [],
    }));
  }
}
