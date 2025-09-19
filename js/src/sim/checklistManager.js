const DEFAULT_OPTIONS = {
  autoAdvance: true,
  defaultStepDurationSeconds: 15,
  minStepDurationSeconds: 0.25,
  windowSafetyMarginSeconds: 0.5,
};

export class ChecklistManager {
  constructor(checklists, logger, options = {}) {
    this.logger = logger;
    this.checklists = checklists instanceof Map ? checklists : new Map();
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.active = new Map();
    this.metrics = {
      autoSteps: 0,
      manualSteps: 0,
      acknowledgedSteps: 0,
      completed: 0,
      aborted: 0,
    };
    this.manualActionRecorder = options.manualActionRecorder ?? null;
  }

  hasChecklist(checklistId) {
    if (!checklistId) {
      return false;
    }
    return this.checklists.has(checklistId);
  }

  getEventState(eventId) {
    return this.active.get(eventId) ?? null;
  }

  activateEvent(event, getSeconds, context = {}) {
    if (!event?.checklistId || !this.hasChecklist(event.checklistId)) {
      return null;
    }

    if (this.active.has(event.id)) {
      return this.active.get(event.id);
    }

    const checklist = this.checklists.get(event.checklistId);
    const steps = (checklist.steps ?? []).map((step) => ({
      stepNumber: step.stepNumber,
      action: step.action,
      expectedResponse: step.expectedResponse,
      reference: step.reference,
      acknowledged: false,
      acknowledgedAt: null,
      actor: null,
      note: null,
    }));

    const totalSteps = steps.length;
    const stepDurationSeconds = this.#computeStepDurationSeconds({
      totalSteps,
      activationGetSeconds: getSeconds,
      expectedDurationSeconds: context.expectedDurationSeconds,
      windowCloseSeconds: context.windowCloseSeconds,
    });

    const state = {
      eventId: event.id,
      checklistId: checklist.id,
      title: checklist.title,
      crewRole: checklist.crewRole,
      startGetSeconds: getSeconds,
      steps,
      stepDurationSeconds,
      nextAutoAckTime: this.options.autoAdvance && steps.length > 0
        ? getSeconds + stepDurationSeconds
        : null,
    };

    this.active.set(event.id, state);

    this.logger?.log(getSeconds, `Checklist ${checklist.id} started for event ${event.id}`, {
      logSource: 'sim',
      logCategory: 'checklist',
      logSeverity: 'notice',
      title: checklist.title,
      crewRole: checklist.crewRole,
      totalSteps: steps.length,
    });

    // Empty checklists can be considered complete immediately.
    if (steps.length === 0) {
      this.logger?.log(getSeconds, `Checklist ${checklist.id} contains no steps`, {
        logSource: 'sim',
        logCategory: 'checklist',
        logSeverity: 'warning',
        eventId: event.id,
      });
    }

    return state;
  }

  update(currentGetSeconds, _dtSeconds = 0) {
    if (!this.options.autoAdvance || this.active.size === 0) {
      return;
    }

    for (const state of this.active.values()) {
      if (state.steps.length === 0) {
        continue;
      }

      if (state.nextAutoAckTime == null) {
        continue;
      }

      if (currentGetSeconds < state.nextAutoAckTime) {
        continue;
      }

      this.acknowledgeNextStep(state.eventId, currentGetSeconds, {
        actor: 'AUTO_CREW',
        note: 'auto-advance',
      });
    }
  }

  acknowledgeNextStep(eventId, getSeconds, { actor = 'AUTO_CREW', note = null } = {}) {
    const state = this.active.get(eventId);
    if (!state) {
      return false;
    }

    const nextStep = state.steps.find((step) => !step.acknowledged);
    if (!nextStep) {
      state.nextAutoAckTime = null;
      return false;
    }

    this.#acknowledgeStep(state, nextStep, getSeconds, actor, note);

    if (this.options.autoAdvance) {
      const remaining = state.steps.find((step) => !step.acknowledged);
      state.nextAutoAckTime = remaining
        ? getSeconds + (state.stepDurationSeconds ?? this.options.defaultStepDurationSeconds)
        : null;
    }

    return true;
  }

  acknowledgeStep(eventId, stepNumber, getSeconds, { actor = 'CREW', note = null } = {}) {
    const state = this.active.get(eventId);
    if (!state) {
      return false;
    }

    const step = state.steps.find((item) => item.stepNumber === stepNumber);
    if (!step || step.acknowledged) {
      return false;
    }

    const previousIncomplete = state.steps
      .slice(0, state.steps.indexOf(step))
      .find((item) => !item.acknowledged);

    if (previousIncomplete) {
      return false;
    }

    this.#acknowledgeStep(state, step, getSeconds, actor, note);
    if (this.options.autoAdvance) {
      const remaining = state.steps.find((item) => !item.acknowledged);
      state.nextAutoAckTime = remaining
        ? getSeconds + (state.stepDurationSeconds ?? this.options.defaultStepDurationSeconds)
        : null;
    } else {
      state.nextAutoAckTime = null;
    }
    return true;
  }

  isEventComplete(eventId) {
    const state = this.active.get(eventId);
    if (!state) {
      return false;
    }

    return state.steps.every((step) => step.acknowledged);
  }

  finalizeEvent(eventId, getSeconds) {
    const state = this.active.get(eventId);
    if (!state) {
      return;
    }

    this.active.delete(eventId);
    this.metrics.completed += 1;

    this.logger?.log(getSeconds, `Checklist ${state.checklistId} complete for event ${eventId}`, {
      logSource: 'sim',
      logCategory: 'checklist',
      logSeverity: 'notice',
      title: state.title,
      totalSteps: state.steps.length,
      acknowledgedSteps: state.steps.filter((step) => step.acknowledged).length,
      durationSeconds: getSeconds - state.startGetSeconds,
    });
  }

  abortEvent(eventId, getSeconds, reason = 'event failed') {
    const state = this.active.get(eventId);
    if (!state) {
      return;
    }

    this.active.delete(eventId);
    this.metrics.aborted += 1;

    this.logger?.log(getSeconds, `Checklist ${state.checklistId} aborted for event ${eventId}`, {
      logSource: 'sim',
      logCategory: 'checklist',
      logSeverity: 'warning',
      reason,
      acknowledgedSteps: state.steps.filter((step) => step.acknowledged).length,
      totalSteps: state.steps.length,
    });
  }

  estimateDuration(checklistId) {
    if (!this.hasChecklist(checklistId)) {
      return 0;
    }

    const checklist = this.checklists.get(checklistId);
    const stepCount = (checklist.steps ?? []).length;
    if (stepCount === 0) {
      return 0;
    }

    return stepCount * this.options.defaultStepDurationSeconds;
  }

  stats() {
    const active = [];
    for (const state of this.active.values()) {
      const nextStep = state.steps.find((step) => !step.acknowledged) ?? null;
      active.push({
        eventId: state.eventId,
        checklistId: state.checklistId,
        title: state.title,
        crewRole: state.crewRole,
        completedSteps: state.steps.filter((step) => step.acknowledged).length,
        totalSteps: state.steps.length,
        nextStepNumber: nextStep?.stepNumber ?? null,
        nextStepAction: nextStep?.action ?? null,
        autoAdvancePending: Boolean(state.nextAutoAckTime && nextStep),
        stepDurationSeconds: state.stepDurationSeconds,
      });
    }

    return {
      totals: {
        active: this.active.size,
        completed: this.metrics.completed,
        aborted: this.metrics.aborted,
        acknowledgedSteps: this.metrics.acknowledgedSteps,
        autoSteps: this.metrics.autoSteps,
        manualSteps: this.metrics.manualSteps,
      },
      active,
    };
  }

  #computeStepDurationSeconds({ totalSteps, activationGetSeconds, expectedDurationSeconds, windowCloseSeconds }) {
    if (!this.options.autoAdvance || totalSteps <= 0) {
      return this.options.defaultStepDurationSeconds;
    }

    const candidates = [];

    if (Number.isFinite(expectedDurationSeconds) && expectedDurationSeconds > 0) {
      candidates.push(expectedDurationSeconds);
    }

    if (Number.isFinite(windowCloseSeconds)) {
      const windowRemaining = windowCloseSeconds - activationGetSeconds;
      if (Number.isFinite(windowRemaining) && windowRemaining > 0) {
        candidates.push(windowRemaining);
      }
    }

    let perStep = this.options.defaultStepDurationSeconds;
    if (candidates.length > 0) {
      const available = Math.min(...candidates);
      if (available > 0 && totalSteps > 0) {
        const adjustedAvailable = Math.max(
          available - this.options.windowSafetyMarginSeconds,
          this.options.minStepDurationSeconds,
        );
        perStep = Math.min(this.options.defaultStepDurationSeconds, adjustedAvailable / totalSteps);
      }
    }

    return Math.max(this.options.minStepDurationSeconds, perStep);
  }

  #acknowledgeStep(state, step, getSeconds, actor, note) {
    step.acknowledged = true;
    step.acknowledgedAt = getSeconds;
    step.actor = actor;
    step.note = note;

    if (actor === 'AUTO_CREW') {
      this.metrics.autoSteps += 1;
    } else {
      this.metrics.manualSteps += 1;
    }

    this.metrics.acknowledgedSteps += 1;

    const remaining = state.steps.filter((item) => !item.acknowledged).length;

    this.logger?.log(getSeconds, `Checklist ${state.checklistId} step ${step.stepNumber} acknowledged`, {
      logSource: 'sim',
      logCategory: 'checklist',
      logSeverity: 'notice',
      eventId: state.eventId,
      action: step.action,
      expectedResponse: step.expectedResponse,
      remainingSteps: remaining,
      actor,
    });

    this.manualActionRecorder?.recordChecklistAck({
      eventId: state.eventId,
      checklistId: state.checklistId,
      stepNumber: step.stepNumber,
      getSeconds,
      actor,
      note,
    });
  }
}
