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
    const { rcsController = null, manualActionRecorder = null, ...restOptions } = options ?? {};
    this.resourceSystem = resourceSystem;
    this.logger = logger;
    this.options = { ...DEFAULT_OPTIONS, ...restOptions };
    this.rcsController = rcsController ?? null;
    this.manualActionRecorder = manualActionRecorder ?? null;

    this.active = new Map();
    this.metrics = {
      started: 0,
      completed: 0,
      aborted: 0,
      totalBurnSeconds: 0,
      totalUllageSeconds: 0,
      propellantKgByTank: Object.create(null),
      totalRcsImpulseNs: 0,
      totalRcsPulses: 0,
      dskyEntries: 0,
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
      throttleRamp: null,
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
        rcsPulses: 0,
        rcsImpulseNs: 0,
        dskyEntries: 0,
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
    state.throttleRamp = null;
    this.active.delete(eventId);
    this.metrics.aborted += 1;

    this.logger?.log(getSeconds, `Autopilot ${state.autopilotId} aborted for event ${eventId}`, {
      reason,
      burnSeconds: state.metrics.burnSeconds,
      propellantKg: state.metrics.propellantKg,
      rcsKg: state.metrics.rcsKg,
      rcsPulses: state.metrics.rcsPulses,
      rcsImpulseNs: state.metrics.rcsImpulseNs,
      dskyEntries: state.metrics.dskyEntries,
    });
  }

  stats() {
    const now = this.lastUpdateGetSeconds;
    const activeAutopilots = [];

    for (const state of this.active.values()) {
      const elapsed = Math.max(0, now - state.startGetSeconds);
      const remaining = Math.max(0, (state.durationSeconds ?? 0) - elapsed);
      const nextCommandElapsed = this.#nextCommandElapsed(state);
      const ramp = state.throttleRamp;
      activeAutopilots.push({
        eventId: state.eventId,
        autopilotId: state.autopilotId,
        propulsion: state.propulsion.type,
        elapsedSeconds: elapsed,
        remainingSeconds: remaining,
        currentThrottle: state.currentThrottle,
        nextCommandInSeconds: nextCommandElapsed != null ? Math.max(0, nextCommandElapsed - elapsed) : null,
        throttleTarget: ramp ? ramp.endLevel : state.currentThrottle,
        throttleRamp: ramp
          ? {
              targetLevel: ramp.endLevel,
              secondsRemaining: Math.max(0, ramp.endGetSeconds - now),
            }
          : null,
        rcsPulses: state.metrics.rcsPulses,
        rcsImpulseNs: state.metrics.rcsImpulseNs,
        rcsKg: state.metrics.rcsKg,
        dskyEntries: state.metrics.dskyEntries,
      });
    }

    let primary = null;
    if (activeAutopilots.length > 0) {
      const sorted = [...activeAutopilots].sort((a, b) => {
        const aRemaining = Number.isFinite(a.remainingSeconds) ? a.remainingSeconds : Infinity;
        const bRemaining = Number.isFinite(b.remainingSeconds) ? b.remainingSeconds : Infinity;
        return aRemaining - bRemaining;
      });
      primary = sorted[0];
    }

    return {
      active: this.active.size,
      started: this.metrics.started,
      completed: this.metrics.completed,
      aborted: this.metrics.aborted,
      totalBurnSeconds: this.metrics.totalBurnSeconds,
      totalUllageSeconds: this.metrics.totalUllageSeconds,
      totalRcsImpulseNs: this.metrics.totalRcsImpulseNs,
      totalRcsPulses: this.metrics.totalRcsPulses,
      totalDskyEntries: this.metrics.dskyEntries,
      propellantKgByTank: { ...this.metrics.propellantKgByTank },
      activeAutopilots,
      primary,
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
        state.throttleRamp = null;
        this.logger?.log(commandGetSeconds, `Autopilot ${state.autopilotId} throttle set`, {
          eventId: state.eventId,
          level,
          propulsion: state.propulsion.type,
        });
        break;
      }
      case 'throttle_ramp': {
        state.metrics.throttleChanges += 1;
        const epsilon = this.options.epsilon ?? DEFAULT_OPTIONS.epsilon;
        const fromLevel = clamp(
          Number(
            command.from ??
              command.from_level ??
              command.start_level ??
              command.start ??
              state.currentThrottle,
          ),
          0,
          1,
        );
        const toLevel = clamp(
          Number(
            command.to ??
              command.to_level ??
              command.level ??
              command.target ??
              state.currentThrottle,
          ),
          0,
          1,
        );
        const duration = Math.max(0, Number(command.duration ?? command.ramp_duration ?? 0));

        if (duration <= epsilon) {
          state.currentThrottle = toLevel;
          state.throttleRamp = null;
          this.logger?.log(commandGetSeconds, `Autopilot ${state.autopilotId} throttle instant set`, {
            eventId: state.eventId,
            fromLevel,
            level: toLevel,
            propulsion: state.propulsion.type,
          });
        } else {
          state.throttleRamp = {
            startLevel: fromLevel,
            endLevel: toLevel,
            startGetSeconds: commandGetSeconds,
            endGetSeconds: commandGetSeconds + duration,
            duration,
          };
          state.currentThrottle = fromLevel;
          this.logger?.log(commandGetSeconds, `Autopilot ${state.autopilotId} throttle ramp`, {
            eventId: state.eventId,
            fromLevel,
            toLevel,
            durationSeconds: duration,
            propulsion: state.propulsion.type,
          });
        }
        break;
      }
      case 'rcs_pulse': {
        if (!this.rcsController) {
          this.logger?.log(commandGetSeconds, `Autopilot ${state.autopilotId} RCS pulse skipped`, {
            eventId: state.eventId,
            reason: 'no_rcs_controller',
          });
          break;
        }

        const craftId = this.#normalizeString(
          command.craft ?? command.craft_id ?? command.vehicle ?? null,
        );
        const tankKey = this.#normalizeString(
          command.tank ?? command.tank_key ?? command.propellant_tank ?? null,
        );
        const axis = command.axis ?? command.translation_axis ?? null;
        const torqueAxis = command.torque_axis ?? command.attitude_axis ?? null;
        const durationSeconds = this.#coerceNumber(
          command.duration
            ?? command.seconds
            ?? command.impulse
            ?? command.pulse_seconds
            ?? null,
        );
        const count = this.#coerceNumber(command.count ?? command.pulses ?? command.repeat ?? 1);
        const dutyCycle = this.#coerceNumber(command.duty_cycle ?? command.duty ?? command.duty_factor ?? null);
        const maxThrusters = this.#coerceNumber(
          command.max_thrusters
            ?? command.thrusters_per_axis
            ?? command.thruster_count
            ?? null,
        );
        const thrusterIds = this.#normalizeIdList(command.thrusters ?? command.thruster_ids);

        const result = this.rcsController.executePulse({
          autopilotId: state.autopilotId,
          eventId: state.eventId,
          getSeconds: commandGetSeconds,
          craftId,
          thrusterIds,
          axis,
          torqueAxis,
          durationSeconds,
          count,
          dutyCycle,
          tankKey,
          note: command.note ?? command.label ?? null,
          maxThrusters,
        });

        if (result?.massKg > 0) {
          state.metrics.rcsKg += result.massKg;
          state.metrics.rcsPulses += result.pulses ?? 0;
          state.metrics.rcsImpulseNs += result.impulseNs ?? 0;
          this.metrics.totalRcsPulses += result.pulses ?? 0;
          this.metrics.totalRcsImpulseNs += result.impulseNs ?? 0;
          this.#accumulatePropellant(result.tankKey, result.massKg);
        }
        break;
      }
      case 'dsky_entry':
      case 'dsky_macro': {
        const entry = this.#normalizeDskyCommand(command);
        if (!entry) {
          this.logger?.log(commandGetSeconds, `Autopilot ${state.autopilotId} DSKY entry skipped`, {
            eventId: state.eventId,
            reason: 'invalid_payload',
          });
          break;
        }

        this.#recordDskyEntry(state, entry, commandGetSeconds);
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

  #recordDskyEntry(state, entry, getSeconds) {
    const registers = entry.registers && Object.keys(entry.registers).length > 0
      ? { ...entry.registers }
      : undefined;
    const sequence = entry.sequence && entry.sequence.length > 0 ? [...entry.sequence] : undefined;

    const payload = {
      eventId: state.eventId,
      autopilotId: state.autopilotId,
      macroId: entry.macroId ?? undefined,
      verb: entry.verb ?? undefined,
      noun: entry.noun ?? undefined,
      verbLabel: this.#formatVerbNoun(entry.verb),
      nounLabel: this.#formatVerbNoun(entry.noun),
      program: entry.program ?? undefined,
      registers,
      sequence,
      note: entry.note ?? undefined,
    };

    this.logger?.log(getSeconds, `Autopilot ${state.autopilotId} DSKY entry executed`, payload);
    state.metrics.dskyEntries += 1;
    this.metrics.dskyEntries += 1;

    if (this.manualActionRecorder) {
      this.manualActionRecorder.recordDskyEntry({
        getSeconds,
        eventId: state.eventId,
        autopilotId: state.autopilotId,
        macroId: entry.macroId ?? null,
        verb: entry.verb ?? null,
        noun: entry.noun ?? null,
        program: entry.program ?? null,
        registers,
        sequence,
        note: entry.note ?? null,
        actor: 'AUTO_CREW',
      });
    }
  }

  #normalizeDskyCommand(command) {
    if (!command || typeof command !== 'object') {
      return null;
    }

    const macroId = this.#normalizeString(
      command.macro ?? command.macro_id ?? command.macroId ?? null,
    );
    const verb = this.#coerceVerbOrNoun(command.verb ?? command.verb_id ?? null);
    const noun = this.#coerceVerbOrNoun(command.noun ?? command.noun_id ?? null);
    const program = this.#normalizeString(
      command.program ?? command.agc_program ?? command.agcProgram ?? null,
    );
    const registers = this.#normalizeRegisters(
      command.registers
        ?? command.values
        ?? command.register_values
        ?? command.registerValues
        ?? null,
    );
    const sequence = this.#normalizeSequence(
      command.sequence
        ?? command.inputs
        ?? command.key_sequence
        ?? command.keySequence
        ?? command.steps
        ?? null,
    );
    const note = this.#normalizeString(command.note ?? command.label ?? null);

    if (!macroId && verb == null && noun == null) {
      return null;
    }

    return {
      macroId: macroId ?? null,
      verb,
      noun,
      program: program ?? null,
      registers,
      sequence,
      note: note ?? null,
    };
  }

  #applyContinuousEffects(state, currentGetSeconds) {
    const startSeconds = state.lastUpdateGetSeconds;
    const deltaSeconds = currentGetSeconds - startSeconds;
    if (deltaSeconds <= 0) {
      return;
    }

    const throttleUsage = this.#consumeThrottle(state, startSeconds, currentGetSeconds);
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

  #consumeThrottle(state, startSeconds, endSeconds) {
    const deltaSeconds = endSeconds - startSeconds;
    if (!(deltaSeconds > 0)) {
      return 0;
    }

    const { tankKey, massFlowKgPerSec } = state.propulsion;
    if (!tankKey || !(massFlowKgPerSec > 0)) {
      return 0;
    }

    const epsilon = this.options.throttleEpsilon ?? DEFAULT_OPTIONS.throttleEpsilon;
    const { averageThrottle, endThrottle } = this.#resolveThrottleForInterval(state, startSeconds, endSeconds);
    if (averageThrottle <= epsilon) {
      state.currentThrottle = endThrottle;
      return 0;
    }

    const usageKg = averageThrottle * massFlowKgPerSec * deltaSeconds;
    if (usageKg <= 0) {
      state.currentThrottle = endThrottle;
      return 0;
    }

    this.resourceSystem?.recordPropellantUsage(tankKey, usageKg, {
      getSeconds: endSeconds,
      source: state.autopilotId,
      note: 'autopilot_throttle',
    });
    state.metrics.burnSeconds += deltaSeconds;
    state.currentThrottle = endThrottle;
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

    if (state.throttleRamp) {
      const rampEnd = state.throttleRamp.endGetSeconds ?? currentGetSeconds;
      if (currentGetSeconds + epsilon < rampEnd) {
        return;
      }
      state.currentThrottle = state.throttleRamp.endLevel;
      state.throttleRamp = null;
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

    state.throttleRamp = null;
    this.logger?.log(getSeconds, `Autopilot ${state.autopilotId} complete for event ${state.eventId}`, {
      reason,
      burnSeconds: state.metrics.burnSeconds,
      ullageSeconds: state.metrics.ullageSeconds,
      propellantKg: state.metrics.propellantKg,
      rcsKg: state.metrics.rcsKg,
      rcsPulses: state.metrics.rcsPulses,
      rcsImpulseNs: state.metrics.rcsImpulseNs,
      dskyEntries: state.metrics.dskyEntries,
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

  #resolveThrottleForInterval(state, startSeconds, endSeconds) {
    const ramp = state.throttleRamp;
    if (!ramp) {
      return { averageThrottle: state.currentThrottle, endThrottle: state.currentThrottle };
    }

    const startValue = this.#interpolateThrottle(ramp, startSeconds);
    const endValue = this.#interpolateThrottle(ramp, endSeconds);
    const averageThrottle = (startValue + endValue) * 0.5;

    const epsilon = this.options.epsilon ?? DEFAULT_OPTIONS.epsilon;
    if (endSeconds + epsilon >= ramp.endGetSeconds) {
      state.throttleRamp = null;
    }

    return { averageThrottle, endThrottle: endValue };
  }

  #interpolateThrottle(ramp, timeSeconds) {
    if (!ramp) {
      return 0;
    }
    if (timeSeconds <= ramp.startGetSeconds) {
      return ramp.startLevel;
    }
    if (timeSeconds >= ramp.endGetSeconds) {
      return ramp.endLevel;
    }

    const range = ramp.duration > 0 ? ramp.duration : ramp.endGetSeconds - ramp.startGetSeconds;
    if (!Number.isFinite(range) || range <= 0) {
      return ramp.endLevel;
    }

    const t = (timeSeconds - ramp.startGetSeconds) / range;
    return ramp.startLevel + (ramp.endLevel - ramp.startLevel) * clamp(t, 0, 1);
  }

  #normalizeString(value) {
    if (value == null) {
      return null;
    }
    const text = String(value).trim();
    return text.length > 0 ? text : null;
  }

  #normalizeRegisters(raw) {
    if (!raw || typeof raw !== 'object') {
      return {};
    }

    const registers = {};
    if (Array.isArray(raw)) {
      raw.forEach((value, index) => {
        const key = `R${index + 1}`;
        const normalizedValue = this.#normalizeRegisterValue(value);
        if (normalizedValue != null) {
          registers[key] = normalizedValue;
        }
      });
      return registers;
    }

    for (const [key, value] of Object.entries(raw)) {
      const normalizedKey = this.#normalizeString(key)?.toUpperCase();
      if (!normalizedKey) {
        continue;
      }
      const normalizedValue = this.#normalizeRegisterValue(value);
      if (normalizedValue != null) {
        registers[normalizedKey] = normalizedValue;
      }
    }
    return registers;
  }

  #normalizeRegisterValue(value) {
    if (value == null) {
      return null;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value.toString();
    }
    return null;
  }

  #normalizeSequence(raw) {
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
      if (trimmed.length === 0) {
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

  #coerceVerbOrNoun(value) {
    if (value == null) {
      return null;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Number.parseInt(value, 10);
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        return null;
      }
      const parsed = Number.parseInt(trimmed, 10);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  #formatVerbNoun(value) {
    if (!Number.isFinite(value)) {
      return null;
    }
    const integer = Number.parseInt(value, 10);
    if (!Number.isFinite(integer)) {
      return null;
    }
    return integer.toString().padStart(2, '0');
  }

  #normalizeIdList(value) {
    if (!value) {
      return [];
    }
    if (Array.isArray(value)) {
      return value.map((entry) => this.#normalizeString(entry)).filter(Boolean);
    }
    if (typeof value === 'string') {
      return value
        .split(',')
        .map((entry) => this.#normalizeString(entry))
        .filter(Boolean);
    }
    return [];
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
