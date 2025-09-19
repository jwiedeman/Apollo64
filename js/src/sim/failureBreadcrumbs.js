import { formatGET } from '../utils/time.js';

function toNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatNumber(value, { digits = 1, suffix = '', sign = false, fallback = '—' } = {}) {
  const numeric = toNumber(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  const formatter = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: false,
  });
  const formatted = formatter.format(numeric);
  if (sign) {
    if (numeric > 0) {
      return `+${formatted}${suffix ? ` ${suffix}` : ''}`.trim();
    }
    if (numeric < 0) {
      return `-${formatter.format(Math.abs(numeric))}${suffix ? ` ${suffix}` : ''}`.trim();
    }
  }
  return `${formatted}${suffix ? ` ${suffix}` : ''}`.trim();
}

function formatSigned(value, { digits = 1, suffix = '' } = {}) {
  const numeric = toNumber(value);
  if (!Number.isFinite(numeric)) {
    return '—';
  }
  const formatter = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: false,
  });
  const sign = numeric === 0 ? '' : numeric > 0 ? '+' : '−';
  const formatted = formatter.format(Math.abs(numeric));
  return `${sign}${formatted}${suffix ? ` ${suffix}` : ''}`.trim();
}

function formatPercent(value, { digits = 1 } = {}) {
  return formatNumber(value, { digits, suffix: '%', fallback: '—' });
}

function formatRate(value) {
  return formatNumber(value, { digits: 2, suffix: '%/hr', fallback: '—' });
}

function formatDeltaV(value) {
  return formatSigned(value, { digits: 2, suffix: 'm/s' });
}

function formatKw(value) {
  return formatSigned(value, { digits: 2, suffix: 'kW' });
}

function formatDb(value) {
  return formatNumber(value, { digits: 1, suffix: 'dB', fallback: '—' });
}

function formatDuration(seconds) {
  const numeric = toNumber(seconds);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  const totalSeconds = Math.max(0, Math.floor(numeric));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${remainingMinutes}m`;
}

function normalizeStage(resourceSystem, tankKey) {
  if (!resourceSystem || !tankKey) {
    return { id: null, label: null };
  }
  const normalizedTank = tankKey.endsWith('_kg') ? tankKey : `${tankKey}_kg`;
  const stageId = resourceSystem.deltaVStageByTank?.[normalizedTank]
    ?? normalizedTank.replace(/_kg$/u, '');
  const stageConfig = stageId ? resourceSystem.propellantConfig?.[stageId] : null;
  return {
    id: stageId ?? null,
    label: stageConfig?.label ?? stageId ?? null,
    tankKey: normalizedTank,
  };
}

function buildPtcBreadcrumb({ state }) {
  const ptcState = typeof state?.thermal_balance_state === 'string'
    ? state.thermal_balance_state
    : null;
  const ptcActive = state?.ptc_active === true
    || ptcState === 'PTC'
    || ptcState === 'PTC_STABLE'
    || ptcState === 'PTC_TUNED';

  const cryoRate = toNumber(state?.cryo_boiloff_rate_pct_per_hr);
  const powerMargin = toNumber(state?.power_margin_pct);

  const summaryParts = [`PTC ${ptcActive ? 'stable' : 'off'}`];
  if (Number.isFinite(cryoRate)) {
    summaryParts.push(`cryo boiloff ${formatRate(cryoRate)}`);
  }
  if (Number.isFinite(powerMargin)) {
    summaryParts.push(`power margin ${formatPercent(powerMargin)}`);
  }

  const chain = [
    {
      id: 'ptc_status',
      label: 'PTC',
      value: ptcActive ? 'Active' : 'Off',
      severity: ptcActive ? 'info' : 'warning',
      trend: ptcActive ? null : 'down',
      rawValue: ptcState ?? (ptcActive ? 'ACTIVE' : 'INACTIVE'),
    },
  ];

  if (Number.isFinite(cryoRate)) {
    chain.push({
      id: 'cryo_boiloff',
      label: 'Cryo boiloff',
      value: formatRate(cryoRate),
      rawValue: cryoRate,
      units: '%/hr',
      trend: cryoRate > 1 ? 'up' : null,
    });
  }

  if (Number.isFinite(powerMargin)) {
    chain.push({
      id: 'power_margin',
      label: 'Power margin',
      value: formatPercent(powerMargin),
      rawValue: powerMargin,
      units: '%',
      trend: powerMargin < 55 ? 'down' : null,
    });
  }

  return {
    summary: summaryParts.join(' → '),
    chain,
  };
}

function buildBurnBreadcrumb({
  resourceSystem,
  state,
  context,
  source,
}) {
  const autopilotSummary = context?.autopilotSummary ?? null;
  const autopilotId = autopilotSummary?.autopilotId ?? context?.autopilotId ?? source ?? null;
  const deviations = autopilotSummary?.deviations ?? {};
  const metrics = autopilotSummary?.metrics ?? {};
  const expected = autopilotSummary?.expected ?? {};

  let deviationLabel = null;
  if (Number.isFinite(deviations.deltaVMps)) {
    deviationLabel = `Δv ${formatDeltaV(deviations.deltaVMps)}`;
  } else if (Number.isFinite(deviations.propellantKg)) {
    deviationLabel = `Propellant ${formatSigned(deviations.propellantKg, { digits: 3, suffix: 'kg' })}`;
  } else if (Number.isFinite(deviations.burnSeconds)) {
    deviationLabel = `Burn ${formatSigned(deviations.burnSeconds, { digits: 2, suffix: 's' })}`;
  } else if (context?.metric && Number.isFinite(context.deviation)) {
    const unit = typeof context.unit === 'string' ? context.unit.trim() : '';
    deviationLabel = `${context.metric} ${formatSigned(context.deviation, { digits: 2, suffix: unit })}`.trim();
  }

  const stageInfo = normalizeStage(resourceSystem, autopilotSummary?.propulsion?.tankKey);
  const stageState = stageInfo.id ? state?.delta_v?.stages?.[stageInfo.id] : null;
  const stageMargin = toNumber(stageState?.margin_mps);
  const totalMargin = toNumber(state?.delta_v_margin_mps);

  const summaryParts = [];
  if (autopilotId) {
    summaryParts.push(`Autopilot ${autopilotId}`);
  }
  if (deviationLabel) {
    summaryParts.push(deviationLabel);
  }
  if (Number.isFinite(stageMargin) && stageInfo.label) {
    summaryParts.push(`${stageInfo.label} margin ${formatNumber(stageMargin, { digits: 1, suffix: 'm/s' })}`);
  }
  if (Number.isFinite(totalMargin)) {
    summaryParts.push(`Total margin ${formatNumber(totalMargin, { digits: 1, suffix: 'm/s' })}`);
  }

  const chain = [];
  if (autopilotId) {
    chain.push({ id: 'autopilot', label: 'Autopilot', value: autopilotId });
  }
  if (deviationLabel) {
    chain.push({
      id: 'burn_deviation',
      label: 'Deviation',
      value: deviationLabel,
      trend: deviationLabel.includes('−') || deviationLabel.includes('-') ? 'down' : null,
      rawValue: {
        deltaVMps: deviations.deltaVMps ?? null,
        propellantKg: deviations.propellantKg ?? null,
        burnSeconds: deviations.burnSeconds ?? null,
      },
      expected,
      actual: metrics,
    });
  }
  if (stageInfo.label && Number.isFinite(stageMargin)) {
    chain.push({
      id: 'stage_margin',
      label: `${stageInfo.label} margin`,
      value: formatNumber(stageMargin, { digits: 1, suffix: 'm/s' }),
      rawValue: stageMargin,
      trend: stageMargin < 0 ? 'down' : null,
    });
  }
  if (Number.isFinite(totalMargin)) {
    chain.push({
      id: 'total_margin',
      label: 'Total Δv margin',
      value: formatNumber(totalMargin, { digits: 1, suffix: 'm/s' }),
      rawValue: totalMargin,
      trend: totalMargin < 0 ? 'down' : null,
    });
  }

  return {
    summary: summaryParts.join(' → '),
    chain,
  };
}

function buildCommunicationsBreadcrumb({ state }) {
  const comms = state?.communications ?? {};
  const station = comms.current_station ?? comms.next_station ?? 'DSN';
  const signal = toNumber(comms.signal_strength_db ?? comms.current_signal_strength_db);
  const powerDelta = toNumber(comms.power_margin_delta_kw);
  const nextWindowSeconds = toNumber(comms.next_window_open_seconds);
  const nextWindowLabel = comms.next_window_open_get
    ?? (Number.isFinite(nextWindowSeconds) ? formatGET(nextWindowSeconds) : null);
  const timeUntilNext = toNumber(comms.time_until_next_window_s);
  const durationLabel = formatDuration(timeUntilNext);

  const summaryParts = [`Missed ${station} pass`];
  if (durationLabel) {
    summaryParts.push(`next window ${durationLabel}`);
  } else if (nextWindowLabel) {
    summaryParts.push(`next window ${nextWindowLabel}`);
  }

  const chain = [
    { id: 'station', label: 'Station', value: station },
  ];
  if (Number.isFinite(signal)) {
    chain.push({
      id: 'signal_strength',
      label: 'Signal strength',
      value: formatDb(signal),
      rawValue: signal,
    });
  }
  if (Number.isFinite(powerDelta)) {
    chain.push({
      id: 'power_delta',
      label: 'Power margin impact',
      value: formatKw(powerDelta),
      rawValue: powerDelta,
      trend: powerDelta > 0 ? 'up' : powerDelta < 0 ? 'down' : null,
    });
  }
  if (nextWindowLabel) {
    chain.push({
      id: 'next_window',
      label: 'Next window',
      value: nextWindowLabel,
      detail: durationLabel,
    });
  }
  if (comms.next_station && comms.next_station !== station) {
    chain.push({ id: 'next_station', label: 'Next station', value: comms.next_station });
  }

  return {
    summary: summaryParts.join(' → '),
    chain,
  };
}

function buildDefaultBreadcrumb({ failureId, metadata, note, source }) {
  const summaryParts = [];
  if (failureId) {
    summaryParts.push(failureId);
  }
  if (metadata?.trigger) {
    summaryParts.push(metadata.trigger);
  } else if (note) {
    summaryParts.push(note);
  } else if (source) {
    summaryParts.push(`Source ${source}`);
  }

  return {
    summary: summaryParts.join(' — '),
    chain: [],
  };
}

const GENERATORS = {
  FAIL_THERMAL_PTC_LATE: buildPtcBreadcrumb,
  FAIL_THERMAL_PTC_DRIFT: buildPtcBreadcrumb,
  FAIL_RETURN_PTC_SKIPPED: buildPtcBreadcrumb,
  FAIL_COMM_PASS_MISSED: buildCommunicationsBreadcrumb,
  FAIL_TLI_UNDERBURN: buildBurnBreadcrumb,
  FAIL_MCC1_SKIPPED: buildBurnBreadcrumb,
  FAIL_MCC2_SKIPPED: buildBurnBreadcrumb,
  FAIL_MCC3_SKIPPED: buildBurnBreadcrumb,
  FAIL_MCC4_SKIPPED: buildBurnBreadcrumb,
  FAIL_MCC5_SKIPPED: buildBurnBreadcrumb,
  FAIL_LOI1_UNDERBURN: buildBurnBreadcrumb,
  FAIL_LOI2_SKIPPED: buildBurnBreadcrumb,
  FAIL_DOI_SKIPPED: buildBurnBreadcrumb,
  FAIL_PDI_UNDERBURN: buildBurnBreadcrumb,
  FAIL_ASCENT_NO_CAPTURE: buildBurnBreadcrumb,
  FAIL_TEI_UNDERBURN: buildBurnBreadcrumb,
};

export function createFailureBreadcrumb(failureId, options = {}) {
  if (!failureId) {
    return null;
  }
  const generator = GENERATORS[failureId] ?? null;
  if (!generator) {
    return buildDefaultBreadcrumb({
      failureId,
      metadata: options.metadata ?? null,
      note: options.note ?? null,
      source: options.source ?? null,
    });
  }
  return generator({
    failureId,
    ...options,
  });
}

