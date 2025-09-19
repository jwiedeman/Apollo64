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
    this.logger = logger;
    this.resourceSystem = resourceSystem;
    this.options = options;
    this.checklistManager = options.checklistManager ?? null;
    this.autopilotRunner = options.autopilotRunner ?? null;
    this.autopilotSummaryHandlers = [];
    if (Array.isArray(options.autopilotSummaryHandlers)) {
      for (const handler of options.autopilotSummaryHandlers) {
        this.registerAutopilotSummaryHandler(handler);
      }
    }
    if (typeof options.onAutopilotSummary === 'function') {
      this.registerAutopilotSummaryHandler(options.onAutopilotSummary);
    }
    this.events = events.map((event) => this.prepareEvent(event, autopilotMap));
    this.eventMap = new Map(this.events.map((event) => [event.id, event]));
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
      phase: event.phase,
      ...context,
    });
    this.resourceSystem.applyEffect(event.failureEffects, {
      getSeconds: currentGetSeconds,
      source: event.id,
      type: 'failure',
    });
    if (event.checklistId && this.checklistManager) {
      this.checklistManager.abortEvent(event.id, currentGetSeconds, reason);
    }
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
