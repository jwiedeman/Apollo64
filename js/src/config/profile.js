import os from 'os';
import path from 'path';

export const PROFILE_ENV_VAR = 'APOLLO64_PROFILE';
export const DEFAULT_PROFILE_DIRNAME = '.apollo64';
export const DEFAULT_PROFILE_BASENAME = 'profile.json';

function resolveHomeDir() {
  if (typeof os.homedir === 'function') {
    const dir = os.homedir();
    if (dir && dir.trim().length > 0) {
      return dir;
    }
  }
  return process.cwd();
}

export function getDefaultProfilePath() {
  const envPath = (process.env[PROFILE_ENV_VAR] ?? '').trim();
  if (envPath.length > 0) {
    return path.resolve(envPath);
  }
  const baseDir = resolveHomeDir();
  return path.resolve(baseDir, DEFAULT_PROFILE_DIRNAME, DEFAULT_PROFILE_BASENAME);
}

export function normalizeProfilePath(value) {
  if (value == null) {
    return null;
  }
  const trimmed = String(value).trim();
  if (trimmed.length === 0 || trimmed === '-') {
    return null;
  }
  if (trimmed.startsWith('~')) {
    const homeDir = resolveHomeDir();
    const relative = trimmed.slice(1);
    return path.resolve(homeDir, relative);
  }
  return path.resolve(trimmed);
}

export function getProfileDirectory(profilePath) {
  if (!profilePath) {
    return null;
  }
  return path.dirname(profilePath);
}
