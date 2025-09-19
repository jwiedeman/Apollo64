import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { validatePadParameters } from '../src/tools/validateMissionData.js';

function createContext() {
  return { errors: [], warnings: [], stats: {}, refs: {} };
}

describe('validatePadParameters', () => {
  test('warns on invalid PAD parameter values', () => {
    const context = createContext();
    const parameters = {
      TIG: 'ABC',
      entry_interface_get: '000:AA:00',
      delta_v_ft_s: 'not-a-number',
      delta_v_mps: '-5',
      burn_duration_s: 0,
      range_to_target_nm: '-12',
      flight_path_angle_deg: 'n/a',
      v_infinity_ft_s: 0,
    };

    validatePadParameters(parameters, context, 'PAD_TEST');

    assert.ok(context.warnings.some((message) => message.includes('PAD PAD_TEST parameter TIG has invalid GET value')));
    assert.ok(
      context.warnings.some((message) =>
        message.includes('PAD PAD_TEST parameter entry_interface_get has invalid GET value'),
      ),
    );
    assert.ok(
      context.warnings.some((message) =>
        message.includes('PAD PAD_TEST parameter delta_v_ft_s should be numeric'),
      ),
    );
    assert.ok(
      context.warnings.some((message) =>
        message.includes('PAD PAD_TEST parameter delta_v_mps should be positive'),
      ),
    );
    assert.ok(
      context.warnings.some((message) =>
        message.includes('PAD PAD_TEST parameter burn_duration_s should be positive'),
      ),
    );
    assert.ok(
      context.warnings.some((message) =>
        message.includes('PAD PAD_TEST parameter range_to_target_nm should be non-negative'),
      ),
    );
    assert.ok(
      context.warnings.some((message) =>
        message.includes('PAD PAD_TEST parameter flight_path_angle_deg should be numeric'),
      ),
    );
    assert.ok(
      context.warnings.some((message) =>
        message.includes('PAD PAD_TEST parameter v_infinity_ft_s should be positive'),
      ),
    );
  });

  test('accepts valid PAD parameters', () => {
    const context = createContext();
    const parameters = {
      TIG: '123:45:00',
      entry_interface_get: '125:00:00',
      delta_v_ft_s: 10037,
      burn_duration_s: 347,
      range_to_target_nm: 2150,
      flight_path_angle_deg: '-5.2',
      v_infinity_ft_s: 35500,
    };

    validatePadParameters(parameters, context, 'PAD_VALID');

    assert.equal(context.warnings.length, 0);
    assert.equal(context.errors.length, 0);
  });
});
