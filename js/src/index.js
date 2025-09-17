#!/usr/bin/env node
import { DATA_DIR } from './config/paths.js';
import { loadMissionData } from './data/missionDataLoader.js';
import { MissionLogger } from './logging/missionLogger.js';
import { EventScheduler } from './sim/eventScheduler.js';
import { ResourceSystem } from './sim/resourceSystem.js';
import { Simulation } from './sim/simulation.js';
import { formatGET, parseGET } from './utils/time.js';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const logger = new MissionLogger({ silent: args.quiet });

  logger.log(0, 'Initializing mission simulation prototype', {
    dataDir: DATA_DIR,
    tickRate: args.tickRate,
  });

  const missionData = await loadMissionData(DATA_DIR, { logger });

  const resourceSystem = new ResourceSystem(logger, {
    logIntervalSeconds: args.logIntervalSeconds,
  });
  const scheduler = new EventScheduler(
    missionData.events,
    missionData.autopilots,
    resourceSystem,
    logger,
    {
      checklists: missionData.checklists,
      failures: missionData.failures,
    },
  );

  const simulation = new Simulation({
    scheduler,
    resourceSystem,
    logger,
    tickRate: args.tickRate,
  });

  const untilSeconds = args.untilSeconds ?? parseGET('015:00:00');
  logger.log(0, `Running simulation until GET ${formatGET(untilSeconds)}`);

  const summary = simulation.run({ untilGetSeconds: untilSeconds });
  printSummary(summary);
}

function parseArgs(argv) {
  const args = {
    quiet: false,
    tickRate: 20,
    logIntervalSeconds: 3600,
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
  if (summary.events.upcoming.length > 0) {
    console.log('Upcoming events:');
    for (const event of summary.events.upcoming) {
      console.log(`  • ${event.id} (${event.phase}) — ${event.status} at ${event.opensAt}`);
    }
  }
  console.log('Resource snapshot:', summary.resources);
}

main().catch((error) => {
  console.error('Simulation failed:', error);
  process.exitCode = 1;
});
