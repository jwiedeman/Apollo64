import fs from 'fs/promises';
import path from 'path';
import { formatGET } from '../utils/time.js';

const DEFAULT_OPTIONS = {
  includeAutoActionsOnly: true,
  scriptActor: 'MANUAL_CREW',
  groupEpsilonSeconds: 1 / 20,
  includeNotes: true,
};

export class ManualActionRecorder {
  constructor(options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.checklistEntries = [];
    this.dskyEntries = [];
    this.metrics = {
      checklist: {
        total: 0,
        auto: 0,
        manual: 0,
      },
      dsky: {
        total: 0,
        auto: 0,
        manual: 0,
      },
      events: new Map(),
    };
  }

  recordChecklistAck({
    eventId,
    checklistId = null,
    stepNumber = null,
    getSeconds,
    actor = 'AUTO_CREW',
    note = null,
  }) {
    if (!eventId || !Number.isFinite(getSeconds)) {
      return;
    }

    this.checklistEntries.push({
      eventId,
      checklistId,
      stepNumber,
      getSeconds,
      actor,
      note,
    });

    this.metrics.checklist.total += 1;
    if (actor === 'AUTO_CREW') {
      this.metrics.checklist.auto += 1;
    } else {
      this.metrics.checklist.manual += 1;
    }

    const current = this.metrics.events.get(eventId) ?? 0;
    this.metrics.events.set(eventId, current + 1);
  }

  recordDskyEntry({
    id = null,
    getSeconds,
    eventId = null,
    autopilotId = null,
    macroId = null,
    verb = null,
    noun = null,
    program = null,
    registers = null,
    sequence = null,
    actor = 'AUTO_CREW',
    note = null,
  } = {}) {
    if (!Number.isFinite(getSeconds)) {
      return;
    }

    const entryId = id ?? this.#generateDskyId();
    const normalizedActor = actor ?? 'AUTO_CREW';
    const normalizedRegisters = this.#cloneRegisters(registers);
    const normalizedSequence = this.#cloneSequence(sequence);

    this.dskyEntries.push({
      id: entryId,
      getSeconds,
      eventId,
      autopilotId,
      macroId: this.#normalizeString(macroId),
      verb: this.#normalizeVerbOrNoun(verb),
      noun: this.#normalizeVerbOrNoun(noun),
      program: this.#normalizeString(program),
      registers: normalizedRegisters,
      sequence: normalizedSequence,
      actor: normalizedActor,
      note: this.#normalizeString(note),
    });

    this.metrics.dsky.total += 1;
    if (normalizedActor === 'AUTO_CREW') {
      this.metrics.dsky.auto += 1;
    } else {
      this.metrics.dsky.manual += 1;
    }
  }

  stats() {
    return {
      checklist: {
        ...this.metrics.checklist,
      },
      dsky: { ...this.metrics.dsky },
      events: Array.from(this.metrics.events.entries()).map(([eventId, count]) => ({
        eventId,
        count,
      })),
    };
  }

  buildScriptActions() {
    const autoOnly = this.options.includeAutoActionsOnly;
    const epsilon = this.options.groupEpsilonSeconds ?? DEFAULT_OPTIONS.groupEpsilonSeconds;

    const filtered = this.checklistEntries
      .filter((entry) => !autoOnly || entry.actor === 'AUTO_CREW')
      .sort((a, b) => {
        if (a.getSeconds !== b.getSeconds) {
          return a.getSeconds - b.getSeconds;
        }
        if (a.eventId !== b.eventId) {
          return a.eventId < b.eventId ? -1 : 1;
        }
        return (a.stepNumber ?? 0) - (b.stepNumber ?? 0);
      });

    const checklistActions = [];
    let group = null;

    const flushGroup = () => {
      if (!group) {
        return;
      }
      checklistActions.push(this.#groupToAction(group));
      group = null;
    };

    for (const entry of filtered) {
      if (!group) {
        group = this.#createGroup(entry);
        continue;
      }

      const sameEvent = group.eventId === entry.eventId;
      const sameTime = Math.abs(group.getSeconds - entry.getSeconds) <= epsilon;

      if (sameEvent && sameTime) {
        group.count += 1;
        group.lastStepNumber = entry.stepNumber ?? group.lastStepNumber;
        if (!group.note && entry.note) {
          group.note = entry.note;
        }
        continue;
      }

      flushGroup();
      group = this.#createGroup(entry);
    }

    flushGroup();

    const dskyActions = this.dskyEntries
      .filter((entry) => !autoOnly || entry.actor === 'AUTO_CREW')
      .map((entry) => this.#dskyEntryToAction(entry));

    const combined = [...checklistActions, ...dskyActions];
    combined.sort((a, b) => {
      if (a.get_seconds !== b.get_seconds) {
        return a.get_seconds - b.get_seconds;
      }
      return a.id.localeCompare(b.id);
    });

    return combined;
  }

  toJSON() {
    const actions = this.buildScriptActions();
    return {
      metadata: {
        generated_at: new Date().toISOString(),
        include_auto_actions_only: Boolean(this.options.includeAutoActionsOnly),
        script_actor: this.options.scriptActor,
        checklist_entries_recorded: this.metrics.checklist.total,
        dsky_entries_recorded: this.metrics.dsky.total,
        actions: actions.length,
      },
      actions,
    };
  }

  async writeScript(filePath, { pretty = true } = {}) {
    if (!filePath) {
      return null;
    }

    const absolutePath = path.resolve(filePath);
    const directory = path.dirname(absolutePath);
    await fs.mkdir(directory, { recursive: true });

    const payload = this.toJSON();
    const json = pretty ? JSON.stringify(payload, null, 2) : JSON.stringify(payload);
    await fs.writeFile(absolutePath, json, 'utf8');

    return {
      path: absolutePath,
      actions: payload.actions.length,
      checklistEntries: this.metrics.checklist.total,
    };
  }

  #createGroup(entry) {
    return {
      eventId: entry.eventId,
      checklistId: entry.checklistId,
      getSeconds: entry.getSeconds,
      firstStepNumber: entry.stepNumber ?? null,
      lastStepNumber: entry.stepNumber ?? null,
      note: entry.note ?? null,
      count: 1,
    };
  }

  #groupToAction(group) {
    const formattedGet = formatGET(group.getSeconds);
    const stepLabel = this.#formatStepRange(group.firstStepNumber, group.lastStepNumber);
    const note = this.options.includeNotes
      ? this.#buildNote(group, formattedGet)
      : undefined;

    const action = {
      id: `${group.eventId}_${stepLabel}`,
      type: 'checklist_ack',
      event_id: group.eventId,
      get_seconds: Number(group.getSeconds.toFixed(3)),
      count: group.count,
      actor: this.options.scriptActor,
    };

    if (group.checklistId) {
      action.checklist_id = group.checklistId;
    }
    action.display_get = formattedGet;

    if (note) {
      action.note = note;
    }

    return action;
  }

  #generateDskyId() {
    return `DSKY_${this.dskyEntries.length + 1}`;
  }

  #normalizeString(value) {
    if (value == null) {
      return null;
    }
    const trimmed = String(value).trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  #normalizeVerbOrNoun(value) {
    if (value == null) {
      return null;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Number.parseInt(value, 10);
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        return null;
      }
      const parsed = Number.parseInt(trimmed, 10);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  #cloneRegisters(raw) {
    if (!raw || typeof raw !== 'object') {
      return {};
    }
    const registers = {};
    if (Array.isArray(raw)) {
      raw.forEach((value, index) => {
        const normalized = this.#normalizeRegisterValue(value);
        if (normalized != null) {
          registers[`R${index + 1}`] = normalized;
        }
      });
      return registers;
    }
    for (const [key, value] of Object.entries(raw)) {
      const normalizedKey = this.#normalizeString(key)?.toUpperCase();
      if (!normalizedKey) {
        continue;
      }
      const normalizedValue = this.#normalizeRegisterValue(value);
      if (normalizedValue != null) {
        registers[normalizedKey] = normalizedValue;
      }
    }
    return registers;
  }

  #normalizeRegisterValue(value) {
    if (value == null) {
      return null;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value.toString();
    }
    return null;
  }

  #cloneSequence(raw) {
    if (!raw) {
      return [];
    }
    if (Array.isArray(raw)) {
      return raw
        .map((entry) => (entry == null ? '' : String(entry).trim()))
        .filter((entry) => entry.length > 0);
    }
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (trimmed.length === 0) {
        return [];
      }
      if (trimmed.includes('\n')) {
        return trimmed
          .split('\n')
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0);
      }
      if (trimmed.includes(',')) {
        return trimmed
          .split(',')
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0);
      }
      return [trimmed];
    }
    return [];
  }

  #dskyEntryToAction(entry) {
    const formattedGet = formatGET(entry.getSeconds);
    const registers = entry.registers && Object.keys(entry.registers).length > 0
      ? { ...entry.registers }
      : undefined;
    const sequence = entry.sequence && entry.sequence.length > 0 ? [...entry.sequence] : undefined;

    const action = {
      id: entry.id ?? this.#generateDskyId(),
      type: 'dsky_entry',
      get_seconds: Number(entry.getSeconds.toFixed(3)),
      display_get: formattedGet,
      source: entry.autopilotId ? `autopilot:${entry.autopilotId}` : (entry.id ?? undefined),
    };

    if (entry.eventId) {
      action.event_id = entry.eventId;
    }
    if (entry.autopilotId) {
      action.autopilot_id = entry.autopilotId;
    }
    if (entry.macroId) {
      action.macro = entry.macroId;
    }
    if (Number.isFinite(entry.verb)) {
      action.verb = entry.verb;
    }
    if (Number.isFinite(entry.noun)) {
      action.noun = entry.noun;
    }
    if (entry.program) {
      action.program = entry.program;
    }
    if (registers) {
      action.registers = registers;
    }
    if (sequence) {
      action.sequence = sequence;
    }
    if (entry.note) {
      action.note = entry.note;
    }

    return action;
  }

  #formatStepRange(first, last) {
    const format = (value) => {
      if (value == null) {
        return 'STEP';
      }
      return value.toString().padStart(3, '0');
    };
    if (first == null || last == null || first === last) {
      return `STEP_${format(first ?? last)}`;
    }
    return `STEPS_${format(first)}-${format(last)}`;
  }

  #buildNote(group, formattedGet) {
    const stepLabel = this.#formatStepRange(group.firstStepNumber, group.lastStepNumber);
    if (group.note) {
      return `Recorded auto crew ${stepLabel} at GET ${formattedGet} — ${group.note}`;
    }
    return `Recorded auto crew ${stepLabel} at GET ${formattedGet}`;
  }
}
