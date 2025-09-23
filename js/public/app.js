const state = {
  status: 'idle',
  targetSeconds: null,
  sampleSeconds: 60,
  frames: [],
  currentFrame: null,
  summary: null,
  activeView: 'navigation',
};

let eventSource = null;

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
    status: document.getElementById('hud-status'),
    progress: document.getElementById('hud-progress'),
    progressBar: document.querySelector('.progress-bar'),
  },
  alertBanner: document.getElementById('alert-banner'),
  navigation: {
    trajectory: document.getElementById('nav-trajectory'),
    upcoming: document.getElementById('nav-upcoming'),
    autopilot: document.getElementById('nav-autopilot'),
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
  },
  missionLog: document.getElementById('mission-log'),
  summary: document.getElementById('summary-panel'),
  restartButton: document.getElementById('restart-button'),
  viewTabs: document.querySelectorAll('.tab-button'),
  views: document.querySelectorAll('.view'),
};

function init() {
  setupViewTabs();
  dom.restartButton?.addEventListener('click', () => {
    connectStream();
  });

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

function connectStream() {
  cleanupStream();
  state.status = 'connecting';
  state.frames = [];
  state.currentFrame = null;
  state.summary = null;
  state.targetSeconds = null;
  render();

  eventSource = new EventSource('/api/stream');
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
    render();
  });
  eventSource.addEventListener('complete', () => {
    state.status = 'complete';
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
  if (eventSource) {
    eventSource.close();
    eventSource = null;
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
  setText(dom.hud.get, frame?.time?.get ?? '--:--:--');
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

  const statusLabel = mapStatus(state.status);
  dom.hud.status.textContent = statusLabel;

  const progress = computeProgress(frame?.time?.getSeconds, state.targetSeconds);
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
      if (entry.pad?.tig) {
        li.appendChild(createParagraph(`TIG ${entry.pad.tig}`));
      }
      list.appendChild(li);
    });
    container.appendChild(list);
  }
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
  checklists.active.forEach((entry) => {
    const card = document.createElement('div');
    card.className = 'checklist-card';

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
}

function renderSystemsView() {
  const frame = state.currentFrame;
  renderResourceOverview(frame?.resources);
  renderThermalComms(frame?.resources, frame?.entry);
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
