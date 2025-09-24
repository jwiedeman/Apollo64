const SPEED_OPTIONS = [
  { key: 'real', label: '1× (real time)', intervalMs: 1000, description: 'Frames paced every second.' },
  { key: '2x', label: '2×', intervalMs: 500, description: 'Frames paced every 0.5 s.' },
  { key: '4x', label: '4×', intervalMs: 250, description: 'Frames paced every 0.25 s.' },
  { key: '8x', label: '8×', intervalMs: 125, description: 'Frames paced every 0.125 s.' },
  { key: '16x', label: '16×', intervalMs: 62.5, description: 'Frames paced every 0.063 s.' },
  { key: 'fast', label: 'Fast (dev)', intervalMs: 0, description: 'No pacing; runs as fast as possible.' },
];

const SPEED_MAP = new Map(SPEED_OPTIONS.map((option) => [option.key, option]));
const DEFAULT_SPEED_KEY = 'real';
const DEFAULT_SAMPLE_SECONDS = 60;
const HUD_TICK_INTERVAL_MS = 100;

const state = {
  status: 'idle',
  targetSeconds: null,
  sampleSeconds: DEFAULT_SAMPLE_SECONDS,
  frames: [],
  currentFrame: null,
  summary: null,
  activeView: 'navigation',
  highlightChecklistTarget: null,
  requestedSampleSeconds: DEFAULT_SAMPLE_SECONDS,
  settings: {
    speed: DEFAULT_SPEED_KEY,
  },
  activeSpeed: DEFAULT_SPEED_KEY,
  pacing: {
    frameIntervalMs: SPEED_MAP.get(DEFAULT_SPEED_KEY)?.intervalMs ?? 0,
  },
  dynamicTime: {
    displayGetSeconds: null,
    lastFrameGetSeconds: null,
    nextFrameEstimateSeconds: null,
    lastUpdateMs: null,
  },
};

let eventSource = null;
let checklistHighlightTimer = null;
let hudTickerId = null;

const dom = {
  hud: {
    get: document.getElementById('hud-get'),
    met: document.getElementById('hud-met'),
    next: document.getElementById('hud-next'),
    nextPad: document.getElementById('hud-next-pad'),
    power: document.getElementById('hud-power'),
    deltaV: document.getElementById('hud-delta-v'),
    comms: document.getElementById('hud-comms'),
    score: document.getElementById('hud-score'),
    scoreDetail: document.getElementById('hud-score-detail'),
    maneuver: document.getElementById('hud-maneuver'),
    maneuverDetail: document.getElementById('hud-maneuver-detail'),
    status: document.getElementById('hud-status'),
    progress: document.getElementById('hud-progress'),
    progressBar: document.querySelector('.progress-bar'),
    ptc: document.getElementById('hud-ptc'),
    checklistChip: document.getElementById('hud-checklist-chip'),
    checklistLabel: document.getElementById('hud-checklist-label'),
    checklistDetail: document.getElementById('hud-checklist-detail'),
  },
  alertBanner: document.getElementById('alert-banner'),
  navigation: {
    trajectory: document.getElementById('nav-trajectory'),
    upcoming: document.getElementById('nav-upcoming'),
    autopilot: document.getElementById('nav-autopilot'),
    docking: document.getElementById('nav-docking'),
    entry: document.getElementById('nav-entry'),
  },
  controls: {
    checklists: document.getElementById('controls-checklists'),
    agc: document.getElementById('controls-agc'),
    manual: document.getElementById('controls-manual'),
  },
  systems: {
    resources: document.getElementById('systems-resources'),
    thermal: document.getElementById('systems-thermal'),
    performance: document.getElementById('systems-performance'),
    score: document.getElementById('systems-score'),
    trends: document.getElementById('systems-trends'),
  },
  missionLog: document.getElementById('mission-log'),
  summary: document.getElementById('summary-panel'),
  restartButton: document.getElementById('restart-button'),
  speedSelect: document.getElementById('speed-select'),
  speedHint: document.getElementById('speed-hint'),
  viewTabs: document.querySelectorAll('.tab-button'),
  views: document.querySelectorAll('.view'),
};

function init() {
  setupViewTabs();
  setupSpeedControl();
  if (dom.hud.checklistChip) {
    dom.hud.checklistChip.addEventListener('click', () => {
      if (!dom.hud.checklistChip.disabled) {
        focusActiveChecklist();
      }
    });
  }
  dom.restartButton?.addEventListener('click', () => {
    connectStream();
  });

  startHudTicker();

  if (!('EventSource' in window)) {
    state.status = 'unsupported';
    render();
    dom.summary.textContent = 'Your browser does not support live mission streaming.';
    return;
  }

  connectStream();
}

function setupViewTabs() {
  dom.viewTabs.forEach((button) => {
    const view = button.dataset.view;
    if (!view) {
      return;
    }
    button.id = `tab-${view}`;
    button.setAttribute('aria-controls', `view-${view}`);
    button.addEventListener('click', () => switchView(view));
  });
  updateViewVisibility();
}

function setupSpeedControl() {
  if (!dom.speedSelect) {
    return;
  }

  dom.speedSelect.innerHTML = '';
  SPEED_OPTIONS.forEach((option) => {
    const opt = document.createElement('option');
    opt.value = option.key;
    opt.textContent = option.label;
    dom.speedSelect.appendChild(opt);
  });

  dom.speedSelect.value = state.settings.speed;
  dom.speedSelect.addEventListener('change', () => {
    const selected = dom.speedSelect?.value ?? DEFAULT_SPEED_KEY;
    if (!SPEED_MAP.has(selected)) {
      return;
    }
    state.settings.speed = selected;
    updateSpeedMetadata();
    connectStream();
  });

  updateSpeedMetadata();
}

function startHudTicker() {
  if (hudTickerId != null) {
    window.clearInterval(hudTickerId);
  }
  hudTickerId = window.setInterval(() => {
    advanceDynamicClock();
    renderHudTime();
  }, HUD_TICK_INTERVAL_MS);
}

function switchView(view) {
  if (!view || state.activeView === view) {
    return;
  }
  state.activeView = view;
  updateViewVisibility();
}

function updateViewVisibility() {
  dom.viewTabs.forEach((button) => {
    const view = button.dataset.view;
    button.classList.toggle('active', view === state.activeView);
  });
  dom.views.forEach((section) => {
    section.classList.toggle('active', section.id === `view-${state.activeView}`);
  });
}

function focusActiveChecklist() {
  const chip = state.currentFrame?.checklists?.chip;
  if (!chip) {
    return;
  }
  switchView('controls');
  const target = {
    checklistId: chip.checklistId ?? chip.id ?? null,
    eventId: chip.eventId ?? null,
  };
  if (checklistHighlightTimer) {
    clearTimeout(checklistHighlightTimer);
    checklistHighlightTimer = null;
  }
  state.highlightChecklistTarget = target;
  render();
  scrollChecklistIntoView(target);
  checklistHighlightTimer = window.setTimeout(() => {
    resetChecklistHighlight();
    render();
  }, 1500);
}

function scrollChecklistIntoView(target) {
  if (!target || !dom.controls.checklists) {
    return;
  }
  const cards = dom.controls.checklists.querySelectorAll('.checklist-card');
  for (const card of cards) {
    const checklistId = card.dataset.checklistId || null;
    const eventId = card.dataset.eventId || null;
    const matchesChecklist = target.checklistId && checklistId === target.checklistId;
    const matchesEvent = target.eventId && eventId === target.eventId;
    if (matchesChecklist || matchesEvent) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      break;
    }
  }
}

function resetChecklistHighlight() {
  state.highlightChecklistTarget = null;
  if (checklistHighlightTimer) {
    clearTimeout(checklistHighlightTimer);
    checklistHighlightTimer = null;
  }
}

function connectStream() {
  cleanupStream();
  state.status = 'connecting';
  state.frames = [];
  state.currentFrame = null;
  state.summary = null;
  state.targetSeconds = null;
  state.activeSpeed = state.settings.speed;
  resetDynamicClock();
  resetChecklistHighlight();
  render();

  const params = new URLSearchParams();
  params.set('history', '1');
  if (state.settings.speed) {
    params.set('speed', state.settings.speed);
  }
  if (Number.isFinite(state.requestedSampleSeconds) && state.requestedSampleSeconds > 0) {
    params.set('sample', String(state.requestedSampleSeconds));
  }
  const streamUrl = `/api/stream?${params.toString()}`;
  eventSource = new EventSource(streamUrl);
  eventSource.addEventListener('status', (event) => {
    const payload = safeParse(event.data);
    if (!payload) {
      return;
    }
    state.status = payload.state ?? state.status;
    state.sampleSeconds = Number.isFinite(payload.sampleSeconds) ? payload.sampleSeconds : state.sampleSeconds;
    if (Number.isFinite(payload.untilGetSeconds)) {
      state.targetSeconds = payload.untilGetSeconds;
    }
    updateSpeedMetadata(payload);
    refreshDynamicEstimate();
    render();
  });

  const frameHandler = (event) => {
    const payload = safeParse(event.data);
    if (!payload) {
      return;
    }
    state.status = 'running';
    appendFrame(payload);
    render();
  };

  eventSource.addEventListener('frame', frameHandler);
  eventSource.addEventListener('final-frame', frameHandler);
  eventSource.addEventListener('summary', (event) => {
    const payload = safeParse(event.data);
    if (!payload) {
      return;
    }
    state.summary = payload;
    if (Number.isFinite(payload.finalGetSeconds)) {
      updateCompletionTime(payload.finalGetSeconds);
    }
    render();
  });
  eventSource.addEventListener('complete', () => {
    state.status = 'complete';
    const summarySeconds = Number(state.summary?.finalGetSeconds);
    const frameSeconds = Number(state.currentFrame?.time?.getSeconds);
    const fallbackSeconds = Number(state.targetSeconds);
    const finalSeconds = Number.isFinite(summarySeconds)
      ? summarySeconds
      : Number.isFinite(frameSeconds)
        ? frameSeconds
        : fallbackSeconds;
    updateCompletionTime(finalSeconds);
    render();
    cleanupStream();
  });
  eventSource.addEventListener('error', () => {
    if (state.status !== 'complete') {
      state.status = 'error';
      render();
    }
    cleanupStream();
  });
}

function cleanupStream() {
  const hadHighlight = Boolean(state.highlightChecklistTarget);
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  resetChecklistHighlight();
  if (hadHighlight) {
    render();
  }
}

function appendFrame(frame) {
  if (!frame || typeof frame !== 'object') {
    return;
  }
  const last = state.frames[state.frames.length - 1];
  if (last && last.time?.getSeconds === frame.time?.getSeconds) {
    state.frames[state.frames.length - 1] = frame;
  } else {
    state.frames.push(frame);
  }
  state.currentFrame = frame;
  updateDynamicClock(frame);
}

function safeNow() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function resetDynamicClock() {
  const now = safeNow();
  state.dynamicTime.displayGetSeconds = null;
  state.dynamicTime.lastFrameGetSeconds = null;
  state.dynamicTime.nextFrameEstimateSeconds = null;
  state.dynamicTime.lastUpdateMs = now;
}

function updateCompletionTime(seconds) {
  const finalSeconds = Number(seconds);
  if (!Number.isFinite(finalSeconds)) {
    return;
  }
  const now = safeNow();
  state.dynamicTime.displayGetSeconds = finalSeconds;
  state.dynamicTime.lastFrameGetSeconds = finalSeconds;
  state.dynamicTime.nextFrameEstimateSeconds = finalSeconds;
  state.dynamicTime.lastUpdateMs = now;
}

function getSpeedConfig(key) {
  if (SPEED_MAP.has(key)) {
    return SPEED_MAP.get(key);
  }
  return SPEED_MAP.get(DEFAULT_SPEED_KEY);
}

function updateSpeedMetadata(payload = null) {
  if (!SPEED_MAP.has(state.settings.speed)) {
    state.settings.speed = DEFAULT_SPEED_KEY;
  }

  let activeKey = state.settings.speed;
  const payloadSpeed = payload && typeof payload.speed === 'string' ? payload.speed : null;
  if (payloadSpeed && SPEED_MAP.has(payloadSpeed)) {
    activeKey = payloadSpeed;
    state.settings.speed = activeKey;
    if (dom.speedSelect && dom.speedSelect.value !== activeKey) {
      dom.speedSelect.value = activeKey;
    }
  } else if (dom.speedSelect && dom.speedSelect.value !== state.settings.speed) {
    dom.speedSelect.value = state.settings.speed;
  }

  state.activeSpeed = activeKey;
  const activeConfig = getSpeedConfig(activeKey);

  if (payload && Number.isFinite(Number(payload.frameIntervalMs)) && Number(payload.frameIntervalMs) >= 0) {
    state.pacing.frameIntervalMs = Number(payload.frameIntervalMs);
  } else {
    state.pacing.frameIntervalMs = activeConfig.intervalMs;
  }

  updateSpeedHint(activeConfig);
}

function updateSpeedHint(config = null) {
  if (!dom.speedHint) {
    return;
  }
  const activeConfig = config ?? getSpeedConfig(state.activeSpeed);
  const interval = Number(state.pacing.frameIntervalMs);
  if (!Number.isFinite(interval) || interval <= 0) {
    dom.speedHint.textContent = `${activeConfig.label} · Running at maximum speed.`;
    return;
  }
  if (interval >= 1000) {
    const seconds = interval / 1000;
    const digits = seconds >= 10 ? 0 : 1;
    dom.speedHint.textContent = `${activeConfig.label} · ${formatNumber(seconds, { digits })} s between frames`;
    return;
  }
  const digits = interval >= 100 ? 0 : interval >= 10 ? 0 : 1;
  dom.speedHint.textContent = `${activeConfig.label} · ${formatNumber(interval, { digits })} ms between frames`;
}

function refreshDynamicEstimate() {
  const sample = Number(state.sampleSeconds);
  if (!Number.isFinite(sample) || sample <= 0) {
    return;
  }
  if (!Number.isFinite(state.dynamicTime.lastFrameGetSeconds)) {
    return;
  }
  state.dynamicTime.nextFrameEstimateSeconds = state.dynamicTime.lastFrameGetSeconds + sample;
  if (Number.isFinite(state.targetSeconds)) {
    state.dynamicTime.nextFrameEstimateSeconds = Math.min(
      state.dynamicTime.nextFrameEstimateSeconds,
      state.targetSeconds,
    );
  }
}

function updateDynamicClock(frame) {
  if (!frame || typeof frame !== 'object') {
    return;
  }
  const getSeconds = Number(frame.time?.getSeconds);
  if (!Number.isFinite(getSeconds)) {
    return;
  }
  const now = safeNow();
  state.dynamicTime.displayGetSeconds = getSeconds;
  state.dynamicTime.lastFrameGetSeconds = getSeconds;
  const sample = Number(state.sampleSeconds);
  if (Number.isFinite(sample) && sample > 0) {
    state.dynamicTime.nextFrameEstimateSeconds = getSeconds + sample;
  } else {
    state.dynamicTime.nextFrameEstimateSeconds = getSeconds;
  }
  if (Number.isFinite(state.targetSeconds)) {
    state.dynamicTime.nextFrameEstimateSeconds = Math.min(
      state.dynamicTime.nextFrameEstimateSeconds,
      state.targetSeconds,
    );
  }
  state.dynamicTime.lastUpdateMs = now;
}

function advanceDynamicClock() {
  if (!Number.isFinite(state.dynamicTime.lastFrameGetSeconds)) {
    return;
  }
  const interval = Number(state.pacing.frameIntervalMs);
  const sample = Number(state.sampleSeconds);
  const now = safeNow();
  if (!Number.isFinite(interval) || interval <= 0 || !Number.isFinite(sample) || sample <= 0) {
    state.dynamicTime.displayGetSeconds = state.dynamicTime.lastFrameGetSeconds;
    state.dynamicTime.lastUpdateMs = now;
    return;
  }
  const lastUpdate = state.dynamicTime.lastUpdateMs ?? now;
  const deltaMs = now - lastUpdate;
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) {
    state.dynamicTime.lastUpdateMs = now;
    return;
  }
  const missionPerMs = sample / interval;
  let projected = state.dynamicTime.lastFrameGetSeconds + missionPerMs * deltaMs;
  if (Number.isFinite(state.dynamicTime.nextFrameEstimateSeconds)) {
    projected = Math.min(projected, state.dynamicTime.nextFrameEstimateSeconds);
  }
  if (Number.isFinite(state.targetSeconds)) {
    projected = Math.min(projected, state.targetSeconds);
  }
  state.dynamicTime.displayGetSeconds = projected;
  state.dynamicTime.lastUpdateMs = now;
}

function getDisplayGetSeconds() {
  const display = Number(state.dynamicTime.displayGetSeconds);
  if (Number.isFinite(display)) {
    return display;
  }
  const fallback = Number(state.currentFrame?.time?.getSeconds);
  return Number.isFinite(fallback) ? fallback : null;
}

function renderHudTime() {
  const displaySeconds = getDisplayGetSeconds();
  if (Number.isFinite(displaySeconds)) {
    setText(dom.hud.get, formatGetFromSeconds(displaySeconds));
  } else {
    setText(dom.hud.get, state.currentFrame?.time?.get ?? '--:--:--');
  }

  const progressSeconds = Number.isFinite(displaySeconds)
    ? displaySeconds
    : Number(state.currentFrame?.time?.getSeconds);
  const progress = computeProgress(progressSeconds, state.targetSeconds);
  if (progress != null) {
    dom.hud.progress.style.width = `${progress}%`;
    if (dom.hud.progressBar) {
      dom.hud.progressBar.setAttribute('aria-valuenow', String(progress));
    }
  } else {
    dom.hud.progress.style.width = '0%';
    if (dom.hud.progressBar) {
      dom.hud.progressBar.setAttribute('aria-valuenow', '0');
    }
  }
}

function safeParse(data) {
  try {
    return JSON.parse(data);
  } catch (error) {
    console.warn('Failed to parse event payload', error);
    return null;
  }
}

function render() {
  renderHud();
  renderAlertBanner();
  renderNavigationView();
  renderControlsView();
  renderSystemsView();
  renderMissionLog();
  renderSummary();
}

function renderHud() {
  const frame = state.currentFrame;
  renderHudTime();
  setText(dom.hud.met, frame?.time?.met ? `MET ${frame.time.met}` : 'MET --:--:--');

  const next = frame?.events?.next;
  if (next) {
    const phase = next.phase ? ` (${next.phase})` : '';
    const status = next.status ? ` – ${next.status}` : '';
    const tMinus = next.tMinusLabel ?? 'TBD';
    dom.hud.next.textContent = `${next.id ?? 'Event'}${phase}${status}`;
    dom.hud.nextPad.textContent = tMinus;
  } else if (dom.hud.next) {
    dom.hud.next.textContent = 'No upcoming events';
    dom.hud.nextPad.textContent = '';
  }

  const powerMargin = frame?.resources?.power?.marginPct;
  dom.hud.power.textContent = powerMargin != null ? `${formatNumber(powerMargin, { digits: 1 })}%` : '--%';

  const deltaV = frame?.resources?.deltaV?.totalMps;
  dom.hud.deltaV.textContent = deltaV != null ? `${formatNumber(deltaV, { digits: 0 })} m/s` : '-- m/s';

  const comms = frame?.resources?.communications;
  if (comms?.current?.station) {
    const parts = [comms.current.station];
    if (comms.current.timeRemainingLabel) {
      parts.push(comms.current.timeRemainingLabel);
    }
    if (comms.current.signalStrengthDb != null) {
      parts.push(`${formatNumber(comms.current.signalStrengthDb, { digits: 1 })} dB`);
    }
    dom.hud.comms.textContent = parts.join(' · ');
  } else if (comms?.nextWindowOpenGet) {
    const label = comms.timeUntilNextWindowLabel ?? comms.nextWindowOpenGet;
    dom.hud.comms.textContent = `Next pass ${label}`;
  } else {
    dom.hud.comms.textContent = 'Idle';
  }

  const thermal = frame?.resources?.thermal;
  if (dom.hud.ptc) {
    const indicator = dom.hud.ptc;
    indicator.classList.remove('active', 'warning', 'caution');
    if (thermal) {
      const isActive = Boolean(thermal.ptcActive);
      const rateLabel = Number.isFinite(thermal.cryoBoiloffRatePctPerHr)
        ? `${formatNumber(thermal.cryoBoiloffRatePctPerHr, { digits: 2 })}%/hr`
        : null;
      const labelParts = [isActive ? 'Active' : 'Idle'];
      if (rateLabel) {
        labelParts.push(rateLabel);
      }
      indicator.textContent = labelParts.join(' · ');
      if (isActive) {
        indicator.classList.add('active');
      }
      if (thermal.cryoBoiloffRatePctPerHr != null) {
        const rate = Number(thermal.cryoBoiloffRatePctPerHr);
        if (Number.isFinite(rate)) {
          if (rate >= 2.5) {
            indicator.classList.add('warning');
          } else if (rate >= 1.5) {
            indicator.classList.add('caution');
          }
        }
      }
    } else {
      indicator.textContent = 'Idle';
    }
  }

  const score = frame?.score?.rating;
  if (score) {
    const grade = score.grade ?? '—';
    const commanderScore = score.commanderScore != null
      ? `${formatNumber(score.commanderScore, { digits: 1 })}`
      : '—';
    dom.hud.score.textContent = `Grade ${grade}`;
    dom.hud.scoreDetail.textContent = `Commander ${commanderScore}`;
  } else {
    dom.hud.score.textContent = '--';
    dom.hud.scoreDetail.textContent = 'Commander score';
  }

  updateChecklistChip(frame?.checklists?.chip);
  renderManeuver(frame);

  const statusLabel = mapStatus(state.status);
  const speedConfig = getSpeedConfig(state.activeSpeed ?? state.settings.speed);
  const statusText = speedConfig ? `${statusLabel} · ${speedConfig.label}` : statusLabel;
  dom.hud.status.textContent = statusText;
}

function updateChecklistChip(chip) {
  const chipButton = dom.hud.checklistChip;
  const labelEl = dom.hud.checklistLabel;
  const detailEl = dom.hud.checklistDetail;
  if (!chipButton || !labelEl || !detailEl) {
    return;
  }
  if (chip) {
    chipButton.disabled = false;
    chipButton.classList.add('active');
    const label = chip.title ?? chip.checklistId ?? 'Checklist';
    labelEl.textContent = label;
    const detailParts = [];
    if (chip.nextStepNumber != null) {
      detailParts.push(`Step ${chip.nextStepNumber}`);
    }
    if (chip.nextStepAction) {
      detailParts.push(chip.nextStepAction);
    }
    if (chip.pad?.tig) {
      detailParts.push(`TIG ${chip.pad.tig}`);
    }
    detailEl.textContent = detailParts.join(' · ') || 'Next step ready.';
    chipButton.dataset.checklistId = chip.checklistId ?? '';
    chipButton.dataset.eventId = chip.eventId ?? '';
    const ariaLabel = chip.nextStepAction
      ? `Focus ${label}. Next: ${chip.nextStepAction}`
      : `Focus ${label}`;
    chipButton.setAttribute('aria-label', ariaLabel);
    chipButton.title = chip.nextStepAction ?? label;
  } else {
    chipButton.disabled = true;
    chipButton.classList.remove('active');
    labelEl.textContent = 'Checklist idle';
    detailEl.textContent = 'Auto crew standing by.';
    chipButton.dataset.checklistId = '';
    chipButton.dataset.eventId = '';
    chipButton.removeAttribute('aria-label');
    chipButton.removeAttribute('title');
  }
}

function renderManeuver(frame) {
  const labelEl = dom.hud.maneuver;
  const detailEl = dom.hud.maneuverDetail;
  if (!labelEl || !detailEl) {
    return;
  }

  let label = 'Coast';
  let detail = 'No programs active.';
  let handled = false;

  const autopilot = frame?.autopilot;
  if (autopilot?.primary) {
    const primary = autopilot.primary;
    label = primary.label ?? primary.id ?? 'Autopilot';
    const parts = [];
    if (primary.status) {
      parts.push(capitalize(primary.status));
    }
    if (primary.progress != null) {
      parts.push(`${formatNumber(primary.progress * 100, { digits: 0 })}%`);
    }
    if (primary.timeRemainingLabel) {
      parts.push(primary.timeRemainingLabel);
    } else if (primary.pad?.tig) {
      parts.push(`TIG ${primary.pad.tig}`);
    }
    detail = parts.join(' · ') || 'Autopilot active.';
    handled = true;
  } else if (autopilot?.counts?.active > 0) {
    const activeCount = autopilot.counts.active;
    label = 'Autopilot';
    const parts = [`${activeCount} program${activeCount === 1 ? '' : 's'} active`];
    if (autopilot.counts?.completed != null) {
      parts.push(`${autopilot.counts.completed} complete`);
    }
    detail = parts.join(' · ');
    handled = true;
  }

  const docking = frame?.docking;
  if (!handled && docking && (docking.activeGateId || Number.isFinite(docking?.rangeMeters))) {
    label = 'Docking';
    const parts = [];
    if (docking.activeGateId) {
      parts.push(docking.activeGateId);
    }
    const rangeLabel = formatRangeMeters(docking.rangeMeters);
    if (rangeLabel !== '—') {
      parts.push(rangeLabel);
    }
    const closing = describeClosingRate(docking.closingRateMps);
    if (closing) {
      parts.push(closing);
    }
    detail = parts.join(' · ') || 'Rendezvous in progress.';
    handled = true;
  }

  const entry = frame?.entry;
  if (!handled && entry?.entryInterfaceGet) {
    label = 'Entry Prep';
    const parts = [`Interface ${entry.entryInterfaceGet}`];
    const blackout = entry.blackout;
    if (blackout?.status) {
      const status = capitalize(blackout.status);
      if (Number.isFinite(blackout.remainingSeconds)) {
        const remaining = Math.max(0, blackout.remainingSeconds);
        parts.push(`${status} in ${formatDuration(remaining)}`);
      } else if (blackout.startsAtGet) {
        parts.push(`${status} ${blackout.startsAtGet}`);
      } else {
        parts.push(status);
      }
    }
    if (entry.ems?.predictedSplashdownGet) {
      parts.push(`Splash ${entry.ems.predictedSplashdownGet}`);
    }
    detail = parts.join(' · ') || 'Entry monitoring active.';
    handled = true;
  }

  const thermal = frame?.resources?.thermal;
  if (!handled && thermal?.ptcActive) {
    label = 'PTC';
    const parts = [];
    if (thermal.cryoBoiloffRatePctPerHr != null) {
      parts.push(`${formatNumber(thermal.cryoBoiloffRatePctPerHr, { digits: 2 })}%/hr boil-off`);
    }
    const powerMargin = frame?.resources?.power?.marginPct;
    if (powerMargin != null) {
      parts.push(`Power ${formatNumber(powerMargin, { digits: 1 })}%`);
    }
    detail = parts.join(' · ') || 'Thermal roll active.';
    handled = true;
  }

  const manualQueue = frame?.manualQueue;
  if (!handled && manualQueue?.pending > 0) {
    label = 'Manual Ops';
    detail = `${manualQueue.pending} queued action${manualQueue.pending === 1 ? '' : 's'}`;
    handled = true;
  }

  if (!handled) {
    const nextEvent = frame?.events?.next;
    if (nextEvent?.id) {
      label = nextEvent.id;
      const parts = [];
      if (nextEvent.status) {
        parts.push(capitalize(nextEvent.status));
      }
      if (nextEvent.tMinusLabel) {
        parts.push(`T${nextEvent.tMinusLabel}`);
      }
      detail = parts.join(' · ') || 'Mission coasting.';
    }
  }

  labelEl.textContent = label;
  detailEl.textContent = detail;
}

function renderAlertBanner() {
  const banner = dom.alertBanner;
  if (!banner) {
    return;
  }
  const alerts = state.currentFrame?.alerts;
  const failures = alerts?.failures ?? [];
  const warnings = alerts?.warnings ?? [];
  const cautions = alerts?.cautions ?? [];

  banner.className = 'alert-banner';
  banner.textContent = '';

  if (failures.length > 0) {
    banner.classList.add('active', 'failure');
    banner.textContent = formatAlertList('Critical', failures);
  } else if (warnings.length > 0) {
    banner.classList.add('active', 'warning');
    banner.textContent = formatAlertList('Warning', warnings);
  } else if (cautions.length > 0) {
    banner.classList.add('active');
    banner.textContent = formatAlertList('Caution', cautions);
  }
}

function formatAlertList(prefix, list) {
  const labels = list
    .map((item) => item.label ?? item.id ?? item.message)
    .filter(Boolean)
    .slice(0, 3);
  return labels.length > 0 ? `${prefix}: ${labels.join(', ')}` : `${prefix} alert`; 
}

function renderNavigationView() {
  const frame = state.currentFrame;
  renderTrajectory(frame?.trajectory);
  renderUpcoming(frame?.events?.upcoming);
  renderAutopilot(frame?.autopilot);
  renderDocking(frame?.docking);
  renderEntrySummary(frame?.entry);
}

function renderTrajectory(trajectory) {
  const container = dom.navigation.trajectory;
  if (!container) {
    return;
  }
  container.textContent = '';
  if (!trajectory) {
    container.textContent = 'No trajectory data yet.';
    return;
  }
  const fragment = document.createDocumentFragment();

  const body = trajectory.body?.name ?? trajectory.body?.id ?? 'Unknown body';
  fragment.appendChild(createParagraph(`${body} frame`));

  const stats = document.createElement('div');
  stats.className = 'progress-grid';
  stats.appendChild(createTile('Altitude', trajectory.altitudeKm != null ? `${formatNumber(trajectory.altitudeKm, { digits: 0 })} km` : '—'));
  stats.appendChild(createTile('Speed', trajectory.speedKmPerSec != null ? `${formatNumber(trajectory.speedKmPerSec, { digits: 3 })} km/s` : '—'));
  if (trajectory.elements) {
    stats.appendChild(createTile('Apoapsis', trajectory.elements.apoapsisKm != null ? `${formatNumber(trajectory.elements.apoapsisKm, { digits: 0 })} km` : '—'));
    stats.appendChild(createTile('Periapsis', trajectory.elements.periapsisKm != null ? `${formatNumber(trajectory.elements.periapsisKm, { digits: 0 })} km` : '—'));
    stats.appendChild(createTile('Eccentricity', trajectory.elements.eccentricity != null ? formatNumber(trajectory.elements.eccentricity, { digits: 4 }) : '—'));
  }
  fragment.appendChild(stats);

  container.appendChild(fragment);
}

function renderUpcoming(upcoming) {
  const list = dom.navigation.upcoming;
  if (!list) {
    return;
  }
  list.textContent = '';
  if (!Array.isArray(upcoming) || upcoming.length === 0) {
    list.appendChild(createListItem('No upcoming events scheduled.'));
    return;
  }
  upcoming.forEach((event) => {
    const item = document.createElement('li');
    item.className = 'list-item';

    const title = document.createElement('strong');
    const phase = event.phase ? ` (${event.phase})` : '';
    title.textContent = `${event.id ?? 'Event'}${phase}`;
    item.appendChild(title);

    const tMinus = document.createElement('span');
    tMinus.textContent = `T${event.tMinusLabel ?? '—'}`;
    tMinus.className = 'badge';
    item.appendChild(tMinus);

    if (event.pad?.tig) {
      const pad = document.createElement('span');
      pad.textContent = `TIG ${event.pad.tig}`;
      pad.className = 'hud-subvalue';
      item.appendChild(pad);
    }

    list.appendChild(item);
  });
}

function renderAutopilot(autopilot) {
  const container = dom.navigation.autopilot;
  if (!container) {
    return;
  }
  container.textContent = '';
  if (!autopilot) {
    container.textContent = 'Autopilot idle.';
    return;
  }
  const parts = [];
  if (autopilot.primary) {
    const primary = autopilot.primary;
    const progressLabel = primary.progress != null ? `${formatNumber(primary.progress * 100, { digits: 0 })}%` : '—';
    parts.push(`Primary ${primary.id ?? 'PGM'} (${progressLabel})`);
    if (primary.pad?.tig) {
      parts.push(`TIG ${primary.pad.tig}`);
    }
  }
  parts.push(`Active ${autopilot.counts?.active ?? 0}`);
  parts.push(`Completed ${autopilot.counts?.completed ?? 0}`);
  container.appendChild(createParagraph(parts.join(' · ')));

  if (Array.isArray(autopilot.active) && autopilot.active.length > 0) {
    const list = document.createElement('ul');
    list.className = 'list';
    autopilot.active.forEach((entry) => {
      const li = document.createElement('li');
      li.className = 'list-item';
      const title = document.createElement('strong');
      title.textContent = entry.id ?? entry.label ?? 'Autopilot';
      li.appendChild(title);
      const metaParts = [];
      if (entry.progress != null) {
        metaParts.push(`${formatNumber(entry.progress * 100, { digits: 0 })}%`);
      }
      if (entry.timeRemainingLabel) {
        metaParts.push(entry.timeRemainingLabel);
      }
      if (metaParts.length > 0) {
        li.appendChild(createParagraph(metaParts.join(' · ')));
      }
      if (entry.pad?.tig) {
        li.appendChild(createParagraph(`TIG ${entry.pad.tig}`));
      }
      list.appendChild(li);
    });
    container.appendChild(list);
  }

  const totals = autopilot.totals ?? {};
  const totalsParts = [];
  if (totals.burnSeconds != null) {
    totalsParts.push(`Burn ${formatNumber(totals.burnSeconds, { digits: 0 })} s`);
  }
  if (totals.ullageSeconds != null) {
    totalsParts.push(`Ullage ${formatNumber(totals.ullageSeconds, { digits: 0 })} s`);
  }
  if (totals.rcsImpulseNs != null) {
    totalsParts.push(`RCS ${formatNumber(totals.rcsImpulseNs, { digits: 0 })} Ns`);
  }
  if (totalsParts.length > 0) {
    container.appendChild(createParagraph(totalsParts.join(' · ')));
  }
}

function renderDocking(docking) {
  const container = dom.navigation.docking;
  if (!container) {
    return;
  }
  container.textContent = '';
  if (!docking) {
    container.textContent = 'Docking monitor idle.';
    return;
  }
  const fragment = document.createDocumentFragment();
  if (docking.eventId) {
    fragment.appendChild(createParagraph(`Event ${docking.eventId}`));
  }
  const stats = document.createElement('div');
  stats.className = 'progress-grid';
  stats.appendChild(createTile('Progress', docking.progress != null ? `${formatNumber(docking.progress * 100, { digits: 0 })}%` : '—'));
  stats.appendChild(createTile('Range', formatRangeMeters(docking.rangeMeters)));
  stats.appendChild(createTile('Closing rate', describeClosingRate(docking.closingRateMps) ?? '—'));
  if (docking.lateralRateMps != null) {
    const lateralDigits = Math.abs(docking.lateralRateMps) >= 1 ? 2 : 3;
    stats.appendChild(createTile('Lateral', `${formatNumber(docking.lateralRateMps, { digits: lateralDigits })} m/s`));
  }
  fragment.appendChild(stats);

  if (Array.isArray(docking.gates) && docking.gates.length > 0) {
    const list = document.createElement('ul');
    list.className = 'mini-list';
    docking.gates.slice(0, 3).forEach((gate) => {
      const metaParts = [];
      if (gate.rangeMeters != null) {
        metaParts.push(formatRangeMeters(gate.rangeMeters));
      }
      if (gate.targetRateMps != null) {
        const targetDigits = Math.abs(gate.targetRateMps) >= 1 ? 2 : 3;
        metaParts.push(`${formatNumber(gate.targetRateMps, { digits: targetDigits })} m/s target`);
      }
      if (gate.status) {
        metaParts.push(capitalize(gate.status));
      }
      let detail = '';
      if (Number.isFinite(gate.timeRemainingSeconds)) {
        detail = `T-${formatDuration(Math.max(gate.timeRemainingSeconds, 0))}`;
      } else if (gate.deadlineGet) {
        detail = `Deadline ${gate.deadlineGet}`;
      }
      const title = gate.label ?? gate.id ?? 'Gate';
      list.appendChild(createMiniListItem(title, metaParts.join(' · '), detail));
    });
    fragment.appendChild(list);
  }

  container.appendChild(fragment);
}

function renderEntrySummary(entry) {
  const container = dom.navigation.entry;
  if (!container) {
    return;
  }
  container.textContent = '';
  if (!entry) {
    container.textContent = 'Entry monitoring idle.';
    return;
  }
  const fragment = document.createDocumentFragment();
  const stats = document.createElement('div');
  stats.className = 'progress-grid';
  stats.appendChild(createTile('Interface', entry.entryInterfaceGet ?? '—'));
  if (entry.corridor) {
    const corridor = entry.corridor;
    const angleParts = [];
    if (corridor.currentDegrees != null) {
      angleParts.push(`γ ${formatNumber(corridor.currentDegrees, { digits: 2 })}°`);
    }
    if (corridor.targetDegrees != null) {
      angleParts.push(`Target ${formatNumber(corridor.targetDegrees, { digits: 2 })}°`);
    }
    stats.appendChild(createTile('Corridor', angleParts.join(' · ') || '—'));
  }
  if (entry.blackout) {
    const blackout = entry.blackout;
    let label = 'Idle';
    if (blackout.status) {
      label = capitalize(blackout.status);
    }
    if (Number.isFinite(blackout.remainingSeconds)) {
      label += ` · ${formatDuration(Math.max(blackout.remainingSeconds, 0))}`;
    } else if (blackout.startsAtGet && blackout.status === 'pending') {
      label += ` · ${blackout.startsAtGet}`;
    }
    stats.appendChild(createTile('Blackout', label));
  }
  if (entry.ems) {
    const ems = entry.ems;
    const emsParts = [];
    if (ems.velocityFtPerSec != null) {
      emsParts.push(`${formatNumber(ems.velocityFtPerSec, { digits: 0 })} ft/s`);
    }
    if (ems.altitudeFt != null) {
      emsParts.push(`${formatNumber(ems.altitudeFt, { digits: 0 })} ft`);
    }
    if (ems.predictedSplashdownGet) {
      emsParts.push(`Splash ${ems.predictedSplashdownGet}`);
    }
    stats.appendChild(createTile('EMS', emsParts.join(' · ') || 'Standby'));
  }
  if (entry.gLoad) {
    const gLoad = entry.gLoad;
    const gParts = [];
    if (gLoad.current != null) {
      gParts.push(`${formatNumber(gLoad.current, { digits: 2 })} g`);
    }
    if (gLoad.max != null) {
      gParts.push(`Max ${formatNumber(gLoad.max, { digits: 1 })} g`);
    }
    stats.appendChild(createTile('G-load', gParts.join(' · ') || '—'));
  }
  fragment.appendChild(stats);

  if (entry.corridor && (entry.corridor.downrangeErrorKm != null || entry.corridor.crossrangeErrorKm != null)) {
    const driftParts = [];
    if (entry.corridor.downrangeErrorKm != null) {
      driftParts.push(`Downrange ${formatNumber(entry.corridor.downrangeErrorKm, { digits: 1 })} km`);
    }
    if (entry.corridor.crossrangeErrorKm != null) {
      driftParts.push(`Crossrange ${formatNumber(entry.corridor.crossrangeErrorKm, { digits: 1 })} km`);
    }
    if (driftParts.length > 0) {
      fragment.appendChild(createParagraph(driftParts.join(' · ')));
    }
  }

  if (Array.isArray(entry.recovery) && entry.recovery.length > 0) {
    const list = document.createElement('ul');
    list.className = 'mini-list';
    entry.recovery.slice(0, 4).forEach((step) => {
      const metaParts = [];
      if (step.get) {
        metaParts.push(step.get);
      }
      if (step.status) {
        metaParts.push(capitalize(step.status));
      }
      list.appendChild(createMiniListItem(step.label ?? step.id ?? 'Milestone', metaParts.join(' · ')));
    });
    fragment.appendChild(list);
  }

  container.appendChild(fragment);
}

function renderControlsView() {
  const frame = state.currentFrame;
  renderChecklists(frame?.checklists);
  renderAgc(frame?.agc);
  renderManualQueue(frame?.manualQueue);
}

function renderChecklists(checklists) {
  const container = dom.controls.checklists;
  if (!container) {
    return;
  }
  container.textContent = '';
  if (!checklists || !Array.isArray(checklists.active) || checklists.active.length === 0) {
    container.textContent = 'No active checklists.';
    return;
  }
  const fragment = document.createDocumentFragment();
  const highlightTarget = state.highlightChecklistTarget;
  checklists.active.forEach((entry) => {
    const card = document.createElement('div');
    card.className = 'checklist-card';
    const checklistId = entry.checklistId ?? entry.id ?? '';
    if (checklistId) {
      card.dataset.checklistId = checklistId;
    }
    if (entry.eventId) {
      card.dataset.eventId = entry.eventId;
    }
    if (highlightTarget) {
      const matchesChecklist = highlightTarget.checklistId
        && checklistId
        && highlightTarget.checklistId === checklistId;
      const matchesEvent = highlightTarget.eventId
        && entry.eventId
        && highlightTarget.eventId === entry.eventId;
      if (matchesChecklist || matchesEvent) {
        card.classList.add('highlight');
      }
    }

    const title = document.createElement('strong');
    title.textContent = entry.title ?? entry.checklistId ?? 'Checklist';
    card.appendChild(title);

    const steps = document.createElement('div');
    const completed = entry.completedSteps ?? 0;
    const total = entry.totalSteps ?? '—';
    steps.className = 'checklist-steps';
    steps.textContent = `Step ${entry.nextStepNumber ?? completed + 1} • ${completed}/${total}`;
    card.appendChild(steps);

    if (entry.nextStepAction) {
      card.appendChild(createParagraph(entry.nextStepAction));
    }
    if (entry.pad?.tig) {
      card.appendChild(createParagraph(`TIG ${entry.pad.tig}`));
    }
    fragment.appendChild(card);
  });
  container.appendChild(fragment);
}

function renderAgc(agc) {
  const container = dom.controls.agc;
  if (!container) {
    return;
  }
  container.textContent = '';
  if (!agc) {
    container.textContent = 'Awaiting AGC state…';
    return;
  }
  const fragment = document.createDocumentFragment();
  const program = agc.program ?? {};
  fragment.appendChild(createParagraph(`Program ${program.current ?? '---'} • Verb ${program.verbLabel ?? '--'} · Noun ${program.nounLabel ?? '--'}`));
  if (agc.pendingAck) {
    fragment.appendChild(createParagraph(`Pending ACK ${agc.pendingAck.macroLabel ?? agc.pendingAck.macroId ?? ''}`));
  }

  if (Array.isArray(agc.registers) && agc.registers.length > 0) {
    const list = document.createElement('ul');
    list.className = 'inline-list';
    agc.registers.forEach((reg) => {
      const chip = document.createElement('li');
      chip.className = 'chip';
      const value = reg.value != null ? String(reg.value) : '--';
      chip.textContent = `${reg.label ?? reg.id ?? 'REG'} ${value}`;
      list.appendChild(chip);
    });
    fragment.appendChild(list);
  }

  if (Array.isArray(agc.history) && agc.history.length > 0) {
    const historyList = document.createElement('ul');
    historyList.className = 'list';
    agc.history.forEach((entry) => {
      const item = document.createElement('li');
      item.className = 'list-item';
      item.appendChild(createParagraph(`${entry.macroLabel ?? entry.macroId ?? 'Macro'} @ ${entry.get ?? '--:--:--'}`));
      if (Array.isArray(entry.issues) && entry.issues.length > 0) {
        item.appendChild(createParagraph(`Issues: ${entry.issues.join(', ')}`));
      }
      historyList.appendChild(item);
    });
    fragment.appendChild(historyList);
  }

  container.appendChild(fragment);
}

function renderManualQueue(queue) {
  const container = dom.controls.manual;
  if (!container) {
    return;
  }
  container.textContent = '';
  if (!queue) {
    container.textContent = 'No manual actions queued.';
    return;
  }
  const metrics = [
    `Pending ${queue.pending ?? 0}`,
    `Executed ${queue.executed ?? 0}`,
    `Failed ${queue.failed ?? 0}`,
  ];
  container.appendChild(createParagraph(metrics.join(' · ')));

  const extras = [];
  if (queue.acknowledgedSteps != null) {
    extras.push(`Steps ${queue.acknowledgedSteps}`);
  }
  if (queue.dskyEntries != null) {
    extras.push(`DSKY ${queue.dskyEntries}`);
  }
  if (queue.panelControls != null) {
    extras.push(`Panel cmds ${queue.panelControls}`);
  }
  if (extras.length > 0) {
    container.appendChild(createParagraph(extras.join(' · ')));
  }
}

function renderSystemsView() {
  const frame = state.currentFrame;
  renderResourceOverview(frame?.resources);
  renderScorecard(frame?.score);
  renderThermalComms(frame?.resources, frame?.entry);
  renderResourceTrends(frame?.resourceHistory);
  renderPerformance(frame?.performance, frame?.audio);
}

function renderResourceOverview(resources) {
  const container = dom.systems.resources;
  if (!container) {
    return;
  }
  container.textContent = '';
  if (!resources) {
    container.textContent = 'No resource data.';
    return;
  }
  const grid = document.createElement('div');
  grid.className = 'progress-grid';

  if (resources.power) {
    grid.appendChild(createTile('Power margin', resources.power.marginPct != null ? `${formatNumber(resources.power.marginPct, { digits: 1 })}%` : '—'));
  }
  if (resources.deltaV) {
    grid.appendChild(createTile('Δv remaining', resources.deltaV.totalMps != null ? `${formatNumber(resources.deltaV.totalMps, { digits: 0 })} m/s` : '—'));
  }
  const tanks = resources.propellant?.tanks ?? {};
  Object.values(tanks).forEach((tank) => {
    const label = tank.label ?? 'Propellant';
    const value = tank.percentRemaining != null
      ? `${formatNumber(tank.percentRemaining, { digits: 0 })}%`
      : tank.remainingKg != null
        ? `${formatNumber(tank.remainingKg, { digits: 0 })} kg`
        : '—';
    grid.appendChild(createTile(label, value));
  });
  container.appendChild(grid);

  const stages = resources.deltaV?.stages ?? {};
  const stageValues = Object.values(stages).filter((entry) => entry);
  if (stageValues.length > 0) {
    const stageList = document.createElement('ul');
    stageList.className = 'inline-list';
    stageValues.forEach((stage) => {
      const chip = document.createElement('li');
      chip.className = 'chip';
      const parts = [];
      parts.push(stage.label ?? stage.id ?? 'Stage');
      if (stage.remainingMps != null) {
        parts.push(`${formatNumber(stage.remainingMps, { digits: 0 })} m/s`);
      }
      if (stage.percentRemaining != null) {
        parts.push(`${formatNumber(stage.percentRemaining, { digits: 0 })}%`);
      }
      if (stage.status) {
        parts.push(capitalize(stage.status));
      }
      chip.textContent = parts.join(' · ');
      stageList.appendChild(chip);
    });
    container.appendChild(stageList);
  }
}

function renderScorecard(score) {
  const container = dom.systems.score;
  if (!container) {
    return;
  }
  container.textContent = '';
  if (!score) {
    container.textContent = 'Score data unavailable.';
    return;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'scorecard';

  const rating = score.rating ?? {};
  const grade = rating.grade ?? '—';
  const commanderScore = rating.commanderScore != null
    ? formatNumber(rating.commanderScore, { digits: 1 })
    : '—';

  const gradeLabel = document.createElement('div');
  gradeLabel.className = 'score-grade';
  gradeLabel.textContent = `Grade ${grade}`;
  wrapper.appendChild(gradeLabel);

  const metrics = document.createElement('div');
  metrics.className = 'score-metrics';

  const commanderDetail = [];
  if (rating.baseScore != null) {
    commanderDetail.push(`Base ${formatNumber(rating.baseScore, { digits: 1 })}`);
  }
  if (rating.manualBonus != null) {
    commanderDetail.push(`Bonus ${formatNumber(rating.manualBonus, { digits: 1 })}`);
  }
  metrics.appendChild(createScoreMetric('Commander', commanderScore, commanderDetail.join(' · ') || null));

  const events = score.events ?? {};
  if (events.completed != null || events.total != null || events.completionRatePct != null) {
    const value = events.completed != null && events.total != null
      ? `${formatNumber(events.completed, { digits: 0 })}/${formatNumber(events.total, { digits: 0 })}`
      : events.completed != null
        ? formatNumber(events.completed, { digits: 0 })
        : '—';
    const detail = events.completionRatePct != null
      ? `Completion ${formatNumber(events.completionRatePct, { digits: 0 })}%`
      : null;
    metrics.appendChild(createScoreMetric('Events', value, detail));
  }

  const manual = score.manual ?? {};
  if (manual.manualSteps != null || manual.totalSteps != null || manual.manualFraction != null) {
    const value = manual.manualSteps != null && manual.totalSteps != null
      ? `${formatNumber(manual.manualSteps, { digits: 0 })}/${formatNumber(manual.totalSteps, { digits: 0 })}`
      : manual.manualSteps != null
        ? formatNumber(manual.manualSteps, { digits: 0 })
        : '—';
    const detail = manual.manualFraction != null
      ? `Manual ${formatNumber(manual.manualFraction * 100, { digits: 0 })}%`
      : null;
    metrics.appendChild(createScoreMetric('Manual', value, detail));
  }

  const faults = score.faults ?? {};
  if (faults.totalFaults != null || faults.eventFailures != null || faults.resourceFailures != null) {
    const value = faults.totalFaults != null
      ? formatNumber(faults.totalFaults, { digits: 0 })
      : '0';
    const detailParts = [];
    if (faults.eventFailures != null) {
      detailParts.push(`Events ${formatNumber(faults.eventFailures, { digits: 0 })}`);
    }
    if (faults.resourceFailures != null) {
      detailParts.push(`Resources ${formatNumber(faults.resourceFailures, { digits: 0 })}`);
    }
    metrics.appendChild(createScoreMetric('Faults', value, detailParts.join(' · ') || null));
  }

  const resources = score.resources ?? {};
  if (resources.minPowerMarginPct != null || resources.minDeltaVMarginMps != null) {
    const detailParts = [];
    if (resources.minPowerMarginPct != null) {
      detailParts.push(`Power min ${formatNumber(resources.minPowerMarginPct, { digits: 1 })}%`);
    }
    if (resources.minDeltaVMarginMps != null) {
      detailParts.push(`Δv min ${formatNumber(resources.minDeltaVMarginMps, { digits: 1 })} m/s`);
    }
    const marginValue = detailParts.length > 0 ? 'Tracked' : '—';
    metrics.appendChild(createScoreMetric('Margins', marginValue, detailParts.join(' · ') || null));
  }

  wrapper.appendChild(metrics);

  const breakdownEntries = Object.entries(rating.breakdown ?? {})
    .filter(([, value]) => value && (value.score != null || value.weight != null));
  if (breakdownEntries.length > 0) {
    const breakdownEl = document.createElement('div');
    breakdownEl.className = 'score-breakdown';
    breakdownEntries.forEach(([key, value]) => {
      if (!value) {
        return;
      }
      const row = document.createElement('div');
      row.className = 'breakdown-row';
      const labelEl = document.createElement('span');
      labelEl.className = 'label';
      labelEl.textContent = formatBreakdownLabel(key);
      const valueEl = document.createElement('span');
      valueEl.className = 'value';
      const valueParts = [];
      if (value.score != null) {
        valueParts.push(formatNumber(value.score, { digits: 1 }));
      }
      if (value.weight != null) {
        valueParts.push(`${formatNumber(value.weight * 100, { digits: 0 })}%`);
      }
      valueEl.textContent = valueParts.join(' · ') || '—';
      row.appendChild(labelEl);
      row.appendChild(valueEl);
      breakdownEl.appendChild(row);
    });
    wrapper.appendChild(breakdownEl);
  }

  const historyEntries = Array.isArray(score.history) ? score.history.slice(-4) : [];
  if (historyEntries.length > 0) {
    const historyEl = document.createElement('div');
    historyEl.className = 'score-history';
    historyEntries.forEach((entry) => {
      const item = document.createElement('div');
      item.className = 'history-entry';
      const timestamp = document.createElement('strong');
      timestamp.textContent = entry.get ?? '--:--:--';
      item.appendChild(timestamp);
      const detailParts = [];
      if (entry.grade) {
        detailParts.push(`Grade ${entry.grade}`);
      }
      if (entry.commanderScore != null) {
        detailParts.push(`${formatNumber(entry.commanderScore, { digits: 1 })}`);
      }
      const deltaScore = entry.delta?.commanderScore;
      if (deltaScore != null && deltaScore !== 0) {
        const sign = deltaScore > 0 ? '+' : '';
        detailParts.push(`Δ ${sign}${formatNumber(deltaScore, { digits: 1 })}`);
      }
      if (detailParts.length > 0) {
        const detail = document.createElement('span');
        detail.textContent = ` – ${detailParts.join(' · ')}`;
        item.appendChild(detail);
      }
      historyEl.appendChild(item);
    });
    wrapper.appendChild(historyEl);
  }

  container.appendChild(wrapper);
}

function renderResourceTrends(history) {
  const container = dom.systems.trends;
  if (!container) {
    return;
  }
  container.textContent = '';
  if (!history || history.meta?.enabled === false) {
    container.textContent = 'Resource history disabled.';
    return;
  }

  const fragment = document.createDocumentFragment();
  const metaParts = [];
  const sampleInterval = history.meta?.sampleIntervalSeconds;
  if (Number.isFinite(sampleInterval) && sampleInterval > 0) {
    metaParts.push(`Δt ${formatDuration(sampleInterval)}`);
  }
  const duration = history.meta?.durationSeconds;
  if (Number.isFinite(duration) && duration > 0) {
    metaParts.push(`Window ${formatDuration(duration)}`);
  }
  if (metaParts.length > 0) {
    const meta = document.createElement('div');
    meta.className = 'item-meta';
    meta.textContent = metaParts.join(' · ');
    fragment.appendChild(meta);
  }

  const list = document.createElement('ul');
  list.className = 'mini-list';

  const powerSample = getLast(history.power);
  if (powerSample) {
    const detailParts = [];
    if (powerSample.powerMarginPct != null) {
      detailParts.push(`Margin ${formatNumber(powerSample.powerMarginPct, { digits: 1 })}%`);
    }
    if (powerSample.fuelCellLoadKw != null) {
      detailParts.push(`Load ${formatNumber(powerSample.fuelCellLoadKw, { digits: 1 })} kW`);
    }
    if (powerSample.fuelCellOutputKw != null) {
      detailParts.push(`Output ${formatNumber(powerSample.fuelCellOutputKw, { digits: 1 })} kW`);
    }
    const meta = formatGetFromSeconds(powerSample.timeSeconds);
    list.appendChild(createMiniListItem('Power', meta, detailParts.join(' · ') || null));
  }

  const thermalSample = getLast(history.thermal);
  if (thermalSample) {
    const detailParts = [];
    if (thermalSample.cryoBoiloffRatePctPerHr != null) {
      detailParts.push(`${formatNumber(thermalSample.cryoBoiloffRatePctPerHr, { digits: 2 })}%/hr boil-off`);
    }
    if (thermalSample.thermalState) {
      detailParts.push(capitalize(thermalSample.thermalState));
    }
    if (thermalSample.ptcActive != null) {
      detailParts.push(thermalSample.ptcActive ? 'PTC active' : 'PTC idle');
    }
    const meta = formatGetFromSeconds(thermalSample.timeSeconds);
    list.appendChild(createMiniListItem('Thermal', meta, detailParts.join(' · ') || null));
  }

  const commSample = getLast(history.communications);
  if (commSample) {
    const metaParts = [];
    if (commSample.timeSeconds != null) {
      metaParts.push(formatGetFromSeconds(commSample.timeSeconds));
    }
    if (commSample.currentStation) {
      metaParts.push(commSample.currentStation);
    }
    const detailParts = [];
    if (commSample.active != null) {
      detailParts.push(commSample.active ? 'Pass active' : 'Idle');
    }
    if (commSample.signalStrengthDb != null) {
      detailParts.push(`${formatNumber(commSample.signalStrengthDb, { digits: 1 })} dB`);
    }
    if (commSample.timeRemainingSeconds != null) {
      const remaining = Math.abs(commSample.timeRemainingSeconds);
      if (remaining > 0) {
        detailParts.push(`${formatDuration(remaining)} remaining`);
      }
    }
    list.appendChild(createMiniListItem('Comms', metaParts.join(' · '), detailParts.join(' · ') || null));
  }

  const propellantHistory = history.propellant ?? {};
  const tankEntries = Object.entries(propellantHistory)
    .map(([tankId, samples]) => ({ tankId, sample: getLast(samples) }))
    .filter(({ sample }) => sample);
  tankEntries.slice(0, 2).forEach(({ tankId, sample }) => {
    const meta = formatGetFromSeconds(sample.timeSeconds);
    const detailParts = [];
    if (sample.percentRemaining != null) {
      detailParts.push(`${formatNumber(sample.percentRemaining, { digits: 0 })}%`);
    }
    if (sample.remainingKg != null) {
      detailParts.push(`${formatNumber(sample.remainingKg, { digits: 0 })} kg`);
    }
    list.appendChild(createMiniListItem(formatTankLabel(tankId), meta, detailParts.join(' · ') || null));
  });

  if (list.children.length > 0) {
    fragment.appendChild(list);
  } else {
    fragment.appendChild(createParagraph('No telemetry samples yet.'));
  }

  container.appendChild(fragment);
}

function renderThermalComms(resources, entry) {
  const container = dom.systems.thermal;
  if (!container) {
    return;
  }
  container.textContent = '';
  const lines = [];
  const thermal = resources?.thermal;
  if (thermal) {
    const rate = thermal.cryoBoiloffRatePctPerHr != null
      ? `${formatNumber(thermal.cryoBoiloffRatePctPerHr, { digits: 2 })}%/hr`
      : '—';
    lines.push(`Cryo boil-off ${rate}`);
    lines.push(`PTC ${thermal.ptcActive ? 'Active' : 'Idle'}`);
  }
  const comms = resources?.communications;
  if (comms) {
    if (comms.current?.station) {
      lines.push(`Comms ${comms.current.station}`);
    } else if (comms.nextWindowOpenGet) {
      lines.push(`Next comms ${comms.nextWindowOpenGet}`);
    }
  }
  if (entry?.entryInterfaceGet) {
    lines.push(`Entry interface ${entry.entryInterfaceGet}`);
  }
  container.appendChild(createParagraph(lines.join(' · ') || 'No telemetry yet.'));
}

function renderPerformance(performance, audio) {
  const container = dom.systems.performance;
  if (!container) {
    return;
  }
  container.textContent = '';
  const parts = [];
  if (performance?.tick?.averageMs != null) {
    parts.push(`Tick ${formatNumber(performance.tick.averageMs, { digits: 2 })} ms avg`);
  }
  if (performance?.hud?.drops != null) {
    parts.push(`HUD drops ${performance.hud.drops}`);
  }
  if (audio?.binder) {
    parts.push(`Audio pending ${audio.binder.pendingCount ?? 0}`);
  }
  container.appendChild(createParagraph(parts.length > 0 ? parts.join(' · ') : 'Performance data unavailable.'));
}

function renderMissionLog() {
  const list = dom.missionLog;
  if (!list) {
    return;
  }
  list.textContent = '';
  const entries = state.currentFrame?.missionLog?.entries ?? [];
  if (entries.length === 0) {
    const item = document.createElement('li');
    item.className = 'log-entry';
    item.textContent = 'Mission log idle.';
    list.appendChild(item);
    return;
  }
  entries.forEach((entry) => {
    const item = document.createElement('li');
    item.className = `log-entry ${entry.severity ?? 'info'}`;
    const timestamp = document.createElement('div');
    timestamp.className = 'timestamp';
    timestamp.textContent = entry.get ?? '--:--:--';
    item.appendChild(timestamp);
    item.appendChild(createParagraph(entry.message ?? '')); 
    if (entry.source) {
      const source = document.createElement('div');
      source.className = 'timestamp';
      source.textContent = entry.source;
      item.appendChild(source);
    }
    list.appendChild(item);
  });
  list.scrollTop = list.scrollHeight;
}

function renderSummary() {
  if (!dom.summary) {
    return;
  }
  const summary = state.summary;
  if (!summary) {
    if (state.status === 'running' || state.status === 'connecting') {
      dom.summary.textContent = 'Mission simulation running…';
    } else if (state.status === 'error') {
      dom.summary.textContent = 'Simulation error. Restart to retry.';
    } else if (state.status === 'complete') {
      dom.summary.textContent = 'Mission complete.';
    } else {
      dom.summary.textContent = 'Mission summary will appear here.';
    }
    return;
  }

  const grade = summary.score?.rating?.grade ?? '—';
  const commanderScore = summary.score?.rating?.commanderScore;
  const events = summary.events ?? {};
  const parts = [];
  parts.push(`Final GET ${summary.finalGet ?? '--:--:--'}`);
  parts.push(`Grade ${grade}`);
  if (commanderScore != null) {
    parts.push(`Commander ${formatNumber(commanderScore, { digits: 1 })}`);
  }
  const completed = events.complete ?? events.completed ?? 0;
  const total = events.total ?? events.pending ?? null;
  if (total != null) {
    parts.push(`Events ${completed}/${total}`);
  }
  dom.summary.textContent = parts.join(' · ');
}

function createParagraph(text) {
  const p = document.createElement('p');
  p.textContent = text;
  return p;
}

function createTile(label, value) {
  const tile = document.createElement('div');
  tile.className = 'progress-tile';
  const labelEl = document.createElement('span');
  labelEl.className = 'label';
  labelEl.textContent = label;
  const valueEl = document.createElement('span');
  valueEl.className = 'value';
  valueEl.textContent = value;
  tile.appendChild(labelEl);
  tile.appendChild(valueEl);
  return tile;
}

function createListItem(text) {
  const item = document.createElement('li');
  item.className = 'list-item';
  item.textContent = text;
  return item;
}

function createScoreMetric(label, value, detail = null) {
  const card = document.createElement('div');
  card.className = 'score-metric';
  const labelEl = document.createElement('span');
  labelEl.className = 'label';
  labelEl.textContent = label;
  const valueEl = document.createElement('span');
  valueEl.className = 'value';
  valueEl.textContent = value ?? '—';
  card.appendChild(labelEl);
  card.appendChild(valueEl);
  if (detail && detail.trim().length > 0) {
    const detailEl = document.createElement('span');
    detailEl.className = 'detail';
    detailEl.textContent = detail;
    card.appendChild(detailEl);
  }
  return card;
}

function createMiniListItem(title, meta = '', detail = null) {
  const item = document.createElement('li');
  const heading = document.createElement('strong');
  heading.textContent = title;
  item.appendChild(heading);
  if (meta && meta.trim().length > 0) {
    const metaEl = document.createElement('span');
    metaEl.className = 'item-meta';
    metaEl.textContent = meta;
    item.appendChild(metaEl);
  }
  if (detail && detail.trim().length > 0) {
    item.appendChild(createParagraph(detail));
  }
  return item;
}

function getLast(list) {
  if (!Array.isArray(list) || list.length === 0) {
    return null;
  }
  return list[list.length - 1];
}

function formatGetFromSeconds(seconds) {
  if (!Number.isFinite(seconds)) {
    return '';
  }
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return `${String(hours).padStart(3, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) {
    return '';
  }
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const parts = [];
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0) {
    parts.push(`${minutes}m`);
  }
  if (parts.length === 0 || (parts.length === 1 && hours > 0 && minutes === 0 && secs > 0)) {
    parts.push(`${secs}s`);
  } else if (parts.length === 1 && minutes > 0 && secs > 0) {
    parts.push(`${secs}s`);
  }
  return parts.join(' ');
}

function formatRangeMeters(value) {
  if (!Number.isFinite(value)) {
    return '—';
  }
  const abs = Math.abs(value);
  if (abs >= 1000) {
    const digits = abs >= 10000 ? 0 : 2;
    return `${formatNumber(abs / 1000, { digits })} km`;
  }
  if (abs >= 1) {
    const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
    return `${formatNumber(abs, { digits })} m`;
  }
  return `${formatNumber(abs * 100, { digits: 1 })} cm`;
}

function describeClosingRate(rate) {
  if (!Number.isFinite(rate)) {
    return null;
  }
  const magnitude = Math.abs(rate);
  const digits = magnitude >= 1 ? 2 : 3;
  const value = formatNumber(magnitude, { digits });
  if (rate < -1e-3) {
    return `${value} m/s closing`;
  }
  if (rate > 1e-3) {
    return `${value} m/s opening`;
  }
  return `${value} m/s steady`;
}

function capitalize(value) {
  if (value == null) {
    return '';
  }
  const str = String(value);
  if (str.length === 0) {
    return '';
  }
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function formatBreakdownLabel(key) {
  if (!key) {
    return '';
  }
  const spaced = String(key).replace(/_/g, ' ');
  return spaced.replace(/\b\w/g, (match) => match.toUpperCase());
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
      return capitalize(String(id).replace(/_/g, ' '));
  }
}

function setText(element, value) {
  if (!element) {
    return;
  }
  element.textContent = value;
}

function mapStatus(status) {
  switch (status) {
    case 'connecting':
      return 'Connecting';
    case 'running':
      return 'Running';
    case 'complete':
      return 'Complete';
    case 'error':
      return 'Error';
    case 'aborted':
      return 'Stopped';
    case 'unsupported':
      return 'Unsupported';
    default:
      return 'Idle';
  }
}

function computeProgress(currentSeconds, targetSeconds) {
  if (!Number.isFinite(currentSeconds) || !Number.isFinite(targetSeconds) || targetSeconds <= 0) {
    return null;
  }
  const percent = Math.min(100, Math.max(0, (currentSeconds / targetSeconds) * 100));
  return Math.round(percent);
}

function formatNumber(value, { digits = 0 } = {}) {
  if (!Number.isFinite(value)) {
    return '—';
  }
  return Number(value).toFixed(digits);
}

document.addEventListener('DOMContentLoaded', init);
