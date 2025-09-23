#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import { DATA_DIR } from './config/paths.js';
import {
  getDefaultProfilePath,
  getProfileDirectory,
  normalizeProfilePath,
} from './config/profile.js';
import { MissionLogger } from './logging/missionLogger.js';
import { ManualActionRecorder } from './logging/manualActionRecorder.js';
import { ProgressionService } from './sim/progressionService.js';
import { createSimulationContext } from './sim/simulationContext.js';
import { formatGET, parseGET } from './utils/time.js';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const logger = new MissionLogger({ silent: args.quiet });

  logger.log(0, 'Initializing mission simulation prototype', {
    logSource: 'cli',
    logCategory: 'system',
    logSeverity: 'info',
    dataDir: DATA_DIR,
    tickRate: args.tickRate,
  });

  const manualActionRecorder = args.recordManualScriptPath ? new ManualActionRecorder() : null;

  let progressionService = null;
  let profilePath = null;
  if (args.useProfile) {
    profilePath = normalizeProfilePath(args.profilePath) ?? getDefaultProfilePath();
    progressionService = new ProgressionService();
    if (!args.resetProfile) {
      try {
        await progressionService.loadFromFile(profilePath);
        if (!args.quiet) {
          console.log(`Loaded progression profile from ${profilePath}`);
        }
      } catch (error) {
        if (error && error.code !== 'ENOENT') {
          throw error;
        }
        if (!args.quiet) {
          console.log(`Starting new progression profile at ${profilePath}`);
        }
      }
    } else if (!args.quiet) {
      console.log('Resetting progression profile for this run.');
    }
  }

  const { simulation, performanceTracker } = await createSimulationContext({
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
      debug: args.hudDebug,
    },
  });

  const untilSeconds = args.untilSeconds ?? parseGET('015:00:00');
  logger.log(0, `Running simulation until GET ${formatGET(untilSeconds)}`, {
    logSource: 'cli',
    logCategory: 'system',
    logSeverity: 'notice',
  });

  const summary = simulation.run({ untilGetSeconds: untilSeconds });

  let progressionResult = null;
  if (progressionService) {
    progressionResult = progressionService.evaluateRun(summary, {
      missionId: args.missionId,
      isFullMission: args.isFullMission,
    });
    if (profilePath && args.saveProfile) {
      const profileDir = getProfileDirectory(profilePath);
      if (profileDir) {
        await fs.mkdir(profileDir, { recursive: true });
      }
      await progressionService.saveToFile(profilePath);
      if (!args.quiet) {
        console.log(`Progression profile saved to ${profilePath}`);
      }
    }
  }

  printSummary(summary, {
    progression: progressionResult,
    missionId: args.missionId,
  });

  if (args.performanceProfilePath) {
    const profilePath = path.resolve(args.performanceProfilePath);
    const profileDir = path.dirname(profilePath);
    await fs.mkdir(profileDir, { recursive: true });
    const performanceSummary = summary.performance
      ?? performanceTracker?.summary?.()
      ?? null;
    if (performanceSummary) {
      const serialized = args.performanceProfilePretty
        ? JSON.stringify(performanceSummary, null, 2)
        : JSON.stringify(performanceSummary);
      await fs.writeFile(profilePath, serialized, 'utf8');
      if (!args.quiet) {
        console.log(`Performance profile written to ${profilePath}`);
      }
    } else if (!args.quiet) {
      console.log('No performance metrics captured; skipping performance profile export.');
    }
  }

  if (args.logFile) {
    const logPath = path.resolve(args.logFile);
    await logger.flushToFile(logPath, { pretty: args.logPretty });
    console.log(`Mission log written to ${logPath}`);
  }

  if (manualActionRecorder && args.recordManualScriptPath) {
    const scriptPath = path.resolve(args.recordManualScriptPath);
    const result = await manualActionRecorder.writeScript(scriptPath, { pretty: true });
    if (result) {
      const {
        path: outPath,
        actions: actionCount,
        checklistEntries,
        workspaceEntries,
      } = result;
      console.log(
        `Manual action script recorded to ${outPath} (${actionCount} actions from ${checklistEntries} checklist steps, ${workspaceEntries} workspace events)`,
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
    hudDebug: false,
    useProfile: true,
    profilePath: null,
    resetProfile: false,
    saveProfile: true,
    missionId: 'APOLLO11',
    isFullMission: true,
    performanceProfilePath: null,
    performanceProfilePretty: false,
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
      case '--hud-debug':
        args.hudDebug = true;
        break;
      case '--profile': {
        const next = argv[i + 1];
        if (!next) {
          throw new Error('--profile requires a file path');
        }
        args.profilePath = next;
        args.useProfile = true;
        i += 1;
        break;
      }
      case '--no-profile':
      case '--disable-profile':
        args.useProfile = false;
        break;
      case '--reset-profile':
        args.resetProfile = true;
        args.useProfile = true;
        break;
      case '--no-save-profile':
        args.saveProfile = false;
        break;
      case '--mission-id':
      case '--mission': {
        const next = argv[i + 1];
        if (!next) {
          throw new Error('--mission-id requires an identifier');
        }
        args.missionId = next;
        i += 1;
        break;
      }
      case '--full-mission':
        args.isFullMission = true;
        break;
      case '--mission-segment':
      case '--partial-mission':
      case '--no-full-mission':
        args.isFullMission = false;
        break;
      case '--profile-performance': {
        const next = argv[i + 1];
        if (!next) {
          throw new Error('--profile-performance requires a file path');
        }
        args.performanceProfilePath = next;
        i += 1;
        break;
      }
      case '--profile-performance-pretty':
        args.performanceProfilePretty = true;
        break;
      default:
        break;
    }
  }

  return args;
}

function printSummary(summary, options = {}) {
  const { progression = null, missionId = null } = options;
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
  if (summary.performance) {
    const overview = summary.performance.overview ?? null;
    if (overview) {
      console.log('Performance overview:', overview);
    }
    const logging = summary.performance.logging ?? null;
    if (logging) {
      console.log('Performance logging:', logging);
    }
  }
  if (progression) {
    const missionLabel = missionId ?? 'MISSION';
    if (progression.mission) {
      const { completions, bestGrade, bestScore } = progression.mission;
      console.log('Progression mission stats:', {
        missionId: missionLabel,
        completions,
        bestGrade,
        bestScore,
      });
    }
    if (Array.isArray(progression.unlocks) && progression.unlocks.length > 0) {
      console.log('New unlocks:');
      for (const unlock of progression.unlocks) {
        const label = unlock.name ? `${unlock.id} — ${unlock.name}` : unlock.id;
        console.log(`  • ${label}`);
      }
    }
    if (Array.isArray(progression.achievements) && progression.achievements.length > 0) {
      console.log('New achievements:');
      for (const achievement of progression.achievements) {
        console.log(`  • ${achievement.id}`);
      }
    }
  }
  if (summary.missionLog) {
    const { totalCount, filteredCount, lastTimestampGet } = summary.missionLog;
    console.log('Mission log summary:', {
      totalEntries: totalCount,
      recentEntries: filteredCount,
      lastEntryGet: lastTimestampGet,
    });
  }
}

main().catch((error) => {
  console.error('Simulation failed:', error);
  process.exitCode = 1;
});
