#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import process from 'process';

import { DATA_DIR } from '../config/paths.js';
import { MissionLogger } from '../logging/missionLogger.js';
import { createSimulationContext } from '../sim/simulationContext.js';
import { formatGET, parseGET } from '../utils/time.js';
import { analyzeAudioLedger } from './audioValidation.js';

const DEFAULTS = {
  untilSeconds: parseGET('015:00:00'),
  tickRate: 20,
  logIntervalSeconds: 3600,
  checklistStepSeconds: 15,
  autoChecklists: true,
  includeLedger: false,
};

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!Number.isFinite(args.untilSeconds) || args.untilSeconds <= 0) {
    throw new Error('--until requires a positive GET value (e.g., 015:00:00).');
  }

  const logger = new MissionLogger({ silent: !args.verbose });

  const context = await createSimulationContext({
    dataDir: args.dataDir,
    logger,
    tickRate: args.tickRate,
    logIntervalSeconds: args.logIntervalSeconds,
    autoAdvanceChecklists: args.autoChecklists,
    checklistStepSeconds: args.checklistStepSeconds,
    manualActionScriptPath: args.manualScriptPath,
    hudOptions: { enabled: false },
  });

  const summary = context.simulation.run({ untilGetSeconds: args.untilSeconds });
  const finalGetSeconds = summary.finalGetSeconds
    ?? context.simulation?.clock?.getCurrent?.()
    ?? args.untilSeconds;

  if (context.audioDispatcher?.stopAll) {
    context.audioDispatcher.stopAll('validation_complete', finalGetSeconds);
  }

  const ledger = context.audioDispatcher?.ledgerSnapshot?.() ?? [];
  const dispatcherStats = context.audioDispatcher?.statsSnapshot?.() ?? null;
  const severityWeights = context.audioDispatcher?.options?.severityWeights ?? null;
  const defaultBusConcurrency = context.audioDispatcher?.options?.defaultMaxConcurrent ?? 1;

  const analysis = analyzeAudioLedger(ledger, context.audioCues ?? null, {
    dispatcherStats,
    severityWeights,
    defaultBusConcurrency,
  });

  const metadata = {
    generatedAt: new Date().toISOString(),
    dataDir: context.options?.dataDir ?? args.dataDir,
    untilGet: formatGET(args.untilSeconds),
    finalGet: formatGET(finalGetSeconds),
    tickRate: args.tickRate,
    logIntervalSeconds: args.logIntervalSeconds,
    checklistStepSeconds: args.checklistStepSeconds,
    autoChecklists: args.autoChecklists,
    manualScript: args.manualScriptPath ? path.resolve(args.manualScriptPath) : null,
  };

  const report = {
    metadata,
    summary: {
      simulation: {
        ticks: summary.ticks,
        finalGetSeconds: summary.finalGetSeconds,
        events: summary.events,
        score: summary.score,
      },
      audio: {
        analysis,
        dispatcherStats,
        ledger: args.includeLedger ? ledger : undefined,
      },
    },
  };

  if (!args.quiet) {
    printSummary(analysis, {
      untilSeconds: args.untilSeconds,
      finalGetSeconds,
    });
  }

  if (args.reportPath) {
    const outputPath = path.resolve(args.reportPath);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify(report, null, args.pretty ? 2 : 0), 'utf8');
    if (!args.quiet) {
      console.log(`Wrote audio validation report to ${outputPath}`);
    }
  }

  if (!analysis.isHealthy) {
    process.exitCode = 1;
    if (!args.quiet) {
      console.error('Audio validation detected issues. See report for details.');
    }
  }
}

function parseArgs(argv) {
  const args = {
    dataDir: DATA_DIR,
    untilSeconds: DEFAULTS.untilSeconds,
    tickRate: DEFAULTS.tickRate,
    logIntervalSeconds: DEFAULTS.logIntervalSeconds,
    checklistStepSeconds: DEFAULTS.checklistStepSeconds,
    autoChecklists: DEFAULTS.autoChecklists,
    manualScriptPath: null,
    reportPath: null,
    includeLedger: DEFAULTS.includeLedger,
    pretty: false,
    quiet: false,
    verbose: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      case '--data-dir': {
        const next = argv[i + 1];
        if (!next) {
          throw new Error('--data-dir requires a path.');
        }
        args.dataDir = path.resolve(next);
        i += 1;
        break;
      }
      case '--until': {
        const next = argv[i + 1];
        if (!next) {
          throw new Error('--until requires a GET value (e.g., 015:00:00).');
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
          throw new Error('--tick-rate requires a positive number.');
        }
        args.tickRate = next;
        i += 1;
        break;
      }
      case '--log-interval': {
        const next = Number(argv[i + 1]);
        if (!Number.isFinite(next) || next <= 0) {
          throw new Error('--log-interval requires a positive number of seconds.');
        }
        args.logIntervalSeconds = next;
        i += 1;
        break;
      }
      case '--checklist-step-seconds': {
        const next = Number(argv[i + 1]);
        if (!Number.isFinite(next) || next <= 0) {
          throw new Error('--checklist-step-seconds requires a positive number.');
        }
        args.checklistStepSeconds = next;
        i += 1;
        break;
      }
      case '--manual-checklists':
        args.autoChecklists = false;
        break;
      case '--auto-checklists':
        args.autoChecklists = true;
        break;
      case '--manual-script': {
        const next = argv[i + 1];
        if (!next) {
          throw new Error('--manual-script requires a file path.');
        }
        args.manualScriptPath = next;
        i += 1;
        break;
      }
      case '--report':
      case '--output':
      case '-o': {
        const next = argv[i + 1];
        if (!next) {
          throw new Error('--report requires a file path.');
        }
        args.reportPath = next;
        i += 1;
        break;
      }
      case '--include-ledger':
        args.includeLedger = true;
        break;
      case '--pretty':
        args.pretty = true;
        break;
      case '--quiet':
        args.quiet = true;
        break;
      case '--verbose':
        args.verbose = true;
        args.quiet = false;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printSummary(analysis, { untilSeconds, finalGetSeconds }) {
  const timelineStart = analysis.timeline?.earliestStart ?? '000:00:00';
  const timelineEnd = analysis.timeline?.latestEnd ?? formatGET(finalGetSeconds);
  const ledgerCount = analysis.totals?.ledgerEntries ?? 0;
  console.log(
    `Audio validation processed ${ledgerCount} ledger entr${ledgerCount === 1 ? 'y' : 'ies'} `
      + `from GET ${timelineStart} to ${timelineEnd} (target ${formatGET(untilSeconds)}).`,
  );

  if (analysis.concurrency?.byBus?.length > 0) {
    console.log('Max concurrent playback per bus:');
    for (const bus of analysis.concurrency.byBus) {
      console.log(
        `  ${bus.busId}: observed ${bus.maxObserved} / limit ${bus.limit} `
          + `(entries ${bus.entries})`,
      );
    }
  }

  if (analysis.suppressedTriggers > 0) {
    console.warn(`Suppressed triggers: ${analysis.suppressedTriggers}`);
  }
  if (analysis.droppedTriggers > 0) {
    console.warn(`Dropped triggers: ${analysis.droppedTriggers}`);
  }

  if (analysis.concurrency?.violations?.length > 0) {
    console.warn(`Concurrency violations: ${analysis.concurrency.violations.length}`);
  }
  if (analysis.cooldownViolations?.length > 0) {
    console.warn(`Cooldown violations: ${analysis.cooldownViolations.length}`);
  }
  if (analysis.priorityMismatches?.length > 0) {
    console.warn(`Priority mismatches: ${analysis.priorityMismatches.length}`);
  }

  if (analysis.isHealthy) {
    console.log('Audio validation completed without critical issues.');
  }
}

function printHelp() {
  const lines = [
    'Usage: node ./src/tools/validateAudio.js [options]',
    '',
    'Options:',
    '  --until <GET>                Mission GET to stop the simulation (default 015:00:00)',
    '  --tick-rate <hz>             Simulation tick rate (default 20)',
    '  --log-interval <seconds>     Resource logging cadence (default 3600)',
    '  --checklist-step-seconds <s> Auto checklist step duration (default 15)',
    '  --manual-checklists          Disable auto checklist advancement during validation',
    '  --auto-checklists            Enable auto checklist advancement (default)',
    '  --manual-script <path>       Replay a manual action script while validating',
    '  --data-dir <path>            Override mission dataset directory',
    '  --report <path>              Write JSON report to the specified path',
    '  --include-ledger             Include the full audio ledger in the JSON report',
    '  --pretty                     Pretty-print JSON output',
    '  --quiet                      Suppress console output',
    '  --verbose                    Print simulation logs and summary output',
    '  --help                       Show this message',
  ];
  console.log(lines.join('\n'));
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exitCode = 1;
});

