#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import process from 'process';
import { DATA_DIR } from '../config/paths.js';
import { parseCsv } from '../utils/csv.js';
import { formatGET, parseGET } from '../utils/time.js';

const VALID_TRANSLATION_AXES = new Set(['+X', '-X', '+Y', '-Y', '+Z', '-Z']);
const VALID_TORQUE_AXES = new Set(['+pitch', '-pitch', '+yaw', '-yaw', '+roll', '-roll']);

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
  validateAutopilotPropellantReferences(context);
  await validateCommunicationsTrends(context);
  await validateThrusters(context);
  await validateAudioCues(context);

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

main().catch((error) => {
  console.error('Mission data validation failed to execute:', error);
  process.exitCode = 1;
});
