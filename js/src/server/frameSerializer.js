import { formatGET } from '../utils/time.js';

const PROP_TANK_ORDER = ['csm_sps', 'csm_rcs', 'lm_descent', 'lm_ascent', 'lm_rcs'];

export function createClientFrame(frame) {
  if (!frame || typeof frame !== 'object') {
    return null;
  }

  return {
    time: frame.time ?? null,
    events: simplifyEvents(frame.events),
    resources: simplifyResources(frame.resources),
    autopilot: simplifyAutopilot(frame.autopilot),
    checklists: simplifyChecklists(frame.checklists),
    manualQueue: simplifyManualQueue(frame.manualQueue),
    agc: simplifyAgc(frame.agc),
    trajectory: simplifyTrajectory(frame.trajectory),
    docking: simplifyDocking(frame.docking),
    entry: simplifyEntry(frame.entry),
    alerts: simplifyAlerts(frame.alerts),
    audio: simplifyAudio(frame.audio),
    missionLog: simplifyMissionLog(frame.missionLog),
    score: simplifyScore(frame.score),
    performance: simplifyPerformance(frame.performance),
  };
}

export function createClientSummary(summary) {
  if (!summary || typeof summary !== 'object') {
    return null;
  }
  const finalGetSeconds = coerceNumber(summary.finalGetSeconds);
  return {
    finalGetSeconds,
    finalGet: Number.isFinite(finalGetSeconds) ? formatGET(finalGetSeconds) : null,
    ticks: summary.ticks ?? null,
    events: summary.events?.counts ?? summary.events ?? null,
    resources: summary.resources
      ? {
          powerMarginPct: coerceNumber(summary.resources.power_margin_pct),
          cryoBoiloffRatePctPerHr: coerceNumber(summary.resources.cryo_boiloff_rate_pct_per_hr, 2),
          ptcActive: summary.resources.ptc_active ?? null,
          deltaV: summary.resources.delta_v ?? null,
          propellantKg: summary.resources.propellant ?? null,
          failures: summary.resources.failures ?? null,
        }
      : null,
    autopilot: summary.autopilot ?? null,
    checklists: summary.checklists ?? null,
    missionLog: summary.missionLog ?? null,
    panels: summary.panels ?? null,
    audio: summary.audio ?? null,
    docking: summary.docking ?? null,
    performance: summary.performance ?? null,
    score: simplifyScore(summary.score),
  };
}

function simplifyEvents(events) {
  if (!events || typeof events !== 'object') {
    return null;
  }
  const upcoming = Array.isArray(events.upcoming)
    ? events.upcoming.slice(0, 5).map(simplifyEvent)
    : [];
  return {
    counts: events.counts ?? null,
    next: simplifyEvent(events.next),
    upcoming,
  };
}

function simplifyEvent(event) {
  if (!event || typeof event !== 'object') {
    return null;
  }
  return {
    id: event.id ?? null,
    phase: event.phase ?? null,
    status: event.status ?? null,
    opensAt: event.opensAt ?? null,
    opensAtSeconds: coerceNumber(event.opensAtSeconds),
    tMinusLabel: event.tMinusLabel ?? null,
    tMinusSeconds: coerceNumber(event.tMinusSeconds),
    isOverdue: Boolean(event.isOverdue),
    pad: simplifyPad(event.pad),
  };
}

function simplifyPad(pad) {
  if (!pad || typeof pad !== 'object') {
    return null;
  }
  const params = pad.parameters ?? {};
  const deltaVMps = coerceNumber(
    params.deltaVMetersPerSecond ?? (params.deltaVFtPerSec != null ? params.deltaVFtPerSec * 0.3048 : null),
    2,
  );
  const entryInterface = params.entryInterface ?? {};
  return {
    id: pad.id ?? null,
    purpose: pad.purpose ?? null,
    deliveryGet: pad.delivery?.get ?? null,
    validUntilGet: pad.validUntil?.get ?? null,
    tig: params.tig?.get ?? null,
    deltaVMps,
    burnDurationSeconds: coerceNumber(params.burnDurationSeconds),
    entryInterfaceGet: entryInterface.get ?? null,
    notes: params.notes ?? null,
  };
}

function simplifyResources(resources) {
  if (!resources || typeof resources !== 'object') {
    return null;
  }
  return {
    power: resources.power
      ? {
          marginPct: coerceNumber(resources.power.marginPct ?? resources.power.margin_pct ?? resources.power.margin),
          loadKw: coerceNumber(resources.power.loadKw ?? resources.power.fuel_cell_load_kw, 2),
          outputKw: coerceNumber(resources.power.outputKw ?? resources.power.fuel_cell_output_kw, 2),
        }
      : null,
    thermal: resources.thermal
      ? {
          cryoBoiloffRatePctPerHr: coerceNumber(resources.thermal.cryoBoiloffRatePctPerHr, 2),
          state: resources.thermal.state ?? null,
          ptcActive: resources.thermal.ptcActive ?? null,
        }
      : null,
    communications: simplifyCommunications(resources.communications),
    deltaV: simplifyDeltaV(resources.deltaV),
    propellant: simplifyPropellant(resources.propellant),
    lifeSupport: resources.lifeSupport ?? null,
  };
}

function simplifyCommunications(communications) {
  if (!communications || typeof communications !== 'object') {
    return null;
  }
  return {
    active: communications.active ?? null,
    current: communications.current
      ? {
          station: communications.current.station ?? null,
          timeRemainingLabel: communications.current.timeRemainingLabel ?? null,
          signalStrengthDb: coerceNumber(communications.current.signalStrengthDb, 1),
        }
      : null,
    nextWindowOpenGet: communications.nextWindowOpenGet ?? null,
    timeUntilNextWindowLabel: communications.timeUntilNextWindowLabel ?? null,
    lastPadId: communications.lastPadId ?? null,
  };
}

function simplifyDeltaV(deltaV) {
  if (!deltaV || typeof deltaV !== 'object') {
    return null;
  }
  const stages = {};
  if (deltaV.stages && typeof deltaV.stages === 'object') {
    for (const [stageId, entry] of Object.entries(deltaV.stages)) {
      stages[stageId] = {
        label: entry.label ?? stageId,
        remainingMps: coerceNumber(entry.remainingMps ?? entry.marginMps ?? entry.availableMps),
        percentRemaining: coerceNumber(entry.percentRemaining, 1),
        status: entry.status ?? null,
      };
    }
  }
  return {
    totalMps: coerceNumber(deltaV.totalMps ?? deltaV.totalBaseMps ?? deltaV.totalUsableMps),
    usedMps: coerceNumber(deltaV.usedMps),
    recoveredMps: coerceNumber(deltaV.recoveredMps),
    primaryStageId: deltaV.primaryStageId ?? null,
    primaryStageMps: coerceNumber(deltaV.primaryStageMps),
    stages,
  };
}

function simplifyPropellant(propellant) {
  if (!propellant || typeof propellant !== 'object') {
    return null;
  }
  const tanks = {};
  const source = propellant.tanks ?? propellant.metrics ?? {};
  for (const tankId of PROP_TANK_ORDER) {
    const tank = source[tankId];
    if (!tank) {
      continue;
    }
    tanks[tankId] = {
      label: tank.label ?? formatTankLabel(tankId),
      remainingKg: coerceNumber(tank.remainingKg),
      percentRemaining: coerceNumber(tank.percentRemaining, 1),
      status: tank.status ?? null,
      percentAboveReserve: coerceNumber(tank.percentAboveReserve, 1),
    };
  }
  return { tanks };
}

function simplifyAutopilot(autopilot) {
  if (!autopilot || typeof autopilot !== 'object') {
    return null;
  }
  const active = Array.isArray(autopilot.activeAutopilots)
    ? autopilot.activeAutopilots.slice(0, 4).map((entry) => ({
        id: entry.id ?? null,
        label: entry.label ?? entry.id ?? null,
        eventId: entry.eventId ?? null,
        phase: entry.phase ?? null,
        status: entry.status ?? null,
        progress: coerceNumber(entry.progress, 2),
        timeRemainingLabel: entry.timeRemainingLabel ?? null,
        pad: simplifyPad(entry.pad),
      }))
    : [];
  return {
    counts: {
      active: autopilot.active ?? autopilot.activeCount ?? 0,
      started: autopilot.started ?? autopilot.startedCount ?? 0,
      completed: autopilot.completed ?? autopilot.completedCount ?? 0,
      aborted: autopilot.aborted ?? autopilot.abortedCount ?? 0,
    },
    primary: autopilot.primary
      ? {
          id: autopilot.primary.id ?? null,
          label: autopilot.primary.label ?? autopilot.primary.id ?? null,
          status: autopilot.primary.status ?? null,
          progress: coerceNumber(autopilot.primary.progress, 2),
          timeRemainingLabel: autopilot.primary.timeRemainingLabel ?? null,
          pad: simplifyPad(autopilot.primary.pad),
        }
      : null,
    totals: {
      burnSeconds: coerceNumber(autopilot.totalBurnSeconds),
      ullageSeconds: coerceNumber(autopilot.totalUllageSeconds),
      rcsImpulseNs: coerceNumber(autopilot.totalRcsImpulseNs),
    },
    active,
  };
}

function simplifyChecklists(checklists) {
  if (!checklists || typeof checklists !== 'object') {
    return null;
  }
  const active = Array.isArray(checklists.active)
    ? checklists.active.map((entry) => ({
        checklistId: entry.checklistId ?? entry.id ?? null,
        title: entry.title ?? entry.checklistId ?? null,
        eventId: entry.eventId ?? null,
        crewRole: entry.crewRole ?? null,
        completedSteps: entry.completedSteps ?? 0,
        totalSteps: entry.totalSteps ?? null,
        nextStepNumber: entry.nextStepNumber ?? null,
        nextStepAction: entry.nextStepAction
          ?? entry.nextStepDefinition?.callout
          ?? entry.nextStepDefinition?.notes
          ?? null,
        autoAdvancePending: entry.autoAdvancePending ?? null,
        pad: simplifyPad(entry.pad),
        tags: Array.isArray(entry.definition?.tags) ? entry.definition.tags.slice(0, 6) : undefined,
      }))
    : [];
  const chip = checklists.chip
    ? {
        checklistId: checklists.chip.checklistId ?? null,
        eventId: checklists.chip.eventId ?? null,
        title: checklists.chip.title ?? null,
        nextStepNumber: checklists.chip.nextStepNumber ?? null,
        nextStepAction: checklists.chip.nextStepAction ?? null,
        stepsRemaining: checklists.chip.stepsRemaining ?? null,
        pad: simplifyPad(checklists.chip.pad),
      }
    : null;
  return {
    totals: checklists.totals ?? null,
    active,
    chip,
  };
}

function simplifyManualQueue(queue) {
  if (!queue || typeof queue !== 'object') {
    return null;
  }
  return {
    pending: queue.pending ?? 0,
    scheduled: queue.scheduled ?? null,
    executed: queue.executed ?? null,
    failed: queue.failed ?? null,
    retried: queue.retried ?? null,
    acknowledgedSteps: queue.acknowledgedSteps ?? null,
    dskyEntries: queue.dskyEntries ?? null,
    panelControls: queue.panelControls ?? null,
  };
}

function simplifyAgc(agc) {
  if (!agc || typeof agc !== 'object') {
    return null;
  }
  const registers = Array.isArray(agc.registers)
    ? agc.registers.slice(0, 6).map((entry) => ({
        id: entry.id ?? null,
        label: entry.label ?? entry.id ?? null,
        value: entry.value ?? null,
        units: entry.units ?? null,
      }))
    : [];
  const history = Array.isArray(agc.history)
    ? agc.history.slice(0, 5).map((entry) => ({
        id: entry.id ?? null,
        macroLabel: entry.macroLabel ?? entry.macroId ?? null,
        program: entry.program ?? null,
        verb: entry.verbLabel ?? null,
        noun: entry.nounLabel ?? null,
        actor: entry.actor ?? null,
        source: entry.source ?? null,
        get: entry.get ?? null,
        issues: Array.isArray(entry.issues)
          ? entry.issues.map((issue) => (typeof issue === 'string' ? issue : issue?.message ?? issue?.id ?? null))
          : [],
      }))
    : [];
  return {
    program: agc.program ?? null,
    annunciators: agc.annunciators ?? null,
    registers,
    history,
    pendingAck: agc.pendingAck ?? null,
    metrics: agc.metrics ?? null,
  };
}

function simplifyTrajectory(trajectory) {
  if (!trajectory || typeof trajectory !== 'object') {
    return null;
  }
  return {
    body: trajectory.body ?? null,
    altitudeKm: coerceNumber(trajectory.altitude?.kilometers, 1),
    speedKmPerSec: coerceNumber(trajectory.speed?.kilometersPerSecond, 3),
    elements: trajectory.elements
      ? {
          apoapsisKm: coerceNumber(trajectory.elements.apoapsisKm, 1),
          periapsisKm: coerceNumber(trajectory.elements.periapsisKm, 1),
          eccentricity: coerceNumber(trajectory.elements.eccentricity, 4),
          inclinationDeg: coerceNumber(trajectory.elements.inclinationDeg, 2),
          periodMinutes: coerceNumber(trajectory.elements.periodMinutes, 2),
        }
      : null,
    metrics: trajectory.metrics ?? null,
    alerts: simplifyAlerts(trajectory.alerts),
  };
}

function simplifyDocking(docking) {
  if (!docking || typeof docking !== 'object') {
    return null;
  }
  return {
    eventId: docking.eventId ?? docking.event_id ?? null,
    activeGateId: docking.activeGateId ?? docking.activeGate ?? null,
    progress: coerceNumber(docking.progress, 2),
    rangeMeters: coerceNumber(docking.rangeMeters ?? docking.range_meters),
    gates: Array.isArray(docking.gateStatuses)
      ? docking.gateStatuses.slice(0, 4).map((gate) => ({
          id: gate.id ?? null,
          label: gate.label ?? null,
          status: gate.status ?? null,
          progress: coerceNumber(gate.progress, 2),
          deadlineGet: gate.deadlineGet ?? null,
        }))
      : null,
  };
}

function simplifyEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  return {
    entryInterfaceGet: entry.entryInterfaceGet ?? null,
    corridor: entry.corridor ?? null,
    blackout: entry.blackout ?? null,
    ems: entry.ems ?? null,
    gLoad: entry.gLoad ?? null,
    recovery: entry.recovery ?? null,
  };
}

function simplifyAlerts(alerts) {
  if (!alerts || typeof alerts !== 'object') {
    return { warnings: [], cautions: [], failures: [] };
  }
  return {
    warnings: Array.isArray(alerts.warnings) ? alerts.warnings.slice(0, 6).map(cloneShallow) : [],
    cautions: Array.isArray(alerts.cautions) ? alerts.cautions.slice(0, 6).map(cloneShallow) : [],
    failures: Array.isArray(alerts.failures) ? alerts.failures.slice(0, 4).map(cloneShallow) : [],
  };
}

function simplifyAudio(audio) {
  if (!audio || typeof audio !== 'object') {
    return null;
  }
  return {
    binder: audio.binder
      ? {
          totalTriggers: audio.binder.totalTriggers ?? null,
          pendingCount: audio.binder.pendingCount ?? null,
          lastCueId: audio.binder.lastCueId ?? null,
          lastTriggeredAt: audio.binder.lastTriggeredAt ?? null,
        }
      : null,
    dispatcher: audio.dispatcher
      ? {
          activeTotal: audio.dispatcher.activeTotal ?? audio.dispatcher.active?.total ?? null,
          queuedTotal: audio.dispatcher.queuedTotal ?? audio.dispatcher.queued?.total ?? null,
          lastStartedAt: audio.dispatcher.lastStartedAt ?? null,
        }
      : null,
    pending: Array.isArray(audio.pending) ? audio.pending.slice(-4).map(simplifyAudioTrigger) : [],
    active: Array.isArray(audio.active) ? audio.active.slice(0, 4).map(simplifyAudioTrigger) : [],
    queued: Array.isArray(audio.queued) ? audio.queued.slice(0, 4).map(simplifyAudioTrigger) : [],
  };
}

function simplifyAudioTrigger(trigger) {
  if (!trigger || typeof trigger !== 'object') {
    return null;
  }
  return {
    cueId: trigger.cueId ?? null,
    busId: trigger.busId ?? null,
    severity: trigger.severity ?? null,
    sourceType: trigger.sourceType ?? null,
    triggeredAt: trigger.triggeredAt ?? null,
  };
}

function simplifyMissionLog(log) {
  if (!log || typeof log !== 'object') {
    return { entries: [] };
  }
  const entries = Array.isArray(log.entries)
    ? log.entries.slice(-12).map((entry) => ({
        id: entry.id ?? null,
        get: entry.timestampGet ?? entry.get ?? null,
        severity: entry.severity ?? entry.logSeverity ?? 'info',
        source: entry.source ?? entry.logSource ?? null,
        message: entry.message ?? '',
      }))
    : [];
  return {
    entries,
    totalCount: log.totalCount ?? entries.length,
  };
}

function simplifyScore(score) {
  if (!score || typeof score !== 'object') {
    return null;
  }
  const rating = score.rating ?? {};
  const history = Array.isArray(score.history)
    ? score.history.slice(-6).map((entry) => {
        const getLabel = entry.get != null
          ? entry.get
          : entry.getSeconds != null
            ? formatMaybeGet(entry.getSeconds, entry.get)
            : null;
        return {
          get: getLabel,
          commanderScore: coerceNumber(entry.commanderScore),
          grade: entry.grade ?? null,
        };
      })
    : [];
  return {
    rating: {
      commanderScore: coerceNumber(rating.commanderScore),
      baseScore: coerceNumber(rating.baseScore),
      manualBonus: coerceNumber(rating.manualBonus),
      grade: rating.grade ?? null,
      breakdown: rating.breakdown ?? null,
    },
    events: score.events ?? null,
    faults: score.faults ?? null,
    resources: score.resources
      ? {
          minPowerMarginPct: coerceNumber(score.resources.minPowerMarginPct, 1),
          minDeltaVMarginMps: coerceNumber(score.resources.minDeltaVMarginMps, 1),
          thermalViolationSeconds: coerceNumber(score.resources.thermalViolationSeconds),
        }
      : null,
    history,
  };
}

function simplifyPerformance(performance) {
  if (!performance || typeof performance !== 'object') {
    return null;
  }
  return {
    generatedAt: performance.generatedAt ?? null,
    overview: performance.overview ?? null,
    tick: performance.tick
      ? {
          averageMs: coerceNumber(performance.tick.averageMs ?? performance.tick.average, 3),
          maxMs: coerceNumber(performance.tick.maxMs ?? performance.tick.max, 3),
          minMs: coerceNumber(performance.tick.minMs ?? performance.tick.min, 3),
        }
      : null,
    hud: performance.hud
      ? {
          renderCount: performance.hud.renderCount ?? null,
          lastRenderGet: performance.hud.lastRenderGet ?? null,
          drops: performance.hud.drop?.total ?? null,
        }
      : null,
    audio: performance.audio
      ? {
          lastActiveTotal: performance.audio.lastActiveTotal ?? null,
          lastQueuedTotal: performance.audio.lastQueuedTotal ?? null,
          maxActiveTotal: performance.audio.maxActiveTotal ?? null,
          maxQueuedTotal: performance.audio.maxQueuedTotal ?? null,
        }
      : null,
  };
}

function coerceNumber(value, decimals = null) {
  if (value === null || value === undefined) {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  if (!Number.isFinite(decimals) || decimals == null) {
    return numeric;
  }
  const factor = 10 ** decimals;
  return Math.round(numeric * factor) / factor;
}

function cloneShallow(entry) {
  if (!entry || typeof entry !== 'object') {
    return entry;
  }
  return { ...entry };
}

function formatTankLabel(id) {
  switch (id) {
    case 'csm_sps':
      return 'SPS';
    case 'csm_rcs':
      return 'CSM RCS';
    case 'lm_descent':
      return 'LM DPS';
    case 'lm_ascent':
      return 'LM APS';
    case 'lm_rcs':
      return 'LM RCS';
    default:
      return id?.toUpperCase?.() ?? id ?? null;
  }
}

function formatMaybeGet(seconds, fallback) {
  const numeric = coerceNumber(seconds);
  if (!Number.isFinite(numeric)) {
    return fallback ?? null;
  }
  return formatGET(Math.round(numeric));
}
