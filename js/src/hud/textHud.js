import { formatGET, parseGET } from '../utils/time.js';

const DEFAULT_OPTIONS = {
  enabled: true,
  renderIntervalSeconds: 600,
  upcomingLimit: 3,
  activeChecklistLimit: 2,
  activeAutopilotLimit: 2,
  propellantKeys: ['csm_sps_kg', 'csm_rcs_kg', 'lm_descent_kg', 'lm_ascent_kg'],
  propellantLabels: {
    csm_sps: 'SPS',
    csm_rcs: 'CSM RCS',
    lm_descent: 'LM DPS',
    lm_ascent: 'LM APS',
    lm_rcs: 'LM RCS',
  },
  cautionPowerMarginPct: 35,
  warningPowerMarginPct: 20,
  cautionPropellantPct: 35,
  warningPropellantPct: 15,
  cautionCryoRatePctPerHr: 1.5,
  warningCryoRatePctPerHr: 2.5,
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

    const snapshot = this.#buildSnapshot(currentGetSeconds, context);
    this.lastSnapshot = { ...snapshot, getSeconds: currentGetSeconds };
    this.renderCount += 1;
    this.nextRenderGetSeconds = currentGetSeconds + this.renderIntervalSeconds;

    const { message, ...payload } = snapshot;
    if (this.logger) {
      this.logger.log(currentGetSeconds, message, payload);
    } else {
      console.log(`[HUD ${formatGET(currentGetSeconds)}] ${message}`, payload);
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

  #buildSnapshot(currentGetSeconds, context) {
    const time = {
      getSeconds: currentGetSeconds,
      get: formatGET(currentGetSeconds),
      metSeconds: currentGetSeconds,
      met: formatGET(currentGetSeconds),
    };

    const eventStats = context.scheduler?.stats?.() ?? { counts: {}, upcoming: [] };
    const upcomingLimit = Math.max(0, Number(this.options.upcomingLimit) || 0);
    const upcomingRaw = Array.isArray(eventStats.upcoming) ? eventStats.upcoming : [];
    const upcoming = (upcomingLimit > 0 ? upcomingRaw.slice(0, upcomingLimit) : upcomingRaw)
      .map((event) => this.#buildNextEvent(event, currentGetSeconds));
    const nextEvent = upcoming.length > 0 ? upcoming[0] : null;

    const resourceSnapshot = context.resourceSystem?.snapshot?.() ?? null;
    const resources = this.#summarizeResources(resourceSnapshot);
    const alerts = resources?.alerts ?? { warnings: [], cautions: [], failures: [] };

    const autopilotStats = context.autopilotRunner?.stats?.() ?? null;
    const autopilot = this.#summarizeAutopilot(autopilotStats);

    const checklistStats = context.checklistManager?.stats?.() ?? null;
    const checklists = this.#summarizeChecklists(checklistStats);

    const manualStats = context.manualQueue?.stats?.() ?? null;

    const events = {
      counts: eventStats.counts ?? {},
      upcoming,
      next: nextEvent,
    };

    const snapshot = {
      time,
      events,
      resources,
      autopilot,
      checklists,
      manualQueue: manualStats,
      alerts,
    };

    snapshot.message = this.#formatMessage(snapshot);
    return snapshot;
  }

  #buildNextEvent(event, currentGetSeconds) {
    if (!event) {
      return null;
    }

    const opensAtSeconds = Number.isFinite(event.opensAtSeconds)
      ? event.opensAtSeconds
      : parseGET(event.opensAt ?? '') ?? null;
    const tMinusSeconds = Number.isFinite(opensAtSeconds)
      ? opensAtSeconds - currentGetSeconds
      : null;

    return {
      id: event.id,
      phase: event.phase ?? null,
      status: event.status ?? null,
      opensAt: event.opensAt ?? (Number.isFinite(opensAtSeconds) ? formatGET(opensAtSeconds) : null),
      opensAtSeconds,
      tMinusSeconds,
      tMinusLabel: tMinusSeconds != null ? this.#formatOffset(tMinusSeconds) : null,
      isOverdue: tMinusSeconds != null && tMinusSeconds < 0,
    };
  }

  #summarizeResources(snapshot) {
    if (!snapshot) {
      return null;
    }

    const propellant = snapshot.propellant ?? {};
    const budgets = snapshot.budgets ?? {};
    const propellantBudgets = budgets.propellant ?? {};
    const propellantSummary = {};
    const alerts = {
      warnings: [],
      cautions: [],
      failures: Array.isArray(snapshot.failures) ? [...snapshot.failures] : [],
    };

    for (const key of this.options.propellantKeys ?? []) {
      if (!Object.prototype.hasOwnProperty.call(propellant, key)) {
        continue;
      }

      const baseKey = this.#normalizeTankKey(key);
      const label = (this.options.propellantLabels ?? {})[baseKey] ?? baseKey;
      const currentKg = this.#coerceNumber(propellant[key]);
      const budget = propellantBudgets?.[baseKey] ?? {};
      const initialKg = this.#coerceNumber(budget.initial_kg);
      const reserveKg = this.#coerceNumber(budget.reserve_kg);
      const percentRemaining = Number.isFinite(currentKg) && Number.isFinite(initialKg) && initialKg > 0
        ? this.#roundNumber((currentKg / initialKg) * 100, 1)
        : null;
      let percentAboveReserve = null;
      if (
        Number.isFinite(currentKg)
        && Number.isFinite(initialKg)
        && Number.isFinite(reserveKg)
        && initialKg > reserveKg
      ) {
        const usable = initialKg - reserveKg;
        percentAboveReserve = usable > 0
          ? this.#roundNumber(Math.max(0, currentKg - reserveKg) / usable * 100, 1)
          : null;
      }

      const status = this.#resolvePropellantStatus({ currentKg, initialKg, reserveKg });
      if (status.level === 'warning') {
        alerts.warnings.push({ id: `propellant_${baseKey}`, label, percentRemaining });
      } else if (status.level === 'caution') {
        alerts.cautions.push({ id: `propellant_${baseKey}`, label, percentRemaining });
      }

      propellantSummary[baseKey] = {
        label,
        remainingKg: Number.isFinite(currentKg) ? this.#roundNumber(currentKg, 1) : null,
        initialKg: Number.isFinite(initialKg) ? this.#roundNumber(initialKg, 1) : null,
        reserveKg: Number.isFinite(reserveKg) ? this.#roundNumber(reserveKg, 1) : null,
        percentRemaining,
        percentAboveReserve,
        status: status.level,
        statusMessage: status.message,
      };
    }

    const powerMarginPct = this.#coerceNumber(snapshot.power_margin_pct);
    if (Number.isFinite(powerMarginPct)) {
      if (powerMarginPct <= this.options.warningPowerMarginPct) {
        alerts.warnings.push({ id: 'power_margin_low', value: powerMarginPct });
      } else if (powerMarginPct <= this.options.cautionPowerMarginPct) {
        alerts.cautions.push({ id: 'power_margin_low', value: powerMarginPct });
      }
    }

    const cryoRate = this.#coerceNumber(snapshot.cryo_boiloff_rate_pct_per_hr);
    if (Number.isFinite(cryoRate)) {
      if (cryoRate >= this.options.warningCryoRatePctPerHr) {
        alerts.warnings.push({ id: 'cryo_boiloff_high', value: cryoRate });
      } else if (cryoRate >= this.options.cautionCryoRatePctPerHr) {
        alerts.cautions.push({ id: 'cryo_boiloff_high', value: cryoRate });
      }
    }

    const power = {
      marginPct: powerMarginPct,
      loadKw: this.#coerceNumber(snapshot.power?.fuel_cell_load_kw),
      outputKw: this.#coerceNumber(snapshot.power?.fuel_cell_output_kw),
    };

    const thermal = {
      cryoBoiloffRatePctPerHr: cryoRate,
      state: snapshot.thermal_balance_state ?? null,
      ptcActive: snapshot.ptc_active ?? null,
    };

    const deltaV = {
      totalMps: this.#coerceNumber(snapshot.delta_v_margin_mps),
      csmSpsMps: this.#coerceNumber(snapshot.delta_v_margin_mps),
    };

    const lifeSupport = {
      oxygenKg: this.#coerceNumber(snapshot.lifeSupport?.oxygen_kg),
      waterKg: this.#coerceNumber(snapshot.lifeSupport?.water_kg),
      lithiumHydroxideCanisters: this.#coerceNumber(snapshot.lifeSupport?.lithium_hydroxide_canisters),
      co2MmHg: this.#coerceNumber(snapshot.lifeSupport?.co2_mmHg),
    };

    const communications = {
      nextWindowOpenGet: snapshot.communications?.next_window_open_get ?? null,
      lastPadId: snapshot.communications?.last_pad_id ?? null,
    };

    return {
      power,
      thermal,
      deltaV,
      propellant: {
        tanks: propellantSummary,
        metrics: snapshot.metrics?.propellantDeltaKg ?? {},
      },
      lifeSupport,
      communications,
      alerts,
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

    let primary = null;
    if (Array.isArray(stats.activeAutopilots) && stats.activeAutopilots.length > 0) {
      const sorted = [...stats.activeAutopilots].sort((a, b) => {
        const aRemaining = Number.isFinite(a.remainingSeconds) ? a.remainingSeconds : Infinity;
        const bRemaining = Number.isFinite(b.remainingSeconds) ? b.remainingSeconds : Infinity;
        return aRemaining - bRemaining;
      });
      primary = sorted[0];
    }

    return {
      active: stats.active,
      started: stats.started,
      completed: stats.completed,
      aborted: stats.aborted,
      totalBurnSeconds: stats.totalBurnSeconds,
      totalUllageSeconds: stats.totalUllageSeconds,
      propellantKgByTank: stats.propellantKgByTank ?? {},
      activeAutopilots,
      primary,
    };
  }

  #formatMessage(snapshot) {
    const parts = [];

    const next = snapshot.events?.next;
    if (next) {
      const status = next.status ? ` ${next.status}` : '';
      const phase = next.phase ? ` (${next.phase})` : '';
      const tLabel = next.tMinusLabel ?? 'TBD';
      parts.push(`Next ${next.id}${phase}${status} ${tLabel}`.trim());
    } else {
      parts.push('Next none');
    }

    const counts = snapshot.events?.counts ?? {};
    parts.push(`Events P:${counts.pending ?? 0} A:${counts.active ?? 0} C:${counts.complete ?? 0}`);

    const powerMargin = snapshot.resources?.power?.marginPct;
    const powerLabel = this.#formatNumber(powerMargin, 1);
    if (powerLabel !== 'n/a') {
      parts.push(`Power ${powerLabel}%`);
    }

    const cryo = snapshot.resources?.thermal?.cryoBoiloffRatePctPerHr;
    const cryoLabel = this.#formatNumber(cryo, 2);
    if (cryoLabel !== 'n/a') {
      parts.push(`Cryo ${cryoLabel}%/hr`);
    }

    const deltaV = snapshot.resources?.deltaV?.totalMps;
    const deltaVLabel = this.#formatNumber(deltaV, 0);
    if (deltaVLabel !== 'n/a') {
      parts.push(`ΔV ${deltaVLabel} m/s`);
    }

    const spsTank = snapshot.resources?.propellant?.tanks?.csm_sps;
    if (spsTank && spsTank.remainingKg != null) {
      const spsAmount = this.#formatNumber(spsTank.remainingKg, 0);
      const spsPct = this.#formatNumber(spsTank.percentRemaining, 0);
      if (spsAmount !== 'n/a' && spsPct !== 'n/a') {
        parts.push(`${spsTank.label ?? 'SPS'} ${spsAmount} kg (${spsPct}%)`);
      }
    }

    const rcsTank = snapshot.resources?.propellant?.tanks?.csm_rcs;
    if (rcsTank && rcsTank.remainingKg != null) {
      const rcsAmount = this.#formatNumber(rcsTank.remainingKg, 0);
      const rcsPct = this.#formatNumber(rcsTank.percentRemaining, 0);
      if (rcsAmount !== 'n/a' && rcsPct !== 'n/a') {
        parts.push(`${rcsTank.label ?? 'RCS'} ${rcsAmount} kg (${rcsPct}%)`);
      }
    }

    const chip = snapshot.checklists?.chip;
    if (chip) {
      const nextStep = chip.nextStepNumber != null ? `S${chip.nextStepNumber}` : 'pending';
      parts.push(`Checklist ${chip.checklistId ?? chip.title ?? chip.eventId}:${nextStep}`);
    } else if ((snapshot.checklists?.totals?.active ?? 0) === 0) {
      parts.push('Checklist idle');
    }

    const autop = snapshot.autopilot;
    if (autop?.active > 0) {
      if (autop.primary) {
        const throttle = this.#formatNumber((autop.primary.currentThrottle ?? 0) * 100, 0);
        const remaining = this.#formatNumber(autop.primary.remainingSeconds ?? NaN, 0);
        const autopLabel = autop.primary.autopilotId ?? autop.primary.eventId ?? 'autopilot';
        if (throttle !== 'n/a' && remaining !== 'n/a') {
          parts.push(`Autop ${autop.active} (${autopLabel} ${throttle}% ${remaining}s)`);
        } else {
          parts.push(`Autop ${autop.active}`);
        }
      } else {
        parts.push(`Autop ${autop.active}`);
      }
    }

    const alerts = snapshot.alerts ?? {};
    const warningCount = alerts.warnings?.length ?? 0;
    const cautionCount = alerts.cautions?.length ?? 0;
    const failureCount = alerts.failures?.length ?? 0;
    if (warningCount + cautionCount + failureCount > 0) {
      parts.push(`Alerts W:${warningCount} C:${cautionCount} F:${failureCount}`);
    }

    return `HUD → ${parts.filter(Boolean).join(' | ')}`;
  }

  #summarizeChecklists(stats) {
    if (!stats) {
      return null;
    }

    const limit = Math.max(0, Number(this.options.activeChecklistLimit) || 0);
    const active = limit > 0 ? stats.active.slice(0, limit) : stats.active.slice();
    const chip = this.#selectChecklistChip(stats.active);

    return {
      totals: stats.totals,
      active,
      chip,
    };
  }

  #selectChecklistChip(active) {
    if (!Array.isArray(active) || active.length === 0) {
      return null;
    }

    const sorted = [...active].sort((a, b) => {
      const remainingA = a.totalSteps - a.completedSteps;
      const remainingB = b.totalSteps - b.completedSteps;
      if (remainingA !== remainingB) {
        return remainingA - remainingB;
      }
      if (a.nextStepNumber != null && b.nextStepNumber != null && a.nextStepNumber !== b.nextStepNumber) {
        return a.nextStepNumber - b.nextStepNumber;
      }
      return a.eventId.localeCompare(b.eventId);
    });

    const selected = sorted[0];
    return {
      eventId: selected.eventId,
      checklistId: selected.checklistId,
      title: selected.title,
      crewRole: selected.crewRole,
      nextStepNumber: selected.nextStepNumber,
      nextStepAction: selected.nextStepAction,
      stepsRemaining: Math.max(0, selected.totalSteps - selected.completedSteps),
      autoAdvancePending: selected.autoAdvancePending,
    };
  }

  #resolvePropellantStatus({ currentKg, initialKg, reserveKg }) {
    const status = { level: 'nominal', message: null };

    if (!Number.isFinite(currentKg) || !Number.isFinite(initialKg) || initialKg <= 0) {
      return status;
    }

    const percent = (currentKg / initialKg) * 100;
    if (Number.isFinite(reserveKg) && reserveKg >= 0 && currentKg <= reserveKg + 1e-6) {
      status.level = 'warning';
      status.message = 'Reserve reached';
      return status;
    }

    if (percent <= this.options.warningPropellantPct) {
      status.level = 'warning';
      return status;
    }

    if (percent <= this.options.cautionPropellantPct) {
      status.level = 'caution';
    }

    return status;
  }

  #coerceNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  #roundNumber(value, digits = 1) {
    if (!Number.isFinite(value)) {
      return null;
    }
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }

  #formatNumber(value, digits = 1) {
    if (!Number.isFinite(value)) {
      return 'n/a';
    }
    return value.toFixed(digits);
  }

  #formatOffset(seconds) {
    if (!Number.isFinite(seconds)) {
      return null;
    }
    const prefix = seconds >= 0 ? 'T-' : 'T+';
    const absolute = Math.max(0, Math.round(Math.abs(seconds)));
    return `${prefix}${formatGET(absolute)}`;
  }

  #normalizeTankKey(value) {
    if (typeof value !== 'string') {
      return value;
    }
    return value.endsWith('_kg') ? value.slice(0, -3) : value;
  }
}
