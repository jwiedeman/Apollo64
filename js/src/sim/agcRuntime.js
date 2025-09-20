import { formatGET } from '../utils/time.js';

const DEFAULT_OPTIONS = {
  historyLimit: 16,
};

const DEFAULT_ANNUNCIATORS = Object.freeze({
  pro: false,
  keyRel: false,
  oprErr: false,
  temp: false,
  gimbalLock: false,
});

const ENTRY_MODES = new Set(['entry', 'monitor', 'utility']);

export class AgcRuntime {
  constructor({ logger = null, macros = null, options = {} } = {}) {
    this.logger = logger ?? null;
    this.options = { ...DEFAULT_OPTIONS, ...(options ?? {}) };
    this.historyLimit = Math.max(1, Number(this.options.historyLimit) || DEFAULT_OPTIONS.historyLimit);

    this.macros = new Map();
    this.sequence = 0;
    this.metrics = {
      commands: 0,
      macros: 0,
      rejected: 0,
      acknowledged: 0,
    };

    this.state = this.#createInitialState();

    if (macros) {
      this.loadMacros(macros);
    }
  }

  loadMacros(bundle) {
    const entries = this.#normalizeMacroBundle(bundle);
    this.macros.clear();
    for (const macro of entries) {
      this.macros.set(macro.id, macro);
    }
    this.state.catalogVersion = typeof bundle?.version === 'number' ? bundle.version : null;
    this.state.catalogDescription = typeof bundle?.description === 'string' ? bundle.description : null;
  }

  getMacro(id) {
    if (!id) {
      return null;
    }
    return this.macros.get(id) ?? null;
  }

  executeEntry(entry, metadata = {}) {
    const normalized = this.#normalizeEntry(entry, metadata);
    const macro = normalized.macroId ? this.getMacro(normalized.macroId) : null;

    const result = this.#evaluateEntry(normalized, macro);
    this.#applyResult(result);

    return result;
  }

  acknowledge(details = {}) {
    if (!this.state.pendingAck) {
      return false;
    }

    const getSeconds = this.#coerceNumber(details.getSeconds);
    const actor = this.#cleanString(details.actor) || 'CREW';
    const source = this.#cleanString(details.source) || 'manual';
    const note = this.#cleanString(details.note) || null;

    const pending = this.state.pendingAck;
    this.state.pendingAck = null;
    this.state.annunciators = {
      ...this.state.annunciators,
      pro: false,
      keyRel: false,
    };
    this.metrics.acknowledged += 1;

    this.#log(getSeconds, `AGC PRO acknowledged for ${pending.macroId ?? 'macro'}`, {
      logSeverity: 'notice',
      macroId: pending.macroId ?? null,
      macroLabel: pending.macroLabel ?? null,
      program: pending.program ?? null,
      actor,
      source,
      note,
      context: 'acknowledge',
    });

    return true;
  }

  snapshot() {
    const registers = Array.from(this.state.registers.values()).map((entry) => ({ ...entry }));
    const history = this.state.history.map((item) => ({ ...item, registers: item.registers ? { ...item.registers } : {} }));
    const pendingAck = this.state.pendingAck ? { ...this.state.pendingAck } : null;

    return {
      catalogVersion: this.state.catalogVersion ?? null,
      catalogDescription: this.state.catalogDescription ?? null,
      program: { ...this.state.program },
      display: { ...this.state.display },
      annunciators: { ...this.state.annunciators },
      registers,
      history,
      pendingAck,
      lastUpdatedSeconds: this.state.lastUpdatedSeconds,
      metrics: { ...this.metrics },
    };
  }

  stats() {
    return {
      macrosLoaded: this.macros.size,
      commands: this.metrics.commands,
      rejected: this.metrics.rejected,
      acknowledged: this.metrics.acknowledged,
      pendingAck: Boolean(this.state.pendingAck),
      lastProgram: this.state.program.current ?? null,
      lastVerb: this.state.display.verb ?? null,
      lastNoun: this.state.display.noun ?? null,
    };
  }

  #applyResult(result) {
    if (!result || result.status === 'ignored') {
      return;
    }

    if (result.status === 'rejected') {
      this.metrics.rejected += 1;
      this.metrics.commands += 1;
      this.#setAnnunciators({ oprErr: true, pro: false, keyRel: false });
      this.state.pendingAck = null;
      return;
    }

    this.metrics.commands += 1;
    if (result.macroId) {
      this.metrics.macros += 1;
    }

    const historyEntry = {
      id: result.commandId,
      macroId: result.macroId ?? null,
      macroLabel: result.macroLabel ?? null,
      program: result.program ?? null,
      verb: result.verb ?? null,
      noun: result.noun ?? null,
      verbLabel: result.verbLabel ?? null,
      nounLabel: result.nounLabel ?? null,
      mode: result.mode ?? null,
      actor: result.actor ?? null,
      source: result.source ?? null,
      autopilotId: result.autopilotId ?? null,
      eventId: result.eventId ?? null,
      getSeconds: result.getSeconds ?? null,
      get: Number.isFinite(result.getSeconds) ? formatGET(result.getSeconds) : null,
      note: result.note ?? null,
      registers: result.registerValues ? { ...result.registerValues } : {},
      issues: result.issues?.map((issue) => ({ ...issue })) ?? [],
    };

    this.state.history.unshift(historyEntry);
    if (this.state.history.length > this.historyLimit) {
      this.state.history.length = this.historyLimit;
    }

    const registerSnapshot = new Map();
    for (const info of result.registerDisplay ?? []) {
      registerSnapshot.set(info.id, { ...info });
    }
    this.state.registers = registerSnapshot;

    this.state.program = {
      current: result.program ?? this.state.program.current ?? null,
      majorMode: result.majorMode ?? this.state.program.majorMode ?? null,
      subMode: result.subMode ?? this.state.program.subMode ?? null,
    };
    this.state.display = {
      verb: result.verb ?? null,
      noun: result.noun ?? null,
      verbLabel: result.verbLabel ?? null,
      nounLabel: result.nounLabel ?? null,
      macroId: result.macroId ?? null,
      macroLabel: result.macroLabel ?? null,
      mode: result.mode ?? null,
    };
    this.state.lastUpdatedSeconds = result.getSeconds ?? null;

    this.#setAnnunciators({
      pro: result.requiresAck,
      keyRel: result.keyRelLamp ?? false,
      oprErr: false,
    });

    this.state.pendingAck = result.requiresAck
      ? {
          macroId: result.macroId ?? null,
          macroLabel: result.macroLabel ?? null,
          program: result.program ?? null,
          issuedAtSeconds: result.getSeconds ?? null,
        }
      : null;
  }

  #evaluateEntry(entry, macro) {
    const issues = [];
    const commandId = this.#nextCommandId();
    const verb = this.#resolveVerb(entry, macro, issues);
    const noun = this.#resolveNoun(entry, macro, issues);
    const verbLabel = formatVerbOrNoun(verb);
    const nounLabel = formatVerbOrNoun(noun);
    const mode = macro?.mode ?? entry.mode ?? null;
    const normalizedMode = ENTRY_MODES.has((mode ?? '').toLowerCase()) ? mode.toLowerCase() : null;
    const program = this.#cleanString(entry.program) || macro?.program || this.state.program.current || null;

    let status = 'accepted';
    if (!Number.isFinite(verb) || !Number.isFinite(noun)) {
      status = 'rejected';
      issues.push({ message: 'Verb/Noun missing or non-numeric' });
    }

    const registerDisplay = this.#mergeRegisterDefinitions(macro, entry.registers);
    const registerValues = this.#buildRegisterValueMap(registerDisplay);

    const sequence = Array.isArray(entry.sequence) ? entry.sequence.map((step) => step.toUpperCase()) : [];
    const includesPro = sequence.includes('PRO');
    const includesKeyRel = sequence.includes('KEY REL') || sequence.includes('KEYREL');

    const requiresAck = normalizedMode === 'entry' && !includesPro;
    const keyRelLamp = normalizedMode === 'entry' && !includesKeyRel ? this.state.annunciators.keyRel : false;

    const logSeverity = status === 'rejected' ? 'warning' : 'notice';
    this.#log(entry.getSeconds, this.#formatLogMessage(status, macro, verbLabel, nounLabel), {
      logSeverity,
      macroId: entry.macroId ?? null,
      macroLabel: macro?.label ?? null,
      program,
      verb: Number.isFinite(verb) ? verb : null,
      noun: Number.isFinite(noun) ? noun : null,
      verbLabel,
      nounLabel,
      actor: entry.actor ?? null,
      source: entry.source ?? null,
      autopilotId: entry.autopilotId ?? null,
      eventId: entry.eventId ?? null,
      registerValues,
      sequence: entry.sequence ?? [],
      note: entry.note ?? null,
      issues,
    });

    if (status === 'rejected') {
      return {
        status,
        commandId,
        macroId: entry.macroId ?? null,
        macroLabel: macro?.label ?? null,
        verb: Number.isFinite(verb) ? verb : null,
        noun: Number.isFinite(noun) ? noun : null,
        verbLabel,
        nounLabel,
        program,
        getSeconds: entry.getSeconds ?? null,
        actor: entry.actor ?? null,
        source: entry.source ?? null,
        autopilotId: entry.autopilotId ?? null,
        eventId: entry.eventId ?? null,
        note: entry.note ?? null,
        issues,
      };
    }

    if (includesPro) {
      this.metrics.acknowledged += 1;
    }

    return {
      status: 'applied',
      commandId,
      macroId: entry.macroId ?? null,
      macroLabel: macro?.label ?? null,
      mode: normalizedMode ?? null,
      verb,
      noun,
      verbLabel,
      nounLabel,
      program,
      majorMode: macro?.majorMode ?? null,
      subMode: macro?.subMode ?? null,
      getSeconds: entry.getSeconds ?? null,
      actor: entry.actor ?? null,
      source: entry.source ?? null,
      autopilotId: entry.autopilotId ?? null,
      eventId: entry.eventId ?? null,
      note: entry.note ?? null,
      registerDisplay,
      registerValues,
      issues,
      requiresAck,
      keyRelLamp: requiresAck ? keyRelLamp : includesKeyRel && this.state.annunciators.keyRel,
    };
  }

  #mergeRegisterDefinitions(macro, providedRegisters) {
    const map = new Map();
    if (Array.isArray(macro?.registers)) {
      for (const def of macro.registers) {
        const id = this.#cleanString(def.id);
        if (!id) {
          continue;
        }
        map.set(id, {
          id,
          label: this.#cleanString(def.label) || id,
          units: this.#cleanString(def.units) || null,
          format: this.#cleanString(def.format) || null,
          value: null,
        });
      }
    }

    if (providedRegisters && typeof providedRegisters === 'object') {
      for (const [key, value] of Object.entries(providedRegisters)) {
        const id = this.#cleanString(key);
        if (!id) {
          continue;
        }
        const display = map.get(id) ?? {
          id,
          label: id,
          units: null,
          format: null,
          value: null,
        };
        display.value = typeof value === 'number' ? value : this.#cleanString(value) || String(value ?? '');
        map.set(id, display);
      }
    }

    return Array.from(map.values());
  }

  #buildRegisterValueMap(entries) {
    const values = {};
    for (const entry of entries) {
      values[entry.id] = entry.value ?? null;
    }
    return values;
  }

  #resolveVerb(entry, macro, issues) {
    if (Number.isFinite(entry.verb)) {
      const intVerb = Number.parseInt(entry.verb, 10);
      if (Number.isFinite(intVerb)) {
        if (Number.isFinite(macro?.verb) && intVerb !== Number(macro.verb)) {
          issues.push({
            message: 'Verb differs from macro definition',
            macroVerb: Number(macro.verb),
            entryVerb: intVerb,
          });
        }
        return intVerb;
      }
    }

    if (Number.isFinite(macro?.verb)) {
      return Number(macro.verb);
    }

    return null;
  }

  #resolveNoun(entry, macro, issues) {
    if (Number.isFinite(entry.noun)) {
      const intNoun = Number.parseInt(entry.noun, 10);
      if (Number.isFinite(intNoun)) {
        if (Number.isFinite(macro?.noun) && intNoun !== Number(macro.noun)) {
          issues.push({
            message: 'Noun differs from macro definition',
            macroNoun: Number(macro.noun),
            entryNoun: intNoun,
          });
        }
        return intNoun;
      }
    }

    if (Number.isFinite(macro?.noun)) {
      return Number(macro.noun);
    }

    return null;
  }

  #formatLogMessage(status, macro, verbLabel, nounLabel) {
    if (status === 'rejected') {
      return `AGC entry rejected (${macro?.id ?? 'macro'})`;
    }
    const macroLabel = macro?.id ?? 'macro';
    const verbText = verbLabel ? `V${verbLabel}` : 'V??';
    const nounText = nounLabel ? `N${nounLabel}` : 'N??';
    return `AGC ${macroLabel} ${verbText}${nounText}`;
  }

  #log(getSeconds, message, context = {}) {
    if (!this.logger?.log) {
      return;
    }
    const { logSeverity = 'notice', ...rest } = context;
    this.logger.log(getSeconds ?? 0, message, {
      logSource: 'agc',
      logCategory: 'agc',
      logSeverity,
      ...rest,
    });
  }

  #createInitialState() {
    return {
      catalogVersion: null,
      catalogDescription: null,
      program: {
        current: null,
        majorMode: null,
        subMode: null,
      },
      display: {
        verb: null,
        noun: null,
        verbLabel: null,
        nounLabel: null,
        macroId: null,
        macroLabel: null,
        mode: null,
      },
      annunciators: { ...DEFAULT_ANNUNCIATORS },
      registers: new Map(),
      history: [],
      pendingAck: null,
      lastUpdatedSeconds: null,
    };
  }

  #normalizeMacroBundle(bundle) {
    if (!bundle) {
      return [];
    }
    const entries = Array.isArray(bundle.macros) ? bundle.macros : Array.isArray(bundle) ? bundle : [];
    const normalized = [];
    for (const raw of entries) {
      const id = this.#cleanString(raw?.id);
      if (!id) {
        continue;
      }
      const mode = this.#cleanString(raw?.mode);
      normalized.push({
        id,
        label: this.#cleanString(raw?.label) || null,
        description: this.#cleanString(raw?.description) || null,
        verb: this.#coerceNumber(raw?.verb),
        noun: this.#coerceNumber(raw?.noun),
        mode: ENTRY_MODES.has((mode ?? '').toLowerCase()) ? mode.toLowerCase() : null,
        program: this.#cleanString(raw?.program) || null,
        majorMode: this.#cleanString(raw?.majorMode) || null,
        subMode: this.#cleanString(raw?.subMode) || null,
        registers: this.#normalizeRegisterDefs(raw?.registers),
        requires: Array.isArray(raw?.requires) ? raw.requires.map((entry) => ({ ...entry })) : [],
      });
    }
    return normalized;
  }

  #normalizeRegisterDefs(defs) {
    if (!Array.isArray(defs)) {
      return [];
    }
    const normalized = [];
    for (const raw of defs) {
      if (!raw || typeof raw !== 'object') {
        continue;
      }
      const id = this.#cleanString(raw.id);
      if (!id) {
        continue;
      }
      normalized.push({
        id,
        label: this.#cleanString(raw.label) || id,
        units: this.#cleanString(raw.units) || null,
        format: this.#cleanString(raw.format) || null,
      });
    }
    return normalized;
  }

  #normalizeEntry(entry, metadata) {
    const normalizedRegisters = {};
    if (entry && typeof entry.registers === 'object') {
      for (const [key, value] of Object.entries(entry.registers)) {
        const id = this.#cleanString(key);
        if (!id) {
          continue;
        }
        normalizedRegisters[id] = typeof value === 'number' ? value : this.#cleanString(value) || String(value ?? '');
      }
    }

    const sequence = [];
    const rawSequence = entry?.sequence ?? entry?.inputs ?? metadata?.sequence;
    if (Array.isArray(rawSequence)) {
      for (const step of rawSequence) {
        const clean = this.#cleanString(step);
        if (clean) {
          sequence.push(clean);
        }
      }
    }

    return {
      macroId: this.#cleanString(entry?.macroId ?? entry?.macro ?? metadata?.macroId) || null,
      mode: this.#cleanString(entry?.mode) || null,
      verb: this.#coerceNumber(entry?.verb),
      noun: this.#coerceNumber(entry?.noun),
      program: this.#cleanString(entry?.program ?? metadata?.program) || null,
      registers: normalizedRegisters,
      sequence,
      actor: this.#cleanString(entry?.actor ?? metadata?.actor) || null,
      source: this.#cleanString(entry?.source ?? metadata?.source) || null,
      autopilotId: this.#cleanString(entry?.autopilotId ?? metadata?.autopilotId) || null,
      eventId: this.#cleanString(entry?.eventId ?? metadata?.eventId) || null,
      note: this.#cleanString(entry?.note ?? metadata?.note) || null,
      getSeconds: this.#coerceNumber(entry?.getSeconds ?? entry?.time ?? metadata?.getSeconds),
    };
  }

  #setAnnunciators(updates) {
    this.state.annunciators = {
      ...DEFAULT_ANNUNCIATORS,
      ...this.state.annunciators,
      ...updates,
    };
  }

  #nextCommandId() {
    this.sequence += 1;
    return `AGC_CMD_${this.sequence.toString().padStart(5, '0')}`;
  }

  #cleanString(value) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : '';
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
    return '';
  }

  #coerceNumber(value) {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
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
}

function formatVerbOrNoun(value) {
  if (!Number.isFinite(value)) {
    return null;
  }
  const integer = Number.parseInt(value, 10);
  if (!Number.isFinite(integer)) {
    return null;
  }
  return integer.toString().padStart(2, '0');
}
