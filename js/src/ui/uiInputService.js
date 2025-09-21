import { formatGET } from '../utils/time.js';
import { MissionEventBus } from './missionEventBus.js';

const DEFAULT_HISTORY_LIMIT = 128;
const DEFAULT_DEVICE = 'keyboard';
const VIEW_ORDER = ['navigation', 'controls', 'systems'];
const MODIFIER_ORDER = ['CTRL', 'META', 'ALT', 'SHIFT'];
const DEFAULT_DSKY_BUFFER_LIMIT = 32;

const KEY_ALIASES = new Map([
  ['SPACE', 'SPACE'],
  ['SPACEBAR', 'SPACE'],
  ['ENTER', 'ENTER'],
  ['RETURN', 'ENTER'],
  ['TAB', 'TAB'],
  ['BACKSPACE', 'BACKSPACE'],
  ['ESCAPE', 'ESCAPE'],
  ['ARROWLEFT', 'ARROWLEFT'],
  ['ARROWRIGHT', 'ARROWRIGHT'],
  ['ARROWUP', 'ARROWUP'],
  ['ARROWDOWN', 'ARROWDOWN'],
  ['PERIOD', 'PERIOD'],
  ['COMMA', 'COMMA'],
  ['MINUS', 'MINUS'],
  ['SLASH', 'SLASH'],
  ['BACKSLASH', 'BACKSLASH'],
  ['SEMICOLON', 'SEMICOLON'],
  ['BRACKETLEFT', 'BRACKETLEFT'],
  ['BRACKETRIGHT', 'BRACKETRIGHT'],
  ['QUOTE', 'QUOTE'],
  ['BACKQUOTE', 'BACKQUOTE'],
  ['NUMPADENTER', 'ENTER'],
  ['NUMPADADD', 'PLUS'],
  ['NUMPADSUBTRACT', 'MINUS'],
  ['NUMPADDECIMAL', 'DECIMAL'],
]);

const GAMEPAD_BUTTON_ALIASES = new Map([
  ['RIGHTSTICKCLICK', 'R3'],
  ['RIGHTSTICK', 'R3'],
  ['R_STICK', 'R3'],
  ['RIGHTSTICKPRESS', 'R3'],
  ['LEFTSTICKCLICK', 'L3'],
  ['LEFTSTICK', 'L3'],
  ['L_STICK', 'L3'],
  ['LEFTSTICKPRESS', 'L3'],
  ['DPADUP', 'UP'],
  ['DUP', 'UP'],
  ['HATUP', 'UP'],
  ['DPADDOWN', 'DOWN'],
  ['DDOWN', 'DOWN'],
  ['HATDOWN', 'DOWN'],
  ['DPADLEFT', 'LEFT'],
  ['DLEFT', 'LEFT'],
  ['HATLEFT', 'LEFT'],
  ['DPADRIGHT', 'RIGHT'],
  ['DRIGHT', 'RIGHT'],
  ['HATRIGHT', 'RIGHT'],
  ['START', 'MENU'],
  ['OPTIONS', 'MENU'],
  ['BUTTONSTART', 'MENU'],
  ['MENU', 'MENU'],
  ['SELECT', 'SELECT'],
  ['BACK', 'SELECT'],
  ['VIEW', 'SELECT'],
  ['BUTTONSELECT', 'SELECT'],
  ['LBUMPER', 'LB'],
  ['RBUMPER', 'RB'],
  ['LEFTBUMPER', 'LB'],
  ['RIGHTBUMPER', 'RB'],
  ['LTRIGGER', 'LT'],
  ['RTRIGGER', 'RT'],
  ['LEFTTRIGGER', 'LT'],
  ['RIGHTTRIGGER', 'RT'],
  ['BUTTONA', 'A'],
  ['BUTTON0', 'A'],
  ['CROSS', 'A'],
  ['BUTTONB', 'B'],
  ['BUTTON1', 'B'],
  ['CIRCLE', 'B'],
  ['BUTTONX', 'X'],
  ['BUTTON2', 'X'],
  ['SQUARE', 'X'],
  ['BUTTONY', 'Y'],
  ['BUTTON3', 'Y'],
  ['TRIANGLE', 'Y'],
]);

const N64_BUTTON_ALIASES = new Map([
  ['CLEFT', 'C-LEFT'],
  ['CRIGHT', 'C-RIGHT'],
  ['CUP', 'C-UP'],
  ['CDOWN', 'C-DOWN'],
  ['DPADUP', 'UP'],
  ['DPADDOWN', 'DOWN'],
  ['DPADLEFT', 'LEFT'],
  ['DPADRIGHT', 'RIGHT'],
]);

const DEFAULT_OPTIONS = {
  logSource: 'ui',
  logCategory: 'ui',
  timeProvider: () => 0,
  historyLimit: DEFAULT_HISTORY_LIMIT,
  defaultDevice: DEFAULT_DEVICE,
  registerDefaults: true,
};

function createInitialState() {
  return {
    view: 'navigation',
    mode: 'idle',
    focusTarget: null,
    modalTarget: null,
    previousModeBeforeModal: null,
    previousFocusBeforeModal: null,
    tileModeActive: false,
    overlays: {
      checklist: false,
      macroTray: false,
    },
    navReference: 'cmc',
    navigationProjection: '3d',
    dockingOverlayEnabled: false,
    navigationTimelineIndex: 0,
    navigationLastSelectedAt: null,
    navigationPlanBurnAt: null,
    controlsPanelIndex: 0,
    controlsActivePanelId: null,
    controlsControlIndex: 0,
    controlsLastActionAt: null,
    checklistAcknowledged: 0,
    checklistBlocked: false,
    contextActions: 0,
    lastAlarmSilencedAt: null,
    simPaused: false,
    timeStepIncrements: 0,
    timeStepDecrements: 0,
    dskyBuffer: [],
    dskyBufferLimit: DEFAULT_DSKY_BUFFER_LIMIT,
    systemsModuleIndex: 0,
    systemsTrendExpanded: false,
    systemsCautionsAcknowledged: 0,
    systemsDsnPinned: false,
    systemsSnapshots: 0,
    workspaceSaves: 0,
    workspaceLoads: 0,
  };
}

function clonePlain(value) {
  if (value == null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => clonePlain(item));
  }
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] = clonePlain(entry);
  }
  return result;
}

function snapshotState(state) {
  return {
    view: state.view,
    mode: state.mode,
    focusTarget: state.focusTarget,
    modalTarget: state.modalTarget,
    tileModeActive: state.tileModeActive,
    overlays: { ...state.overlays },
    navReference: state.navReference,
    navigationProjection: state.navigationProjection,
    dockingOverlayEnabled: state.dockingOverlayEnabled,
    navigationTimelineIndex: state.navigationTimelineIndex,
    navigationLastSelectedAt: state.navigationLastSelectedAt,
    navigationPlanBurnAt: state.navigationPlanBurnAt ?? null,
    controlsPanelIndex: state.controlsPanelIndex,
    controlsActivePanelId: state.controlsActivePanelId,
    controlsControlIndex: state.controlsControlIndex,
    controlsLastActionAt: state.controlsLastActionAt ?? null,
    checklistAcknowledged: state.checklistAcknowledged,
    checklistBlocked: state.checklistBlocked,
    contextActions: state.contextActions,
    lastAlarmSilencedAt: state.lastAlarmSilencedAt,
    simPaused: state.simPaused,
    timeStepIncrements: state.timeStepIncrements,
    timeStepDecrements: state.timeStepDecrements,
    systemsModuleIndex: state.systemsModuleIndex,
    systemsTrendExpanded: state.systemsTrendExpanded,
    systemsCautionsAcknowledged: state.systemsCautionsAcknowledged,
    systemsDsnPinned: state.systemsDsnPinned,
    systemsSnapshots: state.systemsSnapshots,
    workspaceSaves: state.workspaceSaves,
    workspaceLoads: state.workspaceLoads,
    dskyBuffer: state.dskyBuffer.slice(-10).map((entry) => ({ ...entry })),
  };
}

function normalizeString(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeDevice(value, fallback = DEFAULT_DEVICE) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return fallback;
  }
  const lower = normalized.toLowerCase();
  if (lower === 'keyboard' || lower === 'gamepad' || lower === 'n64') {
    return lower;
  }
  if (lower === 'controller' || lower === 'pad') {
    return 'gamepad';
  }
  return fallback;
}

function resolveTimestamp(source, timeProvider) {
  const candidates = [
    source?.timestampSeconds,
    source?.getSeconds,
    source?.timeSeconds,
    source?.time,
    source?.timestamp,
    source?.frameTime,
  ];

  for (const candidate of candidates) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }

  if (typeof timeProvider === 'function') {
    const provided = Number(timeProvider());
    if (Number.isFinite(provided)) {
      return provided;
    }
  }

  return 0;
}

function normalizeKeyName(code, key, modifiers) {
  const rawCode = normalizeString(code);
  const rawKey = normalizeString(key);
  let candidate = rawCode ?? rawKey;
  if (!candidate) {
    return null;
  }

  if (rawKey && rawKey.length === 1) {
    const single = rawKey;
    if (single === ' ') {
      return 'SPACE';
    }
    if (single === '+') {
      return 'PLUS';
    }
    if (single === '-') {
      return 'MINUS';
    }
    if (single === '.') {
      return 'PERIOD';
    }
    if (single === ',') {
      return 'COMMA';
    }
    if (single === '/') {
      return 'SLASH';
    }
    if (single === '\\') {
      return 'BACKSLASH';
    }
    if (single === '=') {
      return modifiers.shift ? 'PLUS' : 'EQUAL';
    }
    if (single === '`') {
      return 'BACKQUOTE';
    }
    if (single === ';') {
      return 'SEMICOLON';
    }
    if (single === ':') {
      return 'COLON';
    }
    return single.toUpperCase();
  }

  if (rawCode && rawCode.startsWith('Key')) {
    return rawCode.slice(3).toUpperCase();
  }
  if (rawCode && rawCode.startsWith('Digit')) {
    return rawCode.slice(5).toUpperCase();
  }
  if (rawCode && rawCode.startsWith('Numpad')) {
    const suffix = rawCode.slice(6).toUpperCase();
    if (/^[0-9]$/.test(suffix)) {
      return suffix;
    }
    if (suffix === 'ADD') {
      return 'PLUS';
    }
    if (suffix === 'SUBTRACT') {
      return 'MINUS';
    }
    if (suffix === 'ENTER') {
      return 'ENTER';
    }
    if (suffix === 'DECIMAL') {
      return 'DECIMAL';
    }
    return `NUMPAD${suffix}`;
  }

  const upper = candidate.toUpperCase();
  if (upper === 'EQUAL' && modifiers.shift) {
    return 'PLUS';
  }
  if (KEY_ALIASES.has(upper)) {
    return KEY_ALIASES.get(upper);
  }
  return upper;
}

function orderKeyboardInputs(inputs) {
  const modifiers = [];
  const others = [];
  for (const input of inputs) {
    if (MODIFIER_ORDER.includes(input)) {
      modifiers.push(input);
    } else {
      others.push(input);
    }
  }
  modifiers.sort((a, b) => MODIFIER_ORDER.indexOf(a) - MODIFIER_ORDER.indexOf(b));
  return [...modifiers, ...others];
}

function normalizeBindingInputs(device, inputs) {
  if (device === 'keyboard') {
    return orderKeyboardInputs(inputs);
  }
  const unique = Array.from(new Set(inputs));
  unique.sort();
  return unique;
}

function canonicalizeGamepadButton(value) {
  if (typeof value !== 'string') {
    return null;
  }
  let token = value.trim();
  if (!token) {
    return null;
  }
  token = token.replace(/\s+/g, '');
  token = token.replace(/-/g, '');
  const upper = token.toUpperCase();
  if (GAMEPAD_BUTTON_ALIASES.has(upper)) {
    return GAMEPAD_BUTTON_ALIASES.get(upper);
  }
  return upper;
}

function canonicalizeN64Button(value) {
  if (typeof value !== 'string') {
    return null;
  }
  let token = value.trim();
  if (!token) {
    return null;
  }
  token = token.replace(/\s+/g, '');
  token = token.toUpperCase();
  if (N64_BUTTON_ALIASES.has(token)) {
    return N64_BUTTON_ALIASES.get(token);
  }
  if (token.startsWith('C') && token.length > 1 && !token.includes('-')) {
    const axis = token.slice(1);
    if (['LEFT', 'RIGHT', 'UP', 'DOWN'].includes(axis)) {
      return `C-${axis}`;
    }
  }
  return token;
}

function createDskyPayload(event, key) {
  return {
    key: key ?? null,
    identifier: event.identifier ?? null,
    rawKey: event.rawKey ?? null,
    rawCode: event.rawCode ?? null,
  };
}

function resolveDskyKey(event) {
  const base = event.keyNormalized ?? null;
  if (!base) {
    return null;
  }
  if (/^[0-9]$/.test(base)) {
    return base;
  }
  switch (base) {
    case 'ENTER':
      return 'PRO';
    case 'BACKSPACE':
      return 'KEY_REL';
    case 'V':
      return 'VERB';
    case 'N':
      return 'NOUN';
    case 'PLUS':
      return 'PLUS';
    case 'MINUS':
      return 'MINUS';
    case 'DECIMAL':
      return 'DECIMAL';
    default:
      return base;
  }
}
export class UiInputService {
  constructor(options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...(options ?? {}) };
    this.logger = this.options.logger ?? null;
    this.eventBus = this.options.eventBus ?? new MissionEventBus();
    this.timeProvider = typeof this.options.timeProvider === 'function'
      ? this.options.timeProvider
      : DEFAULT_OPTIONS.timeProvider;
    this.logSource = this.options.logSource ?? DEFAULT_OPTIONS.logSource;
    this.logCategory = this.options.logCategory ?? DEFAULT_OPTIONS.logCategory;
    this.defaultDevice = normalizeDevice(this.options.defaultDevice, DEFAULT_DEVICE);
    this.historyLimit = Number.isFinite(this.options.historyLimit) && this.options.historyLimit > 0
      ? Math.floor(this.options.historyLimit)
      : DEFAULT_HISTORY_LIMIT;

    this.state = createInitialState();
    this.history = [];
    this.sequence = 0;
    this.bindingCounter = 0;
    this.handlers = new Map();
    this.anyHandlers = new Set();
    this.bindings = new Map();

    if (this.options.registerDefaults !== false) {
      this.#registerDefaultBindings();
    }

    if (Array.isArray(this.options.bindings)) {
      for (const binding of this.options.bindings) {
        this.registerBinding(binding);
      }
    }
  }

  getState() {
    return snapshotState(this.state);
  }

  getHistory(limit = null) {
    if (!Number.isFinite(limit) || limit == null) {
      return this.history.map((entry) => clonePlain(entry));
    }
    const count = Math.max(0, Math.floor(limit));
    const slice = this.history.slice(-count);
    return slice.map((entry) => clonePlain(entry));
  }

  clearHistory() {
    this.history = [];
  }

  onCommand(commandId, handler) {
    const normalized = this.#normalizeCommandId(commandId);
    if (!normalized || typeof handler !== 'function') {
      return () => {};
    }
    let bucket = this.handlers.get(normalized);
    if (!bucket) {
      bucket = new Set();
      this.handlers.set(normalized, bucket);
    }
    bucket.add(handler);
    return () => {
      bucket.delete(handler);
      if (bucket.size === 0) {
        this.handlers.delete(normalized);
      }
    };
  }

  onAnyCommand(handler) {
    if (typeof handler !== 'function') {
      return () => {};
    }
    this.anyHandlers.add(handler);
    return () => {
      this.anyHandlers.delete(handler);
    };
  }

  offCommand(commandId, handler) {
    const normalized = this.#normalizeCommandId(commandId);
    if (!normalized) {
      return;
    }
    const bucket = this.handlers.get(normalized);
    if (!bucket) {
      return;
    }
    if (handler) {
      bucket.delete(handler);
    } else {
      bucket.clear();
    }
    if (bucket.size === 0) {
      this.handlers.delete(normalized);
    }
  }

  registerBinding(bindingSpec = {}) {
    const normalized = this.#normalizeBinding(bindingSpec);
    if (!normalized) {
      return null;
    }

    const device = normalized.device;
    let bucket = this.bindings.get(device);
    if (!bucket) {
      bucket = [];
      this.bindings.set(device, bucket);
    }
    bucket.push(normalized);
    bucket.sort((a, b) => {
      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }
      return a.index - b.index;
    });
    return normalized;
  }

  removeBinding(bindingOrId) {
    if (!bindingOrId) {
      return false;
    }
    const id = typeof bindingOrId === 'string' ? bindingOrId : bindingOrId.id;
    if (!id) {
      return false;
    }

    for (const bucket of this.bindings.values()) {
      const index = bucket.findIndex((entry) => entry.id === id);
      if (index >= 0) {
        bucket.splice(index, 1);
        return true;
      }
    }
    return false;
  }
  handleInput(rawEvent = {}) {
    const normalizedEvent = this.#normalizeInputEvent(rawEvent);
    if (!normalizedEvent) {
      return null;
    }
    const binding = this.#findBinding(normalizedEvent);
    if (!binding) {
      return null;
    }

    const payload = binding.payloadBuilder
      ? binding.payloadBuilder(normalizedEvent, this.state)
      : null;

    return this.dispatch(binding.command, payload ?? {}, {
      device: normalizedEvent.device,
      inputs: normalizedEvent.inputs,
      identifier: normalizedEvent.identifier,
      hold: normalizedEvent.hold,
      repeat: normalizedEvent.repeat,
      binding,
      normalizedEvent,
      rawEvent,
      timestampSeconds: normalizedEvent.timestampSeconds,
    });
  }

  dispatch(commandId, payload = {}, context = {}) {
    const normalizedId = this.#normalizeCommandId(commandId);
    if (!normalizedId) {
      return null;
    }

    const timestampSeconds = resolveTimestamp(context, this.timeProvider);
    const previousState = snapshotState(this.state);
    const changes = this.#applyCommandEffects(normalizedId, payload, {
      ...context,
      timestampSeconds,
    });
    const currentState = snapshotState(this.state);

    this.sequence += 1;
    const eventId = `cmd-${this.sequence.toString().padStart(5, '0')}`;
    const event = {
      id: eventId,
      sequence: this.sequence,
      commandId: normalizedId,
      device: context.device ?? null,
      inputs: Array.isArray(context.inputs) ? [...context.inputs] : [],
      input: context.identifier ?? null,
      hold: Boolean(context.hold),
      repeat: Boolean(context.repeat),
      timestampSeconds,
      timestampGet: Number.isFinite(timestampSeconds) ? formatGET(timestampSeconds) : null,
      payload: clonePlain(payload),
      state: currentState,
      previousState,
      changes: changes ? clonePlain(changes) : null,
      bindingId: context.binding?.id ?? null,
      bindingSource: context.binding?.source ?? null,
    };

    this.#recordHistory(event);
    this.#emitEvent(event);
    return event;
  }

  resetState() {
    this.state = createInitialState();
  }

  #recordHistory(event) {
    this.history.push(event);
    if (this.history.length > this.historyLimit) {
      const excess = this.history.length - this.historyLimit;
      this.history.splice(0, excess);
    }
  }

  #emitEvent(event) {
    if (this.logger) {
      this.logger.log(event.timestampSeconds ?? 0, `UI command ${event.commandId}`, {
        logSource: this.logSource,
        logCategory: this.logCategory,
        logSeverity: 'info',
        commandId: event.commandId,
        device: event.device,
        input: event.input,
        view: event.state.view,
        mode: event.state.mode,
        focusTarget: event.state.focusTarget,
        tileModeActive: event.state.tileModeActive,
        bindingId: event.bindingId,
      });
    }

    for (const handler of this.anyHandlers) {
      handler(event);
    }

    const bucket = this.handlers.get(event.commandId);
    if (bucket) {
      for (const handler of bucket) {
        handler(event);
      }
    }

    if (this.eventBus) {
      this.eventBus.emit('ui:command', event);
      this.eventBus.emit(`ui:command:${event.commandId}`, event);
    }
  }

  #normalizeCommandId(value) {
    const normalized = normalizeString(value);
    return normalized ? normalized.toLowerCase() : null;
  }
  #normalizeBinding(bindingSpec) {
    if (!bindingSpec || typeof bindingSpec !== 'object') {
      return null;
    }
    const commandId = this.#normalizeCommandId(bindingSpec.command);
    if (!commandId) {
      return null;
    }

    const device = normalizeDevice(bindingSpec.device, this.defaultDevice);
    const rawInputs = this.#normalizeBindingInputs(bindingSpec.inputs);
    if (!rawInputs || rawInputs.length === 0) {
      return null;
    }
    const orderedInputs = normalizeBindingInputs(device, rawInputs);
    const identifier = orderedInputs.join('+');

    const binding = {
      id: `binding-${this.bindingCounter += 1}`,
      index: this.bindingCounter,
      command: commandId,
      device,
      inputs: orderedInputs,
      identifier,
      priority: Number.isFinite(bindingSpec.priority) ? bindingSpec.priority : 0,
      requiresHold: bindingSpec.requiresHold === true
        ? true
        : bindingSpec.requiresHold === false
          ? false
          : null,
      allowRepeat: bindingSpec.allowRepeat === true,
      modes: this.#normalizeStringArray(bindingSpec.modes),
      views: this.#normalizeStringArray(bindingSpec.views),
      requiresFocus: this.#normalizeFocus(bindingSpec.requiresFocus),
      requiresModalTarget: this.#normalizeFocus(bindingSpec.requiresModalTarget),
      tileMode: this.#normalizeTileMode(bindingSpec.tileMode),
      payloadBuilder: typeof bindingSpec.payload === 'function' ? bindingSpec.payload : null,
      source: bindingSpec.source ?? 'custom',
    };

    if (binding.modes && binding.modes.length === 0) {
      binding.modes = null;
    }
    if (binding.views && binding.views.length === 0) {
      binding.views = null;
    }

    return binding;
  }

  #normalizeTileMode(value) {
    if (!value) {
      return null;
    }
    const normalized = value.toString().toLowerCase();
    if (normalized === 'required') {
      return 'required';
    }
    if (normalized === 'disabled' || normalized === 'disallow') {
      return 'disallowed';
    }
    return null;
  }

  #normalizeStringArray(value) {
    if (!value) {
      return null;
    }
    const array = Array.isArray(value) ? value : [value];
    const normalized = array
      .map((entry) => normalizeString(entry))
      .filter(Boolean)
      .map((entry) => entry.toLowerCase());
    return normalized.length > 0 ? normalized : null;
  }

  #normalizeFocus(value) {
    const normalized = normalizeString(value);
    return normalized ? normalized.toLowerCase() : null;
  }

  #normalizeBindingInputs(inputs) {
    if (!inputs) {
      return null;
    }
    const list = Array.isArray(inputs) ? inputs : normalizeString(inputs)?.split('+');
    if (!list) {
      return null;
    }
    const normalized = [];
    for (const entry of list) {
      const token = normalizeString(entry);
      if (!token) {
        continue;
      }
      normalized.push(token.toUpperCase());
    }
    return normalized.length > 0 ? normalized : null;
  }

  #normalizeInputEvent(rawEvent = {}) {
    const device = normalizeDevice(rawEvent.device, this.defaultDevice);
    switch (device) {
      case 'keyboard':
        return this.#normalizeKeyboardEvent(rawEvent, device);
      case 'gamepad':
        return this.#normalizeGamepadEvent(rawEvent, device);
      case 'n64':
        return this.#normalizeN64Event(rawEvent, device);
      default:
        return null;
    }
  }

  #normalizeKeyboardEvent(rawEvent, device) {
    const type = normalizeString(rawEvent.type)?.toLowerCase() ?? 'keydown';
    if (type === 'keyup' || type === 'keyrelease') {
      return null;
    }

    const modifiers = {
      ctrl: Boolean(rawEvent.ctrlKey),
      meta: Boolean(rawEvent.metaKey),
      alt: Boolean(rawEvent.altKey),
      shift: Boolean(rawEvent.shiftKey),
    };
    const keyNormalized = normalizeKeyName(rawEvent.code, rawEvent.key, modifiers);
    if (!keyNormalized) {
      return null;
    }

    const inputs = [];
    if (modifiers.ctrl) {
      inputs.push('CTRL');
    }
    if (modifiers.meta) {
      inputs.push('META');
    }
    if (modifiers.alt) {
      inputs.push('ALT');
    }
    if (modifiers.shift) {
      inputs.push('SHIFT');
    }
    inputs.push(keyNormalized);

    const identifier = inputs.join('+');
    const timestampSeconds = resolveTimestamp(rawEvent, this.timeProvider);

    return {
      device,
      inputs,
      identifier,
      keyNormalized,
      rawKey: normalizeString(rawEvent.key),
      rawCode: normalizeString(rawEvent.code),
      hold: Boolean(rawEvent.hold),
      repeat: Boolean(rawEvent.repeat),
      modifiers,
      timestampSeconds,
      view: this.state.view,
      mode: this.state.mode,
      focusTarget: this.state.focusTarget,
      modalTarget: this.state.modalTarget,
      tileModeActive: this.state.tileModeActive,
      rawEvent,
    };
  }

  #normalizeGamepadEvent(rawEvent, device) {
    const inputs = this.#normalizeGamepadButtons(rawEvent);
    if (!inputs || inputs.length === 0) {
      return null;
    }
    const identifier = inputs.join('+');
    const timestampSeconds = resolveTimestamp(rawEvent, this.timeProvider);
    return {
      device,
      inputs,
      identifier,
      hold: Boolean(rawEvent.hold),
      repeat: Boolean(rawEvent.repeat),
      timestampSeconds,
      view: this.state.view,
      mode: this.state.mode,
      focusTarget: this.state.focusTarget,
      modalTarget: this.state.modalTarget,
      tileModeActive: this.state.tileModeActive,
      rawEvent,
    };
  }

  #normalizeN64Event(rawEvent, device) {
    const inputs = this.#normalizeN64Buttons(rawEvent);
    if (!inputs || inputs.length === 0) {
      return null;
    }
    const identifier = inputs.join('+');
    const timestampSeconds = resolveTimestamp(rawEvent, this.timeProvider);
    return {
      device,
      inputs,
      identifier,
      hold: Boolean(rawEvent.hold),
      repeat: Boolean(rawEvent.repeat),
      timestampSeconds,
      view: this.state.view,
      mode: this.state.mode,
      focusTarget: this.state.focusTarget,
      modalTarget: this.state.modalTarget,
      tileModeActive: this.state.tileModeActive,
      rawEvent,
    };
  }

  #normalizeGamepadButtons(rawEvent) {
    const buttons = [];
    if (Array.isArray(rawEvent.buttons)) {
      buttons.push(...rawEvent.buttons);
    } else if (rawEvent.buttons && typeof rawEvent.buttons[Symbol.iterator] === 'function') {
      buttons.push(...rawEvent.buttons);
    } else if (rawEvent.button != null) {
      buttons.push(rawEvent.button);
    }

    const normalized = [];
    for (const button of buttons) {
      const canonical = canonicalizeGamepadButton(button);
      if (canonical) {
        normalized.push(canonical);
      }
    }
    const unique = Array.from(new Set(normalized));
    unique.sort();
    return unique;
  }

  #normalizeN64Buttons(rawEvent) {
    const buttons = [];
    if (Array.isArray(rawEvent.buttons)) {
      buttons.push(...rawEvent.buttons);
    } else if (rawEvent.buttons && typeof rawEvent.buttons[Symbol.iterator] === 'function') {
      buttons.push(...rawEvent.buttons);
    } else if (rawEvent.button != null) {
      buttons.push(rawEvent.button);
    }

    const normalized = [];
    for (const button of buttons) {
      const canonical = canonicalizeN64Button(button);
      if (canonical) {
        normalized.push(canonical);
      }
    }
    const unique = Array.from(new Set(normalized));
    unique.sort();
    return unique;
  }

  #findBinding(event) {
    const list = this.bindings.get(event.device);
    if (!list || list.length === 0) {
      return null;
    }
    for (const binding of list) {
      if (!this.#bindingMatches(binding, event)) {
        continue;
      }
      return binding;
    }
    return null;
  }

  #bindingMatches(binding, event) {
    if (binding.identifier !== event.identifier) {
      return false;
    }
    if (binding.requiresHold === true && !event.hold) {
      return false;
    }
    if (binding.requiresHold === false && event.hold) {
      return false;
    }
    if (!binding.allowRepeat && event.repeat) {
      return false;
    }
    if (binding.modes && !binding.modes.includes(event.mode)) {
      return false;
    }
    if (binding.views && !binding.views.includes(event.view)) {
      return false;
    }
    if (binding.requiresFocus && binding.requiresFocus !== event.focusTarget) {
      return false;
    }
    if (binding.requiresModalTarget && binding.requiresModalTarget !== event.modalTarget) {
      return false;
    }
    if (binding.tileMode === 'required' && !event.tileModeActive) {
      return false;
    }
    if (binding.tileMode === 'disallowed' && event.tileModeActive) {
      return false;
    }
    return true;
  }
  #applyCommandEffects(commandId, payload = {}, context = {}) {
    const changes = {};

    switch (commandId) {
      case 'view:navigation': {
        const viewChange = this.#changeView('navigation');
        if (viewChange) {
          changes.view = viewChange;
        }
        break;
      }
      case 'view:controls': {
        const viewChange = this.#changeView('controls');
        if (viewChange) {
          changes.view = viewChange;
        }
        break;
      }
      case 'view:systems': {
        const viewChange = this.#changeView('systems');
        if (viewChange) {
          changes.view = viewChange;
        }
        break;
      }
      case 'view:cycle_forward': {
        const viewChange = this.#cycleView(1);
        if (viewChange) {
          changes.view = viewChange;
        }
        break;
      }
      case 'view:cycle_backward': {
        const viewChange = this.#cycleView(-1);
        if (viewChange) {
          changes.view = viewChange;
        }
        break;
      }
      case 'tile:toggle': {
        const tileChange = this.#toggleTileMode();
        if (tileChange) {
          changes.tileMode = tileChange;
        }
        break;
      }
      case 'checklist:open': {
        const overlayChange = this.#toggleChecklistOverlay();
        if (overlayChange) {
          changes.overlay = overlayChange;
        }
        break;
      }
      case 'context:do_next': {
        this.state.contextActions += 1;
        changes.contextActions = this.state.contextActions;
        break;
      }
      case 'dsky:focus': {
        const focusChange = this.#focusTarget('dsky');
        if (focusChange) {
          changes.focus = focusChange;
        }
        break;
      }
      case 'focus:release': {
        const focusChange = this.#releaseFocus();
        if (focusChange?.changed) {
          changes.focus = focusChange;
        }
        break;
      }
      case 'alarm:silence': {
        const silencedAt = context.timestampSeconds ?? resolveTimestamp(context, this.timeProvider);
        this.state.lastAlarmSilencedAt = silencedAt;
        changes.alarm = { silencedAt };
        break;
      }
      case 'sim:pause_toggle': {
        this.state.simPaused = !this.state.simPaused;
        changes.simPaused = this.state.simPaused;
        break;
      }
      case 'time:step_increase': {
        this.state.timeStepIncrements += 1;
        changes.timeStepIncrements = this.state.timeStepIncrements;
        break;
      }
      case 'time:step_decrease': {
        this.state.timeStepDecrements += 1;
        changes.timeStepDecrements = this.state.timeStepDecrements;
        break;
      }
      case 'navigation:timeline_prev': {
        this.state.navigationTimelineIndex = Math.max(0, this.state.navigationTimelineIndex - 1);
        changes.navigationTimelineIndex = this.state.navigationTimelineIndex;
        break;
      }
      case 'navigation:timeline_next': {
        this.state.navigationTimelineIndex += 1;
        changes.navigationTimelineIndex = this.state.navigationTimelineIndex;
        break;
      }
      case 'navigation:timeline_select': {
        const selectedAt = context.timestampSeconds ?? resolveTimestamp(context, this.timeProvider);
        this.state.navigationLastSelectedAt = selectedAt;
        changes.navigationLastSelectedAt = selectedAt;
        break;
      }
      case 'navigation:toggle_reference': {
        this.state.navReference = this.state.navReference === 'cmc' ? 'scs' : 'cmc';
        changes.navReference = this.state.navReference;
        break;
      }
      case 'navigation:plan_burn': {
        const at = context.timestampSeconds ?? resolveTimestamp(context, this.timeProvider);
        this.state.navigationPlanBurnAt = at;
        changes.navigationPlanBurnAt = at;
        break;
      }
      case 'navigation:toggle_projection': {
        this.state.navigationProjection = this.state.navigationProjection === '3d' ? '2d' : '3d';
        changes.navigationProjection = this.state.navigationProjection;
        break;
      }
      case 'navigation:toggle_docking_overlay': {
        this.state.dockingOverlayEnabled = !this.state.dockingOverlayEnabled;
        changes.dockingOverlayEnabled = this.state.dockingOverlayEnabled;
        break;
      }
      case 'controls:panel_prev': {
        this.state.controlsPanelIndex = Math.max(0, this.state.controlsPanelIndex - 1);
        changes.controlsPanelIndex = this.state.controlsPanelIndex;
        break;
      }
      case 'controls:panel_next': {
        this.state.controlsPanelIndex += 1;
        changes.controlsPanelIndex = this.state.controlsPanelIndex;
        break;
      }
      case 'controls:activate_panel': {
        const panelId = normalizeString(payload?.panelId) ?? 'active';
        this.state.controlsActivePanelId = panelId;
        const focusChange = this.#focusTarget('panel');
        if (focusChange) {
          changes.focus = focusChange;
        }
        changes.controlsActivePanelId = panelId;
        this.state.controlsControlIndex = 0;
        changes.controlsControlIndex = this.state.controlsControlIndex;
        break;
      }
      case 'controls:cycle_control_focus': {
        this.state.controlsControlIndex += 1;
        changes.controlsControlIndex = this.state.controlsControlIndex;
        break;
      }
      case 'controls:cycle_control_focus_backward': {
        this.state.controlsControlIndex = Math.max(0, this.state.controlsControlIndex - 1);
        changes.controlsControlIndex = this.state.controlsControlIndex;
        break;
      }
      case 'controls:toggle_control': {
        const at = context.timestampSeconds ?? resolveTimestamp(context, this.timeProvider);
        this.state.controlsLastActionAt = at;
        changes.controlsLastActionAt = at;
        break;
      }
      case 'controls:ack_step': {
        this.state.checklistAcknowledged += 1;
        changes.checklistAcknowledged = this.state.checklistAcknowledged;
        break;
      }
      case 'controls:mark_blocked': {
        this.state.checklistBlocked = !this.state.checklistBlocked;
        changes.checklistBlocked = this.state.checklistBlocked;
        break;
      }
      case 'dsky:key': {
        if (this.state.focusTarget !== 'dsky' && this.state.modalTarget !== 'macroTray') {
          break;
        }
        const key = payload?.key ?? resolveDskyKey(context.normalizedEvent ?? {});
        if (!key) {
          break;
        }
        const entry = {
          key,
          timestampSeconds: context.timestampSeconds ?? resolveTimestamp(context, this.timeProvider),
        };
        if (payload?.identifier) {
          entry.identifier = payload.identifier;
        }
        this.state.dskyBuffer.push(entry);
        if (this.state.dskyBuffer.length > this.state.dskyBufferLimit) {
          this.state.dskyBuffer.splice(0, this.state.dskyBuffer.length - this.state.dskyBufferLimit);
        }
        changes.dsky = {
          key,
          bufferLength: this.state.dskyBuffer.length,
        };
        break;
      }
      case 'dsky:macro_tray': {
        if (this.state.focusTarget !== 'dsky' && this.state.modalTarget !== 'macroTray') {
          break;
        }
        const isOpen = Boolean(this.state.overlays.macroTray);
        if (!isOpen) {
          this.state.previousModeBeforeModal = this.state.mode;
          this.state.previousFocusBeforeModal = this.state.focusTarget;
          this.state.overlays.macroTray = true;
          this.state.mode = 'modal';
          this.state.modalTarget = 'macroTray';
          changes.overlay = { name: 'macroTray', open: true };
        } else {
          this.state.overlays.macroTray = false;
          this.state.modalTarget = null;
          const previousMode = this.state.previousModeBeforeModal ?? 'idle';
          const previousFocus = this.state.previousFocusBeforeModal ?? null;
          this.state.previousModeBeforeModal = null;
          this.state.previousFocusBeforeModal = null;
          if (previousFocus) {
            this.state.mode = 'focused';
            this.state.focusTarget = previousFocus;
          } else {
            this.state.mode = 'idle';
            this.state.focusTarget = null;
          }
          changes.overlay = { name: 'macroTray', open: false, previousFocus };
        }
        break;
      }
      case 'systems:module_prev': {
        this.state.systemsModuleIndex = Math.max(0, this.state.systemsModuleIndex - 1);
        changes.systemsModuleIndex = this.state.systemsModuleIndex;
        break;
      }
      case 'systems:module_next': {
        this.state.systemsModuleIndex += 1;
        changes.systemsModuleIndex = this.state.systemsModuleIndex;
        break;
      }
      case 'systems:expand_trend': {
        this.state.systemsTrendExpanded = !this.state.systemsTrendExpanded;
        changes.systemsTrendExpanded = this.state.systemsTrendExpanded;
        break;
      }
      case 'systems:ack_caution': {
        this.state.systemsCautionsAcknowledged += 1;
        changes.systemsCautionsAcknowledged = this.state.systemsCautionsAcknowledged;
        break;
      }
      case 'systems:pin_dsn_pass': {
        this.state.systemsDsnPinned = !this.state.systemsDsnPinned;
        changes.systemsDsnPinned = this.state.systemsDsnPinned;
        break;
      }
      case 'systems:export_snapshot': {
        this.state.systemsSnapshots += 1;
        const exportedAt = context.timestampSeconds ?? resolveTimestamp(context, this.timeProvider);
        changes.systemsSnapshots = {
          total: this.state.systemsSnapshots,
          exportedAt,
        };
        break;
      }
      case 'workspace:save_layout': {
        this.state.workspaceSaves += 1;
        changes.workspaceSaves = this.state.workspaceSaves;
        break;
      }
      case 'workspace:load_preset_picker': {
        this.state.workspaceLoads += 1;
        changes.workspaceLoads = this.state.workspaceLoads;
        break;
      }
      default:
        break;
    }

    return Object.keys(changes).length > 0 ? changes : null;
  }

  #changeView(target) {
    const normalized = normalizeString(target)?.toLowerCase();
    if (!normalized) {
      return null;
    }
    if (this.state.view === normalized) {
      return { previous: normalized, current: normalized, changed: false };
    }
    const previous = this.state.view;
    this.state.view = normalized;
    const focus = this.#releaseFocus({ reason: 'view-change' });
    return {
      previous,
      current: normalized,
      released: focus,
    };
  }

  #cycleView(step) {
    const currentIndex = VIEW_ORDER.indexOf(this.state.view);
    const baseIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = (baseIndex + step + VIEW_ORDER.length) % VIEW_ORDER.length;
    if (nextIndex === baseIndex) {
      return null;
    }
    return this.#changeView(VIEW_ORDER[nextIndex]);
  }

  #toggleTileMode() {
    this.state.tileModeActive = !this.state.tileModeActive;
    return {
      value: this.state.tileModeActive,
    };
  }

  #toggleChecklistOverlay() {
    const isOpen = Boolean(this.state.overlays.checklist);
    if (!isOpen) {
      this.#releaseFocus({ reason: 'checklist-open' });
      this.state.overlays.checklist = true;
      this.state.mode = 'focused';
      this.state.focusTarget = 'checklist';
      return { name: 'checklist', open: true };
    }
    const released = this.#releaseFocus({ reason: 'checklist-close' });
    return { name: 'checklist', open: false, released };
  }

  #focusTarget(target) {
    const normalized = normalizeString(target)?.toLowerCase();
    if (!normalized) {
      return null;
    }
    if (this.state.mode === 'focused' && this.state.focusTarget === normalized) {
      return { target: normalized, changed: false };
    }
    const released = this.#releaseFocus({ reason: 'focus-change' });
    this.state.mode = 'focused';
    this.state.focusTarget = normalized;
    this.state.modalTarget = null;
    this.state.overlays.macroTray = false;
    this.state.previousModeBeforeModal = null;
    this.state.previousFocusBeforeModal = null;
    return {
      target: normalized,
      previousFocus: released.previousFocus ?? null,
      changed: true,
    };
  }

  #releaseFocus({ reason = null } = {}) {
    const previousMode = this.state.mode;
    const previousFocus = this.state.focusTarget;
    const previousModal = this.state.modalTarget;
    const changed = previousMode !== 'idle' || previousFocus || previousModal;

    this.state.mode = 'idle';
    this.state.focusTarget = null;
    this.state.modalTarget = null;
    this.state.previousModeBeforeModal = null;
    this.state.previousFocusBeforeModal = null;
    this.state.overlays.checklist = false;
    this.state.overlays.macroTray = false;

    return {
      changed,
      reason,
      previousMode,
      previousFocus,
      previousModal,
    };
  }
  #registerDefaultBindings() {
    const register = (spec) => this.registerBinding({ ...spec, source: 'default' });

    // Keyboard global bindings
    register({ device: 'keyboard', inputs: '1', command: 'view:navigation', modes: ['idle'] });
    register({ device: 'keyboard', inputs: '2', command: 'view:controls', modes: ['idle'] });
    register({ device: 'keyboard', inputs: '3', command: 'view:systems', modes: ['idle'] });
    register({ device: 'keyboard', inputs: 'TAB', command: 'view:cycle_forward', modes: ['idle'] });
    register({ device: 'keyboard', inputs: 'SHIFT+TAB', command: 'view:cycle_backward', modes: ['idle'] });
    register({ device: 'keyboard', inputs: 'T', command: 'tile:toggle', modes: ['idle'] });
    register({ device: 'keyboard', inputs: 'C', command: 'checklist:open', modes: ['idle'] });
    register({ device: 'keyboard', inputs: 'SPACE', command: 'context:do_next', modes: ['idle'] });
    register({ device: 'keyboard', inputs: 'G', command: 'dsky:focus', modes: ['idle'] });
    register({ device: 'keyboard', inputs: 'ESCAPE', command: 'focus:release', modes: ['focused', 'modal'] });
    register({ device: 'keyboard', inputs: 'M', command: 'alarm:silence', modes: ['idle', 'focused', 'modal'] });
    register({ device: 'keyboard', inputs: 'P', command: 'sim:pause_toggle', modes: ['idle'] });
    register({ device: 'keyboard', inputs: 'PERIOD', command: 'time:step_increase', modes: ['idle'] });
    register({ device: 'keyboard', inputs: 'COMMA', command: 'time:step_decrease', modes: ['idle'] });
    register({ device: 'keyboard', inputs: 'CTRL+S', command: 'workspace:save_layout', modes: ['idle'] });
    register({ device: 'keyboard', inputs: 'CTRL+L', command: 'workspace:load_preset_picker', modes: ['idle'] });

    // Keyboard navigation view
    register({ device: 'keyboard', inputs: 'ARROWLEFT', command: 'navigation:timeline_prev', modes: ['idle'], views: ['navigation'] });
    register({ device: 'keyboard', inputs: 'ARROWRIGHT', command: 'navigation:timeline_next', modes: ['idle'], views: ['navigation'] });
    register({ device: 'keyboard', inputs: 'ENTER', command: 'navigation:timeline_select', modes: ['idle'], views: ['navigation'] });
    register({ device: 'keyboard', inputs: 'V', command: 'navigation:toggle_reference', modes: ['idle'], views: ['navigation'] });
    register({ device: 'keyboard', inputs: 'B', command: 'navigation:plan_burn', modes: ['idle'], views: ['navigation'] });
    register({ device: 'keyboard', inputs: 'F', command: 'navigation:toggle_projection', modes: ['idle'], views: ['navigation'] });
    register({ device: 'keyboard', inputs: 'D', command: 'navigation:toggle_docking_overlay', modes: ['idle'], views: ['navigation'] });

    // Keyboard controls view
    register({ device: 'keyboard', inputs: 'ARROWUP', command: 'controls:panel_prev', modes: ['idle'], views: ['controls'] });
    register({ device: 'keyboard', inputs: 'ARROWDOWN', command: 'controls:panel_next', modes: ['idle'], views: ['controls'] });
    register({ device: 'keyboard', inputs: 'ENTER', command: 'controls:activate_panel', modes: ['idle'], views: ['controls'] });
    register({ device: 'keyboard', inputs: 'TAB', command: 'controls:cycle_control_focus', priority: 10, modes: ['focused'], requiresFocus: 'panel' });
    register({ device: 'keyboard', inputs: 'SHIFT+TAB', command: 'controls:cycle_control_focus_backward', priority: 10, modes: ['focused'], requiresFocus: 'panel' });
    register({ device: 'keyboard', inputs: 'SPACE', command: 'controls:toggle_control', priority: 10, modes: ['focused'], requiresFocus: 'panel' });
    register({ device: 'keyboard', inputs: 'ENTER', command: 'controls:ack_step', priority: 10, modes: ['focused'], requiresFocus: 'checklist' });
    register({ device: 'keyboard', inputs: 'SHIFT+ENTER', command: 'controls:mark_blocked', priority: 10, modes: ['focused'], requiresFocus: 'checklist' });
    register({ device: 'keyboard', inputs: 'CTRL+M', command: 'dsky:macro_tray', priority: 10, modes: ['focused'], requiresFocus: 'dsky' });

    // Keyboard systems view
    register({ device: 'keyboard', inputs: 'ARROWLEFT', command: 'systems:module_prev', modes: ['idle'], views: ['systems'] });
    register({ device: 'keyboard', inputs: 'ARROWRIGHT', command: 'systems:module_next', modes: ['idle'], views: ['systems'] });
    register({ device: 'keyboard', inputs: 'CTRL+E', command: 'systems:export_snapshot', modes: ['idle'], views: ['systems'] });
    register({ device: 'keyboard', inputs: 'SHIFT+P', command: 'systems:pin_dsn_pass', modes: ['idle'], views: ['systems'] });

    // Keyboard DSKY keys
    for (let digit = 0; digit <= 9; digit += 1) {
      register({
        device: 'keyboard',
        inputs: `${digit}`,
        command: 'dsky:key',
        priority: 20,
        modes: ['focused'],
        requiresFocus: 'dsky',
        allowRepeat: true,
        payload: (event) => createDskyPayload(event, `${digit}`),
      });
    }
    register({
      device: 'keyboard',
      inputs: 'V',
      command: 'dsky:key',
      priority: 20,
      modes: ['focused'],
      requiresFocus: 'dsky',
      payload: (event) => createDskyPayload(event, 'VERB'),
    });
    register({
      device: 'keyboard',
      inputs: 'N',
      command: 'dsky:key',
      priority: 20,
      modes: ['focused'],
      requiresFocus: 'dsky',
      payload: (event) => createDskyPayload(event, 'NOUN'),
    });
    register({
      device: 'keyboard',
      inputs: 'ENTER',
      command: 'dsky:key',
      priority: 20,
      modes: ['focused'],
      requiresFocus: 'dsky',
      payload: (event) => createDskyPayload(event, 'PRO'),
    });
    register({
      device: 'keyboard',
      inputs: 'BACKSPACE',
      command: 'dsky:key',
      priority: 20,
      modes: ['focused'],
      requiresFocus: 'dsky',
      payload: (event) => createDskyPayload(event, 'KEY_REL'),
    });
    register({
      device: 'keyboard',
      inputs: 'SHIFT+PLUS',
      command: 'dsky:key',
      priority: 20,
      modes: ['focused'],
      requiresFocus: 'dsky',
      payload: (event) => createDskyPayload(event, 'PLUS'),
    });
    register({
      device: 'keyboard',
      inputs: 'MINUS',
      command: 'dsky:key',
      priority: 20,
      modes: ['focused'],
      requiresFocus: 'dsky',
      payload: (event) => createDskyPayload(event, 'MINUS'),
    });

    // Gamepad global bindings
    register({ device: 'gamepad', inputs: 'LB+X', command: 'view:navigation', modes: ['idle'] });
    register({ device: 'gamepad', inputs: 'LB+Y', command: 'view:controls', modes: ['idle'] });
    register({
      device: 'gamepad',
      inputs: 'LB+B',
      command: 'view:systems',
      modes: ['idle'],
    });
    register({ device: 'gamepad', inputs: 'LB+RB', command: 'view:cycle_forward', modes: ['idle'] });
    register({ device: 'gamepad', inputs: 'X', command: 'checklist:open', modes: ['idle'] });
    register({ device: 'gamepad', inputs: 'A', command: 'context:do_next', modes: ['idle'] });
    register({
      device: 'gamepad',
      inputs: 'Y',
      command: 'dsky:focus',
      modes: ['idle'],
      requiresHold: true,
    });
    register({ device: 'gamepad', inputs: 'SELECT', command: 'tile:toggle', modes: ['idle'] });
    register({ device: 'gamepad', inputs: 'LB+SELECT', command: 'workspace:save_layout', modes: ['idle'] });
    register({ device: 'gamepad', inputs: 'LB+MENU', command: 'workspace:load_preset_picker', modes: ['idle'] });
    register({ device: 'gamepad', inputs: 'MENU', command: 'sim:pause_toggle', modes: ['idle'] });
    register({ device: 'gamepad', inputs: 'R3', command: 'alarm:silence', modes: ['idle', 'focused', 'modal'] });
    register({ device: 'gamepad', inputs: 'RB+RIGHT', command: 'time:step_increase', modes: ['idle'] });
    register({ device: 'gamepad', inputs: 'RB+LEFT', command: 'time:step_decrease', modes: ['idle'] });

    // Gamepad navigation/controls/systems specifics
    register({ device: 'gamepad', inputs: 'LEFT', command: 'navigation:timeline_prev', modes: ['idle'], views: ['navigation'] });
    register({ device: 'gamepad', inputs: 'RIGHT', command: 'navigation:timeline_next', modes: ['idle'], views: ['navigation'] });
    register({ device: 'gamepad', inputs: 'UP', command: 'controls:panel_prev', modes: ['idle'], views: ['controls'] });
    register({ device: 'gamepad', inputs: 'DOWN', command: 'controls:panel_next', modes: ['idle'], views: ['controls'] });
    register({ device: 'gamepad', inputs: 'A', command: 'controls:toggle_control', priority: 10, modes: ['focused'], requiresFocus: 'panel' });
    register({ device: 'gamepad', inputs: 'A+LB', command: 'controls:mark_blocked', priority: 10, modes: ['focused'], requiresFocus: 'checklist' });
    register({ device: 'gamepad', inputs: 'RB+UP', command: 'controls:cycle_control_focus', priority: 10, modes: ['focused'], requiresFocus: 'panel' });
    register({ device: 'gamepad', inputs: 'RB+DOWN', command: 'controls:cycle_control_focus_backward', priority: 10, modes: ['focused'], requiresFocus: 'panel' });
    register({ device: 'gamepad', inputs: 'RB+B', command: 'navigation:toggle_docking_overlay', modes: ['idle'], views: ['navigation'] });
    register({ device: 'gamepad', inputs: 'LB+B', command: 'systems:pin_dsn_pass', priority: 5, modes: ['idle'], views: ['systems'] });
    register({ device: 'gamepad', inputs: 'LB+X', command: 'dsky:macro_tray', priority: 15, modes: ['focused'], requiresFocus: 'dsky', requiresHold: true });

    // N64 global bindings
    register({ device: 'n64', inputs: 'C-LEFT', command: 'view:navigation', modes: ['idle'] });
    register({ device: 'n64', inputs: 'C-UP', command: 'view:controls', modes: ['idle'] });
    register({ device: 'n64', inputs: 'C-RIGHT', command: 'view:systems', modes: ['idle'] });
    register({ device: 'n64', inputs: 'L', command: 'view:cycle_backward', modes: ['idle'] });
    register({ device: 'n64', inputs: 'R', command: 'view:cycle_forward', modes: ['idle'] });
    register({ device: 'n64', inputs: 'START', command: 'tile:toggle', modes: ['idle'] });
    register({ device: 'n64', inputs: 'START+Z', command: 'sim:pause_toggle', modes: ['idle'] });
    register({ device: 'n64', inputs: 'B', command: 'checklist:open', modes: ['idle'] });
    register({ device: 'n64', inputs: 'A', command: 'context:do_next', modes: ['idle'] });
    register({ device: 'n64', inputs: 'Z', command: 'dsky:focus', modes: ['idle'], requiresHold: true });
    register({ device: 'n64', inputs: 'C-DOWN', command: 'alarm:silence', modes: ['idle', 'focused', 'modal'] });
    register({ device: 'n64', inputs: 'R+C-RIGHT', command: 'time:step_increase', modes: ['idle'] });
    register({ device: 'n64', inputs: 'R+C-LEFT', command: 'time:step_decrease', modes: ['idle'] });

    register({ device: 'n64', inputs: 'R+C-DOWN', command: 'navigation:toggle_docking_overlay', modes: ['idle'], views: ['navigation'] });
    register({ device: 'n64', inputs: 'R+A', command: 'navigation:plan_burn', modes: ['idle'], views: ['navigation'] });
    register({ device: 'n64', inputs: 'UP', command: 'controls:panel_prev', modes: ['idle'], views: ['controls'] });
    register({ device: 'n64', inputs: 'DOWN', command: 'controls:panel_next', modes: ['idle'], views: ['controls'] });
    register({ device: 'n64', inputs: 'L+B', command: 'systems:pin_dsn_pass', modes: ['idle'], views: ['systems'] });
    register({ device: 'n64', inputs: 'L+C-RIGHT', command: 'systems:export_snapshot', modes: ['idle'], views: ['systems'] });
    register({ device: 'n64', inputs: 'L+C-UP', command: 'dsky:macro_tray', modes: ['focused'], requiresFocus: 'dsky' });
  }
}
