#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
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

const DEFAULT_OPTIONS = {
  tickRate: 20,
  logIntervalSeconds: 3600,
  checklistStepSeconds: 15,
  tolerance: 1e-6,
  quiet: true,
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const untilSeconds = args.untilSeconds ?? parseGET('015:00:00');
  if (!Number.isFinite(untilSeconds)) {
    throw new Error('Parity harness requires a valid --until GET (e.g., 015:00:00)');
  }

  const autoLogger = new MissionLogger({ silent: args.quiet });
  const manualLogger = new MissionLogger({ silent: args.quiet });
  const recorder = new ManualActionRecorder();

  const autoContext = await createSimulationContext({
    dataDir: args.dataDir,
    logger: autoLogger,
    tickRate: args.tickRate,
    logIntervalSeconds: args.logIntervalSeconds,
    autoAdvanceChecklists: true,
    checklistStepSeconds: args.checklistStepSeconds,
    manualActionRecorder: recorder,
    hudOptions: { enabled: false },
  });

  const autoSummary = autoContext.simulation.run({ untilGetSeconds: untilSeconds });
  const recordedActions = recorder.buildScriptActions();

  const manualContext = await createSimulationContext({
    dataDir: args.dataDir,
    logger: manualLogger,
    tickRate: args.tickRate,
    logIntervalSeconds: args.logIntervalSeconds,
    autoAdvanceChecklists: false,
    checklistStepSeconds: args.checklistStepSeconds,
    manualActions: recordedActions,
    hudOptions: { enabled: false },
  });

  const manualSummary = manualContext.simulation.run({ untilGetSeconds: untilSeconds });
  const parity = compareSummaries(autoSummary, manualSummary, { tolerance: args.tolerance });

  const report = buildReport({
    untilSeconds,
    options: args,
    recorder,
    recordedActionsCount: recordedActions.length,
    autoSummary,
    manualSummary,
    manualQueueStats: manualContext.manualActionQueue?.stats() ?? null,
    parity,
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
  parity,
}) {
  const untilGet = formatGET(untilSeconds);
  const recorderStats = recorder.stats();

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
    auto: summarizeRun(autoSummary),
    manual: summarizeRun(manualSummary, manualQueueStats),
    parity,
  };
}

function summarizeRun(summary, manualQueueStats = null) {
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
  };
}

function compareSummaries(autoSummary, manualSummary, { tolerance = 1e-6 } = {}) {
  const eventDiffs = diffObjects(autoSummary.events, manualSummary.events, { tolerance });
  const eventTimelineDiffs = diffObjects(autoSummary.events?.timeline, manualSummary.events?.timeline, { tolerance });
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

  const passed =
    eventDiffs.length === 0 &&
    eventTimelineDiffs.length === 0 &&
    resourceDiffs.length === 0 &&
    autopilotDiffs.length === 0 &&
    checklistDiffs.length === 0 &&
    scoreDiffs.length === 0;

  return {
    passed,
    eventDiffs,
    eventTimelineDiffs,
    resourceDiffs,
    autopilotDiffs,
    checklistDiffs,
    scoreDiffs,
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

main().catch((error) => {
  console.error('Parity harness failed:', error);
  process.exitCode = 1;
});
