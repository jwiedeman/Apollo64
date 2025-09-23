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
    this.workspaceEntries = [];
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
      workspace: {
        total: 0,
        byType: new Map(),
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
      workspace: {
        total: this.metrics.workspace.total,
        byType: Array.from(this.metrics.workspace.byType.entries()).map(([type, count]) => ({
          type,
          count,
        })),
      },
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

  recordWorkspaceEvent(event = {}) {
    const normalized = this.#normalizeWorkspaceEvent(event);
    if (!normalized) {
      return;
    }

    this.workspaceEntries.push(normalized);
    this.metrics.workspace.total += 1;
    const currentCount = this.metrics.workspace.byType.get(normalized.type) ?? 0;
    this.metrics.workspace.byType.set(normalized.type, currentCount + 1);
  }

  workspaceSnapshot({ limit = null } = {}) {
    let entries = this.workspaceEntries;
    if (Number.isFinite(limit) && limit >= 0) {
      const start = Math.max(0, entries.length - limit);
      entries = entries.slice(start);
    }
    return {
      total: this.workspaceEntries.length,
      entries: entries.map((entry) => this.#cloneWorkspaceEntry(entry)),
    };
  }

  timelineSnapshot({ limit = null, includeWorkspace = false } = {}) {
    const clamp = (list) => {
      if (!Array.isArray(list)) {
        return [];
      }
      if (!Number.isFinite(limit) || limit < 0) {
        return list.slice();
      }
      const start = Math.max(0, list.length - limit);
      return list.slice(start);
    };

    const summarizeChecklist = () => {
      const entries = clamp(this.checklistEntries);
      const offset = this.checklistEntries.length - entries.length;
      return entries.map((entry, index) => ({
        id: `checklist_${offset + index + 1}`,
        sequence: offset + index,
        eventId: entry.eventId ?? null,
        checklistId: entry.checklistId ?? null,
        stepNumber: entry.stepNumber ?? null,
        getSeconds: entry.getSeconds,
        get: Number.isFinite(entry.getSeconds) ? formatGET(entry.getSeconds) : null,
        actor: entry.actor ?? null,
        note: entry.note ?? null,
      }));
    };

    const summarizeDsky = () => {
      const entries = clamp(this.dskyEntries);
      const offset = this.dskyEntries.length - entries.length;
      return entries.map((entry, index) => ({
        id: entry.id ?? `dsky_${offset + index + 1}`,
        sequence: offset + index,
        getSeconds: entry.getSeconds,
        get: Number.isFinite(entry.getSeconds) ? formatGET(entry.getSeconds) : null,
        eventId: entry.eventId ?? null,
        autopilotId: entry.autopilotId ?? null,
        macroId: entry.macroId ?? null,
        verb: entry.verb ?? null,
        noun: entry.noun ?? null,
        program: entry.program ?? null,
        registers: this.#cloneRegisters(entry.registers),
        sequenceData: this.#cloneSequence(entry.sequence),
        actor: entry.actor ?? 'AUTO_CREW',
        note: entry.note ?? null,
      }));
    };

    const snapshot = {
      summary: this.stats(),
      checklist: summarizeChecklist(),
      dsky: summarizeDsky(),
    };

    if (includeWorkspace) {
      snapshot.workspace = this.workspaceSnapshot({ limit });
    }

    return snapshot;
  }

  toJSON() {
    const actions = this.buildScriptActions();
    const workspace = this.workspaceEntries.map((entry) => this.#workspaceEntryToJson(entry));
    return {
      metadata: {
        generated_at: new Date().toISOString(),
        include_auto_actions_only: Boolean(this.options.includeAutoActionsOnly),
        script_actor: this.options.scriptActor,
        checklist_entries_recorded: this.metrics.checklist.total,
        dsky_entries_recorded: this.metrics.dsky.total,
        workspace_events_recorded: this.metrics.workspace.total,
        actions: actions.length,
      },
      actions,
      workspace,
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
      workspaceEntries: this.metrics.workspace.total,
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

  #generateWorkspaceId(type) {
    const index = this.workspaceEntries.length + 1;
    const sanitized = type.replace(/[^a-z0-9]/gi, '_').toUpperCase();
    return `WORKSPACE_${sanitized}_${index}`;
  }

  #normalizeWorkspaceEvent(event) {
    if (!event || typeof event !== 'object') {
      return null;
    }

    const type = this.#normalizeString(event.type);
    if (!type) {
      return null;
    }

    const getSeconds = this.#coerceNumber(
      event.getSeconds ?? event.timestampSeconds ?? event.time ?? null,
    );
    if (getSeconds == null) {
      return null;
    }

    const entry = {
      id: this.#generateWorkspaceId(type),
      type,
      getSeconds,
      displayGet: formatGET(getSeconds),
      presetId: this.#normalizeString(event.presetId ?? event.preset_id),
      view: this.#normalizeString(event.view),
      tileId: this.#normalizeString(event.tileId ?? event.tile_id),
      pointer: this.#normalizeString(event.pointer),
      source: this.#normalizeString(event.source),
      reason: this.#normalizeString(event.reason),
      key: this.#normalizeString(event.key),
      device: this.#normalizeString(event.device),
      binding: this.#normalizeString(event.binding),
      mutation: this.#cloneWorkspaceMutation(event.mutation),
      value: this.#normalizeWorkspaceValue(event.value),
      quantized: this.#cloneWorkspaceMutation(event.quantized ?? event.quantized_patch),
      previousQuantized: this.#cloneWorkspaceMutation(event.previousQuantized ?? event.previous_quantized),
    };

    return entry;
  }

  #coerceNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  #cloneWorkspaceMutation(raw) {
    if (!raw || typeof raw !== 'object') {
      return null;
    }

    const clone = {};
    for (const [key, value] of Object.entries(raw)) {
      if (['x', 'y', 'width', 'height'].includes(key)) {
        const numeric = this.#coerceNumber(value);
        if (numeric != null) {
          clone[key] = numeric;
        }
      } else if (value != null && typeof value === 'object') {
        const nested = this.#cloneWorkspaceMutation(value);
        if (nested != null && (Array.isArray(nested) ? nested.length > 0 : Object.keys(nested).length > 0)) {
          clone[key] = nested;
        }
      } else if (value !== undefined) {
        clone[key] = value;
      }
    }

    return Object.keys(clone).length > 0 ? clone : null;
  }

  #normalizeWorkspaceValue(value) {
    if (value == null || typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') {
      return Number(value);
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        return null;
      }
      const numeric = this.#coerceNumber(trimmed);
      return numeric != null ? numeric : trimmed;
    }
    if (Array.isArray(value)) {
      return value
        .map((item) => this.#normalizeWorkspaceValue(item))
        .filter((item) => item !== null && item !== undefined);
    }
    if (typeof value === 'object') {
      const result = {};
      for (const [key, nested] of Object.entries(value)) {
        const normalized = this.#normalizeWorkspaceValue(nested);
        if (normalized !== undefined) {
          result[key] = normalized;
        }
      }
      return Object.keys(result).length > 0 ? result : null;
    }
    return null;
  }

  #cloneWorkspaceEntry(entry) {
    if (!entry) {
      return null;
    }
    const clone = { ...entry };
    if (clone.mutation && typeof clone.mutation === 'object') {
      clone.mutation = this.#cloneWorkspaceValue(clone.mutation);
    }
    if (clone.quantized && typeof clone.quantized === 'object') {
      clone.quantized = this.#cloneWorkspaceValue(clone.quantized);
    }
    if (clone.previousQuantized && typeof clone.previousQuantized === 'object') {
      clone.previousQuantized = this.#cloneWorkspaceValue(clone.previousQuantized);
    }
    return clone;
  }

  #workspaceEntryToJson(entry) {
    if (!entry) {
      return null;
    }

    const payload = {
      id: entry.id,
      type: entry.type,
      get_seconds: Number(entry.getSeconds.toFixed(3)),
      display_get: entry.displayGet,
    };

    if (entry.presetId) {
      payload.preset_id = entry.presetId;
    }
    if (entry.view) {
      payload.view = entry.view;
    }
    if (entry.tileId) {
      payload.tile_id = entry.tileId;
    }
    if (entry.pointer) {
      payload.pointer = entry.pointer;
    }
    if (entry.source) {
      payload.source = entry.source;
    }
    if (entry.reason) {
      payload.reason = entry.reason;
    }
    if (entry.key) {
      payload.key = entry.key;
    }
    if (entry.device) {
      payload.device = entry.device;
    }
    if (entry.binding) {
      payload.binding = entry.binding;
    }
    if (entry.value !== undefined) {
      payload.value = entry.value;
    }
    if (entry.mutation) {
      payload.mutation = this.#cloneWorkspaceValue(entry.mutation);
    }
    if (entry.quantized) {
      payload.quantized = this.#cloneWorkspaceValue(entry.quantized);
    }
    if (entry.previousQuantized) {
      payload.previous_quantized = this.#cloneWorkspaceValue(entry.previousQuantized);
    }

    return payload;
  }

  #cloneWorkspaceValue(value) {
    if (value == null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
      return value;
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.#cloneWorkspaceValue(item));
    }
    if (typeof value === 'object') {
      const clone = {};
      for (const [key, nested] of Object.entries(value)) {
        clone[key] = this.#cloneWorkspaceValue(nested);
      }
      return clone;
    }
    return undefined;
  }
}
