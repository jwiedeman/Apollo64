import fs from 'fs/promises';
import path from 'path';
import { formatGET } from '../utils/time.js';

const DEFAULT_OPTIONS = {
  includeAutoActionsOnly: true,
  scriptActor: 'MANUAL_CREW',
  groupEpsilonSeconds: 1 / 20,
  includeNotes: true,
};

export class ManualActionRecorder {
  constructor(options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.checklistEntries = [];
    this.metrics = {
      checklist: {
        total: 0,
        auto: 0,
        manual: 0,
      },
      events: new Map(),
    };
  }

  recordChecklistAck({
    eventId,
    checklistId = null,
    stepNumber = null,
    getSeconds,
    actor = 'AUTO_CREW',
    note = null,
  }) {
    if (!eventId || !Number.isFinite(getSeconds)) {
      return;
    }

    this.checklistEntries.push({
      eventId,
      checklistId,
      stepNumber,
      getSeconds,
      actor,
      note,
    });

    this.metrics.checklist.total += 1;
    if (actor === 'AUTO_CREW') {
      this.metrics.checklist.auto += 1;
    } else {
      this.metrics.checklist.manual += 1;
    }

    const current = this.metrics.events.get(eventId) ?? 0;
    this.metrics.events.set(eventId, current + 1);
  }

  stats() {
    return {
      checklist: {
        ...this.metrics.checklist,
      },
      events: Array.from(this.metrics.events.entries()).map(([eventId, count]) => ({
        eventId,
        count,
      })),
    };
  }

  buildScriptActions() {
    const autoOnly = this.options.includeAutoActionsOnly;
    const epsilon = this.options.groupEpsilonSeconds ?? DEFAULT_OPTIONS.groupEpsilonSeconds;

    const filtered = this.checklistEntries
      .filter((entry) => !autoOnly || entry.actor === 'AUTO_CREW')
      .sort((a, b) => {
        if (a.getSeconds !== b.getSeconds) {
          return a.getSeconds - b.getSeconds;
        }
        if (a.eventId !== b.eventId) {
          return a.eventId < b.eventId ? -1 : 1;
        }
        return (a.stepNumber ?? 0) - (b.stepNumber ?? 0);
      });

    if (filtered.length === 0) {
      return [];
    }

    const actions = [];
    let group = null;

    const flushGroup = () => {
      if (!group) {
        return;
      }
      actions.push(this.#groupToAction(group));
      group = null;
    };

    for (const entry of filtered) {
      if (!group) {
        group = this.#createGroup(entry);
        continue;
      }

      const sameEvent = group.eventId === entry.eventId;
      const sameTime = Math.abs(group.getSeconds - entry.getSeconds) <= epsilon;

      if (sameEvent && sameTime) {
        group.count += 1;
        group.lastStepNumber = entry.stepNumber ?? group.lastStepNumber;
        if (!group.note && entry.note) {
          group.note = entry.note;
        }
        continue;
      }

      flushGroup();
      group = this.#createGroup(entry);
    }

    flushGroup();
    return actions;
  }

  toJSON() {
    const actions = this.buildScriptActions();
    return {
      metadata: {
        generated_at: new Date().toISOString(),
        include_auto_actions_only: Boolean(this.options.includeAutoActionsOnly),
        script_actor: this.options.scriptActor,
        checklist_entries_recorded: this.metrics.checklist.total,
        actions: actions.length,
      },
      actions,
    };
  }

  async writeScript(filePath, { pretty = true } = {}) {
    if (!filePath) {
      return null;
    }

    const absolutePath = path.resolve(filePath);
    const directory = path.dirname(absolutePath);
    await fs.mkdir(directory, { recursive: true });

    const payload = this.toJSON();
    const json = pretty ? JSON.stringify(payload, null, 2) : JSON.stringify(payload);
    await fs.writeFile(absolutePath, json, 'utf8');

    return {
      path: absolutePath,
      actions: payload.actions.length,
      checklistEntries: this.metrics.checklist.total,
    };
  }

  #createGroup(entry) {
    return {
      eventId: entry.eventId,
      checklistId: entry.checklistId,
      getSeconds: entry.getSeconds,
      firstStepNumber: entry.stepNumber ?? null,
      lastStepNumber: entry.stepNumber ?? null,
      note: entry.note ?? null,
      count: 1,
    };
  }

  #groupToAction(group) {
    const formattedGet = formatGET(group.getSeconds);
    const stepLabel = this.#formatStepRange(group.firstStepNumber, group.lastStepNumber);
    const note = this.options.includeNotes
      ? this.#buildNote(group, formattedGet)
      : undefined;

    const action = {
      id: `${group.eventId}_${stepLabel}`,
      type: 'checklist_ack',
      event_id: group.eventId,
      get_seconds: Number(group.getSeconds.toFixed(3)),
      count: group.count,
      actor: this.options.scriptActor,
    };

    if (group.checklistId) {
      action.checklist_id = group.checklistId;
    }
    action.display_get = formattedGet;

    if (note) {
      action.note = note;
    }

    return action;
  }

  #formatStepRange(first, last) {
    const format = (value) => {
      if (value == null) {
        return 'STEP';
      }
      return value.toString().padStart(3, '0');
    };
    if (first == null || last == null || first === last) {
      return `STEP_${format(first ?? last)}`;
    }
    return `STEPS_${format(first)}-${format(last)}`;
  }

  #buildNote(group, formattedGet) {
    const stepLabel = this.#formatStepRange(group.firstStepNumber, group.lastStepNumber);
    if (group.note) {
      return `Recorded auto crew ${stepLabel} at GET ${formattedGet} — ${group.note}`;
    }
    return `Recorded auto crew ${stepLabel} at GET ${formattedGet}`;
  }
}
