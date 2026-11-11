import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {onRequestGet} from '../functions/api/blower-history.js';

function context(session, token = 'fixture-session') {
  const queries = [];
  const db = {
    prepare(query) {
      assert.match(query.trim(), /^SELECT\b/i, 'diagnostics must not migrate, touch sessions or write data');
      queries.push(query);
      return {
        bind() { return this; },
        async first() {
          if (/FROM shift_log_sessions/.test(query)) return session;
          assert.match(query, /FROM blower_silo_basis_intents_v1/);
          return null;
        }
      };
    },
    batch() { assert.fail('read-only diagnostics must not execute a batch'); }
  };
  return {queries, env: {DB: db}, request: new Request(
    'https://fixture.test/api/blower-history?action=silo_basis_recovery_diagnostics&requestId=existing-fixture',
    {headers: token ? {Authorization: 'Bearer ' + token} : {}}
  )};
}
const session = role => ({employee_no: 'diagnostic-reviewer', name: 'Fixture', role, is_active: 1,
  expires_at: new Date(Date.now() + 3600000).toISOString(), last_used_at: '2000-01-01T00:00:00Z'});

test('diagnostic GET authenticates an old session without touching it or running schema setup', async () => {
  const ctx = context(session('super_admin'));
  const response = await onRequestGet(ctx), body = await response.json();
  assert.equal(response.status, 404);
  assert.equal(body.code, 'SILO_BASIS_REQUEST_NOT_FOUND');
  assert.equal(ctx.queries.length, 2);
});

test('diagnostic GET requires super admin before reading a recovery request', async () => {
  for (const role of ['admin', 'user']) {
    const ctx = context(session(role)), response = await onRequestGet(ctx);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'SILO_BASIS_FORBIDDEN');
    assert.equal(ctx.queries.length, 1);
  }
});

test('missing or expired diagnostic sessions never delete sessions or bootstrap data', async () => {
  for (const ctx of [context(null, ''), context({...session('super_admin'), expires_at: '2000-01-01T00:00:00Z'})]) {
    const response = await onRequestGet(ctx);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'SILO_BASIS_FORBIDDEN');
    assert.ok(ctx.queries.length <= 1);
  }
});

function browserRequest(payload) {
  const source = fs.readFileSync(new URL('../maintenance/blower-history.js', import.meta.url), 'utf8');
  const start = source.indexOf('  async function sendApiRequest(');
  const end = source.indexOf('  function buildAdaptiveRetryLimits(', start);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({API_URL: '/api/blower-history', Promise, Error, Number, String, Math, JSON, Object, Date,
    window: {setTimeout, clearTimeout}, hasAuthenticatedWriteAccess: () => true,
    getAuthHeaders: headers => headers || {}, getSessionToken: () => 'private-session', parseRetryAfterMs: () => 0,
    fetch: async () => new Response(JSON.stringify(payload), {status: 500})});
  vm.runInContext(source.slice(start, end), context);
  return () => context.sendApiRequest({method: 'POST', body: {action: 'apply_silo_basis_recovery'}});
}

test('the real HTTP bridge preserves only typed Silo storage stage and reason', async () => {
  const send = browserRequest({ok: false, code: 'SILO_BASIS_STORAGE_FAILED',
    diagnostic: {stage: 'ATOMIC_BATCH', reason: 'D1_QUERY_LIMIT', raw: 'private-session'}});
  await assert.rejects(send, error => {
    assert.equal(error.status, 500);
    assert.equal(error.code, 'SILO_BASIS_STORAGE_FAILED');
    assert.equal(error.diagnostic.stage, 'ATOMIC_BATCH');
    assert.equal(error.diagnostic.reason, 'D1_QUERY_LIMIT');
    assert.deepEqual(Object.keys(error.diagnostic).sort(), ['reason', 'stage']);
    return true;
  });
});

test('the HTTP bridge discards unrecognized diagnostic strings and unrelated response codes', async () => {
  for (const payload of [
    {code: 'SILO_BASIS_STORAGE_FAILED', diagnostic: {stage: 'private-session', reason: 'UNKNOWN'}},
    {code: 'SILO_BASIS_STORAGE_FAILED', diagnostic: {stage: 'ATOMIC_BATCH', reason: 'SQL containing private-session'}},
    {code: 'UNRELATED_FAILURE', diagnostic: {stage: 'ATOMIC_BATCH', reason: 'D1_QUERY_LIMIT'}}
  ]) {
    await assert.rejects(browserRequest({ok: false, ...payload}), error => {
      assert.equal(error.diagnostic, undefined);
      return true;
    });
  }
});
