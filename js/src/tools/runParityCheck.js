#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';
import { DATA_DIR } from '../config/paths.js';
import { MissionLogger } from '../logging/missionLogger.js';
import { ManualActionRecorder } from '../logging/manualActionRecorder.js';
import { createSimulationContext } from '../sim/simulationContext.js';
import { formatGET, parseGET } from '../utils/time.js';

const SCORE_IGNORE_PATHS = [
  'manual',
  'rating.manualBonus',
  'rating.commanderScore',
  'rating.grade',
  'rating.breakdown.manual',
];

const LOG_IGNORE_MESSAGES = new Set([
  'Manual action script loaded',
  'Manual checklist override executed',
  'Manual resource delta applied',
]);

const LOG_IGNORE_CONTEXT_PATHS = [
  'actor',
  'note',
  'checklists.totals.autoSteps',
  'checklists.totals.manualSteps',
  'manualActions',
  'score.manual',
  'score.rating.manualBonus',
  'score.rating.commanderScore',
  'score.rating.grade',
  'score.rating.breakdown.manual',
];

const DEFAULT_OPTIONS = {
  tickRate: 20,
  logIntervalSeconds: 3600,
  checklistStepSeconds: 15,
  tolerance: 1e-6,
  quiet: true,
};

export async function runParityCheck({
  untilSeconds,
  dataDir = DATA_DIR,
  tickRate = DEFAULT_OPTIONS.tickRate,
  logIntervalSeconds = DEFAULT_OPTIONS.logIntervalSeconds,
  checklistStepSeconds = DEFAULT_OPTIONS.checklistStepSeconds,
  tolerance = DEFAULT_OPTIONS.tolerance,
  quiet = DEFAULT_OPTIONS.quiet,
  manualQueueOptions = null,
} = {}) {
  if (!Number.isFinite(untilSeconds)) {
    throw new Error('Parity harness requires a valid untilSeconds value');
  }

  const autoLogger = new MissionLogger({ silent: quiet });
  const manualLogger = new MissionLogger({ silent: quiet });
  const recorder = new ManualActionRecorder();

  const autoContext = await createSimulationContext({
    dataDir,
    logger: autoLogger,
    tickRate,
    logIntervalSeconds,
    autoAdvanceChecklists: true,
    checklistStepSeconds,
    manualActionRecorder: recorder,
    manualQueueOptions,
    hudOptions: { enabled: false },
  });

  const autoSummary = autoContext.simulation.run({ untilGetSeconds: untilSeconds });
  const recordedActions = recorder.buildScriptActions();

  const manualContext = await createSimulationContext({
    dataDir,
    logger: manualLogger,
    tickRate,
    logIntervalSeconds,
    autoAdvanceChecklists: false,
    checklistStepSeconds,
    manualActions: recordedActions,
    manualQueueOptions,
    hudOptions: { enabled: false },
  });

  const manualSummary = manualContext.simulation.run({ untilGetSeconds: untilSeconds });

  const autoLogs = autoLogger.getEntries();
  const manualLogs = manualLogger.getEntries();
  const parity = compareRuns({
    autoSummary,
    manualSummary,
    autoLogs,
    manualLogs,
    tolerance,
  });

  const report = buildReport({
    untilSeconds,
    options: {
      dataDir,
      tickRate,
      logIntervalSeconds,
      checklistStepSeconds,
      tolerance,
    },
    recorder,
    recordedActionsCount: recordedActions.length,
    autoSummary,
    manualSummary,
    manualQueueStats: manualContext.manualActionQueue?.stats() ?? null,
    autoLogs,
    manualLogs,
    parity,
  });

  return { report, parity, recordedActions };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const untilSeconds = args.untilSeconds ?? parseGET('015:00:00');
  const { report, parity } = await runParityCheck({
    untilSeconds,
    dataDir: args.dataDir,
    tickRate: args.tickRate,
    logIntervalSeconds: args.logIntervalSeconds,
    checklistStepSeconds: args.checklistStepSeconds,
    tolerance: args.tolerance,
    quiet: args.quiet,
  });

  if (args.outputPath) {
    await writeReport(args.outputPath, report, { pretty: true });
  }

  printReport(report, { quiet: args.quiet });

  if (!parity.passed) {
    process.exitCode = 1;
  }
}

function parseArgs(argv) {
  const args = {
    dataDir: DATA_DIR,
    tickRate: DEFAULT_OPTIONS.tickRate,
    logIntervalSeconds: DEFAULT_OPTIONS.logIntervalSeconds,
    checklistStepSeconds: DEFAULT_OPTIONS.checklistStepSeconds,
    tolerance: DEFAULT_OPTIONS.tolerance,
    quiet: DEFAULT_OPTIONS.quiet,
    untilSeconds: null,
    outputPath: null,
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
        if (parsed == null) {
          throw new Error(`Invalid GET format for --until: ${next}`);
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
      case '--data-dir': {
        const next = argv[i + 1];
        if (!next) {
          throw new Error('--data-dir requires a path');
        }
        args.dataDir = path.resolve(next);
        i += 1;
        break;
      }
      case '--tolerance': {
        const next = Number(argv[i + 1]);
        if (!Number.isFinite(next) || next < 0) {
          throw new Error('--tolerance requires a non-negative number');
        }
        args.tolerance = next;
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
      case '--verbose':
        args.quiet = false;
        break;
      case '--quiet':
        args.quiet = true;
        break;
      default:
        break;
    }
  }

  return args;
}

function buildReport({
  untilSeconds,
  options,
  recorder,
  recordedActionsCount,
  autoSummary,
  manualSummary,
  manualQueueStats,
  autoLogs,
  manualLogs,
  parity,
}) {
  const untilGet = formatGET(untilSeconds);
  const recorderStats = recorder.stats();
  const logStats = parity.logStats ?? {
    autoTotal: Array.isArray(autoLogs) ? autoLogs.length : 0,
    manualTotal: Array.isArray(manualLogs) ? manualLogs.length : 0,
    autoCompared: Array.isArray(autoLogs) ? autoLogs.length : 0,
    manualCompared: Array.isArray(manualLogs) ? manualLogs.length : 0,
  };

  return {
    untilGet,
    options: {
      dataDir: options.dataDir,
      tickRate: options.tickRate,
      logIntervalSeconds: options.logIntervalSeconds,
      checklistStepSeconds: options.checklistStepSeconds,
      tolerance: options.tolerance,
    },
    recorder: {
      checklistEntries: recorderStats.checklist.total,
      autoEntries: recorderStats.checklist.auto,
      manualEntries: recorderStats.checklist.manual,
      events: recorderStats.events,
      actionsGenerated: recordedActionsCount,
    },
    auto: summarizeRun(autoSummary, null, autoLogs),
    manual: summarizeRun(manualSummary, manualQueueStats, manualLogs),
    logs: {
      autoTotal: logStats.autoTotal,
      manualTotal: logStats.manualTotal,
      autoCompared: logStats.autoCompared,
      manualCompared: logStats.manualCompared,
      ignoreMessages: Array.from(LOG_IGNORE_MESSAGES),
      ignoreContextPaths: [...LOG_IGNORE_CONTEXT_PATHS],
    },
    parity,
  };
}

function summarizeRun(summary, manualQueueStats = null, logEntries = null) {
  return {
    ticks: summary.ticks,
    finalGet: formatGET(summary.finalGetSeconds),
    eventCounts: summary.events?.counts ?? null,
    upcomingEvents: summary.events?.upcoming ?? [],
    eventTimeline: summary.events?.timeline ?? null,
    resources: summary.resources ?? null,
    checklists: summary.checklists?.totals ?? null,
    autopilot: summary.autopilot ?? null,
    manualActions: summary.manualActions ?? manualQueueStats ?? null,
    score: summary.score ?? null,
    logs: {
      total: Array.isArray(logEntries) ? logEntries.length : null,
    },
  };
}

function compareRuns({
  autoSummary,
  manualSummary,
  autoLogs = [],
  manualLogs = [],
  tolerance = 1e-6,
  logIgnoreMessages = LOG_IGNORE_MESSAGES,
  logIgnoreContextPaths = LOG_IGNORE_CONTEXT_PATHS,
} = {}) {
  const eventDiffs = diffObjects(autoSummary.events, manualSummary.events, { tolerance });
  const eventTimelineDiffs = diffObjects(autoSummary.events?.timeline, manualSummary.events?.timeline, {
    tolerance,
  });
  const resourceDiffs = diffObjects(autoSummary.resources, manualSummary.resources, { tolerance });
  const autopilotDiffs = diffObjects(autoSummary.autopilot, manualSummary.autopilot, { tolerance });
  const checklistDiffs = diffObjects(autoSummary.checklists, manualSummary.checklists, {
    tolerance,
    ignorePaths: ['totals.autoSteps', 'totals.manualSteps'],
  });
  const scoreDiffs = diffObjects(autoSummary.score, manualSummary.score, {
    tolerance,
    ignorePaths: SCORE_IGNORE_PATHS,
  });

  const logResult = diffLogs(autoLogs, manualLogs, {
    tolerance,
    ignoreMessages: logIgnoreMessages,
    ignoreContextPaths: logIgnoreContextPaths,
  });

  const passed =
    eventDiffs.length === 0 &&
    eventTimelineDiffs.length === 0 &&
    resourceDiffs.length === 0 &&
    autopilotDiffs.length === 0 &&
    checklistDiffs.length === 0 &&
    scoreDiffs.length === 0 &&
    logResult.diffs.length === 0;

  return {
    passed,
    eventDiffs,
    eventTimelineDiffs,
    resourceDiffs,
    autopilotDiffs,
    checklistDiffs,
    scoreDiffs,
    logDiffs: logResult.diffs,
    logStats: logResult.stats,
  };
}

function diffObjects(autoValue, manualValue, { tolerance = 1e-6, ignorePaths = [] } = {}) {
  const diffs = [];
  const ignoreSet = new Set(ignorePaths);

  function traverse(a, b, pathSegments) {
    const pathKey = pathSegments.length > 0 ? pathSegments.join('.') : '';
    if (ignoreSet.has(pathKey)) {
      return;
    }

    if (Number.isFinite(a) && Number.isFinite(b)) {
      if (Math.abs(a - b) > tolerance) {
        diffs.push({ path: pathKey, auto: a, manual: b, delta: b - a });
      }
      return;
    }

    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) {
        diffs.push({ path: pathKey, autoLength: a.length, manualLength: b.length });
        return;
      }
      for (let i = 0; i < a.length; i += 1) {
        traverse(a[i], b[i], [...pathSegments, `[${i}]`]);
      }
      return;
    }

    if (isPlainObject(a) && isPlainObject(b)) {
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      for (const key of keys) {
        traverse(a?.[key], b?.[key], [...pathSegments, key]);
      }
      return;
    }

    if (a === b) {
      return;
    }
    if (a == null && b == null) {
      return;
    }

    diffs.push({ path: pathKey, auto: a, manual: b });
  }

  traverse(autoValue, manualValue, []);
  return diffs;
}

function diffLogs(
  autoEntries,
  manualEntries,
  { tolerance = 1e-6, ignoreMessages = [], ignoreContextPaths = [] } = {},
) {
  const autoLogs = Array.isArray(autoEntries) ? autoEntries : [];
  const manualLogs = Array.isArray(manualEntries) ? manualEntries : [];
  const ignoreSet = ignoreMessages instanceof Set ? ignoreMessages : new Set(ignoreMessages ?? []);

  const filteredAuto = filterLogsForComparison(autoLogs, ignoreSet);
  const filteredManual = filterLogsForComparison(manualLogs, ignoreSet);
  const diffs = [];

  if (filteredAuto.length !== filteredManual.length) {
    diffs.push({ path: 'length', auto: filteredAuto.length, manual: filteredManual.length });
  }

  const compareCount = Math.min(filteredAuto.length, filteredManual.length);
  for (let i = 0; i < compareCount; i += 1) {
    const autoEntry = filteredAuto[i] ?? {};
    const manualEntry = filteredManual[i] ?? {};
    const prefix = `#${i}`;

    const autoGet = normalizeGetSeconds(autoEntry);
    const manualGet = normalizeGetSeconds(manualEntry);
    if (Number.isFinite(autoGet) && Number.isFinite(manualGet)) {
      if (Math.abs(autoGet - manualGet) > tolerance) {
        diffs.push({
          path: `${prefix}.getSeconds`,
          auto: autoGet,
          manual: manualGet,
          delta: manualGet - autoGet,
        });
      }
    } else if (autoEntry.getSeconds !== manualEntry.getSeconds) {
      diffs.push({
        path: `${prefix}.getSeconds`,
        auto: autoEntry.getSeconds,
        manual: manualEntry.getSeconds,
      });
    }

    const autoMessage = autoEntry?.message ?? null;
    const manualMessage = manualEntry?.message ?? null;
    if (autoMessage !== manualMessage) {
      diffs.push({ path: `${prefix}.message`, auto: autoMessage, manual: manualMessage });
    }

    const contextDiffs = diffObjects(autoEntry.context ?? null, manualEntry.context ?? null, {
      tolerance,
      ignorePaths: ignoreContextPaths,
    });
    for (const diff of contextDiffs) {
      const pathSuffix = diff.path ? `.context.${diff.path}` : '.context';
      const entry = { path: `${prefix}${pathSuffix}` };
      if ('delta' in diff) {
        entry.delta = diff.delta;
      }
      if ('auto' in diff) {
        entry.auto = diff.auto;
      }
      if ('manual' in diff) {
        entry.manual = diff.manual;
      }
      if ('autoLength' in diff) {
        entry.autoLength = diff.autoLength;
      }
      if ('manualLength' in diff) {
        entry.manualLength = diff.manualLength;
      }
      diffs.push(entry);
    }
  }

  return {
    diffs,
    stats: {
      autoTotal: autoLogs.length,
      manualTotal: manualLogs.length,
      autoCompared: filteredAuto.length,
      manualCompared: filteredManual.length,
    },
  };
}

function filterLogsForComparison(entries, ignoreSet) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return [];
  }
  return entries.filter((entry) => entry && !ignoreSet.has(entry.message));
}

function normalizeGetSeconds(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const value = entry.getSeconds ?? entry.get_seconds ?? entry.get ?? null;
  if (Number.isFinite(value)) {
    return Number(value);
  }
  return null;
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

async function writeReport(filePath, report, { pretty = true } = {}) {
  const absolutePath = path.resolve(filePath);
  const directory = path.dirname(absolutePath);
  await fs.mkdir(directory, { recursive: true });
  const payload = pretty ? JSON.stringify(report, null, 2) : JSON.stringify(report);
  await fs.writeFile(absolutePath, payload, 'utf8');
}

function printReport(report, { quiet }) {
  const status = report.parity.passed ? 'PASS' : 'FAIL';
  console.log(`Manual/auto parity: ${status} (until GET ${report.untilGet})`);
  console.log(`  Auto ticks: ${report.auto.ticks}; Manual ticks: ${report.manual.ticks}`);
  if (report.recorder.actionsGenerated === 0) {
    console.log('  No checklist actions were recorded during the auto run.');
  } else {
    console.log(
      `  Checklist steps recorded: ${report.recorder.actionsGenerated} actions from ${report.recorder.checklistEntries} entries`,
    );
  }

  if (report.logs) {
    console.log(
      `  Log entries recorded: auto ${report.logs.autoTotal}; manual ${report.logs.manualTotal}`,
    );
    console.log(
      `  Log entries compared (after filters): auto ${report.logs.autoCompared}; manual ${report.logs.manualCompared}`,
    );
    if (Array.isArray(report.logs.ignoreMessages) && report.logs.ignoreMessages.length > 0) {
      console.log(`  Ignored log messages: ${report.logs.ignoreMessages.join(', ')}`);
    }
    if (Array.isArray(report.logs.ignoreContextPaths) && report.logs.ignoreContextPaths.length > 0) {
      console.log(`  Ignored context fields: ${report.logs.ignoreContextPaths.join(', ')}`);
    }
  }

  if (!report.parity.passed || !quiet) {
    printDifferences(report.parity);
  }
}

function printDifferences(parity) {
  const groups = [
    ['Event counts', parity.eventDiffs],
    ['Event timeline', parity.eventTimelineDiffs],
    ['Resource snapshot', parity.resourceDiffs],
    ['Autopilot metrics', parity.autopilotDiffs],
    ['Checklist totals', parity.checklistDiffs],
    ['Score summary', parity.scoreDiffs],
    ['Log entries', parity.logDiffs],
  ];

  for (const [label, diffs] of groups) {
    if (!diffs || diffs.length === 0) {
      continue;
    }
    console.log(`  Differences detected in ${label}:`);
    for (const diff of diffs) {
      const pathLabel = diff.path?.length ? diff.path : '(root)';
      if ('autoLength' in diff || 'manualLength' in diff) {
        console.log(
          `    • ${pathLabel}: auto length ${diff.autoLength ?? 'n/a'} vs manual length ${diff.manualLength ?? 'n/a'}`,
        );
        continue;
      }
      if (typeof diff.auto === 'number' && typeof diff.manual === 'number') {
        console.log(
          `    • ${pathLabel}: auto ${diff.auto} vs manual ${diff.manual} (Δ=${diff.delta})`,
        );
        continue;
      }
      console.log(`    • ${pathLabel}: auto=${formatValue(diff.auto)} manual=${formatValue(diff.manual)}`);
    }
  }
}

function formatValue(value) {
  if (value == null) {
    return String(value);
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return value;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '')) {
  main().catch((error) => {
    console.error('Parity harness failed:', error);
    process.exitCode = 1;
  });
}
