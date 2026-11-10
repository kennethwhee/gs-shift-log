import test from 'node:test';
import assert from 'node:assert/strict';
import {
  R9_SIGNAL_MAP,
  r9VerifiedSavedSignal
} from '../functions/_shared/blower-r9-signal-v1.js';

const tag = '104HHL60AP621';
const signal = R9_SIGNAL_MAP[tag].signal;
const uuid = '00000000-0000-4000-8000-000000000123';
const legacyId = `ab12_${uuid}_01_02`;
const timestamp = '2026-11-10T10:00:00Z';

function receipt(id, options = {}) {
  return {
    id: options.eventId ?? `dataparc_runtime:${id}`,
    tag_number: tag,
    event_type: 'runtime_correction',
    source_type: 'dataparc_runtime',
    source_log_id: options.logId ?? id,
    created_at: timestamp,
    updated_at: options.updatedAt ?? timestamp,
    source_text: JSON.stringify({
      schemaVersion: 1,
      requestType: 'blower_runtime_probe',
      requestId: id,
      assetTag: tag,
      dataParcTag: options.signal ?? signal
    })
  };
}

test('R9 accepts linked legacy 47-character ID', () => {
  assert.equal(legacyId.length, 47);
  assert.equal(
    r9VerifiedSavedSignal([receipt(legacyId)], tag, signal).ok,
    true
  );
});

test('R9 preserves standard 36-character request IDs', () => {
  assert.equal(
    r9VerifiedSavedSignal([receipt(uuid)], tag, signal).ok,
    true
  );
});

test('R9 rejects invalid legacy formats', () => {
  const invalid = [
    `ab12_${uuid}_aa_02`,
    `ab12_${uuid}_01_0x`,
    `ab12_${uuid}_01_002`,
    `ab$2_${uuid}_01_02`
  ];

  for (const id of invalid) {
    assert.equal(
      r9VerifiedSavedSignal([receipt(id)], tag, signal).ok,
      false
    );
  }
});

test('R9 still rejects mismatched evidence', () => {
  const invalid = [
    receipt(legacyId, { eventId: 'unverified' }),
    receipt(legacyId, { logId: 'wrong-request' }),
    receipt(legacyId, { signal: 'GSPOGE.ABB_DCS.WRONG' }),
    receipt(legacyId, {
      updatedAt: '2026-11-10T11:00:00Z'
    })
  ];

  for (const row of invalid) {
    assert.equal(
      r9VerifiedSavedSignal([row], tag, signal).ok,
      false
    );
  }
});
