#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import { DATA_DIR } from '../config/paths.js';
import { MissionLogger } from '../logging/missionLogger.js';
import { createSimulationContext } from '../sim/simulationContext.js';
import { formatGET, parseGET } from '../utils/time.js';

const DEFAULTS = {
  untilSeconds: parseGET('015:00:00'),
  startSeconds: 0,
  intervalSeconds: 600,
  maxFrames: Number.POSITIVE_INFINITY,
  tickRate: 20,
  logIntervalSeconds: 3600,
  checklistStepSeconds: 15,
  includeHistory: true,
  autoChecklists: true,
  outputPath: path.resolve('out/ui_frames.json'),
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!Number.isFinite(args.untilSeconds)) {
    throw new Error('A valid --until GET (e.g., 015:00:00) is required.');
  }
  if (!Number.isFinite(args.intervalSeconds) || args.intervalSeconds <= 0) {
    throw new Error('--interval requires a positive number of seconds.');
  }
  if (!Number.isFinite(args.startSeconds) || args.startSeconds < 0) {
    throw new Error('--start requires a non-negative GET value.');
  }
  if (!args.outputPath) {
    throw new Error('An --output path is required.');
  }

  const logger = new MissionLogger({ silent: args.quiet });
  const context = await createSimulationContext({
    dataDir: args.dataDir,
    logger,
    tickRate: args.tickRate,
    logIntervalSeconds: args.logIntervalSeconds,
    autoAdvanceChecklists: args.autoChecklists,
    checklistStepSeconds: args.checklistStepSeconds,
    manualActionScriptPath: args.manualScriptPath,
    hudOptions: { enabled: false, includeResourceHistory: args.includeHistory },
  });

  const frames = [];
  const {
    uiFrameBuilder,
    simulation,
    scoreSystem: contextScoreSystem,
    orbitPropagator,
    missionLogAggregator,
  } = context;
  const startSeconds = Math.max(0, args.startSeconds);
  const intervalSeconds = args.intervalSeconds;
  let nextSampleSeconds = startSeconds;
  let haltReason = 'until_reached';
  const eps = 1e-6;

  const onTick = ({
    getSeconds,
    scheduler,
    resourceSystem,
    autopilotRunner,
    checklistManager,
    manualQueue,
    rcsController,
    scoreSystem: tickScoreSystem,
  }) => {
    if (getSeconds + eps < startSeconds) {
      return true;
    }

    let captured = false;
    while (getSeconds + eps >= nextSampleSeconds) {
      const frame = uiFrameBuilder.build(getSeconds, {
        scheduler,
        resourceSystem,
        autopilotRunner,
        checklistManager,
        manualQueue,
        rcsController,
        scoreSystem: tickScoreSystem,
        orbit: orbitPropagator,
        missionLog: missionLogAggregator,
      });
      frames.push(frame);
      captured = true;
      nextSampleSeconds += intervalSeconds;
      if (frames.length >= args.maxFrames) {
        haltReason = 'max_frames_reached';
        return false;
      }
      if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
        break;
      }
    }

    if (!captured && args.captureOnChanges) {
      const frame = uiFrameBuilder.build(getSeconds, {
        scheduler,
        resourceSystem,
        autopilotRunner,
        checklistManager,
        manualQueue,
        rcsController,
        scoreSystem: tickScoreSystem,
        orbit: orbitPropagator,
        missionLog: missionLogAggregator,
      });
      frames.push(frame);
      if (frames.length >= args.maxFrames) {
        haltReason = 'max_frames_reached';
        return false;
      }
    }

    return true;
  };

  const summary = simulation.run({ untilGetSeconds: args.untilSeconds, onTick });

  const finalGetSeconds = summary.finalGetSeconds ?? simulation.clock?.getCurrent?.() ?? args.untilSeconds;
  const lastFrameSeconds = frames.length > 0 ? frames[frames.length - 1].generatedAtSeconds : null;
  if (lastFrameSeconds == null || lastFrameSeconds + eps < finalGetSeconds) {
    const finalFrame = uiFrameBuilder.build(finalGetSeconds, {
      scheduler: context.scheduler,
      resourceSystem: context.resourceSystem,
      autopilotRunner: context.autopilotRunner,
      checklistManager: context.checklistManager,
      manualQueue: context.manualActionQueue,
      rcsController: context.rcsController,
      scoreSystem: contextScoreSystem,
      scoreSummary: summary.score ?? null,
      orbit: orbitPropagator,
      missionLog: missionLogAggregator,
    });
    frames.push(finalFrame);
  }

  const metadata = {
    generatedAt: new Date().toISOString(),
    dataDir: context.options?.dataDir ?? args.dataDir,
    startGet: formatGET(startSeconds),
    endGet: formatGET(finalGetSeconds),
    untilGet: formatGET(args.untilSeconds),
    intervalSeconds,
    frameCount: frames.length,
    includeResourceHistory: args.includeHistory,
    tickRate: args.tickRate,
    logIntervalSeconds: args.logIntervalSeconds,
    checklistStepSeconds: args.checklistStepSeconds,
    autoChecklists: args.autoChecklists,
    manualScript: args.manualScriptPath ? path.resolve(args.manualScriptPath) : null,
    haltReason,
  };

  const output = {
    metadata,
    summary: {
      ticks: summary.ticks,
      finalGetSeconds: summary.finalGetSeconds,
      events: summary.events,
      score: summary.score,
    },
    frames,
    missionLog: missionLogAggregator?.snapshot?.({ limit: null }) ?? null,
  };

  const outPath = path.resolve(args.outputPath);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(output, null, args.pretty ? 2 : 0));

  if (!args.quiet) {
    console.log(
      `Exported ${frames.length} frame(s) from GET ${formatGET(startSeconds)} to ${formatGET(finalGetSeconds)} → ${outPath}`,
    );
  }
}

function parseArgs(argv) {
  const args = {
    dataDir: DATA_DIR,
    untilSeconds: DEFAULTS.untilSeconds,
    startSeconds: DEFAULTS.startSeconds,
    intervalSeconds: DEFAULTS.intervalSeconds,
    maxFrames: DEFAULTS.maxFrames,
    tickRate: DEFAULTS.tickRate,
    logIntervalSeconds: DEFAULTS.logIntervalSeconds,
    checklistStepSeconds: DEFAULTS.checklistStepSeconds,
    includeHistory: DEFAULTS.includeHistory,
    autoChecklists: DEFAULTS.autoChecklists,
    manualScriptPath: null,
    outputPath: DEFAULTS.outputPath,
    quiet: false,
    pretty: false,
    captureOnChanges: false,
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
        if (parsed == null) {
          throw new Error(`Invalid GET for --until: ${next}`);
        }
        args.untilSeconds = parsed;
        i += 1;
        break;
      }
      case '--start':
      case '--from':
      case '--start-get': {
        const next = argv[i + 1];
        if (!next) {
          throw new Error('--start requires a GET value (e.g., 002:00:00).');
        }
        const parsed = parseGET(next);
        if (parsed == null) {
          throw new Error(`Invalid GET for --start: ${next}`);
        }
        args.startSeconds = parsed;
        i += 1;
        break;
      }
      case '--interval': {
        const next = Number(argv[i + 1]);
        if (!Number.isFinite(next) || next <= 0) {
          throw new Error('--interval requires a positive number of seconds.');
        }
        args.intervalSeconds = next;
        i += 1;
        break;
      }
      case '--max-frames': {
        const next = Number(argv[i + 1]);
        if (!Number.isFinite(next) || next <= 0) {
          throw new Error('--max-frames requires a positive number.');
        }
        args.maxFrames = next;
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
      case '--no-history':
        args.includeHistory = false;
        break;
      case '--include-history':
        args.includeHistory = true;
        break;
      case '--capture-on-changes':
        args.captureOnChanges = true;
        break;
      case '--quiet':
        args.quiet = true;
        break;
      case '--pretty':
        args.pretty = true;
        break;
      case '--output':
      case '-o': {
        const next = argv[i + 1];
        if (!next) {
          throw new Error('--output requires a file path.');
        }
        args.outputPath = next;
        i += 1;
        break;
      }
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printHelp() {
  const lines = [
    'Usage: node ./src/tools/exportUiFrames.js [options]',
    '',
    'Options:',
    '  --until <GET>                Mission GET to stop the simulation (default 015:00:00)',
    '  --start <GET>                GET to begin capturing frames (default 000:00:00)',
    '  --interval <seconds>         Interval between captured frames (default 600)',
    '  --max-frames <count>         Maximum number of frames to capture',
    '  --capture-on-changes         Capture a frame every tick after the start GET (in addition to interval sampling)',
    '  --output <path>              Output JSON path (default out/ui_frames.json)',
    '  --include-history            Embed resource history buffers in each frame (default on)',
    '  --no-history                 Disable resource history capture',
    '  --manual-checklists          Disable auto checklist advancement during export',
    '  --manual-script <path>       Replay a manual action script while exporting',
    '  --tick-rate <hz>             Simulation tick rate (default 20)',
    '  --log-interval <seconds>     Resource logging cadence (default 3600)',
    '  --checklist-step-seconds <s> Auto checklist step duration (default 15)',
    '  --data-dir <path>            Override mission dataset directory',
    '  --pretty                     Pretty-print JSON output',
    '  --quiet                      Suppress console output',
    '  --help                       Show this message',
  ];
  console.log(lines.join('\n'));
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exitCode = 1;
});

