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
  cautionPeriapsisKm: 120,
  warningPeriapsisKm: 85,
  includeResourceHistory: false,
  missionLogLimit: 50,
};

export class UiFrameBuilder {
  constructor(options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.lastFrame = null;
    this.padMap = this.#normalizePadMap(this.options.pads);
    this.eventLookup = this.#buildEventLookup(this.options.events);
    this.eventPadMap = this.#buildEventPadMap(this.options.events);
    this.dockingConfig = this.#normalizeDockingConfig(this.options.docking);
  }

  build(currentGetSeconds, context = {}) {
    const time = {
      getSeconds: currentGetSeconds,
      get: formatGET(currentGetSeconds),
      metSeconds: currentGetSeconds,
      met: formatGET(currentGetSeconds),
    };

    const scheduler = context.scheduler ?? null;
    const eventStats = scheduler?.stats?.() ?? { counts: {}, upcoming: [] };
    const upcomingLimit = Math.max(0, Number(this.options.upcomingLimit) || 0);
    const upcomingRaw = Array.isArray(eventStats.upcoming) ? eventStats.upcoming : [];
    const resolvePad = (eventId) => this.#resolvePadForEvent(eventId, scheduler);
    const upcoming = (upcomingLimit > 0 ? upcomingRaw.slice(0, upcomingLimit) : upcomingRaw).map((event) =>
      this.#buildNextEvent(event, currentGetSeconds, resolvePad),
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
    const baseAlerts = resources?.alerts ?? { warnings: [], cautions: [], failures: [] };
    const alerts = {
      warnings: [...(baseAlerts.warnings ?? [])],
      cautions: [...(baseAlerts.cautions ?? [])],
      failures: [...(baseAlerts.failures ?? [])],
    };

    const autopilotStats = context.autopilotRunner?.stats?.() ?? null;
    const autopilot = this.#summarizeAutopilot(autopilotStats, resolvePad);

    const checklistStats = context.checklistManager?.stats?.() ?? null;
    const checklists = this.#summarizeChecklists(checklistStats, resolvePad);

    const manualStats = context.manualQueue?.stats?.() ?? null;

    const scoreSummary =
      context.scoreSummary
      ?? (context.scoreSystem?.summary ? context.scoreSystem.summary() : null);
    const score = this.#summarizeScore(scoreSummary);

    const orbitSummary = context.orbitSummary
      ?? (context.orbit?.summary ? context.orbit.summary() : null);
    const trajectory = this.#summarizeTrajectory(orbitSummary);
    let trajectoryHistory = null;
    if (context.orbitHistory) {
      trajectoryHistory = context.orbitHistory;
    } else if (context.orbit?.historySnapshot) {
      trajectoryHistory = context.orbit.historySnapshot();
    }

    if (trajectory?.alerts) {
      if (Array.isArray(trajectory.alerts.warnings)) {
        alerts.warnings.push(...trajectory.alerts.warnings.map((entry) => ({ ...entry })));
      }
      if (Array.isArray(trajectory.alerts.cautions)) {
        alerts.cautions.push(...trajectory.alerts.cautions.map((entry) => ({ ...entry })));
      }
      if (Array.isArray(trajectory.alerts.failures)) {
        alerts.failures.push(...trajectory.alerts.failures.map((entry) => ({ ...entry })));
      }
    }

    const missionLog = this.#summarizeMissionLog(context.missionLog ?? context.missionLogAggregator);
    const docking = this.#summarizeDocking(currentGetSeconds, context);

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
      score,
    };

    frame.missionLog = missionLog ?? null;

    if (includeHistory && resourceHistory) {
      frame.resourceHistory = resourceHistory;
    }

    if (trajectory) {
      if (trajectoryHistory) {
        trajectory.history = trajectoryHistory;
      }
      frame.trajectory = trajectory;
    } else if (trajectoryHistory) {
      frame.trajectoryHistory = trajectoryHistory;
    }

    if (docking) {
      frame.docking = docking;
    }

    this.lastFrame = frame;
    return frame;
  }

  getLastFrame() {
    return this.lastFrame;
  }

  #buildNextEvent(event, currentGetSeconds, resolvePad) {
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
      padId: event.padId ?? null,
      pad: resolvePad ? resolvePad(event.id) : null,
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
    const deltaVState = snapshot.delta_v ?? {};
    const totalState = deltaVState.total ?? {};
    const stageStates = deltaVState.stages && typeof deltaVState.stages === 'object'
      ? deltaVState.stages
      : {};
    const legacyMargin = this.#coerceNumber(snapshot.delta_v_margin_mps);
    const totalMargin = this.#coerceNumber(totalState.margin_mps);
    const totalBase = this.#coerceNumber(totalState.base_mps);
    const totalAdjustment = this.#coerceNumber(totalState.adjustment_mps);
    const totalUsable = this.#coerceNumber(totalState.usable_delta_v_mps);

    const stageSummaries = {};
    for (const [stageId, stage] of Object.entries(stageStates)) {
      if (!stage || typeof stage !== 'object') {
        continue;
      }
      const margin = this.#coerceNumber(stage.margin_mps);
      const base = this.#coerceNumber(stage.base_mps);
      const adjustment = this.#coerceNumber(stage.adjustment_mps);
      const usable = this.#coerceNumber(stage.usable_delta_v_mps);
      const label = stage.label ?? this.#formatStageLabel(stageId);
      const percentAvailable =
        Number.isFinite(usable)
        && usable > 0
        && Number.isFinite(margin)
          ? this.#roundNumber((Math.max(0, margin) / usable) * 100, 1)
          : null;

      stageSummaries[stageId] = {
        id: stageId,
        label,
        marginMps: Number.isFinite(margin) ? this.#roundNumber(margin, 1) : null,
        baseMps: Number.isFinite(base) ? this.#roundNumber(base, 1) : null,
        adjustmentMps: Number.isFinite(adjustment) ? this.#roundNumber(adjustment, 1) : null,
        usableMps: Number.isFinite(usable) ? this.#roundNumber(usable, 1) : null,
        percentAvailable,
        tank: stage.tank ?? null,
      };
    }

    const totalMpsValue = Number.isFinite(totalMargin) ? totalMargin : legacyMargin;
    const primaryStageId = stageSummaries.csm_sps ? 'csm_sps' : Object.keys(stageSummaries)[0] ?? null;
    const deltaV = {
      totalMps: Number.isFinite(totalMpsValue) ? this.#roundNumber(totalMpsValue, 1) : null,
      totalBaseMps: Number.isFinite(totalBase) ? this.#roundNumber(totalBase, 1) : null,
      totalAdjustmentMps: Number.isFinite(totalAdjustment) ? this.#roundNumber(totalAdjustment, 1) : null,
      totalUsableMps: Number.isFinite(totalUsable) ? this.#roundNumber(totalUsable, 1) : null,
      legacyCsmSpsMps: Number.isFinite(legacyMargin) ? this.#roundNumber(legacyMargin, 1) : null,
      stages: stageSummaries,
      usedMps: this.#coerceNumber(deltaVMetrics.usedMps),
      recoveredMps: this.#coerceNumber(deltaVMetrics.recoveredMps),
      primaryStageId,
      primaryStageMps:
        primaryStageId && stageSummaries[primaryStageId]?.marginMps != null
          ? stageSummaries[primaryStageId].marginMps
          : null,
      csmSpsMps: stageSummaries.csm_sps?.marginMps
        ?? (Number.isFinite(legacyMargin) ? this.#roundNumber(legacyMargin, 1) : null),
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

  #summarizeMissionLog(source) {
    if (!source) {
      return null;
    }

    let snapshot = null;
    if (typeof source.snapshot === 'function') {
      snapshot = source.snapshot({ limit: this.options.missionLogLimit });
    } else if (Array.isArray(source.entries)) {
      snapshot = { entries: source.entries };
    } else if (Array.isArray(source)) {
      snapshot = { entries: source };
    }

    if (!snapshot) {
      return null;
    }

    const entries = Array.isArray(snapshot.entries)
      ? snapshot.entries
          .map((entry) => this.#normalizeMissionLogEntry(entry))
          .filter(Boolean)
      : [];

    const filteredCount = Number.isFinite(snapshot.filteredCount) ? snapshot.filteredCount : entries.length;
    const totalCount = Number.isFinite(snapshot.totalCount) ? snapshot.totalCount : entries.length;
    const categories = this.#normalizeCountMap(snapshot.filteredCategories ?? snapshot.categories ?? null);
    const severities = this.#normalizeCountMap(snapshot.filteredSeverities ?? snapshot.severities ?? null);
    const lastEntry = entries.length > 0 ? entries[entries.length - 1] : null;
    const lastTimestampSeconds = snapshot.lastTimestampSeconds ?? lastEntry?.timestampSeconds ?? null;
    const lastTimestampGet = snapshot.lastTimestampGet ?? lastEntry?.timestampGet ?? null;

    return {
      entries,
      totalCount,
      filteredCount,
      categories,
      severities,
      lastTimestampSeconds,
      lastTimestampGet,
    };
  }

  #normalizeMissionLogEntry(entry) {
    if (!entry || typeof entry !== 'object') {
      return null;
    }

    const timestampSeconds = Number.isFinite(entry.timestampSeconds)
      ? entry.timestampSeconds
      : null;
    const timestampGet =
      typeof entry.timestampGet === 'string' && entry.timestampGet.length > 0
        ? entry.timestampGet
        : timestampSeconds != null
          ? formatGET(timestampSeconds)
          : null;
    const category = typeof entry.category === 'string' && entry.category.length > 0
      ? entry.category
      : 'system';
    const source = typeof entry.source === 'string' && entry.source.length > 0
      ? entry.source
      : 'sim';
    const severity = typeof entry.severity === 'string' && entry.severity.length > 0
      ? entry.severity
      : null;
    const message = typeof entry.message === 'string' ? entry.message : String(entry.message ?? '');
    const context = entry.context && typeof entry.context === 'object' ? deepClone(entry.context) : {};

    return {
      id: entry.id ?? null,
      sequence: Number.isFinite(entry.sequence) ? entry.sequence : Number.isFinite(entry.index) ? entry.index : null,
      timestampSeconds,
      timestampGet,
      category,
      source,
      severity,
      message,
      context,
    };
  }

  #normalizeCountMap(map) {
    if (!map || typeof map !== 'object') {
      return {};
    }
    const result = {};
    for (const [key, value] of Object.entries(map)) {
      if (!key) {
        continue;
      }
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        continue;
      }
      result[key] = numeric;
    }
    return result;
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

  #summarizeScore(summary) {
    if (!summary || typeof summary !== 'object') {
      return null;
    }

    const events = summary.events ?? {};
    const resources = summary.resources ?? {};
    const faults = summary.faults ?? {};
    const manual = summary.manual ?? {};
    const comms = summary.comms ?? {};
    const rating = summary.rating ?? {};
    const breakdown = rating.breakdown ?? {};

    const resourceFailureIds = Array.isArray(faults.resourceFailureIds)
      ? faults.resourceFailureIds.filter((id) => typeof id === 'string' && id.length > 0)
      : [];

    const manualFraction = this.#coerceNumber(manual.manualFraction);
    const manualFractionRounded = manualFraction != null ? this.#roundNumber(manualFraction, 3) : null;

    return {
      missionDurationSeconds: this.#coerceNumber(summary.missionDurationSeconds),
      events: {
        total: this.#coerceNumber(events.total),
        completed: this.#coerceNumber(events.completed),
        failed: this.#coerceNumber(events.failed),
        pending: this.#coerceNumber(events.pending),
        completionRatePct: this.#coerceNumber(events.completionRatePct),
      },
      comms: {
        total: this.#coerceNumber(comms.total),
        completed: this.#coerceNumber(comms.completed),
        failed: this.#coerceNumber(comms.failed),
        hitRatePct: this.#coerceNumber(comms.hitRatePct),
      },
      resources: {
        minPowerMarginPct: this.#coerceNumber(resources.minPowerMarginPct),
        maxPowerMarginPct: this.#coerceNumber(resources.maxPowerMarginPct),
        minDeltaVMarginMps: this.#coerceNumber(resources.minDeltaVMarginMps),
        maxDeltaVMarginMps: this.#coerceNumber(resources.maxDeltaVMarginMps),
        thermalViolationSeconds: this.#coerceNumber(resources.thermalViolationSeconds),
        thermalViolationEvents: this.#coerceNumber(resources.thermalViolationEvents),
        propellantUsedKg: this.#cloneNumberMap(resources.propellantUsedKg),
        powerDeltaKw: this.#cloneNumberMap(resources.powerDeltaKw),
      },
      faults: {
        eventFailures: this.#coerceNumber(faults.eventFailures),
        resourceFailures: this.#coerceNumber(faults.resourceFailures),
        totalFaults: this.#coerceNumber(faults.totalFaults),
        resourceFailureIds,
      },
      manual: {
        manualSteps: this.#coerceNumber(manual.manualSteps),
        autoSteps: this.#coerceNumber(manual.autoSteps),
        totalSteps: this.#coerceNumber(manual.totalSteps),
        manualFraction: manualFractionRounded,
      },
      rating: {
        commanderScore: this.#coerceNumber(rating.commanderScore),
        grade: typeof rating.grade === 'string' ? rating.grade : null,
        baseScore: this.#coerceNumber(rating.baseScore),
        manualBonus: this.#coerceNumber(rating.manualBonus),
        breakdown: {
          events: this.#summarizeScoreBreakdown(breakdown.events),
          resources: this.#summarizeScoreBreakdown(breakdown.resources),
          faults: this.#summarizeScoreBreakdown(breakdown.faults),
          manual: this.#summarizeScoreBreakdown(breakdown.manual),
        },
      },
    };
  }

  #summarizeTrajectory(summary) {
    if (!summary || typeof summary !== 'object') {
      return null;
    }

    const body = summary.body ?? {};
    const altitudeMeters = this.#coerceNumber(summary.position?.altitude);
    const altitudeKm = Number.isFinite(altitudeMeters) ? this.#roundNumber(altitudeMeters / 1000, 1) : null;
    const radiusMeters = this.#coerceNumber(summary.position?.radius);
    const radiusKm = Number.isFinite(radiusMeters) ? this.#roundNumber(radiusMeters / 1000, 1) : null;
    const speed = this.#coerceNumber(summary.velocity?.speed);
    const speedKmPerSec = Number.isFinite(speed) ? this.#roundNumber(speed / 1000, 3) : null;

    const elements = summary.elements ?? {};
    const eccentricity = this.#coerceNumber(elements.eccentricity);
    const inclinationDeg = this.#coerceNumber(elements.inclinationDeg ?? elements.inclination_rad_deg);
    const raanDeg = this.#coerceNumber(elements.raanDeg ?? elements.raan_rad_deg);
    const argPeriapsisDeg = this.#coerceNumber(
      elements.argumentOfPeriapsisDeg ?? elements.argument_of_periapsis_deg,
    );
    const trueAnomalyDeg = this.#coerceNumber(elements.trueAnomalyDeg ?? elements.true_anomaly_deg);
    const periapsisAltitude = this.#coerceNumber(elements.periapsisAltitude);
    const apoapsisAltitude = this.#coerceNumber(elements.apoapsisAltitude);
    const semiMajorAxis = this.#coerceNumber(elements.semiMajorAxis);
    const periodSeconds = this.#coerceNumber(elements.periodSeconds);

    const alerts = { warnings: [], cautions: [], failures: [] };
    if (Number.isFinite(periapsisAltitude)) {
      const periapsisKm = periapsisAltitude / 1000;
      if (periapsisKm < 0) {
        alerts.failures.push({ id: 'orbit_periapsis_below_surface', value: this.#roundNumber(periapsisKm, 1) });
      } else if (periapsisKm <= this.options.warningPeriapsisKm) {
        alerts.warnings.push({ id: 'orbit_periapsis_low', value: this.#roundNumber(periapsisKm, 1) });
      } else if (periapsisKm <= this.options.cautionPeriapsisKm) {
        alerts.cautions.push({ id: 'orbit_periapsis_low', value: this.#roundNumber(periapsisKm, 1) });
      }
    }

    const metrics = summary.metrics ?? {};
    const lastImpulse = metrics.lastImpulse ?? null;

    return {
      body: {
        id: typeof body.id === 'string' ? body.id : null,
        name: typeof body.name === 'string' ? body.name : null,
      },
      altitude: {
        meters: altitudeMeters,
        kilometers: altitudeKm,
      },
      radiusKm,
      speed: {
        metersPerSecond: Number.isFinite(speed) ? this.#roundNumber(speed, 1) : null,
        kilometersPerSecond: speedKmPerSec,
      },
      elements: {
        eccentricity: Number.isFinite(eccentricity) ? this.#roundNumber(eccentricity, 4) : null,
        inclinationDeg: Number.isFinite(inclinationDeg) ? this.#roundNumber(inclinationDeg, 2) : null,
        raanDeg: Number.isFinite(raanDeg) ? this.#roundNumber(raanDeg, 2) : null,
        argumentOfPeriapsisDeg: Number.isFinite(argPeriapsisDeg)
          ? this.#roundNumber(argPeriapsisDeg, 2)
          : null,
        trueAnomalyDeg: Number.isFinite(trueAnomalyDeg) ? this.#roundNumber(trueAnomalyDeg, 2) : null,
        periapsisKm: Number.isFinite(periapsisAltitude) ? this.#roundNumber(periapsisAltitude / 1000, 1) : null,
        apoapsisKm: Number.isFinite(apoapsisAltitude) ? this.#roundNumber(apoapsisAltitude / 1000, 1) : null,
        semiMajorAxisKm: Number.isFinite(semiMajorAxis) ? this.#roundNumber(semiMajorAxis / 1000, 1) : null,
        periodMinutes: Number.isFinite(periodSeconds) ? this.#roundNumber(periodSeconds / 60, 2) : null,
      },
      metrics: {
        totalDeltaVMps: Number.isFinite(metrics.totalDeltaVMps)
          ? this.#roundNumber(metrics.totalDeltaVMps, 1)
          : null,
        lastImpulse: lastImpulse
          ? {
              magnitude: Number.isFinite(lastImpulse.magnitude)
                ? this.#roundNumber(lastImpulse.magnitude, 1)
                : null,
              frame: lastImpulse.frame ?? null,
              appliedAtSeconds: this.#coerceNumber(lastImpulse.appliedAtSeconds),
            }
          : null,
      },
      alerts,
    };
  }

  #summarizeAutopilot(stats, resolvePad) {
    if (!stats) {
      return null;
    }

    const activeLimit = Math.max(0, Number(this.options.activeAutopilotLimit) || 0);
    const activeAutopilotsRaw = Array.isArray(stats.activeAutopilots) ? stats.activeAutopilots : [];
    const activeAutopilots = activeLimit > 0 ? activeAutopilotsRaw.slice(0, activeLimit) : activeAutopilotsRaw.slice();
    const augmentedActive = activeAutopilots.map((entry) => ({
      ...entry,
      pad: resolvePad ? resolvePad(entry.eventId) : null,
    }));

    let primary = null;
    if (activeAutopilotsRaw.length > 0) {
      const sorted = [...activeAutopilotsRaw].sort((a, b) => {
        const aRemaining = Number.isFinite(a.remainingSeconds) ? a.remainingSeconds : Infinity;
        const bRemaining = Number.isFinite(b.remainingSeconds) ? b.remainingSeconds : Infinity;
        return aRemaining - bRemaining;
      });
      primary = { ...sorted[0], pad: resolvePad ? resolvePad(sorted[0].eventId) : null };
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
      activeAutopilots: augmentedActive,
      primary,
    };
  }

  #normalizePadMap(padsOption) {
    if (!padsOption) {
      return new Map();
    }
    if (padsOption instanceof Map) {
      return new Map(padsOption);
    }
    const map = new Map();
    if (Array.isArray(padsOption)) {
      for (const entry of padsOption) {
        if (entry && entry.id) {
          map.set(entry.id, entry);
        }
      }
      return map;
    }
    if (typeof padsOption === 'object') {
      for (const [key, value] of Object.entries(padsOption)) {
        if (value && typeof value === 'object') {
          map.set(key, value);
        }
      }
      return map;
    }
    return map;
  }

  #buildEventPadMap(eventsOption) {
    const map = new Map();
    if (!eventsOption) {
      return map;
    }
    if (eventsOption instanceof Map) {
      for (const [id, event] of eventsOption.entries()) {
        if (event?.padId) {
          map.set(id, event.padId);
        }
      }
      return map;
    }
    if (Array.isArray(eventsOption)) {
      for (const event of eventsOption) {
        if (event?.id && event.padId) {
          map.set(event.id, event.padId);
        }
      }
    }
    return map;
  }

  #buildEventLookup(eventsOption) {
    const map = new Map();
    if (!eventsOption) {
      return map;
    }
    if (eventsOption instanceof Map) {
      for (const [key, event] of eventsOption.entries()) {
        const id = String(key ?? event?.id ?? '');
        if (!id) {
          continue;
        }
        if (event && typeof event === 'object') {
          map.set(id, event);
        }
      }
      return map;
    }
    if (Array.isArray(eventsOption)) {
      for (const event of eventsOption) {
        const id = event?.id ?? event?.eventId ?? null;
        if (!id || !event || typeof event !== 'object') {
          continue;
        }
        map.set(String(id), event);
      }
      return map;
    }
    if (typeof eventsOption === 'object') {
      for (const [key, event] of Object.entries(eventsOption)) {
        if (!event || typeof event !== 'object') {
          continue;
        }
        map.set(String(key), event);
      }
    }
    return map;
  }

  #resolvePadForEvent(eventId, scheduler) {
    if (!eventId) {
      return null;
    }
    const key = String(eventId);
    let padId = this.eventPadMap.get(key) ?? null;
    if (!padId && typeof scheduler?.getEventById === 'function') {
      const event = scheduler.getEventById(key);
      padId = event?.padId ?? null;
    }
    if (!padId) {
      return null;
    }
    const pad = this.padMap.get(padId) ?? null;
    return this.#summarizePad(pad, padId);
  }

  #resolveEventById(eventId, scheduler) {
    if (!eventId) {
      return null;
    }
    const key = String(eventId);
    if (scheduler && typeof scheduler.getEventById === 'function') {
      try {
        const resolved = scheduler.getEventById(key);
        if (resolved && typeof resolved === 'object') {
          return resolved;
        }
      } catch (error) {
        // Ignore scheduler lookup errors and fall back to the cached map.
      }
    }
    return this.eventLookup.get(key) ?? null;
  }

  #summarizePad(pad, padId) {
    if (!pad) {
      if (!padId) {
        return null;
      }
      return { id: padId, purpose: null };
    }

    const parameters = pad.parameters ?? {};

    return {
      id: pad.id ?? padId ?? null,
      purpose: pad.purpose ?? null,
      delivery: {
        get: typeof pad.deliveryGet === 'string' ? pad.deliveryGet : null,
        getSeconds: this.#coerceNumber(pad.deliveryGetSeconds),
      },
      validUntil: {
        get: typeof pad.validUntilGet === 'string' ? pad.validUntilGet : null,
        getSeconds: this.#coerceNumber(pad.validUntilSeconds),
      },
      source: pad.source ?? null,
      parameters: {
        tig: this.#clonePadTime(parameters.tig),
        entryInterface: this.#clonePadTime(parameters.entryInterface),
        deltaVFtPerSec: this.#coerceNumber(parameters.deltaVFtPerSec),
        deltaVMetersPerSecond: this.#coerceNumber(parameters.deltaVMetersPerSecond),
        burnDurationSeconds: this.#coerceNumber(parameters.burnDurationSeconds),
        attitude: typeof parameters.attitude === 'string' ? parameters.attitude : null,
        rangeToTargetNm: this.#coerceNumber(parameters.rangeToTargetNm),
        flightPathAngleDeg: this.#coerceNumber(parameters.flightPathAngleDeg),
        vInfinityFtPerSec: this.#coerceNumber(parameters.vInfinityFtPerSec),
        vInfinityMetersPerSecond: this.#coerceNumber(parameters.vInfinityMetersPerSecond),
        notes: typeof parameters.notes === 'string' ? parameters.notes : null,
        raw: parameters.raw && typeof parameters.raw === 'object'
          ? { ...parameters.raw }
          : {},
      },
    };
  }

  #clonePadTime(time) {
    if (!time || typeof time !== 'object') {
      return null;
    }
    const get = typeof time.get === 'string' ? time.get : null;
    const getSeconds = this.#coerceNumber(time.getSeconds);
    if (get == null && getSeconds == null) {
      return null;
    }
    return { get, getSeconds };
  }

  #summarizeChecklists(stats, resolvePad) {
    if (!stats) {
      return null;
    }

    const limit = Math.max(0, Number(this.options.activeChecklistLimit) || 0);
    const active = limit > 0 ? stats.active.slice(0, limit) : stats.active.slice();
    const augmentedActive = active.map((entry) => ({
      ...entry,
      pad: resolvePad ? resolvePad(entry.eventId) : null,
    }));
    const chip = this.#selectChecklistChip(stats.active, resolvePad);

    return {
      totals: stats.totals,
      active: augmentedActive,
      chip,
    };
  }

  #selectChecklistChip(active, resolvePad) {
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
      pad: resolvePad ? resolvePad(selected.eventId) : null,
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
        if (entry.breadcrumb && typeof entry.breadcrumb === 'object') {
          const breadcrumb = { ...entry.breadcrumb };
          if (Array.isArray(entry.breadcrumb.chain)) {
            breadcrumb.chain = entry.breadcrumb.chain.map((item) => ({ ...item }));
          }
          summary.breadcrumb = breadcrumb;
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

  #summarizeScoreBreakdown(entry) {
    if (!entry || typeof entry !== 'object') {
      return null;
    }

    const score = this.#coerceNumber(entry.score);
    const weight = this.#coerceNumber(entry.weight);
    if (score === null && weight === null) {
      return null;
    }

    return {
      score,
      weight,
    };
  }

  #cloneNumberMap(map) {
    if (!map || typeof map !== 'object') {
      return {};
    }

    const result = {};
    for (const [key, value] of Object.entries(map)) {
      const numeric = this.#coerceNumber(value);
      if (numeric === null) {
        continue;
      }
      result[key] = numeric;
    }
    return result;
  }

  #formatStageLabel(stageId) {
    if (!stageId) {
      return null;
    }
    if (stageId === 'csm_sps') {
      return 'CSM SPS';
    }
    if (stageId === 'lm_descent') {
      return 'LM Descent';
    }
    if (stageId === 'lm_ascent') {
      return 'LM Ascent';
    }
    const spaced = stageId.replace(/_/g, ' ');
    return spaced.replace(/\b([a-z])/g, (match, letter) => letter.toUpperCase());
  }

  #coerceNumber(value) {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        return null;
      }
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : null;
    }
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

  #summarizeDocking(currentGetSeconds, context) {
    if (!this.dockingConfig) {
      return null;
    }

    const status = context?.docking ?? {};
    const scheduler = context?.scheduler ?? null;

    const eventId = status.eventId ?? status.event_id ?? this.dockingConfig.eventId ?? null;
    const event = this.#resolveEventById(eventId, scheduler);

    const openSeconds = this.#coerceNumber(
      event?.getOpenSeconds
        ?? event?.get_open_seconds
        ?? event?.openSeconds
        ?? event?.opensAtSeconds
        ?? event?.opens_at_seconds,
    );
    const closeSeconds = this.#coerceNumber(
      event?.getCloseSeconds
        ?? event?.get_close_seconds
        ?? event?.closeSeconds
        ?? event?.closesAtSeconds
        ?? event?.closes_at_seconds,
    );

    let progress = this.#coerceNumber(
      status.progress
        ?? status.sequenceProgress
        ?? status.sequence_progress
        ?? status.eventProgress
        ?? status.event_progress,
    );
    if (progress != null) {
      progress = this.#clamp(progress, 0, 1);
    } else if (
      Number.isFinite(openSeconds)
      && Number.isFinite(closeSeconds)
      && closeSeconds > openSeconds
    ) {
      const fraction = (currentGetSeconds - openSeconds) / (closeSeconds - openSeconds);
      progress = this.#clamp(fraction, 0, 1);
    } else if (
      Number.isFinite(closeSeconds)
      && currentGetSeconds >= closeSeconds
    ) {
      progress = 1;
    } else if (
      Number.isFinite(openSeconds)
      && currentGetSeconds < openSeconds
    ) {
      progress = 0;
    } else {
      progress = null;
    }

    const gateStatusMap = new Map();
    if (Array.isArray(status.gates)) {
      for (const entry of status.gates) {
        if (!entry || typeof entry !== 'object') {
          continue;
        }
        const id = entry.id ?? entry.gateId ?? entry.gate_id ?? null;
        if (!id) {
          continue;
        }
        gateStatusMap.set(String(id), {
          status: entry.status ?? null,
          progress: this.#clamp(
            this.#coerceNumber(entry.progress ?? entry.fraction ?? null),
            0,
            1,
          ),
          deadlineSeconds: this.#coerceNumber(
            entry.deadlineSeconds ?? entry.deadline_seconds ?? null,
          ),
          deadlineGet: typeof entry.deadlineGet === 'string' ? entry.deadlineGet : null,
          completedAtSeconds: this.#coerceNumber(
            entry.completedAtSeconds ?? entry.completed_at_seconds ?? null,
          ),
        });
      }
    }
    if (Array.isArray(status.completedGateIds)) {
      for (const id of status.completedGateIds) {
        if (!id) {
          continue;
        }
        const key = String(id);
        const existing = gateStatusMap.get(key) ?? {};
        gateStatusMap.set(key, { ...existing, status: existing.status ?? 'complete' });
      }
    }

    const gates = [];
    for (const gate of this.dockingConfig.gates) {
      const gateKey = gate.id ?? null;
      const override = gateKey ? gateStatusMap.get(String(gateKey)) : null;
      const gateProgress = override?.progress ?? progress;
      const statusLabel = this.#resolveGateStatus(gate, override, gateProgress);

      let deadlineSeconds = override?.deadlineSeconds ?? null;
      if (!Number.isFinite(deadlineSeconds)) {
        deadlineSeconds = this.#computeGateDeadline(gate, {
          eventOpenSeconds: openSeconds,
          eventCloseSeconds: closeSeconds,
        });
      }
      const deadlineGet = override?.deadlineGet
        ?? gate.deadlineGet
        ?? (Number.isFinite(deadlineSeconds) ? formatGET(Math.round(deadlineSeconds)) : null);
      const timeRemainingSeconds = Number.isFinite(deadlineSeconds)
        ? deadlineSeconds - currentGetSeconds
        : null;

      gates.push({
        id: gate.id,
        label: gate.label,
        rangeMeters: gate.rangeMeters,
        targetRateMps: gate.targetRateMps,
        tolerance: gate.tolerance,
        activationProgress: gate.activationProgress,
        completionProgress: gate.completionProgress,
        checklistId: gate.checklistId,
        notes: gate.notes,
        sources: gate.sources,
        deadlineSeconds: Number.isFinite(deadlineSeconds) ? deadlineSeconds : null,
        deadlineGet,
        status: statusLabel,
        progress: gateProgress != null ? this.#clamp(gateProgress, 0, 1) : null,
        completedAtSeconds: override?.completedAtSeconds ?? null,
        overdue: Number.isFinite(timeRemainingSeconds) ? timeRemainingSeconds < 0 : null,
        timeRemainingSeconds: timeRemainingSeconds ?? null,
      });
    }

    const activeGateId = status.activeGateId
      ?? status.active_gate_id
      ?? status.activeGate
      ?? this.#selectActiveGateId(gates);

    const rangeMeters = this.#coerceNumber(
      status.rangeMeters
        ?? status.range_meters
        ?? status.range
        ?? status.distanceMeters
        ?? status.distance_meters,
    );
    const closingRateMps = this.#coerceNumber(
      status.closingRateMps
        ?? status.closing_rate_mps
        ?? status.rangeRateMps
        ?? status.range_rate_mps
        ?? status.relativeVelocityMps
        ?? status.relative_velocity_mps,
    );
    const lateralRateMps = this.#coerceNumber(
      status.lateralRateMps
        ?? status.lateral_rate_mps
        ?? status.crossRangeRateMps
        ?? status.cross_range_rate_mps,
    );
    const predictedContactVelocityMps = this.#coerceNumber(
      status.predictedContactVelocityMps
        ?? status.predicted_contact_velocity_mps
        ?? status.contactVelocityMps
        ?? status.contact_velocity_mps,
    );

    const rcs = this.#normalizeDockingRcsStatus(status.rcs ?? status.rcsStatus ?? null);

    const summary = {
      eventId,
      activeGateId,
      activeGate: activeGateId,
      startRangeMeters: this.dockingConfig.startRangeMeters,
      endRangeMeters: this.dockingConfig.endRangeMeters,
      notes: this.dockingConfig.notes,
      progress,
      gates,
      rangeMeters,
      closingRateMps,
      lateralRateMps,
      predictedContactVelocityMps,
      rcs,
    };

    if (this.dockingConfig.version != null) {
      summary.version = this.dockingConfig.version;
    }

    return summary;
  }

  #normalizeDockingRcsStatus(rcsStatus) {
    if (!rcsStatus || typeof rcsStatus !== 'object') {
      return null;
    }

    const quads = [];
    if (Array.isArray(rcsStatus.quads)) {
      for (const entry of rcsStatus.quads) {
        if (!entry || typeof entry !== 'object') {
          continue;
        }
        const id = entry.id ?? entry.quadId ?? entry.quad_id ?? null;
        if (!id) {
          continue;
        }
        quads.push({
          id,
          enabled: entry.enabled != null ? Boolean(entry.enabled) : null,
          dutyCyclePct: this.#coerceNumber(
            entry.dutyCyclePct
              ?? entry.duty_cycle_pct
              ?? entry.dutyCycle
              ?? entry.duty_cycle,
          ),
        });
      }
    }

    const remaining = this.#cloneNumberMap(
      rcsStatus.propellantKgRemaining
        ?? rcsStatus.propellant_remaining
        ?? rcsStatus.propellantKg
        ?? rcsStatus.remainingKg
        ?? null,
    );
    const budget = this.#cloneNumberMap(
      rcsStatus.propellantKgBudget
        ?? rcsStatus.propellant_budget
        ?? rcsStatus.propellantBudget
        ?? null,
    );

    if (quads.length === 0 && Object.keys(remaining).length === 0 && Object.keys(budget).length === 0) {
      return null;
    }

    const summary = {};
    if (quads.length > 0) {
      summary.quads = quads;
    }
    if (Object.keys(remaining).length > 0) {
      summary.propellantKgRemaining = remaining;
    }
    if (Object.keys(budget).length > 0) {
      summary.propellantKgBudget = budget;
    }
    return summary;
  }

  #selectActiveGateId(gates) {
    if (!Array.isArray(gates) || gates.length === 0) {
      return null;
    }

    const completed = gates.filter((gate) => gate.status === 'complete');
    if (completed.length === gates.length) {
      return completed[completed.length - 1]?.id ?? null;
    }

    const active = gates.find((gate) => gate.status === 'active');
    if (active) {
      return active.id ?? null;
    }

    const pending = gates.find((gate) => gate.status !== 'complete');
    return pending?.id ?? null;
  }

  #resolveGateStatus(gate, override, progress) {
    if (override?.status) {
      return override.status;
    }
    const gateProgress = override?.progress ?? progress;
    const completion = this.#coerceNumber(gate.completionProgress);
    const activation = this.#coerceNumber(gate.activationProgress);

    if (gateProgress != null) {
      const normalized = this.#clamp(gateProgress, 0, 1);
      if (completion != null && normalized >= completion - 1e-6) {
        return 'complete';
      }
      if (activation != null && normalized >= activation - 1e-6) {
        return 'active';
      }
      return 'pending';
    }

    if (completion != null && completion <= 0) {
      return 'complete';
    }
    if (activation != null && activation <= 0) {
      return 'pending';
    }
    return 'pending';
  }

  #normalizeDockingConfig(config) {
    if (!config || typeof config !== 'object') {
      return null;
    }

    const version = Number.isFinite(config.version) ? Number(config.version) : null;
    const eventId = typeof config.eventId === 'string' && config.eventId.trim().length > 0
      ? config.eventId.trim()
      : null;
    const startRangeMeters = this.#coerceNumber(
      config.startRangeMeters ?? config.start_range_meters ?? config.startRange ?? null,
    );
    const endRangeMeters = this.#coerceNumber(
      config.endRangeMeters ?? config.end_range_meters ?? config.endRange ?? null,
    );
    const notes = typeof config.notes === 'string' && config.notes.trim().length > 0
      ? config.notes.trim()
      : null;

    const gatesRaw = Array.isArray(config.gates) ? config.gates : [];
    const gates = [];
    for (const entry of gatesRaw) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }
      const id = typeof entry.id === 'string' && entry.id.trim().length > 0 ? entry.id.trim() : null;
      if (!id) {
        continue;
      }
      const label = typeof entry.label === 'string' && entry.label.trim().length > 0
        ? entry.label.trim()
        : id;
      const rangeMeters = this.#coerceNumber(
        entry.rangeMeters ?? entry.range_meters ?? entry.range ?? null,
      );
      const targetRateMps = this.#coerceNumber(
        entry.targetRateMps
          ?? entry.target_rate_mps
          ?? entry.targetRate
          ?? entry.target_rate
          ?? null,
      );
      const activationProgress = this.#clamp(
        this.#coerceNumber(entry.activationProgress ?? entry.activation_progress ?? null),
        0,
        1,
      );
      const completionProgress = this.#clamp(
        this.#coerceNumber(entry.completionProgress ?? entry.completion_progress ?? null),
        0,
        1,
      );

      let tolerancePlus = null;
      let toleranceMinus = null;
      if (entry.tolerance && typeof entry.tolerance === 'object') {
        tolerancePlus = this.#coerceNumber(entry.tolerance.plus ?? entry.tolerance.max ?? null);
        toleranceMinus = this.#coerceNumber(entry.tolerance.minus ?? entry.tolerance.min ?? null);
      }

      const checklistId = typeof entry.checklistId === 'string' && entry.checklistId.trim().length > 0
        ? entry.checklistId.trim()
        : null;
      const notesValue = typeof entry.notes === 'string' && entry.notes.trim().length > 0
        ? entry.notes.trim()
        : null;
      const sources = Array.isArray(entry.sources)
        ? entry.sources
            .map((source) => (typeof source === 'string' ? source.trim() : ''))
            .filter((value) => value.length > 0)
        : [];

      const deadlineGet = typeof entry.deadlineGet === 'string' && entry.deadlineGet.trim().length > 0
        ? entry.deadlineGet.trim()
        : null;
      let deadlineSeconds = this.#coerceNumber(
        entry.deadlineSeconds ?? entry.deadline_seconds ?? null,
      );
      if (deadlineSeconds == null && deadlineGet) {
        const parsed = parseGET(deadlineGet);
        deadlineSeconds = parsed != null ? parsed : null;
      }
      const deadlineOffsetSeconds = this.#coerceNumber(
        entry.deadlineOffsetSeconds ?? entry.deadline_offset_seconds ?? null,
      );

      gates.push({
        id,
        label,
        rangeMeters,
        targetRateMps,
        tolerance: { plus: tolerancePlus, minus: toleranceMinus },
        activationProgress,
        completionProgress,
        checklistId,
        notes: notesValue,
        sources,
        deadlineGet,
        deadlineSeconds,
        deadlineOffsetSeconds,
      });
    }

    gates.sort((a, b) => {
      const aProgress = a.activationProgress ?? a.completionProgress ?? Number.POSITIVE_INFINITY;
      const bProgress = b.activationProgress ?? b.completionProgress ?? Number.POSITIVE_INFINITY;
      if (aProgress !== bProgress) {
        return aProgress - bProgress;
      }
      const aRange = Number.isFinite(a.rangeMeters) ? a.rangeMeters : Number.POSITIVE_INFINITY;
      const bRange = Number.isFinite(b.rangeMeters) ? b.rangeMeters : Number.POSITIVE_INFINITY;
      return aRange - bRange;
    });

    return {
      version,
      eventId,
      startRangeMeters,
      endRangeMeters,
      notes,
      gates,
    };
  }

  #computeGateDeadline(gate, { eventOpenSeconds, eventCloseSeconds } = {}) {
    if (!gate) {
      return null;
    }
    if (Number.isFinite(gate.deadlineSeconds)) {
      return gate.deadlineSeconds;
    }
    if (Number.isFinite(gate.deadlineOffsetSeconds) && Number.isFinite(eventOpenSeconds)) {
      return eventOpenSeconds + gate.deadlineOffsetSeconds;
    }
    if (
      Number.isFinite(eventOpenSeconds)
      && Number.isFinite(eventCloseSeconds)
      && eventCloseSeconds > eventOpenSeconds
    ) {
      const completion = this.#coerceNumber(gate.completionProgress);
      if (completion != null) {
        const fraction = this.#clamp(completion, 0, 1);
        const duration = eventCloseSeconds - eventOpenSeconds;
        return eventOpenSeconds + (duration * fraction);
      }
      const activation = this.#coerceNumber(gate.activationProgress);
      if (activation != null) {
        const fraction = this.#clamp(activation, 0, 1);
        const duration = eventCloseSeconds - eventOpenSeconds;
        return eventOpenSeconds + (duration * fraction);
      }
    }
    return null;
  }

  #clamp(value, min = 0, max = 1) {
    if (!Number.isFinite(value)) {
      return null;
    }
    if (value < min) {
      return min;
    }
    if (value > max) {
      return max;
    }
    return value;
  }
}

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}
