import { formatGET } from '../utils/time.js';
import { SimulationClock } from './simulationClock.js';

export class Simulation {
  constructor({
    scheduler,
    resourceSystem,
    checklistManager = null,
    manualActionQueue = null,
    autopilotRunner = null,
    rcsController = null,
    hud = null,
    scoreSystem = null,
    logger,
    tickRate = 20,
  }) {
    this.scheduler = scheduler;
    this.resourceSystem = resourceSystem;
    this.checklistManager = checklistManager;
    this.manualActions = manualActionQueue;
    this.autopilotRunner = autopilotRunner;
    this.rcsController = rcsController;
    this.hud = hud;
    this.scoreSystem = scoreSystem;
    this.logger = logger;
    this.clock = new SimulationClock({ tickRate });
    this.tickRate = tickRate;
  }

  run({ untilGetSeconds, onTick = null } = {}) {
    const dtSeconds = 1 / this.tickRate;
    let ticks = 0;

    while (this.clock.getCurrent() < untilGetSeconds) {
      const currentGet = this.clock.getCurrent();
      if (this.manualActions) {
        this.manualActions.update(currentGet, dtSeconds);
      }
      this.scheduler.update(currentGet, dtSeconds);
      this.resourceSystem.update(dtSeconds, currentGet);
      if (this.scoreSystem) {
        this.scoreSystem.update(currentGet, dtSeconds, {
          scheduler: this.scheduler,
          resourceSystem: this.resourceSystem,
          autopilotRunner: this.autopilotRunner,
          checklistManager: this.checklistManager,
          manualQueue: this.manualActions,
        });
      }
      if (this.hud) {
        this.hud.update(currentGet, {
          scheduler: this.scheduler,
          resourceSystem: this.resourceSystem,
          autopilotRunner: this.autopilotRunner,
          checklistManager: this.checklistManager,
          manualQueue: this.manualActions,
          rcsController: this.rcsController,
          scoreSystem: this.scoreSystem,
        });
      }
      if (typeof onTick === 'function') {
        const shouldContinue = onTick({
          getSeconds: currentGet,
          dtSeconds,
          scheduler: this.scheduler,
          resourceSystem: this.resourceSystem,
          autopilotRunner: this.autopilotRunner,
          checklistManager: this.checklistManager,
          manualQueue: this.manualActions,
          rcsController: this.rcsController,
          hud: this.hud,
          scoreSystem: this.scoreSystem,
        });
        if (shouldContinue === false) {
          break;
        }
      }
      this.clock.advance();
      ticks += 1;
    }

    const stats = this.scheduler.stats();
    const finalState = this.resourceSystem.snapshot();
    const checklistStats = this.checklistManager ? this.checklistManager.stats() : null;
    const manualStats = this.manualActions ? this.manualActions.stats() : null;
    const autopilotStats = this.autopilotRunner ? this.autopilotRunner.stats() : null;
    const rcsStats = this.rcsController ? this.rcsController.stats() : null;
    const hudStats = this.hud ? this.hud.stats() : null;
    const scoreSummary = this.scoreSystem ? this.scoreSystem.summary() : null;

    this.logger.log(this.clock.getCurrent(), `Simulation halt at GET ${formatGET(this.clock.getCurrent())}`, {
      ticks,
      events: stats.counts,
      upcoming: stats.upcoming,
      resources: finalState,
      checklists: checklistStats,
      manualActions: manualStats,
      autopilot: autopilotStats,
      rcs: rcsStats,
      hud: hudStats,
      score: scoreSummary,
    });

    return {
      ticks,
      finalGetSeconds: this.clock.getCurrent(),
      events: stats,
      resources: finalState,
      checklists: checklistStats,
      manualActions: manualStats,
      autopilot: autopilotStats,
      rcs: rcsStats,
      hud: hudStats,
      score: scoreSummary,
    };
  }
}
