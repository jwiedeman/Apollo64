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
    this.events = events.map((event) => this.prepareEvent(event, autopilotMap));
    this.eventMap = new Map(this.events.map((event) => [event.id, event]));
  }

  prepareEvent(event, autopilotMap) {
    const autopilotId = event.autopilotId ?? event.autopilot_script ?? event.autopilot_script_id ?? null;
    const autopilot = autopilotId ? autopilotMap.get(autopilotId) ?? null : null;
    const hasChecklist = Boolean(event.checklistId && this.checklistManager?.hasChecklist(event.checklistId));
    const expectedDurationSeconds = this.estimateExpectedDuration({ event, autopilot, hasChecklist });
    const requiresDurationGate = Boolean(autopilot) || !hasChecklist;

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
    if (this.autopilotRunner) {
      this.autopilotRunner.finish(event.id, currentGetSeconds);
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

    event.status = STATUS.FAILED;
    this.logger.log(currentGetSeconds, `Event ${event.id} failed — ${reason}`, {
      phase: event.phase,
    });
    this.resourceSystem.applyEffect(event.failureEffects, {
      getSeconds: currentGetSeconds,
      source: event.id,
      type: 'failure',
    });
    if (event.checklistId && this.checklistManager) {
      this.checklistManager.abortEvent(event.id, currentGetSeconds, reason);
    }
    if (this.autopilotRunner) {
      this.autopilotRunner.abort(event.id, currentGetSeconds, reason);
    }
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

    for (const event of this.events) {
      counts[event.status] += 1;
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
      }));

    return { counts, upcoming };
  }
}
