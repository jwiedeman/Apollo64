import { formatGET } from '../utils/time.js';

const DEFAULT_OPTIONS = {
  maxEntries: 1000,
  defaultSource: 'sim',
  defaultSeverity: 'info',
};

const KNOWN_CATEGORIES = new Set([
  'event',
  'checklist',
  'manual',
  'autopilot',
  'audio',
  'ui',
  'accessibility',
  'system',
  'score',
  'resource',
  'agc',
]);

const KNOWN_SEVERITIES = new Set(['info', 'notice', 'caution', 'warning', 'failure']);

export class MissionLogAggregator {
  constructor(logger = null, options = {}) {
    this.logger = logger ?? null;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.entries = [];
    this.lastProcessedIndex = 0;
    this.sequence = 0;
  }

  update() {
    const sourceEntries = this.logger?.getEntries?.();
    if (!Array.isArray(sourceEntries)) {
      return;
    }

    if (this.lastProcessedIndex >= sourceEntries.length) {
      return;
    }

    for (let index = this.lastProcessedIndex; index < sourceEntries.length; index += 1) {
      const normalized = this.#normalizeEntry(sourceEntries[index], index);
      if (!normalized) {
        continue;
      }
      this.entries.push(normalized);
      if (this.entries.length > this.options.maxEntries) {
        const excess = this.entries.length - this.options.maxEntries;
        this.entries.splice(0, excess);
      }
    }

    this.lastProcessedIndex = sourceEntries.length;
  }

  snapshot(options = {}) {
    this.update();

    const {
      limit = null,
      categories = null,
      severities = null,
      sinceSeconds = null,
    } = options ?? {};

    const categoryFilter = this.#normalizeFilterSet(categories);
    const severityFilter = this.#normalizeFilterSet(severities);

    let filtered = this.entries;

    if (Number.isFinite(sinceSeconds)) {
      filtered = filtered.filter((entry) => entry.timestampSeconds >= sinceSeconds);
    }

    if (categoryFilter) {
      filtered = filtered.filter((entry) => categoryFilter.has((entry.category ?? '').toLowerCase()));
    }

    if (severityFilter) {
      filtered = filtered.filter((entry) => severityFilter.has((entry.severity ?? '').toLowerCase()));
    }

    if (Number.isFinite(limit) && limit >= 0) {
      const start = Math.max(0, filtered.length - limit);
      filtered = filtered.slice(start);
    } else {
      filtered = filtered.slice();
    }

    const entries = filtered.map((entry) => ({
      ...entry,
      context: entry.context ? deepClone(entry.context) : {},
    }));

    const lastEntry = entries.length > 0 ? entries[entries.length - 1] : null;

    return {
      entries,
      totalCount: this.entries.length,
      filteredCount: entries.length,
      categories: this.#countBy(this.entries, 'category'),
      severities: this.#countBy(this.entries, 'severity'),
      filteredCategories: this.#countBy(entries, 'category'),
      filteredSeverities: this.#countBy(entries, 'severity'),
      lastTimestampSeconds: lastEntry?.timestampSeconds ?? null,
      lastTimestampGet: lastEntry?.timestampGet ?? null,
    };
  }

  clear() {
    this.entries = [];
    this.lastProcessedIndex = 0;
    this.sequence = 0;
  }

  #normalizeEntry(raw, index) {
    if (!raw || typeof raw !== 'object') {
      return null;
    }

    const timestampSeconds = this.#coerceNumber(
      raw.getSeconds ?? raw.timestampSeconds ?? raw.time ?? null,
    );
    const timestampGet = Number.isFinite(timestampSeconds) ? formatGET(timestampSeconds) : null;
    const message = this.#normalizeMessage(raw.message);
    const context = this.#normalizeContext(raw.context);

    const sequence = (this.sequence += 1);
    const id = this.#resolveId(context, sequence, index);
    const category = this.#resolveCategory(message, context);
    const severity = this.#resolveSeverity(message, context);
    const source = this.#resolveSource(context);

    return {
      id,
      index,
      sequence,
      timestampSeconds: Number.isFinite(timestampSeconds) ? timestampSeconds : null,
      timestampGet,
      category,
      source,
      severity,
      message,
      context,
    };
  }

  #resolveId(context, sequence, index) {
    const contextId = typeof context.logId === 'string' ? context.logId.trim() : null;
    if (contextId) {
      delete context.logId;
      return contextId;
    }
    const padded = sequence.toString().padStart(6, '0');
    return `log-${padded}`;
  }

  #resolveCategory(message, context) {
    const explicit = this.#coerceCategory(
      context.logCategory ?? context.category ?? context.type ?? null,
    );
    if (explicit) {
      delete context.logCategory;
      delete context.category;
      delete context.type;
      return explicit;
    }

    const lowerMessage = message.toLowerCase();
    if (context.eventId || lowerMessage.startsWith('event ')) {
      return 'event';
    }
    if (context.actor || lowerMessage.startsWith('manual')) {
      return 'manual';
    }
    if (context.checklistId || lowerMessage.includes('checklist')) {
      return 'checklist';
    }
    if (context.autopilotId || lowerMessage.startsWith('autopilot')) {
      return 'autopilot';
    }
    if (lowerMessage.includes('audio')) {
      return 'audio';
    }
    if (lowerMessage.includes('accessibility')) {
      return 'accessibility';
    }
    if (lowerMessage.includes('hud') || lowerMessage.includes('ui ')) {
      return 'ui';
    }
    if (lowerMessage.includes('score')) {
      return 'score';
    }
    if (lowerMessage.includes('failure') || lowerMessage.includes('abort')) {
      return 'system';
    }
    if (lowerMessage.includes('power') || lowerMessage.includes('resource') || lowerMessage.includes('comms')) {
      return 'resource';
    }
    return 'system';
  }

  #resolveSeverity(message, context) {
    const explicit = this.#coerceSeverity(context.logSeverity ?? context.severity ?? null);
    if (explicit) {
      delete context.logSeverity;
      delete context.severity;
      return explicit;
    }

    const lower = message.toLowerCase();
    if (lower.includes('failure') || lower.includes('failed')) {
      return 'failure';
    }
    if (lower.includes('abort')) {
      return 'warning';
    }
    if (lower.includes('warning')) {
      return 'warning';
    }
    if (lower.includes('caution')) {
      return 'caution';
    }
    if (lower.includes('notice')) {
      return 'notice';
    }
    return this.options.defaultSeverity;
  }

  #resolveSource(context) {
    const raw = context.logSource ?? context.source ?? this.options.defaultSource;
    if (typeof context.logSource === 'string') {
      delete context.logSource;
    }
    const normalized = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    if (!normalized) {
      return this.options.defaultSource;
    }
    switch (normalized) {
      case 'sim':
      case 'ui':
      case 'cli':
      case 'replay':
      case 'n64':
      case 'audio':
        return normalized;
      default:
        return this.options.defaultSource;
    }
  }

  #normalizeMessage(message) {
    if (typeof message === 'string') {
      return message.trim();
    }
    if (message == null) {
      return '';
    }
    return String(message).trim();
  }

  #normalizeContext(context) {
    if (!context || typeof context !== 'object') {
      return {};
    }
    return deepClone(context);
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

  #coerceCategory(value) {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) {
      return null;
    }
    if (KNOWN_CATEGORIES.has(trimmed)) {
      return trimmed;
    }
    switch (trimmed) {
      case 'log':
      case 'system':
        return 'system';
      case 'event':
      case 'events':
        return 'event';
      case 'checklists':
        return 'checklist';
      case 'manual':
      case 'manual_action':
        return 'manual';
      case 'autopilots':
        return 'autopilot';
      case 'audio':
        return 'audio';
      case 'ui':
      case 'hud':
        return 'ui';
      case 'accessibility':
        return 'accessibility';
      case 'score':
      case 'scoring':
        return 'score';
      case 'resource':
      case 'resources':
        return 'resource';
      default:
        return null;
    }
  }

  #coerceSeverity(value) {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim().toLowerCase();
    if (KNOWN_SEVERITIES.has(trimmed)) {
      return trimmed;
    }
    switch (trimmed) {
      case 'warn':
        return 'warning';
      case 'alert':
        return 'warning';
      case 'info':
      case 'notice':
      case 'caution':
      case 'warning':
      case 'failure':
        return trimmed;
      default:
        return null;
    }
  }

  #normalizeFilterSet(values) {
    if (!values) {
      return null;
    }
    const list = Array.isArray(values) ? values : [values];
    const normalized = list
      .map((value) => (typeof value === 'string' ? value.trim().toLowerCase() : null))
      .filter((value) => value && value.length > 0);
    if (normalized.length === 0) {
      return null;
    }
    return new Set(normalized);
  }

  #countBy(entries, key) {
    const counts = {};
    for (const entry of entries ?? []) {
      const value = entry?.[key];
      if (!value) {
        continue;
      }
      const normalized = typeof value === 'string' ? value : String(value);
      counts[normalized] = (counts[normalized] ?? 0) + 1;
    }
    return counts;
  }
}

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}
