#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';
import { DATA_DIR } from '../config/paths.js';
import { MissionLogger } from '../logging/missionLogger.js';
import { createSimulationContext } from '../sim/simulationContext.js';
import { formatGET, parseGET } from '../utils/time.js';

const DEFAULT_UNTIL_GET = '015:00:00';

export const DEFAULT_PERFORMANCE_THRESHOLDS = {
  tickAverageMs: { caution: 52, warning: 55, direction: 'above' },
  tickDriftMaxAbsMs: { caution: 1.5, warning: 2.5, direction: 'above' },
  hudRenderAverageMs: { caution: 35, warning: 45, direction: 'above' },
  hudRenderMaxMs: { caution: 45, warning: 60, direction: 'above' },
  hudMaxDropStreak: { caution: 1, warning: 3, direction: 'above' },
  audioMaxQueuedTotal: { caution: 0, warning: 1, direction: 'above' },
  audioMaxActiveTotal: { caution: 6, warning: 8, direction: 'above' },
  inputAverageLatencyMs: { caution: 40, warning: 80, direction: 'above' },
  inputMaxLatencyMs: { caution: 80, warning: 120, direction: 'above' },
};

export async function analyzePerformance({
  dataDir = DATA_DIR,
  untilSeconds = parseGET(DEFAULT_UNTIL_GET),
  tickRate = 20,
  logIntervalSeconds = 3600,
  checklistStepSeconds = 15,
  hudIntervalSeconds = null,
  quiet = true,
  thresholds = DEFAULT_PERFORMANCE_THRESHOLDS,
} = {}) {
  if (!Number.isFinite(untilSeconds) || untilSeconds <= 0) {
    throw new Error('analyzePerformance requires a positive untilSeconds value');
  }

  const logger = new MissionLogger({ silent: quiet });
  const hudOptions = {
    enabled: true,
  };
  if (Number.isFinite(hudIntervalSeconds) && hudIntervalSeconds > 0) {
    hudOptions.renderIntervalSeconds = hudIntervalSeconds;
  }

  const context = await createSimulationContext({
    dataDir,
    logger,
    tickRate,
    logIntervalSeconds,
    autoAdvanceChecklists: true,
    checklistStepSeconds,
    hudOptions,
  });

  const summary = context.simulation.run({ untilGetSeconds: untilSeconds });
  const finalGetSeconds = summary.finalGetSeconds ?? context.simulation.clock?.getCurrent?.() ?? untilSeconds;
  if (context.audioDispatcher?.stopAll) {
    context.audioDispatcher.stopAll('performance_analysis_complete', finalGetSeconds);
  }

  const performanceSnapshot = context.performanceTracker?.summary?.()
    ?? summary.performance
    ?? null;

  const evaluation = evaluatePerformanceSnapshot(performanceSnapshot, thresholds);
  const logSnapshot = context.missionLogAggregator?.snapshot?.({ categories: ['performance'] }) ?? null;
  const timeline = buildTimeline(logSnapshot);

  return {
    options: {
      dataDir: path.resolve(dataDir),
      untilSeconds,
      untilGet: formatGET(untilSeconds),
      tickRate,
      logIntervalSeconds,
      checklistStepSeconds,
      hudIntervalSeconds: hudOptions.renderIntervalSeconds ?? null,
      quiet,
    },
    summary,
    performance: performanceSnapshot,
    evaluation,
    logs: timeline,
  };
}

export function evaluatePerformanceSnapshot(snapshot, thresholds = DEFAULT_PERFORMANCE_THRESHOLDS) {
  const metrics = summarizeMetrics(snapshot);
  const resolvedThresholds = mergeThresholds(DEFAULT_PERFORMANCE_THRESHOLDS, thresholds);
  const alerts = [];
  const severityCounts = { caution: 0, warning: 0, failure: 0 };

  const checks = [
    {
      id: 'tickAverageMs',
      label: 'Tick average',
      value: metrics.tickAverageMs,
      spec: resolvedThresholds.tickAverageMs,
      message: (value, threshold, severity) =>
        `${labelWithUnits('Tick average', value, 'ms')} exceeds ${severity} threshold ${threshold} ms`,
    },
    {
      id: 'tickDriftMaxAbsMs',
      label: 'Tick drift (max abs)',
      value: metrics.tickDriftMaxAbsMs,
      spec: resolvedThresholds.tickDriftMaxAbsMs,
      message: (value, threshold, severity) =>
        `${labelWithUnits('Tick drift (max abs)', value, 'ms')} exceeds ${severity} threshold ${threshold} ms`,
    },
    {
      id: 'hudRenderAverageMs',
      label: 'HUD render average',
      value: metrics.hudRenderAverageMs,
      spec: resolvedThresholds.hudRenderAverageMs,
      message: (value, threshold, severity) =>
        `${labelWithUnits('HUD render average', value, 'ms')} exceeds ${severity} threshold ${threshold} ms`,
    },
    {
      id: 'hudRenderMaxMs',
      label: 'HUD render max',
      value: metrics.hudRenderMaxMs,
      spec: resolvedThresholds.hudRenderMaxMs,
      message: (value, threshold, severity) =>
        `${labelWithUnits('HUD render max', value, 'ms')} exceeds ${severity} threshold ${threshold} ms`,
    },
    {
      id: 'hudMaxDropStreak',
      label: 'HUD drop streak',
      value: metrics.hudMaxDropStreak,
      spec: resolvedThresholds.hudMaxDropStreak,
      message: (value, threshold, severity) =>
        `${labelWithUnits('HUD drop streak', value)} exceeds ${severity} threshold ${threshold}`,
    },
    {
      id: 'audioMaxQueuedTotal',
      label: 'Audio queue depth',
      value: metrics.audioMaxQueuedTotal,
      spec: resolvedThresholds.audioMaxQueuedTotal,
      message: (value, threshold, severity) =>
        `${labelWithUnits('Audio queue depth', value)} exceeds ${severity} threshold ${threshold}`,
    },
    {
      id: 'audioMaxActiveTotal',
      label: 'Audio active cues',
      value: metrics.audioMaxActiveTotal,
      spec: resolvedThresholds.audioMaxActiveTotal,
      message: (value, threshold, severity) =>
        `${labelWithUnits('Audio active cues', value)} exceeds ${severity} threshold ${threshold}`,
    },
    {
      id: 'inputAverageLatencyMs',
      label: 'Input latency average',
      value: metrics.inputAverageLatencyMs,
      spec: resolvedThresholds.inputAverageLatencyMs,
      message: (value, threshold, severity) =>
        `${labelWithUnits('Input latency average', value, 'ms')} exceeds ${severity} threshold ${threshold} ms`,
    },
    {
      id: 'inputMaxLatencyMs',
      label: 'Input latency max',
      value: metrics.inputMaxLatencyMs,
      spec: resolvedThresholds.inputMaxLatencyMs,
      message: (value, threshold, severity) =>
        `${labelWithUnits('Input latency max', value, 'ms')} exceeds ${severity} threshold ${threshold} ms`,
    },
  ];

  for (const check of checks) {
    const evaluation = evaluateThreshold(check.value, check.spec);
    if (!evaluation) {
      continue;
    }
    const messageFn = check.message ?? defaultMessage;
    const message = messageFn(check.value, evaluation.threshold, evaluation.severity);
    alerts.push({
      id: check.id,
      label: check.label,
      severity: evaluation.severity,
      value: check.value,
      threshold: evaluation.threshold,
      direction: evaluation.direction,
      message,
    });
    if (severityCounts[evaluation.severity] != null) {
      severityCounts[evaluation.severity] += 1;
    }
  }

  const passed = alerts.every((alert) => alert.severity === 'caution');

  return {
    metrics,
    alerts,
    severityCounts,
    passed,
    thresholds: resolvedThresholds,
  };
}

function buildTimeline(logSnapshot) {
  if (!logSnapshot) {
    return {
      totalCount: 0,
      filteredCount: 0,
      entries: [],
      categories: {},
      severities: {},
    };
  }

  const entries = Array.isArray(logSnapshot.entries)
    ? logSnapshot.entries.map((entry) => ({
        id: entry.id,
        index: entry.index,
        sequence: entry.sequence,
        timestampSeconds: entry.timestampSeconds ?? null,
        timestampGet: entry.timestampGet ?? null,
        severity: entry.severity ?? null,
        message: entry.message ?? '',
        overview: entry.context?.overview ?? deriveOverview(entry.context?.snapshot ?? null),
        snapshot: entry.context?.snapshot ?? null,
      }))
    : [];

  return {
    totalCount: logSnapshot.totalCount ?? entries.length,
    filteredCount: logSnapshot.filteredCount ?? entries.length,
    categories: logSnapshot.categories ?? {},
    severities: logSnapshot.severities ?? {},
    entries,
  };
}

function summarizeMetrics(snapshot) {
  const metrics = {
    tickCount: coerceNumber(snapshot?.tick?.count),
    tickAverageMs: coerceNumber(snapshot?.tick?.averageMs ?? snapshot?.tick?.average_ms),
    tickMaxMs: coerceNumber(snapshot?.tick?.maxMs ?? snapshot?.tick?.max_ms),
    tickMinMs: coerceNumber(snapshot?.tick?.minMs ?? snapshot?.tick?.min_ms),
    tickDriftAverageMs: coerceNumber(snapshot?.tick?.drift?.averageMs ?? snapshot?.tick?.drift?.average_ms),
    tickDriftMaxAbsMs: coerceNumber(
      snapshot?.tick?.drift?.maxAbsMs
        ?? snapshot?.tick?.drift?.maxAbs
        ?? snapshot?.tick?.drift?.max_abs_ms
        ?? snapshot?.tick?.drift?.max_abs,
    ),
    hudRenderAverageMs: coerceNumber(snapshot?.hud?.renderMs?.average ?? snapshot?.hud?.render_ms?.average),
    hudRenderMaxMs: coerceNumber(snapshot?.hud?.renderMs?.max ?? snapshot?.hud?.render_ms?.max),
    hudRenderMinMs: coerceNumber(snapshot?.hud?.renderMs?.min ?? snapshot?.hud?.render_ms?.min),
    hudDropTotal: coerceNumber(snapshot?.hud?.drop?.total ?? snapshot?.hud?.drop_total),
    hudMaxDropStreak: coerceNumber(
      snapshot?.hud?.drop?.maxConsecutive
        ?? snapshot?.hud?.drop?.max_consecutive
        ?? snapshot?.hud?.max_drop_streak,
    ),
    hudLastDropCount: coerceNumber(snapshot?.hud?.drop?.last ?? snapshot?.hud?.drop_last),
    audioMaxActiveTotal: coerceNumber(snapshot?.audio?.maxActiveTotal ?? snapshot?.audio?.max_active_total),
    audioMaxQueuedTotal: coerceNumber(snapshot?.audio?.maxQueuedTotal ?? snapshot?.audio?.max_queued_total),
    inputAverageLatencyMs: coerceNumber(
      snapshot?.input?.averageLatencyMs
        ?? snapshot?.input?.average_latency_ms
        ?? snapshot?.input?.average,
    ),
    inputMaxLatencyMs: coerceNumber(snapshot?.input?.maxLatencyMs ?? snapshot?.input?.max_latency_ms ?? snapshot?.input?.max),
  };
  return metrics;
}

function deriveOverview(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    return null;
  }
  const metrics = summarizeMetrics(snapshot);
  return {
    tickAvgMs: metrics.tickAverageMs,
    tickMaxMs: metrics.tickMaxMs,
    tickDriftMaxAbsMs: metrics.tickDriftMaxAbsMs,
    hudAvgMs: metrics.hudRenderAverageMs,
    hudMaxMs: metrics.hudRenderMaxMs,
    hudDrops: metrics.hudDropTotal,
    hudMaxDropStreak: metrics.hudMaxDropStreak,
    audioMaxActive: metrics.audioMaxActiveTotal,
    audioMaxQueued: metrics.audioMaxQueuedTotal,
    inputAvgMs: metrics.inputAverageLatencyMs,
    inputMaxMs: metrics.inputMaxLatencyMs,
  };
}

function mergeThresholds(base, overrides) {
  if (!overrides || overrides === base) {
    return { ...base };
  }
  const merged = {};
  const keys = new Set([...Object.keys(base ?? {}), ...Object.keys(overrides ?? {})]);
  for (const key of keys) {
    const baseValue = base?.[key];
    const overrideValue = overrides?.[key];
    if (overrideValue && typeof overrideValue === 'object' && !Array.isArray(overrideValue)) {
      merged[key] = { ...baseValue, ...overrideValue };
    } else if (overrideValue !== undefined) {
      merged[key] = overrideValue;
    } else {
      merged[key] = baseValue;
    }
  }
  return merged;
}

function evaluateThreshold(value, spec) {
  if (!Number.isFinite(value) || !spec) {
    return null;
  }
  const direction = spec.direction === 'below' ? 'below' : 'above';
  const checks = ['failure', 'warning', 'caution'];
  for (const severity of checks) {
    const threshold = spec[severity];
    if (!Number.isFinite(threshold)) {
      continue;
    }
    if (direction === 'above' && value > threshold) {
      return { severity, threshold, direction };
    }
    if (direction === 'below' && value < threshold) {
      return { severity, threshold, direction };
    }
  }
  return null;
}

function labelWithUnits(label, value, units = null) {
  if (!Number.isFinite(value)) {
    return `${label} n/a`;
  }
  const suffix = units ? ` ${units}` : '';
  return `${label} ${round(value, 3)}${suffix}`;
}

function round(value, decimals = 3) {
  if (!Number.isFinite(value)) {
    return value;
  }
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function coerceNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function defaultMessage(value, threshold, severity) {
  return `${labelWithUnits('Value', value)} exceeds ${severity} threshold ${threshold}`;
}

function parseArgs(argv) {
  const args = {
    dataDir: DATA_DIR,
    untilSeconds: parseGET(DEFAULT_UNTIL_GET),
    tickRate: 20,
    logIntervalSeconds: 3600,
    checklistStepSeconds: 15,
    hudIntervalSeconds: null,
    quiet: true,
    outputPath: null,
    csvPath: null,
    pretty: false,
    strict: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--until': {
        const next = argv[i + 1];
        if (!next) {
          throw new Error('--until requires a GET value (e.g., 015:00:00)');
        }
        const parsed = parseGET(next);
        if (!Number.isFinite(parsed)) {
          throw new Error(`Invalid GET for --until: ${next}`);
        }
        args.untilSeconds = parsed;
        i += 1;
        break;
      }
      case '--tick-rate': {
        const next = Number(argv[i + 1]);
        if (!Number.isFinite(next) || next <= 0) {
          throw new Error('--tick-rate requires a positive number');
        }
        args.tickRate = next;
        i += 1;
        break;
      }
      case '--log-interval': {
        const next = Number(argv[i + 1]);
        if (!Number.isFinite(next) || next <= 0) {
          throw new Error('--log-interval requires a positive number of seconds');
        }
        args.logIntervalSeconds = next;
        i += 1;
        break;
      }
      case '--checklist-step-seconds': {
        const next = Number(argv[i + 1]);
        if (!Number.isFinite(next) || next <= 0) {
          throw new Error('--checklist-step-seconds requires a positive number');
        }
        args.checklistStepSeconds = next;
        i += 1;
        break;
      }
      case '--hud-interval': {
        const next = Number(argv[i + 1]);
        if (!Number.isFinite(next) || next <= 0) {
          throw new Error('--hud-interval requires a positive number of seconds');
        }
        args.hudIntervalSeconds = next;
        i += 1;
        break;
      }
      case '--data-dir': {
        const next = argv[i + 1];
        if (!next) {
          throw new Error('--data-dir requires a path');
        }
        args.dataDir = path.resolve(next);
        i += 1;
        break;
      }
      case '--output': {
        const next = argv[i + 1];
        if (!next) {
          throw new Error('--output requires a file path');
        }
        args.outputPath = next;
        i += 1;
        break;
      }
      case '--csv': {
        const next = argv[i + 1];
        if (!next) {
          throw new Error('--csv requires a file path');
        }
        args.csvPath = next;
        i += 1;
        break;
      }
      case '--pretty':
        args.pretty = true;
        break;
      case '--no-pretty':
        args.pretty = false;
        break;
      case '--quiet':
        args.quiet = true;
        break;
      case '--verbose':
        args.quiet = false;
        break;
      case '--strict':
        args.strict = true;
        break;
      default:
        break;
    }
  }

  return args;
}

async function writeJson(filePath, data, { pretty = false } = {}) {
  if (!filePath) {
    return;
  }
  const absolute = path.resolve(filePath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  const payload = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
  await fs.writeFile(absolute, payload, 'utf8');
}

async function writeCsv(filePath, entries) {
  if (!filePath) {
    return;
  }
  const absolute = path.resolve(filePath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  const header = [
    'timestamp_get',
    'timestamp_seconds',
    'severity',
    'message',
    'tick_avg_ms',
    'tick_max_ms',
    'tick_drift_max_abs_ms',
    'hud_avg_ms',
    'hud_max_ms',
    'hud_drops',
    'hud_max_drop_streak',
    'audio_max_active',
    'audio_max_queued',
    'input_avg_ms',
    'input_max_ms',
  ];
  const lines = [header.join(',')];
  for (const entry of entries ?? []) {
    const overview = entry.overview ?? {};
    const row = [
      escapeCsv(entry.timestampGet ?? ''),
      escapeCsv(entry.timestampSeconds ?? ''),
      escapeCsv(entry.severity ?? ''),
      escapeCsv((entry.message ?? '').replace(/\s+/g, ' ').trim()),
      escapeCsv(formatMaybeNumber(overview.tickAvgMs)),
      escapeCsv(formatMaybeNumber(overview.tickMaxMs)),
      escapeCsv(formatMaybeNumber(overview.tickDriftMaxAbsMs)),
      escapeCsv(formatMaybeNumber(overview.hudAvgMs)),
      escapeCsv(formatMaybeNumber(overview.hudMaxMs)),
      escapeCsv(formatMaybeNumber(overview.hudDrops)),
      escapeCsv(formatMaybeNumber(overview.hudMaxDropStreak)),
      escapeCsv(formatMaybeNumber(overview.audioMaxActive)),
      escapeCsv(formatMaybeNumber(overview.audioMaxQueued)),
      escapeCsv(formatMaybeNumber(overview.inputAvgMs)),
      escapeCsv(formatMaybeNumber(overview.inputMaxMs)),
    ];
    lines.push(row.join(','));
  }
  await fs.writeFile(absolute, `${lines.join('\n')}\n`, 'utf8');
}

function escapeCsv(value) {
  const stringValue = value == null ? '' : String(value);
  if (stringValue.includes(',') || stringValue.includes('\n') || stringValue.includes('"')) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function formatMaybeNumber(value, decimals = 3) {
  return Number.isFinite(value) ? round(value, decimals) : '';
}

function displayValue(value, decimals = 3) {
  return Number.isFinite(value) ? round(value, decimals) : 'n/a';
}

function printReport(report, { quiet }) {
  const untilLabel = report.options?.untilGet ?? formatGET(report.options?.untilSeconds ?? 0);
  console.log(`Performance analysis until GET ${untilLabel}`);
  const metrics = report.evaluation?.metrics ?? {};
  console.log(
    `  Tick avg ${displayValue(metrics.tickAverageMs, 3)} ms (max ${displayValue(metrics.tickMaxMs, 3)} ms)`,
  );
  console.log(
    `  Tick drift max abs ${displayValue(metrics.tickDriftMaxAbsMs, 3)} ms`,
  );
  console.log(
    `  HUD render avg ${displayValue(metrics.hudRenderAverageMs, 3)} ms (max ${displayValue(metrics.hudRenderMaxMs, 3)} ms)`,
  );
  console.log(
    `  HUD drop streak max ${displayValue(metrics.hudMaxDropStreak, 3)} (total ${displayValue(metrics.hudDropTotal, 3)})`,
  );
  console.log(
    `  Audio max active ${displayValue(metrics.audioMaxActiveTotal, 3)}; queued ${displayValue(metrics.audioMaxQueuedTotal, 3)}`,
  );
  console.log(
    `  Input latency avg ${displayValue(metrics.inputAverageLatencyMs, 3)} ms (max ${displayValue(metrics.inputMaxLatencyMs, 3)} ms)`,
  );

  const alerts = report.evaluation?.alerts ?? [];
  if (alerts.length === 0) {
    console.log('  Alerts: none');
  } else {
    console.log(`  Alerts (${alerts.length}):`);
    for (const alert of alerts) {
      console.log(`    [${alert.severity}] ${alert.message}`);
    }
  }

  if (!quiet) {
    const logCount = report.logs?.entries?.length ?? 0;
    console.log(`  Performance log entries captured: ${logCount}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await analyzePerformance({
    dataDir: args.dataDir,
    untilSeconds: args.untilSeconds,
    tickRate: args.tickRate,
    logIntervalSeconds: args.logIntervalSeconds,
    checklistStepSeconds: args.checklistStepSeconds,
    hudIntervalSeconds: args.hudIntervalSeconds,
    quiet: args.quiet,
  });

  if (args.outputPath) {
    await writeJson(args.outputPath, report, { pretty: args.pretty });
  }
  if (args.csvPath) {
    await writeCsv(args.csvPath, report.logs?.entries ?? []);
  }

  printReport(report, { quiet: args.quiet });

  const hasSevereAlert = report.evaluation?.alerts?.some((alert) => alert.severity === 'warning' || alert.severity === 'failure');
  if (args.strict && hasSevereAlert) {
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '')) {
  main().catch((error) => {
    console.error('Performance analysis failed:', error);
    process.exitCode = 1;
  });
}
