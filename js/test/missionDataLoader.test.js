import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizePadParameters } from '../src/data/missionDataLoader.js';
import { parseGET } from '../src/utils/time.js';

describe('missionDataLoader normalizePadParameters', () => {
  test('converts PAD parameters and surfaces optional metrics', () => {
    const raw = {
      TIG: '123:45:00',
      delta_v_ft_s: 10300,
      burn_duration_seconds: '347',
      attitude: 'R123/P045/Y000',
      range_to_target_nm: '2150.5',
      flight_path_angle_deg: '-5.2',
      v_infinity_ft_s: '35500',
      notes: 'Verify SPS trim',
    };

    const normalized = normalizePadParameters(raw);

    assert.deepEqual(normalized.tig, { get: '123:45:00', getSeconds: parseGET('123:45:00') });
    assert.strictEqual(normalized.deltaVFtPerSec, 10300);
    assert.ok(Math.abs(normalized.deltaVMetersPerSecond - 10300 * 0.3048) < 1e-6);
    assert.strictEqual(normalized.burnDurationSeconds, 347);
    assert.strictEqual(normalized.attitude, 'R123/P045/Y000');
    assert.strictEqual(normalized.rangeToTargetNm, 2150.5);
    assert.strictEqual(normalized.flightPathAngleDeg, -5.2);
    assert.ok(Math.abs(normalized.vInfinityMetersPerSecond - 35500 * 0.3048) < 1e-6);
    assert.strictEqual(normalized.vInfinityFtPerSec, 35500);
    assert.strictEqual(normalized.notes, 'Verify SPS trim');
    assert.notStrictEqual(normalized.raw, raw);
    assert.deepEqual(normalized.raw, raw);
  });

  test('prefers metric units and handles alternative keys', () => {
    const raw = {
      tig: '000:30:00',
      delta_v_ft_s: 100,
      delta_v_mps: 12.3,
      burn_duration_s: 45,
      entry_interface_get: '001:00:00',
      range_nm: 25,
      flightPathAngleDeg: '1.75',
      v_infinity_mps: '111.2',
    };

    const normalized = normalizePadParameters(raw);

    assert.deepEqual(normalized.tig, { get: '000:30:00', getSeconds: parseGET('000:30:00') });
    assert.deepEqual(normalized.entryInterface, {
      get: '001:00:00',
      getSeconds: parseGET('001:00:00'),
    });
    assert.strictEqual(normalized.deltaVFtPerSec, 100);
    assert.strictEqual(normalized.deltaVMetersPerSecond, 12.3);
    assert.strictEqual(normalized.burnDurationSeconds, 45);
    assert.strictEqual(normalized.rangeToTargetNm, 25);
    assert.strictEqual(normalized.flightPathAngleDeg, 1.75);
    assert.strictEqual(normalized.vInfinityMetersPerSecond, 111.2);
    assert.strictEqual(normalized.vInfinityFtPerSec, null);
  });
});
