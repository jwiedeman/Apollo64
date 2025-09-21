import { formatGET } from '../utils/time.js';

const DEFAULT_HISTORY_LIMIT = 32;
const DEFAULT_CAPACITY = 12;
const DEFAULT_NORMALIZED_PRECISION = 4;
const DEFAULT_QUANTIZATION_STEP = 1 / 40;
const DEFAULT_VIEW_PRESETS = new Map([
  ['navigation', 'NAV_DEFAULT'],
  ['controls', 'DOCKING'],
  ['systems', 'SYSTEMS_NIGHT'],
  ['entry', 'ENTRY'],
]);

const LOG_SOURCE = 'ui';
const LOG_CATEGORY = 'workspace';

export class WorkspaceStore {
  constructor({
    bundle = null,
    presets = null,
    viewPresets = null,
    initialPresetId = null,
    initialView = null,
    overrides = null,
    inputOverrides = null,
    historyLimit = DEFAULT_HISTORY_LIMIT,
    capacity = DEFAULT_CAPACITY,
    logger = null,
    timeProvider = null,
    recorder = null,
    normalizedPrecision = DEFAULT_NORMALIZED_PRECISION,
    quantization = null,
  } = {}) {
    this.logger = logger ?? null;
    this.capacity = Number.isFinite(capacity) && capacity > 0 ? Math.floor(capacity) : DEFAULT_CAPACITY;
    this.historyLimit = Number.isFinite(historyLimit) && historyLimit > 0
      ? Math.floor(historyLimit)
      : DEFAULT_HISTORY_LIMIT;
    this.timeProvider = typeof timeProvider === 'function' ? timeProvider : () => 0;
    this.recorder = recorder ?? null;
    this.normalizedPrecision = Number.isInteger(normalizedPrecision) && normalizedPrecision >= 0
      ? normalizedPrecision
      : DEFAULT_NORMALIZED_PRECISION;
    this.quantization = this.#normalizeQuantization(quantization);

    this.version = null;
    this.presets = new Map();
    this.presetOrder = [];
    this.listeners = new Set();

    this.viewPresetMap = this.#normalizeViewPresetMap(viewPresets);

    if (bundle) {
      this.#ingestBundle(bundle);
    }
    if (presets) {
      this.#ingestPresets(presets);
    }

    if (this.viewPresetMap.size === 0) {
      this.viewPresetMap = this.#normalizeViewPresetMap(DEFAULT_VIEW_PRESETS);
    }

    this.state = {
      activePresetId: null,
      activeView: null,
      tiles: new Map(),
      overrides: {},
      inputOverrides: {
        keyboard: {},
        controller: {},
        n64: {},
      },
      history: [],
    };

    if (overrides && typeof overrides === 'object') {
      this.state.overrides = deepClone(overrides);
    }

    if (inputOverrides && typeof inputOverrides === 'object') {
      const normalized = {};
      for (const [device, mapping] of Object.entries(inputOverrides)) {
        if (mapping && typeof mapping === 'object') {
          normalized[device] = deepClone(mapping);
        }
      }
      this.state.inputOverrides = { ...this.state.inputOverrides, ...normalized };
    }

    const startingView = this.#normalizeView(initialView);
    const startingPreset = this.#resolvePresetId(initialPresetId ?? this.viewPresetMap.get(startingView ?? ''))
      ?? this.#resolvePresetId(this.viewPresetMap.get('navigation'))
      ?? this.presetOrder[0]
      ?? null;

    if (startingPreset) {
      this.#applyPreset(startingPreset, {
        view: startingView,
        log: false,
        recordHistory: false,
        emit: false,
      });
    }
  }

  get versionInfo() {
    return this.version;
  }

  setTimeProvider(provider) {
    if (typeof provider === 'function') {
      this.timeProvider = provider;
    }
  }

  onChange(callback) {
    if (typeof callback !== 'function') {
      return () => {};
    }
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  getState() {
    return {
      version: this.version,
      activePresetId: this.state.activePresetId,
      activeView: this.state.activeView,
      tiles: mapToObject(this.state.tiles),
      overrides: deepClone(this.state.overrides),
      inputOverrides: deepClone(this.state.inputOverrides),
      history: this.state.history.slice(),
      capacity: this.capacity,
      presetCount: this.presets.size,
    };
  }

  listPresets() {
    return this.presetOrder.map((id) => deepClone(this.presets.get(id))).filter(Boolean);
  }

  getActivePreset() {
    if (!this.state.activePresetId) {
      return null;
    }
    const preset = this.presets.get(this.state.activePresetId);
    return preset ? deepClone(preset) : null;
  }

  getTiles() {
    return mapToObject(this.state.tiles);
  }

  activatePreset(target, options = {}) {
    const { view = null, source = null, log = true } = options ?? {};
    const presetId = this.#resolvePresetId(target);
    if (!presetId) {
      return false;
    }
    const resolvedView = this.#resolveViewForPreset(target, view);
    const changed = this.#applyPreset(presetId, {
      view: resolvedView,
      source,
      log,
      recordHistory: true,
      emit: true,
    });
    return changed;
  }

  activateView(viewId, options = {}) {
    const normalized = this.#normalizeView(viewId);
    if (!normalized) {
      return false;
    }
    const presetId = this.#resolvePresetId(this.viewPresetMap.get(normalized));
    if (!presetId) {
      return false;
    }
    return this.activatePreset(presetId, { ...options, view: normalized });
  }

  mutateTile(tileId, patch, options = {}) {
    const tile = this.state.tiles.get(tileId);
    if (!tile || !patch || typeof patch !== 'object') {
      return null;
    }

    const previousQuantized = tile.quantized ? { ...tile.quantized } : null;

    const sanitized = this.#sanitizeTilePatch(tile, patch);
    if (!sanitized) {
      return null;
    }

    const previous = {
      x: tile.x,
      y: tile.y,
      width: tile.width,
      height: tile.height,
    };

    tile.x = sanitized.x ?? tile.x;
    tile.y = sanitized.y ?? tile.y;
    tile.width = sanitized.width ?? tile.width;
    tile.height = sanitized.height ?? tile.height;
    tile.updatedAtSeconds = this.#now();
    tile.updatedAtGet = formatGET(tile.updatedAtSeconds);

    this.#applyTileQuantization(tile);

    if (sanitized.x != null) {
      sanitized.x = tile.x;
    }
    if (sanitized.y != null) {
      sanitized.y = tile.y;
    }
    if (sanitized.width != null) {
      sanitized.width = tile.width;
    }
    if (sanitized.height != null) {
      sanitized.height = tile.height;
    }

    const quantized = {};
    if (sanitized.x != null && tile.quantized?.x != null) {
      quantized.x = tile.quantized.x;
    }
    if (sanitized.y != null && tile.quantized?.y != null) {
      quantized.y = tile.quantized.y;
    }
    if (sanitized.width != null && tile.quantized?.width != null) {
      quantized.width = tile.quantized.width;
    }
    if (sanitized.height != null && tile.quantized?.height != null) {
      quantized.height = tile.quantized.height;
    }
    if (Object.keys(quantized).length > 0) {
      sanitized.quantized = quantized;
    }

    const context = {
      presetId: this.state.activePresetId,
      view: this.state.activeView,
      tileId,
      mutation: sanitized,
      previous,
      quantized,
      previousQuantized,
      pointer: options.pointer ?? null,
      reason: options.reason ?? null,
      source: options.source ?? null,
    };

    if (!options.silent) {
      this.#recordHistory({
        type: 'tile.mutate',
        tileId,
        presetId: this.state.activePresetId,
        view: this.state.activeView,
        mutation: sanitized,
        quantized,
        previousQuantized,
        pointer: options.pointer ?? null,
        reason: options.reason ?? null,
        source: options.source ?? null,
      });
      this.#log('Workspace tile updated', { ...context, eventType: 'workspace:update' });
    }

    this.#emitChange();
    return sanitized;
  }

  updateOverride(key, value, options = {}) {
    const normalizedKey = typeof key === 'string' ? key.trim() : '';
    if (!normalizedKey) {
      return false;
    }

    const existing = this.state.overrides[normalizedKey];
    if (existing === value) {
      return false;
    }

    if (value === undefined) {
      delete this.state.overrides[normalizedKey];
    } else {
      this.state.overrides[normalizedKey] = value;
    }

    if (!options.silent) {
      this.#recordHistory({
        type: 'override',
        key: normalizedKey,
        value,
        source: options.source ?? null,
      });
      this.#log('Workspace override changed', {
        eventType: 'workspace:override_changed',
        key: normalizedKey,
        value,
        source: options.source ?? null,
      });
    }

    this.#emitChange();
    return true;
  }

  updateInputOverride(device, binding, value, options = {}) {
    const normalizedDevice = typeof device === 'string' ? device.trim().toLowerCase() : '';
    const normalizedBinding = typeof binding === 'string' ? binding.trim() : '';
    if (!normalizedDevice || !normalizedBinding) {
      return false;
    }

    const deviceOverrides = this.state.inputOverrides[normalizedDevice] ?? {};
    const existing = deviceOverrides[normalizedBinding];
    if (existing === value) {
      return false;
    }

    if (value === undefined || value === null) {
      delete deviceOverrides[normalizedBinding];
    } else {
      deviceOverrides[normalizedBinding] = value;
    }

    this.state.inputOverrides[normalizedDevice] = deviceOverrides;

    if (!options.silent) {
      this.#recordHistory({
        type: 'input',
        device: normalizedDevice,
        binding: normalizedBinding,
        value,
        source: options.source ?? null,
      });
      this.#log('Workspace input override updated', {
        eventType: 'workspace:input_override',
        device: normalizedDevice,
        binding: normalizedBinding,
        value,
        source: options.source ?? null,
      });
    }

    this.#emitChange();
    return true;
  }

  serialize(options = {}) {
    const { includeHistory = true } = options ?? {};
    const serialized = {
      version: this.version,
      activePresetId: this.state.activePresetId,
      activeView: this.state.activeView,
      overrides: deepClone(this.state.overrides),
      inputOverrides: deepClone(this.state.inputOverrides),
      tiles: mapToObject(this.state.tiles),
      capacity: this.capacity,
    };
    if (includeHistory) {
      serialized.history = this.state.history.slice();
    }
    return serialized;
  }

  applySerialized(serialized, options = {}) {
    if (!serialized || typeof serialized !== 'object') {
      return false;
    }

    const { merge = false, silent = false } = options ?? {};
    let changed = false;

    const targetPresetId = this.#resolvePresetId(serialized.activePresetId);
    const targetView = this.#normalizeView(serialized.activeView);

    if (!merge && targetPresetId && targetPresetId !== this.state.activePresetId) {
      this.#applyPreset(targetPresetId, {
        view: targetView,
        log: !silent,
        recordHistory: !silent,
        emit: true,
        source: options.source ?? 'import',
      });
      changed = true;
    }

    if (serialized.overrides && typeof serialized.overrides === 'object') {
      const entries = Object.entries(serialized.overrides);
      for (const [key, value] of entries) {
        if (merge) {
          if (this.state.overrides[key] !== value) {
            this.state.overrides[key] = value;
            changed = true;
          }
        } else {
          this.state.overrides[key] = value;
          changed = true;
        }
      }
    } else if (!merge && serialized.overrides === null) {
      this.state.overrides = {};
      changed = true;
    }

    if (serialized.inputOverrides && typeof serialized.inputOverrides === 'object') {
      for (const [device, mapping] of Object.entries(serialized.inputOverrides)) {
        if (!mapping || typeof mapping !== 'object') {
          continue;
        }
        const normalizedDevice = device.trim().toLowerCase();
        const current = this.state.inputOverrides[normalizedDevice] ?? {};
        this.state.inputOverrides[normalizedDevice] = merge ? { ...current, ...mapping } : deepClone(mapping);
        changed = true;
      }
    } else if (!merge && serialized.inputOverrides === null) {
      this.state.inputOverrides = { keyboard: {}, controller: {}, n64: {} };
      changed = true;
    }

    if (serialized.tiles && typeof serialized.tiles === 'object') {
      const tileEntries = Object.entries(serialized.tiles);
      for (const [tileId, tileState] of tileEntries) {
        if (!tileState || typeof tileState !== 'object') {
          continue;
        }
        const patch = {};
        for (const key of ['x', 'y', 'width', 'height']) {
          if (tileState[key] != null) {
            patch[key] = tileState[key];
          }
        }
        if (Object.keys(patch).length === 0) {
          continue;
        }
        const result = this.mutateTile(tileId, patch, { silent: true });
        if (result) {
          changed = true;
        }
      }
    }

    if (changed && !silent) {
      this.#emitChange();
    }

    return changed;
  }

  #ingestBundle(bundle) {
    if (!bundle || typeof bundle !== 'object') {
      return;
    }
    if (bundle.version != null && Number.isFinite(Number(bundle.version))) {
      this.version = Number(bundle.version);
    }

    if (bundle.map instanceof Map) {
      for (const [id, preset] of bundle.map.entries()) {
        this.#ingestPreset(id, preset);
      }
    } else if (Array.isArray(bundle.items)) {
      for (const preset of bundle.items) {
        if (preset && typeof preset === 'object' && preset.id) {
          this.#ingestPreset(preset.id, preset);
        }
      }
    }
  }

  #ingestPresets(rawPresets) {
    if (rawPresets instanceof Map) {
      for (const [id, preset] of rawPresets.entries()) {
        this.#ingestPreset(id, preset);
      }
      return;
    }

    if (Array.isArray(rawPresets)) {
      for (const preset of rawPresets) {
        if (preset && typeof preset === 'object' && preset.id) {
          this.#ingestPreset(preset.id, preset);
        }
      }
    }
  }

  #ingestPreset(id, preset) {
    if (!id || typeof id !== 'string' || !preset || typeof preset !== 'object') {
      return;
    }
    const normalizedId = id.trim();
    const normalizedPreset = {
      id: normalizedId,
      name: preset.name != null ? String(preset.name) : normalizedId,
      description: preset.description != null ? String(preset.description) : null,
      viewport: preset.viewport ? deepClone(preset.viewport) : null,
      tiles: Array.isArray(preset.tiles)
        ? preset.tiles.map((tile, index) => this.#normalizeTile(tile, index)).filter(Boolean)
        : [],
      tileMode: preset.tileMode ? deepClone(preset.tileMode) : null,
      tags: Array.isArray(preset.tags) ? preset.tags.slice() : [],
      metadata: preset.metadata && typeof preset.metadata === 'object' ? deepClone(preset.metadata) : null,
    };

    this.presets.set(normalizedId, normalizedPreset);
    if (!this.presetOrder.includes(normalizedId)) {
      this.presetOrder.push(normalizedId);
    }
  }

  #normalizeTile(tile, index) {
    if (!tile || typeof tile !== 'object') {
      return null;
    }

    const id = typeof tile.id === 'string' ? tile.id.trim() : `tile_${index + 1}`;
    const windowId = typeof tile.window === 'string' ? tile.window.trim() : null;
    if (!windowId) {
      return null;
    }

    const constraints = tile.constraints && typeof tile.constraints === 'object'
      ? deepClone(tile.constraints)
      : null;

    const tileState = {
      id,
      window: windowId,
      x: this.#coerceNumber(tile.x, 0),
      y: this.#coerceNumber(tile.y, 0),
      width: this.#coerceNumber(tile.width, 0.25),
      height: this.#coerceNumber(tile.height, 0.25),
      constraints,
      panelFocus: typeof tile.panelFocus === 'string' ? tile.panelFocus.trim() : null,
      tags: Array.isArray(tile.tags) ? tile.tags.slice() : [],
      metadata: tile.metadata && typeof tile.metadata === 'object' ? deepClone(tile.metadata) : null,
    };

    this.#applyTileQuantization(tileState);
    return tileState;
  }

  #applyPreset(presetId, {
    view = null,
    source = null,
    log = true,
    recordHistory = true,
    emit = true,
  } = {}) {
    const preset = this.presets.get(presetId);
    if (!preset) {
      return false;
    }

    const normalizedView = view ? this.#normalizeView(view) : this.state.activeView;
    const tiles = new Map();
    for (const tile of preset.tiles) {
      const clone = deepClone(tile);
      clone.updatedAtSeconds = this.#now();
      clone.updatedAtGet = formatGET(clone.updatedAtSeconds);
      this.#applyTileQuantization(clone);
      tiles.set(clone.id, clone);
    }

    const changed =
      this.state.activePresetId !== preset.id
      || this.state.activeView !== normalizedView
      || tiles.size !== this.state.tiles.size;

    this.state.activePresetId = preset.id;
    this.state.activeView = normalizedView ?? null;
    this.state.tiles = tiles;

    if (recordHistory) {
      this.#recordHistory({
        type: 'preset',
        presetId: preset.id,
        view: this.state.activeView,
        source,
      });
    }

    if (log) {
      this.#log('Workspace preset activated', {
        eventType: 'workspace:preset_loaded',
        presetId: preset.id,
        view: this.state.activeView,
        source,
      });
    }

    if (emit) {
      this.#emitChange();
    }

    return changed;
  }

  #sanitizeTilePatch(tile, patch) {
    const sanitized = {};

    if (patch.x != null) {
      sanitized.x = this.#clamp(patch.x, 0, 1);
    }
    if (patch.y != null) {
      sanitized.y = this.#clamp(patch.y, 0, 1);
    }
    if (patch.width != null) {
      sanitized.width = this.#ensurePositive(patch.width);
    }
    if (patch.height != null) {
      sanitized.height = this.#ensurePositive(patch.height);
    }

    if (Object.keys(sanitized).length === 0) {
      return null;
    }

    const constraints = tile.constraints ?? {};

    const minWidth = this.#coerceNumber(constraints.minWidth, null);
    const minHeight = this.#coerceNumber(constraints.minHeight, null);
    const maxWidth = this.#coerceNumber(constraints.maxWidth, null);
    const maxHeight = this.#coerceNumber(constraints.maxHeight, null);

    if (sanitized.width != null) {
      if (minWidth != null) {
        sanitized.width = Math.max(sanitized.width, minWidth);
      }
      if (maxWidth != null) {
        sanitized.width = Math.min(sanitized.width, maxWidth);
      }
      sanitized.width = Math.min(sanitized.width, 1);
    }

    if (sanitized.height != null) {
      if (minHeight != null) {
        sanitized.height = Math.max(sanitized.height, minHeight);
      }
      if (maxHeight != null) {
        sanitized.height = Math.min(sanitized.height, maxHeight);
      }
      sanitized.height = Math.min(sanitized.height, 1);
    }

    const width = sanitized.width ?? tile.width;
    const height = sanitized.height ?? tile.height;

    if (sanitized.x != null) {
      sanitized.x = Math.max(0, Math.min(sanitized.x, Math.max(0, 1 - width)));
      sanitized.x = this.#roundNormalized(sanitized.x);
    }
    if (sanitized.y != null) {
      sanitized.y = Math.max(0, Math.min(sanitized.y, Math.max(0, 1 - height)));
      sanitized.y = this.#roundNormalized(sanitized.y);
    }

    return sanitized;
  }

  #normalizeViewPresetMap(raw) {
    const result = new Map();
    if (!raw) {
      return result;
    }

    if (raw instanceof Map) {
      for (const [view, presetId] of raw.entries()) {
        const normalizedView = this.#normalizeView(view);
        if (!normalizedView) {
          continue;
        }
        const resolvedPreset = this.#resolvePresetId(presetId);
        if (resolvedPreset) {
          result.set(normalizedView, resolvedPreset);
        }
      }
      return result;
    }

    if (typeof raw === 'object') {
      for (const [view, presetId] of Object.entries(raw)) {
        const normalizedView = this.#normalizeView(view);
        if (!normalizedView) {
          continue;
        }
        const resolvedPreset = this.#resolvePresetId(presetId);
        if (resolvedPreset) {
          result.set(normalizedView, resolvedPreset);
        }
      }
    }

    return result;
  }

  #resolvePresetId(target) {
    if (!target) {
      return null;
    }
    if (this.presets.has(target)) {
      return target;
    }
    const normalized = typeof target === 'string' ? target.trim() : '';
    if (normalized && this.presets.has(normalized)) {
      return normalized;
    }
    return null;
  }

  #resolveViewForPreset(target, explicitView) {
    const normalizedView = this.#normalizeView(explicitView);
    if (normalizedView) {
      this.viewPresetMap.set(normalizedView, this.#resolvePresetId(target));
      return normalizedView;
    }

    for (const [view, presetId] of this.viewPresetMap.entries()) {
      if (presetId === target) {
        return view;
      }
    }
    return this.state.activeView;
  }

  #normalizeView(view) {
    if (!view || typeof view !== 'string') {
      return null;
    }
    const trimmed = view.trim();
    return trimmed ? trimmed.toLowerCase() : null;
  }

  #coerceNumber(value, fallback = null) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  #clamp(value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return null;
    }
    return Math.min(Math.max(number, min), max);
  }

  #ensurePositive(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return null;
    }
    return Math.max(number, 0);
  }

  #roundNormalized(value) {
    if (!Number.isFinite(value)) {
      return 0;
    }
    const factor = 10 ** this.normalizedPrecision;
    return Math.round(value * factor) / factor;
  }

  #applyTileQuantization(tile) {
    if (!tile || typeof tile !== 'object') {
      return;
    }

    const normalizedWidth = this.#roundNormalized(Math.min(Math.max(Number(tile.width) || 0, 0), 1));
    const normalizedHeight = this.#roundNormalized(Math.min(Math.max(Number(tile.height) || 0, 0), 1));
    const maxX = Math.max(0, 1 - normalizedWidth);
    const maxY = Math.max(0, 1 - normalizedHeight);
    const normalizedX = this.#roundNormalized(Math.min(Math.max(Number(tile.x) || 0, 0), maxX));
    const normalizedY = this.#roundNormalized(Math.min(Math.max(Number(tile.y) || 0, 0), maxY));

    tile.x = normalizedX;
    tile.y = normalizedY;
    tile.width = normalizedWidth;
    tile.height = normalizedHeight;

    const quantizedWidth = this.#quantizeDimension(normalizedWidth, 'width', normalizedWidth);
    const quantizedHeight = this.#quantizeDimension(normalizedHeight, 'height', normalizedHeight);
    const quantMaxX = Math.max(0, 1 - quantizedWidth);
    const quantMaxY = Math.max(0, 1 - quantizedHeight);
    const quantizedX = this.#roundNormalized(Math.max(0, Math.min(this.#quantizeDimension(normalizedX, 'x', normalizedX), quantMaxX)));
    const quantizedY = this.#roundNormalized(Math.max(0, Math.min(this.#quantizeDimension(normalizedY, 'y', normalizedY), quantMaxY)));

    tile.quantized = {
      x: quantizedX,
      y: quantizedY,
      width: this.#roundNormalized(quantizedWidth),
      height: this.#roundNormalized(quantizedHeight),
    };
  }

  #quantizeDimension(value, key, fallback) {
    if (!Number.isFinite(value)) {
      return this.#roundNormalized(fallback ?? 0);
    }
    if (!this.quantization.enabled) {
      return this.#roundNormalized(value);
    }
    const step = this.#quantizationStepFor(key);
    if (!(step > 0)) {
      return this.#roundNormalized(value);
    }
    let quantized = Math.round(value / step) * step;
    if (key === 'width' || key === 'height') {
      quantized = Math.max(step, quantized);
    }
    quantized = Math.min(Math.max(quantized, 0), 1);
    return this.#roundNormalized(quantized);
  }

  #quantizationStepFor(key) {
    const specific = Number(this.quantization[key]);
    if (Number.isFinite(specific) && specific > 0) {
      return specific;
    }
    const generic = Number(this.quantization.step);
    if (Number.isFinite(generic) && generic > 0) {
      return generic;
    }
    return DEFAULT_QUANTIZATION_STEP;
  }

  #normalizeQuantization(raw) {
    const defaults = {
      enabled: true,
      step: DEFAULT_QUANTIZATION_STEP,
      x: null,
      y: null,
      width: null,
      height: null,
    };

    if (raw == null) {
      return defaults;
    }

    if (typeof raw === 'boolean') {
      return { ...defaults, enabled: raw };
    }

    if (typeof raw === 'number') {
      const step = Math.abs(raw);
      if (Number.isFinite(step) && step > 0) {
        return { ...defaults, step };
      }
      return defaults;
    }

    if (typeof raw !== 'object') {
      return defaults;
    }

    const normalized = { ...defaults };
    if (typeof raw.enabled === 'boolean') {
      normalized.enabled = raw.enabled;
    }
    if (Number.isFinite(raw.step) && raw.step > 0) {
      normalized.step = Number(raw.step);
    }
    for (const key of ['x', 'y', 'width', 'height']) {
      const value = raw[key];
      if (Number.isFinite(value) && value > 0) {
        normalized[key] = Number(value);
      }
    }
    return normalized;
  }

  #now() {
    const value = Number(this.timeProvider?.());
    return Number.isFinite(value) && value >= 0 ? value : 0;
  }

  #recordHistory(entry) {
    const timestampSeconds = this.#now();
    const historyEntry = {
      ...entry,
      getSeconds: timestampSeconds,
      get: formatGET(timestampSeconds),
    };
    this.state.history.push(historyEntry);
    if (this.state.history.length > this.historyLimit) {
      const excess = this.state.history.length - this.historyLimit;
      this.state.history.splice(0, excess);
    }
    if (this.recorder && typeof this.recorder.recordWorkspaceEvent === 'function') {
      this.recorder.recordWorkspaceEvent(historyEntry);
    }
  }

  #log(message, context = {}) {
    if (!this.logger || typeof this.logger.log !== 'function') {
      return;
    }
    const timestampSeconds = this.#now();
    this.logger.log(timestampSeconds, message, {
      logSource: LOG_SOURCE,
      logCategory: LOG_CATEGORY,
      logSeverity: 'info',
      ...context,
    });
  }

  #emitChange() {
    if (this.listeners.size === 0) {
      return;
    }
    const snapshot = this.getState();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        // Swallow listener errors to protect store.
      }
    }
  }
}

function mapToObject(map) {
  if (!(map instanceof Map)) {
    return {};
  }
  const result = {};
  for (const [key, value] of map.entries()) {
    result[key] = deepClone(value);
  }
  return result;
}

function deepClone(value) {
  if (value == null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => deepClone(item));
  }
  const clone = {};
  for (const [key, item] of Object.entries(value)) {
    clone[key] = deepClone(item);
  }
  return clone;
}

