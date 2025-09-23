import { MissionLogger } from '../logging/missionLogger.js';
import { createSimulationContext } from '../sim/simulationContext.js';
import { formatGET, parseGET } from '../utils/time.js';
import { createClientFrame, createClientSummary } from './frameSerializer.js';

const DEFAULT_UNTIL_GET = '015:00:00';
const DEFAULT_SAMPLE_SECONDS = 60;

export async function handleSimulationStream(req, res, { searchParams } = {}) {
  const params = searchParams ?? new URLSearchParams();
  const untilParam = params.get('until');
  const sampleParam = params.get('sample');
  const historyParam = params.get('history');

  const requestedUntil = untilParam ? parseGET(untilParam) : null;
  const untilSeconds = Number.isFinite(requestedUntil) ? requestedUntil : parseGET(DEFAULT_UNTIL_GET);
  const sampleSecondsRaw = sampleParam ? Number(sampleParam) : NaN;
  const sampleSeconds = Number.isFinite(sampleSecondsRaw) && sampleSecondsRaw > 0
    ? sampleSecondsRaw
    : DEFAULT_SAMPLE_SECONDS;
  const includeHistory = historyParam === '1' || historyParam === 'true';

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
      })}\n\n`,
    );

    let lastFrameSeconds = Number.NEGATIVE_INFINITY;

    const result = simulation.run({
      untilGetSeconds: untilSeconds,
      onTick: (tick) => {
        if (aborted) {
          return false;
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
        return true;
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
