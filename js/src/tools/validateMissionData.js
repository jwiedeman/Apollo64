#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import process from 'process';
import { pathToFileURL } from 'url';
import { DATA_DIR, UI_DOCS_DIR } from '../config/paths.js';
import { parseCsv } from '../utils/csv.js';
import { formatGET, parseGET } from '../utils/time.js';
import { normalizePadParameters } from '../data/missionDataLoader.js';

const VALID_TRANSLATION_AXES = new Set(['+X', '-X', '+Y', '-Y', '+Z', '-Z']);
const VALID_TORQUE_AXES = new Set(['+pitch', '-pitch', '+yaw', '-yaw', '+roll', '-roll']);
const UI_CONTROL_TYPES = new Set(['toggle', 'enum', 'rotary', 'momentary', 'analog']);
const UI_DEPENDENCY_TYPES = new Set(['control', 'circuitbreaker']);
const UI_PHASES = new Set(['Launch', 'Translunar', 'LunarOrbit', 'Surface', 'Transearth', 'Entry']);
const UI_ROLES = new Set(['CDR', 'CMP', 'LMP', 'Joint']);
const UI_WINDOW_ID_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/;
const UI_RESOURCE_OPERATORS = new Set(['>', '>=', '<', '<=', '===', '!==']);

async function main() {
  const context = createContext();

  const autopilotRecords = await readCsvFile('autopilots.csv', context);
  const autopilotMap = await validateAutopilots(autopilotRecords, context);

  const failureRecords = await readCsvFile('failures.csv', context);
  const failureMap = validateFailures(failureRecords, context);

  const checklistRecords = await readCsvFile('checklists.csv', context);
  const checklistMap = validateChecklists(checklistRecords, context);

  const padRecords = await readCsvFile('pads.csv', context);
  const padMap = validatePads(padRecords, context);

  const eventRecords = await readCsvFile('events.csv', context);
  const eventMap = validateEvents(eventRecords, {
    autopilotMap,
    checklistMap,
    failureMap,
    padMap,
    context,
  });
  context.refs.events = eventMap;

  await validateConsumables(context);
  validateAutopilotPropellantReferences(context);
  await validateCommunicationsTrends(context);
  await validateThrusters(context);
  await validateAudioCues(context);
  await validateDockingGates({ context, eventMap, checklistMap });
  await validateUiDefinitions({ context, checklistMap });

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

async function readUiJsonFile(relativePath, context) {
  const absolutePath = path.resolve(UI_DOCS_DIR, relativePath);
  try {
    const content = await fs.readFile(absolutePath, 'utf8');
    const data = JSON.parse(content);
    if (!data || typeof data !== 'object') {
      addError(context, `docs/ui/${relativePath} is not a valid JSON object`);
      return null;
    }
    return data;
  } catch (error) {
    addError(context, `Failed to read docs/ui/${relativePath}: ${error.message}`);
    return null;
  }
}

const KNOWN_AUTOPILOT_COMMANDS = new Set([
  'attitude_hold',
  'ullage_fire',
  'throttle',
  'throttle_ramp',
  'rcs_pulse',
  'dsky_entry',
  'dsky_macro',
]);

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
        const tankReference = normalizeString(
          propulsion.tank ?? propulsion.tank_key ?? propulsion.propellant ?? null,
        );
        if (tankReference) {
          trackReference(context, 'autopilotPropellantTanks', tankReference);
        }
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
            const ullageTank =
              propulsion.ullage.tank ?? propulsion.ullage.tank_key ?? propulsion.ullage.propellant;
            if (ullageTank != null && typeof ullageTank !== 'string') {
              addWarning(context, `Autopilot ${id} propulsion ullage tank should be a string`);
            }
            const ullageTankReference = normalizeString(ullageTank ?? null);
            if (ullageTankReference) {
              trackReference(context, 'autopilotPropellantTanks', ullageTankReference);
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
    const commandName = String(step.command ?? step.cmd ?? '').trim().toLowerCase();
    if (!commandName) {
      addWarning(context, `${stepLabel} is missing a command name`);
    } else {
      validateAutopilotCommand(step, commandName, autopilotId, index, context);
    }
    if (endTime > maxEndTime) {
      maxEndTime = endTime;
    }
  }
}

function validateAutopilotCommand(step, commandName, autopilotId, index, context) {
  const label = `Autopilot ${autopilotId} step ${index}`;

  if (!KNOWN_AUTOPILOT_COMMANDS.has(commandName)) {
    addWarning(context, `${label} uses unknown command ${commandName}`);
    return;
  }

  switch (commandName) {
    case 'attitude_hold': {
      const target = step.target;
      if (!target || typeof target !== 'object') {
        addWarning(context, `${label} attitude_hold target should include roll_deg/pitch_deg/yaw_deg values`);
        break;
      }
      for (const axis of ['roll_deg', 'pitch_deg', 'yaw_deg']) {
        const value = target[axis];
        if (!isFiniteNumber(value)) {
          addWarning(context, `${label} attitude_hold target.${axis} should be numeric`);
        }
      }
      break;
    }
    case 'ullage_fire': {
      const duration = toFiniteNumber(
        step.duration ?? step.seconds ?? step.impulse ?? step.pulse_seconds ?? null,
      );
      if (duration == null || duration <= 0) {
        addWarning(context, `${label} ullage_fire duration should be greater than zero seconds`);
      }
      break;
    }
    case 'throttle': {
      const level = toFiniteNumber(step.level ?? step.value ?? step.target ?? null);
      if (level == null) {
        addWarning(context, `${label} throttle command is missing a level/value field`);
      } else if (level < 0 || level > 1) {
        addWarning(context, `${label} throttle level ${level} should be between 0 and 1`);
      }
      break;
    }
    case 'throttle_ramp': {
      const duration = toFiniteNumber(step.duration ?? step.ramp_duration ?? null);
      if (duration == null || duration <= 0) {
        addWarning(context, `${label} throttle_ramp duration should be greater than zero seconds`);
      }
      const targetLevel = toFiniteNumber(
        step.to ?? step.to_level ?? step.level ?? step.target ?? null,
      );
      if (targetLevel == null) {
        addWarning(context, `${label} throttle_ramp is missing a target level`);
      } else if (targetLevel < 0 || targetLevel > 1) {
        addWarning(context, `${label} throttle_ramp target level ${targetLevel} should be between 0 and 1`);
      }
      const startLevel = toFiniteNumber(
        step.from ?? step.from_level ?? step.start_level ?? step.start ?? null,
      );
      if (startLevel != null && (startLevel < 0 || startLevel > 1)) {
        addWarning(context, `${label} throttle_ramp start level ${startLevel} should be between 0 and 1`);
      }
      break;
    }
    case 'rcs_pulse': {
      const duration = toFiniteNumber(
        step.duration ?? step.seconds ?? step.impulse ?? step.pulse_seconds ?? null,
      );
      if (duration == null || duration <= 0) {
        addWarning(context, `${label} rcs_pulse duration should be greater than zero seconds`);
      }
      const craftId = normalizeString(step.craft ?? step.craft_id ?? step.vehicle ?? null);
      if (craftId) {
        trackReference(context, 'autopilotCraftIds', craftId);
      }
      const tankKey = normalizeString(step.tank ?? step.tank_key ?? step.propellant_tank ?? null);
      if (tankKey) {
        trackReference(context, 'autopilotPropellantTanks', tankKey);
      }
      const axis = normalizeString(step.axis ?? step.translation_axis ?? null);
      const torqueAxis = normalizeString(step.torque_axis ?? step.attitude_axis ?? null);
      const thrustersRaw = step.thrusters ?? step.thruster_ids ?? null;
      const thrusterTokens = Array.isArray(thrustersRaw)
        ? thrustersRaw
        : typeof thrustersRaw === 'string'
          ? thrustersRaw.split(',').map((entry) => entry.trim()).filter((entry) => entry.length > 0)
          : [];
      const thrusterIds = thrusterTokens
        .map((entry) => normalizeString(entry))
        .filter((entry) => entry.length > 0);
      if (!axis && !torqueAxis && thrusterIds.length === 0) {
        addWarning(
          context,
          `${label} rcs_pulse should specify a translation axis, torque axis, or thruster list`,
        );
      }
      if (thrusterIds.length > 0) {
        trackReferenceList(context, 'autopilotThrusterIds', thrusterIds);
      }
      const count = toFiniteNumber(step.count ?? step.pulses ?? step.repeat ?? null);
      if (count != null) {
        if (count <= 0) {
          addWarning(context, `${label} rcs_pulse count should be greater than zero`);
        } else if (!Number.isInteger(count)) {
          addWarning(context, `${label} rcs_pulse count ${count} should be an integer`);
        }
      }
      const dutyCycle = toFiniteNumber(step.duty_cycle ?? step.duty ?? step.duty_factor ?? null);
      if (dutyCycle != null && (dutyCycle <= 0 || dutyCycle > 1)) {
        addWarning(context, `${label} rcs_pulse duty cycle ${dutyCycle} should be between 0 and 1`);
      }
      break;
    }
    case 'dsky_entry':
    case 'dsky_macro': {
      const commandLabel = commandName;
      const macroId = normalizeString(
        step.macro ?? step.macro_id ?? step.macroId ?? null,
      );
      const verb = toFiniteNumber(step.verb ?? step.verb_id ?? null);
      const noun = toFiniteNumber(step.noun ?? step.noun_id ?? null);
      if (!macroId && verb == null && noun == null) {
        addWarning(context, `${label} ${commandLabel} should include a macro id or Verb/Noun pair`);
      }
      if (verb != null && (!Number.isInteger(verb) || verb < 0 || verb > 99)) {
        addWarning(context, `${label} ${commandLabel} verb ${verb} should be an integer between 0 and 99`);
      }
      if (noun != null && (!Number.isInteger(noun) || noun < 0 || noun > 99)) {
        addWarning(context, `${label} ${commandLabel} noun ${noun} should be an integer between 0 and 99`);
      }
      const program = step.program ?? step.agc_program ?? step.agcProgram ?? null;
      if (program != null && typeof program !== 'string') {
        addWarning(context, `${label} ${commandLabel} program should be a string when present`);
      }
      const registers = step.registers
        ?? step.values
        ?? step.register_values
        ?? step.registerValues
        ?? null;
      if (registers != null && !(typeof registers === 'object')) {
        addWarning(context, `${label} ${commandLabel} registers should be an object or array`);
      }
      const sequence = step.sequence
        ?? step.inputs
        ?? step.key_sequence
        ?? step.keySequence
        ?? step.steps
        ?? null;
      if (sequence != null && !(Array.isArray(sequence) || typeof sequence === 'string')) {
        addWarning(context, `${label} ${commandLabel} sequence should be a string or array`);
      }
      break;
    }
    default:
      break;
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
        validatePadParameters(parameters, context, id);
      }
    }

    pads.set(id, record);
  }

  context.stats.pads = pads.size;
  return pads;
}

export function validatePadParameters(parameters, context, padId) {
  const normalized = normalizePadParameters(parameters);
  const label = `PAD ${padId}`;

  const tigEntry = getRawFieldValue(parameters, ['TIG', 'tig']);
  if (tigEntry && (normalized.tig?.getSeconds == null || !normalized.tig?.get)) {
    addWarning(context, `${label} parameter ${tigEntry.key} has invalid GET value: ${tigEntry.value}`);
  }

  const entryInterface = getRawFieldValue(parameters, ['entry_interface_get', 'entryInterfaceGet']);
  if (entryInterface && (normalized.entryInterface?.getSeconds == null || !normalized.entryInterface?.get)) {
    addWarning(
      context,
      `${label} parameter ${entryInterface.key} has invalid GET value: ${entryInterface.value}`,
    );
  }

  const numericChecks = [
    { keys: ['delta_v_ft_s', 'delta_v_ft', 'delta_v_ftps'], requirePositive: true },
    { keys: ['delta_v_mps', 'delta_v_ms', 'delta_v_m_s'], requirePositive: true },
    { keys: ['burn_duration_s', 'burn_duration_seconds', 'burn_duration'], requirePositive: true },
    { keys: ['range_to_target_nm', 'range_nm'], allowZero: true },
    { keys: ['flight_path_angle_deg', 'flightPathAngleDeg'], allowNegative: true, allowZero: true },
    { keys: ['v_infinity_ft_s', 'v_infinity_ftps'], requirePositive: true },
    { keys: ['v_infinity_mps', 'v_infinity_ms'], requirePositive: true },
  ];

  for (const spec of numericChecks) {
    checkPadNumericField(parameters, context, label, spec);
  }
}

function getRawFieldValue(object, keys) {
  if (!object || typeof object !== 'object') {
    return null;
  }
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(object, key)) {
      continue;
    }
    const value = object[key];
    if (value == null) {
      continue;
    }
    if (typeof value === 'string' && value.trim().length === 0) {
      continue;
    }
    return { key, value };
  }
  return null;
}

function checkPadNumericField(parameters, context, label, spec) {
  const entry = getRawFieldValue(parameters, spec.keys ?? []);
  if (!entry) {
    return;
  }

  const numeric = toFiniteNumber(entry.value);
  if (numeric == null) {
    addWarning(
      context,
      `${label} parameter ${entry.key} should be numeric (received ${String(entry.value)})`,
    );
    return;
  }

  const allowNegative = spec.allowNegative === true;
  const allowZero = spec.allowZero === true;
  const requirePositive = spec.requirePositive === true;

  if (requirePositive) {
    const isZero = numeric === 0;
    if (numeric < 0 || (isZero && !allowZero)) {
      addWarning(
        context,
        `${label} parameter ${entry.key} should be positive (received ${numeric})`,
      );
      return;
    }
  }

  if (!allowNegative && numeric < 0) {
    addWarning(
      context,
      `${label} parameter ${entry.key} should be non-negative (received ${numeric})`,
    );
  }
}

function validateEvents(records, { autopilotMap, checklistMap, failureMap, padMap, context }) {
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

    if (record.pad_id) {
      const padId = record.pad_id.trim();
      if (padId && padMap && !padMap.has(padId)) {
        addError(context, `Event ${id} references unknown pad_id ${padId}`);
      } else if (padId) {
        trackReference(context, 'eventPadIds', padId);
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
      'propellant.lm_descent.usable_delta_v_mps',
      'propellant.lm_ascent.initial_kg',
      'propellant.lm_ascent.usable_delta_v_mps',
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

    if (data.propellant && typeof data.propellant === 'object') {
      const tankKeys = Object.keys(data.propellant)
        .map((key) => key.trim())
        .filter((key) => key.length > 0);
      if (!context.refs.propellantTanks) {
        context.refs.propellantTanks = new Set();
      }
      for (const key of tankKeys) {
        context.refs.propellantTanks.add(key);
      }
    }

    context.stats.consumablesSections = Object.keys(data).length;
  } catch (error) {
    addError(context, `Failed to read consumables.json: ${error.message}`);
  }
}

function validateAutopilotPropellantReferences(context) {
  const tankReferences = context.refs?.autopilotPropellantTanks;
  const knownTanks = context.refs?.propellantTanks;
  if (!tankReferences || tankReferences.size === 0 || !knownTanks || knownTanks.size === 0) {
    return;
  }

  for (const tankKey of tankReferences) {
    if (!knownTanks.has(tankKey)) {
      addWarning(context, `Autopilot references unknown propellant tank ${tankKey}`);
    }
  }
}

async function validateAudioCues(context) {
  const filePath = path.resolve(DATA_DIR, 'audio_cues.json');
  let data;
  try {
    const content = await fs.readFile(filePath, 'utf8');
    data = JSON.parse(content);
  } catch (error) {
    addError(context, `Failed to read audio_cues.json: ${error.message}`);
    return;
  }

  if (!data || typeof data !== 'object') {
    addError(context, 'audio_cues.json is not a valid JSON object');
    return;
  }

  const buses = Array.isArray(data.buses) ? data.buses : [];
  const categories = Array.isArray(data.categories) ? data.categories : [];
  const cues = Array.isArray(data.cues) ? data.cues : [];

  if (typeof data.version !== 'number' || !Number.isFinite(data.version)) {
    addWarning(context, 'audio_cues.json version should be a finite number');
  }
  if (data.description != null && typeof data.description !== 'string') {
    addWarning(context, 'audio_cues.json description should be a string when present');
  }

  const busIds = new Map();
  const duckingTargets = [];
  for (const [index, bus] of buses.entries()) {
    if (!bus || typeof bus !== 'object') {
      addError(context, `Audio bus entry ${index} is not an object`);
      continue;
    }

    const id = typeof bus.id === 'string' ? bus.id.trim() : '';
    if (!id) {
      addError(context, `Audio bus entry ${index} is missing an id`);
    } else if (busIds.has(id)) {
      addError(context, `Duplicate audio bus id detected: ${id}`);
    } else {
      busIds.set(id, bus);
    }

    if (!bus.name || typeof bus.name !== 'string') {
      addWarning(context, `Audio bus ${id || index} is missing a name`);
    }

    if (bus.maxConcurrent != null) {
      const value = Number(bus.maxConcurrent);
      if (!Number.isFinite(value) || value <= 0) {
        addWarning(context, `Audio bus ${id || index} maxConcurrent should be > 0`);
      }
    }

    if (bus.ducking != null && !Array.isArray(bus.ducking)) {
      addWarning(context, `Audio bus ${id || index} ducking should be an array when present`);
    } else if (Array.isArray(bus.ducking)) {
      for (const [duckIndex, rule] of bus.ducking.entries()) {
        if (!rule || typeof rule !== 'object') {
          addWarning(context, `Audio bus ${id || index} ducking[${duckIndex}] is not an object`);
          continue;
        }
        const target = typeof rule.target === 'string' ? rule.target.trim() : '';
        if (!target) {
          addWarning(context, `Audio bus ${id || index} ducking[${duckIndex}] target should be a string`);
        } else {
          duckingTargets.push({ source: id || `index_${index}`, target });
        }
        const gainDb = rule.gainDb;
        if (gainDb == null || !Number.isFinite(Number(gainDb))) {
          addWarning(context, `Audio bus ${id || index} ducking[${duckIndex}] gainDb should be numeric`);
        }
      }
    }
  }

  for (const { source, target } of duckingTargets) {
    if (target && !busIds.has(target)) {
      addWarning(context, `Audio bus ${source} ducking references unknown target bus ${target}`);
    }
  }

  const categoryIds = new Map();
  for (const [index, category] of categories.entries()) {
    if (!category || typeof category !== 'object') {
      addError(context, `Audio category entry ${index} is not an object`);
      continue;
    }

    const id = typeof category.id === 'string' ? category.id.trim() : '';
    if (!id) {
      addError(context, `Audio category entry ${index} is missing an id`);
    } else if (categoryIds.has(id)) {
      addError(context, `Duplicate audio category id detected: ${id}`);
    } else {
      categoryIds.set(id, category);
    }

    const busId = typeof category.bus === 'string' ? category.bus.trim() : '';
    if (!busId) {
      addError(context, `Audio category ${id || index} is missing a bus reference`);
    } else if (!busIds.has(busId)) {
      addError(context, `Audio category ${id || index} references unknown bus ${busId}`);
    }

    if (category.defaultPriority != null && !isFiniteNumber(category.defaultPriority)) {
      addWarning(context, `Audio category ${id || index} defaultPriority should be numeric`);
    }
    if (category.cooldownSeconds != null && !isFiniteNumber(category.cooldownSeconds)) {
      addWarning(context, `Audio category ${id || index} cooldownSeconds should be numeric`);
    }
    if (!category.description || typeof category.description !== 'string') {
      addWarning(context, `Audio category ${id || index} is missing a description`);
    }
  }

  const cueIds = new Map();
  for (const [index, cue] of cues.entries()) {
    if (!cue || typeof cue !== 'object') {
      addError(context, `Audio cue entry ${index} is not an object`);
      continue;
    }

    const id = typeof cue.id === 'string' ? cue.id.trim() : '';
    if (!id) {
      addError(context, `Audio cue entry ${index} is missing an id`);
    } else if (cueIds.has(id)) {
      addError(context, `Duplicate audio cue id detected: ${id}`);
    } else {
      cueIds.set(id, cue);
    }

    const categoryId = typeof cue.category === 'string' ? cue.category.trim() : '';
    if (!categoryId) {
      addError(context, `Audio cue ${id || index} is missing a category`);
    } else if (!categoryIds.has(categoryId)) {
      addError(context, `Audio cue ${id || index} references unknown category ${categoryId}`);
    }

    if (cue.priority != null && !isFiniteNumber(cue.priority)) {
      addWarning(context, `Audio cue ${id || index} priority should be numeric`);
    }
    if (cue.lengthSeconds != null) {
      const value = Number(cue.lengthSeconds);
      if (!Number.isFinite(value) || value < 0) {
        addWarning(context, `Audio cue ${id || index} lengthSeconds should be ≥ 0`);
      }
    } else {
      addWarning(context, `Audio cue ${id || index} is missing lengthSeconds`);
    }
    if (cue.cooldownSeconds != null && !isFiniteNumber(cue.cooldownSeconds)) {
      addWarning(context, `Audio cue ${id || index} cooldownSeconds should be numeric`);
    }
    if (cue.loop != null && typeof cue.loop !== 'boolean') {
      addWarning(context, `Audio cue ${id || index} loop should be a boolean when present`);
    }
    if (cue.loudnessLufs != null && !isFiniteNumber(cue.loudnessLufs)) {
      addWarning(context, `Audio cue ${id || index} loudnessLufs should be numeric`);
    }

    if (!cue.assets || typeof cue.assets !== 'object') {
      addWarning(context, `Audio cue ${id || index} assets should be an object`);
    } else {
      const webAsset = cue.assets.web;
      const n64Asset = cue.assets.n64;
      if (webAsset == null && n64Asset == null) {
        addWarning(context, `Audio cue ${id || index} assets should include at least one platform path`);
      }
      if (webAsset != null && typeof webAsset !== 'string') {
        addWarning(context, `Audio cue ${id || index} web asset should be a string`);
      }
      if (n64Asset != null && typeof n64Asset !== 'string') {
        addWarning(context, `Audio cue ${id || index} n64 asset should be a string`);
      }
    }

    if (cue.subtitle != null && typeof cue.subtitle !== 'string') {
      addWarning(context, `Audio cue ${id || index} subtitle should be a string or null`);
    }
    if (cue.notes != null && typeof cue.notes !== 'string') {
      addWarning(context, `Audio cue ${id || index} notes should be a string when present`);
    }
    if (!cue.source || typeof cue.source !== 'string') {
      addWarning(context, `Audio cue ${id || index} is missing a source citation`);
    }

    if (cue.tags != null && !Array.isArray(cue.tags)) {
      addWarning(context, `Audio cue ${id || index} tags should be an array when present`);
    } else if (Array.isArray(cue.tags)) {
      for (const [tagIndex, tag] of cue.tags.entries()) {
        if (typeof tag !== 'string' || tag.trim().length === 0) {
          addWarning(context, `Audio cue ${id || index} tags[${tagIndex}] should be a non-empty string`);
        }
      }
    }
  }

  context.stats.audioBuses = busIds.size;
  context.stats.audioCategories = categoryIds.size;
  context.stats.audioCues = cueIds.size;
  context.refs.audioBuses = new Set(busIds.keys());
  context.refs.audioCategories = new Set(categoryIds.keys());
  context.refs.audioCueIds = new Set(cueIds.keys());
  context.refs.audioCueMap = cueIds;
}

async function validateDockingGates({ context, eventMap, checklistMap }) {
  const bundle = await readUiJsonFile('docking_gates.json', context);
  if (!bundle) {
    context.stats.dockingGates = 0;
    return;
  }

  if (bundle.version != null && toFiniteNumber(bundle.version) == null) {
    addWarning(context, 'docs/ui/docking_gates.json version should be numeric when present');
  }

  const eventId = normalizeString(bundle.eventId ?? bundle.event_id);
  if (!eventId) {
    addError(context, 'docs/ui/docking_gates.json is missing an eventId');
  } else if (eventMap && !eventMap.has(eventId)) {
    addError(context, `docs/ui/docking_gates.json references unknown eventId ${eventId}`);
  }

  const startRange = toFiniteNumber(
    bundle.startRangeMeters ?? bundle.start_range_meters ?? bundle.startRange ?? null,
  );
  if (
    bundle.startRangeMeters != null
    || bundle.start_range_meters != null
    || bundle.startRange != null
  ) {
    if (startRange == null) {
      addWarning(context, 'docs/ui/docking_gates.json startRangeMeters should be numeric');
    }
  }

  const endRange = toFiniteNumber(
    bundle.endRangeMeters ?? bundle.end_range_meters ?? bundle.endRange ?? null,
  );
  if (bundle.endRangeMeters != null || bundle.end_range_meters != null || bundle.endRange != null) {
    if (endRange == null) {
      addWarning(context, 'docs/ui/docking_gates.json endRangeMeters should be numeric');
    }
  }

  if (bundle.notes != null && typeof bundle.notes !== 'string') {
    addWarning(context, 'docs/ui/docking_gates.json notes should be a string when present');
  }

  const gatesArray = Array.isArray(bundle.gates) ? bundle.gates : [];
  if (!Array.isArray(bundle.gates)) {
    addError(context, 'docs/ui/docking_gates.json gates should be an array');
  }

  const gateIds = new Set();
  let gateCount = 0;

  for (const [index, gate] of gatesArray.entries()) {
    const label = `docs/ui/docking_gates.json gates[${index}]`;
    if (!gate || typeof gate !== 'object') {
      addError(context, `${label} is not an object`);
      continue;
    }

    const gateId = normalizeString(gate.id);
    if (!gateId) {
      addError(context, `${label} is missing an id`);
      continue;
    }
    if (gateIds.has(gateId)) {
      addError(context, `${label} duplicates gate id ${gateId}`);
      continue;
    }
    gateIds.add(gateId);
    gateCount += 1;

    if (gate.label != null && typeof gate.label !== 'string') {
      addWarning(context, `${label}.label should be a string when present`);
    }

    const rangeMeters = toFiniteNumber(gate.rangeMeters ?? gate.range_meters ?? gate.range);
    if (
      gate.rangeMeters != null
      || gate.range_meters != null
      || gate.range != null
    ) {
      if (rangeMeters == null) {
        addWarning(context, `${label}.rangeMeters should be numeric`);
      }
    } else {
      addWarning(context, `${label} is missing rangeMeters`);
    }

    const targetRate = toFiniteNumber(
      gate.targetRateMps ?? gate.target_rate_mps ?? gate.targetRate ?? gate.target_rate,
    );
    if (targetRate == null) {
      addWarning(context, `${label}.targetRateMps should be numeric`);
    }

    if (gate.tolerance != null && typeof gate.tolerance !== 'object') {
      addWarning(context, `${label}.tolerance should be an object when present`);
    } else if (gate.tolerance) {
      const plus = toFiniteNumber(gate.tolerance.plus ?? gate.tolerance.max);
      const minus = toFiniteNumber(gate.tolerance.minus ?? gate.tolerance.min);
      if (gate.tolerance.plus != null && plus == null) {
        addWarning(context, `${label}.tolerance.plus should be numeric`);
      }
      if (gate.tolerance.minus != null && minus == null) {
        addWarning(context, `${label}.tolerance.minus should be numeric`);
      }
    }

    const activation = toFiniteNumber(
      gate.activationProgress ?? gate.activation_progress ?? null,
    );
    if (activation != null && (activation < 0 || activation > 1)) {
      addWarning(context, `${label}.activationProgress should be between 0 and 1`);
    }

    const completion = toFiniteNumber(
      gate.completionProgress ?? gate.completion_progress ?? null,
    );
    if (completion != null) {
      if (completion < 0 || completion > 1) {
        addWarning(context, `${label}.completionProgress should be between 0 and 1`);
      }
      if (activation != null && completion < activation) {
        addWarning(context, `${label}.completionProgress should be >= activationProgress`);
      }
    }

    const checklistId = normalizeString(gate.checklistId ?? gate.checklist_id);
    if (checklistId && checklistMap && !checklistMap.has(checklistId)) {
      addError(context, `${label} references unknown checklistId ${checklistId}`);
    }

    if (gate.notes != null && typeof gate.notes !== 'string') {
      addWarning(context, `${label}.notes should be a string when present`);
    }

    if (gate.sources != null && !Array.isArray(gate.sources)) {
      addWarning(context, `${label}.sources should be an array when present`);
    } else if (Array.isArray(gate.sources)) {
      for (const [sourceIndex, source] of gate.sources.entries()) {
        if (typeof source !== 'string' || source.trim().length === 0) {
          addWarning(context, `${label}.sources[${sourceIndex}] should be a non-empty string`);
        }
      }
    }

    if (gate.deadlineGet != null) {
      if (typeof gate.deadlineGet !== 'string') {
        addWarning(context, `${label}.deadlineGet should be a string when present`);
      } else if (parseGET(gate.deadlineGet) == null) {
        addError(context, `${label}.deadlineGet has invalid GET value ${gate.deadlineGet}`);
      }
    }

    if (gate.deadlineOffsetSeconds != null) {
      if (toFiniteNumber(gate.deadlineOffsetSeconds) == null) {
        addWarning(context, `${label}.deadlineOffsetSeconds should be numeric when present`);
      }
    }
  }

  context.stats.dockingGates = gateCount;
  context.refs.dockingGateIds = gateIds;
}

async function validateUiDefinitions({ context, checklistMap }) {
  const panelBundle = await readUiJsonFile('panels.json', context);
  validateUiPanelsBundle(panelBundle, context);
  const panelInfo = context.refs.uiPanelInfo ?? { panels: new Map() };

  const checklistBundle = await readUiJsonFile('checklists.json', context);
  validateUiChecklistsBundle(checklistBundle, { context, checklistMap, panelInfo });

  const workspaceBundle = await readUiJsonFile('workspaces.json', context);
  validateUiWorkspacesBundle(workspaceBundle, { context, panelInfo });
}

function validateUiPanelsBundle(bundle, context) {
  const panelInfo = { panels: new Map() };

  context.refs.uiPanelInfo = panelInfo;

  if (!bundle) {
    context.stats.uiPanels = 0;
    context.stats.uiPanelControls = 0;
    context.stats.uiPanelAlerts = 0;
    return;
  }

  if (typeof bundle.version !== 'number' || !Number.isFinite(bundle.version)) {
    addWarning(context, 'docs/ui/panels.json version should be a finite number');
  }

  if (bundle.description != null && typeof bundle.description !== 'string') {
    addWarning(context, 'docs/ui/panels.json description should be a string when present');
  }

  if (!context.refs.uiPanels) {
    context.refs.uiPanels = new Set();
  }

  const panelsArray = Array.isArray(bundle.panels) ? bundle.panels : [];
  if (!Array.isArray(bundle.panels)) {
    addError(context, 'docs/ui/panels.json panels should be an array');
  }

  const panelIds = new Set();
  const crossPanelDependencies = [];
  let totalControls = 0;
  let totalAlerts = 0;

  for (const [index, panel] of panelsArray.entries()) {
    const label = `docs/ui/panels.json panels[${index}]`;
    if (!panel || typeof panel !== 'object') {
      addError(context, `${label} is not an object`);
      continue;
    }

    const panelId = normalizeString(panel.id);
    if (!panelId) {
      addError(context, `${label} is missing an id`);
      continue;
    }
    if (panelIds.has(panelId)) {
      addError(context, `${label} duplicates panel id ${panelId}`);
      continue;
    }
    panelIds.add(panelId);
    context.refs.uiPanels.add(panelId);

    const controlMap = new Map();
    panelInfo.panels.set(panelId, { controls: controlMap });

    if (panel.name != null && typeof panel.name !== 'string') {
      addWarning(context, `${label}.name should be a string when present`);
    }
    if (panel.craft == null || typeof panel.craft !== 'string') {
      addWarning(context, `${label}.craft should be a string`);
    }

    let layoutHotspots = null;
    if (panel.layout != null && typeof panel.layout !== 'object') {
      addWarning(context, `${label}.layout should be an object when present`);
    } else if (panel.layout) {
      if (panel.layout.schematic != null && typeof panel.layout.schematic !== 'string') {
        addWarning(context, `${label}.layout.schematic should be a string when present`);
      }
      if (panel.layout.hotspots != null) {
        if (Array.isArray(panel.layout.hotspots)) {
          layoutHotspots = panel.layout.hotspots;
        } else {
          addWarning(context, `${label}.layout.hotspots should be an array when present`);
          layoutHotspots = [];
        }
      }
    }

    const controlsArray = Array.isArray(panel.controls) ? panel.controls : [];
    if (panel.controls != null && !Array.isArray(panel.controls)) {
      addError(context, `${label}.controls should be an array`);
    }
    if (controlsArray.length === 0) {
      addWarning(context, `${label} defines no controls`);
    }
    const controlIds = new Set();

    for (const [controlIndex, control] of controlsArray.entries()) {
      const controlLabel = `${label}.controls[${controlIndex}]`;
      if (!control || typeof control !== 'object') {
        addError(context, `${controlLabel} is not an object`);
        continue;
      }

      const controlId = normalizeString(control.id);
      if (!controlId) {
        addError(context, `${controlLabel} is missing an id`);
        continue;
      }
      if (controlIds.has(controlId)) {
        addError(context, `${controlLabel} duplicates control id ${controlId} within panel ${panelId}`);
        continue;
      }
      controlIds.add(controlId);

      if (control.type == null || typeof control.type !== 'string') {
        addWarning(context, `${controlLabel}.type should be a string`);
      } else {
        const typeNormalized = control.type.trim().toLowerCase();
        if (!UI_CONTROL_TYPES.has(typeNormalized)) {
          addWarning(context, `${controlLabel}.type uses unexpected value ${control.type}`);
        }
      }

      if (control.label != null && typeof control.label !== 'string') {
        addWarning(context, `${controlLabel}.label should be a string when present`);
      }

      const statesArray = Array.isArray(control.states) ? control.states : [];
      if (control.states != null && !Array.isArray(control.states)) {
        addError(context, `${controlLabel}.states should be an array`);
      }
      if (statesArray.length === 0) {
        addWarning(context, `${controlLabel} defines no states`);
      }
      const stateIds = new Set();
      for (const [stateIndex, state] of statesArray.entries()) {
        const stateLabel = `${controlLabel}.states[${stateIndex}]`;
        if (!state || typeof state !== 'object') {
          addWarning(context, `${stateLabel} is not an object`);
          continue;
        }
        const stateId = normalizeString(state.id);
        if (!stateId) {
          addWarning(context, `${stateLabel} is missing an id`);
          continue;
        }
        if (stateIds.has(stateId)) {
          addWarning(context, `${stateLabel} duplicates state id ${stateId}`);
        } else {
          stateIds.add(stateId);
        }
        if (state.label != null && typeof state.label !== 'string') {
          addWarning(context, `${stateLabel}.label should be a string when present`);
        }
        if (state.drawKw != null && !Number.isFinite(Number(state.drawKw))) {
          addWarning(context, `${stateLabel}.drawKw should be numeric when present`);
        }
        if (state.propellantKg != null && !Number.isFinite(Number(state.propellantKg))) {
          addWarning(context, `${stateLabel}.propellantKg should be numeric when present`);
        }
      }

      const defaultState = normalizeString(control.defaultState);
      if (!defaultState) {
        addWarning(context, `${controlLabel} is missing defaultState`);
      } else if (!stateIds.has(defaultState)) {
        addWarning(
          context,
          `${controlLabel}.defaultState ${control.defaultState} is not defined in states for panel ${panelId}`,
        );
      }

      controlMap.set(controlId, { states: stateIds });

      if (control.dependencies != null && !Array.isArray(control.dependencies)) {
        addWarning(context, `${controlLabel}.dependencies should be an array when present`);
      } else if (Array.isArray(control.dependencies)) {
        for (const [dependencyIndex, dependency] of control.dependencies.entries()) {
          const dependencyLabel = `${controlLabel}.dependencies[${dependencyIndex}]`;
          if (!dependency || typeof dependency !== 'object') {
            addWarning(context, `${dependencyLabel} is not an object`);
            continue;
          }
          const dependencyTypeRaw = normalizeString(dependency.type);
          const dependencyType = dependencyTypeRaw ? dependencyTypeRaw.toLowerCase() : '';
          if (!dependencyType) {
            addWarning(context, `${dependencyLabel} is missing a type`);
          } else if (!UI_DEPENDENCY_TYPES.has(dependencyType)) {
            addWarning(context, `${dependencyLabel} has unexpected type ${dependency.type}`);
          }
          const targetPanelId = normalizeString(dependency.panel) || panelId;
          const targetControlId = normalizeString(dependency.id);
          if (!targetControlId) {
            addWarning(context, `${dependencyLabel} should define an id`);
          } else if (dependencyType === 'control' && targetPanelId === panelId) {
            const targetControl = controlMap.get(targetControlId);
            if (!targetControl) {
              addWarning(
                context,
                `${dependencyLabel} references unknown control ${targetControlId} on panel ${panelId}`,
              );
            } else if (dependency.states != null) {
              if (!Array.isArray(dependency.states)) {
                addWarning(context, `${dependencyLabel}.states should be an array when present`);
              } else {
                for (const [stateIndex, stateRaw] of dependency.states.entries()) {
                  const stateId = normalizeString(stateRaw);
                  if (!stateId) {
                    addWarning(context, `${dependencyLabel}.states[${stateIndex}] should be a string`);
                  } else if (!targetControl.states.has(stateId)) {
                    addWarning(
                      context,
                      `${dependencyLabel}.states[${stateIndex}] references unknown state ${stateId} on control ${targetControlId}`,
                    );
                  }
                }
              }
            }
          } else if (dependencyType === 'control') {
            crossPanelDependencies.push({
              label: dependencyLabel,
              targetPanelId,
              controlId: targetControlId,
              states: Array.isArray(dependency.states) ? dependency.states : [],
            });
          }
        }
      }

      if (control.telemetry != null) {
        if (typeof control.telemetry !== 'object') {
          addWarning(context, `${controlLabel}.telemetry should be an object when present`);
        } else {
          if (control.telemetry.resource != null && typeof control.telemetry.resource !== 'string') {
            addWarning(context, `${controlLabel}.telemetry.resource should be a string when present`);
          }
          if (control.telemetry.flag != null && typeof control.telemetry.flag !== 'string') {
            addWarning(context, `${controlLabel}.telemetry.flag should be a string when present`);
          }
        }
      }

      if (control.effects != null && !Array.isArray(control.effects)) {
        addWarning(context, `${controlLabel}.effects should be an array when present`);
      } else if (Array.isArray(control.effects)) {
        for (const [effectIndex, effect] of control.effects.entries()) {
          const effectLabel = `${controlLabel}.effects[${effectIndex}]`;
          if (!effect || typeof effect !== 'object') {
            addWarning(context, `${effectLabel} is not an object`);
            continue;
          }
          if (!normalizeString(effect.type)) {
            addWarning(context, `${effectLabel} is missing a type`);
          }
          if (!normalizeString(effect.id)) {
            addWarning(context, `${effectLabel} is missing an id`);
          }
        }
      }

      totalControls += 1;
    }

    if (Array.isArray(layoutHotspots)) {
      for (const [hotspotIndex, hotspot] of layoutHotspots.entries()) {
        const hotspotLabel = `${label}.layout.hotspots[${hotspotIndex}]`;
        if (!hotspot || typeof hotspot !== 'object') {
          addWarning(context, `${hotspotLabel} is not an object`);
          continue;
        }
        const hotspotControlId = normalizeString(hotspot.controlId);
        if (!hotspotControlId) {
          addWarning(context, `${hotspotLabel} should define controlId`);
        } else if (!controlMap.has(hotspotControlId)) {
          addWarning(context, `${hotspotLabel} references unknown control ${hotspotControlId}`);
        }
        for (const field of ['x', 'y', 'width', 'height']) {
          const value = toFiniteNumber(hotspot[field]);
          if (value == null) {
            addWarning(context, `${hotspotLabel}.${field} should be numeric`);
          }
        }
      }
    }

    if (panel.alerts != null && !Array.isArray(panel.alerts)) {
      addWarning(context, `${label}.alerts should be an array when present`);
    } else if (Array.isArray(panel.alerts)) {
      const alertIds = new Set();
      for (const [alertIndex, alert] of panel.alerts.entries()) {
        const alertLabel = `${label}.alerts[${alertIndex}]`;
        if (!alert || typeof alert !== 'object') {
          addWarning(context, `${alertLabel} is not an object`);
          continue;
        }
        const alertId = normalizeString(alert.id);
        if (!alertId) {
          addWarning(context, `${alertLabel} is missing an id`);
        } else if (alertIds.has(alertId)) {
          addWarning(context, `${alertLabel} duplicates alert id ${alertId}`);
        } else {
          alertIds.add(alertId);
        }

        const severity = normalizeString(alert.severity).toLowerCase();
        if (!severity) {
          addWarning(context, `${alertLabel} is missing a severity`);
        } else if (!['caution', 'warning', 'advisory'].includes(severity)) {
          addWarning(context, `${alertLabel} has unexpected severity ${alert.severity}`);
        }

        if (alert.message != null && typeof alert.message !== 'string') {
          addWarning(context, `${alertLabel}.message should be a string when present`);
        }

        if (!alert.trigger || typeof alert.trigger !== 'object') {
          addWarning(context, `${alertLabel}.trigger should be an object`);
        } else {
          const conditions = alert.trigger.all;
          if (!Array.isArray(conditions) || conditions.length === 0) {
            addWarning(context, `${alertLabel}.trigger.all should be a non-empty array`);
          } else {
            for (const [conditionIndex, condition] of conditions.entries()) {
              validateAlertCondition(condition, {
                context,
                panelId,
                controlsByPanel: panelInfo.panels,
                path: `${alertLabel}.trigger.all[${conditionIndex}]`,
              });
            }
          }
        }
      }
      totalAlerts += alertIds.size;
    }
  }

  for (const dependency of crossPanelDependencies) {
    if (!dependency.controlId) {
      continue;
    }
    const targetPanel = panelInfo.panels.get(dependency.targetPanelId);
    if (!targetPanel) {
      addWarning(
        context,
        `${dependency.label} references unknown panel ${dependency.targetPanelId}`,
      );
      continue;
    }
    const control = targetPanel.controls.get(dependency.controlId);
    if (!control) {
      addWarning(
        context,
        `${dependency.label} references unknown control ${dependency.controlId} on panel ${dependency.targetPanelId}`,
      );
      continue;
    }
    for (const [index, stateRaw] of dependency.states.entries()) {
      const stateId = normalizeString(stateRaw);
      if (!stateId) {
        addWarning(context, `${dependency.label}.states[${index}] should be a string`);
      } else if (!control.states.has(stateId)) {
        addWarning(
          context,
          `${dependency.label}.states[${index}] references unknown state ${stateId} on panel ${dependency.targetPanelId}`,
        );
      }
    }
  }

  context.stats.uiPanels = panelIds.size;
  context.stats.uiPanelControls = totalControls;
  context.stats.uiPanelAlerts = totalAlerts;
}

function validateUiChecklistsBundle(bundle, { context, checklistMap, panelInfo }) {
  if (!bundle) {
    context.stats.uiChecklists = 0;
    context.stats.uiChecklistSteps = 0;
    return;
  }

  if (typeof bundle.version !== 'number' || !Number.isFinite(bundle.version)) {
    addWarning(context, 'docs/ui/checklists.json version should be a finite number');
  }

  if (bundle.description != null && typeof bundle.description !== 'string') {
    addWarning(context, 'docs/ui/checklists.json description should be a string when present');
  }

  const checklistsArray = Array.isArray(bundle.checklists) ? bundle.checklists : [];
  if (!Array.isArray(bundle.checklists)) {
    addError(context, 'docs/ui/checklists.json checklists should be an array');
  }

  const checklistIds = new Set();
  const stepIds = new Set();
  let totalSteps = 0;

  for (const [index, checklist] of checklistsArray.entries()) {
    const label = `docs/ui/checklists.json checklists[${index}]`;
    if (!checklist || typeof checklist !== 'object') {
      addError(context, `${label} is not an object`);
      continue;
    }

    const checklistId = normalizeString(checklist.id);
    if (!checklistId) {
      addError(context, `${label} is missing an id`);
      continue;
    }
    if (checklistIds.has(checklistId)) {
      addError(context, `${label} duplicates checklist id ${checklistId}`);
      continue;
    }
    checklistIds.add(checklistId);

    if (checklistMap && !checklistMap.has(checklistId)) {
      addError(context, `${label} references checklist id ${checklistId} not found in docs/data/checklists.csv`);
    }

    if (checklist.title != null && typeof checklist.title !== 'string') {
      addWarning(context, `${label}.title should be a string when present`);
    }

    const phase = normalizeString(checklist.phase);
    if (phase && !UI_PHASES.has(phase)) {
      addWarning(context, `${label}.phase uses unexpected value ${checklist.phase}`);
    }

    const role = normalizeString(checklist.role);
    if (role && !UI_ROLES.has(role)) {
      addWarning(context, `${label}.role uses unexpected value ${checklist.role}`);
    }

    const nominalGet = normalizeString(checklist.nominalGet);
    if (nominalGet && parseGET(nominalGet) == null) {
      addWarning(context, `${label}.nominalGet has invalid GET value ${nominalGet}`);
    }

    if (checklist.source != null && typeof checklist.source !== 'object') {
      addWarning(context, `${label}.source should be an object when present`);
    }

    const stepsArray = Array.isArray(checklist.steps) ? checklist.steps : [];
    if (checklist.steps != null && !Array.isArray(checklist.steps)) {
      addError(context, `${label}.steps should be an array`);
    }
    if (stepsArray.length === 0) {
      addWarning(context, `${label} defines no steps`);
    }

    const orderValues = [];

    for (const [stepIndex, step] of stepsArray.entries()) {
      const stepLabel = `${label}.steps[${stepIndex}]`;
      if (!step || typeof step !== 'object') {
        addError(context, `${stepLabel} is not an object`);
        continue;
      }

      const stepId = normalizeString(step.id);
      if (!stepId) {
        addError(context, `${stepLabel} is missing an id`);
        continue;
      }
      if (stepIds.has(stepId)) {
        addError(context, `${stepLabel} duplicates step id ${stepId}`);
        continue;
      }
      stepIds.add(stepId);

      const orderValue = toFiniteNumber(step.order);
      if (orderValue == null || !Number.isInteger(orderValue) || orderValue <= 0) {
        addWarning(context, `${stepLabel}.order should be a positive integer`);
      } else {
        orderValues.push(orderValue);
      }

      if (step.callout != null && typeof step.callout !== 'string') {
        addWarning(context, `${stepLabel}.callout should be a string when present`);
      }

      const panelId = normalizeString(step.panel);
      const panelControls = panelId ? panelInfo.panels.get(panelId)?.controls : null;
      if (!panelId) {
        addError(context, `${stepLabel} is missing a panel reference`);
      } else if (!panelControls) {
        addError(context, `${stepLabel} references unknown panel ${panelId}`);
      }

      if (step.controls != null && !Array.isArray(step.controls)) {
        addWarning(context, `${stepLabel}.controls should be an array when present`);
      } else if (Array.isArray(step.controls) && step.controls.length > 0) {
        for (const [controlIndex, controlRef] of step.controls.entries()) {
          const controlLabel = `${stepLabel}.controls[${controlIndex}]`;
          if (!controlRef || typeof controlRef !== 'object') {
            addWarning(context, `${controlLabel} is not an object`);
            continue;
          }
          const controlId = normalizeString(controlRef.controlId);
          if (!controlId) {
            addWarning(context, `${controlLabel} should define controlId`);
            continue;
          }
          if (!panelControls || !panelControls.has(controlId)) {
            addWarning(
              context,
              `${controlLabel} references unknown control ${controlId} on panel ${panelId}`,
            );
          } else {
            const targetState = normalizeString(controlRef.targetState);
            if (!targetState) {
              addWarning(context, `${controlLabel}.targetState should be a string`);
            } else {
              const controlInfo = panelControls.get(controlId);
              if (controlInfo && !controlInfo.states.has(targetState)) {
                addWarning(
                  context,
                  `${controlLabel}.targetState ${targetState} is not defined on control ${controlId}`,
                );
              }
            }
          }
          if (controlRef.verification != null && typeof controlRef.verification !== 'string') {
            addWarning(context, `${controlLabel}.verification should be a string when present`);
          }
        }
      }

      if (step.dskyMacro != null && typeof step.dskyMacro !== 'string') {
        addWarning(context, `${stepLabel}.dskyMacro should be a string when present`);
      }

      if (step.prerequisites != null && !Array.isArray(step.prerequisites)) {
        addWarning(context, `${stepLabel}.prerequisites should be an array when present`);
      } else if (Array.isArray(step.prerequisites)) {
        for (const [prereqIndex, prereq] of step.prerequisites.entries()) {
          if (typeof prereq !== 'string' || prereq.trim().length === 0) {
            addWarning(context, `${stepLabel}.prerequisites[${prereqIndex}] should be a non-empty string`);
          }
        }
      }

      if (step.effects != null && !Array.isArray(step.effects)) {
        addWarning(context, `${stepLabel}.effects should be an array when present`);
      } else if (Array.isArray(step.effects)) {
        for (const [effectIndex, effect] of step.effects.entries()) {
          const effectLabel = `${stepLabel}.effects[${effectIndex}]`;
          if (!effect || typeof effect !== 'object') {
            addWarning(context, `${effectLabel} is not an object`);
            continue;
          }
          const effectType = normalizeString(effect.type);
          if (!effectType) {
            addWarning(context, `${effectLabel} is missing a type`);
          } else if (effectType === 'flag') {
            if (!normalizeString(effect.id)) {
              addWarning(context, `${effectLabel} flag effect is missing an id`);
            }
            if (typeof effect.value !== 'boolean') {
              addWarning(context, `${effectLabel} flag effect should define a boolean value`);
            }
          }
        }
      }

      if (step.manualOnly != null && typeof step.manualOnly !== 'boolean') {
        addWarning(context, `${stepLabel}.manualOnly should be a boolean when present`);
      }

      if (step.notes != null && typeof step.notes !== 'string') {
        addWarning(context, `${stepLabel}.notes should be a string when present`);
      }

      totalSteps += 1;
    }

    const sortedOrders = orderValues.sort((a, b) => a - b);
    for (let i = 0; i < sortedOrders.length; i += 1) {
      const expected = i + 1;
      if (sortedOrders[i] !== expected) {
        addWarning(
          context,
          `${label} has non-sequential order values; expected ${expected} at position ${i + 1} but found ${sortedOrders[i]}`,
        );
        break;
      }
    }
  }

  context.stats.uiChecklists = checklistIds.size;
  context.stats.uiChecklistSteps = totalSteps;
}

function validateUiWorkspacesBundle(bundle, { context, panelInfo }) {
  if (!bundle) {
    context.stats.uiWorkspaces = 0;
    context.stats.uiWorkspaceTiles = 0;
    return;
  }

  if (typeof bundle.version !== 'number' || !Number.isFinite(bundle.version)) {
    addWarning(context, 'docs/ui/workspaces.json version should be a finite number');
  }

  if (bundle.description != null && typeof bundle.description !== 'string') {
    addWarning(context, 'docs/ui/workspaces.json description should be a string when present');
  }

  const presetsArray = Array.isArray(bundle.presets) ? bundle.presets : [];
  if (!Array.isArray(bundle.presets)) {
    addError(context, 'docs/ui/workspaces.json presets should be an array');
  }

  const presetIds = new Set();
  let totalTiles = 0;

  for (const [index, preset] of presetsArray.entries()) {
    const label = `docs/ui/workspaces.json presets[${index}]`;
    if (!preset || typeof preset !== 'object') {
      addError(context, `${label} is not an object`);
      continue;
    }

    const presetId = normalizeString(preset.id);
    if (!presetId) {
      addError(context, `${label} is missing an id`);
      continue;
    }
    if (presetIds.has(presetId)) {
      addError(context, `${label} duplicates preset id ${presetId}`);
      continue;
    }
    presetIds.add(presetId);

    if (preset.name != null && typeof preset.name !== 'string') {
      addWarning(context, `${label}.name should be a string when present`);
    }
    if (preset.description != null && typeof preset.description !== 'string') {
      addWarning(context, `${label}.description should be a string when present`);
    }

    if (preset.viewport != null && typeof preset.viewport !== 'object') {
      addWarning(context, `${label}.viewport should be an object when present`);
    } else if (preset.viewport) {
      const minWidth = toFiniteNumber(preset.viewport.minWidth ?? preset.viewport.min_width);
      if (minWidth == null || minWidth <= 0) {
        addWarning(context, `${label}.viewport.minWidth should be a positive number`);
      }
      const minHeight = toFiniteNumber(preset.viewport.minHeight ?? preset.viewport.min_height);
      if (minHeight == null || minHeight <= 0) {
        addWarning(context, `${label}.viewport.minHeight should be a positive number`);
      }
      if (preset.viewport.hudPinned != null && typeof preset.viewport.hudPinned !== 'boolean') {
        addWarning(context, `${label}.viewport.hudPinned should be a boolean when present`);
      }
    } else {
      addWarning(context, `${label} is missing viewport metadata`);
    }

    const tilesArray = Array.isArray(preset.tiles) ? preset.tiles : [];
    if (preset.tiles != null && !Array.isArray(preset.tiles)) {
      addError(context, `${label}.tiles should be an array`);
    }
    if (tilesArray.length === 0) {
      addWarning(context, `${label} defines no tiles`);
    }
    const tileIds = new Set();

    for (const [tileIndex, tile] of tilesArray.entries()) {
      const tileLabel = `${label}.tiles[${tileIndex}]`;
      if (!tile || typeof tile !== 'object') {
        addError(context, `${tileLabel} is not an object`);
        continue;
      }

      const tileId = normalizeString(tile.id);
      if (!tileId) {
        addWarning(context, `${tileLabel} is missing an id`);
      } else if (tileIds.has(tileId)) {
        addWarning(context, `${tileLabel} duplicates tile id ${tileId} within preset ${presetId}`);
      } else {
        tileIds.add(tileId);
      }

      const windowId = normalizeString(tile.window);
      if (!windowId) {
        addWarning(context, `${tileLabel} should define a window identifier`);
      } else if (!UI_WINDOW_ID_PATTERN.test(windowId)) {
        addWarning(context, `${tileLabel}.window ${tile.window} should match ${UI_WINDOW_ID_PATTERN}`);
      }

      for (const field of ['x', 'y', 'width', 'height']) {
        const value = toFiniteNumber(tile[field]);
        if (value == null) {
          addWarning(context, `${tileLabel}.${field} should be numeric`);
        } else if ((field === 'width' || field === 'height') && value <= 0) {
          addWarning(context, `${tileLabel}.${field} should be greater than zero`);
        } else if ((field === 'x' || field === 'y') && (value < 0 || value > 1)) {
          addWarning(context, `${tileLabel}.${field} should be between 0 and 1`);
        } else if ((field === 'width' || field === 'height') && value > 1) {
          addWarning(context, `${tileLabel}.${field} should be ≤ 1 to fit within the viewport`);
        }
      }

      if (tile.constraints != null && typeof tile.constraints !== 'object') {
        addWarning(context, `${tileLabel}.constraints should be an object when present`);
      } else if (tile.constraints) {
        const minWidth = toFiniteNumber(tile.constraints.minWidth ?? tile.constraints.min_width);
        if (minWidth != null && minWidth <= 0) {
          addWarning(context, `${tileLabel}.constraints.minWidth should be > 0 when present`);
        }
        const minHeight = toFiniteNumber(tile.constraints.minHeight ?? tile.constraints.min_height);
        if (minHeight != null && minHeight <= 0) {
          addWarning(context, `${tileLabel}.constraints.minHeight should be > 0 when present`);
        }
        const aspectRatio = toFiniteNumber(tile.constraints.aspectRatio ?? tile.constraints.aspect_ratio);
        if (aspectRatio != null && aspectRatio <= 0) {
          addWarning(context, `${tileLabel}.constraints.aspectRatio should be > 0 when present`);
        }
        if (
          tile.constraints.maximizedOnly != null
          && typeof tile.constraints.maximizedOnly !== 'boolean'
        ) {
          addWarning(context, `${tileLabel}.constraints.maximizedOnly should be a boolean when present`);
        }
      }

      if (tile.panelFocus != null) {
        if (typeof tile.panelFocus !== 'string') {
          addWarning(context, `${tileLabel}.panelFocus should be a string when present`);
        } else if (!panelInfo.panels.has(tile.panelFocus.trim())) {
          addWarning(context, `${tileLabel}.panelFocus references unknown panel ${tile.panelFocus}`);
        }
      }
    }

    if (preset.tileMode != null && typeof preset.tileMode !== 'object') {
      addWarning(context, `${label}.tileMode should be an object when present`);
    } else if (preset.tileMode) {
      const snap = toFiniteNumber(preset.tileMode.snap);
      if (snap != null && snap <= 0) {
        addWarning(context, `${label}.tileMode.snap should be > 0 when present`);
      }
      if (preset.tileMode.grid != null) {
        if (!Array.isArray(preset.tileMode.grid) || preset.tileMode.grid.length !== 2) {
          addWarning(context, `${label}.tileMode.grid should be a [columns, rows] array when present`);
        } else {
          const [cols, rows] = preset.tileMode.grid;
          if (!Number.isFinite(Number(cols)) || Number(cols) <= 0) {
            addWarning(context, `${label}.tileMode.grid[0] should be > 0`);
          }
          if (!Number.isFinite(Number(rows)) || Number(rows) <= 0) {
            addWarning(context, `${label}.tileMode.grid[1] should be > 0`);
          }
        }
      }
      if (preset.tileMode.focus != null) {
        if (typeof preset.tileMode.focus !== 'object') {
          addWarning(context, `${label}.tileMode.focus should be an object when present`);
        } else {
          if (preset.tileMode.focus.retainHud != null && typeof preset.tileMode.focus.retainHud !== 'boolean') {
            addWarning(context, `${label}.tileMode.focus.retainHud should be a boolean when present`);
          }
          const animationMs = toFiniteNumber(preset.tileMode.focus.animationMs ?? preset.tileMode.focus.animation_ms);
          if (animationMs != null && animationMs < 0) {
            addWarning(context, `${label}.tileMode.focus.animationMs should be ≥ 0 when present`);
          }
        }
      }
    }

    totalTiles += tilesArray.length;
  }

  context.stats.uiWorkspaces = presetIds.size;
  context.stats.uiWorkspaceTiles = totalTiles;
}

function validateAlertCondition(condition, { context, panelId, controlsByPanel, path }) {
  if (!condition || typeof condition !== 'object') {
    addWarning(context, `${path} is not an object`);
    return;
  }

  if (condition.any != null) {
    if (!Array.isArray(condition.any)) {
      addWarning(context, `${path}.any should be an array when present`);
    } else if (condition.any.length === 0) {
      addWarning(context, `${path}.any should not be empty`);
    } else {
      for (const [index, entry] of condition.any.entries()) {
        validateAlertCondition(entry, {
          context,
          panelId,
          controlsByPanel,
          path: `${path}.any[${index}]`,
        });
      }
    }
  }

  if (condition.control != null) {
    const targetPanelId = normalizeString(condition.panel) || panelId;
    const controlId = normalizeString(condition.control);
    if (!controlId) {
      addWarning(context, `${path}.control should be a string`);
    } else {
      const targetPanel = controlsByPanel.get(targetPanelId);
      if (!targetPanel) {
        addWarning(
          context,
          `${path}.control references panel ${targetPanelId} which is not defined`,
        );
      } else {
        const control = targetPanel.controls.get(controlId);
        if (!control) {
          addWarning(
            context,
            `${path}.control references unknown control ${controlId} on panel ${targetPanelId}`,
          );
        } else if (condition.state != null) {
          const stateId = normalizeString(condition.state);
          if (!stateId) {
            addWarning(context, `${path}.state should be a string when present`);
          } else if (!control.states.has(stateId)) {
            addWarning(
              context,
              `${path}.state references unknown state ${stateId} on control ${controlId}`,
            );
          }
        }
      }
    }
  }

  if (condition.flag != null && typeof condition.flag !== 'string') {
    addWarning(context, `${path}.flag should be a string when present`);
  }

  if (condition.resource != null) {
    if (typeof condition.resource !== 'string') {
      addWarning(context, `${path}.resource should be a string when present`);
    }
    const operatorRaw = condition.operator ?? condition.op;
    if (operatorRaw != null) {
      const operator = typeof operatorRaw === 'string' ? operatorRaw.trim() : '';
      if (!UI_RESOURCE_OPERATORS.has(operator)) {
        addWarning(context, `${path}.operator should be one of ${[...UI_RESOURCE_OPERATORS].join(', ')}`);
      }
    }
    if (condition.value != null && toFiniteNumber(condition.value) == null) {
      addWarning(context, `${path}.value should be numeric when resource comparisons are defined`);
    }
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

async function validateThrusters(context) {
  const filePath = path.resolve(DATA_DIR, 'thrusters.json');
  let parsed;
  try {
    const content = await fs.readFile(filePath, 'utf8');
    parsed = JSON.parse(content);
  } catch (error) {
    addError(context, `Failed to read thrusters.json: ${error.message}`);
    return;
  }

  if (!parsed || typeof parsed !== 'object') {
    addError(context, 'Thruster dataset is not a valid JSON object');
    return;
  }

  const craftEntries = Array.isArray(parsed.craft) ? parsed.craft : [];
  if (craftEntries.length === 0) {
    addWarning(context, 'Thruster dataset defines no craft entries');
    context.stats.thrusterCraft = 0;
    context.stats.thrusters = 0;
    return;
  }

  const craftIds = new Set();
  const thrusterIds = new Set();
  let thrusterCount = 0;

  for (const [index, craft] of craftEntries.entries()) {
    const craftLabel = `thrusters.craft[${index}]`;
    if (!craft || typeof craft !== 'object') {
      addError(context, `${craftLabel} is not an object`);
      continue;
    }

    const craftId = typeof craft.id === 'string' ? craft.id.trim() : '';
    if (!craftId) {
      addError(context, `${craftLabel} is missing an id`);
    } else if (craftIds.has(craftId)) {
      addError(context, `${craftLabel} duplicate id ${craftId}`);
    } else {
      craftIds.add(craftId);
    }

    const tankKey = typeof craft.propellant_tank === 'string' ? craft.propellant_tank.trim() : '';
    if (!tankKey) {
      addWarning(context, `${craftLabel} is missing propellant_tank reference`);
    } else if (context.refs?.propellantTanks && !context.refs.propellantTanks.has(tankKey)) {
      addWarning(context, `${craftLabel} references unknown propellant_tank ${tankKey}`);
    }

    const rcs = craft.rcs;
    if (!rcs || typeof rcs !== 'object') {
      addError(context, `${craftLabel} is missing rcs configuration`);
      continue;
    }

    const defaults = rcs.defaults ?? {};
    const defaultThrust = toFiniteNumber(defaults.thrust_newtons);
    const defaultIsp = toFiniteNumber(defaults.isp_seconds);
    const defaultMinPulse = toFiniteNumber(defaults.min_impulse_seconds);
    const defaultDuty = toFiniteNumber(defaults.max_duty_cycle);

    const clusters = Array.isArray(rcs.clusters) ? rcs.clusters : [];
    if (clusters.length === 0) {
      addWarning(context, `${craftLabel} has no RCS clusters defined`);
      continue;
    }

    for (const [clusterIndex, cluster] of clusters.entries()) {
      const clusterLabel = `${craftLabel}.clusters[${clusterIndex}]`;
      if (!cluster || typeof cluster !== 'object') {
        addError(context, `${clusterLabel} is not an object`);
        continue;
      }

      const clusterId = typeof cluster.id === 'string' ? cluster.id.trim() : '';
      if (!clusterId) {
        addWarning(context, `${clusterLabel} is missing an id`);
      }

      const radiusValue = cluster.radius_m;
      if (radiusValue != null && !isFiniteNumber(radiusValue)) {
        addWarning(context, `${clusterLabel}.radius_m should be numeric when present`);
      }
      const angleValue = cluster.angle_deg;
      if (angleValue != null && !isFiniteNumber(angleValue)) {
        addWarning(context, `${clusterLabel}.angle_deg should be numeric when present`);
      }
      const zValue = cluster.z_m;
      if (zValue != null && !isFiniteNumber(zValue)) {
        addWarning(context, `${clusterLabel}.z_m should be numeric when present`);
      }

      const clusterThrust = toFiniteNumber(cluster.thrust_newtons);
      const clusterIsp = toFiniteNumber(cluster.isp_seconds);
      const clusterMinPulse = toFiniteNumber(cluster.min_impulse_seconds);
      const clusterDuty = toFiniteNumber(cluster.max_duty_cycle);

      const thrusters = Array.isArray(cluster.thrusters) ? cluster.thrusters : [];
      if (thrusters.length === 0) {
        addWarning(context, `${clusterLabel} contains no thrusters`);
        continue;
      }

      for (const [thrusterIndex, thruster] of thrusters.entries()) {
        const thrusterLabel = `${clusterLabel}.thrusters[${thrusterIndex}]`;
        if (!thruster || typeof thruster !== 'object') {
          addError(context, `${thrusterLabel} is not an object`);
          continue;
        }

        const thrusterId = typeof thruster.id === 'string' ? thruster.id.trim() : '';
        if (!thrusterId) {
          addError(context, `${thrusterLabel} is missing an id`);
        } else if (thrusterIds.has(thrusterId)) {
          addError(context, `${thrusterLabel} duplicate id ${thrusterId}`);
        } else {
          thrusterIds.add(thrusterId);
        }

        const translationAxis = typeof thruster.translation_axis === 'string'
          ? thruster.translation_axis.trim().toUpperCase()
          : '';
        if (!translationAxis) {
          addWarning(context, `${thrusterLabel} is missing translation_axis`);
        } else if (!VALID_TRANSLATION_AXES.has(translationAxis)) {
          addWarning(context, `${thrusterLabel} has unexpected translation_axis ${translationAxis}`);
        }

        const torqueAxesRaw = Array.isArray(thruster.torque_axes)
          ? thruster.torque_axes
          : thruster.torque_axis != null
            ? [thruster.torque_axis]
            : [];
        if (torqueAxesRaw.length === 0) {
          addWarning(context, `${thrusterLabel} lists no torque_axes`);
        }
        for (const axis of torqueAxesRaw) {
          const normalized = typeof axis === 'string' ? axis.trim().toLowerCase() : '';
          if (!normalized) {
            addWarning(context, `${thrusterLabel} torque_axes entry is empty`);
            continue;
          }
          if (!VALID_TORQUE_AXES.has(normalized)) {
            addWarning(context, `${thrusterLabel} has unexpected torque axis ${axis}`);
          }
        }

        const thrusterThrust = toFiniteNumber(thruster.thrust_newtons)
          ?? clusterThrust
          ?? defaultThrust;
        if (thrusterThrust == null || thrusterThrust <= 0) {
          addWarning(context, `${thrusterLabel} is missing a valid thrust_newtons value`);
        }

        const thrusterIsp = toFiniteNumber(thruster.isp_seconds) ?? clusterIsp ?? defaultIsp;
        if (thrusterIsp == null || thrusterIsp <= 0) {
          addWarning(context, `${thrusterLabel} is missing a valid isp_seconds value`);
        }

        const minPulse = toFiniteNumber(thruster.min_impulse_seconds) ?? clusterMinPulse ?? defaultMinPulse;
        if (minPulse == null || minPulse < 0) {
          addWarning(context, `${thrusterLabel} min_impulse_seconds should be ≥ 0`);
        }

        const duty = toFiniteNumber(thruster.max_duty_cycle) ?? clusterDuty ?? defaultDuty;
        if (duty != null && (duty < 0 || duty > 1)) {
          addWarning(context, `${thrusterLabel} max_duty_cycle should be between 0 and 1`);
        }

        const vector = thruster.approximate_vector;
        if (vector != null) {
          const { x, y, z } = vector;
          if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) {
            addWarning(context, `${thrusterLabel}.approximate_vector should include numeric x, y, z`);
          }
        }

        thrusterCount += 1;
      }
    }
  }

  context.stats.thrusterCraft = craftIds.size;
  context.stats.thrusters = thrusterCount;
  context.refs.rcsCraftIds = craftIds;
  context.refs.rcsThrusterIds = thrusterIds;
  validateAutopilotRcsReferences(context, { craftIds, thrusterIds });
}

function validateAutopilotRcsReferences(context, { craftIds, thrusterIds }) {
  const craftReferences = context.refs?.autopilotCraftIds;
  if (craftReferences && craftReferences.size > 0) {
    for (const craftId of craftReferences) {
      if (!craftIds.has(craftId)) {
        addWarning(context, `Autopilot references unknown RCS craft ${craftId}`);
      }
    }
  }

  const thrusterReferences = context.refs?.autopilotThrusterIds;
  if (thrusterReferences && thrusterReferences.size > 0) {
    for (const thrusterId of thrusterReferences) {
      if (!thrusterIds.has(thrusterId)) {
        addWarning(context, `Autopilot references unknown RCS thruster ${thrusterId}`);
      }
    }
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

function trackReference(context, refKey, value) {
  if (!value || value.length === 0) {
    return;
  }
  if (!context.refs[refKey]) {
    context.refs[refKey] = new Set();
  }
  context.refs[refKey].add(value);
}

function trackReferenceList(context, refKey, values) {
  if (!values || values.length === 0) {
    return;
  }
  if (!context.refs[refKey]) {
    context.refs[refKey] = new Set();
  }
  for (const value of values) {
    if (value && value.length > 0) {
      context.refs[refKey].add(value);
    }
  }
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

function toFiniteNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeString(value) {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return '';
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

if (process.argv[1]) {
  const invokedPathUrl = pathToFileURL(process.argv[1]);
  if (import.meta.url === invokedPathUrl.href) {
    main().catch((error) => {
      console.error('Mission data validation failed to execute:', error);
      process.exitCode = 1;
    });
  }
}
