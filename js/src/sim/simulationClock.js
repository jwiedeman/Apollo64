export class SimulationClock {
  constructor({ startGetSeconds = 0, tickRate = 20 } = {}) {
    this.currentGetSeconds = startGetSeconds;
    this.tickRate = tickRate;
    this.dtSeconds = 1 / tickRate;
  }

  advance() {
    this.currentGetSeconds += this.dtSeconds;
    return this.currentGetSeconds;
  }

  getCurrent() {
    return this.currentGetSeconds;
  }
}
