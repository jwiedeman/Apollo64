#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';
import { MissionLogger } from '../logging/missionLogger.js';
import { createSimulationContext } from '../sim/simulationContext.js';
import { parseGET, formatGET } from '../utils/time.js';
import { DATA_DIR } from '../config/paths.js';

const DEFAULT_UNTIL_GET = '015:00:00';

export async function analyzeAutopilotRuns(options = {}) {
  const {
    dataDir = DATA_DIR,
    untilSeconds = parseGET(DEFAULT_UNTIL_GET),
    autopilotIds = null,
    eventIds = null,
    quiet = true,
    tickRate = 20,
    logIntervalSeconds = 3600,
    includePending = false,
    hudEnabled = false,
  } = options;

  if (!Number.isFinite(untilSeconds) || untilSeconds <= 0) {
    throw new Error('analyzeAutopilotRuns requires a positive untilSeconds value');
  }

  const autopilotIdSet = normalizeIdSet(autopilotIds);
  const eventIdSet = normalizeIdSet(eventIds);

  const logger = new MissionLogger({ silent: quiet });
  const context = await createSimulationContext({
    dataDir,
    logger,
    tickRate,
    logIntervalSeconds,
    hudOptions: { enabled: hudEnabled },
  });

  const runSummary = context.simulation.run({ untilGetSeconds: untilSeconds });

  const runs = collectAutopilotRuns({
    scheduler: context.scheduler,
    autopilotRunner: context.autopilotRunner,
    missionData: context.missionData,
    autopilotIdSet,
    eventIdSet,
    includePending,
  });

  const sortedRuns = sortRuns(runs);
  const hasFailures = sortedRuns.some((run) => run.eventStatus === 'failed');

  return {
    options: {
      dataDir: path.resolve(dataDir),
      untilSeconds,
      untilGet: formatGET(untilSeconds),
      quiet,
      tickRate,
      logIntervalSeconds,
      autopilotIds: autopilotIdSet ? Array.from(autopilotIdSet) : null,
      eventIds: eventIdSet ? Array.from(eventIdSet) : null,
      includePending,
    },
    summary: runSummary,
    runs: sortedRuns,
    hasFailures,
  };
}

function collectAutopilotRuns({
  scheduler,
  autopilotRunner,
  missionData,
  autopilotIdSet,
  eventIdSet,
  includePending,
}) {
  const events = Array.isArray(scheduler?.events) ? scheduler.events : [];
  const completedSummaries = autopilotRunner?.completedEvents ?? new Map();
  const activeStates = autopilotRunner?.active ?? new Map();
  const pads = missionData?.pads ?? new Map();

  const runs = [];

  for (const event of events) {
    if (!event?.autopilotId) {
      continue;
    }
    if (autopilotIdSet && !autopilotIdSet.has(event.autopilotId)) {
      continue;
    }
    if (eventIdSet && !eventIdSet.has(event.id)) {
      continue;
    }

    const summary = event.lastAutopilotSummary
      ?? completedSummaries.get(event.id)
      ?? null;
    const active = activeStates.get?.(event.id) ?? null;

    if (!summary && !includePending && !active && event.status !== 'failed') {
      if (event.status === 'pending' || event.status === 'armed') {
        continue;
      }
    }

    const pad = event.padId ? pads.get(event.padId) ?? null : null;

    runs.push({
      eventId: event.id,
      autopilotId: event.autopilotId,
      autopilotTitle: event.autopilot?.script?.title ?? event.autopilot?.description ?? null,
      phase: event.phase ?? null,
      eventStatus: event.status ?? null,
      autopilotStatus: summary?.status ?? (active ? 'active' : null),
      autopilotReason: summary?.reason ?? null,
      getOpenSeconds: event.getOpenSeconds ?? null,
      getOpen: event.getOpenSeconds != null ? formatGET(event.getOpenSeconds) : null,
      getCloseSeconds: event.getCloseSeconds ?? null,
      getClose: event.getCloseSeconds != null ? formatGET(event.getCloseSeconds) : null,
      activationSeconds: event.activationTimeSeconds ?? null,
      activationGet:
        event.activationTimeSeconds != null ? formatGET(event.activationTimeSeconds) : null,
      completionSeconds: event.completionTimeSeconds ?? null,
      completionGet:
        event.completionTimeSeconds != null ? formatGET(event.completionTimeSeconds) : null,
      expectedDurationSeconds: event.expectedDurationSeconds ?? null,
      autopilotDurationSeconds: event.autopilot?.durationSeconds ?? null,
      tolerances: clone(event.autopilot?.tolerances ?? null),
      propulsion: clone(event.autopilot?.propulsion ?? null),
      metrics: clone(summary?.metrics ?? null),
      expected: clone(summary?.expected ?? null),
      deviations: clone(summary?.deviations ?? null),
      padId: event.padId ?? null,
      pad: summarizePad(pad),
    });
  }

  return runs;
}

function sortRuns(runs) {
  return [...runs].sort((a, b) => {
    const aTime = resolveSortKey(a);
    const bTime = resolveSortKey(b);
    if (aTime !== bTime) {
      return aTime - bTime;
    }
    return a.eventId.localeCompare(b.eventId);
  });
}

function resolveSortKey(run) {
  if (Number.isFinite(run.activationSeconds)) {
    return run.activationSeconds;
  }
  if (Number.isFinite(run.getOpenSeconds)) {
    return run.getOpenSeconds;
  }
  if (Number.isFinite(run.getCloseSeconds)) {
    return run.getCloseSeconds;
  }
  return Number.POSITIVE_INFINITY;
}

function summarizePad(pad) {
  if (!pad) {
    return null;
  }
  const tig = pad.parameters?.tig ?? null;
  const entryInterface = pad.parameters?.entryInterface ?? null;
  return {
    id: pad.id ?? null,
    purpose: pad.purpose ?? null,
    deliveryGet: pad.deliveryGet ?? null,
    deliveryGetSeconds: pad.deliveryGetSeconds ?? null,
    validUntilGet: pad.validUntilGet ?? null,
    validUntilSeconds: pad.validUntilSeconds ?? null,
    tigGet: tig?.get ?? null,
    tigSeconds: tig?.getSeconds ?? null,
    deltaVMetersPerSecond: pad.parameters?.deltaVMetersPerSecond ?? null,
    deltaVFtPerSec: pad.parameters?.deltaVFtPerSec ?? null,
    burnDurationSeconds: pad.parameters?.burnDurationSeconds ?? null,
    attitude: pad.parameters?.attitude ?? null,
    vInfinityMetersPerSecond: pad.parameters?.vInfinityMetersPerSecond ?? null,
    vInfinityFtPerSec: pad.parameters?.vInfinityFtPerSec ?? null,
    entryInterfaceGet: entryInterface?.get ?? null,
    entryInterfaceSeconds: entryInterface?.getSeconds ?? null,
    notes: pad.parameters?.notes ?? null,
  };
}

function clone(value) {
  if (value == null) {
    return null;
  }
  try {
    return structuredClone(value);
  } catch (error) {
    return JSON.parse(JSON.stringify(value));
  }
}

function normalizeIdSet(ids) {
  if (!ids) {
    return null;
  }
  const list = Array.isArray(ids) ? ids : [ids];
  const normalized = list
    .map((id) => (typeof id === 'string' ? id.trim() : ''))
    .filter((id) => id.length > 0);
  return normalized.length > 0 ? new Set(normalized) : null;
}

function formatNumber(value, { digits = 2 } = {}) {
  if (!Number.isFinite(value)) {
    return null;
  }
  return Number.parseFloat(value.toFixed(digits));
}

function buildTextReport(report) {
  const lines = [];
  lines.push(`Autopilot burn analysis — GET ${report.options.untilGet}`);
  const runCount = report.runs.length;
  lines.push(`Analyzed runs: ${runCount}`);
  if (report.hasFailures) {
    lines.push('Result: ⚠️ Failures detected in one or more events');
  } else {
    lines.push('Result: ✅ All analyzed autopilot events completed without failure');
  }

  for (const run of report.runs) {
    lines.push('');
    const titleParts = [run.eventId];
    if (run.autopilotId) {
      titleParts.push(`autopilot ${run.autopilotId}`);
    }
    if (run.autopilotTitle) {
      titleParts.push(`“${run.autopilotTitle}”`);
    }
    lines.push(titleParts.join(' — '));

    const statusParts = [];
    if (run.phase) {
      statusParts.push(`Phase: ${run.phase}`);
    }
    if (run.eventStatus) {
      statusParts.push(`Event status: ${run.eventStatus}`);
    }
    if (run.autopilotStatus) {
      statusParts.push(`Autopilot status: ${run.autopilotStatus}`);
    }
    if (run.autopilotReason) {
      statusParts.push(`Reason: ${run.autopilotReason}`);
    }
    if (statusParts.length > 0) {
      lines.push(`  ${statusParts.join(' | ')}`);
    }

    const windowParts = [];
    if (run.getOpen) {
      windowParts.push(`Window ${run.getOpen} → ${run.getClose ?? '…'}`);
    }
    if (run.activationGet) {
      windowParts.push(`Activation ${run.activationGet}`);
    }
    if (run.completionGet) {
      windowParts.push(`Completion ${run.completionGet}`);
    }
    if (windowParts.length > 0) {
      lines.push(`  ${windowParts.join(' | ')}`);
    }

    if (run.metrics || run.expected) {
      const { metrics, expected, deviations } = run;
      const burnActual = formatNumber(metrics?.burnSeconds, { digits: 2 });
      const burnExpected = formatNumber(expected?.burnSeconds, { digits: 2 });
      const burnDelta = formatNumber(deviations?.burnSeconds, { digits: 2 });
      if (burnActual != null || burnExpected != null) {
        lines.push(
          `  Burn seconds: actual ${burnActual ?? '—'} | expected ${burnExpected ?? '—'} | Δ ${
            burnDelta ?? '—'
          }`,
        );
      }

      const propActual = formatNumber(metrics?.propellantKg, { digits: 3 });
      const propExpected = formatNumber(expected?.propellantKg, { digits: 3 });
      const propDelta = formatNumber(deviations?.propellantKg, { digits: 3 });
      if (propActual != null || propExpected != null) {
        lines.push(
          `  Propellant kg: actual ${propActual ?? '—'} | expected ${propExpected ?? '—'} | Δ ${
            propDelta ?? '—'
          }`,
        );
      }

      const deltaVActual = formatNumber(metrics?.deltaVMps, { digits: 3 });
      const deltaVExpected = formatNumber(expected?.deltaVMps, { digits: 3 });
      const deltaVDelta = formatNumber(deviations?.deltaVMps, { digits: 3 });
      if (deltaVActual != null || deltaVExpected != null) {
        lines.push(
          `  Δv m/s: actual ${deltaVActual ?? '—'} | expected ${deltaVExpected ?? '—'} | Δ ${
            deltaVDelta ?? '—'
          }`,
        );
      }

      const ullageSeconds = formatNumber(metrics?.ullageSeconds, { digits: 2 });
      const ullageExpected = formatNumber(expected?.ullageSeconds, { digits: 2 });
      const ullageDelta = formatNumber(deviations?.ullageSeconds, { digits: 2 });
      if (ullageSeconds != null || ullageExpected != null) {
        lines.push(
          `  Ullage seconds: actual ${ullageSeconds ?? '—'} | expected ${ullageExpected ?? '—'} | Δ ${
            ullageDelta ?? '—'
          }`,
        );
      }

      const ullageKg = formatNumber(metrics?.rcsKg, { digits: 3 });
      const ullageKgExpected = formatNumber(expected?.ullageKg, { digits: 3 });
      const ullageKgDelta = formatNumber(deviations?.ullageKg, { digits: 3 });
      if (ullageKg != null || ullageKgExpected != null) {
        lines.push(
          `  Ullage kg: actual ${ullageKg ?? '—'} | expected ${ullageKgExpected ?? '—'} | Δ ${
            ullageKgDelta ?? '—'
          }`,
        );
      }
    }

    if (run.tolerances) {
      lines.push(`  Tolerances: ${formatTolerance(run.tolerances)}`);
    }

    if (run.pad) {
      const pad = run.pad;
      const padLines = [];
      padLines.push(`Pad ${pad.id}`);
      if (pad.tigGet) {
        padLines.push(`TIG ${pad.tigGet}`);
      }
      if (pad.deltaVMetersPerSecond != null) {
        padLines.push(`Δv ${formatNumber(pad.deltaVMetersPerSecond, { digits: 3 })} m/s`);
      } else if (pad.deltaVFtPerSec != null) {
        padLines.push(`Δv ${formatNumber(pad.deltaVFtPerSec, { digits: 3 })} ft/s`);
      }
      if (pad.burnDurationSeconds != null) {
        padLines.push(`Burn ${formatNumber(pad.burnDurationSeconds, { digits: 2 })} s`);
      }
      lines.push(`  ${padLines.join(' | ')}`);
    }
  }

  const totals = report.summary?.autop ?? null;
  if (totals) {
    lines.push('');
    lines.push('Aggregate autopilot metrics:');
    lines.push(`  Started: ${totals.started} | Completed: ${totals.completed} | Aborted: ${totals.aborted}`);
    lines.push(
      `  Total burn seconds: ${formatNumber(totals.totalBurnSeconds, { digits: 2 }) ?? '—'} | Ullage seconds: ${
        formatNumber(totals.totalUllageSeconds, { digits: 2 }) ?? '—'
      }`,
    );
    const tanks = totals.propellantKgByTank ?? {};
    const tankEntries = Object.entries(tanks).map(
      ([tank, kg]) => `${tank}: ${formatNumber(kg, { digits: 3 }) ?? '—'} kg`,
    );
    if (tankEntries.length > 0) {
      lines.push(`  Propellant usage: ${tankEntries.join(' | ')}`);
    }
  }

  return lines.join('\n');
}

function formatTolerance(tolerances) {
  const entries = [];
  const add = (label, value) => {
    if (value != null) {
      entries.push(`${label} ${value}`);
    }
  };
  add('burn_seconds', tolerances.burn_seconds ?? tolerances.burn_seconds_s ?? null);
  add('burn_seconds_pct', tolerances.burn_seconds_pct);
  add('propellant_kg', tolerances.propellant_kg);
  add('propellant_pct', tolerances.propellant_pct);
  add('delta_v_ft_s', tolerances.delta_v_ft_s);
  add('delta_v_mps', tolerances.delta_v_mps);
  return entries.length > 0 ? entries.join(' | ') : '—';
}

function parseArgs(argv) {
  const args = {
    dataDir: DATA_DIR,
    untilSeconds: parseGET(DEFAULT_UNTIL_GET),
    autopilotIds: [],
    eventIds: [],
    outputPath: null,
    json: false,
    pretty: false,
    quiet: false,
    includePending: false,
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
        if (!Number.isFinite(parsed) || parsed <= 0) {
          throw new Error(`Invalid --until value: ${next}`);
        }
        args.untilSeconds = parsed;
        i += 1;
        break;
      }
      case '--autopilot':
      case '--autopilot-id': {
        const next = argv[i + 1];
        if (!next) {
          throw new Error('--autopilot requires an ID');
        }
        args.autopilotIds.push(next);
        i += 1;
        break;
      }
      case '--event':
      case '--event-id': {
        const next = argv[i + 1];
        if (!next) {
          throw new Error('--event requires an event ID');
        }
        args.eventIds.push(next);
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
      case '--json':
        args.json = true;
        break;
      case '--pretty':
        args.pretty = true;
        break;
      case '--quiet':
        args.quiet = true;
        break;
      case '--include-pending':
        args.includePending = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

async function writeOutput(filePath, payload, { pretty = false } = {}) {
  if (!filePath) {
    return;
  }
  const absolute = path.resolve(filePath);
  const directory = path.dirname(absolute);
  await fs.mkdir(directory, { recursive: true });
  const serialized = pretty ? JSON.stringify(payload, null, 2) : JSON.stringify(payload);
  await fs.writeFile(absolute, serialized, 'utf8');
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const report = await analyzeAutopilotRuns({
      dataDir: args.dataDir,
      untilSeconds: args.untilSeconds,
      autopilotIds: args.autopilotIds,
      eventIds: args.eventIds,
      quiet: args.quiet || args.json,
      includePending: args.includePending,
    });

    if (args.outputPath) {
      await writeOutput(args.outputPath, report, { pretty: args.pretty });
    }

    if (args.json) {
      const serialized = args.pretty ? JSON.stringify(report, null, 2) : JSON.stringify(report);
      console.log(serialized);
    } else {
      console.log(buildTextReport(report));
    }

    if (report.hasFailures) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`Autopilot analysis failed: ${error.message}`);
    process.exitCode = 1;
  }
}

const isDirectExecution = (() => {
  if (!process.argv[1]) {
    return false;
  }
  try {
    return pathToFileURL(process.argv[1]).href === import.meta.url;
  } catch (error) {
    return false;
  }
})();

if (isDirectExecution) {
  main();
}

export { parseArgs, buildTextReport };
