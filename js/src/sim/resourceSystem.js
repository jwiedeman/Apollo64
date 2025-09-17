const DEFAULT_STATE = {
  power_margin_pct: 100,
  cryo_boiloff_rate_pct_per_hr: 1.0,
  thermal_balance_state: 'UNINITIALIZED',
  ptc_active: false,
  delta_v_margin_mps: 0,
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
    next_window_open_get: null,
    last_pad_id: null,
  },
};

const DEFAULT_OPTIONS = {
  logIntervalSeconds: 3600,
};

const DRIFT_RATES = {
  powerPerSecond: 0.8 / 3600, // % per second when PTC is off
  cryoPerSecond: 0.02 / 3600, // % per second when PTC is off
};

const RECOVERY_RATES = {
  powerPerSecond: 0.4 / 3600,
  cryoPerSecond: 0.015 / 3600,
};

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
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.state = deepMerge(deepClone(DEFAULT_STATE), options.initialState ?? {});
    this.failures = new Set();
    this.metrics = {
      propellantDeltaKg: Object.create(null),
      powerDeltaKw: Object.create(null),
      deltaV: {
        usedMps: 0,
        recoveredMps: 0,
      },
    };
    this.budgets = {};
    this.propellantConfig = {
      csm_sps: null,
    };
    this._logCountdown = this.options.logIntervalSeconds;

    if (options.consumables) {
      this.configureConsumables(options.consumables);
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

  applyEffect(effect, { getSeconds, source, type }) {
    if (!effect || Object.keys(effect).length === 0) {
      return;
    }

    const applied = {};

    for (const [key, value] of Object.entries(effect)) {
      if (key === 'failure_id') {
        if (value) {
          this.failures.add(value);
          applied.failure_id = value;
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
    state.failures = Array.from(this.failures.values());
    state.budgets = deepClone(this.budgets);
    state.metrics = this.metricsSnapshot();
    return state;
  }

  metricsSnapshot() {
    return {
      propellantDeltaKg: { ...this.metrics.propellantDeltaKg },
      powerDeltaKw: { ...this.metrics.powerDeltaKw },
      deltaV: { ...this.metrics.deltaV },
    };
  }

  isPtcStable() {
    const state = this.state.thermal_balance_state ?? '';
    return state === 'PTC_STABLE' || state === 'PTC_TUNED';
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
    const csmSps = propellant.csm_sps ?? {};
    const initialSpsKg = this.#coerceNumber(csmSps.initial_kg);
    const reserveSpsKg = this.#coerceNumber(csmSps.reserve_kg);
    const usableDeltaVMps = this.#coerceNumber(csmSps.usable_delta_v_mps);

    if (Number.isFinite(usableDeltaVMps)) {
      this.state.delta_v_margin_mps = usableDeltaVMps;
    }

    this.propellantConfig.csm_sps = {
      initialKg: initialSpsKg,
      reserveKg: reserveSpsKg,
      usableDeltaVMps,
    };

    this.#assignPropellantBudget('csm_sps_kg', csmSps.initial_kg);
    this.#assignPropellantBudget('csm_rcs_kg', propellant.csm_rcs?.initial_kg);
    this.#assignPropellantBudget('lm_descent_kg', propellant.lm_descent?.initial_kg);
    this.#assignPropellantBudget('lm_ascent_kg', propellant.lm_ascent?.initial_kg);
    this.#assignPropellantBudget('lm_rcs_kg', propellant.lm_rcs?.initial_kg);

    this.#recalculateDeltaVFromPropellant();
  }

  #recalculateDeltaVFromPropellant() {
    const config = this.propellantConfig.csm_sps;
    if (!config) {
      return;
    }

    const { initialKg, reserveKg, usableDeltaVMps } = config;
    if (!Number.isFinite(initialKg) || !Number.isFinite(reserveKg) || !Number.isFinite(usableDeltaVMps)) {
      return;
    }

    const usableKg = initialKg - reserveKg;
    if (!(usableKg > 0)) {
      return;
    }

    const current = this.#coerceNumber(this.state.propellant?.csm_sps_kg);
    if (!Number.isFinite(current)) {
      return;
    }

    const remainingAboveReserve = Math.max(0, current - reserveKg);
    const fraction = Math.max(0, Math.min(1, remainingAboveReserve / usableKg));
    this.state.delta_v_margin_mps = fraction * usableDeltaVMps;
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
    if (tankKey !== 'csm_sps_kg') {
      return;
    }

    const config = this.propellantConfig.csm_sps;
    if (!config) {
      return;
    }

    const { initialKg, reserveKg, usableDeltaVMps } = config;
    if (!Number.isFinite(initialKg) || !Number.isFinite(reserveKg) || !Number.isFinite(usableDeltaVMps)) {
      return;
    }

    const usableKg = initialKg - reserveKg;
    if (!(usableKg > 0)) {
      return;
    }

    const previousAboveReserve = Math.max(0, previous - reserveKg);
    const nextAboveReserve = Math.max(0, next - reserveKg);
    const fractionBefore = Math.max(0, Math.min(1, previousAboveReserve / usableKg));
    const fractionAfter = Math.max(0, Math.min(1, nextAboveReserve / usableKg));

    const marginBefore = fractionBefore * usableDeltaVMps;
    const marginAfter = fractionAfter * usableDeltaVMps;
    const deltaMargin = marginAfter - marginBefore;

    if (!Number.isFinite(marginBefore) || !Number.isFinite(marginAfter)) {
      return;
    }

    this.state.delta_v_margin_mps = Math.max(0, Math.min(usableDeltaVMps, marginAfter));

    if (Math.abs(deltaMargin) > (this.options.epsilon ?? 1e-6)) {
      if (deltaMargin < 0) {
        this.metrics.deltaV.usedMps += -deltaMargin;
      } else {
        this.metrics.deltaV.recoveredMps += deltaMargin;
      }

      this.logger?.log(getSeconds, 'Delta-v margin updated from SPS propellant change', {
        source,
        note,
        deltaVMps: deltaMargin,
        newMarginMps: this.state.delta_v_margin_mps,
      });
    }
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
