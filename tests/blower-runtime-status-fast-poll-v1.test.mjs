import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const core = createRequire(import.meta.url)('../maintenance/blower-unified-refresh.js');

function pending(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `request-${index + 1}`,
    status: 'pending'
  }));
}

test('22 Blower statuses are read immediately in one API request', async () => {
  let now = 1000;
  const sleeps = [];
  const calls = [];
  const items = pending(22);
  const result = await core.waitRequests(items, {
    assertWritable() {},
    progress() {},
    async api(request) {
      calls.push({ request, at: now });
      return { items: items.map(item => ({ ...item, status: 'complete' })) };
    }
  }, {
    clock: () => now,
    sleep: async milliseconds => { sleeps.push(milliseconds); now += milliseconds; }
  });

  assert.equal(result.length, 22);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].at, 1000);
  assert.equal(sleeps.length, 0);
  const ids = new URL(calls[0].request.url, 'https://example.invalid').searchParams.get('ids').split(',');
  assert.equal(ids.length, 22);
});

test('foreground status polling uses the 400 ms fast interval after the immediate read', async () => {
  let now = 5000;
  let polls = 0;
  const sleeps = [];
  const items = pending(2);
  await core.waitRequests(items, {
    assertWritable() {},
    progress() {},
    async api() {
      polls += 1;
      return { items: items.map(item => ({ ...item, status: polls === 1 ? 'processing' : 'complete' })) };
    }
  }, {
    clock: () => now,
    sleep: async milliseconds => { sleeps.push(milliseconds); now += milliseconds; }
  });

  assert.equal(polls, 2);
  assert.deepEqual(sleeps, [400]);
});

test('one-click refresh performs one planning read and one final read-back', () => {
  const source = readFileSync(new URL('../maintenance/blower-history.js', import.meta.url), 'utf8');
  const body = source.slice(
    source.indexOf('async function refreshAllBlowers()'),
    source.indexOf('async function refreshFbheForUnified(')
  );
  assert.equal((body.match(/await io\.reload\(\);/g) || []).length, 2);
  assert.doesNotMatch(body, /every independent append[\s\S]{0,240}await io\.reload/);
});

test('default Blower data GET returns before the action-specific asset preload', () => {
  const source = readFileSync(new URL('../functions/api/blower-history.js', import.meta.url), 'utf8');
  const body = source.slice(
    source.indexOf('async function handleGet(context, user)'),
    source.indexOf('function validateSettingsInput(')
  );
  const fastReturn = body.indexOf('if (action === "data")');
  const preload = body.indexOf('const settings = await loadSettings(database);');
  assert.ok(fastReturn > 0);
  assert.ok(preload > fastReturn);
  assert.match(body.slice(fastReturn, preload), /return jsonResponse\(await buildFullData\(database, user\)\);/);
});
