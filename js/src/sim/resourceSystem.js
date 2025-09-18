import { formatGET, parseGET } from '../utils/time.js';

const DEFAULT_STATE = {
  power_margin_pct: 100,
  cryo_boiloff_rate_pct_per_hr: 1.0,
  thermal_balance_state: 'UNINITIALIZED',
  ptc_active: false,
  delta_v_margin_mps: 0,
  delta_v: {
    total: {
      base_mps: 0,
      adjustment_mps: 0,
      margin_mps: 0,
      usable_delta_v_mps: 0,
    },
    stages: {},
  },
  power: {
    fuel_cell_output_kw: 0,
    fuel_cell_load_kw: 0,
    battery_charge_pct: 100,
    reactant_minutes_remaining: null,
  },
  propellant: {
    csm_sps_kg: 0,
    csm_rcs_kg: 0,
    lm_descent_kg: 0,
    lm_ascent_kg: 0,
    lm_rcs_kg: 0,
  },
  lifeSupport: {
    oxygen_kg: 0,
    water_kg: 0,
    lithium_hydroxide_canisters: 0,
    co2_mmHg: 0,
  },
  communications: {
    active: false,
    current_pass_id: null,
    current_station: null,
    current_next_station: null,
    current_window_open_get: null,
    current_window_close_get: null,
    current_window_open_seconds: null,
    current_window_close_seconds: null,
    current_window_time_remaining_s: null,
    current_pass_duration_s: null,
    current_pass_progress: null,
    time_since_window_open_s: null,
    signal_strength_db: null,
    downlink_rate_kbps: null,
    handover_minutes: null,
    power_margin_delta_kw: null,
    power_load_delta_kw: 0,
    next_pass_id: null,
    next_station: null,
    next_window_open_get: null,
    next_window_open_seconds: null,
    time_until_next_window_s: null,
    schedule_count: 0,
    last_pad_id: null,
  },
};

const DEFAULT_OPTIONS = {
  logIntervalSeconds: 3600,
};

const DEFAULT_HISTORY_OPTIONS = {
  enabled: true,
  sampleIntervalSeconds: 60,
  durationSeconds: 4 * 3600,
};

function normalizeHistoryOptions(raw) {
  const base = { ...DEFAULT_HISTORY_OPTIONS };

  if (raw === false) {
    base.enabled = false;
    return { ...base, maxSamples: 0 };
  }

  if (raw && typeof raw === 'object') {
    if (raw.enabled === false) {
      base.enabled = false;
    } else if (raw.enabled === true) {
      base.enabled = true;
    }

    const interval = Number(raw.sampleIntervalSeconds);
    if (Number.isFinite(interval) && interval > 0) {
      base.sampleIntervalSeconds = interval;
    }

    const duration = Number(raw.durationSeconds);
    if (Number.isFinite(duration) && duration > 0) {
      base.durationSeconds = duration;
    }
  }

  const { durationSeconds, sampleIntervalSeconds, enabled } = base;
  const maxSamples = enabled && durationSeconds > 0 && sampleIntervalSeconds > 0
    ? Math.max(1, Math.ceil(durationSeconds / sampleIntervalSeconds) + 1)
    : 0;

  return { ...base, maxSamples };
}

const DRIFT_RATES = {
  powerPerSecond: 0.8 / 3600, // % per second when PTC is off
  cryoPerSecond: 0.02 / 3600, // % per second when PTC is off
};

const RECOVERY_RATES = {
  powerPerSecond: 0.4 / 3600,
  cryoPerSecond: 0.015 / 3600,
};

const DELTA_V_STAGE_CONFIG = [
  { id: 'csm_sps', tankKey: 'csm_sps_kg', label: 'CSM SPS' },
  { id: 'lm_descent', tankKey: 'lm_descent_kg', label: 'LM Descent' },
  { id: 'lm_ascent', tankKey: 'lm_ascent_kg', label: 'LM Ascent' },
];

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepMerge(target, source) {
  if (!source || typeof source !== 'object') {
    return target;
  }
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (!target[key] || typeof target[key] !== 'object') {
        target[key] = {};
      }
      deepMerge(target[key], value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

export class ResourceSystem {
  constructor(logger, options = {}) {
    this.logger = logger;
    const { history: historyOptions, initialState, ...restOptions } = options ?? {};
    this.options = { ...DEFAULT_OPTIONS, ...restOptions };
    this.state = deepMerge(deepClone(DEFAULT_STATE), initialState ?? {});
    this.failures = new Map();
    this.failureCatalog = new Map();
    this.metrics = {
      propellantDeltaKg: Object.create(null),
      powerDeltaKw: Object.create(null),
      deltaV: {
        usedMps: 0,
        recoveredMps: 0,
      },
    };
    this.budgets = {};
    this.propellantConfig = Object.create(null);
    this.deltaVStageByTank = Object.create(null);
    this.communicationsSchedule = [];
    this.activeCommunicationsPass = null;
    this.activeCommunicationsPowerDeltaKw = 0;
    this._logCountdown = this.options.logIntervalSeconds;

    this.historyOptions = normalizeHistoryOptions(historyOptions);
    this.historyCapacity = this.historyOptions.maxSamples ?? 0;
    this.history = this.historyOptions.enabled
      ? {
          power: [],
          thermal: [],
          communications: [],
          propellant: Object.create(null),
        }
      : null;
    this._historyAccumulator = 0;
    this._historyLastSampleSeconds = null;

    if (restOptions.consumables) {
      this.configureConsumables(restOptions.consumables);
    }
    if (restOptions.communicationsSchedule) {
      this.configureCommunicationsSchedule(restOptions.communicationsSchedule);
    }
    if (restOptions.failureCatalog || restOptions.failures) {
      this.configureFailures(restOptions.failureCatalog ?? restOptions.failures);
    }

    if (this.historyOptions.enabled) {
      this.#recordHistorySample(0, { force: true });
    }
  }

  configureConsumables(consumables) {
    if (!consumables || typeof consumables !== 'object') {
      return;
    }

    this.budgets = deepClone(consumables);

    const power = consumables.power ?? {};
    const propellant = consumables.propellant ?? {};
    const lifeSupport = consumables.life_support ?? {};
    const communications = consumables.communications ?? {};

    if (Number.isFinite(power.fuel_cells?.reactant_minutes)) {
      this.state.power.reactant_minutes_remaining = power.fuel_cells.reactant_minutes;
    }
    if (Number.isFinite(power.fuel_cells?.output_kw)) {
      this.state.power.fuel_cell_output_kw = power.fuel_cells.output_kw;
    }
    if (Number.isFinite(power.fuel_cells?.baseline_load_kw)) {
      this.state.power.fuel_cell_load_kw = power.fuel_cells.baseline_load_kw;
    }
    if (Number.isFinite(power.batteries?.initial_soc_pct)) {
      this.state.power.battery_charge_pct = power.batteries.initial_soc_pct;
    }

    this.#configurePropellantBudgets(propellant);

    if (Number.isFinite(lifeSupport.oxygen?.initial_kg)) {
      this.state.lifeSupport.oxygen_kg = lifeSupport.oxygen.initial_kg;
    }
    if (Number.isFinite(lifeSupport.water?.initial_kg)) {
      this.state.lifeSupport.water_kg = lifeSupport.water.initial_kg;
    }
    if (Number.isFinite(lifeSupport.lithium_hydroxide?.canisters)) {
      this.state.lifeSupport.lithium_hydroxide_canisters = lifeSupport.lithium_hydroxide.canisters;
    }

    if (communications.next_window_open_get) {
      this.state.communications.next_window_open_get = communications.next_window_open_get;
    }
  }

  configureCommunicationsSchedule(schedule) {
    this.communicationsSchedule = this.#normalizeCommunicationsSchedule(schedule);
    this.state.communications.schedule_count = this.communicationsSchedule.length;
    this.#clearCurrentCommunicationsState();
    this.#updateNextCommunicationsPass(0);
  }

  configureFailures(catalog) {
    this.failureCatalog.clear();
    if (!catalog) {
      return;
    }

    if (catalog instanceof Map) {
      for (const [id, record] of catalog.entries()) {
        if (!id) {
          continue;
        }
        this.failureCatalog.set(String(id), record);
      }
      return;
    }

    if (Array.isArray(catalog)) {
      for (const entry of catalog) {
        const id = entry?.failure_id ?? entry?.id;
        if (!id) {
          continue;
        }
        this.failureCatalog.set(String(id), entry);
      }
      return;
    }

    if (typeof catalog === 'object') {
      for (const [id, record] of Object.entries(catalog)) {
        if (!id) {
          continue;
        }
        this.failureCatalog.set(String(id), record);
      }
    }
  }

  applyEffect(effect, { getSeconds, source, type }) {
    if (!effect || Object.keys(effect).length === 0) {
      return;
    }

    const applied = {};

    for (const [key, value] of Object.entries(effect)) {
      if (key === 'failure_id') {
        if (value) {
          const failure = this.recordFailure(value, { getSeconds, source, type });
          applied.failure_id = failure ? failure.id : value;
        }
        continue;
      }

      if (key === 'failures' && Array.isArray(value)) {
        const recorded = [];
        for (const entry of value) {
          if (!entry) {
            continue;
          }
          const failureId = typeof entry === 'string'
            ? entry
            : entry.failure_id ?? entry.id ?? null;
          if (!failureId) {
            continue;
          }
          const note = typeof entry === 'object' ? entry.note ?? entry.reason ?? null : null;
          const metadata = typeof entry === 'object' ? entry : null;
          const failure = this.recordFailure(failureId, {
            getSeconds,
            source,
            type,
            note,
            metadata,
          });
          if (failure) {
            recorded.push(failure.id);
          }
        }
        if (recorded.length > 0) {
          applied.failures = recorded;
        }
        continue;
      }

      if (key === 'delta_v_margin_mps') {
        const deltaResult = this.#applyDeltaVMarginDelta(value, { getSeconds, source, type });
        if (deltaResult) {
          applied.delta_v_margin_mps = deltaResult;
        }
        continue;
      }

      if (key === 'delta_v') {
        const deltaObject = this.#applyDeltaVEffect(value, { getSeconds, source, type });
        if (deltaObject) {
          applied.delta_v = deltaObject;
        }
        continue;
      }

      const result = this.#applyValue(this.state, key, value, [], {
        getSeconds,
        source,
        type,
      });
      if (result !== undefined) {
        applied[key] = result;
      }
    }

    if (Object.keys(applied).length > 0) {
      this.logger?.log(getSeconds, `${type === 'failure' ? 'Failure' : 'Resource'} update from ${source}`, {
        type,
        source,
        applied,
      });
    }
  }

  recordFailure(
    failureId,
    { getSeconds = null, source = null, type = null, note = null, metadata = null } = {},
  ) {
    if (!failureId) {
      return null;
    }

    const id = String(failureId).trim();
    if (!id) {
      return null;
    }

    const timestamp = Number.isFinite(getSeconds) ? getSeconds : null;
    const timestampLabel = timestamp != null ? formatGET(timestamp) : null;
    const catalogEntry = this.failureCatalog.get(id) ?? null;
    let entry = this.failures.get(id);
    const isNew = !entry;

    if (!entry) {
      entry = {
        id,
        classification: catalogEntry?.classification ?? null,
        trigger: catalogEntry?.trigger ?? null,
        immediateEffect: catalogEntry?.immediate_effect ?? null,
        ongoingPenalty: catalogEntry?.ongoing_penalty ?? null,
        recoveryActions: catalogEntry?.recovery_actions ?? null,
        sourceRef: catalogEntry?.source_ref ?? null,
        firstTriggeredSeconds: timestamp,
        firstTriggered: timestampLabel,
        lastTriggeredSeconds: timestamp,
        lastTriggered: timestampLabel,
        occurrences: 0,
        sources: [],
        lastSource: source ?? null,
        lastType: type ?? null,
        notes: [],
        metadata: null,
      };
      this.failures.set(id, entry);
    }

    entry.occurrences += 1;
    if (timestamp != null) {
      entry.lastTriggeredSeconds = timestamp;
      entry.lastTriggered = timestampLabel;
      if (entry.firstTriggeredSeconds == null) {
        entry.firstTriggeredSeconds = timestamp;
        entry.firstTriggered = timestampLabel;
      }
    }

    if (source) {
      entry.lastSource = source;
      if (!entry.sources.includes(source)) {
        entry.sources.push(source);
      }
    }

    if (type) {
      entry.lastType = type;
    }

    if (note) {
      entry.notes.push(note);
    }

    if (metadata && typeof metadata === 'object') {
      entry.metadata = deepClone(metadata);
      if (!entry.classification && metadata.classification) {
        entry.classification = metadata.classification;
      }
      if (!entry.immediateEffect && metadata.immediate_effect) {
        entry.immediateEffect = metadata.immediate_effect;
      }
      if (!entry.ongoingPenalty && metadata.ongoing_penalty) {
        entry.ongoingPenalty = metadata.ongoing_penalty;
      }
      if (!entry.recoveryActions && metadata.recovery_actions) {
        entry.recoveryActions = metadata.recovery_actions;
      }
    }

    if (this.logger) {
      const logSeconds = timestamp ?? getSeconds ?? 0;
      const message = isNew ? `Failure latched ${id}` : `Failure ${id} repeated`;
      const payload = {
        failureId: id,
        classification: entry.classification ?? null,
        source: source ?? entry.lastSource ?? null,
        occurrences: entry.occurrences,
        firstTriggered: entry.firstTriggered ?? null,
        lastTriggered: entry.lastTriggered ?? null,
      };
      if (note) {
        payload.note = note;
      }
      this.logger.log(logSeconds, message, payload);
    }

    return entry;
  }

  update(dtSeconds, getSeconds) {
    const stable = this.isPtcStable();

    if (!stable) {
      this.state.power_margin_pct = Math.max(
        0,
        this.state.power_margin_pct - (DRIFT_RATES.powerPerSecond * dtSeconds),
      );
      this.state.cryo_boiloff_rate_pct_per_hr = Math.min(
        5,
        this.state.cryo_boiloff_rate_pct_per_hr + (DRIFT_RATES.cryoPerSecond * dtSeconds),
      );
    } else {
      this.state.power_margin_pct = Math.min(
        100,
        this.state.power_margin_pct + (RECOVERY_RATES.powerPerSecond * dtSeconds),
      );
      this.state.cryo_boiloff_rate_pct_per_hr = Math.max(
        0.5,
        this.state.cryo_boiloff_rate_pct_per_hr - (RECOVERY_RATES.cryoPerSecond * dtSeconds),
      );
    }

    this.#updateCommunications(getSeconds);
    this.#updateHistory(dtSeconds, getSeconds);

    this._logCountdown -= dtSeconds;
    if (this._logCountdown <= 0) {
      this.logger?.log(getSeconds, 'Resource snapshot', {
        snapshot: this.snapshot(),
      });
      this._logCountdown = this.options.logIntervalSeconds;
    }
  }

  recordPropellantUsage(tankKey, amountKg, { getSeconds = 0, source = 'manual_action', note = null } = {}) {
    if (!tankKey || !Number.isFinite(amountKg)) {
      return false;
    }

    const normalizedKey = tankKey.endsWith('_kg') ? tankKey : `${tankKey}_kg`;
    const previous = typeof this.state.propellant[normalizedKey] === 'number'
      ? this.state.propellant[normalizedKey]
      : null;

    if (previous == null) {
      this.logger?.log(getSeconds, `Propellant usage ignored for unknown tank ${normalizedKey}`, {
        source,
        note,
        attemptedDeltaKg: amountKg,
      });
      return false;
    }

    const delta = amountKg >= 0 ? -amountKg : Math.abs(amountKg);
    const next = Math.max(0, previous + delta);
    this.state.propellant[normalizedKey] = next;
    this.#recordPropellantDelta(normalizedKey, next - previous);
    this.#updateDerivedMetricsForPropellant(normalizedKey, {
      previous,
      next,
      getSeconds,
      source,
      note,
    });

    this.logger?.log(getSeconds, `Propellant update for ${normalizedKey} from ${source}`, {
      source,
      note,
      deltaKg: next - previous,
      remainingKg: next,
    });

    return true;
  }

  recordPowerLoadDelta(metricKey, deltaKw, { getSeconds = 0, source = 'manual_action', note = null } = {}) {
    if (!metricKey || !Number.isFinite(deltaKw)) {
      return false;
    }

    const normalizedKey = metricKey.endsWith('_kw') ? metricKey : `${metricKey}_kw`;
    if (typeof this.state.power[normalizedKey] !== 'number') {
      this.logger?.log(getSeconds, `Power load update ignored for unknown metric ${normalizedKey}`, {
        source,
        note,
        attemptedDeltaKw: deltaKw,
      });
      return false;
    }

    const previous = this.state.power[normalizedKey];
    const next = previous + deltaKw;
    this.state.power[normalizedKey] = next;
    this.metrics.powerDeltaKw[normalizedKey] = (this.metrics.powerDeltaKw[normalizedKey] ?? 0) + deltaKw;

    this.logger?.log(getSeconds, `Power load update for ${normalizedKey} from ${source}`, {
      source,
      note,
      deltaKw,
      newValueKw: next,
    });

    return true;
  }

  snapshot() {
    const state = deepClone(this.state);
    state.failures = Array.from(this.failures.values()).map((failure) => deepClone(failure));
    state.budgets = deepClone(this.budgets);
    state.metrics = this.metricsSnapshot();
    state.historyMeta = {
      enabled: this.historyOptions.enabled,
      sampleIntervalSeconds: this.historyOptions.sampleIntervalSeconds,
      durationSeconds: this.historyOptions.durationSeconds,
      maxSamples: this.historyCapacity,
      lastSampleSeconds: this._historyLastSampleSeconds,
      sampleCount: this.historyOptions.enabled && this.history
        ? Math.max(
            this.history.power.length,
            this.history.thermal.length,
            this.history.communications.length,
          )
        : 0,
    };
    return state;
  }

  metricsSnapshot() {
    return {
      propellantDeltaKg: { ...this.metrics.propellantDeltaKg },
      powerDeltaKw: { ...this.metrics.powerDeltaKw },
      deltaV: { ...this.metrics.deltaV },
    };
  }

  historySnapshot() {
    const meta = {
      enabled: this.historyOptions.enabled,
      sampleIntervalSeconds: this.historyOptions.sampleIntervalSeconds,
      durationSeconds: this.historyOptions.durationSeconds,
      maxSamples: this.historyCapacity,
      lastSampleSeconds: this._historyLastSampleSeconds,
    };

    if (!this.historyOptions.enabled || !this.history) {
      return {
        meta,
        power: [],
        thermal: [],
        communications: [],
        propellant: {},
      };
    }

    const snapshot = {
      meta,
      power: this.history.power.map((entry) => ({ ...entry })),
      thermal: this.history.thermal.map((entry) => ({ ...entry })),
      communications: this.history.communications.map((entry) => ({ ...entry })),
      propellant: {},
    };

    for (const [key, entries] of Object.entries(this.history.propellant)) {
      snapshot.propellant[key] = entries.map((entry) => ({ ...entry }));
    }

    return snapshot;
  }

  isPtcStable() {
    const state = this.state.thermal_balance_state ?? '';
    return state === 'PTC_STABLE' || state === 'PTC_TUNED';
  }

  #updateHistory(dtSeconds, getSeconds) {
    if (!this.historyOptions.enabled || !this.history) {
      return;
    }

    const interval = this.historyOptions.sampleIntervalSeconds;
    if (!Number.isFinite(interval) || interval <= 0) {
      return;
    }

    if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) {
      return;
    }

    this._historyAccumulator += dtSeconds;
    if (this._historyAccumulator < interval) {
      return;
    }

    const samples = Math.floor(this._historyAccumulator / interval);
    this._historyAccumulator -= samples * interval;
    const baseTime = Number.isFinite(getSeconds)
      ? getSeconds
      : this._historyLastSampleSeconds ?? 0;

    for (let i = samples; i >= 1; i -= 1) {
      const sampleTime = Math.max(0, baseTime - (i - 1) * interval);
      this.#recordHistorySample(sampleTime, { force: true });
    }
  }

  #recordHistorySample(getSeconds, { force = false } = {}) {
    if (!this.historyOptions.enabled || !this.history) {
      return;
    }

    const timestamp = Number.isFinite(getSeconds)
      ? getSeconds
      : this._historyLastSampleSeconds ?? 0;

    if (
      !force
      && this._historyLastSampleSeconds != null
      && Math.abs(timestamp - this._historyLastSampleSeconds) < 1e-6
    ) {
      return;
    }

    this._historyLastSampleSeconds = timestamp;
    this.#recordPowerHistory(timestamp);
    this.#recordThermalHistory(timestamp);
    this.#recordPropellantHistory(timestamp);
    this.#recordCommunicationsHistory(timestamp);
  }

  #recordPowerHistory(timeSeconds) {
    const entry = {
      timeSeconds,
      powerMarginPct: this.#coerceNumber(this.state.power_margin_pct),
      fuelCellLoadKw: this.#coerceNumber(this.state.power?.fuel_cell_load_kw),
      fuelCellOutputKw: this.#coerceNumber(this.state.power?.fuel_cell_output_kw),
      batteryChargePct: this.#coerceNumber(this.state.power?.battery_charge_pct),
      reactantMinutes: this.#coerceNumber(this.state.power?.reactant_minutes_remaining),
    };
    this.#pushHistoryEntry(this.history.power, entry);
  }

  #recordThermalHistory(timeSeconds) {
    const entry = {
      timeSeconds,
      cryoBoiloffRatePctPerHr: this.#coerceNumber(this.state.cryo_boiloff_rate_pct_per_hr),
      thermalState: this.state.thermal_balance_state ?? null,
      ptcActive: this.state.ptc_active ?? null,
    };
    this.#pushHistoryEntry(this.history.thermal, entry);
  }

  #recordCommunicationsHistory(timeSeconds) {
    const comms = this.state.communications ?? {};
    const entry = {
      timeSeconds,
      active: Boolean(comms.active),
      currentPassId: comms.current_pass_id ?? null,
      currentStation: comms.current_station ?? null,
      timeRemainingSeconds: this.#coerceNumber(comms.current_window_time_remaining_s),
      timeSinceOpenSeconds: this.#coerceNumber(comms.time_since_window_open_s),
      progress: this.#coerceNumber(comms.current_pass_progress),
      nextPassId: comms.next_pass_id ?? null,
      timeUntilNextWindowSeconds: this.#coerceNumber(comms.time_until_next_window_s),
      signalStrengthDb: this.#coerceNumber(comms.signal_strength_db),
      downlinkRateKbps: this.#coerceNumber(comms.downlink_rate_kbps),
      powerLoadDeltaKw: this.#coerceNumber(comms.power_load_delta_kw),
    };
    this.#pushHistoryEntry(this.history.communications, entry);
  }

  #recordPropellantHistory(timeSeconds) {
    const propellantState = this.state.propellant ?? {};
    const budgets = this.budgets?.propellant ?? {};

    for (const [rawKey, rawValue] of Object.entries(propellantState)) {
      const key = this.#normalizePropellantKey(rawKey);
      if (!key) {
        continue;
      }

      if (!this.history.propellant[key]) {
        this.history.propellant[key] = [];
      }

      const remainingKg = this.#coerceNumber(rawValue);
      const budget = budgets[key] ?? {};
      const initialKg = this.#coerceNumber(budget.initial_kg);
      const reserveKg = this.#coerceNumber(budget.reserve_kg);

      const entry = {
        timeSeconds,
        remainingKg: Number.isFinite(remainingKg) ? remainingKg : null,
        initialKg: Number.isFinite(initialKg) ? initialKg : null,
        reserveKg: Number.isFinite(reserveKg) ? reserveKg : null,
      };

      if (Number.isFinite(entry.remainingKg) && Number.isFinite(entry.initialKg) && entry.initialKg > 0) {
        entry.percentRemaining = (entry.remainingKg / entry.initialKg) * 100;
      } else {
        entry.percentRemaining = null;
      }

      if (
        Number.isFinite(entry.remainingKg)
        && Number.isFinite(entry.initialKg)
        && Number.isFinite(entry.reserveKg)
        && entry.initialKg > entry.reserveKg
      ) {
        const usable = entry.initialKg - entry.reserveKg;
        entry.percentAboveReserve = usable > 0
          ? Math.max(0, entry.remainingKg - entry.reserveKg) / usable * 100
          : null;
      } else {
        entry.percentAboveReserve = null;
      }

      this.#pushHistoryEntry(this.history.propellant[key], entry);
    }
  }

  #pushHistoryEntry(buffer, entry) {
    if (!Array.isArray(buffer)) {
      return;
    }
    buffer.push(entry);
    if (this.historyCapacity > 0 && buffer.length > this.historyCapacity) {
      buffer.splice(0, buffer.length - this.historyCapacity);
    }
  }

  #normalizePropellantKey(key) {
    if (typeof key !== 'string' || key.length === 0) {
      return null;
    }
    return key.endsWith('_kg') ? key.slice(0, -3) : key;
  }

  #assignPropellantBudget(key, initialKg) {
    if (!Number.isFinite(initialKg)) {
      return;
    }
    if (!this.state.propellant || typeof this.state.propellant !== 'object') {
      this.state.propellant = {};
    }
    this.state.propellant[key] = initialKg;
  }

  #applyValue(target, key, value, path, context) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const container = typeof target[key] === 'object' && target[key] !== null
        ? target[key]
        : {};
      target[key] = container;
      const nested = {};
      for (const [nestedKey, nestedValue] of Object.entries(value)) {
        const result = this.#applyValue(container, nestedKey, nestedValue, [...path, key], context);
        if (result !== undefined) {
          nested[nestedKey] = result;
        }
      }
      if (Object.keys(nested).length === 0) {
        return undefined;
      }
      return nested;
    }

    if (typeof value === 'number') {
      const previous = typeof target[key] === 'number' ? target[key] : 0;
      const next = previous + value;
      target[key] = next;
      this.#recordDelta(path, key, value);
      this.#handleNumericUpdate(path, key, previous, next, context);
      return { value: next, delta: value };
    }

    if (value !== undefined) {
      target[key] = value;
      return { value };
    }

    return undefined;
  }

  #recordDelta(path, key, delta) {
    const root = path[0];
    if (!root) {
      return;
    }

    if (root === 'propellant') {
      const tankKey = key.endsWith('_kg') ? key : `${key}_kg`;
      this.#recordPropellantDelta(tankKey, delta);
      return;
    }

    if (root === 'power' && key.endsWith('_kw')) {
      this.metrics.powerDeltaKw[key] = (this.metrics.powerDeltaKw[key] ?? 0) + delta;
    }
  }

  #recordPropellantDelta(tankKey, delta) {
    this.metrics.propellantDeltaKg[tankKey] = (this.metrics.propellantDeltaKg[tankKey] ?? 0) + delta;
  }

  #configurePropellantBudgets(propellant) {
    this.propellantConfig = Object.create(null);
    this.deltaVStageByTank = Object.create(null);

    const propellantData = propellant && typeof propellant === 'object' ? propellant : {};

    for (const stage of DELTA_V_STAGE_CONFIG) {
      const rawStage = propellantData[stage.id] ?? {};
      const initialKg = this.#coerceNumber(rawStage.initial_kg);
      const reserveKg = this.#coerceNumber(rawStage.reserve_kg);
      const usableDeltaVMps = this.#coerceNumber(rawStage.usable_delta_v_mps);

      this.propellantConfig[stage.id] = {
        initialKg,
        reserveKg,
        usableDeltaVMps,
        tankKey: stage.tankKey,
        label: stage.label,
      };

      if (stage.tankKey) {
        this.deltaVStageByTank[stage.tankKey] = stage.id;
        this.#assignPropellantBudget(stage.tankKey, rawStage.initial_kg);
      }

      this.#ensureDeltaVStage(stage.id, {
        usableDeltaVMps,
        label: stage.label,
        tankKey: stage.tankKey,
      });
    }

    this.#assignPropellantBudget('csm_rcs_kg', propellantData.csm_rcs?.initial_kg);
    this.#assignPropellantBudget('lm_rcs_kg', propellantData.lm_rcs?.initial_kg);

    for (const [key, value] of Object.entries(propellantData)) {
      if (DELTA_V_STAGE_CONFIG.some((stage) => stage.id === key)) {
        continue;
      }
      const tankKey = `${key}_kg`;
      this.#assignPropellantBudget(tankKey, value?.initial_kg);
    }

    this.#recalculateDeltaVFromPropellant();
  }

  #ensureDeltaVState() {
    if (!this.state.delta_v || typeof this.state.delta_v !== 'object') {
      this.state.delta_v = {
        total: {
          base_mps: 0,
          adjustment_mps: 0,
          margin_mps: 0,
          usable_delta_v_mps: 0,
        },
        stages: {},
      };
    }

    if (!this.state.delta_v.total || typeof this.state.delta_v.total !== 'object') {
      this.state.delta_v.total = {
        base_mps: 0,
        adjustment_mps: 0,
        margin_mps: 0,
        usable_delta_v_mps: 0,
      };
    }

    if (!this.state.delta_v.stages || typeof this.state.delta_v.stages !== 'object') {
      this.state.delta_v.stages = {};
    }

    return this.state.delta_v;
  }

  #ensureDeltaVStage(stageId, { usableDeltaVMps = null, label = null, tankKey = null } = {}) {
    if (!stageId) {
      return null;
    }

    const container = this.#ensureDeltaVState();
    if (!container.stages[stageId] || typeof container.stages[stageId] !== 'object') {
      container.stages[stageId] = {
        id: stageId,
        base_mps: 0,
        adjustment_mps: 0,
        margin_mps: 0,
        usable_delta_v_mps: Number.isFinite(usableDeltaVMps) ? usableDeltaVMps : null,
        label: label ?? null,
        tank: tankKey ?? null,
      };
      return container.stages[stageId];
    }

    const stage = container.stages[stageId];
    const coerce = (value) => {
      const numeric = this.#coerceNumber(value);
      return typeof numeric === 'number' ? numeric : 0;
    };
    stage.base_mps = coerce(stage.base_mps);
    stage.adjustment_mps = coerce(stage.adjustment_mps);
    stage.margin_mps = coerce(stage.margin_mps);
    if (Number.isFinite(usableDeltaVMps)) {
      stage.usable_delta_v_mps = usableDeltaVMps;
    } else if (!Number.isFinite(stage.usable_delta_v_mps)) {
      stage.usable_delta_v_mps = null;
    }
    if (label && !stage.label) {
      stage.label = label;
    }
    if (tankKey && !stage.tank) {
      stage.tank = tankKey;
    }
    return stage;
  }

  #resolveDeltaVStageLabel(stageId) {
    if (!stageId) {
      return 'delta-v stage';
    }
    const config = this.propellantConfig?.[stageId];
    if (config?.label) {
      return config.label;
    }
    const stage = this.state.delta_v?.stages?.[stageId];
    if (stage?.label) {
      return stage.label;
    }
    return stageId;
  }

  #calculateStageBaseDeltaV(amountKg, config) {
    if (!config) {
      return 0;
    }

    const initialKg = this.#coerceNumber(config.initialKg);
    const reserveKg = this.#coerceNumber(config.reserveKg);
    const usableDeltaVMps = this.#coerceNumber(config.usableDeltaVMps);
    if (typeof initialKg !== 'number' || typeof reserveKg !== 'number' || typeof usableDeltaVMps !== 'number') {
      return 0;
    }

    const usableKg = initialKg - reserveKg;
    if (!(usableKg > 0)) {
      return 0;
    }

    const current = this.#coerceNumber(amountKg);
    if (typeof current !== 'number') {
      return 0;
    }

    const remainingAboveReserve = Math.max(0, current - reserveKg);
    const fraction = Math.max(0, Math.min(1, remainingAboveReserve / usableKg));
    return fraction * usableDeltaVMps;
  }

  #clampDeltaV(value, max) {
    const numeric = this.#coerceNumber(value);
    if (typeof numeric !== 'number') {
      return 0;
    }

    const maxNumeric = this.#coerceNumber(max);
    let result = numeric;
    if (typeof maxNumeric === 'number' && maxNumeric >= 0) {
      result = Math.min(maxNumeric, numeric);
    }
    return Math.max(0, result);
  }

  #recalculateTotalDeltaV() {
    const container = this.#ensureDeltaVState();

    let totalBase = 0;
    let totalAdjustment = 0;
    let totalMargin = 0;
    let totalUsable = 0;

    for (const [stageId, stage] of Object.entries(container.stages)) {
      if (!stage || typeof stage !== 'object') {
        continue;
      }

      const base = this.#coerceNumber(stage.base_mps);
      const adjustment = this.#coerceNumber(stage.adjustment_mps);
      const usable = this.#coerceNumber(stage.usable_delta_v_mps);
      const margin = this.#coerceNumber(stage.margin_mps);

      const baseValue = typeof base === 'number' ? base : 0;
      const adjustmentValue = typeof adjustment === 'number' ? adjustment : 0;
      const marginValue = typeof margin === 'number'
        ? margin
        : this.#clampDeltaV(baseValue + adjustmentValue, usable);

      stage.base_mps = baseValue;
      stage.adjustment_mps = adjustmentValue;
      stage.margin_mps = marginValue;
      if (typeof usable === 'number' && usable >= 0) {
        stage.usable_delta_v_mps = usable;
        totalUsable += usable;
      } else if (typeof stage.usable_delta_v_mps === 'number' && stage.usable_delta_v_mps >= 0) {
        totalUsable += stage.usable_delta_v_mps;
      }

      totalBase += baseValue;
      totalAdjustment += adjustmentValue;
      totalMargin += marginValue;
    }

    container.total.base_mps = totalBase;
    container.total.adjustment_mps = totalAdjustment;
    container.total.margin_mps = totalMargin;
    container.total.usable_delta_v_mps = totalUsable;
    this.state.delta_v_margin_mps = totalMargin;
    return container.total;
  }

  #recalculateDeltaVFromPropellant() {
    const propellantState = this.state.propellant ?? {};

    for (const stage of DELTA_V_STAGE_CONFIG) {
      const config = this.propellantConfig?.[stage.id];
      if (!config) {
        continue;
      }

      const stageState = this.#ensureDeltaVStage(stage.id, {
        usableDeltaVMps: config.usableDeltaVMps,
        label: config.label,
        tankKey: config.tankKey,
      });

      const amountKg = stage.tankKey ? propellantState[stage.tankKey] : null;
      const base = this.#calculateStageBaseDeltaV(amountKg, config);
      const currentAdjustment = this.#coerceNumber(stageState.adjustment_mps);
      const adjustmentValue = typeof currentAdjustment === 'number' ? currentAdjustment : 0;
      const margin = this.#clampDeltaV(base + adjustmentValue, config.usableDeltaVMps);

      stageState.base_mps = base;
      stageState.margin_mps = margin;
      stageState.adjustment_mps = margin - base;
      stageState.usable_delta_v_mps = Number.isFinite(config.usableDeltaVMps)
        ? config.usableDeltaVMps
        : stageState.usable_delta_v_mps ?? null;
      if (!stageState.label && config.label) {
        stageState.label = config.label;
      }
      if (!stageState.tank && config.tankKey) {
        stageState.tank = config.tankKey;
      }
    }

    this.#recalculateTotalDeltaV();
  }

  #handleNumericUpdate(path, key, previous, next, context = {}) {
    if (!Array.isArray(path) || path.length === 0) {
      return;
    }

    if (path[0] !== 'propellant') {
      return;
    }

    const normalizedKey = key.endsWith('_kg') ? key : `${key}_kg`;
    this.#updateDerivedMetricsForPropellant(normalizedKey, {
      previous,
      next,
      getSeconds: context?.getSeconds ?? 0,
      source: context?.source ?? 'effect',
      note: context?.type ?? null,
    });
  }

  #updateDerivedMetricsForPropellant(tankKey, { previous, next, getSeconds, source, note }) {
    const stageId = this.deltaVStageByTank?.[tankKey];
    if (!stageId) {
      return;
    }

    const config = this.propellantConfig?.[stageId];
    if (!config) {
      return;
    }

    const stageState = this.#ensureDeltaVStage(stageId, {
      usableDeltaVMps: config.usableDeltaVMps,
      label: config.label,
      tankKey: config.tankKey,
    });

    const previousBase = this.#calculateStageBaseDeltaV(previous, config);
    const nextBase = this.#calculateStageBaseDeltaV(next, config);
    const adjustment = this.#coerceNumber(stageState.adjustment_mps);
    const adjustmentValue = typeof adjustment === 'number' ? adjustment : 0;
    const previousMargin = this.#clampDeltaV(previousBase + adjustmentValue, config.usableDeltaVMps);
    const nextMargin = this.#clampDeltaV(nextBase + adjustmentValue, config.usableDeltaVMps);

    stageState.base_mps = nextBase;
    stageState.margin_mps = nextMargin;
    stageState.adjustment_mps = nextMargin - nextBase;
    stageState.usable_delta_v_mps = Number.isFinite(config.usableDeltaVMps)
      ? config.usableDeltaVMps
      : stageState.usable_delta_v_mps ?? null;

    this.#recalculateTotalDeltaV();

    const deltaMargin = nextMargin - previousMargin;
    this.#recordDeltaVMarginChange(stageId, deltaMargin, {
      getSeconds,
      source,
      note,
      reason: 'propellant_change',
    });
  }

  #recordDeltaVMarginChange(stageId, deltaMargin, { getSeconds = 0, source = 'effect', note = null, reason = null } = {}) {
    if (!Number.isFinite(deltaMargin) || Math.abs(deltaMargin) <= (this.options.epsilon ?? 1e-6)) {
      return;
    }

    if (deltaMargin < 0) {
      this.metrics.deltaV.usedMps += -deltaMargin;
    } else if (deltaMargin > 0) {
      this.metrics.deltaV.recoveredMps += deltaMargin;
    }

    const label = this.#resolveDeltaVStageLabel(stageId);
    const message = reason === 'propellant_change'
      ? `Delta-v margin updated for ${label} propellant change`
      : `Delta-v margin adjusted for ${label}`;

    this.logger?.log(getSeconds, message, {
      source,
      note,
      stage: stageId,
      deltaVMps: deltaMargin,
      newMarginMps: this.state.delta_v?.stages?.[stageId]?.margin_mps ?? null,
      baseMps: this.state.delta_v?.stages?.[stageId]?.base_mps ?? null,
      adjustmentMps: this.state.delta_v?.stages?.[stageId]?.adjustment_mps ?? null,
      totalMarginMps: this.state.delta_v_margin_mps,
      reason,
    });
  }

  #adjustDeltaVStage(stageId, deltaMps, context = {}) {
    const delta = this.#coerceNumber(deltaMps);
    if (!stageId || typeof delta !== 'number' || delta === 0) {
      return null;
    }

    const config = this.propellantConfig?.[stageId] ?? null;
    const stageState = this.#ensureDeltaVStage(stageId, {
      usableDeltaVMps: config?.usableDeltaVMps,
      label: config?.label,
      tankKey: config?.tankKey,
    });

    const base = this.#coerceNumber(stageState.base_mps);
    const currentBase = typeof base === 'number' ? base : 0;
    const adjustment = this.#coerceNumber(stageState.adjustment_mps);
    const previousAdjustment = typeof adjustment === 'number' ? adjustment : 0;
    const usable = config?.usableDeltaVMps ?? stageState.usable_delta_v_mps ?? null;
    const previousMarginValue = this.#clampDeltaV(currentBase + previousAdjustment, usable);

    const margin = this.#clampDeltaV(currentBase + previousAdjustment + delta, usable);
    const newAdjustment = margin - currentBase;

    stageState.base_mps = currentBase;
    stageState.margin_mps = margin;
    stageState.adjustment_mps = newAdjustment;
    if (Number.isFinite(config?.usableDeltaVMps)) {
      stageState.usable_delta_v_mps = config.usableDeltaVMps;
    }

    this.state.delta_v.stages[stageId] = stageState;
    this.#recalculateTotalDeltaV();

    const actualDelta = margin - previousMarginValue;
    this.#recordDeltaVMarginChange(stageId, actualDelta, {
      getSeconds: context?.getSeconds ?? 0,
      source: context?.source ?? 'effect',
      note: context?.type ?? null,
      reason: 'adjustment',
    });

    return {
      stage: stageId,
      deltaMps: actualDelta,
      newMarginMps: margin,
      adjustmentMps: newAdjustment,
      baseMps: currentBase,
      totalMarginMps: this.state.delta_v_margin_mps,
    };
  }

  #getPrimaryDeltaVStageId() {
    if (this.propellantConfig?.csm_sps) {
      return 'csm_sps';
    }

    for (const stage of DELTA_V_STAGE_CONFIG) {
      if (this.propellantConfig?.[stage.id]) {
        return stage.id;
      }
    }

    const stages = this.state.delta_v?.stages ?? {};
    const keys = Object.keys(stages);
    return keys.length > 0 ? keys[0] : null;
  }

  #applyDeltaVMarginDelta(delta, context = {}) {
    const normalized = this.#coerceNumber(delta);
    if (typeof normalized !== 'number' || normalized === 0) {
      return undefined;
    }

    const stageId = this.#getPrimaryDeltaVStageId();
    if (!stageId) {
      return undefined;
    }

    return this.#adjustDeltaVStage(stageId, normalized, context);
  }

  #extractDeltaVAdjustment(value) {
    if (value == null) {
      return null;
    }
    if (typeof value === 'number' || typeof value === 'string') {
      const numeric = this.#coerceNumber(value);
      return typeof numeric === 'number' ? numeric : null;
    }
    if (typeof value !== 'object') {
      return null;
    }
    if (value.adjustment_mps != null) {
      const numeric = this.#coerceNumber(value.adjustment_mps);
      return typeof numeric === 'number' ? numeric : null;
    }
    if (value.delta_mps != null) {
      const numeric = this.#coerceNumber(value.delta_mps);
      return typeof numeric === 'number' ? numeric : null;
    }
    if (value.delta != null) {
      const numeric = this.#coerceNumber(value.delta);
      return typeof numeric === 'number' ? numeric : null;
    }
    return null;
  }

  #applyDeltaVEffect(value, context = {}) {
    if (!value || typeof value !== 'object') {
      return undefined;
    }

    const updates = [];
    const processStage = (stageId, stageValue) => {
      const delta = this.#extractDeltaVAdjustment(stageValue);
      if (typeof delta !== 'number' || delta === 0) {
        return;
      }
      const result = this.#adjustDeltaVStage(stageId, delta, context);
      if (result) {
        updates.push(result);
      }
    };

    if (value.stages && typeof value.stages === 'object') {
      for (const [stageId, stageValue] of Object.entries(value.stages)) {
        processStage(stageId, stageValue);
      }
    }

    if (value.adjustments && typeof value.adjustments === 'object') {
      for (const [stageId, stageValue] of Object.entries(value.adjustments)) {
        processStage(stageId, stageValue);
      }
    }

    for (const [key, stageValue] of Object.entries(value)) {
      if (key === 'stages' || key === 'adjustments' || key === 'total') {
        continue;
      }
      processStage(key, stageValue);
    }

    if (updates.length === 0) {
      return undefined;
    }

    return {
      stages: updates,
      total: {
        marginMps: this.state.delta_v_margin_mps,
        baseMps: this.state.delta_v?.total?.base_mps ?? null,
        adjustmentMps: this.state.delta_v?.total?.adjustment_mps ?? null,
      },
    };
  }

  #normalizeCommunicationsSchedule(schedule) {
    if (!Array.isArray(schedule)) {
      return [];
    }

    const normalized = [];
    for (const entry of schedule) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }

      const idRaw = entry.id ?? entry.pass_id ?? entry.comm_id ?? null;
      const id = typeof idRaw === 'string' ? idRaw.trim() : null;
      if (!id) {
        continue;
      }

      const openSeconds = this.#parseGetSeconds(
        entry.getOpenSeconds ?? entry.get_open ?? entry.getOpen ?? entry.open_get ?? entry.openSeconds,
      );
      const closeSeconds = this.#parseGetSeconds(
        entry.getCloseSeconds ?? entry.get_close ?? entry.getClose ?? entry.close_get ?? entry.closeSeconds,
      );

      if (!Number.isFinite(openSeconds) || !Number.isFinite(closeSeconds) || closeSeconds <= openSeconds) {
        continue;
      }

      const durationSeconds = closeSeconds - openSeconds;
      const openLabel = typeof entry.get_open === 'string'
        ? entry.get_open
        : typeof entry.getOpen === 'string'
          ? entry.getOpen
          : formatGET(openSeconds);
      const closeLabel = typeof entry.get_close === 'string'
        ? entry.get_close
        : typeof entry.getClose === 'string'
          ? entry.getClose
          : formatGET(closeSeconds);

      normalized.push({
        id,
        station: entry.station ?? null,
        nextStation: entry.next_station ?? entry.nextStation ?? null,
        getOpenSeconds: openSeconds,
        getCloseSeconds: closeSeconds,
        durationSeconds,
        openLabel,
        closeLabel,
        signalStrengthDb: this.#coerceNumber(entry.signal_strength_db ?? entry.signalStrengthDb),
        handoverMinutes: this.#coerceNumber(entry.handover_minutes ?? entry.handoverMinutes),
        downlinkRateKbps: this.#coerceNumber(entry.downlink_rate_kbps ?? entry.downlinkRateKbps),
        powerMarginDeltaKw: this.#coerceNumber(entry.power_margin_delta_kw ?? entry.powerMarginDeltaKw),
        notes: entry.notes ?? null,
        source: entry.source ?? entry.source_ref ?? null,
      });
    }

    normalized.sort((a, b) => a.getOpenSeconds - b.getOpenSeconds);
    return normalized;
  }

  #parseGetSeconds(value) {
    if (Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = parseGET(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
      const numeric = Number(value.trim());
      return Number.isFinite(numeric) ? numeric : null;
    }
    return null;
  }

  #updateCommunications(getSeconds) {
    if (!Array.isArray(this.communicationsSchedule) || this.communicationsSchedule.length === 0) {
      return;
    }

    const activePass = this.#findActiveCommunicationsPass(getSeconds);
    const currentId = this.activeCommunicationsPass?.id ?? null;

    if (!activePass && currentId) {
      this.#exitCommunicationsPass(getSeconds);
    }

    if (activePass && activePass.id !== currentId) {
      if (currentId) {
        this.#exitCommunicationsPass(getSeconds);
      }
      this.#enterCommunicationsPass(activePass, getSeconds);
    }

    if (activePass) {
      this.#updateActiveCommunicationsPass(activePass, getSeconds);
    }

    this.#updateNextCommunicationsPass(getSeconds);
  }

  #findActiveCommunicationsPass(getSeconds) {
    for (const pass of this.communicationsSchedule) {
      if (
        Number.isFinite(pass.getOpenSeconds)
        && Number.isFinite(pass.getCloseSeconds)
        && getSeconds >= pass.getOpenSeconds
        && getSeconds < pass.getCloseSeconds
      ) {
        return pass;
      }
    }
    return null;
  }

  #findNextCommunicationsPass(getSeconds) {
    for (const pass of this.communicationsSchedule) {
      if (Number.isFinite(pass.getOpenSeconds) && pass.getOpenSeconds > getSeconds) {
        return pass;
      }
    }
    return null;
  }

  #enterCommunicationsPass(pass, getSeconds) {
    this.activeCommunicationsPass = pass;
    this.activeCommunicationsPowerDeltaKw = 0;

    const comms = this.state.communications;
    comms.active = true;
    comms.current_pass_id = pass.id;
    comms.current_station = pass.station ?? null;
    comms.current_next_station = pass.nextStation ?? null;
    comms.current_window_open_seconds = pass.getOpenSeconds;
    comms.current_window_close_seconds = pass.getCloseSeconds;
    comms.current_window_open_get = pass.openLabel ?? formatGET(pass.getOpenSeconds);
    comms.current_window_close_get = pass.closeLabel ?? formatGET(pass.getCloseSeconds);
    comms.current_pass_duration_s = pass.durationSeconds ?? (pass.getCloseSeconds - pass.getOpenSeconds);
    comms.signal_strength_db = pass.signalStrengthDb ?? null;
    comms.downlink_rate_kbps = pass.downlinkRateKbps ?? null;
    comms.handover_minutes = pass.handoverMinutes ?? null;
    comms.power_margin_delta_kw = pass.powerMarginDeltaKw ?? null;
    comms.power_load_delta_kw = 0;

    const loadDelta = this.#resolvePowerLoadDelta(pass);
    if (Number.isFinite(loadDelta) && loadDelta !== 0) {
      this.recordPowerLoadDelta('fuel_cell_load', loadDelta, {
        getSeconds,
        source: 'communications',
        note: pass.id,
      });
      this.activeCommunicationsPowerDeltaKw = loadDelta;
      comms.power_load_delta_kw = loadDelta;
    }

    this.#updateActiveCommunicationsPass(pass, getSeconds);

    this.logger?.log(getSeconds, `Communications pass ${pass.id} active`, {
      station: pass.station ?? null,
      window: `${comms.current_window_open_get} → ${comms.current_window_close_get}`,
      signalStrengthDb: pass.signalStrengthDb ?? null,
      downlinkRateKbps: pass.downlinkRateKbps ?? null,
    });

    if (this.historyOptions.enabled) {
      this.#recordHistorySample(getSeconds, { force: true });
    }
  }

  #updateActiveCommunicationsPass(pass, getSeconds) {
    const comms = this.state.communications;
    const timeRemaining = Math.max(0, pass.getCloseSeconds - getSeconds);
    const elapsed = Math.max(0, getSeconds - pass.getOpenSeconds);
    const duration = pass.durationSeconds ?? (pass.getCloseSeconds - pass.getOpenSeconds);
    const progress = duration > 0 ? Math.min(1, elapsed / duration) : null;

    comms.current_window_time_remaining_s = timeRemaining;
    comms.time_since_window_open_s = elapsed;
    comms.current_pass_progress = progress;
  }

  #exitCommunicationsPass(getSeconds) {
    if (!this.activeCommunicationsPass) {
      return;
    }

    if (Number.isFinite(this.activeCommunicationsPowerDeltaKw) && this.activeCommunicationsPowerDeltaKw !== 0) {
      this.recordPowerLoadDelta('fuel_cell_load', -this.activeCommunicationsPowerDeltaKw, {
        getSeconds,
        source: 'communications',
        note: `${this.activeCommunicationsPass.id}_restore`,
      });
    }

    this.logger?.log(getSeconds, `Communications pass ${this.activeCommunicationsPass.id} complete`, {
      station: this.activeCommunicationsPass.station ?? null,
    });

    this.activeCommunicationsPass = null;
    this.activeCommunicationsPowerDeltaKw = 0;
    this.#clearCurrentCommunicationsState();

    if (this.historyOptions.enabled) {
      this.#recordHistorySample(getSeconds, { force: true });
    }
  }

  #updateNextCommunicationsPass(getSeconds) {
    const nextPass = this.#findNextCommunicationsPass(getSeconds);
    const comms = this.state.communications;

    if (nextPass) {
      comms.next_pass_id = nextPass.id;
      comms.next_station = nextPass.station ?? null;
      comms.next_window_open_seconds = nextPass.getOpenSeconds;
      comms.next_window_open_get = nextPass.openLabel ?? formatGET(nextPass.getOpenSeconds);
      comms.time_until_next_window_s = Math.max(0, nextPass.getOpenSeconds - getSeconds);
    } else {
      comms.next_pass_id = null;
      comms.next_station = null;
      comms.next_window_open_seconds = null;
      comms.next_window_open_get = null;
      comms.time_until_next_window_s = null;
    }
  }

  #clearCurrentCommunicationsState() {
    const comms = this.state.communications;
    comms.active = false;
    comms.current_pass_id = null;
    comms.current_station = null;
    comms.current_next_station = null;
    comms.current_window_open_get = null;
    comms.current_window_close_get = null;
    comms.current_window_open_seconds = null;
    comms.current_window_close_seconds = null;
    comms.current_window_time_remaining_s = null;
    comms.current_pass_duration_s = null;
    comms.current_pass_progress = null;
    comms.time_since_window_open_s = null;
    comms.signal_strength_db = null;
    comms.downlink_rate_kbps = null;
    comms.handover_minutes = null;
    comms.power_margin_delta_kw = null;
    comms.power_load_delta_kw = 0;
  }

  #resolvePowerLoadDelta(pass) {
    if (!pass) {
      return 0;
    }
    const marginDelta = this.#coerceNumber(pass.powerMarginDeltaKw);
    if (!Number.isFinite(marginDelta) || marginDelta === 0) {
      return 0;
    }
    return -marginDelta;
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
