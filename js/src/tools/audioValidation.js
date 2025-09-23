import { formatGET } from '../utils/time.js';

export const DEFAULT_SEVERITY_WEIGHTS = {
  failure: 60,
  warning: 30,
  caution: 15,
  notice: 5,
  info: 0,
};

const DEFAULT_PRIORITY_TOLERANCE = 1e-3;
const DEFAULT_COOLDOWN_TOLERANCE = 1e-3;

function normalizeId(value) {
  if (value == null) {
    return null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return String(value);
}

function coerceNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toLowerCase(value, fallback = null) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed.toLowerCase();
    }
  }
  return fallback;
}

function formatMaybeGET(seconds) {
  return Number.isFinite(seconds) ? formatGET(seconds) : null;
}

function mapToArray(map, keyName) {
  return Array.from(map.entries())
    .map(([key, count]) => ({
      [keyName]: key,
      count,
    }))
    .sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      const aKey = a[keyName] ?? '';
      const bKey = b[keyName] ?? '';
      return aKey.localeCompare(bKey);
    });
}

export function analyzeAudioLedger(ledger, catalog = null, options = {}) {
  const severityWeights = {
    ...DEFAULT_SEVERITY_WEIGHTS,
    ...(options.severityWeights ?? {}),
  };
  const dispatcherStats = options.dispatcherStats ?? null;
  const defaultBusConcurrency = Number.isFinite(options.defaultBusConcurrency)
    && options.defaultBusConcurrency > 0
    ? options.defaultBusConcurrency
    : 1;
  const priorityTolerance = Number.isFinite(options.priorityTolerance)
    ? options.priorityTolerance
    : DEFAULT_PRIORITY_TOLERANCE;
  const cooldownTolerance = Number.isFinite(options.cooldownTolerance)
    ? options.cooldownTolerance
    : DEFAULT_COOLDOWN_TOLERANCE;

  const busMap = new Map();
  for (const bus of catalog?.buses ?? []) {
    const id = normalizeId(bus?.id ?? bus?.busId);
    if (!id) {
      continue;
    }
    busMap.set(id, bus);
  }

  const categoryMap = new Map();
  for (const category of catalog?.categories ?? []) {
    const id = normalizeId(category?.id ?? category?.categoryId);
    if (!id) {
      continue;
    }
    categoryMap.set(id, category);
  }

  const cueMap = new Map();
  for (const cue of catalog?.cues ?? []) {
    const id = normalizeId(cue?.id ?? cue?.cueId);
    if (!id) {
      continue;
    }
    cueMap.set(id, cue);
  }

  const normalizedEntries = [];
  const eventsByBus = new Map();
  const entriesPerBus = new Map();
  const counts = {
    severity: new Map(),
    status: new Map(),
    bus: new Map(),
    category: new Map(),
  };

  let earliestStartSeconds = null;
  let latestEndSeconds = null;

  const sourceEntries = Array.isArray(ledger) ? ledger : [];
  for (const rawEntry of sourceEntries) {
    if (!rawEntry || typeof rawEntry !== 'object') {
      continue;
    }

    const playbackId = normalizeId(rawEntry.playbackId ?? rawEntry.id ?? rawEntry.playback_id);
    const cueId = normalizeId(rawEntry.cueId ?? rawEntry.cue_id);
    let categoryId = normalizeId(rawEntry.categoryId ?? rawEntry.category_id);
    let busId = normalizeId(rawEntry.busId ?? rawEntry.bus_id);
    const severity = toLowerCase(rawEntry.severity, 'info');
    const status = toLowerCase(rawEntry.status, 'unknown');
    const priority = coerceNumber(rawEntry.priority ?? rawEntry.priority_value);
    const startedAtSeconds = coerceNumber(rawEntry.startedAtSeconds ?? rawEntry.started_at_seconds ?? rawEntry.started_at);
    const endedAtSecondsRaw = coerceNumber(rawEntry.endedAtSeconds ?? rawEntry.ended_at_seconds ?? rawEntry.ended_at);
    const durationSeconds = coerceNumber(rawEntry.durationSeconds ?? rawEntry.duration_seconds);

    const cueMeta = cueId ? cueMap.get(cueId) ?? null : null;
    if (!categoryId) {
      categoryId = normalizeId(cueMeta?.category ?? cueMeta?.categoryId);
    }
    const categoryMeta = categoryId ? categoryMap.get(categoryId) ?? null : null;

    if (!busId) {
      busId = normalizeId(
        cueMeta?.bus ?? cueMeta?.busId ?? cueMeta?.categoryBus ?? categoryMeta?.bus ?? categoryMeta?.busId,
      );
    }
    if (!busId) {
      busId = 'master';
    }

    const busMeta = busMap.get(busId) ?? null;
    const busLimit = Number.isFinite(busMeta?.maxConcurrent)
      ? Number(busMeta.maxConcurrent)
      : defaultBusConcurrency;

    const basePriorityRaw = coerceNumber(cueMeta?.priority ?? cueMeta?.priorityValue)
      ?? coerceNumber(categoryMeta?.defaultPriority ?? categoryMeta?.priority);
    const basePriority = Number.isFinite(basePriorityRaw) ? basePriorityRaw : 0;
    const severityWeight = severityWeights[severity] ?? 0;
    const expectedPriority = basePriority + severityWeight;

    const endedAtSeconds = Number.isFinite(endedAtSecondsRaw)
      ? endedAtSecondsRaw
      : Number.isFinite(durationSeconds) && Number.isFinite(startedAtSeconds)
        ? startedAtSeconds + durationSeconds
        : null;

    const normalized = {
      playbackId,
      cueId,
      categoryId,
      busId,
      severity,
      status,
      priority,
      expectedPriority,
      basePriority,
      severityWeight,
      startedAtSeconds,
      endedAtSeconds,
      durationSeconds,
      stopReason: rawEntry.stopReason ?? rawEntry.stop_reason ?? null,
      cueCooldown: coerceNumber(cueMeta?.cooldownSeconds ?? cueMeta?.cooldown_seconds),
      categoryCooldown: coerceNumber(categoryMeta?.cooldownSeconds ?? categoryMeta?.cooldown_seconds),
      busLimit,
    };

    normalizedEntries.push(normalized);
    entriesPerBus.set(busId, (entriesPerBus.get(busId) ?? 0) + 1);

    counts.severity.set(severity, (counts.severity.get(severity) ?? 0) + 1);
    counts.status.set(status, (counts.status.get(status) ?? 0) + 1);
    counts.bus.set(busId, (counts.bus.get(busId) ?? 0) + 1);
    if (categoryId) {
      counts.category.set(categoryId, (counts.category.get(categoryId) ?? 0) + 1);
    }

    if (Number.isFinite(startedAtSeconds)) {
      earliestStartSeconds = earliestStartSeconds == null
        ? startedAtSeconds
        : Math.min(earliestStartSeconds, startedAtSeconds);
    }
    const latestCandidate = Number.isFinite(endedAtSeconds)
      ? endedAtSeconds
      : Number.isFinite(startedAtSeconds)
        ? startedAtSeconds
        : null;
    if (Number.isFinite(latestCandidate)) {
      latestEndSeconds = latestEndSeconds == null
        ? latestCandidate
        : Math.max(latestEndSeconds, latestCandidate);
    }

    if (Number.isFinite(startedAtSeconds)) {
      const events = eventsByBus.get(busId) ?? [];
      events.push({
        type: 'start',
        time: startedAtSeconds,
        playbackId,
        entry: normalized,
      });
      if (Number.isFinite(endedAtSeconds)) {
        events.push({
          type: 'end',
          time: Math.max(endedAtSeconds, startedAtSeconds),
          playbackId,
          entry: normalized,
        });
      }
      eventsByBus.set(busId, events);
    }
  }

  const concurrencySummaries = [];
  const concurrencyViolations = [];
  for (const [busId, events] of eventsByBus.entries()) {
    const busMeta = busMap.get(busId) ?? null;
    const limit = Number.isFinite(busMeta?.maxConcurrent)
      ? Number(busMeta.maxConcurrent)
      : defaultBusConcurrency;

    if (!Array.isArray(events) || events.length === 0) {
      concurrencySummaries.push({
        busId,
        limit,
        maxObserved: 0,
        entries: entriesPerBus.get(busId) ?? 0,
      });
      continue;
    }

    events.sort((a, b) => {
      if (a.time !== b.time) {
        return a.time - b.time;
      }
      if (a.type === b.type) {
        return (a.playbackId ?? '').localeCompare(b.playbackId ?? '');
      }
      return a.type === 'end' ? -1 : 1;
    });

    const active = new Map();
    let maxObserved = 0;
    for (const event of events) {
      if (event.type === 'end') {
        active.delete(event.playbackId);
        continue;
      }
      active.set(event.playbackId, event.entry);
      const current = active.size;
      if (current > maxObserved) {
        maxObserved = current;
      }
      if (limit > 0 && current > limit) {
        concurrencyViolations.push({
          busId,
          limit,
          observed: current,
          atSeconds: event.time,
          at: formatMaybeGET(event.time),
          activePlaybacks: Array.from(active.values()).map((entry) => ({
            playbackId: entry.playbackId,
            cueId: entry.cueId,
            startedAtSeconds: entry.startedAtSeconds,
            startedAt: formatMaybeGET(entry.startedAtSeconds),
            priority: entry.priority,
          })),
        });
      }
    }

    concurrencySummaries.push({
      busId,
      limit,
      maxObserved,
      entries: entriesPerBus.get(busId) ?? 0,
    });
  }

  const cooldownViolations = [];
  const cueLastStart = new Map();
  const categoryLastStart = new Map();
  const sortedByStart = normalizedEntries
    .filter((entry) => Number.isFinite(entry.startedAtSeconds))
    .sort((a, b) => {
      if (a.startedAtSeconds !== b.startedAtSeconds) {
        return a.startedAtSeconds - b.startedAtSeconds;
      }
      return (a.playbackId ?? '').localeCompare(b.playbackId ?? '');
    });

  for (const entry of sortedByStart) {
    const { startedAtSeconds, cueCooldown, categoryCooldown } = entry;
    if (!Number.isFinite(startedAtSeconds)) {
      continue;
    }

    if (Number.isFinite(cueCooldown) && entry.cueId) {
      const previous = cueLastStart.get(entry.cueId);
      if (Number.isFinite(previous) && startedAtSeconds - previous < cueCooldown - cooldownTolerance) {
        cooldownViolations.push({
          type: 'cue',
          cueId: entry.cueId,
          requiredSeconds: cueCooldown,
          observedGapSeconds: startedAtSeconds - previous,
          previousStartSeconds: previous,
          previousStart: formatMaybeGET(previous),
          currentStartSeconds: startedAtSeconds,
          currentStart: formatMaybeGET(startedAtSeconds),
        });
      }
      cueLastStart.set(entry.cueId, startedAtSeconds);
    }

    if (Number.isFinite(categoryCooldown) && entry.categoryId) {
      const previous = categoryLastStart.get(entry.categoryId);
      if (Number.isFinite(previous) && startedAtSeconds - previous < categoryCooldown - cooldownTolerance) {
        cooldownViolations.push({
          type: 'category',
          categoryId: entry.categoryId,
          requiredSeconds: categoryCooldown,
          observedGapSeconds: startedAtSeconds - previous,
          previousStartSeconds: previous,
          previousStart: formatMaybeGET(previous),
          currentStartSeconds: startedAtSeconds,
          currentStart: formatMaybeGET(startedAtSeconds),
        });
      }
      categoryLastStart.set(entry.categoryId, startedAtSeconds);
    }
  }

  const priorityMismatches = [];
  for (const entry of normalizedEntries) {
    if (!Number.isFinite(entry.expectedPriority)) {
      continue;
    }
    if (!Number.isFinite(entry.priority)) {
      priorityMismatches.push({
        cueId: entry.cueId,
        categoryId: entry.categoryId,
        severity: entry.severity,
        expectedPriority: entry.expectedPriority,
        observedPriority: null,
        delta: null,
      });
      continue;
    }
    const delta = entry.priority - entry.expectedPriority;
    if (Math.abs(delta) > priorityTolerance) {
      priorityMismatches.push({
        cueId: entry.cueId,
        categoryId: entry.categoryId,
        severity: entry.severity,
        expectedPriority: entry.expectedPriority,
        observedPriority: entry.priority,
        delta,
      });
    }
  }

  const suppressedTriggers = dispatcherStats?.suppressed ?? 0;
  const droppedTriggers = dispatcherStats?.dropped ?? 0;

  const analysis = {
    totals: {
      ledgerEntries: normalizedEntries.length,
      buses: busMap.size,
      categories: categoryMap.size,
      cues: cueMap.size,
    },
    counts: {
      bySeverity: mapToArray(counts.severity, 'severity'),
      byStatus: mapToArray(counts.status, 'status'),
      byBus: mapToArray(counts.bus, 'busId'),
      byCategory: mapToArray(counts.category, 'categoryId'),
    },
    concurrency: {
      byBus: concurrencySummaries.sort((a, b) => a.busId.localeCompare(b.busId)),
      violations: concurrencyViolations,
    },
    cooldownViolations,
    priorityMismatches,
    suppressedTriggers,
    droppedTriggers,
    severityWeights,
    dispatcherStats,
    timeline: {
      earliestStartSeconds,
      earliestStart: formatMaybeGET(earliestStartSeconds),
      latestEndSeconds,
      latestEnd: formatMaybeGET(latestEndSeconds),
    },
  };

  analysis.isHealthy =
    concurrencyViolations.length === 0
    && cooldownViolations.length === 0
    && priorityMismatches.length === 0
    && droppedTriggers === 0;

  return analysis;
}

