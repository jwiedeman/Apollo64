const DEFAULT_OPTIONS = {
  epsilon: 1e-6,
  throttleEpsilon: 1e-3,
  ullageRcsKgPerSec: 0.65,
  csmSpsMassFlowKgPerSec: 29.5,
  lmDescentMassFlowKgPerSec: 14.7,
  lmAscentMassFlowKgPerSec: 5.1,
  defaultUllageTankKey: 'csm_rcs',
};

export class AutopilotRunner {
  constructor(resourceSystem, logger, options = {}) {
    this.resourceSystem = resourceSystem;
    this.logger = logger;
    this.options = { ...DEFAULT_OPTIONS, ...options };

    this.active = new Map();
    this.metrics = {
      started: 0,
      completed: 0,
      aborted: 0,
      totalBurnSeconds: 0,
      totalUllageSeconds: 0,
      propellantKgByTank: Object.create(null),
    };
    this.lastUpdateGetSeconds = 0;
  }

  start(event, startGetSeconds) {
    if (!event?.autopilot) {
      return;
    }

    if (this.active.has(event.id)) {
      return;
    }

    const script = event.autopilot.script;
    if (!script || !Array.isArray(script.sequence)) {
      this.logger?.log(startGetSeconds, `Autopilot ${event.autopilotId} has no script payload`, {
        eventId: event.id,
      });
      return;
    }

    const sequence = [...script.sequence].sort((a, b) => {
      const at = Number(a.time ?? 0);
      const bt = Number(b.time ?? 0);
      return at - bt;
    });

    const durationSeconds = this.#resolveDuration(event);
    const propulsion = this.#resolvePropulsionProfile(event);

    const state = {
      eventId: event.id,
      autopilotId: event.autopilotId,
      title: script.title ?? event.autopilot?.description ?? event.autopilotId,
      startGetSeconds,
      durationSeconds,
      sequence,
      nextCommandIndex: 0,
      currentThrottle: 0,
      propulsion,
      ullageWindow: null,
      lastUpdateGetSeconds: startGetSeconds,
      metrics: {
        commands: 0,
        throttleChanges: 0,
        attitudeChanges: 0,
        ullageCommands: 0,
        burnSeconds: 0,
        ullageSeconds: 0,
        propellantKg: 0,
        rcsKg: 0,
      },
    };

    this.active.set(event.id, state);
    this.metrics.started += 1;

    this.logger?.log(startGetSeconds, `Autopilot ${state.autopilotId} engaged for event ${event.id}`, {
      eventId: event.id,
      autopilotId: state.autopilotId,
      durationSeconds,
      propulsion: state.propulsion.type,
    });

    // Process any commands scheduled exactly at time 0.
    this.#processCommands(state, startGetSeconds);
  }

  update(currentGetSeconds, _dtSeconds = 0) {
    if (this.active.size === 0) {
      this.lastUpdateGetSeconds = currentGetSeconds;
      return;
    }

    const states = Array.from(this.active.values());
    for (const state of states) {
      this.#processCommands(state, currentGetSeconds);
      this.#applyContinuousEffects(state, currentGetSeconds);
      this.#maybeComplete(state, currentGetSeconds);
    }

    this.lastUpdateGetSeconds = currentGetSeconds;
  }

  finish(eventId, getSeconds) {
    const state = this.active.get(eventId);
    if (!state) {
      return;
    }
    this.#processCommands(state, getSeconds);
    this.#applyContinuousEffects(state, getSeconds);
    this.#complete(state, getSeconds, { reason: 'event_complete' });
  }

  abort(eventId, getSeconds, reason = 'event_failed') {
    const state = this.active.get(eventId);
    if (!state) {
      return;
    }

    this.#applyContinuousEffects(state, getSeconds);
    this.active.delete(eventId);
    this.metrics.aborted += 1;

    this.logger?.log(getSeconds, `Autopilot ${state.autopilotId} aborted for event ${eventId}`, {
      reason,
      burnSeconds: state.metrics.burnSeconds,
      propellantKg: state.metrics.propellantKg,
      rcsKg: state.metrics.rcsKg,
    });
  }

  stats() {
    const now = this.lastUpdateGetSeconds;
    const activeAutopilots = [];

    for (const state of this.active.values()) {
      const elapsed = Math.max(0, now - state.startGetSeconds);
      const remaining = Math.max(0, (state.durationSeconds ?? 0) - elapsed);
      const nextCommandElapsed = this.#nextCommandElapsed(state);
      activeAutopilots.push({
        eventId: state.eventId,
        autopilotId: state.autopilotId,
        propulsion: state.propulsion.type,
        elapsedSeconds: elapsed,
        remainingSeconds: remaining,
        currentThrottle: state.currentThrottle,
        nextCommandInSeconds: nextCommandElapsed != null ? Math.max(0, nextCommandElapsed - elapsed) : null,
      });
    }

    return {
      active: this.active.size,
      started: this.metrics.started,
      completed: this.metrics.completed,
      aborted: this.metrics.aborted,
      totalBurnSeconds: this.metrics.totalBurnSeconds,
      totalUllageSeconds: this.metrics.totalUllageSeconds,
      propellantKgByTank: { ...this.metrics.propellantKgByTank },
      activeAutopilots,
    };
  }

  #processCommands(state, currentGetSeconds) {
    const epsilon = this.options.epsilon ?? DEFAULT_OPTIONS.epsilon;
    const elapsed = currentGetSeconds - state.startGetSeconds;

    while (state.nextCommandIndex < state.sequence.length) {
      const command = state.sequence[state.nextCommandIndex];
      const commandTime = Number(command.time ?? 0);
      if (!Number.isFinite(commandTime) || commandTime > elapsed + epsilon) {
        break;
      }

      state.nextCommandIndex += 1;
      state.metrics.commands += 1;
      this.#executeCommand(state, command, commandTime);
    }
  }

  #executeCommand(state, command, commandTimeSeconds) {
    const commandName = String(command.command ?? command.cmd ?? '').trim().toLowerCase();
    const commandGetSeconds = state.startGetSeconds + (Number.isFinite(commandTimeSeconds) ? commandTimeSeconds : 0);

    switch (commandName) {
      case 'attitude_hold': {
        state.metrics.attitudeChanges += 1;
        this.logger?.log(commandGetSeconds, `Autopilot ${state.autopilotId} attitude hold`, {
          eventId: state.eventId,
          target: command.target ?? null,
        });
        break;
      }
      case 'ullage_fire': {
        state.metrics.ullageCommands += 1;
        const duration = Math.max(0, Number(command.duration ?? 0));
        const start = commandGetSeconds;
        const end = start + duration;
        state.ullageWindow = { start, end };
        this.logger?.log(commandGetSeconds, `Autopilot ${state.autopilotId} ullage fire`, {
          eventId: state.eventId,
          durationSeconds: duration,
        });
        break;
      }
      case 'throttle': {
        state.metrics.throttleChanges += 1;
        const level = clamp(Number(command.level ?? command.value ?? 0), 0, 1);
        state.currentThrottle = level;
        this.logger?.log(commandGetSeconds, `Autopilot ${state.autopilotId} throttle set`, {
          eventId: state.eventId,
          level,
          propulsion: state.propulsion.type,
        });
        break;
      }
      default: {
        this.logger?.log(commandGetSeconds, `Autopilot ${state.autopilotId} unknown command ${commandName}`, {
          eventId: state.eventId,
        });
        break;
      }
    }
  }

  #applyContinuousEffects(state, currentGetSeconds) {
    const deltaSeconds = currentGetSeconds - state.lastUpdateGetSeconds;
    if (deltaSeconds <= 0) {
      return;
    }

    const throttleUsage = this.#consumeThrottle(state, deltaSeconds, currentGetSeconds);
    if (throttleUsage > 0) {
      state.metrics.propellantKg += throttleUsage;
      this.metrics.totalBurnSeconds += deltaSeconds;
      this.#accumulatePropellant(state.propulsion.tankKey, throttleUsage);
    }

    const ullageDuration = this.#computeUllageOverlap(state, currentGetSeconds);
    if (ullageDuration > 0) {
      const ullageProfile = state.propulsion?.ullage ?? null;
      const ullageTankKey = ullageProfile?.tankKey ?? null;
      const ullageRate = ullageProfile?.massFlowKgPerSec ?? 0;
      if (ullageTankKey && ullageRate > 0) {
        const ullageUsageKg = ullageDuration * ullageRate;
        if (ullageUsageKg > 0) {
          state.metrics.rcsKg += ullageUsageKg;
          state.metrics.ullageSeconds += ullageDuration;
          this.metrics.totalUllageSeconds += ullageDuration;
          this.#accumulatePropellant(ullageTankKey, ullageUsageKg);
          this.resourceSystem?.recordPropellantUsage(ullageTankKey, ullageUsageKg, {
            getSeconds: currentGetSeconds,
            source: state.autopilotId,
            note: 'autopilot_ullage',
          });
        }
      }
    }

    state.lastUpdateGetSeconds = currentGetSeconds;
  }

  #consumeThrottle(state, deltaSeconds, currentGetSeconds) {
    const throttle = state.currentThrottle;
    const epsilon = this.options.throttleEpsilon ?? DEFAULT_OPTIONS.throttleEpsilon;
    if (throttle <= epsilon) {
      return 0;
    }

    const { tankKey, massFlowKgPerSec } = state.propulsion;
    if (!tankKey || !(massFlowKgPerSec > 0)) {
      return 0;
    }

    const usageKg = throttle * massFlowKgPerSec * deltaSeconds;
    if (usageKg <= 0) {
      return 0;
    }

    this.resourceSystem?.recordPropellantUsage(tankKey, usageKg, {
      getSeconds: currentGetSeconds,
      source: state.autopilotId,
      note: 'autopilot_throttle',
    });
    state.metrics.burnSeconds += deltaSeconds;
    return usageKg;
  }

  #computeUllageOverlap(state, currentGetSeconds) {
    const window = state.ullageWindow;
    if (!window) {
      return 0;
    }

    const start = Math.max(state.lastUpdateGetSeconds, window.start);
    const end = Math.min(currentGetSeconds, window.end);
    const duration = Math.max(0, end - start);

    const epsilon = this.options.epsilon ?? DEFAULT_OPTIONS.epsilon;
    if (currentGetSeconds + epsilon >= window.end) {
      state.ullageWindow = null;
    }

    return duration;
  }

  #maybeComplete(state, currentGetSeconds) {
    const epsilon = this.options.epsilon ?? DEFAULT_OPTIONS.epsilon;
    const elapsed = currentGetSeconds - state.startGetSeconds;
    if (elapsed + epsilon < state.durationSeconds) {
      return;
    }

    const throttle = state.currentThrottle;
    const throttleEpsilon = this.options.throttleEpsilon ?? DEFAULT_OPTIONS.throttleEpsilon;
    if (throttle > throttleEpsilon) {
      state.currentThrottle = 0;
    }

    if (state.ullageWindow) {
      return;
    }

    if (state.nextCommandIndex < state.sequence.length) {
      return;
    }

    this.#complete(state, currentGetSeconds, { reason: 'duration_complete' });
  }

  #complete(state, getSeconds, { reason }) {
    if (!this.active.has(state.eventId)) {
      return;
    }

    this.active.delete(state.eventId);
    this.metrics.completed += 1;

    this.logger?.log(getSeconds, `Autopilot ${state.autopilotId} complete for event ${state.eventId}`, {
      reason,
      burnSeconds: state.metrics.burnSeconds,
      ullageSeconds: state.metrics.ullageSeconds,
      propellantKg: state.metrics.propellantKg,
      rcsKg: state.metrics.rcsKg,
    });
  }

  #resolveDuration(event) {
    if (Number.isFinite(event.expectedDurationSeconds)) {
      return event.expectedDurationSeconds;
    }
    if (Number.isFinite(event.autopilot?.durationSeconds)) {
      return event.autopilot.durationSeconds;
    }
    const script = event.autopilot?.script;
    if (script && Array.isArray(script.sequence)) {
      let max = 0;
      for (const entry of script.sequence) {
        const time = Number(entry.time ?? 0);
        const duration = Number(entry.duration ?? 0);
        const end = (Number.isFinite(time) ? time : 0) + (Number.isFinite(duration) ? duration : 0);
        if (end > max) {
          max = end;
        }
      }
      return max;
    }
    return 0;
  }

  #resolvePropulsionProfile(event) {
    const autopilotId = event?.autopilotId ?? event?.autopilot?.id ?? null;
    const normalized = this.#normalizePropulsionConfig(event?.autopilot?.propulsion ?? null, autopilotId);
    if (normalized) {
      return normalized;
    }
    return this.#resolvePropulsionFromId(autopilotId);
  }

  #normalizePropulsionConfig(config, autopilotId) {
    if (!config || typeof config !== 'object') {
      return null;
    }

    const type = typeof config.type === 'string' && config.type.trim().length > 0
      ? config.type.trim()
      : autopilotId ?? 'unknown';

    const tankKey = this.#normalizeTankKey(
      config.tank ?? config.tank_key ?? config.propellant ?? null,
    );

    let massFlowKgPerSec = this.#coerceNumber(
      config.mass_flow_kg_per_s ?? config.massFlowKgPerSec ?? null,
    );
    if (!Number.isFinite(massFlowKgPerSec)) {
      const massFlowLbPerSec = this.#coerceNumber(
        config.mass_flow_lb_per_s ?? config.massFlowLbPerSec ?? null,
      );
      if (Number.isFinite(massFlowLbPerSec)) {
        massFlowKgPerSec = massFlowLbPerSec * 0.45359237;
      }
    }
    if (!Number.isFinite(massFlowKgPerSec)) {
      massFlowKgPerSec = 0;
    } else if (massFlowKgPerSec < 0) {
      massFlowKgPerSec = Math.abs(massFlowKgPerSec);
    }

    let ullage = null;
    if (config.ullage && typeof config.ullage === 'object') {
      const ullageTankKey = this.#normalizeTankKey(
        config.ullage.tank ?? config.ullage.tank_key ?? config.ullage.propellant ?? null,
      );
      let ullageRate = this.#coerceNumber(
        config.ullage.mass_flow_kg_per_s ?? config.ullage.massFlowKgPerSec ?? null,
      );
      if (!Number.isFinite(ullageRate)) {
        const ullageRateLb = this.#coerceNumber(
          config.ullage.mass_flow_lb_per_s ?? config.ullage.massFlowLbPerSec ?? null,
        );
        if (Number.isFinite(ullageRateLb)) {
          ullageRate = ullageRateLb * 0.45359237;
        }
      }
      if (ullageTankKey && Number.isFinite(ullageRate) && ullageRate > 0) {
        ullage = { tankKey: ullageTankKey, massFlowKgPerSec: ullageRate };
      }
    }

    if (!tankKey && massFlowKgPerSec <= 0 && !ullage && (!type || type === 'unknown')) {
      return null;
    }

    return {
      type: type || 'unknown',
      tankKey,
      massFlowKgPerSec,
      ullage,
    };
  }

  #resolvePropulsionFromId(autopilotId) {
    const id = (autopilotId ?? '').toUpperCase();
    if (!id) {
      return { type: 'unknown', tankKey: null, massFlowKgPerSec: 0, ullage: null };
    }

    if (id === 'PGM_06_TLI') {
      return { type: 'sivb', tankKey: null, massFlowKgPerSec: 0, ullage: null };
    }

    if (id.startsWith('PGM_LM_ASCENT')) {
      return {
        type: 'lm_ascent',
        tankKey: 'lm_ascent',
        massFlowKgPerSec: this.options.lmAscentMassFlowKgPerSec ?? DEFAULT_OPTIONS.lmAscentMassFlowKgPerSec,
        ullage: null,
      };
    }

    if (id.startsWith('PGM_LM')) {
      return {
        type: 'lm_descent',
        tankKey: 'lm_descent',
        massFlowKgPerSec: this.options.lmDescentMassFlowKgPerSec ?? DEFAULT_OPTIONS.lmDescentMassFlowKgPerSec,
        ullage: null,
      };
    }

    const massFlowKgPerSec = this.options.csmSpsMassFlowKgPerSec ?? DEFAULT_OPTIONS.csmSpsMassFlowKgPerSec;
    const ullageRate = this.options.ullageRcsKgPerSec ?? DEFAULT_OPTIONS.ullageRcsKgPerSec;
    const ullageTankKey = this.options.defaultUllageTankKey ?? DEFAULT_OPTIONS.defaultUllageTankKey;

    return {
      type: 'csm_sps',
      tankKey: 'csm_sps',
      massFlowKgPerSec,
      ullage: ullageRate > 0 && ullageTankKey
        ? { tankKey: ullageTankKey, massFlowKgPerSec: ullageRate }
        : null,
    };
  }

  #accumulatePropellant(tankKey, deltaKg) {
    if (!tankKey || !(deltaKg > 0)) {
      return;
    }
    const normalized = this.#normalizeTankKey(tankKey);
    this.metrics.propellantKgByTank[normalized] = (this.metrics.propellantKgByTank[normalized] ?? 0) + deltaKg;
  }

  #normalizeTankKey(value) {
    if (!value) {
      return null;
    }
    return value.endsWith('_kg') ? value : `${value}_kg`;
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

  #nextCommandElapsed(state) {
    if (state.nextCommandIndex >= state.sequence.length) {
      return null;
    }
    const next = state.sequence[state.nextCommandIndex];
    const time = Number(next.time ?? 0);
    return Number.isFinite(time) ? time : null;
  }
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}
