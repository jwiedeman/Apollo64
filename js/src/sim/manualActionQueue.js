import fs from 'fs/promises';
import path from 'path';
import { parseGET } from '../utils/time.js';

const DEFAULT_OPTIONS = {
  epsilon: 1e-6,
  retryIntervalSeconds: 1,
};

const ACTION_STATUS = {
  SUCCESS: 'success',
  FAILURE: 'failure',
  RETRY: 'retry',
};

export class ManualActionQueue {
  constructor(actions = [], { logger = null, checklistManager = null, resourceSystem = null, options = {} } = {}) {
    this.logger = logger;
    this.checklistManager = checklistManager;
    this.resourceSystem = resourceSystem;
    this.options = { ...DEFAULT_OPTIONS, ...options };

    this.queue = [];
    this.history = [];
    this.metrics = {
      scheduled: 0,
      executed: 0,
      failed: 0,
      retried: 0,
      acknowledgedSteps: 0,
      resourceDeltas: 0,
      propellantBurns: 0,
    };
    this._nextInternalId = 0;

    if (Array.isArray(actions) && actions.length > 0) {
      this.addActions(actions);
    }
    this.metrics.scheduled = this.queue.length;
  }

  static async fromFile(filePath, { logger = null, checklistManager = null, resourceSystem = null, options = {} } = {}) {
    const absolutePath = path.resolve(filePath);
    const content = await fs.readFile(absolutePath, 'utf8');
    let payload;
    try {
      payload = JSON.parse(content);
    } catch (error) {
      throw new Error(`Failed to parse manual action script ${absolutePath}: ${error.message}`);
    }

    const actions = Array.isArray(payload) ? payload : payload?.actions ?? [];
    if (!Array.isArray(actions)) {
      throw new Error(`Manual action script ${absolutePath} must contain an array of actions`);
    }

    const queue = new ManualActionQueue([], { logger, checklistManager, resourceSystem, options });
    queue.addActions(actions);
    queue.metrics.scheduled = queue.queue.length;
    queue.logger?.log(0, 'Manual action script loaded', {
      scriptPath: absolutePath,
      scheduledActions: queue.queue.length,
    });
    return queue;
  }

  addActions(actions) {
    for (const action of actions) {
      this.addAction(action);
    }
    this.metrics.scheduled = this.queue.length;
    return this;
  }

  addAction(rawAction) {
    const action = normalizeAction(rawAction, this._nextInternalId);
    this._nextInternalId += 1;
    this.queue.push(action);
    this.queue.sort((a, b) => (a.getSeconds - b.getSeconds) || (a.internalId - b.internalId));
    return this;
  }

  update(currentGetSeconds, dtSeconds = 0) {
    if (this.queue.length === 0) {
      return;
    }

    const epsilon = this.options.epsilon ?? DEFAULT_OPTIONS.epsilon;
    const retryInterval = dtSeconds > 0 ? dtSeconds : (this.options.retryIntervalSeconds ?? DEFAULT_OPTIONS.retryIntervalSeconds);

    while (this.queue.length > 0) {
      const action = this.queue[0];
      const readyTime = action.nextAttemptSeconds ?? action.getSeconds;
      if (currentGetSeconds + epsilon < readyTime) {
        break;
      }

      const result = this.#executeAction(action, currentGetSeconds);

      if (result.status === ACTION_STATUS.RETRY && this.#canRetry(action, currentGetSeconds)) {
        this.metrics.retried += 1;
        action.nextAttemptSeconds = Math.max(currentGetSeconds + retryInterval, readyTime + retryInterval);
        if (action.retryUntilSeconds != null) {
          action.nextAttemptSeconds = Math.min(action.nextAttemptSeconds, action.retryUntilSeconds);
        }
        if (action.nextAttemptSeconds <= currentGetSeconds + epsilon) {
          action.nextAttemptSeconds = currentGetSeconds + retryInterval;
        }
        continue;
      }

      this.queue.shift();
      const historyEntry = {
        id: action.id,
        type: action.type,
        executedAt: currentGetSeconds,
        status: result.status,
        details: result.details ?? {},
      };

      if (result.status === ACTION_STATUS.SUCCESS) {
        this.metrics.executed += 1;
      } else if (result.status === ACTION_STATUS.FAILURE) {
        this.metrics.failed += 1;
        if (result.details?.reason) {
          historyEntry.details.reason = result.details.reason;
        }
      }

      this.history.push(historyEntry);
    }
  }

  stats() {
    return {
      scheduled: this.metrics.scheduled,
      pending: this.queue.length,
      executed: this.metrics.executed,
      failed: this.metrics.failed,
      retried: this.metrics.retried,
      acknowledgedSteps: this.metrics.acknowledgedSteps,
      resourceDeltas: this.metrics.resourceDeltas,
      propellantBurns: this.metrics.propellantBurns,
    };
  }

  historySnapshot() {
    return [...this.history];
  }

  #executeAction(action, currentGetSeconds) {
    switch (action.type) {
      case 'checklist_ack':
        return this.#executeChecklistAck(action, currentGetSeconds);
      case 'resource_delta':
        return this.#executeResourceDelta(action, currentGetSeconds);
      case 'propellant_burn':
        return this.#executePropellantBurn(action, currentGetSeconds);
      default:
        this.logger?.log(currentGetSeconds, `Unknown manual action type ${action.type}`, {
          actionId: action.id,
        });
        return { status: ACTION_STATUS.FAILURE, details: { reason: 'unknown_action_type' } };
    }
  }

  #executeChecklistAck(action, currentGetSeconds) {
    if (!this.checklistManager) {
      return { status: ACTION_STATUS.FAILURE, details: { reason: 'no_checklist_manager' } };
    }

    const state = this.checklistManager.getEventState(action.eventId);
    if (!state) {
      if (this.#shouldRetry(action, currentGetSeconds)) {
        return { status: ACTION_STATUS.RETRY, details: { reason: 'event_inactive' } };
      }
      return { status: ACTION_STATUS.FAILURE, details: { reason: 'event_inactive' } };
    }

    const remainingSteps = state.steps?.filter((step) => !step.acknowledged).length ?? 0;
    if (remainingSteps === 0) {
      return { status: ACTION_STATUS.SUCCESS, details: { alreadyComplete: true } };
    }

    let acknowledged = 0;
    for (let i = 0; i < action.count; i += 1) {
      const success = this.checklistManager.acknowledgeNextStep(action.eventId, currentGetSeconds, {
        actor: action.actor,
        note: action.note ?? action.id,
      });
      if (!success) {
        break;
      }
      acknowledged += 1;
    }

    if (acknowledged === 0) {
      if (this.#shouldRetry(action, currentGetSeconds)) {
        return { status: ACTION_STATUS.RETRY, details: { reason: 'step_not_ready' } };
      }
      return { status: ACTION_STATUS.FAILURE, details: { reason: 'step_not_acknowledged' } };
    }

    this.metrics.acknowledgedSteps += acknowledged;
    this.logger?.log(currentGetSeconds, 'Manual checklist override executed', {
      actionId: action.id,
      eventId: action.eventId,
      acknowledgedSteps: acknowledged,
      actor: action.actor,
      note: action.note ?? undefined,
    });

    return { status: ACTION_STATUS.SUCCESS, details: { acknowledged } };
  }

  #executeResourceDelta(action, currentGetSeconds) {
    if (!this.resourceSystem) {
      return { status: ACTION_STATUS.FAILURE, details: { reason: 'no_resource_system' } };
    }

    if (!action.effect || Object.keys(action.effect).length === 0) {
      return { status: ACTION_STATUS.FAILURE, details: { reason: 'empty_effect' } };
    }

    this.resourceSystem.applyEffect(action.effect, {
      getSeconds: currentGetSeconds,
      source: action.source,
      type: 'manual',
    });
    this.metrics.resourceDeltas += 1;

    this.logger?.log(currentGetSeconds, 'Manual resource delta applied', {
      actionId: action.id,
      source: action.source,
    });

    return { status: ACTION_STATUS.SUCCESS }; 
  }

  #executePropellantBurn(action, currentGetSeconds) {
    if (!this.resourceSystem) {
      return { status: ACTION_STATUS.FAILURE, details: { reason: 'no_resource_system' } };
    }

    if (!action.tankKey) {
      return { status: ACTION_STATUS.FAILURE, details: { reason: 'missing_tank' } };
    }

    const success = this.resourceSystem.recordPropellantUsage(action.tankKey, action.amountKg, {
      getSeconds: currentGetSeconds,
      source: action.source,
      note: action.note ?? undefined,
    });

    if (!success) {
      if (this.#shouldRetry(action, currentGetSeconds)) {
        return { status: ACTION_STATUS.RETRY, details: { reason: 'propellant_unavailable' } };
      }
      return { status: ACTION_STATUS.FAILURE, details: { reason: 'propellant_unavailable' } };
    }

    this.metrics.propellantBurns += 1;
    return { status: ACTION_STATUS.SUCCESS, details: { deltaKg: action.amountKg } };
  }

  #shouldRetry(action, currentGetSeconds) {
    if (action.retryUntilSeconds == null) {
      return false;
    }
    const epsilon = this.options.epsilon ?? DEFAULT_OPTIONS.epsilon;
    return currentGetSeconds + epsilon < action.retryUntilSeconds;
  }

  #canRetry(action, currentGetSeconds) {
    if (!this.#shouldRetry(action, currentGetSeconds)) {
      return false;
    }
    const epsilon = this.options.epsilon ?? DEFAULT_OPTIONS.epsilon;
    return (action.retryUntilSeconds ?? -Infinity) > currentGetSeconds + epsilon;
  }
}

function normalizeAction(rawAction, internalId) {
  if (!rawAction || typeof rawAction !== 'object') {
    throw new Error('Manual action entries must be objects');
  }

  const type = (rawAction.type ?? 'checklist_ack').trim();
  const getSeconds = coerceGetSeconds(rawAction.get ?? rawAction.get_seconds ?? rawAction.time);
  if (!Number.isFinite(getSeconds)) {
    throw new Error(`Manual action is missing a valid GET/time value: ${JSON.stringify(rawAction)}`);
  }

  const id = rawAction.id ?? `${type}_${internalId}`;
  const retryUntilSeconds = coerceRetryUntil(rawAction, getSeconds);

  const base = {
    internalId,
    id,
    type,
    getSeconds,
    retryUntilSeconds,
    nextAttemptSeconds: getSeconds,
    source: rawAction.source ?? id,
  };

  switch (type) {
    case 'checklist_ack': {
      const eventId = rawAction.event_id ?? rawAction.eventId;
      if (!eventId) {
        throw new Error(`Manual checklist action ${id} requires an event_id`);
      }
      return {
        ...base,
        eventId,
        count: Math.max(1, Number.parseInt(rawAction.count ?? 1, 10) || 1),
        actor: rawAction.actor ?? 'MANUAL_CREW',
        note: rawAction.note ?? null,
      };
    }
    case 'resource_delta': {
      const effect = coerceEffect(rawAction.effect ?? rawAction.delta ?? {});
      return {
        ...base,
        effect,
        note: rawAction.note ?? null,
      };
    }
    case 'propellant_burn': {
      const tankKey = normalizeTankKey(rawAction.tank ?? rawAction.tank_key ?? rawAction.propellant);
      if (!tankKey) {
        throw new Error(`Manual propellant burn ${id} must specify a tank`);
      }
      const amountKg = coerceMassKg(rawAction.amount_kg ?? rawAction.amountKg, rawAction.amount_lb ?? rawAction.amountLb);
      if (!Number.isFinite(amountKg)) {
        throw new Error(`Manual propellant burn ${id} requires a numeric amount (kg or lb)`);
      }
      return {
        ...base,
        tankKey,
        amountKg,
        note: rawAction.note ?? null,
      };
    }
    default:
      return base;
  }
}

function coerceGetSeconds(value) {
  if (Number.isFinite(value)) {
    return Number(value);
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = parseGET(value.trim());
    if (parsed != null) {
      return parsed;
    }
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return null;
}

function coerceRetryUntil(raw, getSeconds) {
  const retryWindowSeconds = Number(raw.retry_window_seconds ?? raw.retryWindowSeconds);
  if (Number.isFinite(retryWindowSeconds) && retryWindowSeconds > 0) {
    return getSeconds + retryWindowSeconds;
  }

  const retryUntil = raw.retry_until ?? raw.retryUntil;
  if (retryUntil == null) {
    return null;
  }
  const parsed = coerceGetSeconds(retryUntil);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeTankKey(value) {
  if (!value) {
    return null;
  }
  const trimmed = String(value).trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed.endsWith('_kg') ? trimmed : `${trimmed}_kg`;
}

function coerceMassKg(amountKg, amountLb) {
  if (Number.isFinite(amountKg)) {
    return Number(amountKg);
  }
  if (Number.isFinite(amountLb)) {
    return Number(amountLb) * 0.45359237;
  }
  return null;
}

function coerceEffect(effect) {
  if (!effect || typeof effect !== 'object') {
    return {};
  }
  return effect;
}
