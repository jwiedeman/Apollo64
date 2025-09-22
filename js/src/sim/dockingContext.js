import { formatGET } from '../utils/time.js';

const DEFAULT_OPTIONS = {
  dutyCycleWindowSeconds: 60,
};

function clamp(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function coerceNumber(value, fallback = null) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function normalizeId(value) {
  if (!value) {
    return null;
  }
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

export class DockingContext {
  constructor({
    config = null,
    resourceSystem = null,
    rcsController = null,
    thrusterConfig = null,
    logger = null,
    options = null,
  } = {}) {
    this.logger = logger ?? null;
    this.options = {
      ...DEFAULT_OPTIONS,
      ...(options ?? {}),
    };

    const windowSeconds = Number(this.options.dutyCycleWindowSeconds);
    this.dutyCycleWindowSeconds = Number.isFinite(windowSeconds) && windowSeconds > 0
      ? windowSeconds
      : DEFAULT_OPTIONS.dutyCycleWindowSeconds;

    this.resourceSystem = resourceSystem ?? null;
    this.rcsController = rcsController ?? null;

    this.config = this.#normalizeConfig(config);
    this.quadCatalog = this.#buildQuadCatalog(thrusterConfig);

    this.gateState = new Map();
    this.lastSnapshot = null;
    this.lastUpdateSeconds = 0;

    this.rcsDutyState = new Map();

    this.unsubscribeRcs = null;
    if (this.rcsController && typeof this.rcsController.registerUsageListener === 'function') {
      this.unsubscribeRcs = this.rcsController.registerUsageListener((usage) => {
        try {
          this.recordRcsUsage(usage);
        } catch (error) {
          this.logger?.log(usage?.getSeconds ?? 0, 'DockingContext RCS listener error', {
            logSource: 'sim',
            logCategory: 'docking',
            logSeverity: 'warning',
            error: error?.message ?? String(error),
          });
        }
      });
    }
  }

  dispose() {
    if (typeof this.unsubscribeRcs === 'function') {
      this.unsubscribeRcs();
      this.unsubscribeRcs = null;
    }
  }

  update(currentGetSeconds, { scheduler = null } = {}) {
    if (!this.config) {
      this.lastSnapshot = null;
      this.lastUpdateSeconds = currentGetSeconds;
      return null;
    }

    const event = scheduler && typeof scheduler.getEventById === 'function'
      ? scheduler.getEventById(this.config.eventId)
      : null;

    const progress = this.#computeEventProgress(currentGetSeconds, event);
    this.#decayDutyEntries(currentGetSeconds);

    const gates = this.#summarizeGates({ currentGetSeconds, progress, event });
    const activeGateId = this.#selectActiveGateId(gates);

    const rangeMeters = this.#computeRange(progress);
    const closingRateMps = this.#resolveClosingRate(activeGateId, gates);
    const predictedContactVelocityMps = this.#resolveContactVelocity();

    const rcs = this.#summarizeRcs(currentGetSeconds);

    const snapshot = {
      eventId: this.config.eventId,
      progress,
      rangeMeters,
      closingRateMps,
      lateralRateMps: 0,
      predictedContactVelocityMps,
      gates,
      activeGateId,
      activeGate: activeGateId,
      rcs,
    };

    this.lastSnapshot = snapshot;
    this.lastUpdateSeconds = currentGetSeconds;
    return snapshot;
  }

  snapshot() {
    if (!this.lastSnapshot) {
      return null;
    }

    const gates = Array.isArray(this.lastSnapshot.gates)
      ? this.lastSnapshot.gates.map((gate) => ({ ...gate }))
      : [];

    const rcs = this.lastSnapshot.rcs ? {
      ...this.lastSnapshot.rcs,
      quads: Array.isArray(this.lastSnapshot.rcs.quads)
        ? this.lastSnapshot.rcs.quads.map((quad) => ({ ...quad }))
        : undefined,
      propellantKgRemaining: this.lastSnapshot.rcs.propellantKgRemaining
        ? { ...this.lastSnapshot.rcs.propellantKgRemaining }
        : undefined,
      propellantKgBudget: this.lastSnapshot.rcs.propellantKgBudget
        ? { ...this.lastSnapshot.rcs.propellantKgBudget }
        : undefined,
    } : null;

    return {
      ...this.lastSnapshot,
      gates,
      rcs,
    };
  }

  stats() {
    if (!this.lastSnapshot) {
      return null;
    }
    return {
      lastUpdateSeconds: this.lastUpdateSeconds,
      activeGateId: this.lastSnapshot.activeGateId ?? null,
      progress: this.lastSnapshot.progress ?? null,
      gateStatuses: Array.isArray(this.lastSnapshot.gates)
        ? this.lastSnapshot.gates.map((gate) => ({ id: gate.id, status: gate.status }))
        : [],
    };
  }

  recordRcsUsage({ thrusters = null, getSeconds = null } = {}) {
    if (!Array.isArray(thrusters) || thrusters.length === 0) {
      return;
    }

    const timestamp = Number(getSeconds);
    const targetSeconds = Number.isFinite(timestamp) ? timestamp : this.lastUpdateSeconds;

    for (const usage of thrusters) {
      if (!usage || typeof usage !== 'object') {
        continue;
      }
      const clusterId = normalizeId(usage.clusterId ?? usage.cluster_id ?? null);
      if (!clusterId) {
        continue;
      }
      const entry = this.#decayDutyEntry(clusterId, targetSeconds);
      const durationSeconds = coerceNumber(usage.durationSeconds ?? usage.duration_seconds, 0);
      const massKg = coerceNumber(usage.massKg ?? usage.mass_kg, 0);
      const pulses = coerceNumber(usage.pulses, 0);

      if (Number.isFinite(durationSeconds) && durationSeconds > 0 && Number.isFinite(pulses) && pulses > 0) {
        entry.duty += (durationSeconds * pulses) / this.dutyCycleWindowSeconds;
      } else if (Number.isFinite(durationSeconds) && durationSeconds > 0) {
        entry.duty += durationSeconds / this.dutyCycleWindowSeconds;
      }
      if (Number.isFinite(massKg) && massKg > 0) {
        entry.massWindowKg += massKg;
      }
      entry.lastUsageSeconds = targetSeconds;
      this.rcsDutyState.set(clusterId, entry);
    }
  }

  #summarizeGates({ currentGetSeconds, progress, event }) {
    if (!Array.isArray(this.config?.gates)) {
      return [];
    }

    const openSeconds = coerceNumber(
      event?.getOpenSeconds
        ?? event?.get_open_seconds
        ?? event?.openSeconds
        ?? event?.opensAtSeconds
        ?? event?.opens_at_seconds,
      null,
    );
    const closeSeconds = coerceNumber(
      event?.getCloseSeconds
        ?? event?.get_close_seconds
        ?? event?.closeSeconds
        ?? event?.closesAtSeconds
        ?? event?.closes_at_seconds,
      null,
    );
    const activationSeconds = coerceNumber(event?.activationTimeSeconds ?? event?.activation_time_seconds, null);
    const completionSeconds = coerceNumber(event?.completionTimeSeconds ?? event?.completion_time_seconds, null);

    const summaries = [];
    for (const gate of this.config.gates) {
      const state = this.#updateGateState({
        gate,
        progress,
        currentGetSeconds,
        activationSeconds,
        completionSeconds,
      });

      const deadlineSeconds = this.#computeGateDeadline(gate, { openSeconds, closeSeconds, completionSeconds, state });
      const deadlineGet = Number.isFinite(deadlineSeconds) ? formatGET(Math.round(deadlineSeconds)) : null;
      const timeRemainingSeconds = Number.isFinite(deadlineSeconds)
        ? deadlineSeconds - currentGetSeconds
        : null;
      const overdue = Number.isFinite(timeRemainingSeconds) ? timeRemainingSeconds < 0 : false;

      const summary = {
        id: gate.id,
        label: gate.label,
        rangeMeters: gate.rangeMeters,
        targetRateMps: gate.targetRateMps,
        tolerance: gate.tolerance,
        activationProgress: gate.activationProgress,
        completionProgress: gate.completionProgress,
        checklistId: gate.checklistId,
        sources: gate.sources,
        status: state.status,
        progress: state.gateProgress,
        activatedAtSeconds: state.activatedAtSeconds,
        completedAtSeconds: state.completedAtSeconds,
        deadlineSeconds,
        deadlineGet,
        timeRemainingSeconds,
        overdue,
      };

      summaries.push(summary);
    }

    return summaries;
  }

  #selectActiveGateId(gates) {
    if (!Array.isArray(gates) || gates.length === 0) {
      return null;
    }

    for (const gate of gates) {
      if (gate.status === 'active') {
        return gate.id;
      }
    }

    for (const gate of gates) {
      if (gate.status !== 'complete') {
        return gate.id;
      }
    }

    return gates[gates.length - 1].id;
  }

  #computeRange(progress) {
    if (!this.config) {
      return null;
    }
    const start = coerceNumber(this.config.startRangeMeters, null);
    const end = coerceNumber(this.config.endRangeMeters, null);
    if (!(Number.isFinite(start) && Number.isFinite(end))) {
      return null;
    }
    const fraction = clamp(progress ?? 0, 0, 1);
    return start + (end - start) * fraction;
  }

  #resolveClosingRate(activeGateId, gates) {
    if (!Array.isArray(gates) || gates.length === 0) {
      return null;
    }
    if (activeGateId) {
      const active = gates.find((gate) => gate.id === activeGateId);
      if (active && Number.isFinite(active.targetRateMps)) {
        return active.targetRateMps;
      }
    }
    const last = gates[gates.length - 1];
    return Number.isFinite(last?.targetRateMps) ? last.targetRateMps : null;
  }

  #resolveContactVelocity() {
    if (!this.config || !Array.isArray(this.config.gates) || this.config.gates.length === 0) {
      return null;
    }
    const lastGate = this.config.gates[this.config.gates.length - 1];
    return Number.isFinite(lastGate?.targetRateMps) ? lastGate.targetRateMps : null;
  }

  #summarizeRcs(currentGetSeconds) {
    const summary = {};

    const remaining = {};
    const budget = {};

    const propellantState = this.resourceSystem?.state?.propellant ?? {};
    for (const [key, value] of Object.entries(propellantState)) {
      const normalizedKey = this.#normalizePropellantKey(key);
      const numeric = coerceNumber(value, null);
      if (normalizedKey && Number.isFinite(numeric)) {
        remaining[normalizedKey] = numeric;
      }
    }

    const propellantBudgets = this.resourceSystem?.budgets?.propellant ?? {};
    for (const [rawKey, entry] of Object.entries(propellantBudgets)) {
      const normalizedKey = this.#normalizePropellantKey(rawKey);
      const initial = coerceNumber(entry?.initial_kg ?? entry?.initialKg, null);
      if (normalizedKey && Number.isFinite(initial)) {
        budget[normalizedKey] = initial;
      }
    }

    if (Object.keys(remaining).length > 0) {
      summary.propellantKgRemaining = remaining;
    }
    if (Object.keys(budget).length > 0) {
      summary.propellantKgBudget = budget;
    }

    if (this.quadCatalog.length > 0) {
      const quads = [];
      for (const quad of this.quadCatalog) {
        const entry = this.#decayDutyEntry(quad.id, currentGetSeconds);
        const dutyPct = Number.isFinite(entry?.duty)
          ? clamp(entry.duty * 100, 0, 100)
          : null;
        quads.push({
          id: quad.id,
          enabled: true,
          dutyCyclePct: dutyPct,
        });
      }
      summary.quads = quads;
    }

    return summary;
  }

  #computeEventProgress(currentGetSeconds, event) {
    const status = event?.status ?? event?.event_status ?? null;

    if (status === 'complete' || status === 'completed' || status === 'failed') {
      return 1;
    }

    if (status === 'active') {
      const activationSeconds = coerceNumber(
        event?.activationTimeSeconds ?? event?.activation_time_seconds,
        null,
      );
      const expectedDurationSeconds = coerceNumber(
        event?.expectedDurationSeconds ?? event?.expected_duration_seconds,
        null,
      );
      if (Number.isFinite(activationSeconds) && Number.isFinite(expectedDurationSeconds) && expectedDurationSeconds > 0) {
        const elapsed = currentGetSeconds - activationSeconds;
        return clamp(elapsed / expectedDurationSeconds, 0, 1);
      }
    }

    const openSeconds = coerceNumber(
      event?.getOpenSeconds
        ?? event?.get_open_seconds
        ?? event?.openSeconds
        ?? event?.opensAtSeconds
        ?? event?.opens_at_seconds,
      null,
    );
    const closeSeconds = coerceNumber(
      event?.getCloseSeconds
        ?? event?.get_close_seconds
        ?? event?.closeSeconds
        ?? event?.closesAtSeconds
        ?? event?.closes_at_seconds,
      null,
    );

    if (Number.isFinite(openSeconds) && Number.isFinite(closeSeconds) && closeSeconds > openSeconds) {
      const fraction = (currentGetSeconds - openSeconds) / (closeSeconds - openSeconds);
      return clamp(fraction, 0, 1);
    }

    return 0;
  }

  #updateGateState({ gate, progress, currentGetSeconds, activationSeconds, completionSeconds }) {
    const state = this.gateState.get(gate.id) ?? {
      status: 'pending',
      activatedAtSeconds: null,
      completedAtSeconds: null,
      gateProgress: 0,
    };

    const activation = clamp(coerceNumber(gate.activationProgress, 0), 0, 1);
    const completion = clamp(coerceNumber(gate.completionProgress, 1), 0, 1);
    const normalizedProgress = clamp(progress ?? 0, 0, 1);

    let status = 'pending';
    let activatedAtSeconds = state.activatedAtSeconds;
    let completedAtSeconds = state.completedAtSeconds;
    let gateProgress = 0;

    if (normalizedProgress >= completion) {
      status = 'complete';
      gateProgress = 1;
      if (!Number.isFinite(completedAtSeconds)) {
        completedAtSeconds = Number.isFinite(completionSeconds)
          ? completionSeconds
          : currentGetSeconds;
      }
      if (!Number.isFinite(activatedAtSeconds)) {
        activatedAtSeconds = Number.isFinite(activationSeconds)
          ? activationSeconds
          : currentGetSeconds;
      }
    } else if (normalizedProgress >= activation) {
      status = 'active';
      const span = completion - activation;
      gateProgress = span > 0 ? clamp((normalizedProgress - activation) / span, 0, 1) : 0;
      if (!Number.isFinite(activatedAtSeconds)) {
        activatedAtSeconds = Number.isFinite(activationSeconds)
          ? activationSeconds
          : currentGetSeconds;
      }
    } else {
      status = 'pending';
      gateProgress = 0;
    }

    const nextState = {
      status,
      activatedAtSeconds,
      completedAtSeconds,
      gateProgress,
    };

    this.gateState.set(gate.id, nextState);
    return nextState;
  }

  #computeGateDeadline(gate, { openSeconds, closeSeconds, completionSeconds, state }) {
    if (Number.isFinite(state?.completedAtSeconds)) {
      return state.completedAtSeconds;
    }

    if (
      Number.isFinite(openSeconds)
      && Number.isFinite(closeSeconds)
      && closeSeconds > openSeconds
    ) {
      const fraction = clamp(coerceNumber(gate.completionProgress, 1), 0, 1);
      return openSeconds + (closeSeconds - openSeconds) * fraction;
    }

    if (Number.isFinite(completionSeconds)) {
      return completionSeconds;
    }

    return null;
  }

  #normalizeConfig(rawConfig) {
    if (!rawConfig || typeof rawConfig !== 'object') {
      return null;
    }

    const eventId = normalizeId(rawConfig.eventId ?? rawConfig.event_id ?? null);
    if (!eventId) {
      return null;
    }

    const config = {
      eventId,
      notes: typeof rawConfig.notes === 'string' ? rawConfig.notes : null,
      startRangeMeters: coerceNumber(rawConfig.startRangeMeters ?? rawConfig.start_range_meters, null),
      endRangeMeters: coerceNumber(rawConfig.endRangeMeters ?? rawConfig.end_range_meters, null),
      version: coerceNumber(rawConfig.version, null),
      gates: [],
    };

    const gateEntries = Array.isArray(rawConfig.gates) ? rawConfig.gates : [];
    for (const rawGate of gateEntries) {
      const id = normalizeId(rawGate.id ?? rawGate.gateId ?? rawGate.gate_id ?? null);
      if (!id) {
        continue;
      }
      const gate = {
        id,
        label: typeof rawGate.label === 'string' ? rawGate.label : id,
        rangeMeters: coerceNumber(rawGate.rangeMeters ?? rawGate.range_meters, null),
        targetRateMps: coerceNumber(rawGate.targetRateMps ?? rawGate.target_rate_mps, null),
        tolerance: this.#normalizeTolerance(rawGate.tolerance ?? rawGate.tolerance_pct ?? null),
        activationProgress: coerceNumber(rawGate.activationProgress ?? rawGate.activation_progress, 0),
        completionProgress: coerceNumber(rawGate.completionProgress ?? rawGate.completion_progress, 1),
        checklistId: normalizeId(rawGate.checklistId ?? rawGate.checklist_id ?? null),
        sources: Array.isArray(rawGate.sources) ? rawGate.sources.filter((item) => typeof item === 'string') : null,
      };
      config.gates.push(gate);
    }

    return config;
  }

  #normalizeTolerance(rawTolerance) {
    if (!rawTolerance || typeof rawTolerance !== 'object') {
      return null;
    }
    const plus = coerceNumber(rawTolerance.plus ?? rawTolerance.max, null);
    const minus = coerceNumber(rawTolerance.minus ?? rawTolerance.min, null);
    if (!Number.isFinite(plus) && !Number.isFinite(minus)) {
      return null;
    }
    const tolerance = {};
    if (Number.isFinite(plus)) {
      tolerance.plus = plus;
    }
    if (Number.isFinite(minus)) {
      tolerance.minus = minus;
    }
    return tolerance;
  }

  #buildQuadCatalog(thrusterConfig) {
    const catalog = [];
    if (!thrusterConfig || typeof thrusterConfig !== 'object') {
      return catalog;
    }

    const craftEntries = Array.isArray(thrusterConfig.craft) ? thrusterConfig.craft : [];
    for (const craft of craftEntries) {
      const clusters = craft?.rcs?.clusters;
      if (!Array.isArray(clusters)) {
        continue;
      }
      for (const cluster of clusters) {
        const id = normalizeId(cluster?.id);
        if (!id) {
          continue;
        }
        catalog.push({ id });
      }
    }
    return catalog;
  }

  #normalizePropellantKey(key) {
    if (!key) {
      return null;
    }
    const trimmed = String(key).trim();
    if (!trimmed) {
      return null;
    }
    return trimmed.replace(/_kg$/iu, '');
  }

  #decayDutyEntries(targetSeconds) {
    const time = Number(targetSeconds);
    if (!Number.isFinite(time)) {
      return;
    }
    for (const [clusterId] of this.rcsDutyState) {
      this.#decayDutyEntry(clusterId, time);
    }
  }

  #decayDutyEntry(clusterId, targetSeconds) {
    let entry = this.rcsDutyState.get(clusterId);
    if (!entry) {
      entry = {
        duty: 0,
        massWindowKg: 0,
        lastUpdateSeconds: Number.isFinite(targetSeconds) ? targetSeconds : 0,
        lastUsageSeconds: null,
      };
      this.rcsDutyState.set(clusterId, entry);
      return entry;
    }

    const now = Number(targetSeconds);
    if (!Number.isFinite(now)) {
      return entry;
    }

    const deltaSeconds = now - (entry.lastUpdateSeconds ?? now);
    if (Number.isFinite(deltaSeconds) && deltaSeconds > 0) {
      const decay = Math.exp(-deltaSeconds / this.dutyCycleWindowSeconds);
      entry.duty *= decay;
      entry.massWindowKg *= decay;
      entry.lastUpdateSeconds = now;
    } else if (!Number.isFinite(entry.lastUpdateSeconds)) {
      entry.lastUpdateSeconds = now;
    }

    return entry;
  }
}

