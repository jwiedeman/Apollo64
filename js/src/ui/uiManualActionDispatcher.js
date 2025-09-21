import { formatGET, parseGET } from '../utils/time.js';

function normalizeString(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function clonePlain(value) {
  if (value == null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => clonePlain(entry));
  }
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] = clonePlain(entry);
  }
  return result;
}

function coerceNumber(value) {
  if (Number.isFinite(value)) {
    return Number(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsedGet = parseGET(trimmed);
    if (Number.isFinite(parsedGet)) {
      return parsedGet;
    }
    const numeric = Number(trimmed);
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
}

function coercePositiveInteger(value, fallback = 1) {
  const numeric = Number.isFinite(value) ? Number(value) : Number.parseInt(value ?? fallback, 10);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(1, Math.floor(numeric));
}

function normalizeActor(value, fallback = 'UI') {
  const normalized = normalizeString(value);
  if (!normalized) {
    return fallback;
  }
  return normalized.toUpperCase();
}

function normalizeSource(value, actor, fallback = 'ui') {
  const normalized = normalizeString(value);
  if (normalized) {
    return normalized.toLowerCase();
  }
  if (actor) {
    return actor.toLowerCase();
  }
  return fallback;
}

function normalizeNote(value) {
  const normalized = normalizeString(value);
  return normalized ?? null;
}

function normalizeEffect(effect) {
  if (!effect || typeof effect !== 'object') {
    return {};
  }
  return clonePlain(effect);
}

function normalizeTankKey(value) {
  const normalized = normalizeString(value ?? '');
  if (!normalized) {
    return null;
  }
  const upper = normalized.toLowerCase();
  return upper.endsWith('_kg') ? upper : `${upper}_kg`;
}

function coerceMassKg(amountKg, amountLb) {
  if (Number.isFinite(amountKg)) {
    return Number(amountKg);
  }
  if (Number.isFinite(amountLb)) {
    return Number(amountLb) * 0.45359237;
  }
  if (typeof amountKg === 'string' && amountKg.trim()) {
    const numeric = Number(amountKg.trim());
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  if (typeof amountLb === 'string' && amountLb.trim()) {
    const numeric = Number(amountLb.trim());
    if (Number.isFinite(numeric)) {
      return numeric * 0.45359237;
    }
  }
  return null;
}

function normalizeMacroId(value) {
  const normalized = normalizeString(value);
  return normalized ?? null;
}

function coerceVerbOrNoun(value) {
  if (value == null) {
    return null;
  }
  if (Number.isFinite(value)) {
    return Number(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const numeric = Number.parseInt(trimmed, 10);
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
}

function normalizeRegisters(raw) {
  if (!raw || typeof raw !== 'object') {
    return {};
  }

  if (Array.isArray(raw)) {
    const registers = {};
    raw.forEach((value, index) => {
      const key = `R${index + 1}`;
      const normalizedValue = normalizeRegisterValue(value);
      if (normalizedValue != null) {
        registers[key] = normalizedValue;
      }
    });
    return registers;
  }

  const registers = {};
  for (const [key, value] of Object.entries(raw)) {
    const normalizedKey = normalizeString(key)?.toUpperCase();
    if (!normalizedKey) {
      continue;
    }
    const normalizedValue = normalizeRegisterValue(value);
    if (normalizedValue != null) {
      registers[normalizedKey] = normalizedValue;
    }
  }
  return registers;
}

function normalizeRegisterValue(value) {
  if (value == null) {
    return null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (Number.isFinite(value)) {
    return Number(value).toString();
  }
  return null;
}

function normalizeSequence(raw) {
  if (!raw) {
    return [];
  }
  if (Array.isArray(raw)) {
    return raw
      .map((entry) => (entry == null ? '' : String(entry).trim()))
      .filter((entry) => entry.length > 0);
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) {
      return [];
    }
    if (trimmed.includes('\n')) {
      return trimmed
        .split('\n')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
    }
    if (trimmed.includes(',')) {
      return trimmed
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
    }
    return [trimmed];
  }
  return [];
}

function resolveTimestamp(spec, timeProvider) {
  const candidates = [
    spec?.getSeconds,
    spec?.get_seconds,
    spec?.get,
    spec?.timeSeconds,
    spec?.time,
    spec?.timestampSeconds,
    spec?.timestamp,
  ];

  for (const candidate of candidates) {
    const numeric = coerceNumber(candidate);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }

  if (typeof timeProvider === 'function') {
    const provided = coerceNumber(timeProvider());
    if (Number.isFinite(provided)) {
      return provided;
    }
  }

  return 0;
}

function normalizeRetry(spec) {
  const windowSeconds = coerceNumber(
    spec.retryWindowSeconds ?? spec.retry_window_seconds,
  );
  if (Number.isFinite(windowSeconds) && windowSeconds > 0) {
    return { retryWindowSeconds: windowSeconds, retryUntilSeconds: null };
  }

  const retryUntil = coerceNumber(spec.retryUntilSeconds ?? spec.retry_until ?? spec.retryUntil);
  if (Number.isFinite(retryUntil)) {
    return { retryWindowSeconds: null, retryUntilSeconds: retryUntil };
  }

  return { retryWindowSeconds: null, retryUntilSeconds: null };
}

const DEFAULT_HISTORY_LIMIT = 128;

export class UiManualActionDispatcher {
  constructor({
    manualActionQueue = null,
    logger = null,
    eventBus = null,
    recorder = null,
    timeProvider = () => 0,
    defaultActor = 'UI',
    defaultSource = 'ui',
    logSource = 'ui',
    logCategory = 'manual',
    historyLimit = DEFAULT_HISTORY_LIMIT,
    recordIntents = false,
  } = {}) {
    this.manualActionQueue = manualActionQueue;
    this.logger = logger;
    this.eventBus = eventBus;
    this.recorder = recorder;
    this.timeProvider = typeof timeProvider === 'function' ? timeProvider : () => 0;
    this.defaultActor = normalizeActor(defaultActor, 'UI');
    this.defaultSource = normalizeSource(defaultSource, this.defaultActor, 'ui');
    this.logSource = logSource ?? 'ui';
    this.logCategory = logCategory ?? 'manual';
    this.recordIntents = recordIntents === true;

    const limit = Number.isFinite(historyLimit) && historyLimit > 0 ? Math.floor(historyLimit) : DEFAULT_HISTORY_LIMIT;
    this.historyLimit = Math.max(1, limit);

    this.history = [];
    this.handlers = new Map();
    this.anyHandlers = new Set();
    this.actionCounter = 0;
  }

  setManualActionQueue(queue) {
    this.manualActionQueue = queue;
    return this;
  }

  setRecorder(recorder) {
    this.recorder = recorder;
    return this;
  }

  onAnyAction(handler) {
    if (typeof handler !== 'function') {
      return () => {};
    }
    this.anyHandlers.add(handler);
    return () => {
      this.anyHandlers.delete(handler);
    };
  }

  onAction(type, handler) {
    const normalized = this.#normalizeType(type);
    if (!normalized || typeof handler !== 'function') {
      return () => {};
    }
    let bucket = this.handlers.get(normalized);
    if (!bucket) {
      bucket = new Set();
      this.handlers.set(normalized, bucket);
    }
    bucket.add(handler);
    return () => {
      bucket.delete(handler);
      if (bucket.size === 0) {
        this.handlers.delete(normalized);
      }
    };
  }

  clearHistory() {
    this.history.length = 0;
  }

  getHistory() {
    return this.history.map((entry) => clonePlain(entry));
  }

  dispatch(actionSpec = {}) {
    const type = this.#normalizeType(actionSpec.type ?? actionSpec.actionType ?? actionSpec.command);
    if (!type) {
      return null;
    }

    switch (type) {
      case 'checklist_ack':
        return this.dispatchChecklistAck(actionSpec);
      case 'resource_delta':
        return this.dispatchResourceDelta(actionSpec);
      case 'propellant_burn':
        return this.dispatchPropellantBurn(actionSpec);
      case 'dsky_entry':
        return this.dispatchDskyEntry(actionSpec);
      default:
        throw new Error(`Unsupported manual action type: ${type}`);
    }
  }

  dispatchChecklistAck(spec = {}) {
    const manualQueue = this.#requireQueue();
    const getSeconds = resolveTimestamp(spec, this.timeProvider);
    const actor = normalizeActor(spec.actor, this.defaultActor);
    const source = normalizeSource(spec.source, actor, this.defaultSource);
    const eventId = normalizeString(spec.eventId ?? spec.event_id);
    if (!eventId) {
      throw new Error('Checklist acknowledgement requires an eventId');
    }

    const id = spec.id ?? this.#nextActionId('checklist');
    const note = normalizeNote(spec.note);
    const count = coercePositiveInteger(spec.count, 1);
    const retry = normalizeRetry(spec);

    const queueAction = {
      id,
      type: 'checklist_ack',
      get: getSeconds,
      event_id: eventId,
      count,
      actor,
      source,
    };
    if (note) {
      queueAction.note = note;
    }
    if (retry.retryWindowSeconds != null) {
      queueAction.retry_window_seconds = retry.retryWindowSeconds;
    }
    if (retry.retryUntilSeconds != null) {
      queueAction.retry_until = retry.retryUntilSeconds;
    }

    const payload = {
      eventId,
      count,
      note,
      checklistId: normalizeString(spec.checklistId ?? spec.checklist_id),
      stepNumber: Number.isFinite(spec.stepNumber) ? Number(spec.stepNumber) : spec.step_number ?? null,
      retryWindowSeconds: retry.retryWindowSeconds,
      retryUntilSeconds: retry.retryUntilSeconds,
    };

    this.#enqueueAction(manualQueue, queueAction, getSeconds, 'checklist_ack', actor, source, payload);

    if (this.recordIntents && this.recorder) {
      this.recorder.recordChecklistAck({
        eventId,
        checklistId: payload.checklistId ?? null,
        stepNumber: Number.isFinite(payload.stepNumber) ? Number(payload.stepNumber) : null,
        getSeconds,
        actor,
        note,
      });
    }

    return this.history[this.history.length - 1] ?? null;
  }

  dispatchResourceDelta(spec = {}) {
    const manualQueue = this.#requireQueue();
    const getSeconds = resolveTimestamp(spec, this.timeProvider);
    const actor = normalizeActor(spec.actor, this.defaultActor);
    const source = normalizeSource(spec.source, actor, this.defaultSource);
    const id = spec.id ?? this.#nextActionId('resource');
    const note = normalizeNote(spec.note);
    const effect = normalizeEffect(spec.effect ?? spec.delta ?? {});
    const context = spec.context ? clonePlain(spec.context) : null;

    const queueAction = {
      id,
      type: 'resource_delta',
      get: getSeconds,
      source,
      effect,
    };
    if (note) {
      queueAction.note = note;
    }
    if (context) {
      queueAction.context = context;
    }

    const payload = {
      effect: clonePlain(effect),
      note,
      context: context ? clonePlain(context) : null,
    };

    this.#enqueueAction(manualQueue, queueAction, getSeconds, 'resource_delta', actor, source, payload);
    return this.history[this.history.length - 1] ?? null;
  }

  dispatchPropellantBurn(spec = {}) {
    const manualQueue = this.#requireQueue();
    const getSeconds = resolveTimestamp(spec, this.timeProvider);
    const actor = normalizeActor(spec.actor, this.defaultActor);
    const source = normalizeSource(spec.source, actor, this.defaultSource);
    const id = spec.id ?? this.#nextActionId('propellant');
    const note = normalizeNote(spec.note);
    const tankKey = normalizeTankKey(spec.tankKey ?? spec.tank ?? spec.propellant);
    if (!tankKey) {
      throw new Error('Propellant burn requires a tank identifier');
    }
    const amountKg = coerceMassKg(spec.amountKg ?? spec.amount_kg, spec.amountLb ?? spec.amount_lb);
    if (!Number.isFinite(amountKg)) {
      throw new Error('Propellant burn requires a numeric amount (kg or lb)');
    }

    const queueAction = {
      id,
      type: 'propellant_burn',
      get: getSeconds,
      source,
      tank: tankKey,
      amount_kg: amountKg,
    };
    if (note) {
      queueAction.note = note;
    }

    const payload = {
      tankKey,
      amountKg,
      note,
    };

    this.#enqueueAction(manualQueue, queueAction, getSeconds, 'propellant_burn', actor, source, payload);
    return this.history[this.history.length - 1] ?? null;
  }

  dispatchDskyEntry(spec = {}) {
    const manualQueue = this.#requireQueue();
    const getSeconds = resolveTimestamp(spec, this.timeProvider);
    const actor = normalizeActor(spec.actor, this.defaultActor);
    const source = normalizeSource(spec.source, actor, this.defaultSource);
    const id = spec.id ?? this.#nextActionId('dsky');
    const note = normalizeNote(spec.note);
    const macroId = normalizeMacroId(spec.macroId ?? spec.macro_id ?? spec.macro);
    const verb = coerceVerbOrNoun(spec.verb);
    const noun = coerceVerbOrNoun(spec.noun);
    const program = normalizeMacroId(spec.program ?? spec.agcProgram ?? spec.agc_program);
    const registers = normalizeRegisters(spec.registers ?? spec.register_values ?? spec.registerValues ?? spec.values);
    const sequence = normalizeSequence(spec.sequence ?? spec.inputs ?? spec.keySequence ?? spec.key_sequence ?? spec.steps);

    if (!macroId && (!Number.isFinite(verb) || !Number.isFinite(noun))) {
      throw new Error('DSKY entry requires a macroId or both verb and noun');
    }

    const queueAction = {
      id,
      type: 'dsky_entry',
      get: getSeconds,
      source,
    };
    if (macroId) {
      queueAction.macro_id = macroId;
    }
    if (Number.isFinite(verb)) {
      queueAction.verb = verb;
    }
    if (Number.isFinite(noun)) {
      queueAction.noun = noun;
    }
    if (program) {
      queueAction.program = program;
    }
    if (Object.keys(registers).length > 0) {
      queueAction.registers = registers;
    }
    if (sequence.length > 0) {
      queueAction.sequence = sequence;
    }
    if (note) {
      queueAction.note = note;
    }

    const payload = {
      macroId,
      verb: Number.isFinite(verb) ? verb : null,
      noun: Number.isFinite(noun) ? noun : null,
      program: program ?? null,
      registers: Object.keys(registers).length > 0 ? clonePlain(registers) : null,
      sequence: sequence.length > 0 ? [...sequence] : null,
      note,
      eventId: normalizeString(spec.eventId ?? spec.event_id),
      autopilotId: normalizeString(spec.autopilotId ?? spec.autopilot_id),
    };

    this.#enqueueAction(manualQueue, queueAction, getSeconds, 'dsky_entry', actor, source, payload);

    if (this.recordIntents && this.recorder) {
      this.recorder.recordDskyEntry({
        id,
        getSeconds,
        eventId: payload.eventId ?? null,
        autopilotId: payload.autopilotId ?? null,
        macroId,
        verb: payload.verb,
        noun: payload.noun,
        program: program ?? null,
        registers: payload.registers ?? null,
        sequence: payload.sequence ?? null,
        actor,
        note,
      });
    }

    return this.history[this.history.length - 1] ?? null;
  }

  #requireQueue() {
    if (!this.manualActionQueue) {
      throw new Error('Manual action queue is not configured');
    }
    return this.manualActionQueue;
  }

  #normalizeType(value) {
    const normalized = normalizeString(value);
    return normalized ? normalized.toLowerCase() : null;
  }

  #nextActionId(prefix) {
    this.actionCounter += 1;
    return `ui_manual_${prefix}_${this.actionCounter}`;
  }

  #enqueueAction(queue, action, getSeconds, type, actor, source, payload) {
    let error = null;
    try {
      queue.addAction(action);
    } catch (err) {
      error = err;
      this.logger?.log(getSeconds, `Failed to queue manual action (${type})`, {
        logSource: this.logSource,
        logCategory: this.logCategory,
        logSeverity: 'error',
        actionType: type,
        actionId: action.id,
        reason: err?.message ?? String(err),
      });
    }

    if (error) {
      throw error;
    }

    const event = {
      id: action.id,
      type,
      actor,
      source,
      timestampSeconds: getSeconds,
      timestamp: formatGET(getSeconds),
      note: payload?.note ?? null,
      payload: payload ? clonePlain(payload) : {},
      queueAction: clonePlain(action),
    };

    this.#recordHistory(event);
    this.#emitEvent(event);
  }

  #recordHistory(event) {
    this.history.push(clonePlain(event));
    if (this.history.length > this.historyLimit) {
      const excess = this.history.length - this.historyLimit;
      if (excess > 0) {
        this.history.splice(0, excess);
      }
    }
  }

  #emitEvent(event) {
    this.logger?.log(event.timestampSeconds ?? 0, `Manual action queued (${event.type})`, {
      logSource: this.logSource,
      logCategory: this.logCategory,
      logSeverity: 'info',
      actionType: event.type,
      actionId: event.id,
      actor: event.actor,
      source: event.source,
      payload: event.payload,
    });

    for (const handler of this.anyHandlers) {
      handler(event);
    }

    const bucket = this.handlers.get(event.type);
    if (bucket) {
      for (const handler of bucket) {
        handler(event);
      }
    }

    if (this.eventBus) {
      this.eventBus.emit('ui:manual', event);
      this.eventBus.emit(`ui:manual:${event.type}`, event);
    }
  }
}
