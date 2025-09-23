import fs from 'fs/promises';
import path from 'path';
import { parseCsv } from '../utils/csv.js';
import { parseGET } from '../utils/time.js';
import { loadUiDefinitions } from './uiDefinitionLoader.js';

export async function loadMissionData(dataDir, { logger } = {}) {
  const uiDir = path.resolve(dataDir, '..', 'ui');
  const files = await Promise.all([
    readFile(path.resolve(dataDir, 'events.csv')),
    readFile(path.resolve(dataDir, 'checklists.csv')),
    readFile(path.resolve(dataDir, 'autopilots.csv')),
    readFile(path.resolve(dataDir, 'failures.csv')),
    readOptionalFile(path.resolve(dataDir, 'failure_cascades.json')),
    readFile(path.resolve(dataDir, 'pads.csv')),
    readFile(path.resolve(dataDir, 'consumables.json')),
    readFile(path.resolve(dataDir, 'thrusters.json')),
    readFile(path.resolve(dataDir, 'communications_trends.json')),
    readFile(path.resolve(dataDir, 'audio_cues.json')),
    readOptionalFile(path.resolve(uiDir, 'docking_gates.json')),
    readOptionalFile(path.resolve(uiDir, 'entry_overlay.json')),
    readOptionalFile(path.resolve(uiDir, 'dsky_macros.json')),
  ]);

  const [
    eventsContent,
    checklistsContent,
    autopilotsContent,
    failuresContent,
    failureCascadesContent,
    padsContent,
    consumablesContent,
    thrustersContent,
    communicationsContent,
    audioCueContent,
    dockingContent,
    entryOverlayContent,
    dskyMacroContent,
  ] = files;

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
          propulsion: record.propulsion ? parseOptionalJson(record.propulsion) : null,
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
    padId: record.pad_id ? record.pad_id.trim() || null : null,
    successEffects: parseOptionalJson(record.success_effects),
    failureEffects: parseOptionalJson(record.failure_effects),
    notes: record.notes ?? '',
    audioCueId: record.audio_cue ? record.audio_cue.trim() || null : null,
    audioChannel: record.audio_channel ? record.audio_channel.trim() || null : null,
  }));
  events.sort((a, b) => (a.getOpenSeconds ?? Infinity) - (b.getOpenSeconds ?? Infinity));

  const checklistRecords = parseCsv(checklistsContent);
  const checklists = buildChecklists(checklistRecords);
  const failures = buildLookup(parseCsv(failuresContent), 'failure_id', normalizeFailureRecord);
  const failureCascades = parseFailureCascades(failureCascadesContent, logger);
  const pads = parsePads(parseCsv(padsContent), logger);
  const consumables = parseConsumables(consumablesContent, logger);
  const thrusters = parseThrusters(thrustersContent, logger);
  const communications = parseCommunicationsTrends(communicationsContent, logger);
  const audioCues = parseAudioCues(audioCueContent, logger);
  const docking = parseDockingGates(dockingContent, logger);
  const entryOverlay = parseEntryOverlay(entryOverlayContent, logger);
  const dskyMacros = parseDskyMacros(dskyMacroContent, logger);
  const uiDefinitions = await loadUiDefinitions(uiDir, { logger });

  const thrusterCraftCount = Array.isArray(thrusters?.craft) ? thrusters.craft.length : 0;
  const thrusterCount = Array.isArray(thrusters?.craft)
    ? thrusters.craft.reduce((total, craft) => {
        const clusters = craft?.rcs?.clusters;
        if (!Array.isArray(clusters)) {
          return total;
        }
        return (
          total
          + clusters.reduce((clusterTotal, cluster) => {
            if (!Array.isArray(cluster?.thrusters)) {
              return clusterTotal;
            }
            return clusterTotal + cluster.thrusters.length;
          }, 0)
        );
      }, 0)
    : 0;

  if (logger) {
    logger.log(0, 'Mission data loaded', {
      logSource: 'sim',
      logCategory: 'system',
      logSeverity: 'info',
      counts: {
        events: events.length,
        checklists: checklists.size,
        autopilots: autopilots.size,
        failures: failures.size,
        failureCascades: failureCascades.size,
        pads: pads.size,
        consumables: Object.keys(consumables).length,
        thrusterCraft: thrusterCraftCount,
        thrusters: thrusterCount,
        communicationsPasses: communications.length,
        audioBuses: audioCues.buses.length,
        audioCategories: audioCues.categories.length,
        audioCues: audioCues.cues.length,
        dockingGates: Array.isArray(docking?.gates) ? docking.gates.length : 0,
        uiPanels: uiDefinitions.panels.items.length,
        uiPanelControls: uiDefinitions.panels.totalControls,
        uiChecklists: uiDefinitions.checklists.items.length,
        uiChecklistSteps: uiDefinitions.checklists.totalSteps,
        uiWorkspaces: uiDefinitions.workspaces.items.length,
        uiWorkspaceTiles: uiDefinitions.workspaces.totalTiles,
      },
    });
  }

  return {
    events,
    checklists,
    autopilots,
    failures,
    failureCascades,
    pads,
    consumables,
    thrusters,
    communications,
    audioCues,
    docking,
    entryOverlay,
    dskyMacros,
    ui: uiDefinitions,
  };
}

async function readFile(filePath) {
  return fs.readFile(filePath, 'utf8');
}

async function readOptionalFile(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
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
        logSource: 'sim',
        logCategory: 'system',
        logSeverity: 'failure',
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

function parseDockingGates(content, logger) {
  if (!content) {
    return null;
  }

  try {
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    return parsed;
  } catch (error) {
    logger?.log(0, 'Failed to parse docking_gates.json', {
      logSource: 'sim',
      logCategory: 'system',
      logSeverity: 'warning',
      error: error.message,
    });
    return null;
  }
}

function parseEntryOverlay(content, logger) {
  if (!content) {
    return null;
  }

  try {
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    return parsed;
  } catch (error) {
    logger?.log(0, 'Failed to parse entry overlay dataset', {
      logSource: 'sim',
      logCategory: 'system',
      logSeverity: 'failure',
      error: error.message,
    });
    return null;
  }
}

function parseDskyMacros(content, logger) {
  if (!content) {
    return null;
  }

  try {
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const macros = Array.isArray(parsed.macros) ? parsed.macros : [];
    const normalized = macros
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => ({
        id: typeof entry.id === 'string' ? entry.id.trim() : null,
        verb: Number.isFinite(entry.verb) ? Number(entry.verb) : null,
        noun: Number.isFinite(entry.noun) ? Number(entry.noun) : null,
        mode: typeof entry.mode === 'string' ? entry.mode.trim() : null,
        label: typeof entry.label === 'string' ? entry.label.trim() : null,
        description: typeof entry.description === 'string' ? entry.description.trim() : null,
        program: typeof entry.program === 'string' ? entry.program.trim() : null,
        registers: Array.isArray(entry.registers) ? entry.registers.map((reg) => ({ ...reg })) : [],
        requires: Array.isArray(entry.requires) ? entry.requires.map((req) => ({ ...req })) : [],
      }))
      .filter((entry) => entry.id);

    return {
      version: typeof parsed.version === 'number' ? parsed.version : null,
      description: typeof parsed.description === 'string' ? parsed.description : null,
      macros: normalized,
    };
  } catch (error) {
    logger?.log(0, 'Failed to parse DSKY macro dataset', {
      logSource: 'sim',
      logCategory: 'system',
      logSeverity: 'failure',
      error: error.message,
    });
    return null;
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
      audioCueComplete: record.audio_cue_complete ? record.audio_cue_complete.trim() || null : null,
    });
  }

  for (const checklist of map.values()) {
    checklist.steps.sort((a, b) => a.stepNumber - b.stepNumber);
  }

  return map;
}

function buildLookup(records, keyField, transform = (record) => record) {
  const map = new Map();
  for (const record of records) {
    const key = record[keyField];
    if (!key) {
      continue;
    }
    map.set(key, transform(record, key));
  }
  return map;
}

function normalizeFailureRecord(record) {
  const normalized = { ...record };
  if (typeof normalized.failure_id === 'string') {
    normalized.failure_id = normalized.failure_id.trim();
  }

  for (const field of ['audio_cue_warning', 'audio_cue_failure']) {
    if (Object.prototype.hasOwnProperty.call(normalized, field)) {
      const value = normalized[field];
      normalized[field] = typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
    }
  }

  return normalized;
}

function parseFailureCascades(content, logger) {
  if (!content) {
    return new Map();
  }

  try {
    const parsed = JSON.parse(content);
    return normalizeFailureCascades(parsed, logger);
  } catch (error) {
    logger?.log(0, 'Failed to parse failure cascades dataset', {
      logSource: 'sim',
      logCategory: 'system',
      logSeverity: 'failure',
      error: error.message,
    });
    return new Map();
  }
}

function normalizeFailureCascades(raw, logger) {
  const cascades = new Map();
  if (!raw) {
    return cascades;
  }

  if (raw instanceof Map) {
    for (const [id, entry] of raw.entries()) {
      const normalized = normalizeFailureCascadeEntry(id, entry, logger);
      if (normalized) {
        cascades.set(normalized.id, normalized);
      }
    }
    return cascades;
  }

  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const id = typeof entry?.id === 'string' ? entry.id.trim() : null;
      if (!id) {
        continue;
      }
      const normalized = normalizeFailureCascadeEntry(id, entry, logger);
      if (normalized) {
        cascades.set(normalized.id, normalized);
      }
    }
    return cascades;
  }

  if (typeof raw === 'object') {
    for (const [id, entry] of Object.entries(raw)) {
      if (!id) {
        continue;
      }
      const normalized = normalizeFailureCascadeEntry(id, entry, logger);
      if (normalized) {
        cascades.set(normalized.id, normalized);
      }
    }
  }

  return cascades;
}

function normalizeFailureCascadeEntry(idRaw, entry, logger) {
  const id = typeof idRaw === 'string' ? idRaw.trim() : null;
  if (!id) {
    return null;
  }

  if (!entry || typeof entry !== 'object') {
    return {
      id,
      resourceEffects: null,
      repeatable: false,
      applyOnce: false,
      armEvents: [],
      log: null,
      tags: [],
      notes: null,
      metadata: null,
    };
  }

  const effectSource = entry.resourceEffects ?? entry.resource_effects ?? null;
  const resourceEffects = effectSource && typeof effectSource === 'object'
    ? JSON.parse(JSON.stringify(effectSource))
    : null;

  const repeatable = entry.repeatable === true || entry.repeat === true;
  const applyOnce = entry.applyOnce === true || entry.apply_once === true;
  const armEvents = normalizeCascadeArmEntries(entry.armEvents ?? entry.arm_events ?? null, logger, id);
  const log = normalizeCascadeLog(entry.log ?? entry.logMessage ?? entry.message ?? null);
  const notesRaw = typeof entry.notes === 'string'
    ? entry.notes.trim()
    : typeof entry.note === 'string'
      ? entry.note.trim()
      : null;
  const notes = notesRaw && notesRaw.length > 0 ? notesRaw : null;
  const tagsRaw = Array.isArray(entry.tags) ? entry.tags : Array.isArray(entry.tag) ? entry.tag : null;
  const tags = Array.isArray(tagsRaw)
    ? tagsRaw
        .map((tag) => (typeof tag === 'string' ? tag.trim() : null))
        .filter((tag) => tag && tag.length > 0)
    : [];
  const metadata = entry.metadata && typeof entry.metadata === 'object'
    ? JSON.parse(JSON.stringify(entry.metadata))
    : null;

  return {
    id,
    resourceEffects,
    repeatable,
    applyOnce,
    armEvents,
    log,
    tags,
    notes,
    metadata,
  };
}

function normalizeCascadeLog(raw) {
  if (!raw) {
    return null;
  }

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      return null;
    }
    return { message: trimmed, severity: 'warning' };
  }

  if (typeof raw !== 'object') {
    return null;
  }

  const messageSource = raw.message ?? raw.text ?? raw.description ?? null;
  const message = typeof messageSource === 'string' ? messageSource.trim() : null;
  if (!message) {
    return null;
  }

  const severitySource = raw.severity ?? raw.level ?? null;
  const severity = typeof severitySource === 'string' && severitySource.trim().length > 0
    ? severitySource.trim()
    : 'warning';

  return { message, severity };
}

function normalizeCascadeArmEntries(raw, logger, failureId) {
  if (!raw) {
    return [];
  }

  const entries = Array.isArray(raw) ? raw : [raw];
  const normalized = [];

  for (const entry of entries) {
    const resolved = normalizeCascadeArmEntry(entry, logger, failureId);
    if (resolved) {
      normalized.push(resolved);
    }
  }

  return normalized;
}

function normalizeCascadeArmEntry(entry, logger, failureId) {
  if (!entry) {
    return null;
  }

  if (typeof entry === 'string') {
    const eventId = entry.trim();
    return eventId.length > 0
      ? {
          eventId,
          allowBeforeWindow: false,
          autoActivate: false,
          offsetSeconds: null,
          logMessage: null,
        }
      : null;
  }

  if (typeof entry !== 'object') {
    return null;
  }

  const eventIdSource = entry.eventId ?? entry.event_id ?? entry.id ?? entry.target ?? null;
  const eventId = typeof eventIdSource === 'string' ? eventIdSource.trim() : null;
  if (!eventId) {
    logger?.log(0, `Failure cascade ${failureId} missing target event id`, {
      logSource: 'sim',
      logCategory: 'system',
      logSeverity: 'warning',
    });
    return null;
  }

  const allowBeforeWindow = entry.allowBeforeWindow ?? entry.allow_before_window ?? entry.force ?? false;
  const autoActivate = entry.autoActivate ?? entry.auto_activate ?? false;
  const offsetSeconds = coerceNumber(
    entry.openOffsetSeconds
      ?? entry.open_offset_seconds
      ?? entry.offsetSeconds
      ?? entry.offset_seconds
      ?? entry.delaySeconds
      ?? entry.delay_seconds,
  );
  const logMessageSource = entry.logMessage ?? entry.log ?? null;
  const logMessage = typeof logMessageSource === 'string' && logMessageSource.trim().length > 0
    ? logMessageSource.trim()
    : null;

  return {
    eventId,
    allowBeforeWindow: allowBeforeWindow === true,
    autoActivate: autoActivate === true,
    offsetSeconds: Number.isFinite(offsetSeconds) ? offsetSeconds : null,
    logMessage,
  };
}

function parseConsumables(content, logger) {
  try {
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }
    return parsed;
  } catch (error) {
    logger?.log(0, 'Failed to parse consumables dataset', {
      logSource: 'sim',
      logCategory: 'system',
      logSeverity: 'failure',
      error: error.message,
    });
    return {};
  }
}

function parseThrusters(content, logger) {
  try {
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object') {
      return { craft: [] };
    }
    return parsed;
  } catch (error) {
    logger?.log(0, 'Failed to parse thrusters dataset', {
      logSource: 'sim',
      logCategory: 'system',
      logSeverity: 'failure',
      error: error.message,
    });
    return { craft: [] };
  }
}

function parseCommunicationsTrends(content, logger) {
  try {
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) {
      return [];
    }

    const schedule = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }

      const id = (entry.id ?? entry.pass_id ?? entry.comm_id ?? '').trim();
      const getOpenSeconds = parseGET(entry.get_open ?? entry.getOpen ?? entry.get_open_seconds);
      const getCloseSeconds = parseGET(entry.get_close ?? entry.getClose ?? entry.get_close_seconds);

      if (!id || !Number.isFinite(getOpenSeconds) || !Number.isFinite(getCloseSeconds)) {
        continue;
      }

      schedule.push({
        id,
        station: entry.station ?? null,
        getOpenSeconds,
        getCloseSeconds,
        getOpen: entry.get_open ?? entry.getOpen ?? null,
        getClose: entry.get_close ?? entry.getClose ?? null,
        signalStrengthDb: coerceNumber(entry.signal_strength_db ?? entry.signalStrengthDb),
        handoverMinutes: coerceNumber(entry.handover_minutes ?? entry.handoverMinutes),
        downlinkRateKbps: coerceNumber(entry.downlink_rate_kbps ?? entry.downlinkRateKbps),
        powerMarginDeltaKw: coerceNumber(entry.power_margin_delta_kw ?? entry.powerMarginDeltaKw),
        nextStation: entry.next_station ?? entry.nextStation ?? null,
        notes: entry.notes ?? null,
        source: entry.source ?? entry.source_ref ?? null,
      });
    }

    schedule.sort((a, b) => a.getOpenSeconds - b.getOpenSeconds);
    return schedule;
  } catch (error) {
    logger?.log(0, 'Failed to parse communications trends dataset', {
      logSource: 'sim',
      logCategory: 'system',
      logSeverity: 'failure',
      error: error.message,
    });
    return [];
  }
}

function parsePads(records, logger) {
  const pads = new Map();

  for (const record of records) {
    const id = record.pad_id?.trim();
    if (!id) {
      continue;
    }

    const deliveryRaw = record.GET_delivery ?? record.get_delivery ?? null;
    const deliveryGet = typeof deliveryRaw === 'string' ? deliveryRaw.trim() : null;
    const deliveryGetSeconds = deliveryGet ? parseGET(deliveryGet) : null;

    const validUntilRaw = record.valid_until ?? null;
    const validUntilGet = typeof validUntilRaw === 'string' ? validUntilRaw.trim() : null;
    const validUntilSeconds = validUntilGet ? parseGET(validUntilGet) : null;

    let rawParameters = {};
    if (record.parameters) {
      try {
        const parsed = JSON.parse(record.parameters);
        if (parsed && typeof parsed === 'object') {
          rawParameters = parsed;
        }
      } catch (error) {
        logger?.log(0, `Failed to parse PAD parameters for ${id}`, {
          logSource: 'sim',
          logCategory: 'system',
          logSeverity: 'failure',
          error: error.message,
        });
        rawParameters = {};
      }
    }

    const parameters = normalizePadParameters(rawParameters);

    pads.set(id, {
      id,
      purpose: record.purpose ?? null,
      deliveryGet,
      deliveryGetSeconds,
      validUntilGet,
      validUntilSeconds,
      source: record.source_ref ?? record.source ?? null,
      parameters,
    });
  }

  return pads;
}

export function normalizePadParameters(raw) {
  const parameters = raw && typeof raw === 'object' ? { ...raw } : {};

  const tig = parsePadTime(parameters, ['TIG', 'tig']);
  const entryInterface = parsePadTime(parameters, ['entry_interface_get', 'entryInterfaceGet']);

  const deltaVFtPerSec = coerceNumber(
    parameters.delta_v_ft_s ?? parameters.delta_v_ft ?? parameters.delta_v_ftps,
  );
  const deltaVMetersPerSecond = coerceNumber(
    parameters.delta_v_mps ?? parameters.delta_v_ms ?? parameters.delta_v_m_s,
  );
  const resolvedDeltaVMps = Number.isFinite(deltaVMetersPerSecond)
    ? deltaVMetersPerSecond
    : Number.isFinite(deltaVFtPerSec)
      ? feetPerSecondToMetersPerSecond(deltaVFtPerSec)
      : null;

  const burnDurationSeconds = coerceNumber(
    parameters.burn_duration_s ?? parameters.burn_duration_seconds ?? parameters.burn_duration,
  );

  const vInfinityFtPerSec = coerceNumber(parameters.v_infinity_ft_s ?? parameters.v_infinity_ftps);
  const vInfinityMetersPerSecond = coerceNumber(parameters.v_infinity_mps ?? parameters.v_infinity_ms);
  const resolvedVInfinityMps = Number.isFinite(vInfinityMetersPerSecond)
    ? vInfinityMetersPerSecond
    : Number.isFinite(vInfinityFtPerSec)
      ? feetPerSecondToMetersPerSecond(vInfinityFtPerSec)
      : null;

  return {
    raw: parameters,
    tig,
    entryInterface,
    deltaVFtPerSec: Number.isFinite(deltaVFtPerSec) ? deltaVFtPerSec : null,
    deltaVMetersPerSecond: Number.isFinite(resolvedDeltaVMps) ? resolvedDeltaVMps : null,
    burnDurationSeconds: Number.isFinite(burnDurationSeconds) ? burnDurationSeconds : null,
    attitude: typeof parameters.attitude === 'string' ? parameters.attitude : null,
    rangeToTargetNm: coerceNumber(parameters.range_to_target_nm ?? parameters.range_nm),
    flightPathAngleDeg: coerceNumber(
      parameters.flight_path_angle_deg ?? parameters.flightPathAngleDeg,
    ),
    vInfinityFtPerSec: Number.isFinite(vInfinityFtPerSec) ? vInfinityFtPerSec : null,
    vInfinityMetersPerSecond: Number.isFinite(resolvedVInfinityMps) ? resolvedVInfinityMps : null,
    notes: typeof parameters.notes === 'string' ? parameters.notes : null,
  };
}

function parsePadTime(parameters, keys) {
  for (const key of keys) {
    const value = parameters[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      const trimmed = value.trim();
      return { get: trimmed, getSeconds: parseGET(trimmed) };
    }
  }
  return { get: null, getSeconds: null };
}

function feetPerSecondToMetersPerSecond(value) {
  if (!Number.isFinite(value)) {
    return null;
  }
  return value * 0.3048;
}

function parseAudioCues(content, logger) {
  try {
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object') {
      return { version: null, description: '', buses: [], categories: [], cues: [] };
    }

    const { buses, categories, cues, version, description, ...rest } = parsed;
    return {
      version: typeof version === 'number' ? version : Number.isFinite(Number(version)) ? Number(version) : null,
      description: typeof description === 'string' ? description : '',
      buses: Array.isArray(buses) ? buses : [],
      categories: Array.isArray(categories) ? categories : [],
      cues: Array.isArray(cues) ? cues : [],
      ...rest,
    };
  } catch (error) {
    logger?.log(0, 'Failed to parse audio cues dataset', {
      logSource: 'sim',
      logCategory: 'system',
      logSeverity: 'failure',
      error: error.message,
    });
    return { version: null, description: '', buses: [], categories: [], cues: [] };
  }
}

function coerceNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
