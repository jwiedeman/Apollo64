#!/usr/bin/env node
import path from 'path';
import { DATA_DIR } from './config/paths.js';
import { MissionLogger } from './logging/missionLogger.js';
import { ManualActionRecorder } from './logging/manualActionRecorder.js';
import { createSimulationContext } from './sim/simulationContext.js';
import { formatGET, parseGET } from './utils/time.js';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const logger = new MissionLogger({ silent: args.quiet });

  logger.log(0, 'Initializing mission simulation prototype', {
    dataDir: DATA_DIR,
    tickRate: args.tickRate,
  });

  const manualActionRecorder = args.recordManualScriptPath ? new ManualActionRecorder() : null;

  const { simulation } = await createSimulationContext({
    dataDir: DATA_DIR,
    logger,
    tickRate: args.tickRate,
    logIntervalSeconds: args.logIntervalSeconds,
    autoAdvanceChecklists: args.autoChecklists,
    checklistStepSeconds: args.checklistStepSeconds,
    manualActionScriptPath: args.manualScriptPath,
    manualActionRecorder,
    hudOptions: {
      enabled: args.showHud && !args.quiet,
      renderIntervalSeconds: args.hudIntervalSeconds,
    },
  });

  const untilSeconds = args.untilSeconds ?? parseGET('015:00:00');
  logger.log(0, `Running simulation until GET ${formatGET(untilSeconds)}`);

  const summary = simulation.run({ untilGetSeconds: untilSeconds });
  printSummary(summary);

  if (args.logFile) {
    const logPath = path.resolve(args.logFile);
    await logger.flushToFile(logPath, { pretty: args.logPretty });
    console.log(`Mission log written to ${logPath}`);
  }

  if (manualActionRecorder && args.recordManualScriptPath) {
    const scriptPath = path.resolve(args.recordManualScriptPath);
    const result = await manualActionRecorder.writeScript(scriptPath, { pretty: true });
    if (result) {
      const { path: outPath, actions: actionCount, checklistEntries } = result;
      console.log(
        `Manual action script recorded to ${outPath} (${actionCount} actions from ${checklistEntries} checklist steps)`,
      );
    }
  }
}

function parseArgs(argv) {
  const args = {
    quiet: false,
    tickRate: 20,
    logIntervalSeconds: 3600,
    autoChecklists: true,
    checklistStepSeconds: 15,
    manualScriptPath: null,
    logFile: null,
    logPretty: false,
    recordManualScriptPath: null,
    showHud: true,
    hudIntervalSeconds: 600,
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
      case '--quiet':
        args.quiet = true;
        break;
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
      case '--manual-checklists':
        args.autoChecklists = false;
        break;
      case '--checklist-step-seconds': {
        const next = Number(argv[i + 1]);
        if (!Number.isFinite(next) || next <= 0) {
          throw new Error('--checklist-step-seconds requires a positive number');
        }
        args.checklistStepSeconds = next;
        i += 1;
        break;
      }
      case '--manual-script': {
        const next = argv[i + 1];
        if (!next) {
          throw new Error('--manual-script requires a file path');
        }
        args.manualScriptPath = next;
        i += 1;
        break;
      }
      case '--log-file': {
        const next = argv[i + 1];
        if (!next) {
          throw new Error('--log-file requires a file path');
        }
        args.logFile = next;
        i += 1;
        break;
      }
      case '--log-pretty':
        args.logPretty = true;
        break;
      case '--record-manual-script': {
        const next = argv[i + 1];
        if (!next) {
          throw new Error('--record-manual-script requires a file path');
        }
        args.recordManualScriptPath = next;
        i += 1;
        break;
      }
      case '--no-hud':
      case '--disable-hud':
        args.showHud = false;
        break;
      case '--hud-interval': {
        const next = Number(argv[i + 1]);
        if (!Number.isFinite(next) || next <= 0) {
          throw new Error('--hud-interval requires a positive number of seconds');
        }
        args.hudIntervalSeconds = next;
        i += 1;
        break;
      }
      default:
        break;
    }
  }

  return args;
}

function printSummary(summary) {
  console.log('--- Simulation Summary ---');
  console.log(`Ticks executed: ${summary.ticks}`);
  console.log(`Final GET: ${formatGET(summary.finalGetSeconds)}`);
  console.log('Event counts:', summary.events.counts);
  if (summary.events?.timeline) {
    const timelineEntries = Object.values(summary.events.timeline);
    const totalEvents = timelineEntries.length;
    const completedEvents = timelineEntries.filter((entry) => entry?.status === 'complete').length;
    console.log(`Event timeline recorded: ${completedEvents}/${totalEvents} events complete.`);
  }
  if (summary.events.upcoming.length > 0) {
    console.log('Upcoming events:');
    for (const event of summary.events.upcoming) {
      console.log(`  • ${event.id} (${event.phase}) — ${event.status} at ${event.opensAt}`);
    }
  }
  console.log('Resource snapshot:', summary.resources);
  if (summary.resources?.metrics) {
    console.log('Resource metrics:', summary.resources.metrics);
  }
  if (summary.checklists) {
    console.log('Checklist totals:', summary.checklists.totals);
    if (summary.checklists.active.length > 0) {
      console.log('Active checklists:');
      for (const entry of summary.checklists.active) {
        console.log(
          `  • ${entry.eventId} (${entry.checklistId}) — ${entry.completedSteps}/${entry.totalSteps} steps complete`,
        );
      }
    }
  }
  if (summary.manualActions) {
    console.log('Manual action stats:', summary.manualActions);
  }
  if (summary.autopilot) {
    console.log('Autopilot stats:', {
      active: summary.autopilot.active,
      started: summary.autopilot.started,
      completed: summary.autopilot.completed,
      aborted: summary.autopilot.aborted,
      totalBurnSeconds: summary.autopilot.totalBurnSeconds,
      totalUllageSeconds: summary.autopilot.totalUllageSeconds,
    });
    if (summary.autopilot.propellantKgByTank && Object.keys(summary.autopilot.propellantKgByTank).length > 0) {
      console.log('Autopilot propellant usage (kg):', summary.autopilot.propellantKgByTank);
    }
    if (summary.autopilot.activeAutopilots && summary.autopilot.activeAutopilots.length > 0) {
      console.log('Active autopilots:');
      for (const active of summary.autopilot.activeAutopilots) {
        const throttle = active.currentThrottle.toFixed(2);
        const remaining = active.remainingSeconds.toFixed(1);
        console.log(
          `  • ${active.eventId} (${active.autopilotId}) — ${active.propulsion} throttle ${throttle}; remaining ${remaining} s`,
        );
      }
    }
  }
  if (summary.hud) {
    console.log('HUD stats:', {
      enabled: summary.hud.enabled,
      renderIntervalSeconds: summary.hud.renderIntervalSeconds,
      renderCount: summary.hud.renderCount,
    });
    if (summary.hud.lastSnapshot) {
      console.log('Last HUD snapshot:', summary.hud.lastSnapshot);
    }
  }
  if (summary.score) {
    const { rating, events, resources, manual, comms } = summary.score;
    console.log('Score summary:', {
      commanderScore: rating?.commanderScore,
      baseScore: rating?.baseScore,
      manualBonus: rating?.manualBonus,
      grade: rating?.grade,
      completionRatePct: events?.completionRatePct,
      minPowerMarginPct: resources?.minPowerMarginPct,
      minDeltaVMarginMps: resources?.minDeltaVMarginMps,
      thermalViolationSeconds: resources?.thermalViolationSeconds,
      commsHitRatePct: comms?.hitRatePct,
      manualFraction: manual?.manualFraction,
    });
  }
}

main().catch((error) => {
  console.error('Simulation failed:', error);
  process.exitCode = 1;
});
