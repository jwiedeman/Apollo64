import fs from 'fs/promises';
import path from 'path';
import { parseCsv } from '../utils/csv.js';
import { parseGET } from '../utils/time.js';

export async function loadMissionData(dataDir, { logger } = {}) {
  const files = await Promise.all([
    readFile(path.resolve(dataDir, 'events.csv')),
    readFile(path.resolve(dataDir, 'checklists.csv')),
    readFile(path.resolve(dataDir, 'autopilots.csv')),
    readFile(path.resolve(dataDir, 'failures.csv')),
    readFile(path.resolve(dataDir, 'pads.csv')),
  ]);

  const [eventsContent, checklistsContent, autopilotsContent, failuresContent, padsContent] = files;

  const autopilotRecords = parseCsv(autopilotsContent);
  const autopilotEntries = await Promise.all(
    autopilotRecords.map(async (record) => {
      const script = await loadAutopilotScript(dataDir, record.script_path, logger);
      return [
        record.autopilot_id,
        {
          id: record.autopilot_id,
          description: record.description,
          scriptPath: record.script_path,
          entryConditions: record.entry_conditions,
          terminationConditions: record.termination_conditions,
          tolerances: parseOptionalJson(record.tolerances),
          script,
          durationSeconds: computeAutopilotDuration(script),
        },
      ];
    }),
  );
  const autopilots = new Map(autopilotEntries);

  const eventRecords = parseCsv(eventsContent);
  const events = eventRecords.map((record) => ({
    id: record.event_id,
    phase: record.phase,
    getOpenSeconds: parseGET(record.get_open),
    getCloseSeconds: parseGET(record.get_close),
    craft: record.craft,
    system: record.system,
    prerequisites: parseList(record.prerequisites),
    autopilotId: record.autopilot_script || null,
    checklistId: record.checklist_id || null,
    successEffects: parseOptionalJson(record.success_effects),
    failureEffects: parseOptionalJson(record.failure_effects),
    notes: record.notes ?? '',
  }));
  events.sort((a, b) => (a.getOpenSeconds ?? Infinity) - (b.getOpenSeconds ?? Infinity));

  const checklistRecords = parseCsv(checklistsContent);
  const checklists = buildChecklists(checklistRecords);
  const failures = buildLookup(parseCsv(failuresContent), 'failure_id');
  const pads = buildLookup(parseCsv(padsContent), 'pad_id');

  if (logger) {
    logger.log(0, 'Mission data loaded', {
      counts: {
        events: events.length,
        checklists: checklists.size,
        autopilots: autopilots.size,
        failures: failures.size,
        pads: pads.size,
      },
    });
  }

  return {
    events,
    checklists,
    autopilots,
    failures,
    pads,
  };
}

async function readFile(filePath) {
  return fs.readFile(filePath, 'utf8');
}

async function loadAutopilotScript(dataDir, relativePath, logger) {
  if (!relativePath) {
    return null;
  }

  const absolute = path.resolve(dataDir, relativePath);
  try {
    const content = await fs.readFile(absolute, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    if (logger) {
      logger.log(0, `Failed to load autopilot script ${relativePath}`, {
        error: error.message,
      });
    }
    return null;
  }
}

function parseOptionalJson(value) {
  if (!value) {
    return {};
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    return {};
  }
}

function parseList(value) {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function computeAutopilotDuration(script) {
  if (!script || !Array.isArray(script.sequence)) {
    return 0;
  }

  let maxTime = 0;
  for (const step of script.sequence) {
    const time = Number(step.time ?? 0);
    const duration = Number(step.duration ?? 0);
    const end = (Number.isFinite(time) ? time : 0) + (Number.isFinite(duration) ? duration : 0);
    if (end > maxTime) {
      maxTime = end;
    }
  }
  return maxTime;
}

function buildChecklists(records) {
  const map = new Map();

  for (const record of records) {
    if (!record.checklist_id) {
      continue;
    }
    if (!map.has(record.checklist_id)) {
      map.set(record.checklist_id, {
        id: record.checklist_id,
        title: record.title,
        crewRole: record.crew_role,
        nominalGetSeconds: parseGET(record.GET_nominal),
        steps: [],
      });
    }
    const checklist = map.get(record.checklist_id);
    checklist.steps.push({
      stepNumber: Number.parseInt(record.step_number, 10) || checklist.steps.length + 1,
      action: record.action,
      expectedResponse: record.expected_response,
      reference: record.reference,
    });
  }

  for (const checklist of map.values()) {
    checklist.steps.sort((a, b) => a.stepNumber - b.stepNumber);
  }

  return map;
}

function buildLookup(records, keyField) {
  const map = new Map();
  for (const record of records) {
    const key = record[keyField];
    if (!key) {
      continue;
    }
    map.set(key, record);
  }
  return map;
}
