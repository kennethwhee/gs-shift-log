'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ui = require('../maintenance/blower-fbhe1b-standby-v1.js');
const refresh = require('../maintenance/blower-unified-refresh.js');
const TAG = '104HHL60AP621', DAY = '2026-10-08';
const ORIGIN = '2026-10-08T00:00:00+09:00', SEAM = '2026-10-09T00:00:00+09:00';
const STOP = '2026-10-08T13:14:47.450+09:00', END = '2026-11-11T20:48:00+09:00';
const SIGNAL = 'GSPOGE.ABB_DCS.104HHL60AP621XB04';
const PROOF = 'a'.repeat(64), REQUEST = 'c0000000-0000-4000-8000-000000000001';
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
    completionDay: DAY, completionClockKnown: false, request: { id: REQUEST, status: 'complete' },
    witness: { lastRunStoppedAt: STOP, dailyRunningSeconds: 47687, zeroWindowEndAt: SEAM },
    tail: { startAt: SEAM, observedAt: END, runningSeconds: 0 },
    preview: { prefixRunningSeconds: 0, tailRunningSeconds: 0, totalRunningSeconds: 0, observedAt: END },
    quality: { sampleGoodCertified: false }, attestationRequired: true, applied: false, replayed: false, ...patch };
}
function attestation(stop = STOP) {
  return { version: 1, completionDay: DAY, lastRunStoppedAt: stop,
    replacementCompletedAfterStop: true, noRestartAfterReplacement: true,
    statementCode: 'BELT_COMPLETED_AFTER_LAST_STOP_AND_REMAINED_STANDBY' };
}
function harness(changes = {}) {
  const saved = new Map(), calls = [], locks = []; let next = view(), reloads = 0;
  const asset = { tagNumber: TAG, enabled: true, cycleRuntimeRevision: 'original-runtime-revision',
    cycleStartRevision: 'original-start-revision', cycleRuntimeHours: 0 };
  const deps = { getAsset: () => asset, canWrite: () => true, isMobile: () => false,
    session: () => 'standby-session-never-stored', isBusy: () => false,
    setBusy: value => locks.push(value),
    storage: { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value) },
    api: async options => { calls.push(options); if (next instanceof Error) throw next; return next; },
    reload: async () => { reloads++; return true; }, ...changes };
  return { controller: ui.createController(deps), deps, asset, saved, calls, locks,
    set: value => { next = value; }, reloads: () => reloads };
}
async function ready(changes) { const h = harness(changes); await h.controller.refresh(); return h; }
const posts = h => h.calls.filter(call => call.method === 'POST');
function recoveredAsset(delta = 0) {
  const observedAt = new Date(Date.parse(END) + delta * 1000).toISOString();
  const revision = delta ? 'later-runtime-revision' : 'original-runtime-revision';
  const state = delta ? 'running' : 'stopped';
  const metadata = { version: 1, certificateId: 'fbhe1b_standby:' + REQUEST,
    auditId: 'fbhe1b_standby_audit:' + REQUEST, r9RequestId: REQUEST, proofHash: PROOF,
    sourceProofHash: 'b'.repeat(64), cycleStartRevision: 'original-start-revision',
    currentRuntimeRevision: revision, currentRunningSeconds: delta, currentState: state,
    currentAnchorAt: observedAt, currentObservedAt: observedAt, completionDay: DAY,
    lastRunStoppedAt: STOP, zeroWindowEndAt: SEAM, measuredStartAt: SEAM,
    completionClockKnown: false, durationEquivalent: true, originalTailRunningSeconds: 0,
    replacementCompletedAfterStop: true, noRestartAfterReplacement: true, sampleGoodCertified: false };
  const basis = { composite: true, appendReady: true, coverageComplete: true, dataParcTag: SIGNAL,
    requestId: delta ? 'c0000000-0000-4000-8000-000000000003' : 'c0000000-0000-4000-8000-000000000002',
    startAt: SEAM, requiredStartAt: ORIGIN, observedAt, missingLeadingSeconds: 0,
    runningSeconds: delta, runtimeHours: delta / 3600, state, cycleRuntimeRevision: revision,
    fbhe1bStandby: { ...metadata } };
  const evidence = { version: 1, source: 'dataparc', measurementVerified: true, hours: delta / 3600,
    requestId: basis.requestId, startAt: SEAM, requiredStartAt: ORIGIN, observedAt,
    coverageComplete: true, missingLeadingSeconds: 0, durationEquivalent: true,
    durationVerified: true, completionClockKnown: false, wholeCycleVerified: false,
    cycleBasisConfirmed: false, fbhe1bStandby: { ...metadata } };
  return { tagNumber: TAG, blowerType: 'fbhe', unitNo: '1', enabled: true, dataParcTag: SIGNAL,
    lastReplacementAt: ORIGIN, actualLastReplacementAt: '', cycleStartState: 'pending',
    cycleStartedAt: '', cycleStoredStartedAt: '', cycleStartRevision: 'original-start-revision',
    cycleRuntimeRevision: revision, cycleRuntimeState: state, cycleRuntimeAnchorAt: observedAt,
    cycleElapsedHours: delta / 3600, runtimeHours: delta / 3600, isRunning: state === 'running',
    runRuntime: { verified: true, source: 'dataparc', state, measuredAt: observedAt, hours: delta / 3600 },
    dataParcRuntimeBasis: basis, runtimeCoverageEvidence: evidence, fbhe1bStandbyProof: { ...metadata } };
}

test('FBHE 1B standby opens without a fetch, new query or checked attestation', () => {
  const h = harness(); assert.equal(h.calls.length, 0); assert.equal(h.saved.size, 0);
  assert.equal(h.controller.snapshot().phase, 'idle'); assert.equal(h.controller.snapshot().attested, false);
});
test('FBHE 1B standby explicit preview is GET-only and unchecked attestation cannot apply', async () => {
  const h = await ready(); assert.equal(h.calls.length, 1);
  assert.match(h.calls[0].url, /action=fbhe1b_standby_status(?:&|$)/);
  assert.ok(!h.calls[0].method || h.calls[0].method === 'GET');
  assert.equal(h.controller.snapshot().phase, 'ready'); assert.equal(h.controller.snapshot().attested, false);
  assert.equal(await h.controller.apply(), false); assert.equal(posts(h).length, 0);
  assert.equal(h.calls.length, 1);
});
test('FBHE 1B standby stores the exact pending attestation before its one certificate-only POST', async () => {
  const h = await ready(), before = structuredClone(h.asset); h.controller.setAttested(true);
  h.deps.api = async options => {
    h.calls.push(options); const record = JSON.parse(h.saved.get(ui.KEY));
    assert.equal(record.requestId, REQUEST); assert.equal(record.proofHash, PROOF); assert.equal(record.pending, true);
    assert.deepEqual(record.attestation, attestation());
    assert.doesNotMatch(JSON.stringify(record), /standby-session-never-stored|original-runtime-revision/);
    assert.deepEqual(options.body, { action: 'apply_fbhe1b_standby', requestId: REQUEST,
      expectedProofHash: PROOF, confirmation: 'FBHE_1B_STANDBY_20261008', attestation: attestation() });
    assert.ok(!Object.hasOwn(options.body, 'runtimeHours')); assert.ok(!Object.hasOwn(options.body, 'replacementAt'));
    return view({ eligible: false, applied: true, attestationRequired: false });
  };
  assert.equal(await h.controller.apply(), true); assert.equal(posts(h).length, 1);
  assert.equal(h.reloads(), 1); assert.equal(h.controller.snapshot().readbackVerified, true);
  assert.deepEqual(h.asset, before, 'the certificate controller never rewrites counters or cycle revisions');
  assert.equal(await h.controller.apply(), false); assert.equal(posts(h).length, 1);
});
test('FBHE 1B standby preserves fractional last-stop evidence and never calls it completion time', async () => {
  const h = await ready(); h.controller.setAttested(true); h.set(view({ eligible: false, applied: true, attestationRequired: false }));
  await h.controller.apply(); assert.equal(posts(h)[0].body.attestation.lastRunStoppedAt, STOP);
  assert.ok(!Object.hasOwn(posts(h)[0].body.attestation, 'completionAt'));
  assert.equal(ui.normalizeView(view()).completionClockKnown, false);
});
test('FBHE 1B standby rejects wrong asset, stop, daily total, zero window, prefix, tail or sum', () => {
  const invalid = [view({ assetTag: '104HHL60AP611' }), view({ completionDay: '2026-10-09' }),
    view({ completionClockKnown: true }), view({ proofHash: '' }), view({ request: { id: REQUEST, status: 'pending' } }),
    view({ witness: { ...view().witness, lastRunStoppedAt: '2026-10-08T13:04:00+09:00' } }),
    view({ witness: { ...view().witness, dailyRunningSeconds: 47688 } }),
    view({ witness: { ...view().witness, zeroWindowEndAt: '2026-10-08T00:00:00+09:00' } }),
    view({ tail: { startAt: ORIGIN, observedAt: END, runningSeconds: 0 } }),
    view({ tail: { startAt: SEAM, observedAt: END, runningSeconds: -1 } }),
    view({ preview: { ...view().preview, prefixRunningSeconds: 1, totalRunningSeconds: 1 } }),
    view({ preview: { ...view().preview, totalRunningSeconds: 1 } }),
    view({ quality: { sampleGoodCertified: true } }), view({ quality: {} }),
    view({ quality: undefined }), view({ attestationRequired: false }), view({ attestationRequired: 'true' }),
    view({ applied: true, attestationRequired: false }), view({ applied: 'true' }),
    view({ replayed: true }), view({ replayed: 'true' }),
    view({ eligible: false, applied: true, attestationRequired: true })];
  for (const raw of invalid) assert.throws(() => ui.normalizeView(raw), /INVALID_RESPONSE/);
});
test('FBHE 1B standby scope, disabled, mobile, write, login and busy guards make zero requests', async () => {
  for (const changes of [{ getAsset: () => ({ tagNumber: '104HHL60AP611' }) },
    { getAsset: () => ({ tagNumber: TAG, enabled: false }) }, { isMobile: () => true }, { canWrite: () => false },
    { session: () => '' }, { isBusy: () => true }]) {
    const h = harness(changes); assert.equal(await h.controller.refresh(), false);
    h.controller.setAttested(true); assert.equal(await h.controller.apply(), false); assert.equal(h.calls.length, 0);
  }
});
test('FBHE 1B standby login changes during GET or before POST cannot authorize apply', async () => {
  let session = 'before'; const h = harness({ session: () => session });
  h.deps.api = async options => { h.calls.push(options); session = 'after'; return view(); };
  assert.equal(await h.controller.refresh(), false); h.controller.setAttested(true);
  assert.equal(await h.controller.apply(), false); assert.equal(posts(h).length, 0);
  const second = await ready({ session: () => session }); second.controller.setAttested(true); session = 'changed-again';
  assert.equal(await second.controller.apply(), false); assert.equal(posts(second).length, 0);
});
test('FBHE 1B standby storage write and verification failures stop before the only mutation', async () => {
  for (const mode of ['write', 'readback']) {
    const map = new Map(); let fail = false;
    const storage = { getItem: key => fail && mode === 'readback' ? null : map.get(key) || null,
      setItem: (key, value) => { if (fail && mode === 'write') throw Error('blocked'); map.set(key, value); } };
    const h = await ready({ storage }); h.controller.setAttested(true); fail = true;
    assert.equal(await h.controller.apply(), false); assert.equal(posts(h).length, 0);
  }
});
test('FBHE 1B standby uncertain apply keeps the same request and reload reconciles with GET only', async () => {
  const h = await ready(); h.controller.setAttested(true); h.set(new Error('PRIVATE network detail'));
  assert.equal(await h.controller.apply(), false); assert.equal(posts(h).length, 1);
  const record = JSON.parse(h.saved.get(ui.KEY)); assert.equal(record.pending, true); assert.equal(record.requestId, REQUEST);
  assert.equal(await h.controller.apply(), false); assert.equal(posts(h).length, 1);
  const resumed = harness({ storage: h.deps.storage }); assert.equal(resumed.calls.length, 0);
  resumed.set(view({ eligible: false, applied: true, replayed: true, attestationRequired: false }));
  assert.equal(await resumed.controller.refresh(), true); assert.equal(posts(resumed).length, 0);
  assert.match(resumed.calls[0].url, new RegExp('requestId=' + REQUEST));
  assert.equal(resumed.controller.snapshot().readbackVerified, true); assert.equal(resumed.controller.snapshot().phase, 'applied');
  assert.doesNotMatch(JSON.stringify(resumed.controller.snapshot()), /PRIVATE|network detail/);
});
test('FBHE 1B standby 409 never retries or weakens the preserved attestation', async () => {
  const h = await ready(); h.controller.setAttested(true);
  h.set(Object.assign(new Error('PRIVATE SQL'), { status: 409, code: 'FBHE1B_STANDBY_CONFLICT' }));
  assert.equal(await h.controller.apply(), false); assert.equal(posts(h).length, 1); assert.equal(h.calls.length, 2);
  assert.ok(h.controller.snapshot().error); assert.doesNotMatch(JSON.stringify(h.controller.snapshot()), /PRIVATE|SQL/);
});
test('FBHE 1B standby fresh same-request proof resets confirmation and uses the current hash only after another check', async () => {
  const h = await ready(); h.controller.setAttested(true); const hash = 'b'.repeat(64);
  h.set(view({ proofHash: hash })); await h.controller.refresh(); assert.equal(h.controller.snapshot().attested, false);
  assert.equal(await h.controller.apply(), false); assert.equal(posts(h).length, 0);
  h.controller.setAttested(true); h.set(view({ proofHash: hash, eligible: false, applied: true, attestationRequired: false }));
  assert.equal(await h.controller.apply(), true); assert.equal(posts(h)[0].body.expectedProofHash, hash);
});
test('FBHE 1B standby changed request identity or ineligible status never permits apply', async () => {
  const h = await ready(); h.set(view({ request: { id: 'c0000000-0000-4000-8000-000000000002', status: 'complete' } }));
  assert.equal(await h.controller.refresh(), false); h.controller.setAttested(true);
  assert.equal(await h.controller.apply(), false); assert.equal(posts(h).length, 0);
  const second = harness(); second.set(view({ eligible: false, code: 'FBHE1B_STANDBY_CONFLICT' }));
  await second.controller.refresh(); second.controller.setAttested(true);
  assert.equal(await second.controller.apply(), false); assert.equal(posts(second).length, 0);
});
test('FBHE 1B standby response success still requires a current verified readback', async () => {
  const h = await ready({ reload: async () => false }); h.controller.setAttested(true);
  h.set(view({ eligible: false, applied: true, attestationRequired: false })); await h.controller.apply();
  assert.equal(h.controller.snapshot().readbackVerified, false); assert.equal(h.controller.snapshot().error, 'READBACK_UNCONFIRMED');
  await h.controller.refresh(); assert.equal(posts(h).length, 1); assert.match(h.calls.at(-1).url, new RegExp('requestId=' + REQUEST));
});
test('FBHE 1B standby normalization rejects arbitrary source text and non-enum token-like codes', () => {
  const normalized = ui.normalizeView(view({ message: '<img onerror=PRIVATE_TOKEN>', code: 'FBHE1B_STANDBY_PRIVATE_TOKEN',
    actorId: 'PRIVATE_OPERATOR', request: { id: REQUEST, status: 'complete', rawSql: 'SELECT PRIVATE' } }));
  assert.doesNotMatch(JSON.stringify(normalized), /PRIVATE|onerror|SELECT/);
});
test('FBHE 1B standby zero counter and later measured append validate without a fabricated completion clock', () => {
  for (const delta of [0, 10]) {
    const asset = recoveredAsset(delta);
    assert.equal(refresh.verifiedFbhe1bStandby(asset)?.r9RequestId, REQUEST);
    assert.equal(ui.verifyReadback(asset, view()), true);
    assert.equal(refresh.runReviewStatus(asset), null);
    assert.equal(asset.runtimeCoverageEvidence.wholeCycleVerified, false);
    assert.equal(asset.runtimeCoverageEvidence.cycleBasisConfirmed, false);
    assert.equal(asset.actualLastReplacementAt, '');
    assert.equal(asset.dataParcRuntimeBasis.startAt, SEAM, 'existing measured start remains Oct 9');
    assert.equal(asset.dataParcRuntimeBasis.requiredStartAt, ORIGIN, 'zero-window certificate supplements Oct 8');
    assert.notEqual(asset.dataParcRuntimeBasis.requestId, REQUEST, 'zero-window projection preserves the existing tail receipt owner');
  }
});
test('FBHE 1B standby readback rejects lost owner, old revision, changed source, wrong range and clock certification', () => {
  const invalid = [a => { a.dataParcRuntimeBasis.fbhe1bStandby.r9RequestId = 'wrong-request'; },
    a => { a.runtimeCoverageEvidence.fbhe1bStandby.auditId = 'wrong-audit'; },
    a => { a.fbhe1bStandbyProof.lastRunStoppedAt = '2026-10-08T13:04:00+09:00'; },
    a => { a.cycleRuntimeRevision = 'changed'; }, a => { a.cycleSourceReview = { code: 'SOURCE_CHANGED' }; },
    a => { a.dataParcRuntimeBasis.startAt = ORIGIN; }, a => { a.dataParcRuntimeBasis.requiredStartAt = SEAM; },
    a => { a.runtimeCoverageEvidence.wholeCycleVerified = true; },
    a => { a.runtimeCoverageEvidence.completionClockKnown = true; },
    a => { a.actualLastReplacementAt = STOP; }, a => { a.runRuntime.source = 'manual'; },
    a => { a.tagNumber = '104HHL60AP611'; }];
  for (const mutate of invalid) {
    const asset = recoveredAsset(10); mutate(asset);
    assert.equal(refresh.verifiedFbhe1bStandby(asset), null); assert.equal(ui.verifyReadback(asset, view()), false);
  }
});
test('FBHE 1B standby panel is unchecked and has no query action, preserving zero and hiding IDs and raw messages', async () => {
  function element(tag) { return { tag, children: [], handlers: {}, hidden: false, disabled: false, textContent: '', checked: false,
    appendChild(child) { this.children.push(child); }, replaceChildren() { this.children = []; },
    setAttribute() {}, addEventListener(name, fn) { this.handlers[name] = fn; } }; }
  const container = element('div'), h = harness({ session: () => 'standby-mounted-session' });
  h.set(view({ message: '<img onerror=PRIVATE_TOKEN>', code: 'FBHE1B_STANDBY_PRIVATE_TOKEN' }));
  const controller = ui.mount({ ...h.deps, document: { createElement: element }, container,
    asset: { tagNumber: TAG, enabled: true } });
  const descendants = root => [root, ...root.children.flatMap(descendants)];
  const controls = descendants(container), checkbox = controls.find(e => e.tag === 'input' && e.type === 'checkbox');
  const apply = controls.find(e => e.tag === 'button' && e.className === 'button primary');
  const text = () => descendants(container).map(e => e.textContent).join(' ');
  assert.equal(h.calls.length, 0); assert.equal(checkbox.checked, false);
  assert.equal(controls.filter(e => e.tag === 'input').length, 1); assert.equal(typeof controller.start, 'undefined');
  await controller.refresh(); assert.equal(posts(h).length, 0); assert.equal(apply.disabled, true);
  assert.match(text(), /0초/); assert.match(text(), /13:14:47/); assert.match(text(), /완료시각.*미기록/);
  assert.doesNotMatch(text(), /PRIVATE|onerror|c0000000-0000|standby-mounted-session/);
  checkbox.checked = true; checkbox.handlers.change(); assert.equal(apply.disabled, false);
  h.set(view({ eligible: false, applied: true, attestationRequired: false })); apply.handlers.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(posts(h).length, 1); assert.equal(controller.snapshot().readbackVerified, true); assert.equal(apply.hidden, true);
  assert.ok(h.calls.every(call => !/ois-data-requests/.test(call.url || '')));
  assert.equal(ui.mount({ container: {}, asset: { tagNumber: '104HHL60AP611' }, canWrite: () => true,
    isMobile: () => false }), null);
});
test('actual main coverage and overview adapter clear only verified standby review on LF and CRLF while retaining zero', () => {
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
      'verifiedLimestoneRunDisplay', 'allOverviewQueryStats',
      compact + manual + section(source, '  function allOverviewRuntimeAssessment(', '\n  function overviewSeparateRunObservedAt(', name + ' assessment') +
      '\nreturn allOverviewRuntimeAssessment;')(window, coverage, () => ({}), () => false, () => false,
      () => false, state, () => true, () => null, () => ({ latest: { observedAt: END } }));
    const asset = recoveredAsset();
    asset.replacementAutoCycle = { schemaVersion: 3, normalizationVersion: 4, registeredRuntimeRange: true, clockKnown: false };
    assert.equal(coverage(asset), null, name);
    const assessed = adapter(asset, { basis: asset.dataParcRuntimeBasis, state: 'stopped' }, END);
    assert.equal(assessed.hours, 0, name); assert.equal(assessed.requiresReview, false, name);
    assert.equal(assessed.durationEquivalent, true, name); assert.equal(assessed.wholeCycleVerified, false, name);
    assert.equal(assessed.scope, 'cycle-equivalent', name);
    const bad = structuredClone(asset); bad.runtimeCoverageEvidence.fbhe1bStandby.r9RequestId = 'wrong';
    assert.ok(coverage(bad), name); const rejected = adapter(bad, { basis: bad.dataParcRuntimeBasis, state: 'stopped' }, END);
    assert.equal(rejected.requiresReview, true, name); assert.equal(rejected.durationEquivalent, false, name);
    const other = structuredClone(asset); other.tagNumber = '104HHL60AP611';
    const unchanged = adapter(other, { basis: other.dataParcRuntimeBasis, state: 'stopped' }, END);
    assert.equal(unchanged.requiresReview, true, name); assert.equal(unchanged.durationEquivalent, false, name);
  }
});
test('actual main standby date and card note retain day-only completion without labeling the last stop as completion on LF and CRLF', () => {
  for (const [name, source] of historyVariants()) {
    const window = { BlowerUnifiedRefresh: refresh };
    const formatDate = value => new Date(Date.parse(value) + 9 * 3600000).toISOString().slice(0, 10);
    const dateHelpers = new Function('window', 'isInitialStartupBasis', 'formatDate', 'formatKstDateTimeDisplay',
      section(source, '  function cycleReferenceLabel(', '\n  function initialStartupEvidence(', name + ' cycle date') +
      '\nreturn { label: cycleReferenceLabel, display: cycleReferenceDisplay };')(window, () => false, formatDate, value => value);
    const card = new Function('window', 'isInitialStartupBasis', 'formatKstDateTimeDisplay', 'overviewManualTimestamp', 'blowerResolutionGuide',
      section(source, '  function renderRuntimeAssessmentOverviewCard(', '\n    const separateRunAt =', name + ' card note') +
      '\nreturn { referenceLabel, referenceValue, note };\n}\nreturn renderRuntimeAssessmentOverviewCard;')(
      window, () => false, value => value, () => '', () => null);
    const asset = recoveredAsset(); assert.equal(dateHelpers.label(asset), '교체일', name);
    assert.equal(dateHelpers.display(asset), DAY, name);
    const info = { assessment: { operation: { state: 'stopped', intermittent: false }, scope: 'cycle-equivalent',
      coverage: { startAt: SEAM, observedAt: END }, freshness: { state: 'current' }, reasonLabel: '' },
      replacement: dateHelpers.display(asset), transition: null, maintenance: '', partialCoverage: null };
    const rendered = card(asset, info);
    assert.equal(rendered.referenceLabel, '교체일', name); assert.equal(rendered.referenceValue, DAY, name);
    assert.equal(rendered.note, '교체 후 누적 검증 완료', name);
    assert.doesNotMatch(JSON.stringify(rendered), /13:14:47|13:04|00:00/, name);
  }
});
test('actual main standby mount reads the same proof and verified append descendants without queries or counter writes on LF and CRLF', async () => {
  for (const [name, source] of historyVariants()) {
    let options, current = recoveredAsset(10); const reads = [], before = structuredClone(current);
    const state = { data: { permissions: { canAdmin: true } } };
    const window = { BlowerFbhe1bStandby: { mount: value => { options = value; }, verifyReadback: ui.verifyReadback },
      sessionStorage: { getItem: () => null, setItem() {} } };
    new Function('window', 'elements', 'asset', 'document', 'findAsset', 'tagNumber', 'hasAuthenticatedWriteAccess',
      'state', 'isMobileMonitoringView', 'getSessionToken', 'setBusy', 'apiRequest', 'loadData',
      section(source, '    window.BlowerFbhe1bStandby?.mount({', '\n    elements.historyDialog.showModal();', name + ' mount'))(
      window, { historyCycleSummary: {} }, current, {}, () => current, TAG, () => true, state, () => false,
      () => 'fixture-session', () => {}, () => { throw Error('no query or mutation permitted'); }, async value => reads.push(value));
    assert.equal(options.canWrite(), true, name); state.data.permissions.canAdmin = false; assert.equal(options.canWrite(), false, name);
    assert.equal(await options.reload(ui.normalizeView(view({ eligible: false, applied: true, attestationRequired: false }))), true, name);
    assert.deepEqual(reads, [{ silent: true, syncOperations: false, strict: true }]); assert.deepEqual(current, before, name);
    current.runtimeCoverageEvidence.fbhe1bStandby.auditId = 'wrong-audit';
    assert.equal(await options.reload(ui.normalizeView(view({ eligible: false, applied: true, attestationRequired: false }))), false, name);
  }
});
