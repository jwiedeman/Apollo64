import path from 'path';
import { DATA_DIR } from '../config/paths.js';
import { DEFAULT_ORBIT_OPTIONS } from '../config/orbit.js';
import { loadMissionData } from '../data/missionDataLoader.js';
import { ManualActionQueue } from './manualActionQueue.js';
import { EventScheduler } from './eventScheduler.js';
import { ChecklistManager } from './checklistManager.js';
import { ResourceSystem } from './resourceSystem.js';
import { AutopilotRunner } from './autopilotRunner.js';
import { Simulation } from './simulation.js';
import { TextHud } from '../hud/textHud.js';
import { UiFrameBuilder } from '../hud/uiFrameBuilder.js';
import { ScoreSystem } from './scoreSystem.js';
import { RcsController } from './rcsController.js';
import { OrbitPropagator } from './orbitPropagator.js';

const DEFAULT_OPTIONS = {
  tickRate: 20,
  logIntervalSeconds: 3600,
  autoAdvanceChecklists: true,
  checklistStepSeconds: 15,
  manualActionScriptPath: null,
  manualActions: null,
  manualQueueOptions: null,
};

export async function createSimulationContext({
  dataDir = DATA_DIR,
  logger = null,
  tickRate = DEFAULT_OPTIONS.tickRate,
  logIntervalSeconds = DEFAULT_OPTIONS.logIntervalSeconds,
  autoAdvanceChecklists = DEFAULT_OPTIONS.autoAdvanceChecklists,
  checklistStepSeconds = DEFAULT_OPTIONS.checklistStepSeconds,
  manualActionScriptPath = DEFAULT_OPTIONS.manualActionScriptPath,
  manualActions = DEFAULT_OPTIONS.manualActions,
  manualActionRecorder = null,
  manualQueueOptions = DEFAULT_OPTIONS.manualQueueOptions,
  hudOptions = null,
  orbitOptions = null,
} = {}) {
  const resolvedDataDir = path.resolve(dataDir);
  const missionData = await loadMissionData(resolvedDataDir, { logger });

  const checklistManager = new ChecklistManager(missionData.checklists, logger, {
    autoAdvance: autoAdvanceChecklists,
    defaultStepDurationSeconds: checklistStepSeconds,
    manualActionRecorder,
  });

  const resourceSystem = new ResourceSystem(logger, {
    logIntervalSeconds,
    consumables: missionData.consumables,
    communicationsSchedule: missionData.communications,
    failureCatalog: missionData.failures,
  });

  const rcsController = new RcsController(missionData.thrusters, resourceSystem, logger);

  const autopilotRunner = new AutopilotRunner(resourceSystem, logger, {
    rcsController,
    manualActionRecorder,
  });

  const orbitConfig = { ...DEFAULT_ORBIT_OPTIONS, ...(orbitOptions ?? {}) };
  const orbitPropagator = new OrbitPropagator({ ...orbitConfig, logger });

  const hudConfig = { audioCues: missionData.audioCues, ...(hudOptions ?? {}) };
  const uiFrameBuilder = new UiFrameBuilder(hudConfig);
  const hud = new TextHud({
    logger,
    frameBuilder: uiFrameBuilder,
    ...hudConfig,
  });

  let manualActionQueue = null;
  if (Array.isArray(manualActions) && manualActions.length > 0) {
    manualActionQueue = new ManualActionQueue(manualActions, {
      logger,
      checklistManager,
      resourceSystem,
      options: manualQueueOptions ?? undefined,
    });
  } else if (manualActionScriptPath) {
    manualActionQueue = await ManualActionQueue.fromFile(manualActionScriptPath, {
      logger,
      checklistManager,
      resourceSystem,
      options: manualQueueOptions ?? undefined,
    });
  }

  const autopilotSummaryHandlers = [];
  if (orbitPropagator) {
    autopilotSummaryHandlers.push((event, summary) => {
      if (!summary || (summary.status && summary.status !== 'complete')) {
        return;
      }
      const deltaVMps = summary.metrics?.deltaVMps ?? summary.expected?.deltaVMps ?? null;
      if (!Number.isFinite(deltaVMps) || Math.abs(deltaVMps) <= 1e-3) {
        return;
      }
      orbitPropagator.applyDeltaV(deltaVMps, {
        frame: 'prograde',
        getSeconds: summary.completedAtSeconds ?? event?.completionTimeSeconds ?? null,
        metadata: {
          eventId: summary.eventId ?? event?.id ?? null,
          autopilotId: summary.autopilotId ?? event?.autopilotId ?? null,
          status: summary.status ?? 'complete',
        },
      });
    });
  }

  const scheduler = new EventScheduler(
    missionData.events,
    missionData.autopilots,
    resourceSystem,
    logger,
    {
      checklistManager,
      failures: missionData.failures,
      autopilotRunner,
      autopilotSummaryHandlers,
    },
  );

  const scoreSystem = new ScoreSystem({
    resourceSystem,
    scheduler,
    autopilotRunner,
    checklistManager,
    manualQueue: manualActionQueue,
  });

  const simulation = new Simulation({
    scheduler,
    resourceSystem,
    checklistManager,
    manualActionQueue,
    autopilotRunner,
    rcsController,
    hud,
    scoreSystem,
    logger,
    tickRate,
    orbitPropagator,
  });

  return {
    missionData,
    simulation,
    scheduler,
    checklistManager,
    resourceSystem,
    manualActionQueue,
    autopilotRunner,
    rcsController,
    orbitPropagator,
    hud,
    uiFrameBuilder,
    scoreSystem,
    manualActionRecorder,
    audioCues: missionData.audioCues,
    logger,
    options: {
      dataDir: resolvedDataDir,
      tickRate,
      logIntervalSeconds,
      autoAdvanceChecklists,
      checklistStepSeconds,
      manualActionScriptPath,
      manualActionsCount: Array.isArray(manualActions) ? manualActions.length : null,
    },
  };
}
