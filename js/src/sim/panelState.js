import { formatGET } from '../utils/time.js';

const DEFAULT_HISTORY_LIMIT = 64;
const LOG_SOURCE = 'ui';
const LOG_CATEGORY = 'panel';

function normalizeId(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeKey(value) {
  const id = normalizeId(value);
  return id ? id.toUpperCase() : null;
}

function clonePlain(value) {
  if (value == null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => clonePlain(entry));
  }
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] = clonePlain(entry);
  }
  return result;
}

export class PanelState {
  constructor({
    bundle = null,
    logger = null,
    historyLimit = DEFAULT_HISTORY_LIMIT,
    recorder = null,
    timeProvider = null,
  } = {}) {
    this.logger = logger ?? null;
    this.recorder = recorder ?? null;
    this.timeProvider = typeof timeProvider === 'function' ? timeProvider : () => 0;
    this.historyLimit = Number.isFinite(historyLimit) && historyLimit > 0
      ? Math.floor(historyLimit)
      : DEFAULT_HISTORY_LIMIT;

    this.version = null;
    this.description = null;
    this.panels = new Map();
    this.controls = new Map();
    this.state = new Map();
    this.listeners = new Set();
    this.sequence = 0;
    this.history = [];
    this.metrics = {
      totalPanels: 0,
      totalControls: 0,
      changes: 0,
      lastUpdateSeconds: null,
    };

    if (bundle) {
      this.loadBundle(bundle);
    }
  }

  loadBundle(bundle) {
    this.version = typeof bundle?.version === 'number' ? bundle.version : null;
    this.description = typeof bundle?.description === 'string' ? bundle.description : null;

    this.panels.clear();
    this.controls.clear();
    this.state.clear();
    this.history.length = 0;
    this.sequence = 0;
    this.metrics = {
      totalPanels: 0,
      totalControls: 0,
      changes: 0,
      lastUpdateSeconds: null,
    };

    const panels = this.#extractPanels(bundle);
    for (const panel of panels) {
      const key = normalizeKey(panel.id);
      if (!key) {
        continue;
      }
      const panelEntry = {
        id: panel.id,
        key,
        name: normalizeId(panel.name) ?? panel.id,
        craft: normalizeId(panel.craft),
        tags: Array.isArray(panel.tags) ? panel.tags.map((tag) => normalizeId(tag)).filter(Boolean) : [],
      };
      this.panels.set(key, panelEntry);
      this.metrics.totalPanels += 1;

      const controls = Array.isArray(panel.controls) ? panel.controls : [];
      for (const control of controls) {
        this.#ingestControl(panelEntry, control);
      }
    }

    return this;
  }

  onChange(handler) {
    if (typeof handler !== 'function') {
      return () => {};
    }
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }

  setTimeProvider(provider) {
    if (typeof provider === 'function') {
      this.timeProvider = provider;
    }
  }

  listPanels() {
    return Array.from(this.panels.values()).map((panel) => ({ ...panel }));
  }

  listControls(panelId = null) {
    if (panelId == null) {
      return Array.from(this.controls.values()).map((control) => this.#cloneControl(control));
    }
    const panelKey = normalizeKey(panelId);
    return Array.from(this.controls.values())
      .filter((control) => control.panelKey === panelKey)
      .map((control) => this.#cloneControl(control));
  }

  getControlState(panelId, controlId) {
    const key = this.#makeControlKey(panelId, controlId);
    if (!key) {
      return null;
    }
    const entry = this.state.get(key);
    if (!entry) {
      const definition = this.controls.get(key);
      if (!definition) {
        return null;
      }
      return {
        panelId: definition.panelId,
        controlId: definition.controlId,
        stateId: definition.defaultStateId,
        stateLabel: definition.defaultStateLabel,
        updatedAtSeconds: null,
        updatedAt: null,
        actor: null,
        source: null,
        note: null,
      };
    }
    return {
      panelId: entry.panelId,
      controlId: entry.controlId,
      stateId: entry.stateId,
      stateLabel: entry.stateLabel,
      updatedAtSeconds: entry.updatedAtSeconds,
      updatedAt: entry.updatedAtSeconds != null ? formatGET(entry.updatedAtSeconds) : null,
      actor: entry.actor,
      source: entry.source,
      note: entry.note,
      previousStateId: entry.previousStateId,
      previousStateLabel: entry.previousStateLabel,
    };
  }

  setControlState(panelId, controlId, targetStateId, context = {}) {
    const key = this.#makeControlKey(panelId, controlId);
    if (!key) {
      return { success: false, reason: 'invalid_identifier' };
    }
    const definition = this.controls.get(key);
    if (!definition) {
      return { success: false, reason: 'unknown_control' };
    }

    const stateKey = this.#resolveStateKey(definition, targetStateId);
    if (!stateKey) {
      return { success: false, reason: 'unknown_state' };
    }

    const stateDefinition = definition.states.get(stateKey);
    const existing = this.state.get(key);
    if (existing && existing.stateKey === stateKey) {
      return {
        success: true,
        changed: false,
        panelId: definition.panelId,
        controlId: definition.controlId,
        stateId: existing.stateId,
        stateLabel: existing.stateLabel,
        previousStateId: existing.previousStateId ?? null,
        previousStateLabel: existing.previousStateLabel ?? null,
      };
    }

    const getSeconds = this.#resolveTimestamp(context.getSeconds);
    const actor = normalizeId(context.actor) ?? 'MANUAL_CREW';
    const source = normalizeId(context.source) ?? 'manual_queue';
    const note = normalizeId(context.note);

    const previousEntry = existing ?? {
      stateKey: definition.defaultStateKey,
      stateId: definition.defaultStateId,
      stateLabel: definition.defaultStateLabel,
    };

    const entry = {
      panelId: definition.panelId,
      controlId: definition.controlId,
      stateKey,
      stateId: stateDefinition.id,
      stateLabel: stateDefinition.label ?? stateDefinition.id,
      updatedAtSeconds: getSeconds,
      actor,
      source,
      note,
      previousStateId: previousEntry.stateId ?? null,
      previousStateLabel: previousEntry.stateLabel ?? null,
    };
    this.state.set(key, entry);

    this.metrics.changes += 1;
    this.metrics.lastUpdateSeconds = getSeconds;

    const historyEntry = {
      id: `panel_${this.sequence + 1}`,
      sequence: this.sequence,
      panelId: definition.panelId,
      controlId: definition.controlId,
      stateId: entry.stateId,
      stateLabel: entry.stateLabel,
      previousStateId: previousEntry.stateId ?? null,
      previousStateLabel: previousEntry.stateLabel ?? null,
      actor,
      source,
      note,
      getSeconds,
      get: Number.isFinite(getSeconds) ? formatGET(getSeconds) : null,
      changed: !existing || previousEntry.stateKey !== stateKey,
    };
    this.sequence += 1;
    this.history.push(historyEntry);
    if (this.history.length > this.historyLimit) {
      this.history.splice(0, this.history.length - this.historyLimit);
    }

    this.logger?.log(getSeconds, `Panel control ${definition.panelId}.${definition.controlId} set to ${entry.stateId}`, {
      logSource: LOG_SOURCE,
      logCategory: LOG_CATEGORY,
      logSeverity: 'notice',
      panelId: definition.panelId,
      controlId: definition.controlId,
      stateId: entry.stateId,
      stateLabel: entry.stateLabel,
      previousStateId: previousEntry.stateId ?? null,
      previousStateLabel: previousEntry.stateLabel ?? null,
      actor,
      source,
      note,
    });

    this.recorder?.recordPanelControl({
      panelId: definition.panelId,
      controlId: definition.controlId,
      stateId: entry.stateId,
      stateLabel: entry.stateLabel,
      previousStateId: previousEntry.stateId ?? null,
      previousStateLabel: previousEntry.stateLabel ?? null,
      getSeconds,
      actor,
      note,
    });

    this.#emitChange(historyEntry);

    return {
      success: true,
      changed: true,
      panelId: definition.panelId,
      controlId: definition.controlId,
      stateId: entry.stateId,
      stateLabel: entry.stateLabel,
      previousStateId: previousEntry.stateId ?? null,
      previousStateLabel: previousEntry.stateLabel ?? null,
    };
  }

  snapshot({ includeHistory = false, historyLimit = null } = {}) {
    const panels = {};
    for (const control of this.controls.values()) {
      const key = this.#makeControlKey(control.panelId, control.controlId);
      if (!key) {
        continue;
      }
      const panelKey = control.panelKey;
      if (!panels[panelKey]) {
        panels[panelKey] = {
          id: control.panelId,
          name: control.panelName,
          craft: control.panelCraft,
          controls: {},
        };
      }

      const state = this.getControlState(control.panelId, control.controlId);
      panels[panelKey].controls[control.controlId] = {
        id: control.controlId,
        label: control.label,
        type: control.type,
        stateId: state?.stateId ?? control.defaultStateId,
        stateLabel: state?.stateLabel ?? control.defaultStateLabel,
        defaultStateId: control.defaultStateId,
        defaultStateLabel: control.defaultStateLabel,
        updatedAtSeconds: state?.updatedAtSeconds ?? null,
        updatedAt: state?.updatedAt ?? null,
        actor: state?.actor ?? null,
        source: state?.source ?? null,
        note: state?.note ?? null,
      };
    }

    const result = {
      version: this.version,
      description: this.description,
      summary: {
        totalPanels: this.metrics.totalPanels,
        totalControls: this.metrics.totalControls,
        changes: this.metrics.changes,
        lastUpdateSeconds: this.metrics.lastUpdateSeconds,
        lastUpdateGet: this.metrics.lastUpdateSeconds != null
          ? formatGET(this.metrics.lastUpdateSeconds)
          : null,
      },
      panels,
    };

    if (includeHistory) {
      result.history = this.historySnapshot({ limit: historyLimit });
    }

    return result;
  }

  historySnapshot({ limit = null } = {}) {
    if (!Number.isFinite(limit) || limit < 0) {
      return this.history.map((entry) => ({ ...entry }));
    }
    const start = Math.max(0, this.history.length - limit);
    return this.history.slice(start).map((entry) => ({ ...entry }));
  }

  stats() {
    return {
      totalPanels: this.metrics.totalPanels,
      totalControls: this.metrics.totalControls,
      changes: this.metrics.changes,
      lastUpdateSeconds: this.metrics.lastUpdateSeconds,
      historyCount: this.history.length,
    };
  }

  serialize() {
    return this.snapshot({ includeHistory: true });
  }

  #extractPanels(bundle) {
    if (!bundle) {
      return [];
    }
    if (bundle.map instanceof Map) {
      return Array.from(bundle.map.values());
    }
    if (Array.isArray(bundle.panels)) {
      return bundle.panels;
    }
    if (Array.isArray(bundle.items)) {
      return bundle.items;
    }
    return [];
  }

  #ingestControl(panel, control) {
    const controlKey = this.#makeControlKey(panel.id, control.id);
    if (!controlKey) {
      return;
    }

    const states = new Map();
    const stateList = Array.isArray(control.states) ? control.states : [];
    let defaultStateKey = null;
    let defaultStateId = null;
    let defaultStateLabel = null;

    for (const state of stateList) {
      const stateKey = normalizeKey(state.id ?? state.stateId ?? state.value);
      if (!stateKey) {
        continue;
      }
      const entry = {
        key: stateKey,
        id: normalizeId(state.id ?? state.stateId ?? state.value) ?? stateKey,
        label: normalizeId(state.label) ?? normalizeId(state.name) ?? stateKey,
        metadata: clonePlain(state.metadata ?? null),
      };
      states.set(stateKey, entry);
      if (!defaultStateKey) {
        defaultStateKey = stateKey;
        defaultStateId = entry.id;
        defaultStateLabel = entry.label;
      }
    }

    const requestedDefault = normalizeKey(control.defaultState ?? control.default_state);
    if (requestedDefault && states.has(requestedDefault)) {
      const entry = states.get(requestedDefault);
      defaultStateKey = entry.key;
      defaultStateId = entry.id;
      defaultStateLabel = entry.label;
    }

    const controlEntry = {
      key: controlKey,
      panelKey: normalizeKey(panel.id),
      panelId: panel.id,
      panelName: panel.name,
      panelCraft: panel.craft ?? null,
      controlId: control.id,
      label: control.label ?? control.id,
      type: control.type ?? 'toggle',
      states,
      defaultStateKey,
      defaultStateId,
      defaultStateLabel,
    };

    this.controls.set(controlKey, controlEntry);
    this.metrics.totalControls += 1;
    if (defaultStateKey) {
      this.state.set(controlKey, {
        panelId: panel.id,
        controlId: control.id,
        stateKey: defaultStateKey,
        stateId: defaultStateId,
        stateLabel: defaultStateLabel,
        updatedAtSeconds: null,
        actor: null,
        source: null,
        note: null,
        previousStateId: null,
        previousStateLabel: null,
      });
    }
  }

  #makeControlKey(panelId, controlId) {
    const panelKey = normalizeKey(panelId);
    const controlKey = normalizeKey(controlId);
    if (!panelKey || !controlKey) {
      return null;
    }
    return `${panelKey}::${controlKey}`;
  }

  #resolveStateKey(control, targetStateId) {
    if (!control) {
      return null;
    }
    if (!targetStateId && control.defaultStateKey) {
      return control.defaultStateKey;
    }
    const candidate = normalizeKey(targetStateId);
    if (candidate && control.states.has(candidate)) {
      return candidate;
    }
    return null;
  }

  #emitChange(payload) {
    if (this.listeners.size === 0) {
      return;
    }
    for (const listener of this.listeners) {
      try {
        listener(payload);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('PanelState listener failed', error);
      }
    }
  }

  #resolveTimestamp(value) {
    if (Number.isFinite(value)) {
      return Number(value);
    }
    const provided = Number(this.timeProvider?.());
    return Number.isFinite(provided) ? provided : 0;
  }

  #cloneControl(control) {
    return {
      panelId: control.panelId,
      controlId: control.controlId,
      label: control.label,
      type: control.type,
      defaultStateId: control.defaultStateId,
      defaultStateLabel: control.defaultStateLabel,
      states: Array.from(control.states.values()).map((state) => ({
        id: state.id,
        label: state.label,
        metadata: clonePlain(state.metadata),
      })),
    };
  }
}
