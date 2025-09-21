#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';

import { UI_DOCS_DIR } from '../config/paths.js';
import { loadUiDefinitions } from '../data/uiDefinitionLoader.js';
import { WorkspaceStore } from '../hud/workspaceStore.js';
import { parseGET } from '../utils/time.js';

const DEFAULT_OUTPUT = path.resolve('out/workspace_export.json');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const uiDir = path.resolve(args.uiDir);

  const uiDefinitions = await loadUiDefinitions(uiDir, {});
  const workspaceBundle = uiDefinitions?.workspaces ?? null;
  if (!workspaceBundle || !Array.isArray(workspaceBundle.items) || workspaceBundle.items.length === 0) {
    throw new Error(`No workspace presets found in ${uiDir}`);
  }

  const store = new WorkspaceStore({
    bundle: workspaceBundle,
    timeProvider: () => args.getSeconds ?? 0,
  });

  if (args.preset) {
    store.activatePreset(args.preset, { view: args.view ?? null, source: 'cli' });
  } else if (args.view) {
    store.activateView(args.view, { source: 'cli' });
  }

  for (const [key, value] of Object.entries(args.overrides)) {
    store.updateOverride(key, value, { source: 'cli' });
  }

  for (const { device, binding, value } of args.inputOverrides) {
    store.updateInputOverride(device, binding, value, { source: 'cli' });
  }

  for (const mutation of args.tileMutations) {
    store.mutateTile(mutation.tileId, mutation.patch, {
      source: 'cli',
      reason: mutation.reason,
      pointer: mutation.pointer,
    });
  }

  const serialized = store.serialize({ includeHistory: args.includeHistory });
  const output = {
    metadata: {
      generatedAt: new Date().toISOString(),
      uiDir,
      includeHistory: args.includeHistory,
      preset: serialized.activePresetId,
      view: serialized.activeView,
      overrides: Object.keys(args.overrides),
      inputOverrides: args.inputOverrides.length,
      tileMutations: args.tileMutations.length,
    },
    workspace: serialized,
  };

  const json = args.pretty ? JSON.stringify(output, null, 2) : JSON.stringify(output);

  if (args.outputPath) {
    const resolvedOutput = path.resolve(args.outputPath);
    await fs.mkdir(path.dirname(resolvedOutput), { recursive: true });
    await fs.writeFile(resolvedOutput, json, 'utf8');
    if (!args.quiet) {
      console.log(`Workspace exported to ${resolvedOutput}`);
    }
  } else {
    process.stdout.write(`${json}\n`);
  }
}

function parseArgs(argv) {
  const args = {
    uiDir: UI_DOCS_DIR,
    outputPath: DEFAULT_OUTPUT,
    preset: null,
    view: null,
    includeHistory: true,
    quiet: false,
    pretty: true,
    getSeconds: null,
    overrides: {},
    inputOverrides: [],
    tileMutations: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--ui-dir': {
        const next = argv[i + 1];
        if (!next) {
          throw new Error('--ui-dir requires a path');
        }
        args.uiDir = next;
        i += 1;
        break;
      }
      case '--output': {
        const next = argv[i + 1];
        if (!next) {
          throw new Error('--output requires a path or "stdout"');
        }
        if (next === 'stdout') {
          args.outputPath = null;
        } else {
          args.outputPath = next;
        }
        i += 1;
        break;
      }
      case '--preset': {
        const next = argv[i + 1];
        if (!next) {
          throw new Error('--preset requires a preset id');
        }
        args.preset = next;
        i += 1;
        break;
      }
      case '--view': {
        const next = argv[i + 1];
        if (!next) {
          throw new Error('--view requires a view id');
        }
        args.view = next;
        i += 1;
        break;
      }
      case '--override': {
        const next = argv[i + 1];
        if (!next || !next.includes('=')) {
          throw new Error('--override expects key=value');
        }
        const [key, rawValue] = next.split('=');
        const normalizedKey = key.trim();
        if (!normalizedKey) {
          throw new Error('Override key must be non-empty');
        }
        args.overrides[normalizedKey] = parseOverrideValue(rawValue);
        i += 1;
        break;
      }
      case '--input-override': {
        const next = argv[i + 1];
        if (!next || !next.includes('=') || !next.includes('.')) {
          throw new Error('--input-override expects device.binding=value');
        }
        const [bindingPath, rawValue] = next.split('=');
        const [device, binding] = bindingPath.split('.', 2);
        if (!device || !binding) {
          throw new Error('--input-override expects device.binding=value');
        }
        args.inputOverrides.push({
          device: device.trim().toLowerCase(),
          binding: binding.trim(),
          value: rawValue === undefined ? undefined : parseOverrideValue(rawValue),
        });
        i += 1;
        break;
      }
      case '--tile': {
        const next = argv[i + 1];
        if (!next || !next.includes(':')) {
          throw new Error('--tile expects tileId:key=value[,key=value]');
        }
        const [tileIdRaw, mutations] = next.split(':', 2);
        const tileId = tileIdRaw.trim();
        if (!tileId) {
          throw new Error('Tile mutation requires a tile id');
        }
        const patch = {};
        for (const pair of mutations.split(',')) {
          if (!pair.includes('=')) {
            continue;
          }
          const [field, value] = pair.split('=');
          const key = field.trim();
          if (!key) {
            continue;
          }
          patch[key] = parseTileValue(value);
        }
        if (Object.keys(patch).length > 0) {
          args.tileMutations.push({ tileId, patch, reason: 'cli_export', pointer: 'cli' });
        }
        i += 1;
        break;
      }
      case '--get': {
        const next = argv[i + 1];
        if (!next) {
          throw new Error('--get requires a GET value (e.g., 002:30:00)');
        }
        const parsed = parseGET(next);
        if (parsed == null) {
          throw new Error(`Invalid GET value: ${next}`);
        }
        args.getSeconds = parsed;
        i += 1;
        break;
      }
      case '--no-history':
        args.includeHistory = false;
        break;
      case '--history':
        args.includeHistory = true;
        break;
      case '--quiet':
        args.quiet = true;
        break;
      case '--minify':
      case '--no-pretty':
        args.pretty = false;
        break;
      case '--pretty':
        args.pretty = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function parseOverrideValue(value) {
  if (value == null) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }
  const lower = trimmed.toLowerCase();
  if (lower === 'true') {
    return true;
  }
  if (lower === 'false') {
    return false;
  }
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) {
    return numeric;
  }
  return trimmed;
}

function parseTileValue(value) {
  if (value == null) {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    return undefined;
  }
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) {
    return numeric;
  }
  return trimmed;
}

try {
  await main();
} catch (error) {
  console.error(error?.message ?? error);
  process.exitCode = 1;
}
