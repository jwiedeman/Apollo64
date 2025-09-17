import path from 'path';
import { DATA_DIR } from '../config/paths.js';
import { loadMissionData } from '../data/missionDataLoader.js';
import { ManualActionQueue } from './manualActionQueue.js';
import { EventScheduler } from './eventScheduler.js';
import { ChecklistManager } from './checklistManager.js';
import { ResourceSystem } from './resourceSystem.js';
import { AutopilotRunner } from './autopilotRunner.js';
import { Simulation } from './simulation.js';

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
  });

  const autopilotRunner = new AutopilotRunner(resourceSystem, logger);

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

  const scheduler = new EventScheduler(
    missionData.events,
    missionData.autopilots,
    resourceSystem,
    logger,
    {
      checklistManager,
      failures: missionData.failures,
      autopilotRunner,
    },
  );

  const simulation = new Simulation({
    scheduler,
    resourceSystem,
    checklistManager,
    manualActionQueue,
    autopilotRunner,
    logger,
    tickRate,
  });

  return {
    missionData,
    simulation,
    scheduler,
    checklistManager,
    resourceSystem,
    manualActionQueue,
    autopilotRunner,
    manualActionRecorder,
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
