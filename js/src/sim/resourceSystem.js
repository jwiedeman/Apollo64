const DEFAULT_STATE = {
  power_margin_pct: 100,
  cryo_boiloff_rate_pct_per_hr: 1.0,
  thermal_balance_state: 'UNINITIALIZED',
  ptc_active: false,
  delta_v_margin_mps: 0,
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

export class ResourceSystem {
  constructor(logger, options = {}) {
    this.logger = logger;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.state = { ...DEFAULT_STATE, ...(options.initialState ?? {}) };
    this.failures = new Set();
    this._logCountdown = this.options.logIntervalSeconds;
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

      if (typeof value === 'number') {
        const previous = typeof this.state[key] === 'number' ? this.state[key] : 0;
        this.state[key] = previous + value;
        applied[key] = this.state[key];
      } else {
        this.state[key] = value;
        applied[key] = value;
      }
    }

    if (Object.keys(applied).length > 0) {
      this.logger.log(getSeconds, `${type === 'failure' ? 'Failure' : 'Resource'} update from ${source}`, {
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
      this.logger.log(getSeconds, 'Resource snapshot', {
        snapshot: this.snapshot(),
      });
      this._logCountdown = this.options.logIntervalSeconds;
    }
  }

  snapshot() {
    return {
      ...this.state,
      failures: Array.from(this.failures.values()),
    };
  }

  isPtcStable() {
    const state = this.state.thermal_balance_state ?? '';
    return state === 'PTC_STABLE' || state === 'PTC_TUNED';
  }
}
