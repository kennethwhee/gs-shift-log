'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ui = require('../maintenance/blower-fbhe1a-runtime-v1.js');
const refresh = require('../maintenance/blower-unified-refresh.js');
const TAG = '104HHL60AP611', DAY = '2026-09-04';
const ORIGIN = DAY + 'T00:00:00+09:00', OLD_START = DAY + 'T10:50:00+09:00';
const STOP = DAY + 'T10:50:39.600+09:00', START = '2026-09-05T00:00:00+09:00';
const END = '2026-11-11T20:48:00+09:00', REPORTED_RESTART_DAY = '2026-10-08';
const PROOF = 'a'.repeat(64), NONCE = 'fbhe1a-ui-nonce-001';
const WITNESS = 'e0000000-0000-4000-8000-000000000001', REQUEST = 'e0000000-0000-4000-8000-000000000002';
const OLD_SECONDS = 2000000, EXCLUDED = Math.round((Date.parse(STOP) - Date.parse(OLD_START)) / 1000);
const EXPECTED = OLD_SECONDS - EXCLUDED, FRESH = EXPECTED - 1;
const normalizeLineEndings = source => source.replace(/\r\n?/g, '\n');
function historyVariants() {
  const source = normalizeLineEndings(fs.readFileSync(require.resolve('../maintenance/blower-history.js'), 'utf8'));
  return [['LF', source], ['CRLF', source.replace(/\n/g, '\r\n')]];
}
function section(raw, startMarker, endMarker, label) {
  const source = normalizeLineEndings(raw), start = source.indexOf(startMarker);
  assert.ok(start >= 0, label + ': start marker not found');
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, label + ': end marker not found after start marker');
  return source.slice(start, end);
}
function view(patch = {}) {
  return { ok: true, assetTag: TAG, eligible: true, proofHash: PROOF,
    completionDay: DAY, completionClockKnown: false, operatorReportedRestartDay: REPORTED_RESTART_DAY,
    witness: { id: WITNESS, status: 'complete', lastRunStoppedAt: STOP, dailyRunningSeconds: 39040,
      excludedPreReplacementSeconds: EXCLUDED, excludedDurationMilliseconds: Date.parse(STOP) - Date.parse(OLD_START), zeroWindowEndAt: START },
    measurementWindow: { startAt: START, endAt: END, chunkCount: 1 },
    saved: { startAt: OLD_START, runningSeconds: OLD_SECONDS, observedAt: END },
    quality: { sampleGoodCertified: false }, attestationRequired: true, applied: false, replayed: false, ...patch };
}
function queued(status = 'pending', patch = {}) { return view({ request: { id: REQUEST, status }, ...patch }); }
function complete(patch = {}) {
  return view({ request: { id: REQUEST, status: 'complete' }, preview: {
    measuredRunningSeconds: FRESH, previousRunningSeconds: OLD_SECONDS, excludedPreReplacementSeconds: EXCLUDED,
    expectedRunningSeconds: EXPECTED, differenceSeconds: -1, toleranceSeconds: 2,
    appendedRunningSeconds: 0, totalRunningSeconds: FRESH, observedAt: END }, ...patch });
}
function attestation(stop = STOP) {
  return { version: 1, completionDay: DAY, lastRunStoppedAt: stop, replacementCompletedAfterStop: true,
    noRestartThroughWindowEnd: true, zeroWindowEndAt: START,
    statementCode: 'BELT_COMPLETED_AFTER_LAST_STOP_AND_REMAINED_STANDBY_THROUGH_WINDOW_END',
    operatorReportedRestartDay: REPORTED_RESTART_DAY };
}
function harness(changes = {}) {
  const saved = new Map(), calls = [], locks = []; let next = view(), reloads = 0;
  const deps = { getAsset: () => ({ tagNumber: TAG, enabled: true }), canWrite: () => true,
    isMobile: () => false, session: () => 'fbhe1a-session-never-stored', isBusy: () => false,
    setBusy: value => locks.push(value), nonce: () => NONCE,
    storage: { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value) },
    api: async options => { calls.push(options); if (next instanceof Error) throw next; return next; },
    reload: async () => { reloads++; return true; }, ...changes };
  return { controller: ui.createController(deps), deps, saved, calls, locks, set: value => { next = value; }, reloads: () => reloads };
}
async function verified(changes) { const h = harness(changes); await h.controller.refresh(); return h; }
async function ready(changes) {
  const h = await verified(changes); h.controller.setAttested(true); h.set(queued());
  await h.controller.start(); h.set(complete()); await h.controller.refresh(); h.controller.setAttested(true); return h;
}
const posts = h => h.calls.filter(call => call.method === 'POST');
function recoveredAsset(delta = 0) {
  const observedAt = new Date(Date.parse(END) + delta * 1000).toISOString(), total = FRESH + delta;
  const meta = { version: 1, certificateEventId: 'dataparc_fbhe1a_runtime:' + REQUEST,
    freshRequestId: REQUEST, witnessRequestId: WITNESS, auditId: 'fbhe1a_runtime:' + REQUEST,
    proofHash: PROOF, sourceProofHash: 'b'.repeat(64), cycleStartRevision: 'fbhe1a-runtime-v1:' + PROOF,
    currentRuntimeRevision: 'runtime-after-apply', currentRunningSeconds: total, currentObservedAt: observedAt,
    currentAnchorAt: observedAt, currentState: 'running', measuredState: 'running', preservedStateBoundary: false,
    completionDay: DAY, completionClockKnown: false, lastRunStoppedAt: STOP, zeroWindowEndAt: START, measuredStartAt: START,
    excludedPreReplacementSeconds: EXCLUDED, measuredRunningSeconds: FRESH,
    replacementCompletedAfterStop: true, noRestartThroughWindowEnd: true, durationEquivalent: true,
    originalRunningSeconds: OLD_SECONDS, comparisonToleranceSeconds: 2, comparisonDifferenceSeconds: -1,
    operatorReportedRestartDay: REPORTED_RESTART_DAY, sampleGoodCertified: false };
  const basis = { composite: true, appendReady: true, coverageComplete: true, cycleBasisConfirmed: false,
    completionClockKnown: false, dataParcTag: 'GSPOGE.ABB_DCS.104HHL60AP611XB04',
    requestId: delta ? 'e0000000-0000-4000-8000-000000000003' : REQUEST,
    startAt: START, requiredStartAt: ORIGIN, observedAt, runningSeconds: total, runtimeHours: total / 3600,
    missingLeadingSeconds: 0, cycleRuntimeRevision: 'runtime-after-apply', state: 'running', fbhe1aRuntime: { ...meta } };
  const evidence = { version: 1, source: 'dataparc', measurementVerified: true, durationEquivalent: true,
    durationVerified: true, completionClockKnown: false, wholeCycleVerified: false, cycleBasisConfirmed: false,
    composite: true, coverageComplete: true, missingLeadingSeconds: 0, requestId: basis.requestId,
    hours: total / 3600, startAt: START, requiredStartAt: ORIGIN, observedAt, fbhe1aRuntime: { ...meta }, sampleGoodCertified: false };
  return { tagNumber: TAG, blowerType: 'fbhe', unitNo: '1', enabled: true, dataParcTag: basis.dataParcTag,
    lastReplacementAt: ORIGIN, actualLastReplacementAt: '', cycleBasisKind: 'replacement_runtime_equivalent',
    cycleStartState: 'legacy', cycleStoredStartedAt: '',
    cycleStartedAt: ORIGIN, cycleStartRevision: meta.cycleStartRevision, cycleRuntimeRevision: 'runtime-after-apply',
    cycleRuntimeState: 'running', isRunning: true, cycleElapsedHours: total / 3600, runtimeHours: total / 3600,
    cycleRuntimeAnchorAt: observedAt, runRuntime: { source: 'dataparc', verified: true, hours: total / 3600, state: 'running', measuredAt: observedAt },
    dataParcRuntimeBasis: basis, runtimeCoverageEvidence: evidence, fbhe1aRuntimeProof: { ...meta } };
}

test('FBHE 1A runtime opens without a request, leaves attestation off and requires an explicit preview GET', async () => {
  const h = harness(); assert.equal(h.calls.length, 0); assert.equal(h.saved.size, 0);
  assert.equal(h.controller.snapshot().phase, 'idle'); assert.equal(h.controller.snapshot().attested, false);
  assert.equal(await h.controller.start(), false); assert.equal(posts(h).length, 0);
  await h.controller.refresh(); assert.equal(h.calls.length, 1);
  assert.match(h.calls[0].url, /action=fbhe1a_runtime_status(?:&|$)/);
  assert.ok(!h.calls[0].method || h.calls[0].method === 'GET');
  assert.equal(h.controller.snapshot().phase, 'verified'); assert.equal(h.controller.snapshot().attested, false);
});
test('FBHE 1A runtime start stores nonce, witness and exact stopped-window attestation before one explicit POST', async () => {
  const h = await verified(); h.controller.setAttested(true);
  h.deps.api = async options => {
    h.calls.push(options); const record = JSON.parse(h.saved.get(ui.KEY));
    assert.equal(record.version, 1); assert.equal(record.nonce, NONCE); assert.equal(record.requestId, '');
    assert.equal(record.witnessRequestId, WITNESS); assert.equal(record.proofHash, PROOF); assert.equal(record.pending, true);
    assert.deepEqual(record.attestation, attestation());
    assert.deepEqual(options.body, { action: 'start_fbhe1a_runtime', nonce: NONCE,
      expectedProofHash: PROOF, witnessRequestId: WITNESS, attestation: attestation() });
    assert.doesNotMatch(JSON.stringify(record), /fbhe1a-session-never-stored|2000000|1999959/);
    return queued();
  };
  assert.equal(await h.controller.start(), true); assert.equal(posts(h).length, 1);
  assert.equal(JSON.parse(h.saved.get(ui.KEY)).requestId, REQUEST);
});
test('FBHE 1A runtime pending and processing requests are resumed by GET and never create another Agent job', async () => {
  const h = await verified(); h.controller.setAttested(true); h.set(queued()); await h.controller.start();
  for (const status of ['pending', 'processing']) {
    h.set(queued(status)); await h.controller.refresh(); h.controller.setAttested(true);
    assert.equal(await h.controller.start(), false); assert.equal(await h.controller.apply(), false);
    assert.match(h.calls.at(-1).url, new RegExp('requestId=' + REQUEST));
  }
  assert.equal(posts(h).length, 1); assert.equal(h.controller.snapshot().view.request.status, 'processing');
  assert.equal(JSON.parse(h.saved.get(ui.KEY)).requestId, REQUEST);
  h.set(queued('processing')); await h.controller.refresh();
  assert.equal(h.controller.snapshot().phase, 'queued'); assert.equal(posts(h).length, 1);
});
test('FBHE 1A runtime completed fresh measurement waits for a separate explicit apply and stores only measured seconds', async () => {
  const h = await ready(); assert.equal(h.controller.snapshot().phase, 'ready');
  assert.equal(posts(h).length, 1);
  h.deps.api = async options => { h.calls.push(options);
    assert.deepEqual(options.body, { action: 'apply_fbhe1a_runtime', requestId: REQUEST,
      expectedProofHash: PROOF, confirmation: 'FBHE_1A_RUNTIME_20260904', attestation: attestation() });
    assert.ok(!Object.hasOwn(options.body, 'runtimeHours')); assert.ok(!Object.hasOwn(options.body, 'runningSeconds'));
    return complete({ eligible: false, applied: true, attestationRequired: false }); };
  assert.equal(await h.controller.apply(), true); assert.equal(posts(h).length, 2);
  assert.equal(h.controller.snapshot().view.preview.totalRunningSeconds, FRESH);
  assert.notEqual(FRESH, EXPECTED, 'fresh measurement deliberately differs from old counter minus excluded time');
  assert.equal(h.controller.snapshot().readbackVerified, true); assert.equal(h.reloads(), 1);
  assert.equal(await h.controller.apply(), false); assert.equal(posts(h).length, 2);
});
test('FBHE 1A runtime derives excluded overlap from raw last stop and old measured start instead of a constant forty', () => {
  assert.equal(ui.normalizeView(complete()).preview.excludedPreReplacementSeconds, EXCLUDED);
  const rawStop = DAY + 'T10:50:39.100+09:00', duration = Date.parse(rawStop) - Date.parse(OLD_START);
  const excluded = Math.round(duration / 1000); assert.notEqual(excluded, EXCLUDED);
  const second = complete({ witness: { id: WITNESS, status: 'complete', lastRunStoppedAt: rawStop,
    excludedPreReplacementSeconds: excluded, excludedDurationMilliseconds: duration,
    dailyRunningSeconds: 39040, zeroWindowEndAt: START },
    preview: { measuredRunningSeconds: OLD_SECONDS - excluded, previousRunningSeconds: OLD_SECONDS,
      excludedPreReplacementSeconds: excluded, expectedRunningSeconds: OLD_SECONDS - excluded,
      differenceSeconds: 0, toleranceSeconds: 2, appendedRunningSeconds: 0, totalRunningSeconds: OLD_SECONDS - excluded, observedAt: END } });
  const normalized = ui.normalizeView(second);
  assert.equal(normalized.preview.excludedPreReplacementSeconds, excluded);
  assert.equal(normalized.witness.lastRunStoppedAt, rawStop);
  assert.equal(normalized.measurementWindow.startAt, START);
  assert.equal(normalized.saved.startAt, OLD_START);
  assert.doesNotMatch(JSON.stringify(normalized), /firstRunAt|rawFirstRunAt|firstPostReplacementRunAt|actualStartedAt/);
});
test('FBHE 1A runtime invalid witness, asset, seam, diagnostic math and substituted totals never enable apply', () => {
  const invalid = [complete({ assetTag: '104HHL60AP621' }), complete({ completionDay: '2026-09-05' }),
    complete({ completionClockKnown: true }), complete({ proofHash: '' }),
    complete({ witness: { ...view().witness, lastRunStoppedAt: DAY + 'T10:39:00+09:00' } }),
    complete({ witness: { ...view().witness, status: 'failed' } }),
    complete({ witness: { ...view().witness, dailyRunningSeconds: 39041 } }),
    complete({ witness: { ...view().witness, zeroWindowEndAt: ORIGIN } }),
    complete({ saved: { ...view().saved, startAt: ORIGIN } }),
    complete({ measurementWindow: { startAt: OLD_START, endAt: END, chunkCount: 1 } }),
    complete({ preview: { ...complete().preview, totalRunningSeconds: EXPECTED } }),
    complete({ preview: { ...complete().preview, differenceSeconds: 0 } }),
    complete({ preview: { ...complete().preview, toleranceSeconds: 10001 } }),
    complete({ preview: { ...complete().preview, measuredRunningSeconds: FRESH - 3, totalRunningSeconds: FRESH - 3, differenceSeconds: -4 } }),
    complete({ quality: { sampleGoodCertified: true } }), complete({ quality: undefined }),
    complete({ attestationRequired: false }), complete({ attestationRequired: 'true' }),
    complete({ applied: true, attestationRequired: false }), complete({ applied: 'true' }),
    complete({ replayed: true }), complete({ eligible: false, applied: true, attestationRequired: true }),
    complete({ operatorReportedRestartDay: '2026-10-09' }),
    queued('pending', { code: 'FBHE1A_RUNTIME_REQUEST_EXPIRED' }),
    complete({ eligible: false, code: 'FBHE1A_RUNTIME_REQUEST_EXPIRED' }),
    queued('pending', { eligible: false, code: 'FBHE1A_RUNTIME_REQUEST_EXPIRED', preview: complete().preview })];
  for (const raw of invalid) assert.throws(() => ui.normalizeView(raw), /INVALID_RESPONSE/);
});
test('FBHE 1A runtime guard failures prevent preview, start and apply calls', async () => {
  for (const changes of [{ getAsset: () => ({ tagNumber: '104HHL60AP621' }) },
    { getAsset: () => ({ tagNumber: TAG, enabled: false }) }, { canWrite: () => false },
    { session: () => '' }, { isMobile: () => true }, { isBusy: () => true }]) {
    const h = harness(changes); assert.equal(await h.controller.refresh(), false);
    h.controller.setAttested(true); assert.equal(await h.controller.start(), false); assert.equal(await h.controller.apply(), false);
    assert.equal(h.calls.length, 0);
  }
});
test('FBHE 1A runtime session change during preview or before start cannot authorize a new query', async () => {
  let session = 'before'; const h = harness({ session: () => session });
  h.deps.api = async options => { h.calls.push(options); session = 'after'; return view(); };
  assert.equal(await h.controller.refresh(), false); h.controller.setAttested(true);
  assert.equal(await h.controller.start(), false); assert.equal(posts(h).length, 0);
  const second = await verified({ session: () => session }); second.controller.setAttested(true); session = 'another';
  assert.equal(await second.controller.start(), false); assert.equal(posts(second).length, 0);
});
test('FBHE 1A runtime storage write or verification failure stops before the start POST', async () => {
  for (const mode of ['write', 'readback']) {
    const map = new Map(); let fail = false;
    const storage = { getItem: key => fail && mode === 'readback' ? null : map.get(key) || null,
      setItem: (key, value) => { if (fail && mode === 'write') throw Error('blocked'); map.set(key, value); } };
    const h = await verified({ storage }); h.controller.setAttested(true); fail = true;
    assert.equal(await h.controller.start(), false); assert.equal(posts(h).length, 0);
  }
});
test('FBHE 1A runtime lost start response retains the nonce and resolves it with an explicit GET after reload', async () => {
  const h = await verified(); h.controller.setAttested(true); h.set(new Error('PRIVATE connection detail'));
  assert.equal(await h.controller.start(), false); assert.equal(posts(h).length, 1);
  const record = JSON.parse(h.saved.get(ui.KEY)); assert.equal(record.nonce, NONCE);
  assert.equal(record.requestId, ''); assert.equal(record.pending, true);
  const resumed = harness({ storage: h.deps.storage }); assert.equal(resumed.calls.length, 0);
  resumed.set(queued('processing')); assert.equal(await resumed.controller.refresh(), true);
  assert.match(resumed.calls[0].url, new RegExp('nonce=' + NONCE)); assert.equal(posts(resumed).length, 0);
  assert.equal(JSON.parse(h.saved.get(ui.KEY)).requestId, REQUEST);
  assert.equal(await resumed.controller.start(), false); assert.equal(posts(resumed).length, 0);
});
test('FBHE 1A verified expired pending or processing receipt renews only after same-ID GET and a separately checked new start', async () => {
  for (const status of ['pending', 'processing']) {
    let sequence = 0; const h = await verified({ nonce: () => NONCE + '-expired-' + status + '-' + (++sequence) });
    h.controller.setAttested(true); h.set(new Error('start response lost')); await h.controller.start();
    const first = JSON.parse(h.saved.get(ui.KEY)); assert.equal(first.requestId, '');
    const expired = queued(status, { eligible: false, code: 'FBHE1A_RUNTIME_REQUEST_EXPIRED', expired: true });
    h.set(expired); await h.controller.refresh();
    assert.match(h.calls.at(-1).url, new RegExp('nonce=' + first.nonce));
    assert.equal(h.controller.canRenew(), true); assert.equal(posts(h).length, 1);
    assert.equal(Object.hasOwn(h.controller.snapshot().view, 'expired'), false);
    const original = JSON.parse(h.saved.get(ui.KEY)), before = h.calls.length, freshProof = 'e'.repeat(64);
    h.deps.api = async options => {
      h.calls.push(options); assert.ok(!options.method || options.method === 'GET');
      if (/&requestId=/.test(options.url)) { assert.match(options.url, new RegExp('requestId=' + REQUEST)); return expired; }
      assert.match(options.url, new RegExp('witnessRequestId=' + WITNESS)); return view({ proofHash: freshProof });
    };
    assert.equal(await h.controller.renew(), true);
    const reads = h.calls.slice(before); assert.equal(reads.length, 2);
    assert.match(reads[0].url, /&requestId=/); assert.match(reads[1].url, /&witnessRequestId=/);
    assert.deepEqual(JSON.parse(h.saved.get(ui.HISTORY_KEY)), [original]);
    assert.equal(JSON.parse(h.saved.get(ui.KEY)), null); assert.equal(h.controller.snapshot().attested, false);
    assert.equal(posts(h).length, 1); assert.equal(await h.controller.start(), false); assert.equal(posts(h).length, 1);
    h.controller.setAttested(true);
    const nextId = 'e0000000-0000-4000-8000-000000000004';
    h.deps.api = async options => { h.calls.push(options);
      return queued('pending', { proofHash: freshProof, request: { id: nextId, status: 'pending' } }); };
    assert.equal(await h.controller.start(), true); assert.equal(posts(h).length, 2);
    assert.notEqual(posts(h).at(-1).body.nonce, original.nonce);
    assert.equal(posts(h).at(-1).body.expectedProofHash, freshProof);
    assert.equal(JSON.parse(h.saved.get(ui.HISTORY_KEY))[0].requestId, REQUEST);
  }
});
test('FBHE 1A expired receipt completed before renewal recheck keeps its original ID with no archive or extra query', async () => {
  const h = await verified(); h.controller.setAttested(true); h.set(new Error('start response lost')); await h.controller.start();
  h.set(queued('pending', { eligible: false, code: 'FBHE1A_RUNTIME_REQUEST_EXPIRED', expired: true }));
  await h.controller.refresh(); assert.equal(h.controller.canRenew(), true);
  const original = JSON.parse(h.saved.get(ui.KEY)), before = h.calls.length;
  h.set(complete()); assert.equal(await h.controller.renew(), false);
  const reads = h.calls.slice(before); assert.equal(reads.length, 1); assert.match(reads[0].url, new RegExp('requestId=' + REQUEST));
  assert.ok(!reads[0].method || reads[0].method === 'GET'); assert.equal(posts(h).length, 1);
  assert.equal(h.saved.has(ui.HISTORY_KEY), false);
  const current = JSON.parse(h.saved.get(ui.KEY)); assert.equal(current.requestId, REQUEST); assert.equal(current.nonce, original.nonce);
  assert.equal(h.controller.snapshot().phase, 'ready'); assert.equal(h.controller.snapshot().attested, false);
  assert.equal(h.controller.canRenew(), false); assert.equal(h.controller.snapshot().view.request.status, 'complete');
});
test('FBHE 1A runtime uncertain nonce cannot renew after network failure, wrong 404 code or wrong HTTP status', async () => {
  const h = await verified(); h.controller.setAttested(true); h.set(new Error('start response lost'));
  await h.controller.start(); const original = JSON.parse(h.saved.get(ui.KEY));
  for (const error of [new Error('network unavailable'),
    Object.assign(new Error('wrong code'), { status: 404, code: 'OTHER_NOT_FOUND' }),
    Object.assign(new Error('wrong status'), { status: 500, code: 'FBHE1A_RUNTIME_REQUEST_NOT_FOUND' })]) {
    h.set(error); assert.equal(await h.controller.refresh(), false);
    assert.equal(h.controller.snapshot().nonceMissing, false); assert.equal(h.controller.canRenew(), false);
    assert.equal(await h.controller.renew(), false); assert.equal(posts(h).length, 1);
    assert.equal(JSON.parse(h.saved.get(ui.KEY)).nonce, original.nonce);
    assert.equal(h.saved.has(ui.HISTORY_KEY), false);
  }
});
test('FBHE 1A runtime definitive missing nonce renews through two explicit GETs and archives before a separately checked new start', async () => {
  let sequence = 0; const h = await verified({ nonce: () => NONCE + '-missing-' + (++sequence) });
  h.controller.setAttested(true); h.set(new Error('start rejected or response lost')); await h.controller.start();
  const original = JSON.parse(h.saved.get(ui.KEY));
  const missing = () => Object.assign(new Error('safe missing code'), { status: 404, code: 'FBHE1A_RUNTIME_REQUEST_NOT_FOUND' });
  h.set(missing()); await h.controller.refresh();
  assert.equal(h.controller.snapshot().nonceMissing, true); assert.equal(h.controller.canRenew(), true);
  assert.equal(await h.controller.start(), false); assert.equal(posts(h).length, 1);
  const before = h.calls.length, freshProof = 'c'.repeat(64);
  h.deps.api = async options => {
    h.calls.push(options); assert.ok(!options.method || options.method === 'GET');
    if (/&nonce=/.test(options.url)) throw missing();
    assert.match(options.url, new RegExp('witnessRequestId=' + WITNESS)); return view({ proofHash: freshProof });
  };
  assert.equal(await h.controller.renew(), true);
  const renewal = h.calls.slice(before); assert.equal(renewal.length, 2);
  assert.match(renewal[0].url, new RegExp('nonce=' + original.nonce));
  assert.match(renewal[1].url, new RegExp('witnessRequestId=' + WITNESS));
  assert.equal(posts(h).length, 1); assert.deepEqual(JSON.parse(h.saved.get(ui.HISTORY_KEY)), [original]);
  assert.equal(JSON.parse(h.saved.get(ui.KEY)), null); assert.equal(h.controller.snapshot().phase, 'verified');
  assert.equal(h.controller.snapshot().nonceMissing, false); assert.equal(h.controller.snapshot().attested, false);
  assert.equal(await h.controller.start(), false); assert.equal(posts(h).length, 1);
  h.controller.setAttested(true);
  h.deps.api = async options => { h.calls.push(options); return queued('pending', { proofHash: freshProof }); };
  assert.equal(await h.controller.start(), true); assert.equal(posts(h).length, 2);
  assert.notEqual(posts(h).at(-1).body.nonce, original.nonce);
  assert.equal(posts(h).at(-1).body.expectedProofHash, freshProof);
  assert.equal(JSON.parse(h.saved.get(ui.HISTORY_KEY))[0].nonce, original.nonce);
});
test('FBHE 1A runtime renewal recheck finding an accepted pending request retains its ID and stops archive and new query', async () => {
  const h = await verified(); h.controller.setAttested(true); h.set(new Error('response lost')); await h.controller.start();
  const original = JSON.parse(h.saved.get(ui.KEY));
  h.set(Object.assign(new Error('temporarily not found'), { status: 404, code: 'FBHE1A_RUNTIME_REQUEST_NOT_FOUND' }));
  await h.controller.refresh(); assert.equal(h.controller.canRenew(), true);
  const before = h.calls.length; h.set(queued('pending'));
  await h.controller.renew();
  const after = h.calls.slice(before); assert.equal(after.length, 1); assert.match(after[0].url, /&nonce=/);
  const current = JSON.parse(h.saved.get(ui.KEY)); assert.equal(current.nonce, original.nonce); assert.equal(current.requestId, REQUEST);
  assert.equal(h.saved.has(ui.HISTORY_KEY), false); assert.equal(posts(h).length, 1);
  assert.equal(h.controller.snapshot().phase, 'queued'); assert.equal(h.controller.snapshot().nonceMissing, false);
  assert.equal(h.controller.canRenew(), false); assert.equal(await h.controller.start(), false); assert.equal(posts(h).length, 1);
});
test('FBHE 1A runtime source or counter conflict retains the same request and never renews automatically', async () => {
  const h = await ready(); const before = JSON.parse(h.saved.get(ui.KEY));
  h.set(complete({ eligible: false, code: 'FBHE1A_RUNTIME_CURRENT_PROOF_CHANGED' }));
  await h.controller.refresh(); h.controller.setAttested(true);
  assert.equal(await h.controller.apply(), false); assert.equal(await h.controller.start(), false);
  assert.equal(posts(h).length, 1); const after = JSON.parse(h.saved.get(ui.KEY));
  assert.equal(after.requestId, before.requestId); assert.equal(after.nonce, before.nonce);
});
test('FBHE 1A runtime uncertain apply reconciles the original request by GET without another mutation', async () => {
  const h = await ready(); h.set(new Error('PRIVATE raw SQL'));
  assert.equal(await h.controller.apply(), false); assert.equal(posts(h).length, 2);
  h.set(complete({ applied: true, replayed: true, eligible: false, attestationRequired: false }));
  await h.controller.refresh(); assert.equal(posts(h).length, 2);
  assert.match(h.calls.at(-1).url, new RegExp('requestId=' + REQUEST));
  assert.equal(h.controller.snapshot().readbackVerified, true); assert.equal(h.controller.snapshot().phase, 'applied');
  assert.doesNotMatch(JSON.stringify(h.controller.snapshot()), /PRIVATE|raw SQL/);
});
test('FBHE 1A runtime 409 has a safe visible status and never retries start or apply automatically', async () => {
  const h = await ready(); h.set(Object.assign(new Error('PRIVATE_TOKEN and SQL'), { status: 409, code: 'FBHE1A_RUNTIME_CONFLICT' }));
  assert.equal(await h.controller.apply(), false); assert.equal(posts(h).length, 2); assert.ok(h.controller.snapshot().error);
  assert.doesNotMatch(JSON.stringify(h.controller.snapshot()), /PRIVATE_TOKEN|and SQL/);
});
test('FBHE 1A runtime successful response still needs strict current readback before displaying completion', async () => {
  const h = await ready({ reload: async () => false }); h.set(complete({ eligible: false, applied: true, attestationRequired: false }));
  await h.controller.apply(); assert.equal(h.controller.snapshot().readbackVerified, false);
  assert.equal(h.controller.snapshot().error, 'READBACK_UNCONFIRMED');
  await h.controller.refresh(); assert.equal(posts(h).length, 2);
});
test('FBHE 1A runtime normalizer excludes arbitrary source text, token strings and non-enum code values', () => {
  const normalized = ui.normalizeView(complete({ message: '<img onerror=PRIVATE_TOKEN>',
    code: 'FBHE1A_RUNTIME_PRIVATE_TOKEN', operatorId: 'PRIVATE_OPERATOR',
    firstRunAt: '2026-10-08T00:00:00+09:00', actualStartedAt: '2026-10-08T00:00:00+09:00',
    request: { id: REQUEST, status: 'complete', rawSql: 'SELECT PRIVATE' } }));
  assert.doesNotMatch(JSON.stringify(normalized), /PRIVATE|onerror|SELECT/);
  assert.doesNotMatch(JSON.stringify(normalized), /firstRunAt|actualStartedAt/);
});
test('FBHE 1A runtime readback and shared proof accept measured descendants while preserving an unknown completion clock', () => {
  for (const delta of [0, 10]) {
    const asset = recoveredAsset(delta);
    assert.equal(refresh.verifiedFbhe1aRuntime(asset)?.freshRequestId, REQUEST);
    assert.equal(ui.verifyReadback(asset, complete()), true);
    assert.equal(asset.runtimeCoverageEvidence.wholeCycleVerified, false);
    assert.equal(asset.runtimeCoverageEvidence.cycleBasisConfirmed, false);
    assert.equal(asset.actualLastReplacementAt, '');
    assert.equal(asset.cycleStartState, 'legacy'); assert.equal(asset.cycleStartedAt, ORIGIN);
    assert.doesNotMatch(JSON.stringify(asset.fbhe1aRuntimeProof), /firstRunAt|rawFirstRunAt|firstPostReplacementRunAt|actualStartedAt/);
    const emptyDerived = structuredClone(asset); emptyDerived.cycleStartedAt = ''; emptyDerived.cycleStoredStartedAt = null;
    assert.equal(refresh.verifiedFbhe1aRuntime(emptyDerived)?.freshRequestId, REQUEST);
  }
  for (const mutate of [a => { a.dataParcRuntimeBasis.fbhe1aRuntime.freshRequestId = 'wrong'; },
    a => { a.runtimeCoverageEvidence.fbhe1aRuntime.lastRunStoppedAt = DAY + 'T10:39:00+09:00'; },
    a => { a.fbhe1aRuntimeProof.completionClockKnown = true; },
    a => { a.cycleSourceReview = { code: 'SOURCE_CHANGED' }; },
    a => { a.dataParcRuntimeBasis.runningSeconds = EXPECTED; },
    a => { a.actualLastReplacementAt = STOP; },
    a => { a.cycleStoredStartedAt = START; }, a => { a.cycleStartState = 'pending'; },
    a => { a.cycleStartedAt = REPORTED_RESTART_DAY + 'T00:00:00+09:00'; },
    a => {
      const inventedStart = REPORTED_RESTART_DAY + 'T00:00:00+09:00';
      a.dataParcRuntimeBasis.startAt = inventedStart; a.runtimeCoverageEvidence.startAt = inventedStart;
      for (const owner of [a.fbhe1aRuntimeProof, a.dataParcRuntimeBasis.fbhe1aRuntime, a.runtimeCoverageEvidence.fbhe1aRuntime])
        owner.measuredStartAt = inventedStart;
    },
    a => { a.runRuntime.source = 'manual'; }]) {
    const asset = recoveredAsset(10); mutate(asset);
    assert.equal(refresh.verifiedFbhe1aRuntime(asset), null); assert.equal(ui.verifyReadback(asset, complete()), false);
  }
});
test('FBHE 1A runtime applied replay preview retains original comparison and adds only verified appended seconds', () => {
  const replay = complete({ applied: true, replayed: true, eligible: false, attestationRequired: false,
    preview: { ...complete().preview, appendedRunningSeconds: 10, totalRunningSeconds: FRESH + 10,
      observedAt: new Date(Date.parse(END) + 10000).toISOString() } });
  const normalized = ui.normalizeView(replay);
  assert.equal(normalized.preview.measuredRunningSeconds, FRESH);
  assert.equal(normalized.preview.previousRunningSeconds, OLD_SECONDS);
  assert.equal(normalized.preview.appendedRunningSeconds, 10);
  assert.equal(normalized.preview.totalRunningSeconds, FRESH + 10);
  assert.equal(ui.verifyReadback(recoveredAsset(10), normalized), true);
});
test('FBHE 1A runtime completed measurement mismatch or invalidity retains its only receipt until the baseline changes', async () => {
  for (const suffix of ['MEASUREMENT_MISMATCH', 'MEASUREMENT_INVALID']) {
    const h = await ready(), current = complete({ eligible: false, code: 'FBHE1A_RUNTIME_' + suffix });
    if (suffix === 'MEASUREMENT_MISMATCH') current.preview = { ...current.preview,
      measuredRunningSeconds: EXPECTED - 5, totalRunningSeconds: EXPECTED - 5, differenceSeconds: -5 };
    else delete current.preview;
    h.set(current); await h.controller.refresh();
    const original = h.saved.get(ui.KEY), count = h.calls.length;
    assert.equal(h.controller.canRenew(), false, suffix);
    assert.equal(await h.controller.renew(), false, suffix);
    assert.equal(h.calls.length, count, 'no fresh preview or query on the same completed baseline');
    assert.equal(h.saved.get(ui.KEY), original); assert.equal(h.saved.has(ui.HISTORY_KEY), false);
    assert.equal(h.controller.snapshot().view.request.id, REQUEST);
    if (suffix === 'MEASUREMENT_MISMATCH') assert.equal(h.controller.snapshot().view.preview.differenceSeconds, -5);
    assert.equal(posts(h).length, 1, 'the original explicit measurement is the only POST');
    h.set(complete({ eligible: false, code: 'FBHE1A_RUNTIME_BASELINE_CHANGED' }));
    await h.controller.refresh();
    assert.equal(h.controller.canRenew(), true, 'a later confirmed baseline change permits explicit fresh preparation');
  }
  const failed = await ready(); failed.set(queued('failed')); await failed.controller.refresh();
  assert.equal(failed.controller.canRenew(), true, 'a failed measurement can still be explicitly prepared again');
});
test('FBHE 1A runtime explicit renewal archives the original record and does only GET until another checked start', async () => {
  let sequence = 0; const h = await ready({ nonce: () => NONCE + '-' + (++sequence) });
  h.set(complete({ eligible: false, code: 'FBHE1A_RUNTIME_CURRENT_PROOF_CHANGED' })); await h.controller.refresh();
  const original = JSON.parse(h.saved.get(ui.KEY)), count = h.calls.length;
  assert.equal(h.controller.canRenew(), true);
  h.set(view({ proofHash: 'b'.repeat(64) })); assert.equal(await h.controller.renew(), true);
  assert.equal(h.calls.length, count + 1); assert.ok(!h.calls.at(-1).method || h.calls.at(-1).method === 'GET');
  assert.match(h.calls.at(-1).url, new RegExp('witnessRequestId=' + WITNESS));
  assert.equal(posts(h).length, 1); assert.equal(h.controller.snapshot().phase, 'verified');
  assert.equal(h.controller.snapshot().attested, false);
  assert.deepEqual(JSON.parse(h.saved.get(ui.HISTORY_KEY)), [original]);
  assert.equal(JSON.parse(h.saved.get(ui.KEY)), null);
  assert.equal(await h.controller.start(), false); assert.equal(posts(h).length, 1);
  h.controller.setAttested(true);
  const nextId = 'b0000000-0000-4000-8000-000000000004';
  h.set(queued('pending', { proofHash: 'b'.repeat(64), request: { id: nextId, status: 'pending' } }));
  assert.equal(await h.controller.start(), true); assert.equal(posts(h).length, 2);
  assert.notEqual(posts(h).at(-1).body.nonce, original.nonce);
  assert.equal(posts(h).at(-1).body.expectedProofHash, 'b'.repeat(64));
  assert.equal(JSON.parse(h.saved.get(ui.HISTORY_KEY))[0].requestId, original.requestId);
});
test('FBHE 1A runtime renewal archive failures or a full archive preserve the original ID and never POST', async () => {
  for (const mode of ['archive_write', 'archive_readback', 'primary_write', 'full']) {
    const map = new Map(); let failing = false, wroteArchive = false;
    const storage = {
      getItem: key => failing && mode === 'archive_readback' && wroteArchive && key === ui.HISTORY_KEY ? null : map.get(key) || null,
      setItem: (key, value) => {
        if (failing && (mode === 'archive_write' && key === ui.HISTORY_KEY || mode === 'primary_write' && key === ui.KEY && value === 'null'))
          throw Error('storage blocked');
        map.set(key, value); if (key === ui.HISTORY_KEY) wroteArchive = true;
      }
    };
    const h = await ready({ storage }); h.set(complete({ eligible: false, code: 'FBHE1A_RUNTIME_CURRENT_PROOF_CHANGED' }));
    await h.controller.refresh(); const original = JSON.parse(map.get(ui.KEY));
    if (mode === 'full') map.set(ui.HISTORY_KEY, JSON.stringify(Array.from({ length: 10 }, (_, index) => ({ ...original,
      nonce: 'archived-nonce-' + index, requestId: 'archived-request-' + index }))));
    h.set(view({ proofHash: 'b'.repeat(64) })); failing = true;
    assert.equal(await h.controller.renew(), false, mode); assert.equal(posts(h).length, 1, mode);
    assert.equal(JSON.parse(map.get(ui.KEY)).requestId, original.requestId, mode);
    if (mode === 'full') {
      assert.equal(JSON.parse(map.get(ui.HISTORY_KEY)).length, 10); assert.equal(h.controller.snapshot().error, 'ARCHIVE_FULL');
    }
  }
});
test('FBHE 1A runtime renewal retries a partial primary-clear failure without duplicating its already archived record', async () => {
  const map = new Map(); let failClear = false;
  const storage = { getItem: key => map.get(key) || null,
    setItem: (key, value) => {
      if (failClear && key === ui.KEY && value === 'null') throw Error('primary clear blocked');
      map.set(key, value);
    } };
  const h = await ready({ storage }); h.set(complete({ eligible: false, code: 'FBHE1A_RUNTIME_CURRENT_PROOF_CHANGED' }));
  await h.controller.refresh(); const original = JSON.parse(map.get(ui.KEY));
  const existing = Array.from({ length: 9 }, (_, index) => ({ ...original,
    nonce: 'previous-nonce-' + index, requestId: 'previous-request-' + index }));
  map.set(ui.HISTORY_KEY, JSON.stringify(existing));
  h.set(view({ proofHash: 'd'.repeat(64) })); failClear = true;
  assert.equal(await h.controller.renew(), false); assert.equal(posts(h).length, 1);
  const archived = map.get(ui.HISTORY_KEY); assert.equal(JSON.parse(archived).length, 10);
  assert.deepEqual(JSON.parse(archived).at(-1), original);
  assert.equal(JSON.parse(map.get(ui.KEY)).requestId, original.requestId);
  assert.equal(h.controller.canRenew(), true);
  failClear = false; assert.equal(await h.controller.renew(), true);
  assert.equal(map.get(ui.HISTORY_KEY), archived, 'retry keeps the same ten IDs and consumes no extra archive slot');
  assert.equal(JSON.parse(map.get(ui.KEY)), null); assert.equal(posts(h).length, 1);
  assert.equal(h.controller.snapshot().phase, 'verified'); assert.equal(h.controller.snapshot().attested, false);
});
test('FBHE 1A runtime mounted panel separates unchecked query and apply, showing fresh values without IDs or raw text', async () => {
  function element(tag) { return { tag, children: [], handlers: {}, hidden: false, disabled: false, textContent: '', checked: false,
    appendChild(child) { this.children.push(child); }, replaceChildren() { this.children = []; },
    setAttribute() {}, addEventListener(name, fn) { this.handlers[name] = fn; } }; }
  const container = element('div'), h = harness({ session: () => 'fbhe1a-mounted-session' });
  h.set(view({ code: 'LIME1B_PRIVATE_TOKEN', message: '<img onerror=PRIVATE_TOKEN>' }));
  const controller = ui.mount({ ...h.deps, document: { createElement: element }, container,
    asset: { tagNumber: TAG, enabled: true } });
  const descendants = root => [root, ...root.children.flatMap(descendants)];
  const all = descendants(container), checkbox = all.find(e => e.tag === 'input' && e.type === 'checkbox');
  const start = all.find(e => e.tag === 'button' && e.textContent === '교체 후 RUN 다시 측정');
  const apply = all.find(e => e.tag === 'button' && e.className === 'button primary');
  const check = all.find(e => e.tag === 'button' && /기존 RUN 근거 확인/.test(e.textContent));
  const text = () => descendants(container).map(e => e.textContent).join(' ');
  assert.equal(h.calls.length, 0); assert.equal(checkbox.checked, false); assert.equal(all.filter(e => e.tag === 'input').length, 1);
  await controller.refresh(); assert.equal(start.disabled, true); assert.equal(apply.hidden, true);
  assert.match(text(), /10:50:39/); assert.match(text(), /완료시각.*미기록/);
  assert.doesNotMatch(text(), /09:50:26|최초 기동시각/);
  assert.doesNotMatch(text(), /PRIVATE|onerror|b0000000-0000|fbhe1a-mounted-session/);
  checkbox.checked = true; checkbox.handlers.change(); assert.equal(start.disabled, false);
  h.set(queued()); start.handlers.click(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(posts(h).length, 1); assert.equal(start.hidden, true); assert.equal(apply.hidden, true);
  h.set(complete()); check.handlers.click(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(checkbox.checked, false); assert.equal(apply.hidden, false); assert.equal(apply.disabled, true);
  assert.ok(text().includes(FRESH.toLocaleString('ko-KR') + '초'));
  assert.ok(text().includes(EXPECTED.toLocaleString('ko-KR') + '초')); assert.match(text(), /비교용/);
  const mismatch = complete({ eligible: false, code: 'FBHE1A_RUNTIME_MEASUREMENT_MISMATCH', preview: {
    ...complete().preview, measuredRunningSeconds: EXPECTED - 5, totalRunningSeconds: EXPECTED - 5, differenceSeconds: -5 } });
  assert.equal(ui.normalizeView(mismatch).preview.differenceSeconds, -5, 'a valid read-only diagnostic can exceed the admission bound');
  assert.throws(() => ui.normalizeView({ ...mismatch, applied: true }), /INVALID_RESPONSE/);
  h.set(mismatch); check.handlers.click(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(apply.hidden, true); assert.equal(controller.snapshot().phase, 'unavailable');
  assert.match(text(), /차이 -5초/); assert.match(text(), /허용범위 2초/); assert.match(text(), /MEASUREMENT_MISMATCH/);
  controller.setAttested(true); assert.equal(await controller.apply(), false); assert.equal(posts(h).length, 1);
  h.set(complete()); check.handlers.click(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(checkbox.checked, false); assert.equal(apply.disabled, true);
  checkbox.checked = true; checkbox.handlers.change(); h.set(complete({ eligible: false, applied: true, attestationRequired: false }));
  apply.handlers.click(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(posts(h).length, 2); assert.equal(controller.snapshot().readbackVerified, true); assert.equal(apply.hidden, true);
  assert.equal(ui.mount({ container: {}, asset: { tagNumber: '104HHL60AP621' }, canWrite: () => true,
    isMobile: () => false }), null);
});
test('actual main FBHE 1A date and overview adapter certify only verified measured totals on LF and CRLF', () => {
  const assessor = require('../maintenance/blower-runtime-assessment.js');
  for (const [name, source] of historyVariants()) {
    const window = { BlowerUnifiedRefresh: { ...refresh, runtimeRecoveryPlan: () => null }, BlowerRuntimeAssessment: assessor };
    const state = { data: { generatedAt: END } };
    const coverage = new Function('window', 'getLatestDataParcRuntimeBasis', 'state', 'currentServerDate',
      section(source, '  function commonRunCoverage(asset)', '\n  function commonRunCoverageNotice(', name + ' coverage') +
      '\nreturn commonRunCoverage;')(window, () => null, state, () => new Date(END));
    const compact = section(source, '  function compactRunCoverageStatus(', '\n  // The overview shares', name + ' compact');
    const manual = section(source, '  function overviewManualTimestamp(', '\n  function allOverviewRuntimeAssessment(', name + ' manual');
    const adapter = new Function('window', 'commonRunCoverage', 'allOverviewOperation', 'isLimestoneDisputedAsset',
      'hasAuthenticatedWriteAccess', 'isMobileMonitoringView', 'state', 'isDataParcRuntimeAsset',
      'verifiedLimestoneRunDisplay', 'allOverviewQueryStats', compact + manual +
      section(source, '  function allOverviewRuntimeAssessment(', '\n  function overviewSeparateRunObservedAt(', name + ' assessment') +
      '\nreturn allOverviewRuntimeAssessment;')(window, coverage, () => ({}), () => false, () => false, () => false,
      state, () => true, () => null, () => ({ latest: { observedAt: END } }));
    const asset = recoveredAsset(10);
    asset.replacementAutoCycle = { schemaVersion: 3, normalizationVersion: 4, registeredRuntimeRange: true, clockKnown: false };
    assert.equal(coverage(asset), null, name);
    const result = adapter(asset, { basis: asset.dataParcRuntimeBasis, state: 'running' }, END);
    assert.equal(result.requiresReview, false, name); assert.equal(result.durationEquivalent, true, name);
    assert.equal(result.wholeCycleVerified, false, name); assert.equal(result.scope, 'cycle-equivalent', name);
    assert.equal(result.hours, (FRESH + 10) / 3600, name);
    const bad = structuredClone(asset); bad.runtimeCoverageEvidence.fbhe1aRuntime.witnessRequestId = 'wrong';
    assert.ok(coverage(bad), name); assert.equal(adapter(bad, { basis: bad.dataParcRuntimeBasis, state: 'running' }, END).requiresReview, true, name);
    const other = structuredClone(asset); other.tagNumber = '104HHL60AP621';
    assert.equal(adapter(other, { basis: other.dataParcRuntimeBasis, state: 'running' }, END).requiresReview, true, name);
    const date = value => new Date(Date.parse(value) + 9 * 3600000).toISOString().slice(0, 10);
    const dates = new Function('window', 'isInitialStartupBasis', 'formatDate', 'formatKstDateTimeDisplay',
      section(source, '  function cycleReferenceLabel(', '\n  function initialStartupEvidence(', name + ' date') +
      '\nreturn { label: cycleReferenceLabel, display: cycleReferenceDisplay };')(window, () => false, date, value => value);
    assert.equal(dates.label(asset), '교체일', name); assert.equal(dates.display(asset), DAY, name);
    const card = new Function('window', 'isInitialStartupBasis', 'formatKstDateTimeDisplay', 'overviewManualTimestamp', 'blowerResolutionGuide',
      section(source, '  function renderRuntimeAssessmentOverviewCard(', '\n    const separateRunAt =', name + ' card note') +
      '\nreturn { referenceLabel, referenceValue, note };\n}\nreturn renderRuntimeAssessmentOverviewCard;')(
      window, () => false, value => value, () => '', () => null);
    const shown = card(asset, { assessment: result, replacement: dates.display(asset), transition: null, maintenance: '', partialCoverage: null });
    assert.equal(shown.referenceValue, DAY, name); assert.match(shown.note, /완료시각 미기록.*RUN 재측정/, name);
    assert.doesNotMatch(JSON.stringify(shown), /10:50:39|00:00|2026-10-08|최초 기동/, name);
  }
});
test('actual main FBHE 1A numeric correction is blocked while new belt and ordinary state actions stay available on LF and CRLF', async () => {
  for (const [name, source] of historyVariants()) {
    const elements = { historyRuntimeCorrectionButton: {} };
    const correction = new Function('asset', 'elements', 'hasAuthenticatedWriteAccess', 'awaitingBackfill', 'startupPending',
      section(source, '    if (elements.historyRuntimeCorrectionButton) {', '\n    elements.assetHistoryList.innerHTML', name + ' correction'));
    const current = recoveredAsset(), other = { ...current, tagNumber: '104HHL60AP621' }, later = { ...current, cycleStartRevision: 'new-belt' };
    for (const [asset, hidden] of [[current, true], [other, false], [later, false]]) {
      correction(asset, elements, () => true, false, false);
      assert.equal(elements.historyRuntimeCorrectionButton.hidden, hidden, name);
      assert.equal(elements.historyRuntimeCorrectionButton.disabled, hidden, name);
    }
    let selected = current, notices = [];
    const open = new Function('stopMobileMutation', 'findAsset', 'elements', 'showToast',
      section(source, '  function openRecordDialog(', '\n    resetRecordDialogVisibility();', name + ' dialog guard') +
      '\nreturn true;\n}\nreturn openRecordDialog;')(() => false, () => selected, { recordDialog: {} }, message => notices.push(message));
    assert.equal(open('runtime', TAG), undefined, name); assert.equal(notices.length, 1, name);
    assert.equal(open('replacement', TAG), true, name); assert.equal(open('runtime_state', TAG), true, name);
    assert.equal(open('problem', TAG), true, name); selected = other; assert.equal(open('runtime', other.tagNumber), true, name);
    selected = later; assert.equal(open('runtime', TAG), true, name); selected = current;
    const toggle = new Function('stopMobileMutation', 'state', 'findAsset', 'showToast', 'currentServerDate',
      section(source, '  async function toggleAssetOperation(', '\n    setBusy(true);', name + ' operation body') +
      '\nreturn body;\n}\nreturn toggleAssetOperation;')(() => false, {}, () => selected,
      () => { throw Error('unexpected toast'); }, () => new Date(END));
    const body = await toggle(TAG); assert.equal(body.action, 'runtime_state', name);
    assert.equal(body.expectedCycleRuntimeRevision, current.cycleRuntimeRevision, name);
    assert.equal(body.eventDate, new Date(END).toISOString(), name);
    assert.notEqual(body.eventDate, REPORTED_RESTART_DAY + 'T00:00:00+09:00', name);
  }
});
test('actual main FBHE 1A certificate and five existing boundaries stay protected while problem notes remain editable on LF and CRLF', () => {
  for (const [name, source] of historyVariants()) {
    const helpers = new Function('hasAuthenticatedWriteAccess', 'isMobileMonitoringView', 'isInitialStartupBasis',
      section(source, '  function canEditAnyHistoryEvent(', '\n  async function openHistoryDeleteDialog(', name + ' history guards') +
      '\nreturn { edit: canEditAnyHistoryEvent, remove: canDeleteManualHistoryEvent };')(() => true, () => false, () => false);
    const asset = recoveredAsset(), event = type => ({ id: 'event', tagNumber: TAG, eventType: type, sourceType: 'manual', updatedAt: END });
    for (const type of ['replacement', 'startup', 'operation_start', 'operation_stop', 'runtime_correction']) {
      assert.equal(helpers.edit(asset, event(type)), false, name); assert.equal(helpers.remove(asset, event(type)), false, name);
    }
    assert.equal(helpers.edit(asset, event('problem')), true, name); assert.equal(helpers.remove(asset, event('problem')), true, name);
    const later = { ...asset, cycleStartRevision: 'new-belt' };
    for (const certificate of [{ ...event('problem'), sourceType: 'dataparc_fbhe1a_runtime_v1' },
      { ...event('problem'), id: 'dataparc_fbhe1a_runtime:' + REQUEST }]) {
      assert.equal(helpers.edit(later, certificate), false, name); assert.equal(helpers.remove(later, certificate), false, name);
    }
    const other = { ...asset, tagNumber: '104HHL60AP621' };
    assert.equal(helpers.edit(other, { ...event('runtime_correction'), tagNumber: other.tagNumber }), true, name);
    const lock = new Function('asset', 'elements', section(source, '    elements.historyEventEditType.disabled =',
      '\n    elements.historyEventEditType.title =', name + ' type lock'));
    const elements = { historyEventEditType: {} }; lock(asset, elements); assert.equal(elements.historyEventEditType.disabled, true, name);
    lock(other, elements); assert.equal(elements.historyEventEditType.disabled, false, name);
    lock(later, elements); assert.equal(elements.historyEventEditType.disabled, false, name);
  }
});
test('actual main FBHE 1A mount verifies the same fresh receipt and append descendants through read-only reload on LF and CRLF', async () => {
  for (const [name, source] of historyVariants()) {
    let options, current = recoveredAsset(10); const reads = [], state = { data: { permissions: { canAdmin: true } } };
    const window = { BlowerFbhe1aRuntime: { mount: value => { options = value; }, verifyReadback: ui.verifyReadback },
      sessionStorage: { getItem: () => null, setItem() {} }, crypto: { randomUUID: () => NONCE } };
    new Function('window', 'elements', 'asset', 'document', 'findAsset', 'tagNumber', 'hasAuthenticatedWriteAccess',
      'state', 'isMobileMonitoringView', 'getSessionToken', 'setBusy', 'apiRequest', 'loadData',
      section(source, '    window.BlowerFbhe1aRuntime?.mount({', '\n    elements.historyDialog.showModal();', name + ' mount'))(
      window, { historyCycleSummary: {} }, current, {}, () => current, TAG, () => true, state, () => false,
      () => 'fixture-session', () => {}, () => { throw Error('no query or mutation permitted'); }, async value => reads.push(value));
    assert.equal(options.canWrite(), true, name); state.data.permissions.canAdmin = false; assert.equal(options.canWrite(), false, name);
    assert.equal(await options.reload(ui.normalizeView(complete({ eligible: false, applied: true, attestationRequired: false }))), true, name);
    assert.deepEqual(reads, [{ silent: true, syncOperations: false, strict: true }]);
    current.runtimeCoverageEvidence.fbhe1aRuntime.witnessRequestId = 'unrelated-witness';
    assert.equal(await options.reload(ui.normalizeView(complete({ eligible: false, applied: true, attestationRequired: false }))), false, name);
  }
});
