import { formatGET } from '../utils/time.js';

const PROP_TANK_ORDER = ['csm_sps', 'csm_rcs', 'lm_descent', 'lm_ascent', 'lm_rcs'];
const RESOURCE_HISTORY_LIMIT = 120;
const PROP_HISTORY_LIMIT = 60;

export function createClientFrame(frame) {
  if (!frame || typeof frame !== 'object') {
    return null;
  }

  return {
    time: frame.time ?? null,
    events: simplifyEvents(frame.events),
    resources: simplifyResources(frame.resources),
    resourceHistory: simplifyResourceHistory(frame.resourceHistory),
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

function simplifyResourceHistory(history) {
  if (!history || typeof history !== 'object') {
    return null;
  }

  const metaRaw = history.meta ?? {};
  const meta = {
    enabled: metaRaw.enabled != null ? Boolean(metaRaw.enabled) : null,
    sampleIntervalSeconds: coerceNumber(metaRaw.sampleIntervalSeconds ?? metaRaw.sample_interval_seconds),
    durationSeconds: coerceNumber(metaRaw.durationSeconds ?? metaRaw.duration_seconds),
    maxSamples: coerceNumber(metaRaw.maxSamples ?? metaRaw.max_samples),
    lastSampleSeconds: coerceNumber(metaRaw.lastSampleSeconds ?? metaRaw.last_sample_seconds),
  };

  const power = mapRecentEntries(history.power, RESOURCE_HISTORY_LIMIT, (entry) => {
    if (!entry || typeof entry !== 'object') {
      return null;
    }
    return {
      timeSeconds: coerceNumber(entry.timeSeconds ?? entry.seconds ?? entry.getSeconds),
      powerMarginPct: coerceNumber(entry.powerMarginPct ?? entry.power_margin_pct, 1),
      fuelCellLoadKw: coerceNumber(entry.fuelCellLoadKw ?? entry.fuel_cell_load_kw, 2),
      fuelCellOutputKw: coerceNumber(entry.fuelCellOutputKw ?? entry.fuel_cell_output_kw, 2),
      batteryChargePct: coerceNumber(entry.batteryChargePct ?? entry.battery_charge_pct, 1),
      reactantMinutes: coerceNumber(entry.reactantMinutes ?? entry.reactant_minutes),
    };
  });

  const thermal = mapRecentEntries(history.thermal, RESOURCE_HISTORY_LIMIT, (entry) => {
    if (!entry || typeof entry !== 'object') {
      return null;
    }
    return {
      timeSeconds: coerceNumber(entry.timeSeconds ?? entry.seconds ?? entry.getSeconds),
      cryoBoiloffRatePctPerHr: coerceNumber(entry.cryoBoiloffRatePctPerHr ?? entry.cryo_boiloff_rate_pct_per_hr, 2),
      thermalState: entry.thermalState ?? entry.thermal_state ?? null,
      ptcActive: entry.ptcActive ?? entry.ptc_active ?? null,
    };
  });

  const communications = mapRecentEntries(history.communications, RESOURCE_HISTORY_LIMIT, (entry) => {
    if (!entry || typeof entry !== 'object') {
      return null;
    }
    return {
      timeSeconds: coerceNumber(entry.timeSeconds ?? entry.seconds ?? entry.getSeconds),
      active: entry.active != null ? Boolean(entry.active) : null,
      currentPassId: entry.currentPassId ?? entry.current_pass_id ?? null,
      currentStation: entry.currentStation ?? entry.current_station ?? null,
      timeRemainingSeconds: coerceNumber(entry.timeRemainingSeconds ?? entry.time_remaining_seconds),
      timeSinceOpenSeconds: coerceNumber(entry.timeSinceOpenSeconds ?? entry.time_since_open_seconds ?? entry.time_since_window_open_s),
      progress: coerceNumber(entry.progress ?? entry.passProgress, 3),
      nextPassId: entry.nextPassId ?? entry.next_pass_id ?? null,
      timeUntilNextWindowSeconds: coerceNumber(entry.timeUntilNextWindowSeconds ?? entry.time_until_next_window_seconds ?? entry.time_until_next_window_s),
      signalStrengthDb: coerceNumber(entry.signalStrengthDb ?? entry.signal_strength_db, 1),
      downlinkRateKbps: coerceNumber(entry.downlinkRateKbps ?? entry.downlink_rate_kbps, 1),
      powerLoadDeltaKw: coerceNumber(entry.powerLoadDeltaKw ?? entry.power_load_delta_kw, 2),
    };
  });

  const propellant = {};
  const propellantEntries = history.propellant && typeof history.propellant === 'object'
    ? Object.entries(history.propellant)
    : [];
  for (const [tankId, samples] of propellantEntries) {
    const mapped = mapRecentEntries(samples, PROP_HISTORY_LIMIT, (entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      return {
        timeSeconds: coerceNumber(entry.timeSeconds ?? entry.seconds ?? entry.getSeconds),
        remainingKg: coerceNumber(entry.remainingKg ?? entry.remaining_kg),
        initialKg: coerceNumber(entry.initialKg ?? entry.initial_kg),
        reserveKg: coerceNumber(entry.reserveKg ?? entry.reserve_kg),
        percentRemaining: coerceNumber(entry.percentRemaining ?? entry.percent_remaining, 1),
        percentAboveReserve: coerceNumber(entry.percentAboveReserve ?? entry.percent_above_reserve, 1),
      };
    });
    if (mapped.length > 0) {
      propellant[tankId] = mapped;
    }
  }

  return {
    meta,
    power,
    thermal,
    communications,
    propellant,
  };
}

function mapRecentEntries(entries, limit, mapper) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return [];
  }
  const maxEntries = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : entries.length;
  const startIndex = entries.length > maxEntries ? entries.length - maxEntries : 0;
  const result = [];
  for (let i = startIndex; i < entries.length; i += 1) {
    const mapped = mapper(entries[i], i);
    if (mapped && typeof mapped === 'object') {
      result.push(mapped);
    }
  }
  return result;
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
    ? checklists.active
        .map((entry) => simplifyChecklistEntry(entry))
        .filter(Boolean)
    : [];

  const chip = simplifyChecklistChip(checklists.chip);

  return {
    totals: checklists.totals ?? null,
    active,
    chip,
  };
}

function simplifyChecklistEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const definition = simplifyChecklistDefinition(entry.definition);
  const nextStepDefinition = entry.nextStepDefinition
    ? simplifyChecklistStepDefinition(entry.nextStepDefinition)
    : null;
  const steps = Array.isArray(entry.steps)
    ? entry.steps.map((step) => simplifyChecklistStep(step)).filter(Boolean)
    : [];

  const nextStepAction = entry.nextStepAction
    ?? nextStepDefinition?.callout
    ?? nextStepDefinition?.notes
    ?? null;

  const tags = Array.isArray(entry.tags) && entry.tags.length > 0
    ? entry.tags.slice(0, 6)
    : definition?.tags ?? undefined;

  return {
    checklistId: entry.checklistId ?? entry.id ?? null,
    title: entry.title ?? entry.checklistId ?? null,
    eventId: entry.eventId ?? null,
    crewRole: entry.crewRole ?? null,
    completedSteps: entry.completedSteps ?? 0,
    totalSteps: entry.totalSteps ?? null,
    nextStepNumber: entry.nextStepNumber ?? null,
    nextStepAction,
    autoAdvancePending: entry.autoAdvancePending ?? null,
    stepDurationSeconds: coerceNumber(entry.stepDurationSeconds),
    pad: simplifyPad(entry.pad),
    tags,
    definition,
    nextStepDefinition,
    steps,
  };
}

function simplifyChecklistChip(chip) {
  if (!chip || typeof chip !== 'object') {
    return null;
  }

  const definition = simplifyChecklistDefinition(chip.definition);
  const nextStepDefinition = chip.nextStepDefinition
    ? simplifyChecklistStepDefinition(chip.nextStepDefinition)
    : null;
  const nextStepAction = chip.nextStepAction
    ?? nextStepDefinition?.callout
    ?? nextStepDefinition?.notes
    ?? null;

  return {
    checklistId: chip.checklistId ?? null,
    eventId: chip.eventId ?? null,
    title: chip.title ?? null,
    nextStepNumber: chip.nextStepNumber ?? null,
    nextStepAction,
    stepsRemaining: chip.stepsRemaining ?? null,
    pad: simplifyPad(chip.pad),
    definition,
    nextStepDefinition,
  };
}

function simplifyChecklistDefinition(definition) {
  if (!definition || typeof definition !== 'object') {
    return null;
  }

  const summary = {
    id: definition.id ?? null,
    title: definition.title ?? null,
    phase: definition.phase ?? null,
    role: definition.role ?? null,
    nominalGet: definition.nominalGet ?? null,
    nominalGetSeconds: coerceNumber(definition.nominalGetSeconds),
    totalSteps: coerceNumber(definition.totalSteps),
  };

  if (definition.source) {
    summary.source = cloneShallow(definition.source);
  }
  if (Array.isArray(definition.tags) && definition.tags.length > 0) {
    summary.tags = definition.tags.slice(0, 6);
  }

  return summary;
}

function simplifyChecklistStepDefinition(definition) {
  if (!definition || typeof definition !== 'object') {
    return null;
  }

  const controls = Array.isArray(definition.controls)
    ? definition.controls.map((control) => simplifyChecklistControl(control)).filter(Boolean)
    : [];

  const effects = Array.isArray(definition.effects)
    ? definition.effects.map((effect) => (effect && typeof effect === 'object' ? { ...effect } : null)).filter(Boolean)
    : [];

  return {
    id: definition.id ?? null,
    order: coerceNumber(definition.order),
    callout: definition.callout ?? null,
    panelId: definition.panelId ?? null,
    panel: definition.panel ? cloneShallow(definition.panel) : null,
    dskyMacro: definition.dskyMacro ?? null,
    manualOnly: definition.manualOnly != null ? Boolean(definition.manualOnly) : null,
    notes: definition.notes ?? null,
    prerequisites: Array.isArray(definition.prerequisites)
      ? definition.prerequisites.slice(0, 8)
      : [],
    tags: Array.isArray(definition.tags) ? definition.tags.slice(0, 6) : [],
    controls,
    effects,
  };
}

function simplifyChecklistControl(control) {
  if (!control || typeof control !== 'object') {
    return null;
  }

  const summary = {
    controlId: control.controlId ?? null,
    targetState: control.targetState ?? null,
    targetStateLabel: control.targetStateLabel ?? null,
    verification: control.verification ?? null,
    tolerance: coerceNumber(control.tolerance),
    label: control.label ?? null,
    notes: control.notes ?? null,
    prerequisites: Array.isArray(control.prerequisites)
      ? control.prerequisites.slice(0, 6)
      : [],
    metadata: control.metadata ? { ...control.metadata } : null,
    targetStateDeltas: control.targetStateDeltas ? { ...control.targetStateDeltas } : null,
  };

  if (control.control) {
    summary.control = simplifyChecklistControlDefinition(control.control);
  }

  return summary;
}

function simplifyChecklistControlDefinition(control) {
  if (!control || typeof control !== 'object') {
    return null;
  }

  const summary = {
    id: control.id ?? null,
    label: control.label ?? null,
    type: control.type ?? null,
    defaultState: control.defaultState ?? null,
  };

  if (Array.isArray(control.states)) {
    summary.states = control.states
      .map((state) => (state && typeof state === 'object'
        ? { id: state.id ?? null, label: state.label ?? null }
        : null))
      .filter(Boolean);
  }

  if (control.hotspot && typeof control.hotspot === 'object') {
    summary.hotspot = { ...control.hotspot };
  }

  if (control.craft) {
    summary.craft = control.craft;
  }

  return summary;
}

function simplifyChecklistStep(step) {
  if (!step || typeof step !== 'object') {
    return null;
  }

  const definition = step.definition
    ? simplifyChecklistStepDefinition(step.definition)
    : null;
  const acknowledgedSeconds = coerceNumber(step.acknowledgedAtSeconds ?? step.acknowledgedAt);

  const tags = Array.isArray(step.tags) && step.tags.length > 0
    ? step.tags.slice(0, 6)
    : definition?.tags ?? [];

  return {
    stepNumber: coerceNumber(step.stepNumber ?? step.order),
    action: step.action ?? definition?.callout ?? null,
    expectedResponse: step.expectedResponse ?? null,
    reference: step.reference ?? definition?.notes ?? null,
    acknowledged: Boolean(step.acknowledged),
    acknowledgedAtSeconds: acknowledgedSeconds,
    acknowledgedAt: Number.isFinite(acknowledgedSeconds) ? formatGET(acknowledgedSeconds) : null,
    actor: step.actor ?? null,
    note: step.note ?? null,
    audioCueComplete: step.audioCueComplete ?? null,
    manualOnly: step.manualOnly != null ? Boolean(step.manualOnly) : definition?.manualOnly ?? null,
    isNext: Boolean(step.isNext),
    tags,
    dskyMacro: step.dskyMacro ?? definition?.dskyMacro ?? null,
    panel: definition?.panel ?? null,
    controls: definition?.controls ?? [],
    effects: definition?.effects ?? [],
    definition,
  };
}

function simplifyManualQueue(queue) {
  if (!queue || typeof queue !== 'object') {
    return null;
  }

  const counts = {
    pending: queue.pending ?? 0,
    scheduled: queue.scheduled ?? null,
    executed: queue.executed ?? null,
    failed: queue.failed ?? null,
    retried: queue.retried ?? null,
    acknowledgedSteps: queue.acknowledgedSteps ?? null,
    resourceDeltas: queue.resourceDeltas ?? null,
    propellantBurns: queue.propellantBurns ?? null,
    dskyEntries: queue.dskyEntries ?? null,
    panelControls: queue.panelControls ?? null,
  };

  const pendingActions = Array.isArray(queue.pendingActions)
    ? queue.pendingActions.map((action) => simplifyManualAction(action)).filter(Boolean)
    : [];

  const history = Array.isArray(queue.history)
    ? queue.history.map((entry) => simplifyManualHistoryEntry(entry)).filter(Boolean)
    : [];

  return {
    pending: counts.pending,
    scheduled: counts.scheduled,
    executed: counts.executed,
    failed: counts.failed,
    retried: counts.retried,
    acknowledgedSteps: counts.acknowledgedSteps,
    resourceDeltas: counts.resourceDeltas,
    propellantBurns: counts.propellantBurns,
    dskyEntries: counts.dskyEntries,
    panelControls: counts.panelControls,
    counts,
    pendingActions,
    history,
  };
}

function simplifyManualAction(action) {
  if (!action || typeof action !== 'object') {
    return null;
  }

  const getSeconds = coerceNumber(action.getSeconds);
  const retryUntilSeconds = coerceNumber(action.retryUntilSeconds);

  const base = {
    id: action.id ?? null,
    type: action.type ?? null,
    getSeconds,
    get: action.get ?? (Number.isFinite(getSeconds) ? formatGET(getSeconds) : null),
    retryUntilSeconds,
    retryUntil: action.retryUntil ?? (Number.isFinite(retryUntilSeconds) ? formatGET(retryUntilSeconds) : null),
    source: action.source ?? null,
  };

  switch (action.type) {
    case 'checklist_ack':
      return {
        ...base,
        eventId: action.eventId ?? null,
        count: coerceNumber(action.count),
        actor: action.actor ?? null,
        note: action.note ?? null,
      };
    case 'resource_delta':
      return {
        ...base,
        effect: action.effect && typeof action.effect === 'object' ? { ...action.effect } : null,
        note: action.note ?? null,
      };
    case 'propellant_burn':
      return {
        ...base,
        tankKey: action.tankKey ?? null,
        amountKg: coerceNumber(action.amountKg),
        note: action.note ?? null,
      };
    case 'dsky_entry': {
      const registers = action.registers && typeof action.registers === 'object'
        ? { ...action.registers }
        : {};
      const sequence = Array.isArray(action.sequence) ? [...action.sequence] : [];
      return {
        ...base,
        macroId: action.macroId ?? null,
        verb: coerceNumber(action.verb),
        verbLabel: action.verbLabel ?? (Number.isFinite(action.verb) ? formatVerbNoun(action.verb) : null),
        noun: coerceNumber(action.noun),
        nounLabel: action.nounLabel ?? (Number.isFinite(action.noun) ? formatVerbNoun(action.noun) : null),
        program: action.program ?? null,
        registers,
        sequence,
        note: action.note ?? null,
      };
    }
    case 'panel_control':
      return {
        ...base,
        panelId: action.panelId ?? null,
        controlId: action.controlId ?? null,
        stateId: action.stateId ?? null,
        actor: action.actor ?? null,
        note: action.note ?? null,
      };
    default:
      return base;
  }
}

function simplifyManualHistoryEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const executedSeconds = coerceNumber(entry.executedAtSeconds ?? entry.executedAt);

  return {
    id: entry.id ?? null,
    type: entry.type ?? null,
    executedAtSeconds: executedSeconds,
    executedAt: entry.executedAt ?? (Number.isFinite(executedSeconds) ? formatGET(executedSeconds) : null),
    status: entry.status ?? null,
    details: entry.details && typeof entry.details === 'object' ? { ...entry.details } : null,
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
