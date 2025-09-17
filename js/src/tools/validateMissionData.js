#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import process from 'process';
import { DATA_DIR } from '../config/paths.js';
import { parseCsv } from '../utils/csv.js';
import { formatGET, parseGET } from '../utils/time.js';

async function main() {
  const context = createContext();

  const autopilotRecords = await readCsvFile('autopilots.csv', context);
  const autopilotMap = await validateAutopilots(autopilotRecords, context);

  const failureRecords = await readCsvFile('failures.csv', context);
  const failureMap = validateFailures(failureRecords, context);

  const checklistRecords = await readCsvFile('checklists.csv', context);
  const checklistMap = validateChecklists(checklistRecords, context);

  const padRecords = await readCsvFile('pads.csv', context);
  validatePads(padRecords, context);

  const eventRecords = await readCsvFile('events.csv', context);
  validateEvents(eventRecords, { autopilotMap, checklistMap, failureMap, context });

  await validateConsumables(context);
  await validateCommunicationsTrends(context);

  printSummary(context);

  if (context.errors.length > 0) {
    process.exitCode = 1;
  }
}

function createContext() {
  return {
    errors: [],
    warnings: [],
    stats: {},
    refs: {},
  };
}

async function readCsvFile(relativePath, context) {
  const absolutePath = path.resolve(DATA_DIR, relativePath);
  try {
    const content = await fs.readFile(absolutePath, 'utf8');
    return parseCsv(content);
  } catch (error) {
    addError(context, `Failed to read ${relativePath}: ${error.message}`);
    return [];
  }
}

async function validateAutopilots(records, context) {
  const autopilots = new Map();
  for (const record of records) {
    const id = record.autopilot_id?.trim();
    if (!id) {
      addError(context, 'Autopilot entry missing autopilot_id');
      continue;
    }

    if (autopilots.has(id)) {
      addError(context, `Duplicate autopilot_id detected: ${id}`);
      continue;
    }

    const scriptPath = record.script_path?.trim();
    if (!scriptPath) {
      addWarning(context, `Autopilot ${id} is missing a script_path`);
    } else {
      const absoluteScriptPath = path.resolve(DATA_DIR, scriptPath);
      try {
        const content = await fs.readFile(absoluteScriptPath, 'utf8');
        const script = JSON.parse(content);
        if (!Array.isArray(script.sequence) || script.sequence.length === 0) {
          addError(context, `Autopilot ${id} script ${scriptPath} is missing a sequence definition`);
        }
        if (typeof script.dt !== 'number' || !Number.isFinite(script.dt) || script.dt <= 0) {
          addWarning(context, `Autopilot ${id} script ${scriptPath} has an invalid dt value`);
        }
        validateAutopilotSequence(script.sequence, id, context);
      } catch (error) {
        addError(context, `Autopilot ${id} failed to load script ${scriptPath}: ${error.message}`);
      }
    }

    if (record.tolerances) {
      parseJsonField(record.tolerances, `Autopilot ${id} tolerances`, context);
    }

    if (record.propulsion) {
      const propulsion = parseJsonField(record.propulsion, `Autopilot ${id} propulsion`, context);
      if (propulsion && typeof propulsion === 'object') {
        if (propulsion.type != null && typeof propulsion.type !== 'string') {
          addWarning(context, `Autopilot ${id} propulsion type should be a string`);
        }

        if (propulsion.tank != null && typeof propulsion.tank !== 'string') {
          addWarning(context, `Autopilot ${id} propulsion tank should be a string`);
        }
        if (propulsion.tank_key != null && typeof propulsion.tank_key !== 'string') {
          addWarning(context, `Autopilot ${id} propulsion tank_key should be a string`);
        }

        const massFlowKgRaw = propulsion.mass_flow_kg_per_s ?? propulsion.massFlowKgPerSec;
        if (massFlowKgRaw != null && !isFiniteNumber(massFlowKgRaw)) {
          addError(context, `Autopilot ${id} propulsion mass_flow_kg_per_s is not numeric`);
        }
        const massFlowLbRaw = propulsion.mass_flow_lb_per_s ?? propulsion.massFlowLbPerSec;
        if (massFlowLbRaw != null && !isFiniteNumber(massFlowLbRaw)) {
          addError(context, `Autopilot ${id} propulsion mass_flow_lb_per_s is not numeric`);
        }

        if (!propulsion.tank && !propulsion.tank_key && (massFlowKgRaw != null || massFlowLbRaw != null)) {
          addWarning(context, `Autopilot ${id} propulsion defines mass flow without a tank identifier`);
        }

        if (propulsion.ullage != null) {
          if (typeof propulsion.ullage !== 'object') {
            addError(context, `Autopilot ${id} propulsion ullage must be an object`);
          } else {
            const ullageTank = propulsion.ullage.tank ?? propulsion.ullage.tank_key ?? propulsion.ullage.propellant;
            if (ullageTank != null && typeof ullageTank !== 'string') {
              addWarning(context, `Autopilot ${id} propulsion ullage tank should be a string`);
            }
            const ullageKgRaw = propulsion.ullage.mass_flow_kg_per_s ?? propulsion.ullage.massFlowKgPerSec;
            if (ullageKgRaw != null && !isFiniteNumber(ullageKgRaw)) {
              addError(context, `Autopilot ${id} propulsion ullage mass_flow_kg_per_s is not numeric`);
            }
            const ullageLbRaw = propulsion.ullage.mass_flow_lb_per_s ?? propulsion.ullage.massFlowLbPerSec;
            if (ullageLbRaw != null && !isFiniteNumber(ullageLbRaw)) {
              addError(context, `Autopilot ${id} propulsion ullage mass_flow_lb_per_s is not numeric`);
            }
          }
        }
      }
    }

    autopilots.set(id, record);
  }

  context.stats.autopilots = autopilots.size;
  return autopilots;
}

function validateAutopilotSequence(sequence, autopilotId, context) {
  let maxEndTime = 0;
  for (const [index, step] of sequence.entries()) {
    const stepLabel = `Autopilot ${autopilotId} step ${index}`;
    if (typeof step !== 'object' || step === null) {
      addError(context, `${stepLabel} is not a valid object`);
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(step, 'time')) {
      addWarning(context, `${stepLabel} is missing a time field`);
    }
    const time = Number(step.time ?? 0);
    if (!Number.isFinite(time) || time < 0) {
      addError(context, `${stepLabel} has an invalid time value`);
    }
    const duration = Number(step.duration ?? 0);
    if (step.duration != null && (!Number.isFinite(duration) || duration < 0)) {
      addError(context, `${stepLabel} has an invalid duration`);
    }
    const endTime = time + Math.max(0, duration);
    if (endTime < maxEndTime) {
      addWarning(
        context,
        `Autopilot ${autopilotId} step ${index} ends at ${endTime}s before previous end ${maxEndTime}s — verify sequencing order`,
      );
    }
    if (endTime > maxEndTime) {
      maxEndTime = endTime;
    }
  }
}

function validateFailures(records, context) {
  const failures = new Map();
  const validClasses = new Set(['Recoverable', 'Hard', 'Technical']);

  for (const record of records) {
    const id = record.failure_id?.trim();
    if (!id) {
      addError(context, 'Failure entry missing failure_id');
      continue;
    }
    if (failures.has(id)) {
      addError(context, `Duplicate failure_id detected: ${id}`);
      continue;
    }

    const classification = record.classification?.trim();
    if (!validClasses.has(classification)) {
      addWarning(context, `Failure ${id} has unexpected classification: ${classification || 'undefined'}`);
    }

    if (!record.trigger) {
      addWarning(context, `Failure ${id} is missing a trigger description`);
    }
    if (!record.immediate_effect) {
      addWarning(context, `Failure ${id} is missing an immediate_effect description`);
    }
    if (!record.recovery_actions) {
      addWarning(context, `Failure ${id} is missing recovery_actions guidance`);
    }

    failures.set(id, record);
  }

  context.stats.failures = failures.size;
  return failures;
}

function validateChecklists(records, context) {
  const checklists = new Map();

  for (const record of records) {
    const id = record.checklist_id?.trim();
    if (!id) {
      addError(context, 'Checklist row missing checklist_id');
      continue;
    }

    if (!checklists.has(id)) {
      const nominalGet = record.GET_nominal?.trim();
      const parsedGet = nominalGet ? parseGET(nominalGet) : null;
      if (nominalGet && parsedGet == null) {
        addError(context, `Checklist ${id} has invalid GET_nominal value: ${nominalGet}`);
      }
      checklists.set(id, {
        id,
        title: record.title?.trim() || '',
        crewRole: record.crew_role?.trim() || '',
        nominalGetSeconds: parsedGet,
        steps: new Map(),
      });
    }

    const checklist = checklists.get(id);
    const stepNumberRaw = record.step_number?.trim();
    const stepNumber = Number.parseInt(stepNumberRaw, 10);
    if (!Number.isFinite(stepNumber) || stepNumber <= 0) {
      addError(context, `Checklist ${id} has invalid step_number: ${stepNumberRaw}`);
    } else if (checklist.steps.has(stepNumber)) {
      addError(context, `Checklist ${id} has duplicate step_number ${stepNumber}`);
    } else {
      checklist.steps.set(stepNumber, {
        action: record.action?.trim() || '',
        expectedResponse: record.expected_response?.trim() || '',
        reference: record.reference?.trim() || '',
      });
    }
  }

  for (const checklist of checklists.values()) {
    const stepNumbers = [...checklist.steps.keys()].sort((a, b) => a - b);
    for (let i = 0; i < stepNumbers.length; i += 1) {
      const expected = i + 1;
      const actual = stepNumbers[i];
      if (actual !== expected) {
        addWarning(
          context,
          `Checklist ${checklist.id} step numbering is non-sequential at step ${actual}; expected ${expected}`,
        );
        break;
      }
    }
  }

  context.stats.checklists = checklists.size;
  return checklists;
}

function validatePads(records, context) {
  const pads = new Map();

  for (const record of records) {
    const id = record.pad_id?.trim();
    if (!id) {
      addError(context, 'PAD entry missing pad_id');
      continue;
    }
    if (pads.has(id)) {
      addError(context, `Duplicate PAD id detected: ${id}`);
      continue;
    }

    const delivery = record.GET_delivery?.trim();
    const deliverySeconds = delivery ? parseGET(delivery) : null;
    if (delivery && deliverySeconds == null) {
      addError(context, `PAD ${id} has invalid GET_delivery value: ${delivery}`);
    }

    const validUntil = record.valid_until?.trim();
    const validUntilSeconds = validUntil ? parseGET(validUntil) : null;
    if (validUntil && validUntilSeconds == null) {
      addError(context, `PAD ${id} has invalid valid_until value: ${validUntil}`);
    }
    if (
      deliverySeconds != null &&
      validUntilSeconds != null &&
      validUntilSeconds <= deliverySeconds
    ) {
      addWarning(
        context,
        `PAD ${id} valid_until (${formatGET(validUntilSeconds)}) is not after GET_delivery (${formatGET(deliverySeconds)})`,
      );
    }

    if (record.parameters) {
      const parameters = parseJsonField(record.parameters, `PAD ${id} parameters`, context);
      if (parameters && typeof parameters === 'object') {
        for (const [key, value] of Object.entries(parameters)) {
          if (typeof value === 'string' && /GET$/i.test(key)) {
            if (parseGET(value) == null) {
              addWarning(context, `PAD ${id} parameter ${key} has invalid GET value: ${value}`);
            }
          }
        }
      }
    }

    pads.set(id, record);
  }

  context.stats.pads = pads.size;
  return pads;
}

function validateEvents(records, { autopilotMap, checklistMap, failureMap, context }) {
  const events = new Map();
  const phaseOpenTimes = new Map();

  for (const record of records) {
    const id = record.event_id?.trim();
    if (!id) {
      addError(context, 'Event row missing event_id');
      continue;
    }
    if (events.has(id)) {
      addError(context, `Duplicate event_id detected: ${id}`);
      continue;
    }

    const phase = record.phase?.trim();
    if (!phase) {
      addError(context, `Event ${id} is missing a phase designation`);
    }

    const openValue = record.get_open?.trim();
    const closeValue = record.get_close?.trim();
    const openSeconds = openValue ? parseGET(openValue) : null;
    if (openValue && openSeconds == null) {
      addError(context, `Event ${id} has invalid get_open value: ${openValue}`);
    }
    const closeSeconds = closeValue ? parseGET(closeValue) : null;
    if (closeValue && closeSeconds == null) {
      addError(context, `Event ${id} has invalid get_close value: ${closeValue}`);
    }
    if (openSeconds != null && closeSeconds != null && closeSeconds < openSeconds) {
      addError(
        context,
        `Event ${id} closes (${formatGET(closeSeconds)}) before it opens (${formatGET(openSeconds)})`,
      );
    }
    if (openSeconds == null && closeSeconds == null) {
      addWarning(context, `Event ${id} is missing both get_open and get_close values`);
    }

    if (phase && openSeconds != null) {
      const lastOpenSeconds = phaseOpenTimes.get(phase);
      if (lastOpenSeconds != null && openSeconds < lastOpenSeconds) {
        addWarning(
          context,
          `Event ${id} open time ${formatGET(openSeconds)} precedes earlier ${phase} event at ${formatGET(lastOpenSeconds)}`,
        );
      }
      if (lastOpenSeconds == null || openSeconds > lastOpenSeconds) {
        phaseOpenTimes.set(phase, openSeconds);
      }
    }

    const craft = record.craft?.trim();
    if (!craft) {
      addWarning(context, `Event ${id} is missing craft assignment`);
    }

    if (record.autopilot_script) {
      const autopilotId = record.autopilot_script.trim();
      if (!autopilotMap.has(autopilotId)) {
        addError(context, `Event ${id} references unknown autopilot_script ${autopilotId}`);
      }
    }

    if (record.checklist_id) {
      const checklistId = record.checklist_id.trim();
      if (!checklistMap.has(checklistId)) {
        addError(context, `Event ${id} references unknown checklist_id ${checklistId}`);
      }
    }

    const successEffects = parseJsonField(record.success_effects, `Event ${id} success_effects`, context);
    validateEffectPayload(successEffects, context, `Event ${id} success_effects`);

    const failureEffects = parseJsonField(record.failure_effects, `Event ${id} failure_effects`, context);
    const failureIds = extractFailureIds(failureEffects);
    for (const failureId of failureIds) {
      if (!failureMap.has(failureId)) {
        addError(context, `Event ${id} references unknown failure_id ${failureId}`);
      }
    }
    validateEffectPayload(failureEffects, context, `Event ${id} failure_effects`);

    events.set(id, {
      id,
      phase,
      openSeconds,
      closeSeconds,
      prerequisitesRaw: record.prerequisites || '',
    });
  }

  for (const event of events.values()) {
    const prerequisites = parseList(event.prerequisitesRaw);
    for (const prereqId of prerequisites) {
      if (!events.has(prereqId)) {
        addError(context, `Event ${event.id} lists unknown prerequisite ${prereqId}`);
        continue;
      }

      if (prereqId === event.id) {
        addError(context, `Event ${event.id} references itself as a prerequisite`);
        continue;
      }

      const prereq = events.get(prereqId);
      if (
        prereq?.openSeconds != null &&
        event.openSeconds != null &&
        event.openSeconds < prereq.openSeconds
      ) {
        addWarning(
          context,
          `Event ${event.id} opens at ${formatGET(event.openSeconds)} before prerequisite ${prereqId} opens at ${formatGET(
            prereq.openSeconds,
          )}`,
        );
      }
    }
  }

  context.stats.events = events.size;
  return events;
}

async function validateConsumables(context) {
  const filePath = path.resolve(DATA_DIR, 'consumables.json');
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const data = JSON.parse(content);
    if (!data || typeof data !== 'object') {
      addError(context, 'Consumables dataset is not a valid JSON object');
      return;
    }

    const numericFields = [
      'power.fuel_cells.reactant_minutes',
      'power.fuel_cells.output_kw',
      'power.fuel_cells.baseline_load_kw',
      'power.fuel_cells.surge_capacity_kw',
      'power.batteries.capacity_ah',
      'power.batteries.initial_soc_pct',
      'propellant.csm_sps.initial_kg',
      'propellant.csm_sps.reserve_kg',
      'propellant.csm_sps.usable_delta_v_mps',
      'propellant.csm_rcs.initial_kg',
      'propellant.lm_descent.initial_kg',
      'propellant.lm_ascent.initial_kg',
      'propellant.lm_rcs.initial_kg',
      'life_support.oxygen.initial_kg',
      'life_support.water.initial_kg',
      'life_support.lithium_hydroxide.canisters',
    ];

    for (const pathSpec of numericFields) {
      const value = getNestedValue(data, pathSpec);
      if (!Number.isFinite(value)) {
        addWarning(context, `Consumables field ${pathSpec} is missing or not numeric`);
      }
    }

    const shiftHours = getNestedValue(data, 'communications.dsn_shift_hours');
    if (!Array.isArray(shiftHours) || shiftHours.some((value) => !Number.isFinite(value))) {
      addWarning(context, 'Consumables communications.dsn_shift_hours should be an array of numbers');
    }

    const nextWindow = getNestedValue(data, 'communications.next_window_open_get');
    if (nextWindow && parseGET(nextWindow) == null) {
      addWarning(context, `Consumables communications.next_window_open_get has invalid GET value: ${nextWindow}`);
    }

    context.stats.consumablesSections = Object.keys(data).length;
  } catch (error) {
    addError(context, `Failed to read consumables.json: ${error.message}`);
  }
}

async function validateCommunicationsTrends(context) {
  const filePath = path.resolve(DATA_DIR, 'communications_trends.json');
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const data = JSON.parse(content);
    if (!Array.isArray(data)) {
      addError(context, 'Communications trends dataset must be an array');
      return;
    }

    const ids = new Set();
    for (const [index, entry] of data.entries()) {
      const label = `communications_trends[${index}]`;
      if (!entry || typeof entry !== 'object') {
        addError(context, `${label} is not an object`);
        continue;
      }

      const id = typeof entry.id === 'string' ? entry.id.trim() : '';
      if (!id) {
        addError(context, `${label} is missing an id field`);
      } else if (ids.has(id)) {
        addError(context, `${label} has duplicate id ${id}`);
      } else {
        ids.add(id);
      }

      const openGet = typeof entry.get_open === 'string' ? entry.get_open.trim() : '';
      const closeGet = typeof entry.get_close === 'string' ? entry.get_close.trim() : '';
      const openSeconds = openGet ? parseGET(openGet) : null;
      const closeSeconds = closeGet ? parseGET(closeGet) : null;
      if (openGet && openSeconds == null) {
        addWarning(context, `${label} has invalid get_open value: ${openGet}`);
      }
      if (closeGet && closeSeconds == null) {
        addWarning(context, `${label} has invalid get_close value: ${closeGet}`);
      }
      if (openSeconds != null && closeSeconds != null && closeSeconds < openSeconds) {
        addWarning(
          context,
          `${label} closes (${formatGET(closeSeconds)}) before it opens (${formatGET(openSeconds)})`,
        );
      }

      const station = typeof entry.station === 'string' ? entry.station.trim() : '';
      if (!station) {
        addWarning(context, `${label} is missing station information`);
      }

      const numericFields = [
        ['signal_strength_db', entry.signal_strength_db],
        ['handover_minutes', entry.handover_minutes],
        ['downlink_rate_kbps', entry.downlink_rate_kbps],
        ['power_margin_delta_kw', entry.power_margin_delta_kw],
      ];
      for (const [field, value] of numericFields) {
        if (value != null && !Number.isFinite(Number(value))) {
          addWarning(context, `${label}.${field} should be numeric`);
        }
      }

      if (entry.next_station != null && typeof entry.next_station !== 'string') {
        addWarning(context, `${label}.next_station should be a string when present`);
      }
    }

    context.stats.communicationsTrends = ids.size;
    context.refs.dsnPasses = ids;
  } catch (error) {
    addError(context, `Failed to read communications_trends.json: ${error.message}`);
  }
}

function parseJsonField(value, label, context) {
  if (!value || value.trim().length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(value);
    if (parsed === null) {
      addWarning(context, `${label} parsed to null`);
    }
    return parsed;
  } catch (error) {
    addError(context, `${label} is not valid JSON: ${error.message}`);
    return null;
  }
}

function extractFailureIds(failureEffects) {
  if (!failureEffects || typeof failureEffects !== 'object') {
    return [];
  }

  const ids = new Set();
  if (typeof failureEffects.failure_id === 'string' && failureEffects.failure_id.trim().length > 0) {
    ids.add(failureEffects.failure_id.trim());
  }
  if (Array.isArray(failureEffects.failures)) {
    for (const entry of failureEffects.failures) {
      if (typeof entry === 'string') {
        ids.add(entry.trim());
      } else if (entry && typeof entry === 'object' && typeof entry.failure_id === 'string') {
        ids.add(entry.failure_id.trim());
      }
    }
  }
  return [...ids];
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

function validateEffectPayload(effect, context, label) {
  if (Array.isArray(effect)) {
    effect.forEach((item, index) => {
      validateEffectPayload(item, context, `${label}[${index}]`);
    });
    return;
  }

  if (!effect || typeof effect !== 'object') {
    return;
  }

  for (const [key, value] of Object.entries(effect)) {
    const pathLabel = `${label}.${key}`;
    if (typeof value === 'string') {
      if (/_get$/i.test(key) || /GET$/i.test(key)) {
        if (parseGET(value) == null) {
          addWarning(context, `${pathLabel} has invalid GET value: ${value}`);
        }
      }
      continue;
    }

    if (typeof value === 'number' || typeof value === 'boolean' || value == null) {
      continue;
    }

    if (Array.isArray(value)) {
      validateEffectPayload(value, context, pathLabel);
      continue;
    }

    if (typeof value === 'object') {
      if (key === 'communications') {
        validateCommunicationsEffect(value, context, pathLabel);
      } else {
        validateEffectPayload(value, context, pathLabel);
      }
    }
  }
}

function validateCommunicationsEffect(effect, context, label) {
  if (!effect || typeof effect !== 'object') {
    return;
  }

  const stringFields = ['last_pad_id', 'next_station', 'dsn_station'];
  for (const field of stringFields) {
    const value = effect[field];
    if (value != null && typeof value !== 'string') {
      addWarning(context, `${label}.${field} should be a string`);
    }
  }

  if (typeof effect.next_window_open_get === 'string' && parseGET(effect.next_window_open_get) == null) {
    addWarning(context, `${label}.next_window_open_get has invalid GET value: ${effect.next_window_open_get}`);
  }

  const numericFields = ['signal_strength_db', 'handover_minutes', 'downlink_rate_kbps', 'power_margin_delta_kw'];
  for (const field of numericFields) {
    const value = effect[field];
    if (value != null && !Number.isFinite(Number(value))) {
      addWarning(context, `${label}.${field} should be numeric`);
    }
  }

  const passId = typeof effect.last_pad_id === 'string' ? effect.last_pad_id.trim() : '';
  if (passId && context.refs?.dsnPasses && !context.refs.dsnPasses.has(passId)) {
    addWarning(context, `${label}.last_pad_id ${passId} not found in communications_trends dataset`);
  }

  for (const [key, value] of Object.entries(effect)) {
    if (stringFields.includes(key) || numericFields.includes(key) || key === 'next_window_open_get') {
      continue;
    }
    if (value && typeof value === 'object') {
      validateEffectPayload(value, context, `${label}.${key}`);
    }
  }
}

function getNestedValue(target, pathSpec) {
  return pathSpec.split('.').reduce((accumulator, key) => {
    if (accumulator && Object.prototype.hasOwnProperty.call(accumulator, key)) {
      return accumulator[key];
    }
    return undefined;
  }, target);
}

function isFiniteNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return false;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed);
  }
  return false;
}

function addError(context, message) {
  context.errors.push(message);
}

function addWarning(context, message) {
  context.warnings.push(message);
}

function printSummary(context) {
  const statsSummary = Object.entries(context.stats)
    .map(([key, value]) => `${key}: ${value}`)
    .join(', ');

  console.log('--- Mission Data Validation ---');
  if (statsSummary.length > 0) {
    console.log(`Dataset summary → ${statsSummary}`);
  }

  if (context.errors.length > 0) {
    console.error(`Errors (${context.errors.length}):`);
    for (const message of context.errors) {
      console.error(`  • ${message}`);
    }
  } else {
    console.log('No blocking errors detected.');
  }

  if (context.warnings.length > 0) {
    console.warn(`Warnings (${context.warnings.length}):`);
    for (const message of context.warnings) {
      console.warn(`  • ${message}`);
    }
  }
}

main().catch((error) => {
  console.error('Mission data validation failed to execute:', error);
  process.exitCode = 1;
});
