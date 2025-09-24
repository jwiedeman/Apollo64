import { performance } from 'node:perf_hooks';
import { MissionLogger } from '../logging/missionLogger.js';
import { createSimulationContext } from '../sim/simulationContext.js';
import { formatGET, parseGET } from '../utils/time.js';
import { createClientFrame, createClientSummary } from './frameSerializer.js';

const DEFAULT_UNTIL_GET = '196:00:00';
const DEFAULT_SAMPLE_SECONDS = 60;

const SPEED_PRESETS = {
  real: {
    key: 'real',
    label: 'Real time (1×)',
    intervalMs: 1000,
    aliases: ['real', 'real-time', 'real_time', '1', '1x', '1×'],
  },
  '2x': {
    key: '2x',
    label: '2×',
    intervalMs: 500,
    aliases: ['2', '2x', '2×'],
  },
  '4x': {
    key: '4x',
    label: '4×',
    intervalMs: 250,
    aliases: ['4', '4x', '4×'],
  },
  '8x': {
    key: '8x',
    label: '8×',
    intervalMs: 125,
    aliases: ['8', '8x', '8×'],
  },
  '16x': {
    key: '16x',
    label: '16×',
    intervalMs: 62.5,
    aliases: ['16', '16x', '16×'],
  },
  fast: {
    key: 'fast',
    label: 'Fast',
    intervalMs: 0,
    aliases: ['fast', 'max', 'maxspeed', 'unlimited', 'off', '0', 'instant'],
  },
};

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
  return SPEED_PRESETS.real;
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

export async function handleSimulationStream(req, res, { searchParams } = {}) {
  const params = searchParams ?? new URLSearchParams();
  const untilParam = params.get('until');
  const sampleParam = params.get('sample');
  const historyParam = params.get('history');
  const speedParam = params.get('speed');

  const requestedUntil = untilParam ? parseGET(untilParam) : null;
  const untilSeconds = Number.isFinite(requestedUntil) ? requestedUntil : parseGET(DEFAULT_UNTIL_GET);
  const sampleSecondsRaw = sampleParam ? Number(sampleParam) : NaN;
  const sampleSeconds = Number.isFinite(sampleSecondsRaw) && sampleSecondsRaw > 0
    ? sampleSecondsRaw
    : DEFAULT_SAMPLE_SECONDS;
  const includeHistory = historyParam === '1' || historyParam === 'true';
  const speed = resolveSpeed(speedParam);
  const pacer = new FramePacer(speed.intervalMs);

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
        const shouldEmit = getSeconds - lastFrameSeconds >= sampleSeconds - 1e-6;
        if (!shouldEmit && lastFrameSeconds !== Number.NEGATIVE_INFINITY) {
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
        const waitMs = pacer.consume();
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
