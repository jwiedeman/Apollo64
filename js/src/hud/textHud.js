import { formatGET } from '../utils/time.js';
import { UiFrameBuilder } from './uiFrameBuilder.js';

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
  constructor({ logger = null, frameBuilder = null, ...options } = {}) {
    this.logger = logger;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    const { enabled, renderIntervalSeconds, ...frameOptions } = this.options;
    this.enabled = Boolean(enabled);
    this.renderIntervalSeconds = Math.max(
      1,
      Number(renderIntervalSeconds) || DEFAULT_OPTIONS.renderIntervalSeconds,
    );
    this.nextRenderGetSeconds = 0;
    this.renderCount = 0;
    this.lastSnapshot = null;
    this.frameBuilder = frameBuilder ?? new UiFrameBuilder(frameOptions);
  }

  update(currentGetSeconds, context = {}) {
    if (!this.enabled) {
      return;
    }

    if (currentGetSeconds + 1e-6 < this.nextRenderGetSeconds) {
      return;
    }

    const frame = this.frameBuilder.build(currentGetSeconds, context);
    const message = this.#formatMessage(frame);
    this.lastSnapshot = { ...frame, message };
    this.renderCount += 1;
    this.nextRenderGetSeconds = currentGetSeconds + this.renderIntervalSeconds;

    if (this.logger) {
      this.logger.log(currentGetSeconds, message, {
        ...frame,
        logSource: 'ui',
        logCategory: 'ui',
        logSeverity: 'info',
      });
    } else {
      console.log(`[HUD ${formatGET(currentGetSeconds)}] ${message}`, frame);
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

    const communications = snapshot.resources?.communications;
    if (communications) {
      const current = communications.current;
      if (current?.station) {
        const remainLabel = current.timeRemainingLabel ?? null;
        const signalLabel = this.#formatNumber(current.signalStrengthDb, 1);
        let message = `Comms ${current.station}`;
        if (remainLabel) {
          message += ` ${remainLabel}`;
        }
        if (signalLabel !== 'n/a') {
          message += ` ${signalLabel}dB`;
        }
        parts.push(message.trim());
      } else if (communications.nextWindowOpenGet) {
        const station = communications.next?.station ?? '';
        const label = communications.timeUntilNextWindowLabel ?? communications.nextWindowOpenGet;
        const stationLabel = station ? ` ${station}` : '';
        parts.push(`Comms next${stationLabel} ${label}`.trim());
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

    const docking = this.#formatDocking(snapshot);
    if (docking) {
      parts.push(docking);
    }

    const trajectory = snapshot.trajectory;
    if (trajectory) {
      const altLabel = this.#formatNumber(trajectory.altitude?.kilometers, 0);
      if (altLabel !== 'n/a') {
        parts.push(`Alt ${altLabel} km`);
      }
      const peri = this.#formatNumber(trajectory.elements?.periapsisKm, 0);
      const apo = this.#formatNumber(trajectory.elements?.apoapsisKm, 0);
      if (peri !== 'n/a' && apo !== 'n/a') {
        parts.push(`Pe/Apo ${peri}/${apo} km`);
      }
      const period = this.#formatNumber(trajectory.elements?.periodMinutes, 1);
      if (period !== 'n/a') {
        parts.push(`Period ${period} min`);
      }
    }

    const rating = snapshot.score?.rating;
    if (rating) {
      const commanderScoreLabel = this.#formatNumber(rating.commanderScore, 1);
      if (commanderScoreLabel !== 'n/a') {
        const grade = rating.grade ? ` (${rating.grade})` : '';
        parts.push(`Score ${commanderScoreLabel}${grade}`.trim());
      }
    }

    const alerts = snapshot.alerts ?? {};
    const warningCount = alerts.warnings?.length ?? 0;
    const cautionCount = alerts.cautions?.length ?? 0;
    const failureCount = alerts.failures?.length ?? 0;
    if (warningCount + cautionCount + failureCount > 0) {
      parts.push(`Alerts W:${warningCount} C:${cautionCount} F:${failureCount}`);
    }

    const audioSummary = this.#formatAudio(snapshot.audio);
    if (audioSummary) {
      parts.push(audioSummary);
    }

    return `HUD → ${parts.filter(Boolean).join(' | ')}`;
  }

  #formatNumber(value, digits = 1) {
    if (!Number.isFinite(value)) {
      return 'n/a';
    }
    return value.toFixed(digits);
  }

  #formatAudio(audio) {
    if (!audio || typeof audio !== 'object') {
      return null;
    }

    const segments = [];
    const lastCueId = audio.dispatcher?.lastCueId ?? audio.binder?.lastCueId ?? null;
    if (lastCueId) {
      segments.push(`last ${lastCueId}`);
    }

    const active = this.#formatAudioBusCounts(audio.dispatcher?.activeBuses);
    if (active) {
      segments.push(`active ${active}`);
    }

    const queued = this.#formatAudioBusCounts(audio.dispatcher?.queuedBuses);
    if (queued) {
      segments.push(`queue ${queued}`);
    }

    const pendingCount = audio.binder?.pendingCount ?? (Array.isArray(audio.pending) ? audio.pending.length : null);
    if (Number.isFinite(pendingCount) && pendingCount > 0) {
      segments.push(`pending ${pendingCount}`);
    }

    if (segments.length === 0) {
      return null;
    }

    return `Audio ${segments.join(' ')}`.trim();
  }

  #formatAudioBusCounts(counts) {
    if (!counts || typeof counts !== 'object') {
      return null;
    }
    const entries = [];
    for (const [busId, value] of Object.entries(counts)) {
      const numeric = Number(value);
      if (Number.isFinite(numeric) && numeric > 0) {
        entries.push(`${busId}:${numeric}`);
      }
    }
    if (entries.length === 0) {
      return null;
    }
    return entries.join(',');
  }

  #formatDocking(snapshot) {
    const docking = snapshot?.docking;
    if (!docking) {
      return null;
    }

    const gates = Array.isArray(docking.gates) ? docking.gates : [];
    const activeGateId = docking.activeGateId ?? docking.activeGate ?? null;
    const activeGate = activeGateId
      ? gates.find((gate) => gate?.id === activeGateId)
      : null;

    const segments = [];
    const gateLabel = activeGate?.label ?? activeGate?.id ?? activeGateId;
    segments.push(gateLabel ? `Dock ${gateLabel}` : 'Dock');

    const rangeLabel = this.#formatNumber(docking.rangeMeters, 0);
    if (rangeLabel !== 'n/a') {
      segments.push(`${rangeLabel}m`);
    }

    const closingLabel = this.#formatNumber(docking.closingRateMps, 2);
    if (closingLabel !== 'n/a') {
      segments.push(`${closingLabel}m/s`);
    }

    const deadlineSeconds = activeGate?.timeRemainingSeconds;
    const offset = this.#formatOffset(deadlineSeconds);
    if (offset) {
      segments.push(offset);
    }

    if (activeGate?.overdue) {
      segments.push('late');
    }

    const rcsLabel = this.#formatDockingRcs(docking.rcs);
    if (rcsLabel) {
      segments.push(rcsLabel);
    }

    return segments.filter(Boolean).join(' ').trim();
  }

  #formatDockingRcs(rcs) {
    if (!rcs || typeof rcs !== 'object') {
      return null;
    }

    const segments = [];

    const remaining = rcs.propellantKgRemaining ?? null;
    if (remaining && typeof remaining === 'object') {
      let total = 0;
      let count = 0;
      for (const value of Object.values(remaining)) {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) {
          total += numeric;
          count += 1;
        }
      }
      if (count > 0) {
        segments.push(`${Math.round(total)}kg`);
      }
    }

    const quads = Array.isArray(rcs.quads) ? rcs.quads : [];
    const disabled = quads
      .filter((quad) => quad && quad.enabled === false && quad.id)
      .map((quad) => quad.id);
    if (disabled.length > 0) {
      segments.push(`off:${disabled.join(',')}`);
    }

    const dutyCycles = quads
      .map((quad) => (Number.isFinite(quad?.dutyCyclePct) ? quad.dutyCyclePct : null))
      .filter((value) => value != null);
    if (segments.length === 0 && dutyCycles.length > 0) {
      const average = dutyCycles.reduce((total, value) => total + value, 0) / dutyCycles.length;
      segments.push(`${this.#formatNumber(average, 1)}%`);
    }

    if (segments.length === 0) {
      return null;
    }

    return `RCS ${segments.join(' ')}`;
  }

  #formatOffset(seconds) {
    if (!Number.isFinite(seconds)) {
      return null;
    }
    const prefix = seconds >= 0 ? 'T-' : 'T+';
    const absolute = Math.max(0, Math.round(Math.abs(seconds)));
    return `${prefix}${formatGET(absolute)}`;
  }
}
