import { formatGET } from '../utils/time.js';
import { SimulationClock } from './simulationClock.js';

export class Simulation {
  constructor({ scheduler, resourceSystem, logger, tickRate = 20 }) {
    this.scheduler = scheduler;
    this.resourceSystem = resourceSystem;
    this.logger = logger;
    this.clock = new SimulationClock({ tickRate });
    this.tickRate = tickRate;
  }

  run({ untilGetSeconds }) {
    const dtSeconds = 1 / this.tickRate;
    let ticks = 0;

    while (this.clock.getCurrent() < untilGetSeconds) {
      const currentGet = this.clock.getCurrent();
      this.scheduler.update(currentGet, dtSeconds);
      this.resourceSystem.update(dtSeconds, currentGet);
      this.clock.advance();
      ticks += 1;
    }

    const stats = this.scheduler.stats();
    const finalState = this.resourceSystem.snapshot();

    this.logger.log(this.clock.getCurrent(), `Simulation halt at GET ${formatGET(this.clock.getCurrent())}`, {
      ticks,
      events: stats.counts,
      upcoming: stats.upcoming,
      resources: finalState,
    });

    return {
      ticks,
      finalGetSeconds: this.clock.getCurrent(),
      events: stats,
      resources: finalState,
    };
  }
}
