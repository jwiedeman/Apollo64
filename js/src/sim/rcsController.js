const DEFAULT_OPTIONS = {
  defaultImpulseSeconds: 0.08,
  defaultThrustNewtons: 445,
  defaultIspSeconds: 287,
  defaultTankKey: 'csm_rcs',
};

const G0 = 9.80665; // m/s^2

export class RcsController {
  constructor(thrusterData, resourceSystem, logger, options = {}) {
    const { defaultImpulseSeconds, defaultThrustNewtons, defaultIspSeconds, defaultTankKey, ...rest } = options ?? {};

    this.options = {
      ...DEFAULT_OPTIONS,
      ...rest,
      defaultImpulseSeconds: Number.isFinite(defaultImpulseSeconds)
        ? Math.max(0, defaultImpulseSeconds)
        : DEFAULT_OPTIONS.defaultImpulseSeconds,
      defaultThrustNewtons: Number.isFinite(defaultThrustNewtons)
        ? Math.max(0, defaultThrustNewtons)
        : DEFAULT_OPTIONS.defaultThrustNewtons,
      defaultIspSeconds: Number.isFinite(defaultIspSeconds)
        ? Math.max(0, defaultIspSeconds)
        : DEFAULT_OPTIONS.defaultIspSeconds,
      defaultTankKey: typeof defaultTankKey === 'string' && defaultTankKey.trim().length > 0
        ? defaultTankKey.trim()
        : DEFAULT_OPTIONS.defaultTankKey,
    };

    this.resourceSystem = resourceSystem;
    this.logger = logger;

    this.craft = new Map();
    this.thrusters = new Map();
    this.thrustersByCraft = new Map();
    this.thrustersByTranslationAxis = new Map();
    this.thrustersByTorqueAxis = new Map();

    this.metrics = {
      totalPulses: 0,
      totalImpulseNs: 0,
      totalMassKg: 0,
      usageByTank: Object.create(null),
      usageByCraft: Object.create(null),
      pulsesByAxis: Object.create(null),
    };

    this.#ingestThrusterData(thrusterData);
  }

  executePulse({
    autopilotId = null,
    eventId = null,
    getSeconds = 0,
    craftId = null,
    thrusterIds = null,
    axis = null,
    torqueAxis = null,
    durationSeconds = null,
    count = 1,
    dutyCycle = 1,
    tankKey = null,
    note = null,
    maxThrusters = null,
  } = {}) {
    const normalizedAxis = this.#normalizeAxis(axis);
    const normalizedTorque = this.#normalizeTorqueAxis(torqueAxis);
    const normalizedCraft = this.#normalizeId(craftId);
    const normalizedTank = this.#normalizeTankKey(tankKey ?? this.#resolveTankKey(normalizedCraft));
    const normalizedThrusterIds = this.#normalizeIdList(thrusterIds);
    const thrusters = this.#selectThrusters({
      craftId: normalizedCraft,
      thrusterIds: normalizedThrusterIds,
      axis: normalizedAxis,
      torqueAxis: normalizedTorque,
      maxThrusters,
    });

    if (thrusters.length === 0) {
      this.logger?.log(getSeconds, 'RCS pulse skipped — no thrusters resolved', {
        logSource: 'sim',
        logCategory: 'autopilot',
        logSeverity: 'warning',
        autopilotId,
        eventId,
        craftId: normalizedCraft,
        axis: normalizedAxis,
        torqueAxis: normalizedTorque,
        thrusterIds: normalizedThrusterIds,
      });
      return {
        tankKey: normalizedTank,
        massKg: 0,
        impulseNs: 0,
        pulses: 0,
        thrusters: [],
        craftId: normalizedCraft,
      };
    }

    const pulses = Math.max(1, Math.round(this.#coerceNumber(count) ?? 1));
    const duty = this.#clamp(this.#coerceNumber(dutyCycle), 0, 1, 1);
    const baseDuration = this.#coerceNumber(durationSeconds);

    let totalMassKg = 0;
    let totalImpulseNs = 0;
    const usedThrusters = [];
    const craftForUsage = normalizedCraft || thrusters[0]?.craftId || null;
    const resolvedTankKey = this.#normalizeTankKey(normalizedTank ?? this.#resolveTankKey(craftForUsage));

    for (const thruster of thrusters) {
      const craft = this.craft.get(thruster.craftId) ?? null;
      const thrust = this.#coerceNumber(
        thruster.thrustNewtons ?? craft?.defaults?.thrustNewtons ?? this.options.defaultThrustNewtons,
      );
      const ispSeconds = this.#coerceNumber(
        thruster.ispSeconds ?? craft?.defaults?.ispSeconds ?? this.options.defaultIspSeconds,
      );
      const minImpulse = this.#coerceNumber(
        thruster.minImpulseSeconds
          ?? craft?.defaults?.minImpulseSeconds
          ?? this.options.defaultImpulseSeconds,
      );

      if (!(Number.isFinite(thrust) && thrust > 0 && Number.isFinite(ispSeconds) && ispSeconds > 0)) {
        continue;
      }

      const minimumDuration = Number.isFinite(minImpulse) && minImpulse > 0 ? minImpulse : 0;
      const resolvedDuration = Number.isFinite(baseDuration) && baseDuration > 0 ? baseDuration : minimumDuration;
      const effectiveDuration = Math.max(minimumDuration, resolvedDuration) * duty;
      if (!(effectiveDuration > 0)) {
        continue;
      }

      const massFlowKgPerSec = thrust / (ispSeconds * G0);
      if (!(massFlowKgPerSec > 0)) {
        continue;
      }

      const massPerPulse = massFlowKgPerSec * effectiveDuration;
      const impulsePerPulse = thrust * effectiveDuration;
      const pulseCount = pulses;

      totalMassKg += massPerPulse * pulseCount;
      totalImpulseNs += impulsePerPulse * pulseCount;
      usedThrusters.push(thruster.id);
    }

    const thrusterPulseCount = pulses * usedThrusters.length;

    if (!(totalMassKg > 0) || usedThrusters.length === 0) {
      this.logger?.log(getSeconds, 'RCS pulse produced no propellant usage', {
        logSource: 'sim',
        logCategory: 'autopilot',
        logSeverity: 'warning',
        autopilotId,
        eventId,
        craftId: normalizedCraft,
        axis: normalizedAxis,
        torqueAxis: normalizedTorque,
        thrusterIds: normalizedThrusterIds,
      });
      return {
        tankKey: resolvedTankKey,
        massKg: 0,
        impulseNs: 0,
        pulses: thrusterPulseCount,
        thrusters: usedThrusters,
        craftId: craftForUsage,
      };
    }

    if (resolvedTankKey && this.resourceSystem) {
      this.resourceSystem.recordPropellantUsage(resolvedTankKey, totalMassKg, {
        getSeconds,
        source: autopilotId ?? 'rcs_controller',
        note: note ?? 'rcs_pulse',
        details: {
          eventId,
          craftId: craftForUsage,
          axis: normalizedAxis,
          torqueAxis: normalizedTorque,
          thrusters: usedThrusters,
          pulses,
          dutyCycle: duty,
          commandDurationSeconds: Number.isFinite(baseDuration) ? baseDuration : null,
        },
      });
    }

    this.#accumulateMetrics({
      tankKey: resolvedTankKey,
      craftId: craftForUsage,
      axis: normalizedAxis,
      massKg: totalMassKg,
      pulses: thrusterPulseCount,
      impulseNs: totalImpulseNs,
    });

    this.logger?.log(getSeconds, 'RCS pulse executed', {
      logSource: 'sim',
      logCategory: 'autopilot',
      logSeverity: 'notice',
      autopilotId,
      eventId,
      craftId: craftForUsage,
      tankKey: resolvedTankKey,
      axis: normalizedAxis,
      torqueAxis: normalizedTorque,
      thrusters: usedThrusters,
      pulses,
      dutyCycle: duty,
      massKg: totalMassKg,
      impulseNs: totalImpulseNs,
    });

    return {
      tankKey: resolvedTankKey,
      massKg: totalMassKg,
      impulseNs: totalImpulseNs,
      pulses: thrusterPulseCount,
      thrusters: usedThrusters,
      craftId: craftForUsage,
    };
  }

  stats() {
    return {
      totalPulses: this.metrics.totalPulses,
      totalImpulseNs: this.metrics.totalImpulseNs,
      totalMassKg: this.metrics.totalMassKg,
      usageByTank: { ...this.metrics.usageByTank },
      usageByCraft: { ...this.metrics.usageByCraft },
      pulsesByAxis: { ...this.metrics.pulsesByAxis },
      thrusterCount: this.thrusters.size,
      craftCount: this.craft.size,
    };
  }

  #ingestThrusterData(thrusterData) {
    if (!thrusterData || typeof thrusterData !== 'object') {
      return;
    }
    const craftEntries = Array.isArray(thrusterData.craft) ? thrusterData.craft : [];
    for (const rawCraft of craftEntries) {
      const craftId = this.#normalizeId(rawCraft?.id);
      if (!craftId) {
        continue;
      }
      const defaults = {
        thrustNewtons: this.#coerceNumber(rawCraft?.rcs?.defaults?.thrust_newtons),
        ispSeconds: this.#coerceNumber(rawCraft?.rcs?.defaults?.isp_seconds),
        minImpulseSeconds: this.#coerceNumber(rawCraft?.rcs?.defaults?.min_impulse_seconds),
        maxDutyCycle: this.#coerceNumber(rawCraft?.rcs?.defaults?.max_duty_cycle),
      };

      const tankKey = this.#normalizeTankKey(rawCraft?.propellant_tank ?? this.options.defaultTankKey);
      this.craft.set(craftId, {
        id: craftId,
        name: typeof rawCraft?.name === 'string' ? rawCraft.name : craftId,
        tankKey,
        defaults,
      });

      const clusters = Array.isArray(rawCraft?.rcs?.clusters) ? rawCraft.rcs.clusters : [];
      for (const cluster of clusters) {
        const thrusters = Array.isArray(cluster?.thrusters) ? cluster.thrusters : [];
        for (const thruster of thrusters) {
          const thrusterId = this.#normalizeId(thruster?.id);
          if (!thrusterId) {
            continue;
          }
          if (this.thrusters.has(thrusterId)) {
            continue;
          }

          const translationAxis = this.#normalizeAxis(thruster?.translation_axis);
          const torqueAxes = Array.isArray(thruster?.torque_axes)
            ? thruster.torque_axes.map((axisValue) => this.#normalizeTorqueAxis(axisValue)).filter(Boolean)
            : [];

          const entry = {
            id: thrusterId,
            craftId,
            clusterId: this.#normalizeId(cluster?.id),
            translationAxis,
            torqueAxes,
            thrustNewtons: this.#coerceNumber(thruster?.thrust_newtons),
            ispSeconds: this.#coerceNumber(thruster?.isp_seconds),
            minImpulseSeconds: this.#coerceNumber(
              thruster?.min_impulse_seconds ?? cluster?.min_impulse_seconds,
            ),
            maxDutyCycle: this.#coerceNumber(
              thruster?.max_duty_cycle ?? cluster?.max_duty_cycle ?? defaults.maxDutyCycle,
            ),
          };

          this.thrusters.set(thrusterId, entry);
          if (!this.thrustersByCraft.has(craftId)) {
            this.thrustersByCraft.set(craftId, []);
          }
          this.thrustersByCraft.get(craftId).push(entry);

          if (translationAxis) {
            this.#addIndexEntry(this.thrustersByTranslationAxis, translationAxis, thrusterId);
          }
          for (const torqueAxis of torqueAxes) {
            this.#addIndexEntry(this.thrustersByTorqueAxis, torqueAxis, thrusterId);
          }
        }
      }
    }
  }

  #selectThrusters({ craftId, thrusterIds, axis, torqueAxis, maxThrusters }) {
    const selected = new Map();

    if (Array.isArray(thrusterIds) && thrusterIds.length > 0) {
      for (const id of thrusterIds) {
        const thruster = this.thrusters.get(id);
        if (thruster) {
          selected.set(id, thruster);
        }
      }
    }

    if (selected.size === 0) {
      const translationCandidates = axis ? this.#lookupThrusters(this.thrustersByTranslationAxis, axis) : [];
      const torqueCandidates = torqueAxis ? this.#lookupThrusters(this.thrustersByTorqueAxis, torqueAxis) : [];

      let combined = translationCandidates;
      if (combined.length === 0) {
        combined = torqueCandidates;
      } else if (torqueCandidates.length > 0) {
        const torqueSet = new Set(torqueCandidates.map((entry) => entry.id));
        combined = combined.filter((entry) => torqueSet.has(entry.id));
        if (combined.length === 0) {
          combined = torqueCandidates;
        }
      }

      for (const thruster of combined) {
        selected.set(thruster.id, thruster);
      }
    }

    let thrusters = Array.from(selected.values());
    if (craftId) {
      const filtered = thrusters.filter((thruster) => thruster.craftId === craftId);
      if (filtered.length > 0) {
        thrusters = filtered;
      } else {
        const craftThrusters = this.thrustersByCraft.get(craftId) ?? [];
        if (axis) {
          thrusters = craftThrusters.filter((entry) => entry.translationAxis === axis);
        } else if (torqueAxis) {
          thrusters = craftThrusters.filter((entry) => entry.torqueAxes.includes(torqueAxis));
        } else {
          thrusters = craftThrusters.slice();
        }
      }
    }

    thrusters.sort((a, b) => a.id.localeCompare(b.id));

    const limit = Number.isFinite(maxThrusters) && maxThrusters > 0 ? Math.floor(maxThrusters) : null;
    if (limit != null && thrusters.length > limit) {
      return thrusters.slice(0, limit);
    }

    return thrusters;
  }

  #lookupThrusters(indexMap, key) {
    if (!indexMap || !key) {
      return [];
    }
    const ids = indexMap.get(key);
    if (!ids) {
      return [];
    }
    const thrusters = [];
    for (const id of ids) {
      const thruster = this.thrusters.get(id);
      if (thruster) {
        thrusters.push(thruster);
      }
    }
    return thrusters;
  }

  #addIndexEntry(map, key, thrusterId) {
    if (!key || !thrusterId) {
      return;
    }
    if (!map.has(key)) {
      map.set(key, new Set());
    }
    map.get(key).add(thrusterId);
  }

  #accumulateMetrics({ tankKey, craftId, axis, massKg, pulses, impulseNs }) {
    if (Number.isFinite(pulses) && pulses > 0) {
      this.metrics.totalPulses += pulses;
    }
    if (Number.isFinite(impulseNs) && impulseNs > 0) {
      this.metrics.totalImpulseNs += impulseNs;
    }
    if (Number.isFinite(massKg) && massKg > 0) {
      this.metrics.totalMassKg += massKg;
      if (tankKey) {
        this.metrics.usageByTank[tankKey] = (this.metrics.usageByTank[tankKey] ?? 0) + massKg;
      }
      if (craftId) {
        this.metrics.usageByCraft[craftId] = (this.metrics.usageByCraft[craftId] ?? 0) + massKg;
      }
    }
    if (axis) {
      this.metrics.pulsesByAxis[axis] = (this.metrics.pulsesByAxis[axis] ?? 0) + (Number.isFinite(pulses) ? pulses : 0);
    }
  }

  #resolveTankKey(craftId) {
    if (!craftId) {
      return this.options.defaultTankKey;
    }
    const craft = this.craft.get(craftId);
    return craft?.tankKey ?? this.options.defaultTankKey;
  }

  #normalizeAxis(value) {
    if (!value) {
      return null;
    }
    let text = String(value).trim();
    if (!text) {
      return null;
    }
    text = text.toUpperCase();
    text = text.replace(/\s+/g, '');
    if (!text.startsWith('+') && !text.startsWith('-')) {
      text = `+${text}`;
    }
    return text;
  }

  #normalizeTorqueAxis(value) {
    if (!value) {
      return null;
    }
    let text = String(value).trim();
    if (!text) {
      return null;
    }
    text = text.toUpperCase();
    text = text.replace(/\s+/g, '');
    if (!text.startsWith('+') && !text.startsWith('-')) {
      text = `+${text}`;
    }
    return text;
  }

  #normalizeId(value) {
    if (!value) {
      return null;
    }
    const text = String(value).trim();
    return text.length > 0 ? text : null;
  }

  #normalizeIdList(value) {
    if (!value) {
      return [];
    }
    if (Array.isArray(value)) {
      return value.map((entry) => this.#normalizeId(entry)).filter(Boolean);
    }
    if (typeof value === 'string') {
      return value
        .split(',')
        .map((entry) => this.#normalizeId(entry))
        .filter(Boolean);
    }
    return [];
  }

  #normalizeTankKey(value) {
    if (!value) {
      return null;
    }
    const text = String(value).trim();
    if (!text) {
      return null;
    }
    return text.endsWith('_kg') ? text.slice(0, -3) : text;
  }

  #clamp(value, min, max, fallback = 0) {
    const parsed = this.#coerceNumber(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    if (parsed < min) {
      return min;
    }
    if (parsed > max) {
      return max;
    }
    return parsed;
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
      if (!trimmed) {
        return null;
      }
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }
}
