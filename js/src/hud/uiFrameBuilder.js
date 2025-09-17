import { formatGET, parseGET } from '../utils/time.js';

const DEFAULT_OPTIONS = {
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
  includeResourceHistory: false,
};

export class UiFrameBuilder {
  constructor(options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.lastFrame = null;
  }

  build(currentGetSeconds, context = {}) {
    const time = {
      getSeconds: currentGetSeconds,
      get: formatGET(currentGetSeconds),
      metSeconds: currentGetSeconds,
      met: formatGET(currentGetSeconds),
    };

    const eventStats = context.scheduler?.stats?.() ?? { counts: {}, upcoming: [] };
    const upcomingLimit = Math.max(0, Number(this.options.upcomingLimit) || 0);
    const upcomingRaw = Array.isArray(eventStats.upcoming) ? eventStats.upcoming : [];
    const upcoming = (upcomingLimit > 0 ? upcomingRaw.slice(0, upcomingLimit) : upcomingRaw).map((event) =>
      this.#buildNextEvent(event, currentGetSeconds),
    );
    const nextEvent = upcoming.length > 0 ? upcoming[0] : null;

    const resourceSnapshot = context.resourceSystem?.snapshot?.() ?? null;
    const includeHistory = Boolean(this.options.includeResourceHistory);
    let resourceHistory = null;
    if (includeHistory) {
      if (context.resourceHistory) {
        resourceHistory = context.resourceHistory;
      } else if (context.resourceSystem?.historySnapshot) {
        resourceHistory = context.resourceSystem.historySnapshot();
      }
    }
    const resources = this.#summarizeResources(resourceSnapshot);
    const alerts = resources?.alerts ?? { warnings: [], cautions: [], failures: [] };

    const autopilotStats = context.autopilotRunner?.stats?.() ?? null;
    const autopilot = this.#summarizeAutopilot(autopilotStats);

    const checklistStats = context.checklistManager?.stats?.() ?? null;
    const checklists = this.#summarizeChecklists(checklistStats);

    const manualStats = context.manualQueue?.stats?.() ?? null;

    const frame = {
      generatedAtSeconds: currentGetSeconds,
      time,
      events: {
        counts: eventStats.counts ?? {},
        upcoming,
        next: nextEvent,
      },
      resources,
      autopilot,
      checklists,
      manualQueue: manualStats,
      alerts,
    };

    if (includeHistory && resourceHistory) {
      frame.resourceHistory = resourceHistory;
    }

    this.lastFrame = frame;
    return frame;
  }

  getLastFrame() {
    return this.lastFrame;
  }

  #buildNextEvent(event, currentGetSeconds) {
    if (!event) {
      return null;
    }

    const opensAtSeconds = Number.isFinite(event.opensAtSeconds)
      ? event.opensAtSeconds
      : parseGET(event.opensAt ?? '') ?? null;
    const tMinusSeconds = Number.isFinite(opensAtSeconds) ? opensAtSeconds - currentGetSeconds : null;

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
      failures: this.#summarizeFailures(snapshot.failures),
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
      const percentRemaining =
        Number.isFinite(currentKg) && Number.isFinite(initialKg) && initialKg > 0
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
        percentAboveReserve = usable > 0 ? this.#roundNumber(Math.max(0, currentKg - reserveKg) / usable * 100, 1) : null;
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

    const deltaVMetrics = snapshot.metrics?.deltaV ?? {};
    const deltaV = {
      totalMps: this.#coerceNumber(snapshot.delta_v_margin_mps),
      csmSpsMps: this.#coerceNumber(snapshot.delta_v_margin_mps),
      usedMps: this.#coerceNumber(deltaVMetrics.usedMps),
      recoveredMps: this.#coerceNumber(deltaVMetrics.recoveredMps),
    };

    const lifeSupport = {
      oxygenKg: this.#coerceNumber(snapshot.lifeSupport?.oxygen_kg),
      waterKg: this.#coerceNumber(snapshot.lifeSupport?.water_kg),
      lithiumHydroxideCanisters: this.#coerceNumber(snapshot.lifeSupport?.lithium_hydroxide_canisters),
      co2MmHg: this.#coerceNumber(snapshot.lifeSupport?.co2_mmHg),
    };

    const communications = this.#summarizeCommunications(snapshot.communications ?? {});

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

  #summarizeCommunications(snapshot) {
    const base = {
      active: Boolean(snapshot?.active),
      nextWindowOpenGet: snapshot?.next_window_open_get ?? null,
      lastPadId: snapshot?.last_pad_id ?? null,
      scheduleCount: Number(snapshot?.schedule_count ?? 0) || 0,
    };

    if (!snapshot || typeof snapshot !== 'object') {
      return base;
    }

    const currentPassId = snapshot.current_pass_id ?? null;
    const timeRemaining = this.#coerceNumber(snapshot.current_window_time_remaining_s);
    const timeSinceOpen = this.#coerceNumber(snapshot.time_since_window_open_s);
    const duration = this.#coerceNumber(snapshot.current_pass_duration_s);
    const progress = this.#coerceNumber(snapshot.current_pass_progress);

    const current = currentPassId
      ? {
          id: currentPassId,
          station: snapshot.current_station ?? null,
          nextStation: snapshot.current_next_station ?? null,
          openGet: snapshot.current_window_open_get ?? null,
          closeGet: snapshot.current_window_close_get ?? null,
          openSeconds: this.#coerceNumber(snapshot.current_window_open_seconds),
          closeSeconds: this.#coerceNumber(snapshot.current_window_close_seconds),
          durationSeconds: duration,
          timeRemainingSeconds: timeRemaining,
          timeRemainingLabel: timeRemaining != null ? this.#formatOffset(timeRemaining) : null,
          timeSinceOpenSeconds: timeSinceOpen,
          timeSinceOpenLabel: Number.isFinite(timeSinceOpen)
            ? `T+${formatGET(Math.max(0, Math.round(timeSinceOpen)))}`
            : null,
          progress: Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : null,
          signalStrengthDb: this.#coerceNumber(snapshot.signal_strength_db),
          downlinkRateKbps: this.#coerceNumber(snapshot.downlink_rate_kbps),
          handoverMinutes: this.#coerceNumber(snapshot.handover_minutes),
          powerMarginDeltaKw: this.#coerceNumber(snapshot.power_margin_delta_kw),
          powerLoadDeltaKw: this.#coerceNumber(snapshot.power_load_delta_kw),
        }
      : null;

    const nextWindowOpenGet = snapshot.next_window_open_get ?? null;
    const timeUntilNext = this.#coerceNumber(snapshot.time_until_next_window_s);
    const next = (snapshot.next_pass_id ?? null) || nextWindowOpenGet
      ? {
          id: snapshot.next_pass_id ?? null,
          station: snapshot.next_station ?? null,
          openGet: nextWindowOpenGet,
          openSeconds: this.#coerceNumber(snapshot.next_window_open_seconds),
          timeUntilOpenSeconds: timeUntilNext,
          timeUntilOpenLabel: timeUntilNext != null ? this.#formatOffset(timeUntilNext) : null,
        }
      : null;

    return {
      ...base,
      current,
      next,
      timeUntilNextWindowSeconds: timeUntilNext,
      timeUntilNextWindowLabel: timeUntilNext != null ? this.#formatOffset(timeUntilNext) : null,
    };
  }

  #summarizeAutopilot(stats) {
    if (!stats) {
      return null;
    }

    const activeLimit = Math.max(0, Number(this.options.activeAutopilotLimit) || 0);
    const activeAutopilots = activeLimit > 0 ? (stats.activeAutopilots ?? []).slice(0, activeLimit) : [];

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
      totalRcsImpulseNs: stats.totalRcsImpulseNs ?? 0,
      totalRcsPulses: stats.totalRcsPulses ?? 0,
      totalDskyEntries: stats.totalDskyEntries ?? 0,
      propellantKgByTank: stats.propellantKgByTank ?? {},
      activeAutopilots,
      primary,
    };
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

  #summarizeFailures(entries) {
    if (!Array.isArray(entries)) {
      return [];
    }

    const summaries = [];
    for (const entry of entries) {
      if (!entry) {
        continue;
      }
      if (typeof entry === 'object') {
        const summary = {
          id: entry.id ?? null,
          classification: entry.classification ?? entry.class ?? null,
          trigger: entry.trigger ?? entry.reason ?? null,
          immediateEffect: entry.immediateEffect ?? entry.immediate_effect ?? null,
          ongoingPenalty: entry.ongoingPenalty ?? entry.ongoing_penalty ?? null,
          recoveryActions: entry.recoveryActions ?? entry.recovery_actions ?? null,
          sourceRef: entry.sourceRef ?? entry.source_ref ?? null,
          firstTriggered: entry.firstTriggered ?? entry.first_triggered ?? null,
          firstTriggeredSeconds: entry.firstTriggeredSeconds ?? entry.first_triggered_seconds ?? null,
          lastTriggered: entry.lastTriggered ?? entry.last_triggered ?? null,
          lastTriggeredSeconds: entry.lastTriggeredSeconds ?? entry.last_triggered_seconds ?? null,
          occurrences: entry.occurrences ?? entry.count ?? null,
          lastSource: entry.lastSource ?? null,
          lastType: entry.lastType ?? null,
          sources: Array.isArray(entry.sources) ? [...entry.sources] : [],
          notes: Array.isArray(entry.notes) ? [...entry.notes] : [],
        };
        if (entry.metadata && typeof entry.metadata === 'object') {
          summary.metadata = { ...entry.metadata };
        }
        summaries.push(summary);
      } else {
        summaries.push({ id: entry });
      }
    }

    return summaries;
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
