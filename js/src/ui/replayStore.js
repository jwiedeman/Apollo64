const DEFAULT_EPSILON = 1e-6;

export class ReplayStore {
  constructor(options = {}) {
    this.options = {
      epsilon: Number.isFinite(options.epsilon) ? Math.max(options.epsilon, 0) : DEFAULT_EPSILON,
    };
    this.listeners = new Set();
    this.reset();
  }

  reset() {
    this.metadata = null;
    this.summary = null;
    this.logSummary = null;

    this.frames = [];
    this.frameTimes = [];

    this.logs = [];
    this.manualActions = [];
    this.audioCues = [];

    this.manualCounts = {
      manual: 0,
      auto: 0,
      unknown: 0,
    };

    this.currentIndex = -1;
    this.currentTime = 0;

    this.playbackState = {
      playing: false,
      speed: 1,
      loop: false,
    };
  }

  loadBundle(bundle = {}) {
    this.reset();

    this.metadata = deepClone(bundle.metadata ?? null);
    this.summary = deepClone(bundle.summary ?? null);

    const missionLog = bundle.missionLog ?? bundle.log ?? null;
    this.logSummary = missionLog ? this.#normalizeMissionLogSummary(missionLog) : null;

    this.frames = this.#normalizeFrames(bundle.frames ?? []);
    this.frameTimes = this.frames.map((frame) => frame.generatedAtSeconds ?? 0);

    const logEntries = Array.isArray(bundle.logs)
      ? bundle.logs
      : Array.isArray(this.logSummary?.entries)
        ? this.logSummary.entries
        : [];
    this.logs = this.#normalizeLogs(logEntries);

    const manualSource = bundle.manualActions
      ?? bundle.manual_actions
      ?? bundle.manualQueue
      ?? bundle.manual;
    this.manualActions = this.#normalizeManualActions(manualSource);
    this.manualCounts = this.#countManualActions(this.manualActions);

    const audioSource = bundle.audioCues ?? bundle.audio ?? bundle.audioLedger ?? null;
    this.audioCues = this.#normalizeAudioCues(audioSource);

    if (this.frames.length > 0) {
      this.currentIndex = 0;
      this.currentTime = this.frames[0].generatedAtSeconds ?? 0;
    } else {
      this.currentIndex = -1;
      this.currentTime = 0;
    }

    this.playbackState = {
      playing: false,
      speed: 1,
      loop: false,
    };

    this.#emitChange();
    return {
      frameCount: this.frames.length,
      logCount: this.logs.length,
      manualCount: this.manualActions.length,
      audioCount: this.audioCues.length,
    };
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

  getFrameCount() {
    return this.frames.length;
  }

  getFrames() {
    return this.frames.map((frame) => deepClone(frame));
  }

  getFrame(index) {
    const frame = this.frames[index];
    return frame ? deepClone(frame) : null;
  }

  getCurrentFrame() {
    if (this.currentIndex < 0 || this.currentIndex >= this.frames.length) {
      return null;
    }
    return this.getFrame(this.currentIndex);
  }

  getMetadata() {
    return deepClone(this.metadata);
  }

  getSummary() {
    return deepClone(this.summary);
  }

  getMissionLogSummary() {
    return deepClone(this.logSummary);
  }

  getManualActionStats() {
    return { ...this.manualCounts };
  }

  getManualFraction() {
    const total = this.manualCounts.manual + this.manualCounts.auto + this.manualCounts.unknown;
    if (total === 0) {
      return null;
    }
    return this.manualCounts.manual / total;
  }

  getPlaybackState() {
    return { ...this.playbackState, currentTime: this.currentTime, currentIndex: this.currentIndex };
  }

  getCurrentTime() {
    return this.currentTime;
  }

  setPlaybackState({ playing, speed, loop, currentTime } = {}) {
    let changed = false;

    if (typeof playing === 'boolean' && playing !== this.playbackState.playing) {
      this.playbackState.playing = playing;
      changed = true;
    }

    if (Number.isFinite(speed) && speed > 0 && speed !== this.playbackState.speed) {
      this.playbackState.speed = speed;
      changed = true;
    }

    if (typeof loop === 'boolean' && loop !== this.playbackState.loop) {
      this.playbackState.loop = loop;
      changed = true;
    }

    if (Number.isFinite(currentTime)) {
      changed = this.seekToTime(currentTime) || changed;
    } else if (changed) {
      this.#emitChange();
    }

    return changed;
  }

  setCurrentIndex(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.frames.length) {
      return false;
    }
    if (index === this.currentIndex) {
      return false;
    }
    this.currentIndex = index;
    this.currentTime = this.frames[index].generatedAtSeconds ?? this.currentTime;
    this.#emitChange();
    return true;
  }

  step(delta = 1) {
    if (!Number.isFinite(delta) || delta === 0) {
      return this.getCurrentFrame();
    }
    const target = Math.min(
      Math.max(this.currentIndex + Math.trunc(delta), 0),
      this.frames.length > 0 ? this.frames.length - 1 : -1,
    );
    if (target === this.currentIndex) {
      return this.getCurrentFrame();
    }
    this.currentIndex = target;
    if (this.currentIndex >= 0) {
      this.currentTime = this.frames[this.currentIndex].generatedAtSeconds ?? this.currentTime;
    }
    this.#emitChange();
    return this.getCurrentFrame();
  }

  seekToTime(targetSeconds) {
    if (!Number.isFinite(targetSeconds) || this.frames.length === 0) {
      return false;
    }

    const firstTime = this.frameTimes[0];
    const lastTime = this.frameTimes[this.frameTimes.length - 1];
    const clamped = Math.min(Math.max(targetSeconds, firstTime), lastTime);
    const index = this.#findFrameIndexForTime(clamped);
    const changed = index !== this.currentIndex || Math.abs(this.currentTime - clamped) > this.options.epsilon;
    this.currentIndex = index;
    this.currentTime = clamped;
    if (changed) {
      this.#emitChange();
    }
    return changed;
  }

  update(elapsedSeconds) {
    if (!this.playbackState.playing || !Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) {
      return this.getCurrentFrame();
    }
    if (this.frames.length === 0) {
      return null;
    }

    const delta = elapsedSeconds * (this.playbackState.speed ?? 1);
    let nextTime = this.currentTime + delta;
    const firstTime = this.frameTimes[0];
    const lastTime = this.frameTimes[this.frameTimes.length - 1];

    if (nextTime > lastTime + this.options.epsilon) {
      if (this.playbackState.loop && lastTime > firstTime) {
        const duration = lastTime - firstTime;
        const offset = (nextTime - firstTime) % duration;
        nextTime = firstTime + offset;
      } else {
        nextTime = lastTime;
        this.playbackState.playing = false;
      }
    } else if (nextTime < firstTime - this.options.epsilon) {
      nextTime = firstTime;
    }

    const changed = this.seekToTime(nextTime);
    if (!changed) {
      this.currentTime = nextTime;
    }
    return this.getCurrentFrame();
  }

  getUpcomingAnnotations(options = {}) {
    const {
      fromTime = this.currentTime,
      includeLogs = true,
      includeManual = true,
      includeAudio = true,
      limit = null,
      inclusive = false,
    } = options;

    const results = [];

    if (includeLogs) {
      results.push(...this.#collectAnnotations(this.logs, fromTime, 'log', inclusive));
    }
    if (includeManual) {
      results.push(...this.#collectAnnotations(this.manualActions, fromTime, 'manual', inclusive));
    }
    if (includeAudio) {
      results.push(...this.#collectAnnotations(this.audioCues, fromTime, 'audio', inclusive));
    }

    results.sort((a, b) => {
      if (a.getSeconds !== b.getSeconds) {
        return a.getSeconds - b.getSeconds;
      }
      if (a.sequence !== b.sequence) {
        return (a.sequence ?? 0) - (b.sequence ?? 0);
      }
      if (a.type !== b.type) {
        return a.type < b.type ? -1 : 1;
      }
      if (a.id !== b.id) {
        return a.id < b.id ? -1 : 1;
      }
      return 0;
    });

    if (Number.isInteger(limit) && limit >= 0) {
      return results.slice(0, limit);
    }
    return results;
  }

  getAnnotationsInRange(startSeconds, endSeconds, options = {}) {
    if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)) {
      return [];
    }
    const start = Math.min(startSeconds, endSeconds);
    const end = Math.max(startSeconds, endSeconds);
    const {
      includeLogs = true,
      includeManual = true,
      includeAudio = true,
      inclusiveEnd = true,
    } = options;

    const results = [];
    if (includeLogs) {
      results.push(...this.#collectRange(this.logs, start, end, inclusiveEnd));
    }
    if (includeManual) {
      results.push(...this.#collectRange(this.manualActions, start, end, inclusiveEnd));
    }
    if (includeAudio) {
      results.push(...this.#collectRange(this.audioCues, start, end, inclusiveEnd));
    }

    results.sort((a, b) => {
      if (a.getSeconds !== b.getSeconds) {
        return a.getSeconds - b.getSeconds;
      }
      if (a.sequence !== b.sequence) {
        return (a.sequence ?? 0) - (b.sequence ?? 0);
      }
      if (a.type !== b.type) {
        return a.type < b.type ? -1 : 1;
      }
      if (a.id !== b.id) {
        return a.id < b.id ? -1 : 1;
      }
      return 0;
    });

    return results;
  }

  getFrameRange() {
    if (this.frames.length === 0) {
      return { start: null, end: null };
    }
    return {
      start: this.frameTimes[0],
      end: this.frameTimes[this.frameTimes.length - 1],
    };
  }

  #collectAnnotations(list, fromTime, type, inclusive) {
    if (!Array.isArray(list) || list.length === 0) {
      return [];
    }
    const epsilon = this.options.epsilon;
    const predicate = inclusive
      ? (value) => value.getSeconds + epsilon >= fromTime
      : (value) => value.getSeconds > fromTime + epsilon;

    const startIndex = this.#findFirstIndex(list, fromTime, inclusive);
    const results = [];
    for (let i = startIndex; i < list.length; i += 1) {
      const entry = list[i];
      if (!predicate(entry)) {
        continue;
      }
      results.push({
        type,
        id: entry.id,
        getSeconds: entry.getSeconds,
        sequence: entry.sequence,
        category: entry.category ?? null,
        severity: entry.severity ?? null,
        actor: entry.actor ?? null,
        isManual: entry.isManual ?? false,
        entry: deepClone(entry.entry ?? entry.raw ?? entry),
      });
    }
    return results;
  }

  #collectRange(list, start, end, inclusiveEnd) {
    if (!Array.isArray(list) || list.length === 0) {
      return [];
    }
    const epsilon = this.options.epsilon;
    const startIndex = this.#findFirstIndex(list, start, true);
    const results = [];
    for (let i = startIndex; i < list.length; i += 1) {
      const entry = list[i];
      if (entry.getSeconds + epsilon < start) {
        continue;
      }
      if (inclusiveEnd) {
        if (entry.getSeconds > end + epsilon) {
          break;
        }
      } else if (entry.getSeconds >= end - epsilon) {
        break;
      }
      results.push({
        type: entry.type ?? 'log',
        id: entry.id,
        getSeconds: entry.getSeconds,
        sequence: entry.sequence,
        category: entry.category ?? null,
        severity: entry.severity ?? null,
        actor: entry.actor ?? null,
        isManual: entry.isManual ?? false,
        entry: deepClone(entry.entry ?? entry.raw ?? entry),
      });
    }
    return results;
  }

  #findFirstIndex(list, target, inclusive) {
    if (!Array.isArray(list) || list.length === 0) {
      return 0;
    }
    let low = 0;
    let high = list.length - 1;
    let result = list.length;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const value = list[mid].getSeconds;
      if (value > target || (inclusive && Math.abs(value - target) <= this.options.epsilon)) {
        result = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }
    return result === list.length ? Math.max(0, list.length - 1) : result;
  }

  #findFrameIndexForTime(targetSeconds) {
    if (this.frames.length === 0) {
      return -1;
    }
    let low = 0;
    let high = this.frames.length - 1;
    let result = 0;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const value = this.frameTimes[mid];
      if (value <= targetSeconds + this.options.epsilon) {
        result = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return result;
  }

  #emitChange() {
    for (const listener of this.listeners) {
      try {
        listener({
          currentIndex: this.currentIndex,
          currentTime: this.currentTime,
          playback: this.getPlaybackState(),
        });
      } catch {
        // ignore listener errors
      }
    }
  }

  #normalizeMissionLogSummary(summary) {
    if (!summary || typeof summary !== 'object') {
      return null;
    }
    const normalized = deepClone(summary);
    if (!Array.isArray(normalized.entries)) {
      normalized.entries = [];
    }
    return normalized;
  }

  #normalizeFrames(frames) {
    if (!Array.isArray(frames)) {
      return [];
    }
    const normalized = [];
    frames.forEach((frame, index) => {
      if (!frame || typeof frame !== 'object') {
        return;
      }
      const clone = deepClone(frame);
      let seconds = this.#coerceNumber(
        clone.generatedAtSeconds
          ?? clone.time?.getSeconds
          ?? clone.time?.metSeconds
          ?? null,
      );
      if (!Number.isFinite(seconds)) {
        seconds = normalized.length > 0
          ? normalized[normalized.length - 1].generatedAtSeconds
          : 0;
      }
      clone.generatedAtSeconds = seconds;
      clone.sequence = index;
      normalized.push(clone);
    });
    normalized.sort((a, b) => {
      if (a.generatedAtSeconds !== b.generatedAtSeconds) {
        return a.generatedAtSeconds - b.generatedAtSeconds;
      }
      return (a.sequence ?? 0) - (b.sequence ?? 0);
    });
    return normalized;
  }

  #normalizeLogs(entries) {
    if (!Array.isArray(entries)) {
      return [];
    }
    const normalized = [];
    entries.forEach((entry, index) => {
      if (!entry || typeof entry !== 'object') {
        return;
      }
      const time = this.#coerceNumber(
        entry.timestampSeconds
          ?? entry.getSeconds
          ?? entry.time
          ?? entry.timestamp
          ?? null,
      );
      if (!Number.isFinite(time)) {
        return;
      }
      const id = this.#normalizeId(entry.id ?? entry.logId ?? null, index, 'log');
      const clone = deepClone(entry);
      normalized.push({
        type: 'log',
        id,
        getSeconds: time,
        sequence: this.#coerceNumber(entry.sequence, index) ?? index,
        category: typeof entry.category === 'string' ? entry.category : null,
        severity: typeof entry.severity === 'string' ? entry.severity : null,
        entry: clone,
      });
    });
    normalized.sort((a, b) => {
      if (a.getSeconds !== b.getSeconds) {
        return a.getSeconds - b.getSeconds;
      }
      if (a.sequence !== b.sequence) {
        return (a.sequence ?? 0) - (b.sequence ?? 0);
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    return normalized;
  }

  #normalizeManualActions(source) {
    let entries = [];
    if (Array.isArray(source)) {
      entries = source;
    } else if (source && typeof source === 'object') {
      if (Array.isArray(source.actions)) {
        entries = source.actions;
      } else if (Array.isArray(source.entries)) {
        entries = source.entries;
      }
    }
    const normalized = [];
    entries.forEach((entry, index) => {
      if (!entry || typeof entry !== 'object') {
        return;
      }
      const time = this.#coerceNumber(
        entry.getSeconds
          ?? entry.get_seconds
          ?? entry.time
          ?? entry.timestampSeconds
          ?? entry.timestamp
          ?? null,
      );
      if (!Number.isFinite(time)) {
        return;
      }
      const id = this.#normalizeId(entry.id ?? entry.action_id ?? entry.entry_id ?? null, index, 'manual');
      const actorRaw = this.#normalizeActor(entry.actor ?? entry.source ?? entry.performed_by ?? entry.metadata?.actor ?? null);
      const isManual = this.#isManualActor(actorRaw);
      const type = typeof entry.type === 'string'
        ? entry.type
        : typeof entry.action_type === 'string'
          ? entry.action_type
          : typeof entry.kind === 'string'
            ? entry.kind
            : null;
      const clone = deepClone(entry);
      normalized.push({
        type: 'manual',
        id,
        getSeconds: time,
        sequence: this.#coerceNumber(entry.sequence, index) ?? index,
        actor: actorRaw,
        isManual,
        category: type,
        entry: clone,
      });
    });
    normalized.sort((a, b) => {
      if (a.getSeconds !== b.getSeconds) {
        return a.getSeconds - b.getSeconds;
      }
      if (a.sequence !== b.sequence) {
        return (a.sequence ?? 0) - (b.sequence ?? 0);
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    return normalized;
  }

  #normalizeAudioCues(source) {
    let entries = [];
    if (Array.isArray(source)) {
      entries = source;
    } else if (source && typeof source === 'object') {
      if (Array.isArray(source.entries)) {
        entries = source.entries;
      } else if (Array.isArray(source.cues)) {
        entries = source.cues;
      }
    }
    const normalized = [];
    entries.forEach((entry, index) => {
      if (!entry || typeof entry !== 'object') {
        return;
      }
      const time = this.#coerceNumber(
        entry.getSeconds
          ?? entry.timestampSeconds
          ?? entry.time
          ?? entry.startedAtSeconds
          ?? null,
      );
      if (!Number.isFinite(time)) {
        return;
      }
      const id = this.#normalizeId(entry.id ?? entry.cueId ?? entry.cue_id ?? null, index, 'audio');
      const clone = deepClone(entry);
      normalized.push({
        type: 'audio',
        id,
        getSeconds: time,
        sequence: this.#coerceNumber(entry.sequence, index) ?? index,
        category: typeof entry.category === 'string' ? entry.category : null,
        severity: typeof entry.severity === 'string' ? entry.severity : null,
        entry: clone,
      });
    });
    normalized.sort((a, b) => {
      if (a.getSeconds !== b.getSeconds) {
        return a.getSeconds - b.getSeconds;
      }
      if (a.sequence !== b.sequence) {
        return (a.sequence ?? 0) - (b.sequence ?? 0);
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    return normalized;
  }

  #countManualActions(entries) {
    const counts = { manual: 0, auto: 0, unknown: 0 };
    for (const entry of entries) {
      if (entry.isManual === true) {
        counts.manual += 1;
      } else if (entry.isManual === false && entry.actor) {
        counts.auto += 1;
      } else {
        counts.unknown += 1;
      }
    }
    return counts;
  }

  #coerceNumber(value, fallback = null) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    if (typeof value === 'bigint') {
      return Number(value);
    }
    return fallback;
  }

  #normalizeId(id, index, prefix) {
    if (typeof id === 'string' && id.trim().length > 0) {
      return id.trim();
    }
    const padded = String(index + 1).padStart(6, '0');
    return `${prefix}-${padded}`;
  }

  #normalizeActor(actor) {
    if (actor == null) {
      return null;
    }
    const trimmed = String(actor).trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  #isManualActor(actor) {
    if (!actor) {
      return null;
    }
    const normalized = actor.toLowerCase();
    if (normalized.includes('manual')) {
      return true;
    }
    if (normalized.includes('auto')) {
      return false;
    }
    if (normalized === 'player' || normalized === 'crew' || normalized.includes('astronaut')) {
      return true;
    }
    return null;
  }
}

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

