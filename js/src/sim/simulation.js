import { formatGET } from '../utils/time.js';
import { SimulationClock } from './simulationClock.js';

export class Simulation {
  constructor({
    scheduler,
    resourceSystem,
    checklistManager = null,
    manualActionQueue = null,
    autopilotRunner = null,
    logger,
    tickRate = 20,
  }) {
    this.scheduler = scheduler;
    this.resourceSystem = resourceSystem;
    this.checklistManager = checklistManager;
    this.manualActions = manualActionQueue;
    this.autopilotRunner = autopilotRunner;
    this.logger = logger;
    this.clock = new SimulationClock({ tickRate });
    this.tickRate = tickRate;
  }

  run({ untilGetSeconds }) {
    const dtSeconds = 1 / this.tickRate;
    let ticks = 0;

    while (this.clock.getCurrent() < untilGetSeconds) {
      const currentGet = this.clock.getCurrent();
      if (this.manualActions) {
        this.manualActions.update(currentGet, dtSeconds);
      }
      this.scheduler.update(currentGet, dtSeconds);
      this.resourceSystem.update(dtSeconds, currentGet);
      this.clock.advance();
      ticks += 1;
    }

    const stats = this.scheduler.stats();
    const finalState = this.resourceSystem.snapshot();
    const checklistStats = this.checklistManager ? this.checklistManager.stats() : null;
    const manualStats = this.manualActions ? this.manualActions.stats() : null;
    const autopilotStats = this.autopilotRunner ? this.autopilotRunner.stats() : null;

    this.logger.log(this.clock.getCurrent(), `Simulation halt at GET ${formatGET(this.clock.getCurrent())}`, {
      ticks,
      events: stats.counts,
      upcoming: stats.upcoming,
      resources: finalState,
      checklists: checklistStats,
      manualActions: manualStats,
      autopilot: autopilotStats,
    });

    return {
      ticks,
      finalGetSeconds: this.clock.getCurrent(),
      events: stats,
      resources: finalState,
      checklists: checklistStats,
      manualActions: manualStats,
      autopilot: autopilotStats,
    };
  }
}
