import { performance } from 'node:perf_hooks';
import { MissionLogger } from '../logging/missionLogger.js';
import { createSimulationContext } from '../sim/simulationContext.js';
import { formatGET, parseGET } from '../utils/time.js';
import { createClientFrame, createClientSummary } from './frameSerializer.js';

const DEFAULT_UNTIL_GET = '196:00:00';
const DEFAULT_SPEED_KEY = 'real';

const SPEED_PRESETS = {
  real: {
    key: 'real',
    label: '1× (baseline)',
    missionRate: 1,
    sampleSeconds: 1.5,
    aliases: ['real', 'real-time', 'real_time', '1', '1x', '1×'],
  },
  '2x': {
    key: '2x',
    label: '2×',
    missionRate: 2,
    sampleSeconds: 3,
    aliases: ['2', '2x', '2×'],
  },
  '4x': {
    key: '4x',
    label: '4×',
    missionRate: 4,
    sampleSeconds: 6,
    aliases: ['4', '4x', '4×'],
  },
  '8x': {
    key: '8x',
    label: '8×',
    missionRate: 8,
    sampleSeconds: 12,
    aliases: ['8', '8x', '8×'],
  },
  '16x': {
    key: '16x',
    label: '16×',
    missionRate: 16,
    sampleSeconds: 24,
    aliases: ['16', '16x', '16×'],
  },
  fast: {
    key: 'fast',
    label: 'Fast',
    missionRate: null,
    intervalMs: 0,
    sampleSeconds: 12,
    aliases: ['fast', 'max', 'maxspeed', 'unlimited', 'off', '0', 'instant'],
  },
};

const DEFAULT_SAMPLE_SECONDS = SPEED_PRESETS[DEFAULT_SPEED_KEY].sampleSeconds;

function resolveSpeed(value) {
  if (typeof value === 'string' && value.trim().length > 0) {
    const normalized = value.trim().toLowerCase();
    for (const preset of Object.values(SPEED_PRESETS)) {
      if (preset.aliases.some((alias) => alias.toLowerCase() === normalized)) {
        return preset;
      }
    }
    if (Object.prototype.hasOwnProperty.call(SPEED_PRESETS, normalized)) {
      return SPEED_PRESETS[normalized];
    }
  }
  return SPEED_PRESETS[DEFAULT_SPEED_KEY];
}

class FramePacer {
  constructor(intervalMs) {
    this.intervalMs = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 0;
    this.nextTimestamp = null;
  }

  consume() {
    if (this.intervalMs <= 0) {
      return 0;
    }
    const now = performance.now();
    if (this.nextTimestamp == null) {
      this.nextTimestamp = now + this.intervalMs;
      return 0;
    }

    let waitMs = this.nextTimestamp - now;
    this.nextTimestamp += this.intervalMs;

    if (waitMs <= 0) {
      if (waitMs < -this.intervalMs * 4) {
        this.nextTimestamp = now + this.intervalMs;
      }
      return 0;
    }

    return waitMs;
  }
}

class MissionPacer {
  constructor(missionRate) {
    this.missionRate = Number.isFinite(missionRate) && missionRate > 0 ? missionRate : null;
    this.startGetSeconds = null;
    this.startTimestamp = null;
  }

  consume(currentGetSeconds) {
    if (!this.missionRate) {
      return 0;
    }
    const now = performance.now();
    if (!Number.isFinite(currentGetSeconds)) {
      return 0;
    }
    if (this.startGetSeconds == null || this.startTimestamp == null) {
      this.startGetSeconds = currentGetSeconds;
      this.startTimestamp = now;
      return 0;
    }

    const elapsedMissionSeconds = currentGetSeconds - this.startGetSeconds;
    if (elapsedMissionSeconds <= 0) {
      return 0;
    }

    const expectedElapsedMs = (elapsedMissionSeconds / this.missionRate) * 1000;
    const actualElapsedMs = now - this.startTimestamp;
    const waitMs = expectedElapsedMs - actualElapsedMs;
    if (waitMs <= 0) {
      return 0;
    }
    return waitMs;
  }
}

function computeFrameInterval(preset, sampleSeconds) {
  if (preset && preset.intervalMs != null && Number.isFinite(preset.intervalMs)) {
    return Math.max(0, preset.intervalMs);
  }
  const missionRate = Number.isFinite(preset?.missionRate) && preset.missionRate > 0
    ? preset.missionRate
    : null;
  if (!missionRate) {
    return 0;
  }
  if (!Number.isFinite(sampleSeconds) || sampleSeconds <= 0) {
    return 0;
  }
  const interval = (sampleSeconds / missionRate) * 1000;
  return interval > 0 ? interval : 0;
}

function resolveMissionRate(preset, sampleSeconds, frameIntervalMs) {
  if (Number.isFinite(preset?.missionRate) && preset.missionRate > 0) {
    return preset.missionRate;
  }
  if (!Number.isFinite(sampleSeconds) || sampleSeconds <= 0) {
    return null;
  }
  if (!Number.isFinite(frameIntervalMs) || frameIntervalMs <= 0) {
    return null;
  }
  return (sampleSeconds * 1000) / frameIntervalMs;
}

export async function handleSimulationStream(req, res, { searchParams } = {}) {
  const params = searchParams ?? new URLSearchParams();
  const untilParam = params.get('until');
  const sampleParam = params.get('sample');
  const historyParam = params.get('history');
  const speedParam = params.get('speed');

  const requestedUntil = untilParam ? parseGET(untilParam) : null;
  const untilSeconds = Number.isFinite(requestedUntil) ? requestedUntil : parseGET(DEFAULT_UNTIL_GET);
  const includeHistory = historyParam === '1' || historyParam === 'true';
  const speed = resolveSpeed(speedParam);
  const sampleSecondsRaw = sampleParam ? Number(sampleParam) : NaN;
  const sampleSeconds = Number.isFinite(sampleSecondsRaw) && sampleSecondsRaw > 0
    ? sampleSecondsRaw
    : Number.isFinite(speed.sampleSeconds) && speed.sampleSeconds > 0
      ? speed.sampleSeconds
      : DEFAULT_SAMPLE_SECONDS;
  const frameIntervalMs = computeFrameInterval(speed, sampleSeconds);
  const missionRate = resolveMissionRate(speed, sampleSeconds, frameIntervalMs);
  const pacer = new FramePacer(frameIntervalMs);
  const missionPacer = new MissionPacer(missionRate);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('retry: 2000\n\n');

  let aborted = false;
  req.on('close', () => {
    aborted = true;
  });

  try {
    const logger = new MissionLogger({ silent: true });
    const context = await createSimulationContext({
      logger,
      hudOptions: {
        enabled: false,
        upcomingLimit: 5,
        activeChecklistLimit: 3,
        activeAutopilotLimit: 3,
        missionLogLimit: 20,
        includeResourceHistory: includeHistory,
      },
    });

    const {
      simulation,
      uiFrameBuilder,
      audioBinder,
      audioDispatcher,
      performanceTracker,
    } = context;

    res.write(
      `event: status\ndata: ${JSON.stringify({
        state: 'running',
        untilGetSeconds: untilSeconds,
        untilGet: formatGET(untilSeconds),
        sampleSeconds,
        includeHistory,
        speed: speed.key,
        frameIntervalMs: pacer.intervalMs,
        presetSampleSeconds: speed.sampleSeconds,
        missionRate,
      })}\n\n`,
    );
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    let lastFrameSeconds = Number.NEGATIVE_INFINITY;

    const result = await simulation.runAsync({
      untilGetSeconds: untilSeconds,
      shouldAbort: () => aborted,
      onTick: (tick) => {
        if (aborted) {
          return { continue: false };
        }

        const { getSeconds } = tick;
        const missionWait = missionPacer.consume(getSeconds);

        const shouldEmit = getSeconds - lastFrameSeconds >= sampleSeconds - 1e-6;
        if (!shouldEmit && lastFrameSeconds !== Number.NEGATIVE_INFINITY) {
          if (missionWait > 0) {
            return { yield: true, sleepMs: missionWait };
          }
          return true;
        }

        const performanceSnapshot = tick.performanceTracker?.snapshot
          ? tick.performanceTracker.snapshot()
          : performanceTracker?.snapshot?.()
            ?? null;

        const frame = uiFrameBuilder.build(getSeconds, {
          scheduler: tick.scheduler,
          resourceSystem: tick.resourceSystem,
          autopilotRunner: tick.autopilotRunner,
          checklistManager: tick.checklistManager,
          manualQueue: tick.manualQueue,
          rcsController: tick.rcsController,
          agcRuntime: tick.agcRuntime,
          scoreSystem: tick.scoreSystem,
          orbit: tick.orbit,
          missionLog: tick.missionLog,
          audioBinder,
          audioBinderStats: audioBinder?.statsSnapshot?.() ?? null,
          audioDispatcher,
          audioDispatcherStats: audioDispatcher?.statsSnapshot?.() ?? null,
          docking: tick.docking?.snapshot ? tick.docking.snapshot() : null,
          panelState: tick.panelState,
          performance: performanceSnapshot,
        });

        const payload = createClientFrame(frame);
        res.write(`event: frame\ndata: ${JSON.stringify(payload)}\n\n`);
        lastFrameSeconds = getSeconds;
        const frameWait = pacer.consume();
        const waitMs = Math.max(frameWait ?? 0, missionWait ?? 0);
        if (waitMs > 0) {
          return { yield: true, sleepMs: waitMs };
        }
        return { yield: true };
      },
    });

    if (aborted) {
      res.write(`event: status\ndata: ${JSON.stringify({ state: 'aborted' })}\n\n`);
      res.end();
      return;
    }

    const lastFrame = uiFrameBuilder.getLastFrame();
    if (lastFrame) {
      res.write(`event: final-frame\ndata: ${JSON.stringify(createClientFrame(lastFrame))}\n\n`);
    }

    const summaryPayload = createClientSummary(result);
    if (summaryPayload) {
      res.write(`event: summary\ndata: ${JSON.stringify(summaryPayload)}\n\n`);
    }

    res.write(`event: complete\ndata: ${JSON.stringify({ state: 'complete' })}\n\n`);
    res.end();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Simulation failed';
    res.write(`event: error\ndata: ${JSON.stringify({ message })}\n\n`);
    res.end();
  }
}
