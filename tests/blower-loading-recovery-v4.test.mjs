import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const core = createRequire(import.meta.url)('../maintenance/blower-unified-refresh.js');
const TAGS = ['104ETH03AN601', '104ETH03AN602'];
const NOW = new Date('2026-10-28T00:00:00Z');
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

function tasks(count = 2) {
  const assets = TAGS.slice(0, count).map((tag, index) => ({
    tagNumber: tag,
    displayName: `Test Blower ${index + 1}`,
    enabled: true,
    lastReplacementAt: '2026-10-01T00:00:00Z',
    cycleStartState: 'legacy',
    cycleStartedAt: '',
    cycleStartRevision: `start-${index}`,
    cycleRuntimeRevision: `runtime-${index}`,
    cycleElapsedHours: 77 + index,
    dataParcTag: 'GSPOGE.ABB_DCS.TEST_ONLY_CONFIRMED_BINARY'
  }));
  return core.plan(assets, NOW).tasks;
}

function accepted(source) {
  return {
    ok: true, atomic: true, batchVersion: 1, requestedCount: source.length,
    results: source.map((task, index) => ({
      ok: true,
      assetTag: task.snapshot.tagNumber,
      item: {
        id: `accepted-request-${index + 1}`,
        status: 'pending',
        requestType: 'blower_runtime_probe',
        probe: { assetTag: task.snapshot.tagNumber, requestId: `accepted-request-${index + 1}` }
      }
    }))
  };
}

function scenario(source = tasks(), config = {}) {
  let now = 0, checkpoint;
  const calls = [], checkpoints = [], sleeps = [], statuses = [];
  const batch = accepted(source);
  const io = {
    clock: () => now,
    sleep: async milliseconds => { sleeps.push(milliseconds); now += milliseconds; },
    assertWritable() {},
    progress() {},
    onStatuses(items) { statuses.push(clone(items)); },
    runtimeCheckpoint(value) { checkpoint = clone(value); checkpoints.push(checkpoint); },
    async api(request) {
      calls.push(clone(request));
      if (request.body?.action === 'create_blower_runtime_probe_batch') {
        if (config.createError) throw config.createError;
        return clone(config.createdBatch || batch);
      }
      if (request.url?.includes('action=status_batch')) {
        if (config.pollError) throw config.pollError;
        const ids = new URL(request.url, 'https://test.invalid').searchParams.get('ids').split(',');
        return { items: ids.map((id, index) => ({
          id,
          status: config.statusFor ? config.statusFor(id, now, index) : 'complete'
        })) };
      }
      if (request.body?.action === 'dataparc_runtime_sync') {
        const cause = config.syncErrorFor?.(request.body.requestId);
        if (cause) throw cause;
        return { ok: true, message: 'stored confirmed RUN result' };
      }
      throw new Error('Unexpected request in offline Blower fixture');
    }
  };
  return {
    source, io, calls, checkpoints, sleeps, statuses, config,
    get now() { return now; },
    get checkpoint() { return checkpoint; },
    creates: () => calls.filter(request => request.body?.action === 'create_blower_runtime_probe_batch'),
    syncs: () => calls.filter(request => request.body?.action === 'dataparc_runtime_sync'),
    polls: () => calls.filter(request => request.url?.includes('action=status_batch')),
    resume() { io.runtimeResume = clone(checkpoint); },
    run: () => core.executeDataParcBatch(source, io)
  };
}

test('processing requests return after the foreground deadline without cancelling or requeuing work', async () => {
  let now = 0;
  const calls = [];
  const initial = [{ id: 'still-processing', status: 'processing' }];
  const result = await core.waitRequests(initial, {
    assertWritable() {},
    api: async request => { calls.push(request); return { items: initial }; }
  }, {
    clock: () => now,
    sleep: async milliseconds => { now += milliseconds; },
    timeoutMs: 120000,
    pendingTimeoutMs: 45000,
    returnPendingOnTimeout: true,
    settleFailures: true
  });
  assert.equal(result[0].status, 'processing');
  assert.ok(now >= 120000 && now <= 122500, `foreground wait ${now}ms`);
  assert.ok(calls.length > 0);
  assert.ok(calls.every(request => !request.body && request.url.includes('ids=still-processing')));
});

test('a completed asset is stored when its sibling stays pending, and only the pending ID is resumed', async () => {
  const f = scenario(tasks(), {
    statusFor: id => id === 'accepted-request-1' ? 'complete' : 'pending'
  });
  const originalSource = clone(f.source);
  const first = await f.run();
  assert.deepEqual(first.map(item => item.status), ['complete', 'waiting']);
  assert.ok(f.now >= 45000 && f.now <= 47500, `mixed pending wait ${f.now}ms`);
  assert.deepEqual(f.syncs().map(request => request.body.requestId), ['accepted-request-1']);
  assert.equal(f.creates().length, 1);
  assert.ok(f.checkpoint?.createdBatch, 'accepted IDs must survive the foreground timeout');
  assert.ok(f.checkpoint.outcomes.some(item => item.tagNumber === TAGS[0] && item.status === 'complete'));
  assert.deepEqual(f.source, originalSource, 'waiting must not zero or alter the previous asset snapshot');

  const pollOffset = f.polls().length;
  f.resume();
  f.config.statusFor = () => 'complete';
  const second = await f.run();
  assert.deepEqual(second.map(item => item.status), ['complete', 'complete']);
  assert.equal(f.creates().length, 1, 'resume must not run create again');
  assert.deepEqual(f.syncs().map(request => request.body.requestId), ['accepted-request-1', 'accepted-request-2']);
  assert.ok(f.polls().slice(pollOffset).every(request =>
    !new URL(request.url, 'https://test.invalid').searchParams.get('ids').split(',').includes('accepted-request-1')));
  assert.equal(f.checkpoint, null);
});

test('a stopped processing batch preserves its original IDs and completes on a later status check', async () => {
  const f = scenario(tasks(), { statusFor: () => 'processing' });
  const first = await f.run();
  assert.deepEqual(first.map(item => item.status), ['waiting', 'waiting']);
  assert.equal(f.creates().length, 1);
  assert.equal(f.syncs().length, 0);
  assert.ok(f.now >= 120000 && f.now <= 122500);
  assert.ok(f.checkpoint?.createdBatch);

  f.resume();
  f.config.statusFor = () => 'complete';
  const second = await f.run();
  assert.deepEqual(second.map(item => item.status), ['complete', 'complete']);
  assert.equal(f.creates().length, 1);
  assert.deepEqual(f.syncs().map(request => request.body.requestId), ['accepted-request-1', 'accepted-request-2']);
  assert.equal(f.checkpoint, null);
});

test('a later status failure still stores an already confirmed completion and retains the other accepted ID', async () => {
  const f = scenario(tasks(), {
    statusFor: id => id === 'accepted-request-1' ? 'complete' : 'processing'
  });
  const api = f.io.api;
  let reads = 0;
  f.io.api = async request => {
    if (request.url?.includes('action=status_batch') && ++reads > 1) {
      f.calls.push(clone(request));
      throw Object.assign(new Error('server resource limit'), {
        status: 503, code: 'CLOUDFLARE_1102', retryable: false
      });
    }
    return api(request);
  };
  const result = await f.run();
  assert.deepEqual(result.map(item => item.status), ['complete', 'waiting']);
  assert.deepEqual(f.syncs().map(request => request.body.requestId), ['accepted-request-1']);
  assert.equal(f.creates().length, 1);
  assert.equal(f.polls().length, 2, 'a non-retryable failure must not keep polling');
  assert.ok(f.statuses.some(items => items.find(item => item.id === 'accepted-request-1')?.status === 'complete'));
  assert.ok(f.checkpoint?.createdBatch.results.some(item => item.item?.id === 'accepted-request-2'));
});

test('a lost save response is retried with the same accepted ID and never starts another collection', async () => {
  let loseSaveResponse = true;
  const f = scenario(tasks(1), {
    syncErrorFor: () => loseSaveResponse
      ? Object.assign(new Error('response was lost after submission'), { status: 504, code: 'REQUEST_TIMEOUT', retryable: true })
      : null
  });
  const first = await f.run();
  assert.equal(first[0].status, 'waiting');
  assert.ok(f.checkpoint?.createdBatch);
  assert.equal(f.checkpoint.outcomes.some(item => item.status === 'complete'), false,
    'an unconfirmed save must not be labelled stored');
  assert.deepEqual(f.syncs().map(request => request.body.requestId), ['accepted-request-1']);

  f.resume();
  loseSaveResponse = false;
  const second = await f.run();
  assert.equal(second[0].status, 'complete');
  assert.equal(f.creates().length, 1);
  assert.deepEqual(f.syncs().map(request => request.body.requestId), ['accepted-request-1', 'accepted-request-1']);
  assert.equal(f.checkpoint, null);
});

test('a create timeout does not retry POST or invent an accepted receipt', async () => {
  const createError = Object.assign(new Error('submission response timed out'), { status: 504, code: 'REQUEST_TIMEOUT', retryable: true });
  const f = scenario(tasks(1), { createError });
  await assert.rejects(f.run, error => error.code === 'CREATE_RESULT_UNCONFIRMED');
  assert.equal(f.creates().length, 1);
  assert.equal(f.polls().length, 0);
  assert.equal(f.syncs().length, 0);
  assert.ok(f.checkpoints.every(checkpoint => !checkpoint?.createdBatch),
    'unknown submission must remain unknown rather than constructing request IDs');
  assert.ok(Number.isFinite(f.creates()[0].timeoutMs) && f.creates()[0].timeoutMs > 0);
});

test('authorization lost during polling immediately stops without saving or recreating accepted work', async () => {
  const failure = Object.assign(new Error('session expired'), { status: 401, retryable: false });
  const f = scenario(tasks(1), { pollError: failure });
  await assert.rejects(f.run, error => error.status === 401);
  assert.equal(f.creates().length, 1);
  assert.equal(f.polls().length, 1);
  assert.equal(f.syncs().length, 0);
  assert.equal(f.sleeps.length, 0);
  assert.ok(f.checkpoint?.createdBatch, 'the accepted ID survives for the original authorized owner');
});

test('all creation and save HTTP operations have an explicit finite deadline', async () => {
  const f = scenario(tasks());
  const result = await f.run();
  assert.ok(result.every(item => item.status === 'complete'));
  for (const request of [...f.creates(), ...f.syncs()]) {
    assert.ok(Number.isFinite(request.timeoutMs) && request.timeoutMs > 0 && request.timeoutMs <= 60000,
      `${request.body.action} requires a bounded HTTP response time`);
  }
});

test('mismatched create results cannot become a trusted resume checkpoint', async () => {
  const source = tasks(1);
  const malformed = accepted(source);
  malformed.results[0].item.probe.assetTag = TAGS[1];
  const f = scenario(source, { createdBatch: malformed });
  await assert.rejects(f.run, error => error.code === 'CREATE_BATCH_RESPONSE_MISMATCH');
  assert.equal(f.creates().length, 1);
  assert.equal(f.polls().length, 0);
  assert.equal(f.syncs().length, 0);
  assert.ok(f.checkpoints.every(checkpoint => !checkpoint?.createdBatch));
});

const browserSource = readFileSync(new URL('../maintenance/blower-history.js', import.meta.url), 'utf8');
const sendStart = browserSource.indexOf('  async function sendApiRequest(');
const sendEnd = browserSource.indexOf('  function buildAdaptiveRetryLimits(', sendStart);
assert.ok(sendStart >= 0 && sendEnd > sendStart);
const sendSource = browserSource.slice(sendStart, sendEnd);

function httpHarness({ bodyStalls = false, abortAvailable = true } = {}) {
  const timers = new Map(), delays = [], fetches = [];
  let nextTimer = 0, resolveFetch, resolveBody;
  const fetchGate = new Promise(resolve => { resolveFetch = resolve; });
  const bodyGate = new Promise(resolve => { resolveBody = resolve; });
  const response = { ok: true, status: 200, headers: new Headers(), text: () => bodyGate };
  const context = vm.createContext({
    API_URL: '/api/blower-history',
    Promise, Error, Number, String, Math, JSON, Object, Date, Set,
    ...(abortAvailable ? { AbortController } : {}),
    window: {
      setTimeout(callback, delay) { const id = ++nextTimer; delays.push(delay); timers.set(id, callback); return id; },
      clearTimeout(id) { timers.delete(id); }
    },
    assertUnifiedRefreshWritable() {},
    hasAuthenticatedWriteAccess: () => true,
    getAuthHeaders: extra => extra || {},
    getSessionToken: () => 'synthetic-session',
    parseRetryAfterMs: () => 0,
    fetch: (url, options) => { fetches.push({ url, options }); return bodyStalls ? Promise.resolve(response) : fetchGate; }
  });
  vm.runInContext(sendSource, context);
  return {
    context, timers, delays, fetches,
    async expire() { await Promise.resolve(); await Promise.resolve(); for (const callback of [...timers.values()]) callback(); },
    finishLate() { resolveBody('{"ok":true}'); resolveFetch(response); },
    send: () => context.sendApiRequest({ unifiedRefresh: true, method: 'POST', body: { action: 'test_only' } })
  };
}

for (const [label, options] of [
  ['fetch never answers', {}],
  ['headers arrive but the response body never ends', { bodyStalls: true }],
  ['AbortController is unavailable', { abortAvailable: false }]
]) test(`unified HTTP deadline releases a caller when ${label}`, async () => {
  const h = httpHarness(options);
  let accepted = false;
  const pending = h.send().then(value => { accepted = true; return value; });
  const rejection = assert.rejects(pending, error => error.code === 'REQUEST_TIMEOUT' && error.status === 504);
  assert.equal(h.delays[0], 30000, 'scoped requests need a default deadline even if the caller omits timeoutMs');
  await h.expire();
  await rejection;
  assert.equal(h.timers.size, 0);
  if (options.abortAvailable !== false) assert.equal(h.fetches[0].options.signal.aborted, true);
  h.finishLate();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(accepted, false, 'late network completion cannot turn a timed out operation into success');
});
