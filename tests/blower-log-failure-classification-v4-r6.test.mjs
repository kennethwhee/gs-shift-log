import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { __blowerHistoryTest as api } from '../functions/api/blower-history.js';

const core = createRequire(import.meta.url)('../maintenance/blower-unified-refresh.js');
const daily = kind => `D1_ERROR: Your account has exceeded D1's free tier daily row ${kind} limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue.`;
const classify = (message, extras = {}) => api.classifyBlowerLogFailure(Object.assign(new Error(message), extras));
async function failedPage(error) {
  let calls = 0;
  const db = { prepare() { return { bind() { return this; }, async run() { calls++; throw error; } }; } };
  const response = await api.latestLogsStep(db, { employeeNo: 'failure-fixture', name: 'Failure fixture' },
    { phase: 'replacement', replacementAutoVersion: 3, incrementalLogs: true, autoApplyConfirmedReplacements: true });
  return { response, payload: await response.json(), calls };
}

test('daily D1 read and write quotas stop automatic replay instead of treating the D1_ERROR prefix as transient', () => {
  for (const kind of ['read', 'write']) {
    const result = classify(daily(kind));
    assert.equal(result.retryable, false);
    assert.equal(result.code, 'BLOWER_LOG_D1_DAILY_LIMIT');
    assert.equal(result.failureKind, 'daily_limit');
    assert.equal(result.status, 500);
    assert.match(result.message, new RegExp(`daily row ${kind} limit`));
  }
});

test('deterministic invocation, SQL parameter, function argument and statement limits require a changed query', () => {
  for (const [message, code] of [
    ['Too many API requests by single Worker invocation', 'BLOWER_LOG_D1_REQUEST_LIMIT'],
    ['D1_ERROR: too many subrequests', 'BLOWER_LOG_D1_REQUEST_LIMIT'],
    ['D1_ERROR: too many SQL variables', 'BLOWER_LOG_D1_QUERY_LIMIT'],
    ['D1_ERROR: too many arguments on function json_array', 'BLOWER_LOG_D1_QUERY_LIMIT'],
    ['D1_ERROR: Expression tree is too large (maximum depth 100): SQLITE_ERROR', 'BLOWER_LOG_D1_QUERY_LIMIT'],
    ['D1_ERROR: SQL statement exceeds maximum length', 'BLOWER_LOG_D1_QUERY_LIMIT'],
    ['D1_ERROR: SQLITE_TOOBIG', 'BLOWER_LOG_D1_QUERY_LIMIT']
  ]) {
    const result = classify(message);
    assert.equal(result.retryable, false, message);
    assert.equal(result.code, code, message);
  }
});

test('storage capacity and invalid query errors remain distinct from temporary D1 failures', () => {
  for (const [message, code] of [
    ["D1_ERROR: Your account has exceeded D1's maximum account storage limit", 'BLOWER_LOG_D1_CAPACITY_LIMIT'],
    ['D1_ERROR: Exceeded maximum DB size.', 'BLOWER_LOG_D1_CAPACITY_LIMIT'],
    ['D1_ERROR: Rows read limit exceeded', 'BLOWER_LOG_D1_CAPACITY_LIMIT'],
    ['D1_TYPE_ERROR: unsupported parameter type', 'BLOWER_LOG_D1_QUERY_INVALID'],
    ['D1_COLUMN_NOTFOUND: source_snapshot', 'BLOWER_LOG_D1_QUERY_INVALID'],
    ['D1_ERROR: no such column: source_snapshot', 'BLOWER_LOG_D1_QUERY_INVALID'],
    ['D1_ERROR: near INSERTZ: syntax error', 'BLOWER_LOG_D1_QUERY_INVALID']
  ]) {
    const result = classify(message);
    assert.equal(result.retryable, false, message);
    assert.equal(result.code, code, message);
  }
});

test('temporary busy, network, overload and D1 reset failures retain bounded retry behavior', () => {
  for (const message of [
    'SQLITE_BUSY: database is locked',
    'D1_ERROR: D1 DB is overloaded. Requests queued for too long.',
    'D1_ERROR: temporary overload, too many queries queued',
    'D1_ERROR: D1 DB reset because its code was updated.',
    'D1_ERROR: Cannot resolve D1 DB due to transient issue on remote node.',
    'Network connection lost.',
    'Replica disconnected from primary.',
    'D1_ERROR: D1 DB storage operation exceeded timeout which caused object to be reset.'
  ]) {
    const result = classify(message);
    assert.equal(result.retryable, true, message);
    assert.equal(result.status, 503, message);
    assert.equal(result.code, 'BLOWER_LOG_PAGE_FAILED');
  }
});

test('explicit denial status, conflict code and an explicit no-retry flag cannot be overridden by D1 wording', () => {
  for (const status of [400, 401, 403, 409]) {
    const result = classify('D1_ERROR: temporary source validation failure', { status, code: 'BLOWER_SOURCE_CONFLICT' });
    assert.equal(result.status, status);
    assert.equal(result.code, 'BLOWER_SOURCE_CONFLICT');
    assert.equal(result.retryable, false);
  }
  const stopped = classify('D1_ERROR: interrupted source processing', { status: 503, retryable: false, code: 'SOURCE_STOPPED' });
  assert.equal(stopped.retryable, false);
  assert.equal(stopped.status, 503);
  assert.equal(stopped.code, 'SOURCE_STOPPED');
});

test('the actual latestLogsStep endpoint returns a bounded actionable failure without serializing the error object', async () => {
  const error = Object.assign(new Error(daily('read') + '\n' + 'x'.repeat(2000)), { status: 503, extra: 'not-returned' });
  const result = await failedPage(error);
  assert.equal(result.calls, 1);
  assert.equal(result.response.status, 503);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.phase, 'replacement');
  assert.equal(result.payload.code, 'BLOWER_LOG_D1_DAILY_LIMIT');
  assert.equal(result.payload.retryable, false);
  assert.ok(result.payload.message.length <= 600);
  assert.doesNotMatch(result.payload.message, /[\u0000-\u001f]/);
  assert.equal(result.payload.extra, undefined);
});

test('one continuation click at 188 processed sources makes one request for a known quota and creates no RUN request', async () => {
  const window = { fromDate: '2025-11-04', endDate: '2026-11-04', snapshotAt: '2026-11-03T21:18:00.000Z' };
  const cursor = { workDate: '2026-05-04', updatedAt: '2026-11-03T00:00:00.000Z', id: 'a'.repeat(64) };
  const resume = { phase: 'replacement', replacementAutoVersion: 3, normalizationVersion: 4,
    replacementComplete: false, window, cursor, limit: 2, totals: { scannedReplacementLogs: 188, autoLinkedReplacementCount: 26 } };
  const calls = [], checkpoints = [], sleeps = [];
  await assert.rejects(core.refreshLogsForRuntime({
    assertWritable() {}, checkpoint(value) { checkpoints.push(structuredClone(value)); },
    async api(request) {
      calls.push(request);
      const result = await failedPage(Object.assign(new Error(daily('read')), { status: 503 }));
      throw Object.assign(new Error(result.payload.message), { status: result.response.status, ...result.payload });
    }
  }, { replacementAutoVersion: 3, normalizationVersion: 4, autoContinue: true, resume,
    clock: () => 0, sleep: async milliseconds => { sleeps.push(milliseconds); } }), error =>
    error.code === 'BLOWER_LOG_D1_DAILY_LIMIT' && error.retryable === false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.action, 'latest_logs_step');
  assert.deepEqual(calls[0].body.cursor, cursor);
  assert.deepEqual(calls[0].body.window, window);
  assert.equal(checkpoints.at(-1).totals.scannedReplacementLogs, 188);
  assert.equal(checkpoints.at(-1).totals.autoLinkedReplacementCount, 26);
  assert.deepEqual(sleeps, []);
});

test('an older D1 cause can classify a known quota without exposing its full nested error', () => {
  const result = classify('D1_ERROR', { cause: new Error(daily('write')) });
  assert.equal(result.code, 'BLOWER_LOG_D1_DAILY_LIMIT');
  assert.equal(result.retryable, false);
  assert.equal(result.message, 'D1_ERROR');
  assert.equal(result.cause, undefined);
});

test('unrecognized D1 and ordinary errors keep their earlier generic behavior without claiming a quota', () => {
  const unknownD1 = classify('D1_ERROR: unknown future service condition');
  assert.equal(unknownD1.retryable, true);
  assert.equal(unknownD1.status, 503);
  assert.equal(unknownD1.failureKind, undefined);
  const ordinary = classify('Unexpected application failure');
  assert.equal(ordinary.retryable, false);
  assert.equal(ordinary.status, 500);
  assert.equal(ordinary.failureKind, undefined);
});
