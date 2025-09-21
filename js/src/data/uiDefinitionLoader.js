import fs from 'fs/promises';
import path from 'path';

import { parseGET } from '../utils/time.js';

export async function loadUiDefinitions(baseDir, { logger = null } = {}) {
  const resolvedDir = path.resolve(baseDir);

  const [panels, checklists, workspaces] = await Promise.all([
    loadPanelBundle(resolvedDir, { logger }),
    loadChecklistBundle(resolvedDir, { logger }),
    loadWorkspaceBundle(resolvedDir, { logger }),
  ]);

  return {
    panels,
    checklists,
    workspaces,
  };
}

async function loadPanelBundle(baseDir, { logger }) {
  const filePath = path.resolve(baseDir, 'panels.json');
  const raw = await readJsonFile(filePath, { logger, label: 'UI panels bundle' });
  return normalizePanelBundle(raw);
}

async function loadChecklistBundle(baseDir, { logger }) {
  const filePath = path.resolve(baseDir, 'checklists.json');
  const raw = await readJsonFile(filePath, { logger, label: 'UI checklists bundle' });
  return normalizeChecklistBundle(raw);
}

async function loadWorkspaceBundle(baseDir, { logger }) {
  const filePath = path.resolve(baseDir, 'workspaces.json');
  const raw = await readJsonFile(filePath, { logger, label: 'UI workspaces bundle' });
  return normalizeWorkspaceBundle(raw);
}

async function readJsonFile(filePath, { logger, label }) {
  let content;
  try {
    content = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null;
    }
    logger?.log(0, `Failed to read ${label ?? filePath}`, {
      logSource: 'sim',
      logCategory: 'system',
      logSeverity: 'failure',
      error: error?.message ?? String(error),
      filePath,
    });
    return null;
  }

  try {
    return JSON.parse(content);
  } catch (error) {
    logger?.log(0, `Failed to parse ${label ?? filePath}`, {
      logSource: 'sim',
      logCategory: 'system',
      logSeverity: 'failure',
      error: error?.message ?? String(error),
      filePath,
    });
    return null;
  }
}

function normalizePanelBundle(raw) {
  if (!raw || typeof raw !== 'object') {
    return createPanelBundle();
  }

  const version = toFiniteNumber(raw.version);
  const panelsArray = Array.isArray(raw.panels)
    ? raw.panels
    : Array.isArray(raw.items)
      ? raw.items
      : [];

  const panels = [];
  const map = new Map();
  let totalControls = 0;

  for (const entry of panelsArray) {
    const panel = normalizePanel(entry);
    if (!panel) {
      continue;
    }
    panels.push(panel);
    map.set(panel.id, panel);
    totalControls += panel.controls.length;
  }

  return createPanelBundle({ version, panels, map, totalControls });
}

function normalizePanel(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const id = normalizeString(entry.id ?? entry.panelId);
  if (!id) {
    return null;
  }

  const controls = normalizePanelControls(entry.controls);
  const layout = normalizePanelLayout(entry.layout);
  const alerts = normalizePanelAlerts(entry.alerts);

  return {
    id,
    name: entry.name != null ? String(entry.name) : id,
    craft: normalizeString(entry.craft),
    layout: layout.layout,
    hotspotsByControl: layout.hotspotsByControl,
    controls: controls.list,
    controlsById: controls.map,
    alerts: alerts.list,
    alertsById: alerts.map,
    tags: normalizeStringArray(entry.tags),
    metadata: entry.metadata && typeof entry.metadata === 'object' ? deepClone(entry.metadata) : null,
  };
}

function normalizePanelControls(rawControls) {
  const list = [];
  const map = new Map();

  if (!Array.isArray(rawControls)) {
    return { list, map };
  }

  for (const rawControl of rawControls) {
    if (!rawControl || typeof rawControl !== 'object') {
      continue;
    }

    const id = normalizeString(rawControl.id ?? rawControl.controlId);
    if (!id) {
      continue;
    }

    const states = normalizeControlStates(rawControl.states);

    const control = {
      id,
      label: rawControl.label != null ? String(rawControl.label) : id,
      type: normalizeString(rawControl.type),
      description: rawControl.description != null ? String(rawControl.description) : null,
      defaultState: normalizeString(rawControl.defaultState ?? rawControl.default_state),
      telemetry: rawControl.telemetry && typeof rawControl.telemetry === 'object'
        ? deepClone(rawControl.telemetry)
        : null,
      dependencies: normalizeDependencyList(rawControl.dependencies),
      effects: normalizeEffectList(rawControl.effects),
      states: states.list,
      statesById: states.map,
      tags: normalizeStringArray(rawControl.tags),
      metadata: rawControl.metadata && typeof rawControl.metadata === 'object'
        ? deepClone(rawControl.metadata)
        : null,
    };

    if (!control.defaultState && control.states.length > 0) {
      control.defaultState = control.states[0].id ?? null;
    }

    list.push(control);
    map.set(control.id, control);
  }

  return { list, map };
}

function normalizeControlStates(rawStates) {
  const list = [];
  const map = new Map();

  if (!Array.isArray(rawStates)) {
    return { list, map };
  }

  for (const rawState of rawStates) {
    if (!rawState || typeof rawState !== 'object') {
      continue;
    }

    const id = normalizeString(rawState.id ?? rawState.stateId ?? rawState.value);
    if (!id) {
      continue;
    }

    const state = deepClone(rawState);
    state.id = id;

    for (const key of ['drawKw', 'heatKw', 'propellantKg', 'deltaKw', 'deltaKg']) {
      if (state[key] != null) {
        const numeric = toFiniteNumber(state[key]);
        if (numeric != null) {
          state[key] = numeric;
        }
      }
    }

    if (state.label != null) {
      state.label = String(state.label);
    }

    list.push(state);
    map.set(state.id, state);
  }

  return { list, map };
}

function normalizePanelLayout(rawLayout) {
  if (!rawLayout || typeof rawLayout !== 'object') {
    return { layout: { schematic: null, hotspots: [] }, hotspotsByControl: new Map() };
  }

  const schematic = normalizeString(rawLayout.schematic ?? rawLayout.asset);
  const hotspots = [];
  const hotspotsByControl = new Map();

  const hotspotEntries = Array.isArray(rawLayout.hotspots) ? rawLayout.hotspots : [];
  for (const entry of hotspotEntries) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const controlId = normalizeString(entry.controlId ?? entry.control_id);
    if (!controlId) {
      continue;
    }

    const hotspot = {
      controlId,
      x: toFiniteNumber(entry.x),
      y: toFiniteNumber(entry.y),
      width: toFiniteNumber(entry.width),
      height: toFiniteNumber(entry.height),
    };

    const rotation = toFiniteNumber(entry.rotation);
    if (rotation != null) {
      hotspot.rotation = rotation;
    }

    const anchor = normalizeStringArray(entry.anchor ?? entry.anchors);
    if (anchor.length > 0) {
      hotspot.anchor = anchor;
    }

    hotspots.push(hotspot);
    hotspotsByControl.set(controlId, hotspot);
  }

  return {
    layout: { schematic, hotspots },
    hotspotsByControl,
  };
}

function normalizePanelAlerts(rawAlerts) {
  const list = [];
  const map = new Map();

  if (!Array.isArray(rawAlerts)) {
    return { list, map };
  }

  for (const entry of rawAlerts) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const id = normalizeString(entry.id);
    if (!id) {
      continue;
    }

    const alert = deepClone(entry);
    alert.id = id;
    if (alert.severity != null) {
      alert.severity = String(alert.severity);
    }
    if (alert.message != null) {
      alert.message = String(alert.message);
    }

    list.push(alert);
    map.set(alert.id, alert);
  }

  return { list, map };
}

function normalizeChecklistBundle(raw) {
  if (!raw || typeof raw !== 'object') {
    return createChecklistBundle();
  }

  const version = toFiniteNumber(raw.version);
  const checklistsArray = Array.isArray(raw.checklists)
    ? raw.checklists
    : Array.isArray(raw.items)
      ? raw.items
      : [];

  const checklists = [];
  const map = new Map();
  let totalSteps = 0;

  for (const entry of checklistsArray) {
    const checklist = normalizeChecklist(entry);
    if (!checklist) {
      continue;
    }
    checklists.push(checklist);
    map.set(checklist.id, checklist);
    totalSteps += checklist.totalSteps;
  }

  return createChecklistBundle({ version, checklists, map, totalSteps });
}

function normalizeChecklist(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const id = normalizeString(entry.id);
  if (!id) {
    return null;
  }

  const steps = normalizeChecklistSteps(entry.steps);

  const nominalGet = normalizeString(entry.nominalGet ?? entry.nominal_get);
  const nominalGetSeconds = nominalGet != null ? parseGET(nominalGet) : null;

  return {
    id,
    title: entry.title != null ? String(entry.title) : id,
    phase: normalizeString(entry.phase),
    role: normalizeString(entry.role),
    nominalGet,
    nominalGetSeconds: Number.isFinite(nominalGetSeconds) ? nominalGetSeconds : null,
    source: entry.source && typeof entry.source === 'object' ? deepClone(entry.source) : null,
    steps: steps.list,
    stepsById: steps.byId,
    stepsByOrder: steps.byOrder,
    totalSteps: steps.list.length,
    tags: normalizeStringArray(entry.tags),
    metadata: entry.metadata && typeof entry.metadata === 'object' ? deepClone(entry.metadata) : null,
  };
}

function normalizeChecklistSteps(rawSteps) {
  const list = [];
  const byId = new Map();
  const byOrder = new Map();

  if (!Array.isArray(rawSteps)) {
    return { list, byId, byOrder };
  }

  for (let index = 0; index < rawSteps.length; index += 1) {
    const rawStep = rawSteps[index];
    if (!rawStep || typeof rawStep !== 'object') {
      continue;
    }

    const id = normalizeString(rawStep.id);
    const orderValue = toFiniteNumber(rawStep.order);
    const order = Number.isFinite(orderValue) && orderValue > 0 ? Math.floor(orderValue) : index + 1;

    const controls = normalizeChecklistControls(rawStep.controls);

    const step = {
      id: id ?? `step_${index + 1}`,
      order,
      callout: rawStep.callout != null ? String(rawStep.callout) : null,
      panelId: normalizeString(rawStep.panel ?? rawStep.panelId),
      controls: controls.list,
      dskyMacro: normalizeString(rawStep.dskyMacro ?? rawStep.dsky_macro),
      manualOnly: Boolean(rawStep.manualOnly ?? rawStep.manual_only),
      prerequisites: normalizeStringArray(rawStep.prerequisites),
      effects: normalizeEffectList(rawStep.effects),
      notes: rawStep.notes != null ? String(rawStep.notes) : null,
      tags: normalizeStringArray(rawStep.tags),
      metadata: rawStep.metadata && typeof rawStep.metadata === 'object'
        ? deepClone(rawStep.metadata)
        : null,
    };

    list.push(step);
    byOrder.set(step.order, step);
    if (id) {
      byId.set(step.id, step);
    }
  }

  return { list, byId, byOrder };
}

function normalizeChecklistControls(rawControls) {
  const list = [];
  if (!Array.isArray(rawControls)) {
    return { list };
  }

  for (const rawControl of rawControls) {
    if (!rawControl || typeof rawControl !== 'object') {
      continue;
    }

    const controlId = normalizeString(rawControl.controlId ?? rawControl.control_id ?? rawControl.id);
    const targetState = normalizeString(rawControl.targetState ?? rawControl.target_state ?? rawControl.state);

    const control = {
      controlId,
      targetState,
      verification: normalizeString(rawControl.verification),
      tolerance: toFiniteNumber(rawControl.tolerance),
      label: rawControl.label != null ? String(rawControl.label) : null,
      notes: rawControl.notes != null ? String(rawControl.notes) : null,
      metadata: rawControl.metadata && typeof rawControl.metadata === 'object'
        ? deepClone(rawControl.metadata)
        : null,
    };

    const prerequisites = normalizeStringArray(rawControl.prerequisites);
    if (prerequisites.length > 0) {
      control.prerequisites = prerequisites;
    }

    if (rawControl.manualOnly != null) {
      control.manualOnly = Boolean(rawControl.manualOnly);
    }

    list.push(control);
  }

  return { list };
}

function normalizeWorkspaceBundle(raw) {
  if (!raw || typeof raw !== 'object') {
    return createWorkspaceBundle();
  }

  const version = toFiniteNumber(raw.version);
  const presetsArray = Array.isArray(raw.presets)
    ? raw.presets
    : Array.isArray(raw.items)
      ? raw.items
      : [];

  const presets = [];
  const map = new Map();
  let totalTiles = 0;

  for (const entry of presetsArray) {
    const preset = normalizeWorkspacePreset(entry);
    if (!preset) {
      continue;
    }
    presets.push(preset);
    map.set(preset.id, preset);
    totalTiles += preset.tiles.length;
  }

  return createWorkspaceBundle({ version, presets, map, totalTiles });
}

function normalizeWorkspacePreset(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const id = normalizeString(entry.id);
  if (!id) {
    return null;
  }

  return {
    id,
    name: entry.name != null ? String(entry.name) : id,
    description: entry.description != null ? String(entry.description) : null,
    viewport: normalizeWorkspaceViewport(entry.viewport),
    tiles: normalizeWorkspaceTiles(entry.tiles),
    tileMode: normalizeWorkspaceTileMode(entry.tileMode ?? entry.tile_mode),
    tags: normalizeStringArray(entry.tags),
    metadata: entry.metadata && typeof entry.metadata === 'object' ? deepClone(entry.metadata) : null,
  };
}

function normalizeWorkspaceViewport(rawViewport) {
  if (!rawViewport || typeof rawViewport !== 'object') {
    return null;
  }

  const viewport = {};
  const minWidth = toFiniteNumber(rawViewport.minWidth ?? rawViewport.min_width);
  const minHeight = toFiniteNumber(rawViewport.minHeight ?? rawViewport.min_height);

  if (minWidth != null) {
    viewport.minWidth = minWidth;
  }
  if (minHeight != null) {
    viewport.minHeight = minHeight;
  }

  if (rawViewport.maxWidth != null) {
    const maxWidth = toFiniteNumber(rawViewport.maxWidth);
    if (maxWidth != null) {
      viewport.maxWidth = maxWidth;
    }
  }

  if (rawViewport.maxHeight != null) {
    const maxHeight = toFiniteNumber(rawViewport.maxHeight);
    if (maxHeight != null) {
      viewport.maxHeight = maxHeight;
    }
  }

  if (rawViewport.hudPinned != null) {
    viewport.hudPinned = Boolean(rawViewport.hudPinned);
  } else if (rawViewport.hud_pinned != null) {
    viewport.hudPinned = Boolean(rawViewport.hud_pinned);
  }

  return Object.keys(viewport).length > 0 ? viewport : null;
}

function normalizeWorkspaceTiles(rawTiles) {
  const tiles = [];

  if (!Array.isArray(rawTiles)) {
    return tiles;
  }

  for (let index = 0; index < rawTiles.length; index += 1) {
    const rawTile = rawTiles[index];
    if (!rawTile || typeof rawTile !== 'object') {
      continue;
    }

    const windowId = normalizeString(rawTile.window ?? rawTile.widget ?? rawTile.component);
    if (!windowId) {
      continue;
    }

    const id = normalizeString(rawTile.id) ?? `${windowId}_${index + 1}`;

    const tile = {
      id,
      window: windowId,
      x: toFiniteNumber(rawTile.x),
      y: toFiniteNumber(rawTile.y),
      width: toFiniteNumber(rawTile.width),
      height: toFiniteNumber(rawTile.height),
      constraints: normalizeTileConstraints(rawTile.constraints),
      panelFocus: normalizeString(rawTile.panelFocus ?? rawTile.panel_focus),
      tags: normalizeStringArray(rawTile.tags),
      metadata: rawTile.metadata && typeof rawTile.metadata === 'object'
        ? deepClone(rawTile.metadata)
        : null,
    };

    if (rawTile.minWidth != null || rawTile.minHeight != null || rawTile.aspectRatio != null) {
      const fallback = {
        minWidth: toFiniteNumber(rawTile.minWidth),
        minHeight: toFiniteNumber(rawTile.minHeight),
        aspectRatio: toFiniteNumber(rawTile.aspectRatio),
      };
      tile.constraints = mergeConstraints(tile.constraints, fallback);
    }

    tiles.push(tile);
  }

  return tiles;
}

function normalizeTileConstraints(rawConstraints) {
  if (!rawConstraints || typeof rawConstraints !== 'object') {
    return null;
  }

  const constraints = {};

  const minWidth = toFiniteNumber(rawConstraints.minWidth ?? rawConstraints.min_width);
  if (minWidth != null) {
    constraints.minWidth = minWidth;
  }

  const minHeight = toFiniteNumber(rawConstraints.minHeight ?? rawConstraints.min_height);
  if (minHeight != null) {
    constraints.minHeight = minHeight;
  }

  const aspectRatio = toFiniteNumber(rawConstraints.aspectRatio ?? rawConstraints.aspect_ratio);
  if (aspectRatio != null) {
    constraints.aspectRatio = aspectRatio;
  }

  if (rawConstraints.maxWidth != null) {
    const maxWidth = toFiniteNumber(rawConstraints.maxWidth);
    if (maxWidth != null) {
      constraints.maxWidth = maxWidth;
    }
  }

  if (rawConstraints.maxHeight != null) {
    const maxHeight = toFiniteNumber(rawConstraints.maxHeight);
    if (maxHeight != null) {
      constraints.maxHeight = maxHeight;
    }
  }

  if (rawConstraints.maximizedOnly != null) {
    constraints.maximizedOnly = Boolean(rawConstraints.maximizedOnly);
  } else if (rawConstraints.maximized_only != null) {
    constraints.maximizedOnly = Boolean(rawConstraints.maximized_only);
  }

  return Object.keys(constraints).length > 0 ? constraints : null;
}

function mergeConstraints(primary, fallback) {
  const target = primary ? { ...primary } : {};
  if (fallback.minWidth != null && target.minWidth == null) {
    target.minWidth = fallback.minWidth;
  }
  if (fallback.minHeight != null && target.minHeight == null) {
    target.minHeight = fallback.minHeight;
  }
  if (fallback.aspectRatio != null && target.aspectRatio == null) {
    target.aspectRatio = fallback.aspectRatio;
  }
  return Object.keys(target).length > 0 ? target : null;
}

function normalizeWorkspaceTileMode(rawTileMode) {
  if (!rawTileMode || typeof rawTileMode !== 'object') {
    return null;
  }

  const tileMode = {};

  const snap = toFiniteNumber(rawTileMode.snap);
  if (snap != null) {
    tileMode.snap = snap;
  }

  const rawGrid = Array.isArray(rawTileMode.grid)
    ? rawTileMode.grid
    : Array.isArray(rawTileMode.gridSize)
      ? rawTileMode.gridSize
      : Array.isArray(rawTileMode.grid_size)
        ? rawTileMode.grid_size
        : null;

  if (Array.isArray(rawGrid)) {
    const grid = rawGrid
      .map((value) => toFiniteNumber(value))
      .filter((value) => value != null);
    if (grid.length === 2) {
      tileMode.grid = grid;
    }
  }

  const focusRaw = rawTileMode.focus;
  if (focusRaw && typeof focusRaw === 'object') {
    const focus = {};
    if (focusRaw.retainHud != null) {
      focus.retainHud = Boolean(focusRaw.retainHud);
    } else if (focusRaw.retain_hud != null) {
      focus.retainHud = Boolean(focusRaw.retain_hud);
    }
    const animationMs = toFiniteNumber(focusRaw.animationMs ?? focusRaw.animation_ms);
    if (animationMs != null) {
      focus.animationMs = animationMs;
    }
    if (Object.keys(focus).length > 0) {
      tileMode.focus = focus;
    }
  }

  if (rawTileMode.snapToGrid != null) {
    tileMode.snapToGrid = Boolean(rawTileMode.snapToGrid);
  }

  return Object.keys(tileMode).length > 0 ? tileMode : null;
}

function normalizeDependencyList(rawDependencies) {
  if (!Array.isArray(rawDependencies)) {
    return [];
  }

  const result = [];
  for (const entry of rawDependencies) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const dependency = deepClone(entry);
    if (dependency.type != null) {
      dependency.type = normalizeString(dependency.type) ?? dependency.type;
    }
    if (dependency.id != null) {
      dependency.id = normalizeString(dependency.id) ?? dependency.id;
    }
    if (dependency.control != null) {
      dependency.control = normalizeString(dependency.control) ?? dependency.control;
    }
    if (dependency.panel != null) {
      dependency.panel = normalizeString(dependency.panel) ?? dependency.panel;
    }
    if (dependency.state != null) {
      dependency.state = normalizeString(dependency.state) ?? dependency.state;
    }
    if (dependency.flag != null) {
      dependency.flag = normalizeString(dependency.flag) ?? dependency.flag;
    }
    result.push(dependency);
  }
  return result;
}

function normalizeEffectList(rawEffects) {
  if (!Array.isArray(rawEffects)) {
    return [];
  }

  const result = [];
  for (const entry of rawEffects) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const effect = deepClone(entry);
    if (effect.type != null) {
      effect.type = normalizeString(effect.type) ?? effect.type;
    }
    if (effect.id != null) {
      effect.id = normalizeString(effect.id) ?? effect.id;
    }
    if (effect.target != null) {
      effect.target = normalizeString(effect.target) ?? effect.target;
    }
    if (effect.panel != null) {
      effect.panel = normalizeString(effect.panel) ?? effect.panel;
    }
    if (effect.control != null) {
      effect.control = normalizeString(effect.control) ?? effect.control;
    }
    if (effect.state != null) {
      effect.state = normalizeString(effect.state) ?? effect.state;
    }
    result.push(effect);
  }
  return result;
}

function createPanelBundle({ version = null, panels = [], map = new Map(), totalControls = 0 } = {}) {
  return { version, items: panels, map, totalControls };
}

function createChecklistBundle({ version = null, checklists = [], map = new Map(), totalSteps = 0 } = {}) {
  return { version, items: checklists, map, totalSteps };
}

function createWorkspaceBundle({ version = null, presets = [], map = new Map(), totalTiles = 0 } = {}) {
  return { version, items: presets, map, totalTiles };
}

function normalizeString(value) {
  if (value == null) {
    return null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const result = [];
  for (const entry of value) {
    const normalized = normalizeString(entry);
    if (normalized) {
      result.push(normalized);
    }
  }
  return result;
}

function toFiniteNumber(value) {
  if (value == null) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}
