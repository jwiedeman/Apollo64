import { formatGET } from '../utils/time.js';

const STATUS = {
  PENDING: 'pending',
  ARMED: 'armed',
  ACTIVE: 'active',
  COMPLETE: 'complete',
  FAILED: 'failed',
};

export class EventScheduler {
  constructor(events, autopilotMap, resourceSystem, logger, options = {}) {
    const {
      checklistManager = null,
      autopilotRunner = null,
      autopilotSummaryHandlers = null,
      onAutopilotSummary = null,
      audioBinder = null,
      failureCascades = null,
      ...restOptions
    } = options ?? {};
    this.logger = logger;
    this.resourceSystem = resourceSystem;
    this.options = restOptions;
    this.checklistManager = checklistManager;
    this.autopilotRunner = autopilotRunner;
    this.audioBinder = audioBinder ?? null;
    this.autopilotSummaryHandlers = [];
    if (Array.isArray(autopilotSummaryHandlers)) {
      for (const handler of autopilotSummaryHandlers) {
        this.registerAutopilotSummaryHandler(handler);
      }
    }
    if (typeof onAutopilotSummary === 'function') {
      this.registerAutopilotSummaryHandler(onAutopilotSummary);
    }
    this.events = events.map((event) => this.prepareEvent(event, autopilotMap));
    this.eventMap = new Map(this.events.map((event) => [event.id, event]));
    this.failureCascades = this.#normalizeFailureCascades(failureCascades);
    this.appliedFailureCascades = new Map();
  }

  registerAutopilotSummaryHandler(handler) {
    if (typeof handler === 'function') {
      this.autopilotSummaryHandlers.push(handler);
    }
  }

  prepareEvent(event, autopilotMap) {
    const autopilotId = event.autopilotId ?? event.autopilot_script ?? event.autopilot_script_id ?? null;
    const autopilot = autopilotId ? autopilotMap.get(autopilotId) ?? null : null;
    const hasChecklist = Boolean(event.checklistId && this.checklistManager?.hasChecklist(event.checklistId));
    const expectedDurationSeconds = this.estimateExpectedDuration({ event, autopilot, hasChecklist });
    const requiresDurationGate = Boolean(autopilot) || !hasChecklist;

    const padId = event.padId ? event.padId.trim() || null : null;
    return {
      ...event,
      autopilotId,
      autopilot,
      status: STATUS.PENDING,
      activationTimeSeconds: null,
      completionTimeSeconds: null,
      expectedDurationSeconds,
      requiresDurationGate,
      requiresChecklist: hasChecklist,
      lastAutopilotSummary: null,
      padId,
      originalGetOpenSeconds: event.getOpenSeconds ?? null,
      originalGetCloseSeconds: event.getCloseSeconds ?? null,
      cascadeTriggers: [],
    };
  }

  estimateExpectedDuration({ event, autopilot, hasChecklist }) {
    if (autopilot?.durationSeconds > 0) {
      return autopilot.durationSeconds;
    }

    if (hasChecklist && this.checklistManager) {
      const estimate = this.checklistManager.estimateDuration(event.checklistId);
      if (estimate > 0) {
        return estimate;
      }
    }

    const windowSeconds = Math.max(0, (event.getCloseSeconds ?? 0) - (event.getOpenSeconds ?? 0));
    if (windowSeconds <= 0) {
      return 120;
    }

    const halfWindow = windowSeconds * 0.5;
    const safeWindow = Math.max(5, windowSeconds - 1);
    return Math.max(5, Math.min(halfWindow, safeWindow, 600));
  }

  update(currentGetSeconds, dtSeconds) {
    if (this.checklistManager) {
      this.checklistManager.update(currentGetSeconds, dtSeconds);
    }

    for (const event of this.events) {
      switch (event.status) {
        case STATUS.PENDING:
          this.maybeArm(event, currentGetSeconds);
          break;
        case STATUS.ARMED:
          this.maybeActivate(event, currentGetSeconds);
          this.maybeFail(event, currentGetSeconds, 'Window expired before activation');
          break;
        case STATUS.ACTIVE:
          this.maybeComplete(event, currentGetSeconds);
          this.maybeFail(event, currentGetSeconds, 'Window expired during execution');
          break;
        default:
          break;
      }
    }

    if (this.autopilotRunner) {
      this.autopilotRunner.update(currentGetSeconds, dtSeconds);
    }
  }

  maybeArm(event, currentGetSeconds) {
    if (event.getOpenSeconds == null) {
      return;
    }

    if (currentGetSeconds < event.getOpenSeconds) {
      return;
    }

    if (!this.arePrerequisitesComplete(event)) {
      return;
    }

    event.status = STATUS.ARMED;
    this.logger.log(currentGetSeconds, `Event ${event.id} armed`, {
      logSource: 'sim',
      logCategory: 'event',
      logSeverity: 'notice',
      phase: event.phase,
      window: `${formatGET(event.getOpenSeconds)} → ${formatGET(event.getCloseSeconds)}`,
    });
  }

  maybeActivate(event, currentGetSeconds) {
    if (event.status !== STATUS.ARMED) {
      return;
    }

    if (currentGetSeconds < (event.getOpenSeconds ?? 0)) {
      return;
    }

    event.status = STATUS.ACTIVE;
    event.activationTimeSeconds = currentGetSeconds;
    this.logger.log(currentGetSeconds, `Event ${event.id} active`, {
      logSource: 'sim',
      logCategory: 'event',
      logSeverity: 'notice',
      autopilot: event.autopilotId,
      checklist: event.checklistId,
      expectedDurationSeconds: event.expectedDurationSeconds,
    });
    if (event.checklistId && this.checklistManager) {
      this.checklistManager.activateEvent(event, currentGetSeconds, {
        expectedDurationSeconds: event.expectedDurationSeconds,
        windowCloseSeconds: event.getCloseSeconds,
      });
    }
    if (event.autopilot && this.autopilotRunner) {
      this.autopilotRunner.start(event, currentGetSeconds);
    }
    if (this.audioBinder) {
      this.audioBinder.recordEvent(event, {
        getSeconds: currentGetSeconds,
        status: STATUS.ACTIVE,
      });
    }
  }

  maybeComplete(event, currentGetSeconds) {
    if (event.status !== STATUS.ACTIVE) {
      return;
    }

    const elapsed = currentGetSeconds - (event.activationTimeSeconds ?? currentGetSeconds);
    const timerSatisfied = !event.requiresDurationGate || elapsed >= event.expectedDurationSeconds;
    const checklistSatisfied = !event.requiresChecklist || this.checklistManager?.isEventComplete(event.id);

    if (!timerSatisfied || !checklistSatisfied) {
      return;
    }

    let autopilotSummary = null;
    if (event.autopilot && this.autopilotRunner) {
      this.autopilotRunner.finish(event.id, currentGetSeconds);
      autopilotSummary =
        this.autopilotRunner.consumeEventSummary(event.id)
        ?? null;
      const toleranceFailure = this.evaluateAutopilotTolerance(event, autopilotSummary);
      if (toleranceFailure) {
        event.lastAutopilotSummary = autopilotSummary;
        this.failEvent(event, currentGetSeconds, toleranceFailure.reason, {
          abortAutopilot: false,
          context: toleranceFailure.context,
        });
        return;
      }
    }

    event.status = STATUS.COMPLETE;
    event.completionTimeSeconds = currentGetSeconds;
    this.logger.log(currentGetSeconds, `Event ${event.id} complete`, {
      logSource: 'sim',
      logCategory: 'event',
      logSeverity: 'notice',
      phase: event.phase,
    });
    this.resourceSystem.applyEffect(event.successEffects, {
      getSeconds: currentGetSeconds,
      source: event.id,
      type: 'success',
    });
    if (event.checklistId && this.checklistManager) {
      this.checklistManager.finalizeEvent(event.id, currentGetSeconds);
    }
    if (autopilotSummary) {
      event.lastAutopilotSummary = autopilotSummary;
    } else if (this.autopilotRunner && event.autopilot) {
      event.lastAutopilotSummary =
        this.autopilotRunner.consumeEventSummary(event.id) ?? null;
    }
    if (event.lastAutopilotSummary) {
      this.#emitAutopilotSummary(event, event.lastAutopilotSummary);
    }
  }

  maybeFail(event, currentGetSeconds, reason) {
    if (event.status === STATUS.COMPLETE || event.status === STATUS.FAILED) {
      return;
    }

    if (event.getCloseSeconds == null) {
      return;
    }

    if (currentGetSeconds <= event.getCloseSeconds) {
      return;
    }

    this.failEvent(event, currentGetSeconds, reason);
  }

  arePrerequisitesComplete(event) {
    if (!event.prerequisites || event.prerequisites.length === 0) {
      return true;
    }

    for (const prereqId of event.prerequisites) {
      const prereq = this.eventMap.get(prereqId);
      if (!prereq || prereq.status !== STATUS.COMPLETE) {
        return false;
      }
    }
    return true;
  }

  stats() {
    const counts = {
      [STATUS.PENDING]: 0,
      [STATUS.ARMED]: 0,
      [STATUS.ACTIVE]: 0,
      [STATUS.COMPLETE]: 0,
      [STATUS.FAILED]: 0,
    };

    const timeline = {};

    for (const event of this.events) {
      if (counts[event.status] != null) {
        counts[event.status] += 1;
      }

      const activationSeconds = event.activationTimeSeconds ?? null;
      const completionSeconds = event.completionTimeSeconds ?? null;

      timeline[event.id] = {
        status: event.status,
        checklistId: event.checklistId ?? null,
        autopilotId: event.autopilotId ?? null,
        padId: event.padId ?? null,
        expectedDurationSeconds: event.expectedDurationSeconds ?? null,
        activationSeconds,
        completionSeconds,
        activationGET: activationSeconds != null ? formatGET(activationSeconds) : null,
        completionGET: completionSeconds != null ? formatGET(completionSeconds) : null,
      };
      if (Array.isArray(event.cascadeTriggers) && event.cascadeTriggers.length > 0) {
        timeline[event.id].cascadeTriggers = event.cascadeTriggers.map((trigger) => ({
          failureId: trigger.failureId ?? null,
          sourceEventId: trigger.sourceEventId ?? null,
          triggeredAtSeconds: trigger.triggeredAtSeconds ?? null,
          triggeredAt: Number.isFinite(trigger.triggeredAtSeconds)
            ? formatGET(trigger.triggeredAtSeconds)
            : null,
        }));
      }
      if (
        Number.isFinite(event.originalGetOpenSeconds)
        && Number.isFinite(event.getOpenSeconds)
        && Math.abs(event.originalGetOpenSeconds - event.getOpenSeconds) > 1e-6
      ) {
        timeline[event.id].windowOverrides = {
          originalOpenSeconds: event.originalGetOpenSeconds,
          originalOpenGET: formatGET(event.originalGetOpenSeconds),
          currentOpenSeconds: event.getOpenSeconds,
          currentOpenGET: formatGET(event.getOpenSeconds),
        };
      }
      if (
        Number.isFinite(event.originalGetCloseSeconds)
        && Number.isFinite(event.getCloseSeconds)
        && Math.abs(event.originalGetCloseSeconds - event.getCloseSeconds) > 1e-6
      ) {
        if (!timeline[event.id].windowOverrides) {
          timeline[event.id].windowOverrides = {};
        }
        timeline[event.id].windowOverrides.originalCloseSeconds = event.originalGetCloseSeconds;
        timeline[event.id].windowOverrides.originalCloseGET = formatGET(event.originalGetCloseSeconds);
        timeline[event.id].windowOverrides.currentCloseSeconds = event.getCloseSeconds;
        timeline[event.id].windowOverrides.currentCloseGET = formatGET(event.getCloseSeconds);
      }
    }

    const upcoming = this.events
      .filter((event) => event.status === STATUS.PENDING || event.status === STATUS.ARMED)
      .sort((a, b) => (a.getOpenSeconds ?? Infinity) - (b.getOpenSeconds ?? Infinity))
      .slice(0, 5)
      .map((event) => ({
        id: event.id,
        phase: event.phase,
        status: event.status,
        opensAt: formatGET(event.getOpenSeconds ?? 0),
        opensAtSeconds: event.getOpenSeconds ?? null,
        padId: event.padId ?? null,
      }));

    return { counts, upcoming, timeline };
  }

  failEvent(event, currentGetSeconds, reason, { abortAutopilot = true, context = {} } = {}) {
    if (event.status === STATUS.COMPLETE || event.status === STATUS.FAILED) {
      return;
    }

    event.status = STATUS.FAILED;
    event.completionTimeSeconds = currentGetSeconds;
    this.logger.log(currentGetSeconds, `Event ${event.id} failed — ${reason}`, {
      logSource: 'sim',
      logCategory: 'event',
      logSeverity: 'failure',
      phase: event.phase,
      ...context,
    });
    let autopilotSummary = null;
    if (this.autopilotRunner && (event.autopilot || abortAutopilot)) {
      if (abortAutopilot) {
        this.autopilotRunner.abort(event.id, currentGetSeconds, reason);
      }
      autopilotSummary = this.autopilotRunner.consumeEventSummary(event.id) ?? null;
    }
    if (autopilotSummary) {
      event.lastAutopilotSummary = autopilotSummary;
    }
    const failureContext = context ? { ...context } : {};
    if (event.lastAutopilotSummary && !failureContext.autopilotSummary) {
      failureContext.autopilotSummary = event.lastAutopilotSummary;
    }
    this.resourceSystem.applyEffect(event.failureEffects, {
      getSeconds: currentGetSeconds,
      source: event.id,
      type: 'failure',
      context: failureContext,
    });
    const failureIds = this.#extractFailureIds(event.failureEffects);
    if (failureIds.length > 0) {
      this.#applyFailureCascades(event, failureIds, currentGetSeconds, {
        reason,
        context: failureContext,
      });
    }
    if (event.checklistId && this.checklistManager) {
      this.checklistManager.abortEvent(event.id, currentGetSeconds, reason);
    }
    if (event.lastAutopilotSummary) {
      this.#emitAutopilotSummary(event, event.lastAutopilotSummary);
    }
  }

  #emitAutopilotSummary(event, summary) {
    if (!summary || this.autopilotSummaryHandlers.length === 0) {
      return;
    }
    for (const handler of this.autopilotSummaryHandlers) {
      if (typeof handler !== 'function') {
        continue;
      }
      try {
        handler(event, summary);
      } catch (error) {
        this.logger?.log(summary.completedAtSeconds ?? event.completionTimeSeconds ?? 0, 'Autopilot summary handler error', {
          logSource: 'sim',
          logCategory: 'autopilot',
          logSeverity: 'failure',
          eventId: event?.id ?? null,
          autopilotId: summary?.autopilotId ?? null,
          error: error?.message ?? String(error),
        });
      }
    }
  }

  getEventById(eventId) {
    if (!eventId) {
      return null;
    }
    return this.eventMap.get(eventId) ?? null;
  }

  evaluateAutopilotTolerance(event, summary) {
    if (!event?.autopilot || !summary) {
      return null;
    }

    const tolerances = event.autopilot.tolerances ?? {};
    const epsilon = 1e-6;

    if (summary.status === 'aborted') {
      return {
        reason: 'Autopilot aborted',
        context: { autopilotId: summary.autopilotId, autopilotStatus: summary.status },
      };
    }

    const checks = [
      this.#evaluateMetric({
        label: 'burn duration',
        actual: summary.metrics?.burnSeconds,
        expected: summary.expected?.burnSeconds,
        deviation: summary.deviations?.burnSeconds,
        absoluteTolerance: tolerances?.burn_seconds,
        percentTolerance: tolerances?.burn_seconds_pct,
        epsilon,
      }),
      this.#evaluateMetric({
        label: 'propellant usage',
        actual: summary.metrics?.propellantKg,
        expected: summary.expected?.propellantKg,
        deviation: summary.deviations?.propellantKg,
        absoluteTolerance: tolerances?.propellant_kg,
        percentTolerance: tolerances?.propellant_pct,
        epsilon,
      }),
      this.#evaluateMetric({
        label: 'Δv',
        actual: summary.deviations?.deltaVMps,
        expected: 0,
        deviation: summary.deviations?.deltaVMps,
        absoluteTolerance: this.#resolveDeltaVTolerance(tolerances),
        percentTolerance: null,
        epsilon,
        unit: 'm/s',
      }),
    ];

    for (const result of checks) {
      if (result?.failed) {
        return {
          reason: `${result.label} out of tolerance`,
          context: {
            autopilotId: summary.autopilotId,
            metric: result.label,
            deviation: result.deviation,
            allowed: result.allowed,
            unit: result.unit,
          },
        };
      }
    }

    return null;
  }

  #evaluateMetric({
    label,
    actual,
    expected,
    deviation,
    absoluteTolerance,
    percentTolerance,
    epsilon,
    unit = null,
  }) {
    const resolvedActual = Number.isFinite(actual) ? actual : null;
    const resolvedExpected = Number.isFinite(expected) ? expected : null;
    const resolvedDeviation = Number.isFinite(deviation)
      ? deviation
      : resolvedActual != null && resolvedExpected != null
        ? resolvedActual - resolvedExpected
        : null;

    if (resolvedDeviation == null) {
      return null;
    }

    const absolute = this.#coerceNumber(absoluteTolerance);
    const percent = this.#coerceNumber(percentTolerance);

    let allowed = null;
    if (absolute != null && absolute >= 0) {
      allowed = absolute;
    }
    if (percent != null && percent >= 0 && resolvedExpected != null) {
      const relative = Math.abs(resolvedExpected) * percent;
      if (allowed == null) {
        allowed = relative;
      } else {
        allowed = Math.max(allowed, relative);
      }
    }

    if (allowed == null) {
      return null;
    }

    if (Math.abs(resolvedDeviation) > allowed + (epsilon ?? 0)) {
      return {
        failed: true,
        label,
        deviation: resolvedDeviation,
        allowed,
        unit,
      };
    }

    return {
      failed: false,
      label,
      deviation: resolvedDeviation,
      allowed,
      unit,
    };
  }

  #normalizeFailureCascades(raw) {
    const cascades = new Map();
    if (!raw) {
      return cascades;
    }
    if (raw instanceof Map) {
      for (const [id, config] of raw.entries()) {
        const normalized = this.#normalizeCascadeConfig(id, config);
        if (normalized) {
          cascades.set(normalized.id, normalized);
        }
      }
      return cascades;
    }
    if (Array.isArray(raw)) {
      for (const entry of raw) {
        const normalized = this.#normalizeCascadeConfig(entry?.id, entry);
        if (normalized) {
          cascades.set(normalized.id, normalized);
        }
      }
      return cascades;
    }
    if (typeof raw === 'object') {
      for (const [id, config] of Object.entries(raw)) {
        const normalized = this.#normalizeCascadeConfig(id, config);
        if (normalized) {
          cascades.set(normalized.id, normalized);
        }
      }
    }
    return cascades;
  }

  #normalizeCascadeConfig(id, config) {
    const cascadeId = typeof id === 'string' ? id.trim() : null;
    if (!cascadeId) {
      return null;
    }
    const source = config && typeof config === 'object' ? config : {};
    const effectSource = source.resourceEffects ?? source.resource_effects ?? null;
    const resourceEffects = effectSource && typeof effectSource === 'object'
      ? JSON.parse(JSON.stringify(effectSource))
      : null;
    const repeatable = source.repeatable === true || source.repeat === true;
    const applyOnce = source.applyOnce === true || source.apply_once === true;
    const armRaw = source.armEvents ?? source.arm_events ?? [];
    const armList = Array.isArray(armRaw) ? armRaw : [armRaw];
    const armEvents = armList
      .map((entry) => this.#normalizeCascadeArmConfig(entry))
      .filter((entry) => entry != null);
    const log = this.#normalizeCascadeLogConfig(source.log ?? source.logMessage ?? source.message ?? null);
    const tagsRaw = Array.isArray(source.tags) ? source.tags : Array.isArray(source.tag) ? source.tag : null;
    const tags = Array.isArray(tagsRaw)
      ? tagsRaw
        .map((tag) => (typeof tag === 'string' ? tag.trim() : null))
        .filter((tag) => tag && tag.length > 0)
      : [];
    const notesSource = typeof source.notes === 'string'
      ? source.notes.trim()
      : typeof source.note === 'string'
        ? source.note.trim()
        : null;
    const notes = notesSource && notesSource.length > 0 ? notesSource : null;
    const metadata = source.metadata && typeof source.metadata === 'object'
      ? JSON.parse(JSON.stringify(source.metadata))
      : null;

    return {
      id: cascadeId,
      resourceEffects,
      repeatable,
      applyOnce,
      armEvents,
      log,
      tags,
      notes,
      metadata,
    };
  }

  #normalizeCascadeArmConfig(entry) {
    if (!entry) {
      return null;
    }
    if (typeof entry === 'string') {
      const eventId = entry.trim();
      if (!eventId) {
        return null;
      }
      return {
        eventId,
        allowBeforeWindow: false,
        autoActivate: false,
        offsetSeconds: null,
        logMessage: null,
      };
    }
    if (typeof entry !== 'object') {
      return null;
    }
    const eventIdSource = entry.eventId ?? entry.event_id ?? entry.id ?? entry.target ?? null;
    const eventId = typeof eventIdSource === 'string' ? eventIdSource.trim() : null;
    if (!eventId) {
      return null;
    }
    const allowBeforeWindow = entry.allowBeforeWindow ?? entry.allow_before_window ?? entry.force ?? false;
    const autoActivate = entry.autoActivate ?? entry.auto_activate ?? false;
    const offsetSeconds = this.#coerceNumber(
      entry.offsetSeconds
        ?? entry.offset_seconds
        ?? entry.openOffsetSeconds
        ?? entry.open_offset_seconds
        ?? entry.delaySeconds
        ?? entry.delay_seconds,
    );
    const logMessageSource = entry.logMessage ?? entry.log ?? null;
    const logMessage = typeof logMessageSource === 'string' && logMessageSource.trim().length > 0
      ? logMessageSource.trim()
      : null;
    return {
      eventId,
      allowBeforeWindow: allowBeforeWindow === true,
      autoActivate: autoActivate === true,
      offsetSeconds: Number.isFinite(offsetSeconds) ? offsetSeconds : null,
      logMessage,
    };
  }

  #normalizeCascadeLogConfig(value) {
    if (!value) {
      return null;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed.length > 0 ? { message: trimmed, severity: 'warning' } : null;
    }
    if (typeof value !== 'object') {
      return null;
    }
    const messageSource = value.message ?? value.text ?? value.description ?? null;
    const message = typeof messageSource === 'string' ? messageSource.trim() : null;
    if (!message) {
      return null;
    }
    const severitySource = value.severity ?? value.level ?? null;
    const severity = typeof severitySource === 'string' && severitySource.trim().length > 0
      ? severitySource.trim()
      : 'warning';
    return { message, severity };
  }

  #extractFailureIds(effect) {
    if (!effect || typeof effect !== 'object') {
      return [];
    }
    const ids = new Set();
    if (typeof effect.failure_id === 'string' && effect.failure_id.trim().length > 0) {
      ids.add(effect.failure_id.trim());
    }
    if (Array.isArray(effect.failures)) {
      for (const entry of effect.failures) {
        if (typeof entry === 'string') {
          const trimmed = entry.trim();
          if (trimmed.length > 0) {
            ids.add(trimmed);
          }
          continue;
        }
        if (!entry || typeof entry !== 'object') {
          continue;
        }
        const candidate = typeof entry.failure_id === 'string'
          ? entry.failure_id.trim()
          : typeof entry.id === 'string'
            ? entry.id.trim()
            : null;
        if (candidate) {
          ids.add(candidate);
        }
      }
    }
    return Array.from(ids);
  }

  #applyFailureCascades(event, failureIds, currentGetSeconds, info = {}) {
    if (!this.failureCascades || this.failureCascades.size === 0) {
      return;
    }
    for (const failureId of failureIds) {
      const cascade = this.failureCascades.get(failureId);
      if (!cascade) {
        continue;
      }
      const previousCount = this.appliedFailureCascades.get(failureId) ?? 0;
      if (previousCount > 0 && (!cascade.repeatable || cascade.applyOnce)) {
        continue;
      }
      this.appliedFailureCascades.set(failureId, previousCount + 1);
      const cascadeContext = info?.context ? { ...info.context } : {};
      cascadeContext.failureId = failureId;
      cascadeContext.sourceEventId = event?.id ?? null;
      if (Array.isArray(cascade.tags) && cascade.tags.length > 0) {
        cascadeContext.cascadeTags = cascade.tags;
      }
      if (cascade.notes) {
        cascadeContext.cascadeNotes = cascade.notes;
      }
      if (cascade.metadata) {
        cascadeContext.cascadeMetadata = cascade.metadata;
      }
      if (info?.reason) {
        cascadeContext.reason = info.reason;
      }
      if (cascade.resourceEffects) {
        this.resourceSystem.applyEffect(cascade.resourceEffects, {
          getSeconds: currentGetSeconds,
          source: `${event?.id ?? 'cascade'}:${failureId}`,
          type: 'failure_cascade',
          context: cascadeContext,
        });
      }
      if (cascade.log) {
        this.logger?.log(currentGetSeconds, cascade.log.message, {
          logSource: 'sim',
          logCategory: 'event',
          logSeverity: cascade.log.severity ?? 'warning',
          eventId: event?.id ?? null,
          failureId,
        });
      } else {
        this.logger?.log(currentGetSeconds, `Failure cascade triggered for ${failureId}`, {
          logSource: 'sim',
          logCategory: 'event',
          logSeverity: 'warning',
          eventId: event?.id ?? null,
          failureId,
        });
      }
      if (Array.isArray(cascade.armEvents) && cascade.armEvents.length > 0) {
        for (const armConfig of cascade.armEvents) {
          this.#applyCascadeArm(event, failureId, armConfig, currentGetSeconds);
        }
      }
    }
  }

  #applyCascadeArm(sourceEvent, failureId, armConfig, currentGetSeconds) {
    if (!armConfig?.eventId) {
      return;
    }
    const target = this.getEventById(armConfig.eventId);
    if (!target) {
      this.logger?.log(currentGetSeconds, `Failure cascade ${failureId} target event ${armConfig.eventId} not found`, {
        logSource: 'sim',
        logCategory: 'event',
        logSeverity: 'warning',
        failureId,
        sourceEventId: sourceEvent?.id ?? null,
      });
      return;
    }
    if (!Array.isArray(target.cascadeTriggers)) {
      target.cascadeTriggers = [];
    }
    target.cascadeTriggers.push({
      failureId,
      sourceEventId: sourceEvent?.id ?? null,
      triggeredAtSeconds: currentGetSeconds,
    });
    const message = armConfig.logMessage
      ?? `Failure cascade ${failureId} prepared event ${target.id}`;
    this.logger?.log(currentGetSeconds, message, {
      logSource: 'sim',
      logCategory: 'event',
      logSeverity: 'notice',
      failureId,
      eventId: target.id,
      sourceEventId: sourceEvent?.id ?? null,
    });
    if (target.status === STATUS.COMPLETE || target.status === STATUS.FAILED) {
      return;
    }
    if (armConfig.allowBeforeWindow) {
      const offset = Number.isFinite(armConfig.offsetSeconds) ? armConfig.offsetSeconds : 0;
      const candidateOpen = currentGetSeconds + offset;
      if (!Number.isFinite(target.originalGetOpenSeconds)) {
        target.originalGetOpenSeconds = target.originalGetOpenSeconds ?? target.getOpenSeconds ?? null;
      }
      if (!Number.isFinite(target.getOpenSeconds) || candidateOpen < target.getOpenSeconds) {
        target.getOpenSeconds = candidateOpen;
      }
    } else if (Number.isFinite(armConfig.offsetSeconds) && Number.isFinite(target.getOpenSeconds)) {
      target.getOpenSeconds += armConfig.offsetSeconds;
    }
    if (
      Number.isFinite(target.getCloseSeconds)
      && Number.isFinite(target.getOpenSeconds)
      && target.getCloseSeconds < target.getOpenSeconds
    ) {
      target.getCloseSeconds = target.getOpenSeconds;
    }
    if (target.status === STATUS.PENDING) {
      this.maybeArm(target, currentGetSeconds);
    }
    if (armConfig.autoActivate && target.status === STATUS.ARMED) {
      this.maybeActivate(target, currentGetSeconds);
    }
  }

  #resolveDeltaVTolerance(tolerances) {
    if (!tolerances) {
      return null;
    }

    const deltaVMps = this.#coerceNumber(tolerances.delta_v_mps);
    if (Number.isFinite(deltaVMps) && deltaVMps >= 0) {
      return deltaVMps;
    }

    const deltaVFps = this.#coerceNumber(tolerances.delta_v_ft_s);
    if (Number.isFinite(deltaVFps) && deltaVFps >= 0) {
      return deltaVFps / 3.280839895013123;
    }

    return null;
  }

  #coerceNumber(value) {
    if (value == null) {
      return null;
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        return null;
      }
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }
}
