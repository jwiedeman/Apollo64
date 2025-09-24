import { formatGET, parseGET } from '../utils/time.js';

const METERS_TO_FEET = 3.28084;

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
  audioPendingLimit: 8,
  audioActiveLimit: 4,
  audioQueueLimit: 4,
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
    this.entryConfig = this.#normalizeEntryConfig(this.options.entry);
    const checklistBundle = this.#normalizeUiBundle(this.options.uiChecklists, 'checklists');
    this.uiChecklists = checklistBundle.map;
    this.uiChecklistItems = checklistBundle.items;
    const panelBundle = this.#normalizeUiBundle(this.options.uiPanels, 'panels');
    this.uiPanels = panelBundle.map;
    this.uiPanelItems = panelBundle.items;
    const workspaceBundle = this.#normalizeUiBundle(this.options.uiWorkspaces, 'presets');
    this.uiWorkspaces = workspaceBundle.map;
    this.uiWorkspaceItems = workspaceBundle.items;
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
    const panels = context.panelState?.snapshot
      ? context.panelState.snapshot({ includeHistory: false })
      : null;

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
    const entry = this.#summarizeEntry(currentGetSeconds, context, { orbitSummary });
    const agcState =
      context.agcState
      ?? (context.agcRuntime && typeof context.agcRuntime.snapshot === 'function'
        ? context.agcRuntime.snapshot()
        : null);
    const agc = this.#summarizeAgc(agcState);

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

    if (panels) {
      frame.panels = panels;
    }

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

    if (entry) {
      frame.entry = entry;
    }

    if (agc) {
      frame.agc = agc;
    }

    const audio = this.#summarizeAudio({
      audio: context.audio ?? null,
      binder: context.audioBinder ?? null,
      binderStats: context.audioBinderStats ?? null,
      dispatcher: context.audioDispatcher ?? null,
      dispatcherStats: context.audioDispatcherStats ?? null,
    });
    if (audio) {
      frame.audio = audio;
    }

    const performance = this.#summarizePerformance(context.performance ?? null);
    if (performance) {
      frame.performance = performance;
    }

    const uiSummary = this.#summarizeUiDefinitions();
    if (uiSummary) {
      frame.ui = uiSummary;
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

  #summarizeAgc(state) {
    if (!state) {
      return null;
    }

    const registers = Array.isArray(state.registers)
      ? state.registers.map((entry) => ({
          id: entry.id ?? null,
          label: entry.label ?? entry.id ?? null,
          units: entry.units ?? null,
          value: entry.value ?? null,
        }))
      : [];

    const history = Array.isArray(state.history)
      ? state.history.slice(0, 8).map((item) => ({
          id: item.id ?? null,
          macroId: item.macroId ?? null,
          macroLabel: item.macroLabel ?? null,
          program: item.program ?? null,
          verbLabel: item.verbLabel ?? null,
          nounLabel: item.nounLabel ?? null,
          actor: item.actor ?? null,
          source: item.source ?? null,
          get: item.get ?? null,
          issues: Array.isArray(item.issues) ? item.issues.map((issue) => ({ ...issue })) : [],
        }))
      : [];

    const pendingAck = state.pendingAck
      ? {
          macroId: state.pendingAck.macroId ?? null,
          macroLabel: state.pendingAck.macroLabel ?? null,
          issuedAtSeconds: state.pendingAck.issuedAtSeconds ?? null,
          issuedAtGet: Number.isFinite(state.pendingAck.issuedAtSeconds)
            ? formatGET(state.pendingAck.issuedAtSeconds)
            : null,
        }
      : null;

    const lastUpdateSeconds = state.lastUpdatedSeconds ?? null;

    return {
      program: {
        current: state.program?.current ?? null,
        majorMode: state.program?.majorMode ?? null,
        subMode: state.program?.subMode ?? null,
        pendingAck: Boolean(state.pendingAck),
        lastVerb: state.display?.verb ?? null,
        lastNoun: state.display?.noun ?? null,
        verbLabel: state.display?.verbLabel ?? null,
        nounLabel: state.display?.nounLabel ?? null,
        macroId: state.display?.macroId ?? null,
        macroLabel: state.display?.macroLabel ?? null,
        mode: state.display?.mode ?? null,
        lastUpdateSeconds,
        lastUpdateGet: Number.isFinite(lastUpdateSeconds) ? formatGET(lastUpdateSeconds) : null,
      },
      annunciators: {
        pro: Boolean(state.annunciators?.pro),
        keyRel: Boolean(state.annunciators?.keyRel),
        oprErr: Boolean(state.annunciators?.oprErr),
        temp: Boolean(state.annunciators?.temp),
        gimbalLock: Boolean(state.annunciators?.gimbalLock),
      },
      registers,
      history,
      pendingAck,
      metrics: state.metrics ? { ...state.metrics } : null,
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

  #summarizeAudio({ audio = null, binder = null, binderStats = null, dispatcher = null, dispatcherStats = null } = {}) {
    if (audio && typeof audio === 'object') {
      try {
        return JSON.parse(JSON.stringify(audio));
      } catch (error) {
        return { ...audio };
      }
    }

    const resolvedBinderStats = binderStats
      ?? (binder && typeof binder.statsSnapshot === 'function' ? binder.statsSnapshot() : null);
    const resolvedDispatcherStats = dispatcherStats
      ?? (dispatcher && typeof dispatcher.statsSnapshot === 'function' ? dispatcher.statsSnapshot() : null);

    const summary = {};
    const binderSummary = this.#summarizeAudioBinder(resolvedBinderStats);
    const dispatcherSummary = this.#summarizeAudioDispatcher(resolvedDispatcherStats);
    if (binderSummary) {
      summary.binder = binderSummary;
    }
    if (dispatcherSummary) {
      summary.dispatcher = dispatcherSummary;
    }

    const pending = this.#summarizeAudioPending(binder);
    if (pending) {
      summary.pending = pending;
    }

    const active = this.#summarizeAudioActive(dispatcher, dispatcherSummary);
    if (active) {
      summary.active = active;
    }

    const queued = this.#summarizeAudioQueued(dispatcher, dispatcherSummary);
    if (queued) {
      summary.queued = queued;
    }

    return Object.keys(summary).length > 0 ? summary : null;
  }

  #summarizePerformance(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') {
      return null;
    }

    const summary = {};

    const generatedSeconds = this.#coerceNumber(snapshot.generatedAtSeconds ?? snapshot.generated_at_seconds);
    if (Number.isFinite(generatedSeconds)) {
      summary.generatedAtSeconds = generatedSeconds;
      summary.generatedAt = formatGET(Math.round(generatedSeconds));
    } else if (typeof snapshot.generatedAt === 'string' && snapshot.generatedAt.trim().length > 0) {
      summary.generatedAt = snapshot.generatedAt.trim();
    }

    if (snapshot.tick && typeof snapshot.tick === 'object') {
      const tickSummary = {
        count: this.#coerceNumber(snapshot.tick.count),
        expectedMs: this.#roundNullable(snapshot.tick.expectedMs, 3),
        averageMs: this.#roundNullable(snapshot.tick.averageMs, 3),
        maxMs: this.#roundNullable(snapshot.tick.maxMs, 3),
        minMs: this.#roundNullable(snapshot.tick.minMs, 3),
        lastMs: this.#roundNullable(snapshot.tick.lastMs, 3),
      };
      if (snapshot.tick.drift && typeof snapshot.tick.drift === 'object') {
        const driftSummary = {
          averageMs: this.#roundNullable(snapshot.tick.drift.averageMs, 3),
          maxMs: this.#roundNullable(snapshot.tick.drift.maxMs, 3),
          minMs: this.#roundNullable(snapshot.tick.drift.minMs, 3),
          lastMs: this.#roundNullable(snapshot.tick.drift.lastMs, 3),
          maxAbsMs: this.#roundNullable(snapshot.tick.drift.maxAbsMs ?? snapshot.tick.drift.maxAbs, 3),
        };
        if (Object.values(driftSummary).some((value) => value != null)) {
          tickSummary.drift = driftSummary;
        }
      }
      summary.tick = tickSummary;
    }

    if (snapshot.hud && typeof snapshot.hud === 'object') {
      const hudSummary = {
        renderCount: this.#coerceNumber(snapshot.hud.renderCount),
        renderMs: {
          average: this.#roundNullable(snapshot.hud.renderMs?.average, 3),
          max: this.#roundNullable(snapshot.hud.renderMs?.max, 3),
          min: this.#roundNullable(snapshot.hud.renderMs?.min, 3),
          last: this.#roundNullable(snapshot.hud.renderMs?.last, 3),
        },
      };
      if (snapshot.hud.drop && typeof snapshot.hud.drop === 'object') {
        hudSummary.drop = {
          total: this.#coerceNumber(snapshot.hud.drop.total),
          consecutive: this.#coerceNumber(snapshot.hud.drop.consecutive),
          maxConsecutive: this.#coerceNumber(snapshot.hud.drop.maxConsecutive),
          last: this.#coerceNumber(snapshot.hud.drop.last),
          lastDroppedAtSeconds: this.#coerceNumber(snapshot.hud.drop.lastDroppedAtSeconds),
          lastDroppedAt: snapshot.hud.drop.lastDroppedAt ?? null,
        };
        if (!hudSummary.drop.lastDroppedAt && Number.isFinite(hudSummary.drop.lastDroppedAtSeconds)) {
          hudSummary.drop.lastDroppedAt = formatGET(Math.round(hudSummary.drop.lastDroppedAtSeconds));
        }
      }
      const lastRenderSeconds = this.#coerceNumber(snapshot.hud.lastRenderGetSeconds);
      if (Number.isFinite(lastRenderSeconds)) {
        hudSummary.lastRenderGetSeconds = lastRenderSeconds;
        hudSummary.lastRenderGet = formatGET(Math.round(lastRenderSeconds));
      } else if (typeof snapshot.hud.lastRenderGet === 'string') {
        hudSummary.lastRenderGet = snapshot.hud.lastRenderGet;
      }
      const scheduledSeconds = this.#coerceNumber(snapshot.hud.lastScheduledGetSeconds);
      if (Number.isFinite(scheduledSeconds)) {
        hudSummary.lastScheduledGetSeconds = scheduledSeconds;
        hudSummary.lastScheduledGet = formatGET(Math.round(scheduledSeconds));
      } else if (typeof snapshot.hud.lastScheduledGet === 'string') {
        hudSummary.lastScheduledGet = snapshot.hud.lastScheduledGet;
      }
      const intervalSeconds = this.#coerceNumber(snapshot.hud.intervalSeconds);
      if (Number.isFinite(intervalSeconds)) {
        hudSummary.intervalSeconds = intervalSeconds;
      }
      summary.hud = hudSummary;
    }

    if (snapshot.audio && typeof snapshot.audio === 'object') {
      const audioSummary = {
        lastActiveTotal: this.#coerceNumber(snapshot.audio.lastActiveTotal),
        lastQueuedTotal: this.#coerceNumber(snapshot.audio.lastQueuedTotal),
        maxActiveTotal: this.#coerceNumber(snapshot.audio.maxActiveTotal),
        maxQueuedTotal: this.#coerceNumber(snapshot.audio.maxQueuedTotal),
        lastSampledAtSeconds: this.#coerceNumber(snapshot.audio.lastSampledAtSeconds),
        lastSampledAt: typeof snapshot.audio.lastSampledAt === 'string' ? snapshot.audio.lastSampledAt : null,
      };
      if (!audioSummary.lastSampledAt && Number.isFinite(audioSummary.lastSampledAtSeconds)) {
        audioSummary.lastSampledAt = formatGET(Math.round(audioSummary.lastSampledAtSeconds));
      }
      summary.audio = audioSummary;
    }

    if (snapshot.input && typeof snapshot.input === 'object') {
      const inputSummary = {
        count: this.#coerceNumber(snapshot.input.count),
        averageLatencyMs: this.#roundNullable(snapshot.input.averageLatencyMs ?? snapshot.input.average, 3),
        maxLatencyMs: this.#roundNullable(snapshot.input.maxLatencyMs ?? snapshot.input.max, 3),
        minLatencyMs: this.#roundNullable(snapshot.input.minLatencyMs ?? snapshot.input.min, 3),
        lastLatencyMs: this.#roundNullable(snapshot.input.lastLatencyMs ?? snapshot.input.last, 3),
        lastLatencyGetSeconds: this.#coerceNumber(snapshot.input.lastLatencyGetSeconds),
        lastLatencyGet: typeof snapshot.input.lastLatencyGet === 'string' ? snapshot.input.lastLatencyGet : null,
      };
      if (!inputSummary.lastLatencyGet && Number.isFinite(inputSummary.lastLatencyGetSeconds)) {
        inputSummary.lastLatencyGet = formatGET(Math.round(inputSummary.lastLatencyGetSeconds));
      }
      summary.input = inputSummary;
    }

    if (snapshot.logging && typeof snapshot.logging === 'object') {
      const loggingSummary = {
        intervalSeconds: this.#coerceNumber(snapshot.logging.intervalSeconds),
        lastLogGetSeconds: this.#coerceNumber(snapshot.logging.lastLogGetSeconds),
        lastLogGet: typeof snapshot.logging.lastLogGet === 'string' ? snapshot.logging.lastLogGet : null,
      };
      if (!loggingSummary.lastLogGet && Number.isFinite(loggingSummary.lastLogGetSeconds)) {
        loggingSummary.lastLogGet = formatGET(Math.round(loggingSummary.lastLogGetSeconds));
      }
      summary.logging = loggingSummary;
    }

    if (snapshot.overview && typeof snapshot.overview === 'object') {
      summary.overview = {
        tickAvgMs: this.#roundNullable(snapshot.overview.tickAvgMs ?? snapshot.overview.tick_avg_ms, 3),
        tickMaxMs: this.#roundNullable(snapshot.overview.tickMaxMs ?? snapshot.overview.tick_max_ms, 3),
        tickDriftMaxAbsMs: this.#roundNullable(
          snapshot.overview.tickDriftMaxAbsMs ?? snapshot.overview.tick_drift_max_abs_ms,
          3,
        ),
        hudAvgMs: this.#roundNullable(snapshot.overview.hudAvgMs ?? snapshot.overview.hud_avg_ms, 3),
        hudMaxMs: this.#roundNullable(snapshot.overview.hudMaxMs ?? snapshot.overview.hud_max_ms, 3),
        hudDrops: this.#coerceNumber(snapshot.overview.hudDrops ?? snapshot.overview.hud_drops),
        hudMaxDropStreak: this.#coerceNumber(
          snapshot.overview.hudMaxDropStreak ?? snapshot.overview.hud_max_drop_streak,
        ),
        audioMaxActive: this.#coerceNumber(snapshot.overview.audioMaxActive ?? snapshot.overview.audio_max_active),
        audioMaxQueued: this.#coerceNumber(snapshot.overview.audioMaxQueued ?? snapshot.overview.audio_max_queued),
        inputAvgMs: this.#roundNullable(snapshot.overview.inputAvgMs ?? snapshot.overview.input_avg_ms, 3),
        inputMaxMs: this.#roundNullable(snapshot.overview.inputMaxMs ?? snapshot.overview.input_max_ms, 3),
      };
    }

    return summary;
  }

  #summarizeAudioBinder(stats) {
    if (!stats || typeof stats !== 'object') {
      return null;
    }
    const totalTriggers = this.#coerceNumber(stats.totalTriggers);
    const pendingCount = this.#coerceNumber(stats.pendingCount);
    const lastSeconds = this.#coerceNumber(stats.lastTriggeredAtSeconds);
    return {
      totalTriggers: Number.isFinite(totalTriggers) ? totalTriggers : null,
      pendingCount: Number.isFinite(pendingCount) ? pendingCount : null,
      lastCueId: stats.lastCueId ?? null,
      lastTriggeredAtSeconds: Number.isFinite(lastSeconds) ? lastSeconds : null,
      lastTriggeredAt: stats.lastTriggeredAt
        ?? (Number.isFinite(lastSeconds) ? this.#formatGetSeconds(lastSeconds) : null),
    };
  }

  #summarizeAudioDispatcher(stats) {
    if (!stats || typeof stats !== 'object') {
      return null;
    }
    const played = this.#coerceNumber(stats.played);
    const stopped = this.#coerceNumber(stats.stopped);
    const suppressed = this.#coerceNumber(stats.suppressed);
    const dropped = this.#coerceNumber(stats.dropped);
    const lastSeconds = this.#coerceNumber(stats.lastStartedAtSeconds ?? stats.lastStartedAt);
    return {
      played: Number.isFinite(played) ? played : null,
      stopped: Number.isFinite(stopped) ? stopped : null,
      suppressed: Number.isFinite(suppressed) ? suppressed : null,
      dropped: Number.isFinite(dropped) ? dropped : null,
      lastCueId: stats.lastCueId ?? null,
      lastStartedAtSeconds: Number.isFinite(lastSeconds) ? lastSeconds : null,
      lastStartedAt: stats.lastStartedAt
        ?? (Number.isFinite(lastSeconds) ? this.#formatGetSeconds(lastSeconds) : null),
      activeBuses: this.#normalizeCountMap(stats.activeBuses),
      queuedBuses: this.#normalizeCountMap(stats.queuedBuses),
    };
  }

  #summarizeAudioPending(binder) {
    if (!binder || typeof binder.peekPending !== 'function') {
      return null;
    }
    const limit = Math.max(0, Number(this.options.audioPendingLimit) || 0);
    if (limit === 0) {
      return null;
    }
    const pending = binder.peekPending?.();
    if (!Array.isArray(pending) || pending.length === 0) {
      return null;
    }
    const selected = pending.slice(-limit);
    const results = [];
    for (const entry of selected) {
      const summarized = this.#summarizeAudioTrigger(entry);
      if (summarized) {
        results.push(summarized);
      }
    }
    return results.length > 0 ? results : null;
  }

  #summarizeAudioActive(dispatcher, dispatcherSummary) {
    if (!dispatcher || typeof dispatcher.getBusState !== 'function') {
      return null;
    }
    const limit = Math.max(0, Number(this.options.audioActiveLimit) || 0);
    if (limit === 0) {
      return null;
    }
    const busIds = new Set();
    const activeBuses = dispatcherSummary?.activeBuses ?? {};
    for (const id of Object.keys(activeBuses)) {
      busIds.add(id);
    }
    if (busIds.size === 0) {
      return null;
    }
    const collected = [];
    for (const busId of busIds) {
      const state = dispatcher.getBusState(busId);
      if (!state || !Array.isArray(state.active)) {
        continue;
      }
      for (const record of state.active) {
        const summary = this.#summarizeActivePlayback(busId, record);
        if (summary) {
          collected.push(summary);
        }
      }
    }
    if (collected.length === 0) {
      return null;
    }
    collected.sort((a, b) => {
      const timeA = Number.isFinite(a.startedAtSeconds) ? a.startedAtSeconds : Number.POSITIVE_INFINITY;
      const timeB = Number.isFinite(b.startedAtSeconds) ? b.startedAtSeconds : Number.POSITIVE_INFINITY;
      if (timeA !== timeB) {
        return timeA - timeB;
      }
      return (a.cueId ?? '').localeCompare(b.cueId ?? '');
    });
    return collected.slice(0, limit);
  }

  #summarizeAudioQueued(dispatcher, dispatcherSummary) {
    if (!dispatcher || typeof dispatcher.getBusState !== 'function') {
      return null;
    }
    const limit = Math.max(0, Number(this.options.audioQueueLimit) || 0);
    if (limit === 0) {
      return null;
    }
    const busIds = new Set();
    const queuedBuses = dispatcherSummary?.queuedBuses ?? {};
    for (const id of Object.keys(queuedBuses)) {
      busIds.add(id);
    }
    if (busIds.size === 0) {
      return null;
    }
    const collected = [];
    for (const busId of busIds) {
      const state = dispatcher.getBusState(busId);
      if (!state || !Array.isArray(state.queue)) {
        continue;
      }
      for (const entry of state.queue) {
        const summary = this.#summarizeAudioTrigger({ ...entry, busId });
        if (summary) {
          summary.priority = Number.isFinite(entry?.priority) ? Number(entry.priority) : null;
          collected.push(summary);
        }
      }
    }
    if (collected.length === 0) {
      return null;
    }
    collected.sort((a, b) => {
      const priA = Number.isFinite(a.priority) ? a.priority : Number.NEGATIVE_INFINITY;
      const priB = Number.isFinite(b.priority) ? b.priority : Number.NEGATIVE_INFINITY;
      if (priA !== priB) {
        return priB - priA;
      }
      const timeA = Number.isFinite(a.triggeredAtSeconds) ? a.triggeredAtSeconds : Number.POSITIVE_INFINITY;
      const timeB = Number.isFinite(b.triggeredAtSeconds) ? b.triggeredAtSeconds : Number.POSITIVE_INFINITY;
      if (timeA !== timeB) {
        return timeA - timeB;
      }
      return (a.cueId ?? '').localeCompare(b.cueId ?? '');
    });
    return collected.slice(0, limit);
  }

  #summarizeAudioTrigger(entry) {
    if (!entry || typeof entry !== 'object') {
      return null;
    }
    const cueId = entry.cueId ?? entry.cue_id ?? entry.id ?? null;
    const triggeredSeconds = this.#coerceSeconds(entry.triggeredAtSeconds ?? entry.getSeconds ?? null);
    const metadata = entry.metadata ? JSON.parse(JSON.stringify(entry.metadata)) : null;
    return {
      cueId,
      severity: entry.severity ?? null,
      busId: entry.busId ?? entry.requestedBusId ?? null,
      sourceType: entry.sourceType ?? null,
      sourceId: entry.sourceId ?? null,
      categoryId: entry.categoryId ?? null,
      triggeredAtSeconds: Number.isFinite(triggeredSeconds) ? triggeredSeconds : null,
      triggeredAt: entry.triggeredAt ?? (Number.isFinite(triggeredSeconds) ? this.#formatGetSeconds(triggeredSeconds) : null),
      metadata,
    };
  }

  #summarizeActivePlayback(busId, record) {
    if (!record || typeof record !== 'object') {
      return null;
    }
    const triggered = this.#coerceSeconds(
      record.startedAtSeconds ?? record.trigger?.triggeredAtSeconds ?? record.trigger?.getSeconds ?? null,
    );
    const metadata = record.trigger?.metadata ? JSON.parse(JSON.stringify(record.trigger.metadata)) : null;
    return {
      busId: busId ?? null,
      cueId: record.cueId ?? null,
      categoryId: record.categoryId ?? record.trigger?.categoryId ?? null,
      severity: record.trigger?.severity ?? null,
      priority: Number.isFinite(record.priority) ? Number(record.priority) : null,
      loop: record.loop === true,
      startedAtSeconds: Number.isFinite(triggered) ? triggered : null,
      startedAt: Number.isFinite(triggered) ? this.#formatGetSeconds(triggered) : null,
      metadata,
    };
  }

  #summarizeCommunications(snapshot) {
    const base = {
      active: Boolean(snapshot?.active),
      nextWindowOpenGet: snapshot?.next_window_open_get ?? null,
      lastPadId: snapshot?.last_pad_id ?? null,
      scheduleCount: Number(snapshot?.schedule_count ?? 0) || 0,
      nextPassCueOnAcquire: snapshot?.next_pass_cue_on_acquire ?? null,
      nextPassCueChannel: snapshot?.next_pass_cue_channel ?? null,
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
          audioCueOnAcquire: snapshot.cue_on_acquire ?? null,
          audioCueOnLoss: snapshot.cue_on_loss ?? null,
          audioChannelOnAcquire: snapshot.cue_channel_on_acquire ?? null,
          audioChannelOnLoss: snapshot.cue_channel_on_loss ?? null,
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
          cueOnAcquire: snapshot.next_pass_cue_on_acquire ?? null,
          cueChannel: snapshot.next_pass_cue_channel ?? null,
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

    const result = {
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

    const history = Array.isArray(summary.history)
      ? summary.history
        .map((entry) => this.#summarizeScoreHistoryEntry(entry))
        .filter((entry) => entry != null)
      : null;
    if (history && history.length > 0) {
      result.history = history;
    }

    const timelineBucketSeconds = this.#coerceNumber(manual.timelineBucketSeconds);
    const manualTimeline = Array.isArray(manual.timeline)
      ? manual.timeline
        .map((entry) => this.#summarizeManualTimelineEntry(entry))
        .filter((entry) => entry != null)
      : [];
    if (timelineBucketSeconds != null) {
      result.manual.timelineBucketSeconds = timelineBucketSeconds;
    }
    result.manual.timeline = manualTimeline;

    const ratingDelta = this.#summarizeScoreDelta(summary.rating?.delta ?? null);
    if (ratingDelta) {
      result.rating.delta = ratingDelta;
    }

    return result;
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

  #normalizeEntryConfig(raw) {
    if (!raw || typeof raw !== 'object') {
      return null;
    }

    const padIdRaw = raw.padId ?? raw.pad_id;
    const padId = typeof padIdRaw === 'string' ? padIdRaw.trim() : null;

    const events = {};
    if (raw.events && typeof raw.events === 'object') {
      for (const [key, value] of Object.entries(raw.events)) {
        if (typeof key !== 'string' || typeof value !== 'string') {
          continue;
        }
        const trimmedKey = key.trim();
        const trimmedValue = value.trim();
        if (!trimmedKey || !trimmedValue) {
          continue;
        }
        events[trimmedKey] = trimmedValue;
      }
    }

    return {
      padId,
      events,
      corridor: this.#normalizeEntryCorridor(raw.corridor, events),
      blackout: this.#normalizeEntryBlackoutConfig(raw.blackout),
      gLoad: this.#normalizeEntryGLoad(raw.gLoad ?? raw.g_load, events),
      ems: this.#normalizeEntryEms(raw.ems),
      recovery: this.#normalizeEntryRecovery(raw.recoveryTimeline ?? raw.recovery, events),
    };
  }

  #normalizeUiBundle(source, defaultKey) {
    if (!source) {
      return { map: null, items: [] };
    }

    if (source instanceof Map) {
      return { map: source, items: Array.from(source.values()) };
    }

    if (source.map instanceof Map) {
      const items = Array.isArray(source.items)
        ? source.items
        : Array.isArray(source[defaultKey])
          ? source[defaultKey]
          : Array.from(source.map.values());
      return { map: source.map, items };
    }

    let items = [];
    if (Array.isArray(source)) {
      items = source;
    } else if (typeof source === 'object') {
      if (Array.isArray(source.items)) {
        items = source.items;
      } else if (Array.isArray(source[defaultKey])) {
        items = source[defaultKey];
      }
    }

    const map = new Map();
    for (const item of items) {
      if (item && typeof item === 'object' && item.id) {
        map.set(item.id, item);
      }
    }

    return { map, items };
  }

  #normalizeEntryCorridor(raw, events) {
    if (!raw || typeof raw !== 'object') {
      return null;
    }

    const defaultState = this.#normalizeEntryCorridorState(raw.default ?? raw.defaultState ?? null, events);
    const states = Array.isArray(raw.states)
      ? raw.states.map((state) => this.#normalizeEntryCorridorState(state, events)).filter(Boolean)
      : [];

    return {
      toleranceDegrees: this.#coerceNumber(raw.toleranceDegrees ?? raw.tolerance_degrees),
      targetDegrees: this.#coerceNumber(raw.targetDegrees ?? raw.target_degrees),
      defaultState,
      states,
    };
  }

  #normalizeEntryCorridorState(raw, events) {
    if (!raw || typeof raw !== 'object') {
      return null;
    }

    const { eventKey, eventId } = this.#normalizeEntryEventReference(raw, events);

    return {
      eventKey,
      eventId,
      requiredStatus: typeof raw.status === 'string' && raw.status.trim().length > 0
        ? raw.status.trim().toLowerCase()
        : null,
      afterSeconds: this.#coerceNumber(raw.afterSeconds ?? raw.after_seconds),
      afterCompletionSeconds: this.#coerceNumber(
        raw.afterCompletionSeconds ?? raw.after_completion_seconds,
      ),
      afterGetSeconds: this.#coerceSeconds(
        raw.afterGetSeconds ?? raw.after_get_seconds ?? raw.afterGet ?? raw.after_get,
      ),
      angleOffsetDeg: this.#coerceNumber(
        raw.angleOffsetDeg
          ?? raw.angle_offset_deg
          ?? raw.offsetDegrees
          ?? raw.offset_degrees,
      ),
      downrangeErrorKm: this.#coerceNumber(raw.downrangeErrorKm ?? raw.downrange_error_km),
      crossrangeErrorKm: this.#coerceNumber(raw.crossrangeErrorKm ?? raw.crossrange_error_km),
    };
  }

  #normalizeEntryBlackoutConfig(raw) {
    if (!raw || typeof raw !== 'object') {
      return null;
    }

    const startsAtSeconds = this.#coerceSeconds(
      raw.startsAtSeconds
        ?? raw.startSeconds
        ?? raw.start_seconds
        ?? raw.start
        ?? raw.startGet
        ?? raw.start_get
        ?? raw.startGET
        ?? raw.startAt
        ?? raw.start_at,
    );

    const endsAtSeconds = this.#coerceSeconds(
      raw.endsAtSeconds
        ?? raw.endSeconds
        ?? raw.end_seconds
        ?? raw.end
        ?? raw.endGet
        ?? raw.end_get
        ?? raw.endGET
        ?? raw.endsAt
        ?? raw.end_at,
    );

    return { startsAtSeconds, endsAtSeconds };
  }

  #normalizeEntryGLoad(raw, events) {
    if (!raw || typeof raw !== 'object') {
      return null;
    }

    const states = Array.isArray(raw.states)
      ? raw.states.map((state) => this.#normalizeEntryGLoadState(state, events)).filter(Boolean)
      : [];
    let defaultState = this.#normalizeEntryGLoadState(raw.default ?? raw.defaultState ?? null, events);
    if (!defaultState && states.length > 0) {
      defaultState = states.find((state) => !state.eventKey && !state.eventId) ?? states[0];
    }

    return {
      caution: this.#coerceNumber(raw.caution),
      warning: this.#coerceNumber(raw.warning),
      max: this.#coerceNumber(raw.max),
      states,
      defaultState,
    };
  }

  #normalizeEntryGLoadState(raw, events) {
    if (!raw || typeof raw !== 'object') {
      return null;
    }

    const { eventKey, eventId } = this.#normalizeEntryEventReference(raw, events);

    return {
      eventKey,
      eventId,
      requiredStatus: typeof raw.status === 'string' && raw.status.trim().length > 0
        ? raw.status.trim().toLowerCase()
        : null,
      afterSeconds: this.#coerceNumber(raw.afterSeconds ?? raw.after_seconds),
      afterCompletionSeconds: this.#coerceNumber(
        raw.afterCompletionSeconds ?? raw.after_completion_seconds,
      ),
      afterGetSeconds: this.#coerceSeconds(
        raw.afterGetSeconds ?? raw.after_get_seconds ?? raw.afterGet ?? raw.after_get,
      ),
      value: this.#coerceNumber(raw.value),
    };
  }

  #normalizeEntryEms(raw) {
    if (!raw || typeof raw !== 'object') {
      return null;
    }

    return {
      targetVelocityFtPerSec: this.#coerceNumber(
        raw.targetVelocityFtPerSec ?? raw.target_velocity_ft_per_sec,
      ),
      targetAltitudeFt: this.#coerceNumber(
        raw.targetAltitudeFt ?? raw.target_altitude_ft,
      ),
      predictedSplashdownSeconds: this.#coerceSeconds(
        raw.predictedSplashdownSeconds
          ?? raw.predicted_splashdown_seconds
          ?? raw.predictedSplashdown
          ?? raw.predicted_splashdown,
      ),
      predictedSplashdownGet: typeof raw.predictedSplashdownGet === 'string'
        ? raw.predictedSplashdownGet
        : typeof raw.predicted_splashdown_get === 'string'
          ? raw.predicted_splashdown_get
          : null,
    };
  }

  #normalizeEntryRecovery(rawList, events) {
    if (!Array.isArray(rawList)) {
      return [];
    }

    const recovery = [];
    for (const raw of rawList) {
      if (!raw || typeof raw !== 'object') {
        continue;
      }
      const id = typeof raw.id === 'string' ? raw.id.trim() : null;
      if (!id) {
        continue;
      }

      const getSeconds = this.#coerceSeconds(
        raw.getSeconds ?? raw.get_seconds ?? raw.get ?? null,
      );
      const get = typeof raw.get === 'string' ? raw.get : null;
      const ackOffset = this.#coerceNumber(raw.ackOffsetSeconds ?? raw.ack_offset_seconds);
      const completeOffset = this.#coerceNumber(
        raw.completeOffsetSeconds ?? raw.complete_offset_seconds,
      );

      const ackRef = this.#normalizeEntryEventReference({
        event: raw.ackEvent ?? raw.ack_event ?? raw.ackEventKey ?? raw.ack_event_key,
        eventId: raw.ackEventId ?? raw.ack_event_id,
      }, events);
      const completeRef = this.#normalizeEntryEventReference({
        event: raw.completeEvent ?? raw.complete_event ?? raw.completeEventKey ?? raw.complete_event_key,
        eventId: raw.completeEventId ?? raw.complete_event_id,
      }, events);

      recovery.push({
        id,
        label: typeof raw.label === 'string' ? raw.label : null,
        getSeconds: Number.isFinite(getSeconds) ? getSeconds : null,
        get,
        ackOffsetSeconds: Number.isFinite(ackOffset) ? ackOffset : 0,
        completeOffsetSeconds: Number.isFinite(completeOffset)
          ? completeOffset
          : Number.isFinite(ackOffset)
            ? ackOffset
            : 0,
        ackEventKey: ackRef.eventKey,
        ackEventId: ackRef.eventId,
        completeEventKey: completeRef.eventKey,
        completeEventId: completeRef.eventId,
      });
    }

    return recovery;
  }

  #normalizeEntryEventReference(raw, events) {
    if (!raw) {
      return { eventKey: null, eventId: null };
    }
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (!trimmed) {
        return { eventKey: null, eventId: null };
      }
      if (events && Object.prototype.hasOwnProperty.call(events, trimmed)) {
        return { eventKey: trimmed, eventId: events[trimmed] ?? null };
      }
      return { eventKey: null, eventId: trimmed };
    }
    if (typeof raw !== 'object') {
      return { eventKey: null, eventId: null };
    }

    let eventKey = null;
    if (typeof raw.event === 'string' && raw.event.trim().length > 0) {
      eventKey = raw.event.trim();
    } else if (typeof raw.eventKey === 'string' && raw.eventKey.trim().length > 0) {
      eventKey = raw.eventKey.trim();
    } else if (typeof raw.event_key === 'string' && raw.event_key.trim().length > 0) {
      eventKey = raw.event_key.trim();
    }

    let eventId = null;
    if (typeof raw.eventId === 'string' && raw.eventId.trim().length > 0) {
      eventId = raw.eventId.trim();
    } else if (typeof raw.event_id === 'string' && raw.event_id.trim().length > 0) {
      eventId = raw.event_id.trim();
    }

    if (eventKey && events && Object.prototype.hasOwnProperty.call(events, eventKey)) {
      eventId = events[eventKey] ?? eventId;
    } else if (eventKey && !eventId) {
      eventId = eventKey;
      eventKey = this.#resolveEventKeyForId(events, eventId);
    }

    if (!eventKey && eventId && events) {
      eventKey = this.#resolveEventKeyForId(events, eventId);
    }

    return { eventKey: eventKey ?? null, eventId: eventId ?? null };
  }

  #resolveEventKeyForId(events, eventId) {
    if (!events || !eventId) {
      return null;
    }
    for (const [key, value] of Object.entries(events)) {
      if (value === eventId) {
        return key;
      }
    }
    return null;
  }

  #summarizeChecklists(stats, resolvePad) {
    if (!stats) {
      return null;
    }

    const activeEntries = Array.isArray(stats.active)
      ? stats.active.map((entry) => this.#augmentChecklistEntry(entry, resolvePad))
      : [];

    const limit = Math.max(0, Number(this.options.activeChecklistLimit) || 0);
    const active = limit > 0 ? activeEntries.slice(0, limit) : activeEntries.slice();
    const chip = this.#selectChecklistChip(activeEntries);

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
    const chip = {
      eventId: selected.eventId,
      checklistId: selected.checklistId,
      title: selected.title,
      crewRole: selected.crewRole,
      nextStepNumber: selected.nextStepNumber,
      nextStepAction: selected.nextStepAction,
      stepsRemaining: Math.max(0, selected.totalSteps - selected.completedSteps),
      autoAdvancePending: selected.autoAdvancePending,
      pad: selected.pad ?? null,
    };

    if (selected.definition) {
      chip.definition = deepClone(selected.definition);
    }
    if (selected.nextStepDefinition) {
      chip.nextStepDefinition = deepClone(selected.nextStepDefinition);
    }

    return chip;
  }

  #augmentChecklistEntry(entry, resolvePad) {
    if (!entry || typeof entry !== 'object') {
      return entry;
    }

    const augmented = { ...entry };
    augmented.pad = resolvePad ? resolvePad(entry.eventId) : null;

    const checklist = this.uiChecklists?.get(entry.checklistId);
    const rawSteps = Array.isArray(entry.steps) ? entry.steps : [];
    if (checklist) {
      augmented.definition = this.#buildChecklistDefinition(checklist);
      augmented.steps = rawSteps
        .map((step) => this.#mergeChecklistStep(step, checklist, entry.nextStepNumber))
        .filter(Boolean);
      if (entry.nextStepNumber != null) {
        const stepDefinition = this.#lookupChecklistStep(checklist, entry.nextStepNumber);
        if (stepDefinition) {
          augmented.nextStepDefinition = this.#summarizeChecklistStep(stepDefinition);
        }
      }
    } else {
      augmented.steps = rawSteps.map((step) => ({ ...step }));
    }

    return augmented;
  }

  #buildChecklistDefinition(checklist) {
    const summary = {
      id: checklist.id ?? null,
      title: checklist.title ?? checklist.id ?? null,
      phase: checklist.phase ?? null,
      role: checklist.role ?? null,
      nominalGet: checklist.nominalGet ?? null,
      nominalGetSeconds: Number.isFinite(checklist.nominalGetSeconds)
        ? checklist.nominalGetSeconds
        : null,
      totalSteps: Number.isFinite(checklist.totalSteps) ? checklist.totalSteps : null,
    };

    if (checklist.source) {
      summary.source = deepClone(checklist.source);
    }
    if (Array.isArray(checklist.tags) && checklist.tags.length > 0) {
      summary.tags = checklist.tags.slice();
    }

    return summary;
  }

  #mergeChecklistStep(step, checklist, nextStepNumber) {
    if (!step || typeof step !== 'object') {
      return null;
    }

    const summary = { ...step };
    const stepNumber = Number.isFinite(step.stepNumber)
      ? step.stepNumber
      : Number.isFinite(step.order)
        ? step.order
        : null;
    summary.stepNumber = stepNumber;

    if (summary.acknowledgedAtSeconds == null && Number.isFinite(step.acknowledgedAt)) {
      summary.acknowledgedAtSeconds = step.acknowledgedAt;
    }
    if (summary.acknowledged == null && typeof step.acknowledged === 'boolean') {
      summary.acknowledged = step.acknowledged;
    }
    if (summary.isNext == null && Number.isFinite(nextStepNumber)) {
      summary.isNext = stepNumber === nextStepNumber;
    }

    const definition = checklist ? this.#lookupChecklistStep(checklist, stepNumber) : null;
    if (definition) {
      const definitionSummary = this.#summarizeChecklistStep(definition);
      summary.definition = definitionSummary;
      if (!summary.action && definitionSummary.callout) {
        summary.action = definitionSummary.callout;
      }
      if (!summary.reference && definitionSummary.notes) {
        summary.reference = definitionSummary.notes;
      }
      if (definitionSummary.dskyMacro && !summary.dskyMacro) {
        summary.dskyMacro = definitionSummary.dskyMacro;
      }
      if (definitionSummary.manualOnly != null && summary.manualOnly == null) {
        summary.manualOnly = definitionSummary.manualOnly;
      }
      if (definitionSummary.tags && (!summary.tags || summary.tags.length === 0)) {
        summary.tags = definitionSummary.tags.slice();
      }
    }

    return summary;
  }

  #lookupChecklistStep(checklist, stepNumber) {
    if (!checklist || stepNumber == null) {
      return null;
    }

    if (checklist.stepsByOrder instanceof Map) {
      return checklist.stepsByOrder.get(stepNumber) ?? null;
    }

    if (Array.isArray(checklist.steps)) {
      return checklist.steps.find((step) => step.order === stepNumber) ?? null;
    }

    return null;
  }

  #summarizeChecklistStep(step) {
    if (!step || typeof step !== 'object') {
      return null;
    }

    const summary = {
      id: step.id ?? null,
      order: Number.isFinite(step.order) ? step.order : null,
      callout: step.callout ?? null,
      panelId: step.panelId ?? null,
      dskyMacro: step.dskyMacro ?? null,
      manualOnly: Boolean(step.manualOnly),
      notes: step.notes ?? null,
      prerequisites: Array.isArray(step.prerequisites) ? [...step.prerequisites] : [],
      tags: Array.isArray(step.tags) ? [...step.tags] : [],
    };

    if (Array.isArray(step.effects)) {
      summary.effects = step.effects.map((effect) => deepClone(effect));
    } else {
      summary.effects = [];
    }

    if (Array.isArray(step.controls)) {
      summary.controls = step.controls
        .map((control) => this.#summarizeChecklistControl(control, step.panelId))
        .filter(Boolean);
    } else {
      summary.controls = [];
    }

    if (step.panelId && this.uiPanels) {
      const panel = this.uiPanels.get(step.panelId);
      if (panel) {
        summary.panel = {
          id: panel.id ?? null,
          name: panel.name ?? panel.id ?? null,
          craft: panel.craft ?? null,
        };
      }
    }

    return summary;
  }

  #summarizeChecklistControl(control, panelId) {
    if (!control || typeof control !== 'object') {
      return null;
    }

    const summary = {
      controlId: control.controlId ?? control.id ?? null,
      targetState: control.targetState ?? control.state ?? null,
      verification: control.verification ?? null,
      tolerance: this.#coerceNumber(control.tolerance),
    };

    if (control.label != null) {
      summary.label = control.label;
    }
    if (control.notes != null) {
      summary.notes = control.notes;
    }
    if (Array.isArray(control.prerequisites) && control.prerequisites.length > 0) {
      summary.prerequisites = control.prerequisites.slice();
    }
    if (control.metadata) {
      summary.metadata = deepClone(control.metadata);
    }

    const panel = panelId && this.uiPanels ? this.uiPanels.get(panelId) : null;
    const controlDefinition = panel?.controlsById?.get(summary.controlId) ?? null;
    if (controlDefinition) {
      summary.control = {
        id: controlDefinition.id,
        label: controlDefinition.label ?? controlDefinition.id ?? null,
        type: controlDefinition.type ?? null,
        defaultState: controlDefinition.defaultState ?? null,
      };

      if (controlDefinition.statesById instanceof Map) {
        summary.control.states = Array.from(controlDefinition.statesById.values()).map((state) => ({
          id: state.id ?? null,
          label: state.label ?? null,
        }));
      } else if (Array.isArray(controlDefinition.states)) {
        summary.control.states = controlDefinition.states.map((state) => ({
          id: state.id ?? null,
          label: state.label ?? null,
        }));
      }

      if (summary.controlId && summary.targetState && controlDefinition.statesById instanceof Map) {
        const state = controlDefinition.statesById.get(summary.targetState);
        if (state) {
          summary.targetStateLabel = state.label ?? summary.targetState;
          const deltas = {};
          for (const field of ['drawKw', 'heatKw', 'propellantKg', 'deltaKw', 'deltaKg']) {
            if (state[field] != null) {
              const numeric = this.#coerceNumber(state[field]);
              if (numeric != null) {
                deltas[field] = numeric;
              }
            }
          }
          if (Object.keys(deltas).length > 0) {
            summary.targetStateDeltas = deltas;
          }
        }
      }

      if (panel?.hotspotsByControl instanceof Map) {
        const hotspot = panel.hotspotsByControl.get(summary.controlId);
        if (hotspot) {
          summary.control.hotspot = { ...hotspot };
        }
      }
    }

    return summary;
  }

  #summarizeUiDefinitions() {
    const workspaces = this.#summarizeWorkspaces();
    if (workspaces) {
      return { workspaces };
    }
    return null;
  }

  #summarizeWorkspaces() {
    if (!Array.isArray(this.uiWorkspaceItems) || this.uiWorkspaceItems.length === 0) {
      return null;
    }

    const summaries = this.uiWorkspaceItems
      .map((preset) => this.#summarizeWorkspacePreset(preset))
      .filter(Boolean);

    return summaries.length > 0 ? summaries : null;
  }

  #summarizeWorkspacePreset(preset) {
    if (!preset || typeof preset !== 'object') {
      return null;
    }

    const summary = {
      id: preset.id ?? null,
      name: preset.name ?? null,
      description: preset.description ?? null,
      tileCount: Array.isArray(preset.tiles) ? preset.tiles.length : 0,
    };

    if (preset.viewport && typeof preset.viewport === 'object') {
      const viewport = {};
      if (preset.viewport.minWidth != null) {
        const minWidth = this.#coerceNumber(preset.viewport.minWidth);
        if (minWidth != null) {
          viewport.minWidth = minWidth;
        }
      }
      if (preset.viewport.minHeight != null) {
        const minHeight = this.#coerceNumber(preset.viewport.minHeight);
        if (minHeight != null) {
          viewport.minHeight = minHeight;
        }
      }
      if (typeof preset.viewport.hudPinned === 'boolean') {
        viewport.hudPinned = preset.viewport.hudPinned;
      }
      if (Object.keys(viewport).length > 0) {
        summary.viewport = viewport;
      }
    }

    if (Array.isArray(preset.tags) && preset.tags.length > 0) {
      summary.tags = preset.tags.slice();
    }

    return summary;
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

  #summarizeManualTimelineEntry(entry) {
    if (!entry || typeof entry !== 'object') {
      return null;
    }

    const startSeconds = this.#coerceNumber(entry.startSeconds ?? entry.start_seconds ?? entry.start);
    const endSeconds = this.#coerceNumber(entry.endSeconds ?? entry.end_seconds ?? entry.end);
    const manualSteps = this.#coerceNumber(entry.manualSteps ?? entry.manual_steps ?? entry.manual);
    const autoSteps = this.#coerceNumber(entry.autoSteps ?? entry.auto_steps ?? entry.auto);

    const summary = {
      startSeconds,
      endSeconds,
      manualSteps,
      autoSteps,
      startGet: Number.isFinite(startSeconds) ? formatGET(Math.max(0, Math.round(startSeconds))) : null,
      endGet: Number.isFinite(endSeconds) ? formatGET(Math.max(0, Math.round(endSeconds))) : null,
    };

    return summary;
  }

  #summarizeScoreHistoryEntry(entry) {
    if (!entry || typeof entry !== 'object') {
      return null;
    }

    const getSeconds = this.#coerceNumber(entry.getSeconds);
    const commanderScore = this.#coerceNumber(entry.commanderScore);
    const baseScore = this.#coerceNumber(entry.baseScore);
    const manualBonus = this.#coerceNumber(entry.manualBonus);
    const grade = typeof entry.grade === 'string' ? entry.grade : null;

    const breakdown = entry.breakdown ?? {};

    const historyEntry = {
      getSeconds,
      get: Number.isFinite(getSeconds) ? formatGET(getSeconds) : null,
      commanderScore,
      baseScore,
      manualBonus,
      grade,
      breakdown: {
        events: this.#summarizeScoreBreakdown(breakdown.events),
        resources: this.#summarizeScoreBreakdown(breakdown.resources),
        faults: this.#summarizeScoreBreakdown(breakdown.faults),
        manual: this.#summarizeScoreBreakdown(breakdown.manual),
      },
    };

    const delta = this.#summarizeScoreDelta(entry.delta ?? null);
    if (delta) {
      historyEntry.delta = delta;
    }

    return historyEntry;
  }

  #summarizeScoreDelta(delta) {
    if (!delta || typeof delta !== 'object') {
      return null;
    }

    const commanderScore = this.#coerceNumber(delta.commanderScore);
    const baseScore = this.#coerceNumber(delta.baseScore);
    const manualBonus = this.#coerceNumber(delta.manualBonus);

    let breakdown = null;
    if (delta.breakdown && typeof delta.breakdown === 'object') {
      breakdown = {};
      let hasValue = false;
      for (const key of ['events', 'resources', 'faults', 'manual']) {
        const value = this.#coerceNumber(delta.breakdown[key]);
        if (value != null) {
          breakdown[key] = this.#roundNumber(value, 3);
          if (value !== 0) {
            hasValue = true;
          }
        } else {
          breakdown[key] = null;
        }
      }
      if (!hasValue) {
        breakdown = null;
      }
    }

    const gradeChanged = Boolean(delta.gradeChanged);
    const grade = typeof delta.grade === 'string' ? delta.grade : null;
    const previousGrade = typeof delta.previousGrade === 'string' ? delta.previousGrade : null;

    const hasValue =
      commanderScore != null
      || baseScore != null
      || manualBonus != null
      || gradeChanged
      || breakdown != null;

    if (!hasValue) {
      return null;
    }

    const result = {
      commanderScore,
      baseScore,
      manualBonus,
      gradeChanged,
      grade,
      previousGrade,
    };

    if (breakdown) {
      result.breakdown = breakdown;
    }

    return result;
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

  #coerceSeconds(value) {
    const numeric = this.#coerceNumber(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
    if (typeof value === 'string') {
      const parsed = parseGET(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  #roundNumber(value, digits = 1) {
    if (!Number.isFinite(value)) {
      return null;
    }
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }

  #roundNullable(value, digits = 1) {
    if (!Number.isFinite(value)) {
      return null;
    }
    return this.#roundNumber(value, digits);
  }

  #formatGetSeconds(value) {
    const seconds = this.#coerceNumber(value);
    if (!Number.isFinite(seconds)) {
      return null;
    }
    return formatGET(Math.max(0, Math.round(seconds)));
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

  #summarizeEntry(currentGetSeconds, context, { orbitSummary } = {}) {
    if (!this.entryConfig) {
      return null;
    }

    const scheduler = context?.scheduler ?? null;
    const padSummary = this.entryConfig.padId
      ? this.#summarizePad(this.padMap.get(this.entryConfig.padId) ?? null, this.entryConfig.padId)
      : null;

    const entryInterfaceSeconds = this.#coerceNumber(
      padSummary?.parameters?.entryInterface?.getSeconds,
    );
    const entryInterfaceGet =
      padSummary?.parameters?.entryInterface?.get
      ?? (Number.isFinite(entryInterfaceSeconds)
        ? formatGET(Math.round(entryInterfaceSeconds))
        : null);

    const statusBundle = this.#buildEntryStatusBundle(this.entryConfig.events, scheduler);

    const corridor = this.#computeEntryCorridor(currentGetSeconds, statusBundle, padSummary);
    const blackout = this.#computeEntryBlackout(currentGetSeconds, this.entryConfig.blackout);
    const ems = this.#computeEntryEms(
      orbitSummary ?? context?.orbitSummary ?? null,
      this.entryConfig.ems,
    );
    const gLoad = this.#computeEntryGLoad(currentGetSeconds, statusBundle);
    const recovery = this.#computeEntryRecovery(currentGetSeconds, statusBundle);

    const entry = {
      entryInterfaceSeconds: Number.isFinite(entryInterfaceSeconds)
        ? entryInterfaceSeconds
        : null,
      entryInterfaceGet,
      recovery,
    };

    if (corridor) {
      entry.corridor = corridor;
    }
    if (blackout) {
      entry.blackout = blackout;
    }
    if (ems) {
      entry.ems = ems;
    }
    if (gLoad) {
      entry.gLoad = gLoad;
    }

    return entry;
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

  #buildEntryStatusBundle(events, scheduler) {
    const byKey = new Map();
    const byId = new Map();
    if (!events || typeof events !== 'object') {
      return { byKey, byId };
    }

    for (const [key, rawId] of Object.entries(events)) {
      if (typeof rawId !== 'string' || rawId.trim().length === 0) {
        continue;
      }
      const eventId = rawId.trim();
      const event = this.#resolveEventById(eventId, scheduler);
      const status = typeof event?.status === 'string'
        ? event.status.toLowerCase()
        : null;
      const record = {
        key,
        eventId,
        status,
        activationSeconds: this.#coerceNumber(event?.activationTimeSeconds),
        completionSeconds: this.#coerceNumber(event?.completionTimeSeconds),
      };
      byKey.set(key, record);
      byId.set(eventId, record);
    }

    return { byKey, byId };
  }

  #lookupEntryStatus(statusBundle, eventKey, eventId) {
    if (!statusBundle) {
      return null;
    }
    if (eventKey && statusBundle.byKey?.has(eventKey)) {
      return statusBundle.byKey.get(eventKey);
    }
    if (eventId && statusBundle.byId?.has(eventId)) {
      return statusBundle.byId.get(eventId);
    }
    return null;
  }

  #computeEntryCorridor(currentGetSeconds, statusBundle, padSummary) {
    const config = this.entryConfig?.corridor;
    if (!config) {
      return null;
    }

    const target = this.#coerceNumber(
      padSummary?.parameters?.flightPathAngleDeg ?? config.targetDegrees,
    );
    const tolerance = this.#coerceNumber(config.toleranceDegrees);

    const state = this.#selectEntryState(
      config.states,
      config.defaultState,
      statusBundle,
      currentGetSeconds,
    );

    const offset = this.#coerceNumber(state?.angleOffsetDeg);
    const downrange = this.#coerceNumber(state?.downrangeErrorKm);
    const crossrange = this.#coerceNumber(state?.crossrangeErrorKm);

    const currentDegrees = Number.isFinite(target)
      ? Number.isFinite(offset)
        ? this.#roundNumber(target + offset, 2)
        : this.#roundNumber(target, 2)
      : null;

    return {
      targetDegrees: Number.isFinite(target) ? this.#roundNumber(target, 2) : null,
      toleranceDegrees: Number.isFinite(tolerance) ? this.#roundNumber(tolerance, 2) : null,
      currentDegrees,
      downrangeErrorKm: Number.isFinite(downrange) ? this.#roundNumber(downrange, 1) : null,
      crossrangeErrorKm: Number.isFinite(crossrange) ? this.#roundNumber(crossrange, 1) : null,
    };
  }

  #computeEntryBlackout(currentGetSeconds, config) {
    if (!config) {
      return null;
    }

    const startSeconds = this.#coerceNumber(config.startsAtSeconds);
    const endSeconds = this.#coerceNumber(config.endsAtSeconds);

    if (!Number.isFinite(startSeconds) && !Number.isFinite(endSeconds)) {
      return null;
    }

    let status = null;
    if (Number.isFinite(startSeconds) && Number.isFinite(endSeconds)) {
      if (currentGetSeconds < startSeconds) {
        status = 'pending';
      } else if (currentGetSeconds <= endSeconds) {
        status = 'active';
      } else {
        status = 'complete';
      }
    } else if (Number.isFinite(startSeconds)) {
      status = currentGetSeconds >= startSeconds ? 'active' : 'pending';
    }

    let remaining = null;
    if (Number.isFinite(startSeconds) && Number.isFinite(endSeconds)) {
      if (currentGetSeconds < startSeconds) {
        remaining = startSeconds - currentGetSeconds;
      } else if (currentGetSeconds <= endSeconds) {
        remaining = endSeconds - currentGetSeconds;
      } else {
        remaining = 0;
      }
    } else if (Number.isFinite(startSeconds)) {
      remaining = Math.max(0, startSeconds - currentGetSeconds);
    }

    return {
      status,
      startsAtSeconds: Number.isFinite(startSeconds) ? startSeconds : null,
      startsAtGet: Number.isFinite(startSeconds) ? formatGET(Math.round(startSeconds)) : null,
      endsAtSeconds: Number.isFinite(endSeconds) ? endSeconds : null,
      endsAtGet: Number.isFinite(endSeconds) ? formatGET(Math.round(endSeconds)) : null,
      remainingSeconds: Number.isFinite(remaining) ? Math.max(0, this.#roundNumber(remaining, 1)) : null,
    };
  }

  #computeEntryEms(orbitSummary, config = {}) {
    const summary = orbitSummary && typeof orbitSummary === 'object' ? orbitSummary : null;
    let velocityFt = null;
    if (summary?.velocity) {
      const speed = this.#coerceNumber(summary.velocity.speed);
      if (Number.isFinite(speed)) {
        velocityFt = this.#roundNumber(speed * METERS_TO_FEET, 0);
      }
    }
    if (velocityFt == null) {
      const targetVelocity = this.#coerceNumber(config.targetVelocityFtPerSec);
      if (Number.isFinite(targetVelocity)) {
        velocityFt = this.#roundNumber(targetVelocity, 0);
      }
    }

    let altitudeFt = null;
    if (summary?.position) {
      const altitude = this.#coerceNumber(summary.position.altitude);
      if (Number.isFinite(altitude)) {
        altitudeFt = this.#roundNumber(altitude * METERS_TO_FEET, 0);
      }
    }
    if (altitudeFt == null) {
      const targetAltitude = this.#coerceNumber(config.targetAltitudeFt);
      if (Number.isFinite(targetAltitude)) {
        altitudeFt = this.#roundNumber(targetAltitude, 0);
      }
    }

    const predictedSeconds = this.#coerceNumber(config.predictedSplashdownSeconds);
    const predictedGet = config.predictedSplashdownGet
      ?? (Number.isFinite(predictedSeconds) ? formatGET(Math.round(predictedSeconds)) : null);

    if (velocityFt == null && altitudeFt == null && predictedSeconds == null && !predictedGet) {
      return null;
    }

    return {
      velocityFtPerSec: velocityFt,
      altitudeFt,
      predictedSplashdownSeconds: Number.isFinite(predictedSeconds) ? predictedSeconds : null,
      predictedSplashdownGet: predictedGet,
    };
  }

  #computeEntryGLoad(currentGetSeconds, statusBundle) {
    const config = this.entryConfig?.gLoad;
    if (!config) {
      return null;
    }

    const state = this.#selectEntryState(
      config.states,
      config.defaultState,
      statusBundle,
      currentGetSeconds,
    );
    const currentValue = this.#coerceNumber(state?.value);

    return {
      current: Number.isFinite(currentValue) ? this.#roundNumber(currentValue, 2) : null,
      max: Number.isFinite(config.max) ? this.#roundNumber(config.max, 1) : null,
      caution: Number.isFinite(config.caution) ? this.#roundNumber(config.caution, 1) : null,
      warning: Number.isFinite(config.warning) ? this.#roundNumber(config.warning, 1) : null,
    };
  }

  #computeEntryRecovery(currentGetSeconds, statusBundle) {
    const entries = Array.isArray(this.entryConfig?.recovery)
      ? this.entryConfig.recovery
      : [];
    if (entries.length === 0) {
      return [];
    }

    const results = [];
    for (const entry of entries) {
      if (!entry || !entry.id) {
        continue;
      }

      const getSeconds = this.#coerceNumber(entry.getSeconds);
      const getLabel = entry.get
        ?? (Number.isFinite(getSeconds) ? formatGET(Math.round(getSeconds)) : null);

      let status = 'pending';
      const completionRecord = this.#lookupEntryStatus(
        statusBundle,
        entry.completeEventKey,
        entry.completeEventId,
      );
      if (completionRecord?.status === 'complete') {
        status = 'complete';
      } else {
        const completeThreshold = Number.isFinite(getSeconds)
          && Number.isFinite(entry.completeOffsetSeconds)
          ? getSeconds + entry.completeOffsetSeconds
          : null;
        if (completeThreshold != null && currentGetSeconds >= completeThreshold) {
          status = 'complete';
        } else {
          let acked = false;
          const ackRecord = this.#lookupEntryStatus(
            statusBundle,
            entry.ackEventKey,
            entry.ackEventId,
          );
          if (ackRecord) {
            if (ackRecord.status === 'active' || ackRecord.status === 'complete') {
              acked = true;
            }
          } else if (Number.isFinite(getSeconds)) {
            const ackThreshold = getSeconds + (entry.ackOffsetSeconds ?? 0);
            acked = currentGetSeconds >= ackThreshold;
          }
          status = acked ? 'acknowledged' : 'pending';
        }
      }

      results.push({
        id: entry.id,
        label: entry.label ?? null,
        getSeconds: Number.isFinite(getSeconds) ? getSeconds : null,
        get: getLabel,
        status,
      });
    }

    return results;
  }

  #selectEntryState(states, defaultState, statusBundle, currentGetSeconds) {
    let selected = defaultState ?? null;
    if (!Array.isArray(states)) {
      return selected;
    }

    for (const state of states) {
      if (this.#entryConditionSatisfied(state, statusBundle, currentGetSeconds)) {
        selected = state;
      }
    }

    return selected;
  }

  #entryConditionSatisfied(state, statusBundle, currentGetSeconds) {
    if (!state) {
      return false;
    }

    const record = this.#lookupEntryStatus(statusBundle, state.eventKey, state.eventId);

    if (!state.eventKey && !state.eventId && !state.requiredStatus && state.afterSeconds == null
      && state.afterCompletionSeconds == null && state.afterGetSeconds == null) {
      return true;
    }

    if (state.requiredStatus) {
      if (!record || record.status !== state.requiredStatus) {
        return false;
      }
    } else if ((state.eventKey || state.eventId) && !record) {
      return false;
    }

    if (Number.isFinite(state.afterSeconds)) {
      const base = record?.activationSeconds;
      if (!Number.isFinite(base) || currentGetSeconds < base + state.afterSeconds) {
        return false;
      }
    }

    if (Number.isFinite(state.afterCompletionSeconds)) {
      const base = record?.completionSeconds ?? record?.activationSeconds;
      if (!Number.isFinite(base) || currentGetSeconds < base + state.afterCompletionSeconds) {
        return false;
      }
    }

    if (Number.isFinite(state.afterGetSeconds) && currentGetSeconds < state.afterGetSeconds) {
      return false;
    }

    return true;
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
