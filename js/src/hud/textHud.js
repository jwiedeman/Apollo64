import { formatGET } from '../utils/time.js';

const DEFAULT_OPTIONS = {
  enabled: true,
  renderIntervalSeconds: 600,
  upcomingLimit: 3,
  activeChecklistLimit: 2,
  activeAutopilotLimit: 2,
  propellantKeys: ['csm_sps_kg', 'csm_rcs_kg', 'lm_descent_kg', 'lm_ascent_kg'],
};

export class TextHud {
  constructor({ logger = null, ...options } = {}) {
    this.logger = logger;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.enabled = Boolean(this.options.enabled);
    this.renderIntervalSeconds = Math.max(1, Number(this.options.renderIntervalSeconds) || DEFAULT_OPTIONS.renderIntervalSeconds);
    this.nextRenderGetSeconds = 0;
    this.renderCount = 0;
    this.lastSnapshot = null;
  }

  update(currentGetSeconds, context = {}) {
    if (!this.enabled) {
      return;
    }

    if (currentGetSeconds + 1e-6 < this.nextRenderGetSeconds) {
      return;
    }

    const summary = this.#buildSummary(currentGetSeconds, context);
    this.lastSnapshot = { ...summary.context, message: summary.message, getSeconds: currentGetSeconds };
    this.renderCount += 1;
    this.nextRenderGetSeconds = currentGetSeconds + this.renderIntervalSeconds;

    if (this.logger) {
      this.logger.log(currentGetSeconds, summary.message, summary.context);
    } else {
      console.log(`[HUD ${formatGET(currentGetSeconds)}] ${summary.message}`, summary.context);
    }
  }

  stats() {
    return {
      enabled: this.enabled,
      renderIntervalSeconds: this.renderIntervalSeconds,
      renderCount: this.renderCount,
      lastSnapshot: this.lastSnapshot ? { ...this.lastSnapshot } : null,
    };
  }

  #buildSummary(currentGetSeconds, context) {
    const eventStats = context.scheduler?.stats?.() ?? { counts: {}, upcoming: [] };
    const counts = eventStats.counts ?? {};
    const upcomingLimit = Math.max(0, Number(this.options.upcomingLimit) || 0);
    const upcoming = upcomingLimit > 0 ? eventStats.upcoming.slice(0, upcomingLimit) : [];

    const resourceSnapshot = context.resourceSystem?.snapshot?.() ?? null;
    const resources = this.#summarizeResources(resourceSnapshot);

    const autopilotStats = context.autopilotRunner?.stats?.() ?? null;
    const autopilot = this.#summarizeAutopilot(autopilotStats);

    const checklistStats = context.checklistManager?.stats?.() ?? null;
    const checklists = this.#summarizeChecklists(checklistStats);

    const manualStats = context.manualQueue?.stats?.() ?? null;

    const messageParts = [];
    messageParts.push(`Events P:${counts.pending ?? 0} A:${counts.active ?? 0} C:${counts.complete ?? 0}`);

    if (upcoming.length > 0) {
      messageParts.push(`Next ${this.#formatUpcoming(upcoming)}`);
    } else {
      messageParts.push('Next none');
    }

    if (resources) {
      const power = this.#formatNumber(resources.powerMarginPct, 1);
      const cryo = this.#formatNumber(resources.cryoBoiloffRatePctPerHr, 2);
      const deltaV = this.#formatNumber(resources.deltaVMarginMps, 1);
      const ptc = resources.thermalBalanceState ?? 'n/a';
      const propellant = resources.propellantKg ?? {};
      const sps = this.#formatNumber(propellant.csm_sps_kg, 0);
      const rcs = this.#formatNumber(propellant.csm_rcs_kg, 0);
      messageParts.push(`Power ${power}% ΔV ${deltaV} m/s`);
      messageParts.push(`Cryo ${cryo}%/hr PTC ${ptc}`);
      messageParts.push(`Prop SPS ${sps} kg RCS ${rcs} kg`);
    }

    if (autopilot) {
      const active = autopilot.active ?? 0;
      const started = autopilot.started ?? 0;
      const completed = autopilot.completed ?? 0;
      if (active > 0 || started > 0) {
        messageParts.push(`Autop active ${active}/${started} complete ${completed}`);
      }
    }

    if (checklists?.totals) {
      const active = checklists.totals.active ?? 0;
      const autoSteps = checklists.totals.autoSteps ?? 0;
      const manualSteps = checklists.totals.manualSteps ?? 0;
      messageParts.push(`Checklists active ${active} steps A:${autoSteps} M:${manualSteps}`);
    }

    if (manualStats) {
      const pending = manualStats.pending ?? 0;
      const executed = manualStats.executed ?? 0;
      if (pending > 0 || executed > 0) {
        messageParts.push(`Manual pending ${pending} executed ${executed}`);
      }
    }

    const message = `HUD → ${messageParts.filter(Boolean).join(' | ')}`;

    return {
      message,
      context: {
        events: { counts, upcoming },
        resources,
        autopilot,
        checklists,
        manualQueue: manualStats ?? null,
        get: formatGET(currentGetSeconds),
      },
    };
  }

  #summarizeResources(snapshot) {
    if (!snapshot) {
      return null;
    }

    const propellant = snapshot.propellant ?? {};
    const propellantSummary = {};
    for (const key of this.options.propellantKeys ?? []) {
      if (Object.prototype.hasOwnProperty.call(propellant, key)) {
        const value = Number(propellant[key]);
        propellantSummary[key] = Number.isFinite(value) ? value : null;
      }
    }

    return {
      powerMarginPct: this.#coerceNumber(snapshot.power_margin_pct),
      cryoBoiloffRatePctPerHr: this.#coerceNumber(snapshot.cryo_boiloff_rate_pct_per_hr),
      deltaVMarginMps: this.#coerceNumber(snapshot.delta_v_margin_mps),
      thermalBalanceState: snapshot.thermal_balance_state ?? null,
      ptcActive: snapshot.ptc_active ?? null,
      propellantKg: propellantSummary,
      powerKw: {
        load: this.#coerceNumber(snapshot.power?.fuel_cell_load_kw),
        output: this.#coerceNumber(snapshot.power?.fuel_cell_output_kw),
      },
    };
  }

  #summarizeAutopilot(stats) {
    if (!stats) {
      return null;
    }

    const activeLimit = Math.max(0, Number(this.options.activeAutopilotLimit) || 0);
    const activeAutopilots = activeLimit > 0
      ? (stats.activeAutopilots ?? []).slice(0, activeLimit)
      : [];

    return {
      active: stats.active,
      started: stats.started,
      completed: stats.completed,
      aborted: stats.aborted,
      totalBurnSeconds: stats.totalBurnSeconds,
      totalUllageSeconds: stats.totalUllageSeconds,
      propellantKgByTank: stats.propellantKgByTank ?? {},
      activeAutopilots,
    };
  }

  #summarizeChecklists(stats) {
    if (!stats) {
      return null;
    }

    const limit = Math.max(0, Number(this.options.activeChecklistLimit) || 0);
    const active = limit > 0 ? stats.active.slice(0, limit) : [];

    return {
      totals: stats.totals,
      active,
    };
  }

  #formatUpcoming(upcoming) {
    return upcoming
      .map((event) => `${event.id}@${event.opensAt}`)
      .join(', ');
  }

  #coerceNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  #formatNumber(value, digits = 1) {
    if (!Number.isFinite(value)) {
      return 'n/a';
    }
    return value.toFixed(digits);
  }
}
