import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { AgcRuntime } from '../src/sim/agcRuntime.js';
import { createTestLogger } from './testUtils.js';

function createMacroCatalog(overrides = {}) {
  return {
    version: 1,
    description: 'Test macro pack',
    macros: [
      {
        id: 'P30_LOAD_PAD',
        label: 'Plan MCC Burn',
        verb: 16,
        noun: 36,
        mode: 'entry',
        program: 'P30',
        majorMode: '63',
        subMode: '1',
        registers: [
          { id: 'R1', label: 'TIG' },
          { id: 'R2', label: 'DVX', units: 'ft/s' },
          { id: 'R3', label: 'DVZ', units: 'ft/s' },
        ],
      },
      {
        id: 'P64_EXECUTE',
        label: 'Landmark Update',
        verb: 64,
        noun: 66,
        mode: 'entry',
        program: 'P64',
        majorMode: '63',
        subMode: '2',
        registers: [{ id: 'R1', label: 'ALT', units: 'ft' }],
      },
    ],
    ...overrides,
  };
}

describe('AgcRuntime', () => {
  test('applies entry macros, records history, and requests acknowledgement', () => {
    const logger = createTestLogger();
    const runtime = new AgcRuntime({ logger, macros: createMacroCatalog() });

    const result = runtime.executeEntry(
      {
        macroId: 'P30_LOAD_PAD',
        registers: { R1: '002:44:12', R2: 12.5, R3: -0.4 },
        sequence: ['VERB', 'NOUN', 'ENTER'],
      },
      {
        getSeconds: 9876.5,
        actor: 'AUTO_CREW',
        source: 'autopilot',
        eventId: 'EVT_MCC2',
      },
    );

    assert.equal(result.status, 'applied');
    assert.equal(result.requiresAck, true);
    assert.equal(result.program, 'P30');
    assert.equal(result.verb, 16);
    assert.equal(result.noun, 36);

    const snapshot = runtime.snapshot();
    assert.equal(snapshot.program.current, 'P30');
    assert.equal(snapshot.display.verb, 16);
    assert.equal(snapshot.display.noun, 36);
    assert.equal(snapshot.annunciators.pro, true);
    assert.equal(snapshot.pendingAck?.macroId, 'P30_LOAD_PAD');
    assert.equal(snapshot.history.length, 1);
    assert.deepEqual(snapshot.history[0].registers, { R1: '002:44:12', R2: 12.5, R3: -0.4 });

    const r2Display = snapshot.registers.find((entry) => entry.id === 'R2');
    assert.ok(r2Display);
    assert.equal(r2Display.value, 12.5);

    const acked = runtime.acknowledge({
      getSeconds: 9880,
      actor: 'CMP',
      source: 'manual',
      note: 'Pad verified',
    });
    assert.equal(acked, true);

    const afterAck = runtime.snapshot();
    assert.equal(afterAck.pendingAck, null);
    assert.equal(afterAck.annunciators.pro, false);
    assert.equal(afterAck.annunciators.keyRel, false);

    assert.ok(
      logger.entries.some(
        (entry) => entry.data.logSource === 'agc' && entry.message.includes('AGC P30_LOAD_PAD'),
      ),
    );
    assert.ok(
      logger.entries.some(
        (entry) => entry.data.logSource === 'agc' && entry.message.includes('AGC PRO acknowledged'),
      ),
    );
  });

  test('flags verb/noun mismatches while accepting manual overrides', () => {
    const logger = createTestLogger();
    const runtime = new AgcRuntime({ logger, macros: createMacroCatalog() });

    const result = runtime.executeEntry(
      {
        macroId: 'P64_EXECUTE',
        verb: 65,
        noun: 67,
        sequence: ['VERB', 'NOUN', 'PRO'],
        registers: { R1: 4250 },
      },
      {
        getSeconds: 120000,
        actor: 'CDR',
        source: 'manual',
      },
    );

    assert.equal(result.status, 'applied');
    assert.equal(result.requiresAck, false);
    assert.ok(result.issues.some((issue) => issue.message.includes('Verb differs')));
    assert.ok(result.issues.some((issue) => issue.message.includes('Noun differs')));

    const stats = runtime.stats();
    assert.equal(stats.pendingAck, false);
    assert.equal(stats.acknowledged, 1);

    const snapshot = runtime.snapshot();
    assert.equal(snapshot.history.length, 1);
    assert.equal(snapshot.history[0].macroId, 'P64_EXECUTE');
    assert.equal(snapshot.history[0].verb, 65);
    assert.equal(snapshot.history[0].noun, 67);
    assert.equal(snapshot.annunciators.pro, false);
  });

  test('rejects incomplete entries and raises OPR ERR annunciator', () => {
    const logger = createTestLogger();
    const runtime = new AgcRuntime({ logger, macros: createMacroCatalog() });

    const result = runtime.executeEntry(
      {
        macroId: 'UNKNOWN_MACRO',
      },
      {
        getSeconds: 512,
        actor: 'CMP',
        source: 'manual',
      },
    );

    assert.equal(result.status, 'rejected');
    assert.ok(result.issues.some((issue) => issue.message.includes('Verb/Noun missing')));

    const snapshot = runtime.snapshot();
    assert.equal(snapshot.history.length, 0);
    assert.equal(snapshot.annunciators.oprErr, true);
    assert.equal(snapshot.pendingAck, null);

    const stats = runtime.stats();
    assert.equal(stats.rejected, 1);
    assert.equal(stats.pendingAck, false);

    assert.ok(
      logger.entries.some(
        (entry) => entry.data.logSource === 'agc' && entry.message.includes('rejected'),
      ),
    );
  });
});
