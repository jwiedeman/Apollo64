import { performance } from 'node:perf_hooks';
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
    agcRuntime = null,
    hud = null,
    scoreSystem = null,
    logger,
    tickRate = 20,
    orbitPropagator = null,
    missionLogAggregator = null,
    audioBinder = null,
    audioDispatcher = null,
    docking = null,
    panelState = null,
    performanceTracker = null,
  }) {
    this.scheduler = scheduler;
    this.resourceSystem = resourceSystem;
    this.checklistManager = checklistManager;
    this.manualActions = manualActionQueue;
    this.autopilotRunner = autopilotRunner;
    this.rcsController = rcsController;
    this.agcRuntime = agcRuntime;
    this.hud = hud;
    this.scoreSystem = scoreSystem;
    this.logger = logger;
    this.orbitPropagator = orbitPropagator;
    this.clock = new SimulationClock({ tickRate });
    this.tickRate = tickRate;
    this.missionLogAggregator = missionLogAggregator;
    this.audioBinder = audioBinder ?? null;
    this.audioDispatcher = audioDispatcher ?? null;
    this.docking = docking ?? null;
    this.panelState = panelState ?? null;
    this.performanceTracker = performanceTracker ?? null;
  }

  run({ untilGetSeconds, onTick = null } = {}) {
    const dtSeconds = 1 / this.tickRate;
    let ticks = 0;

    while (this.clock.getCurrent() < untilGetSeconds) {
      const { advanced } = this.#processTick(dtSeconds, onTick);
      if (!advanced) {
        break;
      }
      ticks += 1;
    }

    return this.#collectSummary({ ticks });
  }

  async runAsync({
    untilGetSeconds,
    onTick = null,
    shouldAbort = null,
    yieldEvery = Math.max(1, Math.round(this.tickRate / 2)),
  } = {}) {
    const dtSeconds = 1 / this.tickRate;
    let ticks = 0;
    let ticksSinceYield = 0;
    const abortFn = typeof shouldAbort === 'function' ? shouldAbort : () => false;

    while (this.clock.getCurrent() < untilGetSeconds) {
      if (abortFn()) {
        break;
      }

      const { advanced, requestYield, sleepMs } = this.#processTick(dtSeconds, onTick);
      if (!advanced) {
        break;
      }

      ticks += 1;
      ticksSinceYield += 1;

      if (Number.isFinite(sleepMs) && sleepMs > 0) {
        ticksSinceYield = 0;
        await new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.round(sleepMs))));
        continue;
      }

      if (requestYield) {
        ticksSinceYield = 0;
        await new Promise((resolve) => setImmediate(resolve));
        continue;
      }

      if (ticksSinceYield >= yieldEvery) {
        ticksSinceYield = 0;
        await new Promise((resolve) => setImmediate(resolve));
      }
    }

    return this.#collectSummary({ ticks });
  }

  #processTick(dtSeconds, onTick) {
    const currentGet = this.clock.getCurrent();
    const tickStart = this.performanceTracker ? performance.now() : null;

    if (this.manualActions) {
      this.manualActions.update(currentGet, dtSeconds);
    }

    this.scheduler.update(currentGet, dtSeconds);

    if (this.orbitPropagator) {
      this.orbitPropagator.update(dtSeconds, { getSeconds: currentGet + dtSeconds });
    }

    if (this.docking) {
      this.docking.update(currentGet, { scheduler: this.scheduler });
    }

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

    if (this.audioDispatcher) {
      this.audioDispatcher.update(currentGet, { binder: this.audioBinder });
      if (this.performanceTracker && typeof this.audioDispatcher.statsSnapshot === 'function') {
        this.performanceTracker.recordAudioStats(this.audioDispatcher.statsSnapshot(), {
          getSeconds: currentGet,
        });
      }
    }

    if (this.hud) {
      this.hud.update(currentGet, {
        scheduler: this.scheduler,
        resourceSystem: this.resourceSystem,
        autopilotRunner: this.autopilotRunner,
        checklistManager: this.checklistManager,
        manualQueue: this.manualActions,
        rcsController: this.rcsController,
        agcRuntime: this.agcRuntime,
        scoreSystem: this.scoreSystem,
        orbit: this.orbitPropagator,
        missionLog: this.missionLogAggregator,
        audioBinder: this.audioBinder,
        audioDispatcher: this.audioDispatcher,
        docking: this.docking ? this.docking.snapshot() : null,
        panelState: this.panelState,
        performanceTracker: this.performanceTracker,
      });
    }

    let requestYield = false;
    let sleepMs = 0;
    if (typeof onTick === 'function') {
      const tickResult = onTick({
        getSeconds: currentGet,
        dtSeconds,
        scheduler: this.scheduler,
        resourceSystem: this.resourceSystem,
        autopilotRunner: this.autopilotRunner,
        checklistManager: this.checklistManager,
        manualQueue: this.manualActions,
        rcsController: this.rcsController,
        agcRuntime: this.agcRuntime,
        hud: this.hud,
        scoreSystem: this.scoreSystem,
        orbit: this.orbitPropagator,
        missionLog: this.missionLogAggregator,
        audioBinder: this.audioBinder,
        audioDispatcher: this.audioDispatcher,
        docking: this.docking,
        panelState: this.panelState,
        performanceTracker: this.performanceTracker,
      });

      const shouldContinue = typeof tickResult === 'object' && tickResult !== null
        ? tickResult.continue !== false
        : tickResult !== false;

      if (!shouldContinue) {
        return { advanced: false, requestYield: false };
      }

      requestYield = Boolean(
        tickResult
        && typeof tickResult === 'object'
        && tickResult.yield,
      );

      const requestedSleep = tickResult && typeof tickResult === 'object'
        ? Number(tickResult.sleepMs ?? tickResult.sleep_ms)
        : null;
      if (Number.isFinite(requestedSleep) && requestedSleep > 0) {
        sleepMs = requestedSleep;
      }
    }

    if (this.performanceTracker && tickStart != null) {
      const durationMs = performance.now() - tickStart;
      this.performanceTracker.recordTick(durationMs, { getSeconds: currentGet });
      this.performanceTracker.maybeLog(currentGet);
    }

    this.clock.advance();

    return { advanced: true, requestYield, sleepMs };
  }

  #collectSummary({ ticks }) {
    const stats = this.scheduler.stats();
    const finalState = this.resourceSystem.snapshot();
    const checklistStats = this.checklistManager ? this.checklistManager.stats() : null;
    const manualStats = this.manualActions ? this.manualActions.stats() : null;
    const autopilotStats = this.autopilotRunner ? this.autopilotRunner.stats() : null;
    const rcsStats = this.rcsController ? this.rcsController.stats() : null;
    const agcStats = this.agcRuntime && typeof this.agcRuntime.stats === 'function'
      ? this.agcRuntime.stats()
      : null;
    const hudStats = this.hud ? this.hud.stats() : null;
    const scoreSummary = this.scoreSystem ? this.scoreSystem.summary() : null;
    const orbitSummary = this.orbitPropagator ? this.orbitPropagator.summary() : null;
    const missionLogSummary = this.missionLogAggregator
      ? this.missionLogAggregator.snapshot({ limit: 10 })
      : null;
    const audioSummary = {};
    if (this.audioBinder) {
      audioSummary.binder = this.audioBinder.statsSnapshot();
    }
    if (this.audioDispatcher) {
      audioSummary.dispatcher = this.audioDispatcher.statsSnapshot();
    }
    const audioStats = Object.keys(audioSummary).length > 0 ? audioSummary : null;
    const dockingStats = this.docking ? this.docking.stats() : null;
    const panelStats = this.panelState ? this.panelState.stats() : null;

    if (this.performanceTracker) {
      this.performanceTracker.flush(this.clock.getCurrent());
    }

    this.logger.log(this.clock.getCurrent(), `Simulation halt at GET ${formatGET(this.clock.getCurrent())}`, {
      logSource: 'sim',
      logCategory: 'system',
      logSeverity: 'notice',
      ticks,
      events: stats.counts,
      upcoming: stats.upcoming,
      resources: finalState,
      checklists: checklistStats,
      manualActions: manualStats,
      autopilot: autopilotStats,
      rcs: rcsStats,
      agc: agcStats,
      hud: hudStats,
      score: scoreSummary,
      orbit: orbitSummary,
      missionLog: missionLogSummary,
      audio: audioStats,
      docking: dockingStats,
      panels: panelStats,
      performance: this.performanceTracker ? this.performanceTracker.summary() : null,
    });

    const finalMissionLogSummary = this.missionLogAggregator
      ? this.missionLogAggregator.snapshot({ limit: 10 })
      : missionLogSummary;
    const panelSnapshot = this.panelState ? this.panelState.snapshot({ includeHistory: false }) : null;

    return {
      ticks,
      finalGetSeconds: this.clock.getCurrent(),
      events: stats,
      resources: finalState,
      checklists: checklistStats,
      manualActions: manualStats,
      autopilot: autopilotStats,
      rcs: rcsStats,
      agc: agcStats,
      hud: hudStats,
      score: scoreSummary,
      orbit: orbitSummary,
      missionLog: finalMissionLogSummary,
      audio: audioStats,
      docking: dockingStats,
      panels: panelStats,
      performance: this.performanceTracker ? this.performanceTracker.summary() : null,
      panelState: panelSnapshot,
    };
  }

}
