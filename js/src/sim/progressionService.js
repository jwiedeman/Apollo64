import fs from 'node:fs/promises';

const DEFAULT_COMMANDER_ID = 'ASTRONAUT_01';

const GRADE_ORDER = [
  'F',
  'D',
  'C-',
  'C',
  'C+',
  'B-',
  'B',
  'B+',
  'A-',
  'A',
  'A+',
];

const CAMPAIGN_UNLOCKS = {
  apollo8: {
    id: 'apollo8',
    name: 'Apollo 8 Free Return',
    requirement: (ctx) =>
      ctx.gradeAtLeast('B') && ctx.totalFaults <= 3 && ctx.missionRange.includes('APOLLO11'),
  },
  apollo13: {
    id: 'apollo13',
    name: 'Apollo 13 Contingency',
    requirement: (ctx) =>
      ctx.gradeAtLeast('A-') && ctx.totalFaults <= 1 && ctx.eventsPending === 0 && ctx.missionRange.includes('APOLLO11'),
  },
  freeFlight: {
    id: 'free_flight',
    name: 'Free Flight Sandbox',
    requirement: (ctx) => ctx.gradeAtLeast('B') || ctx.manualFraction >= 0.5,
  },
};

const CHALLENGE_UNLOCKS = {
  manualOps: {
    id: 'manual_ops',
    name: 'Manual Ops Spotlight',
    requirement: (ctx) => ctx.gradeAtLeast('B') && ctx.manualFraction >= 0.35,
  },
  tightMargins: {
    id: 'tight_margins',
    name: 'Tight Margins Mode',
    requirement: (ctx) =>
      ctx.totalFaults <= 2 && ctx.minPowerMarginPct >= 30 && ctx.minDeltaVMarginMps >= -5,
  },
  timeCompression: {
    id: 'time_compression',
    name: 'Time Compression License',
    requirement: (ctx) =>
      ctx.gradeAtLeast('B') && ctx.maxTimeCompression >= 4 && ctx.timeAtOrAbove4xSeconds >= 2 * 3600,
  },
};

const ACHIEVEMENTS = {
  missionPatchGallery: {
    id: 'MISSION_PATCH_GALLERY',
    requirement: (ctx) => ctx.isFullMission,
  },
  capcomVoicePack: {
    id: 'CAPCOM_VOICE_PACK',
    requirement: (ctx) => ctx.capcomPerfectStreak >= 3,
  },
  telemetryOverlays: {
    id: 'TELEMETRY_OVERLAYS',
    requirement: (ctx) => ctx.gradeAtLeast('B') && ctx.exportedUiFrames,
  },
};

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export class ProgressionService {
  constructor({ profile = null, storagePath = null, clock = null } = {}) {
    this.clock = typeof clock === 'function' ? clock : () => new Date().toISOString();
    this.storagePath = storagePath ?? null;
    this.profile = this.#normalizeProfile(profile);
  }

  static async fromFile(filePath, options = {}) {
    const service = new ProgressionService({ ...options, storagePath: filePath });
    await service.loadFromFile(filePath);
    return service;
  }

  #normalizeProfile(raw) {
    const base = {
      commanderId: DEFAULT_COMMANDER_ID,
      lastUpdated: null,
      missions: {},
      unlocks: {},
      achievements: [],
      streaks: {},
    };

    if (!raw || typeof raw !== 'object') {
      return base;
    }

    const normalized = deepClone(raw);
    if (!normalized.commanderId) {
      normalized.commanderId = DEFAULT_COMMANDER_ID;
    }
    if (!normalized.missions || typeof normalized.missions !== 'object') {
      normalized.missions = {};
    }
    if (!normalized.unlocks || typeof normalized.unlocks !== 'object') {
      normalized.unlocks = {};
    }
    if (!Array.isArray(normalized.achievements)) {
      normalized.achievements = [];
    }
    if (!normalized.streaks || typeof normalized.streaks !== 'object') {
      normalized.streaks = {};
    }
    return normalized;
  }

  getProfile() {
    return deepClone(this.profile);
  }

  resetProfile(overrides = {}) {
    this.profile = this.#normalizeProfile(overrides);
    return this.getProfile();
  }

  async loadFromFile(filePath = this.storagePath) {
    if (!filePath) {
      throw new Error('ProgressionService.loadFromFile requires a file path');
    }
    const data = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(data);
    this.storagePath = filePath;
    this.profile = this.#normalizeProfile(parsed);
    return this.getProfile();
  }

  async saveToFile(filePath = this.storagePath) {
    if (!filePath) {
      throw new Error('ProgressionService.saveToFile requires a file path');
    }
    const payload = JSON.stringify(this.profile, null, 2);
    await fs.writeFile(filePath, payload, 'utf8');
    this.storagePath = filePath;
    return filePath;
  }

  evaluateRun(summary, context = {}) {
    if (!summary || typeof summary !== 'object') {
      throw new Error('ProgressionService.evaluateRun requires a summary object');
    }

    const missionId = context.missionId ?? 'UNKNOWN';
    const timestamp = context.timestamp ?? this.clock();
    const grade = summary?.rating?.grade ?? null;
    const commanderScore = this.#coerceNumber(summary?.rating?.commanderScore);
    const totalFaults = this.#coerceNumber(summary?.faults?.totalFaults) ?? 0;
    const manualFraction = this.#coerceNumber(summary?.manual?.manualFraction) ?? 0;
    const minPowerMarginPct = this.#coerceNumber(summary?.resources?.minPowerMarginPct);
    const minDeltaVMarginMps = this.#coerceNumber(summary?.resources?.minDeltaVMarginMps);
    const eventsPending = this.#coerceNumber(summary?.events?.pending) ?? 0;
    const eventsCompleted = this.#coerceNumber(summary?.events?.completed) ?? 0;
    const eventsTotal = this.#coerceNumber(summary?.events?.total) ?? null;
    const manualSteps = this.#coerceNumber(summary?.manual?.manualSteps) ?? 0;
    const autoSteps = this.#coerceNumber(summary?.manual?.autoSteps) ?? 0;

    const isFullMission = Boolean(context.isFullMission || missionId === 'APOLLO11');
    const maxTimeCompression = this.#coerceNumber(context.maxTimeCompression) ?? 1;
    const timeAtOrAbove4xSeconds = this.#coerceNumber(context.timeAtOrAbove4xSeconds) ?? 0;
    const exportedUiFrames = Boolean(context.exportedUiFrames);
    const autopilotDeviationMaxPct = this.#coerceNumber(context.autopilotDeviationMaxPct);

    const missionEntry = this.#updateMissionStats({
      missionId,
      grade,
      commanderScore,
      eventsCompleted,
      eventsTotal,
      timestamp,
    });

    const gradeComparator = (threshold) => this.#gradeAtLeast(grade, threshold);

    const evaluationContext = {
      gradeAtLeast: gradeComparator,
      totalFaults,
      manualFraction,
      minPowerMarginPct,
      minDeltaVMarginMps,
      eventsPending,
      missionRange: missionId,
      maxTimeCompression,
      timeAtOrAbove4xSeconds,
      isFullMission,
      exportedUiFrames,
      capcomPerfectStreak: this.#updateCapcomStreak(autopilotDeviationMaxPct),
    };

    const unlocks = this.#evaluateUnlocks(evaluationContext, timestamp);
    const achievements = this.#evaluateAchievements({
      ...evaluationContext,
      manualSteps,
      autoSteps,
      timestamp,
    });

    this.profile.lastUpdated = timestamp;

    return {
      profile: this.getProfile(),
      unlocks,
      achievements,
      mission: missionEntry,
    };
  }

  #updateMissionStats({ missionId, grade, commanderScore, eventsCompleted, eventsTotal, timestamp }) {
    if (!missionId) {
      return null;
    }
    if (!this.profile.missions[missionId]) {
      this.profile.missions[missionId] = {
        completions: 0,
        bestScore: null,
        bestGrade: null,
        lastCompletedAt: null,
        eventsCompleted: 0,
        eventsTotal: null,
      };
    }

    const mission = this.profile.missions[missionId];
    mission.completions += 1;
    mission.eventsCompleted = eventsCompleted ?? mission.eventsCompleted;
    if (eventsTotal != null) {
      mission.eventsTotal = eventsTotal;
    }
    mission.lastCompletedAt = timestamp;

    if (commanderScore != null) {
      if (mission.bestScore == null || commanderScore > mission.bestScore) {
        mission.bestScore = commanderScore;
      }
    }

    if (grade && (!mission.bestGrade || this.#gradeAtLeast(grade, mission.bestGrade))) {
      mission.bestGrade = grade;
    }

    return deepClone(mission);
  }

  #updateCapcomStreak(autopilotDeviationMaxPct) {
    const streakKey = 'capcomPerfectRuns';
    const streak = this.profile.streaks[streakKey] ?? 0;
    const isPerfect = Number.isFinite(autopilotDeviationMaxPct) && autopilotDeviationMaxPct <= 10;
    const updated = isPerfect ? streak + 1 : 0;
    this.profile.streaks[streakKey] = updated;
    return updated;
  }

  #evaluateUnlocks(ctx, timestamp) {
    const unlocked = [];

    const applyUnlock = (definition) => {
      const id = definition.id;
      const existing = this.profile.unlocks[id];
      if (existing?.unlocked) {
        return;
      }
      if (!definition.requirement(ctx)) {
        return;
      }
      const payload = {
        unlocked: true,
        unlockedAt: timestamp,
        details: {
          gradeThresholdMet: true,
          totalFaults: ctx.totalFaults,
          manualFraction: ctx.manualFraction,
        },
      };
      this.profile.unlocks[id] = payload;
      unlocked.push({ id, name: definition.name, unlockedAt: timestamp });
    };

    for (const definition of Object.values({ ...CAMPAIGN_UNLOCKS, ...CHALLENGE_UNLOCKS })) {
      applyUnlock(definition);
    }

    return unlocked;
  }

  #evaluateAchievements(ctx) {
    const unlocked = [];
    const achievementsSet = new Set(this.profile.achievements.map((entry) => entry.id));

    const pushAchievement = (definition) => {
      if (achievementsSet.has(definition.id)) {
        return;
      }
      if (!definition.requirement(ctx)) {
        return;
      }
      const entry = { id: definition.id, timestamp: ctx.timestamp };
      this.profile.achievements.push(entry);
      achievementsSet.add(definition.id);
      unlocked.push(entry);
    };

    pushAchievement(ACHIEVEMENTS.missionPatchGallery);
    pushAchievement(ACHIEVEMENTS.capcomVoicePack);
    pushAchievement(ACHIEVEMENTS.telemetryOverlays);

    return unlocked;
  }

  #gradeAtLeast(grade, threshold) {
    if (!grade || !threshold) {
      return false;
    }
    const gradeValue = this.#gradeValue(grade);
    const thresholdValue = this.#gradeValue(threshold);
    return gradeValue >= thresholdValue;
  }

  #gradeValue(value) {
    if (!value) {
      return -Infinity;
    }
    const normalized = String(value).toUpperCase().trim();
    const index = GRADE_ORDER.indexOf(normalized);
    if (index >= 0) {
      return index;
    }
    switch (normalized) {
      case 'A-':
        return GRADE_ORDER.indexOf('A-');
      case 'B+':
        return GRADE_ORDER.indexOf('B+');
      case 'C+':
        return GRADE_ORDER.indexOf('C+');
      default:
        return GRADE_ORDER.indexOf('F');
    }
  }

  #coerceNumber(value) {
    if (value == null) {
      return null;
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'string') {
      const parsed = Number(value.trim());
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }
}

