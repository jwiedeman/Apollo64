import { formatGET } from '../utils/time.js';

const DEFAULT_OPTIONS = {
  maxPending: 250,
  logSource: 'audio',
  logCategory: 'audio',
};

function clone(value) {
  return value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value;
}

function normalizeCueId(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeSeverity(value, fallback) {
  if (typeof value !== 'string') {
    return fallback ?? 'notice';
  }
  const normalized = value.toLowerCase();
  switch (normalized) {
    case 'failure':
    case 'fatal':
      return 'failure';
    case 'warning':
    case 'caution':
      return normalized;
    case 'info':
    case 'notice':
      return normalized;
    default:
      return fallback ?? 'notice';
  }
}

function severityForCategory(categoryId) {
  switch ((categoryId ?? '').toLowerCase()) {
    case 'alert':
      return 'failure';
    case 'telemetry':
      return 'notice';
    case 'ui':
      return 'info';
    case 'ambient':
      return 'info';
    case 'callout':
      return 'notice';
    default:
      return 'notice';
  }
}

function severityForClassification(classification) {
  switch ((classification ?? '').toLowerCase()) {
    case 'hard':
      return 'failure';
    case 'recoverable':
      return 'warning';
    case 'success':
      return 'notice';
    default:
      return 'caution';
  }
}

function buildCueSummary(cue, category, bus) {
  return {
    id: cue?.id ?? null,
    name: cue?.name ?? null,
    categoryId: cue?.category ?? null,
    categoryName: category?.name ?? null,
    busId: bus?.id ?? category?.bus ?? null,
    priority: Number.isFinite(cue?.priority)
      ? Number(cue.priority)
      : Number.isFinite(category?.defaultPriority)
        ? Number(category.defaultPriority)
        : null,
    lengthSeconds: Number.isFinite(cue?.lengthSeconds)
      ? Number(cue.lengthSeconds)
      : null,
    loop: cue?.loop === true,
  };
}

export class AudioCueBinder {
  constructor(catalog = null, logger = null, options = {}) {
    this.logger = logger ?? null;
    this.options = { ...DEFAULT_OPTIONS, ...(options ?? {}) };
    this.catalog = catalog && typeof catalog === 'object' ? catalog : { cues: [], categories: [], buses: [] };
    this.cueMap = new Map();
    this.categoryMap = new Map();
    this.busMap = new Map();
    this.pending = [];
    this.stats = {
      totalTriggers: 0,
      lastCueId: null,
      lastTriggeredAtSeconds: null,
    };
    this.failureState = new Map();

    this.#indexCatalog();
  }

  recordEvent(event, { getSeconds = null, status = null, severity = null } = {}) {
    if (!event) {
      return null;
    }
    const cueId = normalizeCueId(event.audioCueId ?? event.audio_cue ?? null);
    if (!cueId) {
      return null;
    }
    const metadata = {
      eventId: event.id ?? null,
      phase: event.phase ?? null,
      status: status ?? event.status ?? null,
      checklistId: event.checklistId ?? null,
      autopilotId: event.autopilotId ?? null,
    };
    return this.#enqueueTrigger({
      cueId,
      requestedBusId: normalizeCueId(event.audioChannel ?? event.audio_channel ?? null),
      sourceType: 'event',
      sourceId: event.id ?? null,
      severity,
      metadata,
    }, getSeconds);
  }

  recordChecklistStep(checklist, step, {
    getSeconds = null,
    eventId = null,
    actor = null,
    severity = 'info',
  } = {}) {
    if (!step) {
      return null;
    }
    const cueId = normalizeCueId(step.audioCueComplete ?? step.audio_cue_complete ?? null);
    if (!cueId) {
      return null;
    }
    const metadata = {
      checklistId: checklist?.id ?? null,
      checklistTitle: checklist?.title ?? null,
      crewRole: checklist?.crewRole ?? null,
      eventId: eventId ?? checklist?.eventId ?? null,
      stepNumber: step.stepNumber ?? null,
      action: step.action ?? null,
      expectedResponse: step.expectedResponse ?? null,
      actor,
    };
    return this.#enqueueTrigger({
      cueId,
      sourceType: 'checklist',
      sourceId: metadata.checklistId ?? metadata.eventId ?? null,
      severity,
      metadata,
    }, getSeconds);
  }

  recordFailure({
    id,
    classification = null,
    audioCueWarning = null,
    audioCueFailure = null,
    occurrences = 1,
    note = null,
    source = null,
    context = null,
    metadata = null,
  }, {
    getSeconds = null,
    severity = null,
    isNew = false,
  } = {}) {
    const failureId = normalizeCueId(id);
    if (!failureId) {
      return null;
    }

    if (!isNew && occurrences > 1 && this.failureState.has(failureId)) {
      return null;
    }

    const normalizedWarning = normalizeCueId(audioCueWarning);
    const normalizedFailure = normalizeCueId(audioCueFailure);
    let cueId = null;
    if (normalizedFailure) {
      cueId = normalizedFailure;
    } else if (normalizedWarning) {
      cueId = normalizedWarning;
    }

    if (!cueId) {
      return null;
    }

    this.failureState.set(failureId, cueId);

    const resolvedSeverity = severity
      ?? severityForClassification(classification)
      ?? (normalizedFailure ? 'failure' : 'warning');

    const metadataPayload = {
      failureId,
      classification: classification ?? null,
      note,
      source,
      occurrences,
      context: context ? clone(context) : null,
      catalog: metadata ? clone(metadata) : null,
    };

    return this.#enqueueTrigger({
      cueId,
      sourceType: 'failure',
      sourceId: failureId,
      severity: resolvedSeverity,
      metadata: metadataPayload,
    }, getSeconds);
  }

  recordCommunications(pass, {
    getSeconds = null,
    type = 'acquire',
    severity = 'notice',
  } = {}) {
    if (!pass) {
      return null;
    }
    const cueId = normalizeCueId(
      type === 'loss'
        ? pass.cueOnLoss ?? pass.cue_on_loss
        : pass.cueOnAcquire ?? pass.cue_on_acquire,
    );
    if (!cueId) {
      return null;
    }
    const requestedBusId = normalizeCueId(
      type === 'loss'
        ? pass.cueChannelOnLoss ?? pass.cue_channel_on_loss
        : pass.cueChannelOnAcquire ?? pass.cue_channel_on_acquire,
    );
    const metadata = {
      passId: pass.id ?? pass.pass_id ?? null,
      station: pass.station ?? null,
      nextStation: pass.nextStation ?? pass.next_station ?? null,
      type,
      durationSeconds: pass.durationSeconds ?? null,
    };
    return this.#enqueueTrigger({
      cueId,
      requestedBusId,
      sourceType: 'communications',
      sourceId: metadata.passId,
      severity,
      metadata,
    }, getSeconds);
  }

  drainPending() {
    if (this.pending.length === 0) {
      return [];
    }
    const copy = this.pending.map((entry) => ({
      ...entry,
      metadata: entry.metadata ? clone(entry.metadata) : null,
      cue: entry.cue ? { ...entry.cue } : null,
    }));
    this.pending.length = 0;
    return copy;
  }

  peekPending() {
    return this.pending.map((entry) => ({
      ...entry,
      metadata: entry.metadata ? clone(entry.metadata) : null,
      cue: entry.cue ? { ...entry.cue } : null,
    }));
  }

  statsSnapshot() {
    return {
      totalTriggers: this.stats.totalTriggers,
      pendingCount: this.pending.length,
      lastCueId: this.stats.lastCueId,
      lastTriggeredAtSeconds: this.stats.lastTriggeredAtSeconds,
      lastTriggeredAt: this.stats.lastTriggeredAtSeconds != null
        ? formatGET(this.stats.lastTriggeredAtSeconds)
        : null,
    };
  }

  resolveCue(cueId) {
    const normalized = normalizeCueId(cueId);
    if (!normalized) {
      return null;
    }
    return this.cueMap.get(normalized) ?? null;
  }

  #indexCatalog() {
    if (Array.isArray(this.catalog?.buses)) {
      for (const bus of this.catalog.buses) {
        const id = normalizeCueId(bus?.id);
        if (!id || this.busMap.has(id)) {
          continue;
        }
        this.busMap.set(id, { ...bus, id });
      }
    }

    if (Array.isArray(this.catalog?.categories)) {
      for (const category of this.catalog.categories) {
        const id = normalizeCueId(category?.id);
        if (!id || this.categoryMap.has(id)) {
          continue;
        }
        const busId = normalizeCueId(category?.bus);
        const resolvedBus = busId ? this.busMap.get(busId) ?? { id: busId } : null;
        this.categoryMap.set(id, { ...category, id, bus: resolvedBus?.id ?? category?.bus ?? null });
      }
    }

    if (Array.isArray(this.catalog?.cues)) {
      for (const cue of this.catalog.cues) {
        const id = normalizeCueId(cue?.id);
        if (!id || this.cueMap.has(id)) {
          continue;
        }
        this.cueMap.set(id, { ...cue, id });
      }
    }
  }

  #enqueueTrigger({ cueId, requestedBusId = null, sourceType = 'system', sourceId = null, severity = null, metadata = null }, getSeconds) {
    const normalizedCueId = normalizeCueId(cueId);
    if (!normalizedCueId) {
      return null;
    }

    const cue = this.cueMap.get(normalizedCueId);
    if (!cue) {
      this.logger?.log(getSeconds ?? 0, `Audio cue ${normalizedCueId} missing from catalog`, {
        logSource: this.options.logSource,
        logCategory: this.options.logCategory,
        logSeverity: 'warning',
        cueId: normalizedCueId,
        sourceType,
        sourceId,
      });
      return null;
    }

    const category = cue.category ? this.categoryMap.get(normalizeCueId(cue.category)) ?? null : null;
    const busId = requestedBusId ?? category?.bus ?? null;
    const bus = busId ? this.busMap.get(busId) ?? { id: busId } : null;
    const resolvedSeverity = normalizeSeverity(severity, severityForCategory(category?.id ?? cue.category ?? null));

    const triggeredAtSeconds = Number.isFinite(getSeconds) ? getSeconds : null;

    const cueSummary = buildCueSummary(cue, category, bus);
    const trigger = {
      cueId: normalizedCueId,
      triggeredAtSeconds,
      triggeredAt: triggeredAtSeconds != null ? formatGET(triggeredAtSeconds) : null,
      severity: resolvedSeverity,
      sourceType,
      sourceId: sourceId ?? null,
      busId: bus?.id ?? null,
      requestedBusId: requestedBusId ?? null,
      metadata: metadata ? clone(metadata) : null,
      cue: cueSummary,
    };

    this.pending.push(trigger);
    if (this.pending.length > this.options.maxPending) {
      const excess = this.pending.length - this.options.maxPending;
      this.pending.splice(0, excess);
    }

    this.stats.totalTriggers += 1;
    this.stats.lastCueId = normalizedCueId;
    this.stats.lastTriggeredAtSeconds = triggeredAtSeconds;

    this.logger?.log(triggeredAtSeconds ?? 0, `Audio cue triggered ${normalizedCueId}`, {
      logSource: this.options.logSource,
      logCategory: this.options.logCategory,
      logSeverity: resolvedSeverity,
      cueId: normalizedCueId,
      busId: trigger.busId,
      requestedBusId: trigger.requestedBusId,
      sourceType,
      sourceId: trigger.sourceId,
      metadata: trigger.metadata ? clone(trigger.metadata) : null,
      priority: cueSummary.priority,
    });

    return trigger;
  }
}
