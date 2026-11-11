'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ui = require('../maintenance/blower-limestone2a-first-run-v1.js');
const refresh = require('../maintenance/blower-unified-refresh.js');

const START = '2026-09-19T00:00:00+09:00';
const SEAM = '2026-09-20T00:00:00+09:00';
const FIRST = '2026-09-19T09:58:26+09:00';
const END = '2026-11-11T20:48:00+09:00';
const SIGNAL = 'GSPOGE.ABB_DCS.203HRJ01AN601XB04';
const PROOF = 'a'.repeat(64);
const REQUEST = 'a0000000-0000-4000-8000-000000000001';
const TAIL = 7602274;
const TOTAL = TAIL + 50494;
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
  return { ok: true, assetTag: '203HRJ01AN601', eligible: true, proofHash: PROOF,
    completionDay: '2026-09-19', completionClockKnown: false, firstPostReplacementRunAt: FIRST,
    prefix: { startAt: START, endAt: SEAM, runningSeconds: 50494, zeroPrefixRunningSeconds: 0 },
    tail: { startAt: SEAM, observedAt: END, runningSeconds: TAIL },
    request: { id: REQUEST, status: 'complete' },
    preview: { prefixRunningSeconds: 50494, tailRunningSeconds: TAIL,
      totalRunningSeconds: TOTAL, observedAt: END },
    applied: false, replayed: false, quality: { sampleGoodCertified: false },
    attestationRequired: true, ...patch };
}
function harness(change = {}) {
  const saved = new Map(), calls = [], locks = [];
  let next = view(), reloads = 0;
  const deps = { getAsset: () => ({ tagNumber: ui.TAG, enabled: true }), canWrite: () => true,
    isMobile: () => false, session: () => 'fixture-session-never-stored', isBusy: () => false,
    setBusy: value => locks.push(value),
    storage: { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value) },
    api: async options => { calls.push(options); if (next instanceof Error) throw next; return next; },
    reload: async () => { reloads++; return true; }, ...change };
  return { controller: ui.createController(deps), deps, saved, calls, locks,
    set: value => { next = value; }, reloads: () => reloads };
}
async function ready(change) { const h = harness(change); await h.controller.refresh(); return h; }
const posts = h => h.calls.filter(call => call.method === 'POST');
function attestation(firstRunAt = FIRST) {
  return { version: 1, completionDay: '2026-09-19', firstRunAt,
    completionBeforeFirstRun: true, noEarlierPostReplacementRun: true,
    statementCode: 'BELT_COMPLETED_BEFORE_FIRST_RUN' };
}
function recoveredAsset(delta = 0) {
  const observedAt = new Date(Date.parse(END) + delta * 1000).toISOString();
  const meta = { version: 1, certificateEventId: 'dataparc_limestone2a_first_run:' + REQUEST,
    prefixRequestId: REQUEST, auditId: 'lime2a_first_run:' + REQUEST, firstRunAt: FIRST,
    completionDay: '2026-09-19', completionClockKnown: false, completionBeforeFirstRun: true,
    noEarlierPostReplacementRun: true, durationEquivalent: true,
    prefixRunningSeconds: 50494, originalTailRunningSeconds: TAIL, sampleGoodCertified: false,
    proofHash: PROOF, sourceProofHash: 'b'.repeat(64), cycleStartRevision: 'lime2a-first-run-v1:' + PROOF,
    currentRuntimeRevision: 'runtime-after-apply', currentRunningSeconds: TOTAL + delta,
    currentObservedAt: observedAt, currentAnchorAt: observedAt, currentState: 'running',
    measuredState: 'running', preservedStateBoundary: false };
  const hours = (TOTAL + delta) / 3600;
  const basis = { composite: true, appendReady: true, coverageComplete: true,
    cycleBasisConfirmed: false, completionClockKnown: false, dataParcTag: SIGNAL,
    requestId: delta ? 'a0000000-0000-4000-8000-000000000003' : REQUEST,
    startAt: START, requiredStartAt: START, observedAt, runningSeconds: TOTAL + delta,
    missingLeadingSeconds: 0, cycleRuntimeRevision: 'runtime-after-apply', state: 'running',
    runtimeHours: hours, startState: 'stopped', endState: 'running',
    limestone2aFirstRun: { ...meta } };
  const evidence = { version: 1, source: 'dataparc', measurementVerified: true,
    durationEquivalent: true, durationVerified: true, completionClockKnown: false,
    wholeCycleVerified: false, cycleBasisConfirmed: false, composite: true,
    coverageComplete: true, missingLeadingSeconds: 0, requestId: basis.requestId,
    hours, startAt: START, observedAt, requiredStartAt: START,
    limestone2aFirstRun: { ...meta }, sampleGoodCertified: false };
  return { tagNumber: ui.TAG, blowerType: 'limestone', enabled: true, unitNo: '2',
    dataParcTag: SIGNAL, lastReplacementAt: START, actualLastReplacementAt: '',
    cycleStartState: 'pending', cycleStoredStartedAt: '', cycleStartedAt: '',
    cycleStartRevision: 'lime2a-first-run-v1:' + PROOF, cycleRuntimeRevision: 'runtime-after-apply', cycleRuntimeState: 'running',
    cycleElapsedHours: hours, runtimeHours: hours, cycleRuntimeAnchorAt: observedAt,
    runRuntime: { source: 'dataparc', verified: true, hours, state: 'running', measuredAt: observedAt },
    dataParcRuntimeBasis: basis, runtimeCoverageEvidence: evidence,
    limestone2aFirstRunProof: { ...meta, durationVerified: true,
      runtimeRevision: 'runtime-after-apply', runtimeRequestId: basis.requestId } };
}

test('Limestone 2A controller opens without a request and attestation defaults to off', () => {
  const h = harness();
  assert.equal(h.calls.length, 0); assert.equal(h.saved.size, 0);
  assert.equal(h.controller.snapshot().attested, false);
  assert.equal(h.controller.snapshot().phase, 'idle');
});
test('Limestone 2A preview is one GET and never creates a DataPARC request or applies', async () => {
  const h = await ready(); assert.equal(h.calls.length, 1);
  assert.match(h.calls[0].url, /action=limestone2a_first_run_status(?:&|$)/);
  assert.ok(!h.calls[0].method || h.calls[0].method === 'GET');
  assert.equal(h.controller.snapshot().phase, 'ready');
  assert.equal(h.controller.snapshot().attested, false);
  assert.equal(await h.controller.apply(), false); assert.equal(posts(h).length, 0);
  assert.equal(h.calls.length, 1, 'unchecked attestation cannot send even a status request');
});
test('Limestone 2A explicit apply persists exact attestation and request before the only POST', async () => {
  const h = await ready(); h.controller.setAttested(true);
  h.deps.api = async options => {
    h.calls.push(options);
    assert.equal(options.method, 'POST');
    const record = JSON.parse(h.saved.get(ui.KEY));
    assert.equal(record.pending, true); assert.equal(record.requestId, REQUEST);
    assert.equal(record.proofHash, PROOF); assert.deepEqual(record.attestation, attestation());
    assert.doesNotMatch(JSON.stringify(record), /fixture-session-never-stored|7602274|7652768/);
    assert.deepEqual(options.body, { action: 'apply_limestone2a_first_run', requestId: REQUEST,
      expectedProofHash: PROOF, confirmation: 'LIMESTONE_2A_FIRST_RUN_20260919', attestation: attestation() });
    return view({ applied: true, attestationRequired: false });
  };
  assert.equal(await h.controller.apply(), true);
  assert.equal(posts(h).length, 1); assert.equal(h.reloads(), 1);
  assert.equal(h.controller.snapshot().phase, 'applied');
  assert.equal(h.controller.snapshot().readbackVerified, true);
  assert.equal(await h.controller.apply(), false, 'a completed controller never repeats apply');
  assert.equal(posts(h).length, 1);
});
test('Limestone 2A exact fractional first RUN time is attested without inventing a completion clock', async () => {
  const first = '2026-09-19T00:58:26.250Z';
  const h = harness(); h.set(view({ firstPostReplacementRunAt: first }));
  await h.controller.refresh(); h.controller.setAttested(true);
  h.set(view({ firstPostReplacementRunAt: first, applied: true, attestationRequired: false }));
  await h.controller.apply();
  assert.equal(posts(h)[0].body.attestation.firstRunAt, first);
  assert.ok(!Object.hasOwn(posts(h)[0].body, 'replacementAt'));
  assert.ok(!Object.hasOwn(posts(h)[0].body.attestation, 'completionAt'));
});
test('Limestone 2A validates asset, day, zero prefix, exact prefix seconds, seam and total before admission', () => {
  const invalid = [view({ assetTag: '103HRJ01AN602' }), view({ completionDay: '2026-09-20' }),
    view({ completionClockKnown: true }), view({ firstPostReplacementRunAt: '2026-09-19T10:00:00+09:00' }),
    view({ prefix: { startAt: START, endAt: SEAM, runningSeconds: 50494, zeroPrefixRunningSeconds: 1 } }),
    view({ prefix: { startAt: START, endAt: SEAM, runningSeconds: 50493, zeroPrefixRunningSeconds: 0 } }),
    view({ tail: { startAt: '2026-09-19T00:00:00+09:00', observedAt: END, runningSeconds: TAIL } }),
    view({ preview: { prefixRunningSeconds: 50494, tailRunningSeconds: TAIL, totalRunningSeconds: TOTAL + 1, observedAt: END } }),
    view({ request: { id: REQUEST, status: 'pending' } }), view({ proofHash: '' })];
  for (const raw of invalid) assert.throws(() => ui.normalizeView(raw), /INVALID_RESPONSE/);
});
test('Limestone 2A wrong asset, disabled asset, mobile, permission, session and busy guards make zero calls', async () => {
  for (const changes of [{ getAsset: () => ({ tagNumber: '103HRJ01AN602' }) },
    { getAsset: () => ({ tagNumber: ui.TAG, enabled: false }) }, { isMobile: () => true },
    { canWrite: () => false }, { session: () => '' }, { isBusy: () => true }]) {
    const h = harness(changes); assert.equal(await h.controller.refresh(), false);
    h.controller.setAttested(true); assert.equal(await h.controller.apply(), false);
    assert.equal(h.calls.length, 0);
  }
});
test('Limestone 2A session changes during preview or before apply cannot authorize a POST', async () => {
  let session = 'before'; const h = harness({ session: () => session });
  h.deps.api = async options => { h.calls.push(options); session = 'after'; return view(); };
  assert.equal(await h.controller.refresh(), false); h.controller.setAttested(true);
  assert.equal(await h.controller.apply(), false); assert.equal(posts(h).length, 0);
  const second = await ready({ session: () => session }); second.controller.setAttested(true); session = 'changed-again';
  assert.equal(await second.controller.apply(), false); assert.equal(posts(second).length, 0);
});
test('Limestone 2A storage write failure or readback mismatch stops before apply POST', async () => {
  for (const mode of ['write', 'readback']) {
    const saved = new Map(); let fail = false;
    const storage = { getItem: key => fail && mode === 'readback' ? null : saved.get(key) || null,
      setItem: (key, value) => { if (fail && mode === 'write') throw Error('blocked'); saved.set(key, value); } };
    const h = await ready({ storage }); h.controller.setAttested(true); fail = true;
    assert.equal(await h.controller.apply(), false); assert.equal(posts(h).length, 0);
  }
});
test('Limestone 2A uncertain apply retains the original request and later reconciles using GET only', async () => {
  const h = await ready(); h.controller.setAttested(true); h.set(new Error('private network details'));
  assert.equal(await h.controller.apply(), false); assert.equal(posts(h).length, 1);
  const record = JSON.parse(h.saved.get(ui.KEY)); assert.equal(record.requestId, REQUEST); assert.equal(record.pending, true);
  assert.equal(await h.controller.apply(), false); assert.equal(posts(h).length, 1, 'uncertain operation cannot be blindly repeated');
  const resumed = harness({ storage: h.deps.storage }); assert.equal(resumed.calls.length, 0);
  resumed.set(view({ eligible: false, replayed: true, applied: true, attestationRequired: false }));
  assert.equal(await resumed.controller.refresh(), true);
  assert.match(resumed.calls[0].url, new RegExp('requestId=' + REQUEST));
  assert.equal(posts(resumed).length, 0); assert.equal(resumed.controller.snapshot().phase, 'applied');
  assert.equal(resumed.controller.snapshot().readbackVerified, true);
  assert.doesNotMatch(JSON.stringify(resumed.controller.snapshot()), /private network details/);
});
test('Limestone 2A 409 remains visible with no automatic retry or changed attestation', async () => {
  const h = await ready(); h.controller.setAttested(true);
  h.set(Object.assign(new Error('private SQL or token must not appear'), { status: 409, code: 'LIMESTONE2A_FIRST_RUN_CONFLICT' }));
  assert.equal(await h.controller.apply(), false); assert.equal(posts(h).length, 1);
  assert.equal(h.calls.length, 2); assert.ok(h.controller.snapshot().error);
  assert.doesNotMatch(JSON.stringify(h.controller.snapshot()), /private SQL|token must/);
});
test('Limestone 2A successful apply response never claims verified readback when the current proof is missing', async () => {
  const h = await ready({ reload: async () => false }); h.controller.setAttested(true);
  h.set(view({ applied: true, attestationRequired: false }));
  await h.controller.apply();
  assert.equal(posts(h).length, 1); assert.equal(h.controller.snapshot().readbackVerified, false);
  assert.equal(h.controller.snapshot().error, 'READBACK_UNCONFIRMED');
  await h.controller.refresh(); assert.equal(posts(h).length, 1);
  assert.match(h.calls.at(-1).url, new RegExp('requestId=' + REQUEST));
});
test('Limestone 2A current eligibility false never becomes permission to apply', async () => {
  const h = harness(); h.set(view({ eligible: false, code: 'LIMESTONE2A_FIRST_RUN_CONFLICT' }));
  await h.controller.refresh(); h.controller.setAttested(true);
  assert.equal(await h.controller.apply(), false); assert.equal(posts(h).length, 0);
});
test('Limestone 2A response normalization discards untrusted messages, raw SQL and identity strings', () => {
  const raw = view({ message: '<img src=x onerror=token()>PRIVATE', actorId: 'PRIVATE',
    request: { id: REQUEST, status: 'complete', rawSql: 'SELECT PRIVATE' },
    code: 'LIME2A_PRIVATE_TOKEN', attestation: { token: 'PRIVATE' } });
  const normalized = ui.normalizeView(raw);
  assert.doesNotMatch(JSON.stringify(normalized), /PRIVATE|onerror|SELECT|token/);
});
test('Limestone 2A readback accepts exact proof and later verified append descendants without certifying a clock', () => {
  assert.equal(ui.verifyReadback(recoveredAsset(), view()), true);
  assert.equal(ui.verifyReadback(recoveredAsset(10), view()), true);
  const invalid = [a => { a.dataParcRuntimeBasis.limestone2aFirstRun.prefixRequestId = 'wrong-request'; },
    a => { a.runtimeCoverageEvidence.limestone2aFirstRun.certificateEventId = 'wrong-certificate'; },
    a => { a.limestone2aFirstRunProof.firstRunAt = '2026-09-19T10:00:00+09:00'; },
    a => { a.runtimeCoverageEvidence.durationEquivalent = false; },
    a => { a.runtimeCoverageEvidence.completionClockKnown = true; },
    a => { a.actualLastReplacementAt = FIRST; }, a => { a.cycleSourceReview = { code: 'SOURCE_CHANGED' }; },
    a => { a.dataParcRuntimeBasis.runningSeconds = TOTAL - 1; },
    a => { a.dataParcRuntimeBasis.observedAt = '2026-11-10T00:00:00+09:00'; },
    a => { a.dataParcTag = 'GSPOGE.ABB_DCS.WRONG'; }];
  for (const mutate of invalid) { const asset = recoveredAsset(10); mutate(asset); assert.equal(ui.verifyReadback(asset, view()), false); }
});
test('Limestone 2A shared projection validates all proof owners while keeping physical clock unknown', () => {
  for (const delta of [0, 10]) {
    const asset = recoveredAsset(delta);
    assert.equal(refresh.verifiedLimestone2aFirstRun(asset)?.prefixRequestId, REQUEST);
    assert.equal(refresh.runReviewStatus(asset), null);
    assert.equal(asset.runtimeCoverageEvidence.wholeCycleVerified, false);
    assert.equal(asset.runtimeCoverageEvidence.cycleBasisConfirmed, false);
    assert.equal(asset.actualLastReplacementAt, '');
  }
  for (const mutate of [a => { a.tagNumber = '103HRJ01AN602'; },
    a => { a.dataParcRuntimeBasis.cycleRuntimeRevision = 'old-revision'; },
    a => { a.dataParcRuntimeBasis.limestone2aFirstRun.noEarlierPostReplacementRun = false; },
    a => { a.limestone2aFirstRunProof.completionClockKnown = true; },
    a => { a.runtimeCoverageEvidence.requestId = 'other-owner'; },
    a => { a.runRuntime.source = 'manual'; }]) {
    const asset = recoveredAsset(10); mutate(asset); assert.equal(refresh.verifiedLimestone2aFirstRun(asset), null);
  }
});
test('Limestone 2A mounted panel is explicit, starts unchecked and never displays IDs or untrusted response text', async () => {
  function element(tag) {
    return { tag, children: [], handlers: {}, hidden: false, disabled: false, textContent: '', checked: false,
      appendChild(child) { this.children.push(child); }, replaceChildren() { this.children = []; },
      setAttribute() {}, addEventListener(name, fn) { this.handlers[name] = fn; } };
  }
  const container = element('div'), h = harness({ session: () => 'mounted-test-session' });
  h.set(view({ message: '<img onerror=PRIVATE_TOKEN>', code: 'LIME2A_PRIVATE_TOKEN', actorId: 'PRIVATE_ACTOR' }));
  const controller = ui.mount({ ...h.deps, document: { createElement: element }, container,
    asset: { tagNumber: ui.TAG, enabled: true } });
  const descendants = root => [root, ...root.children.flatMap(descendants)];
  const controls = descendants(container), checkbox = controls.find(e => e.tag === 'input' && e.type === 'checkbox');
  const apply = controls.find(e => e.tag === 'button' && e.className === 'button primary');
  assert.ok(checkbox); assert.ok(apply); assert.equal(checkbox.checked, false);
  assert.equal(h.calls.length, 0, 'mounting history is not a status request or a query');
  await controller.refresh(); assert.equal(h.calls.length, 1); assert.equal(posts(h).length, 0);
  assert.equal(checkbox.checked, false); assert.equal(apply.disabled, true);
  const visible = () => descendants(container).map(e => e.textContent).join(' ');
  assert.match(visible(), /50,?494초/); assert.match(visible(), /완료시각.*미기록/);
  assert.doesNotMatch(visible(), /PRIVATE|onerror|a0000000-0000|mounted-test-session/);
  checkbox.checked = true; checkbox.handlers.change(); assert.equal(apply.disabled, false);
  h.set(view({ applied: true, attestationRequired: false })); apply.handlers.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(posts(h).length, 1); assert.equal(controller.snapshot().readbackVerified, true);
  assert.equal(apply.hidden, true); assert.match(visible(), /최신 값 대조를 완료/);
  assert.equal(ui.mount({ container: {}, asset: { tagNumber: '103HRJ01AN602' }, canWrite: () => true,
    isMobile: () => false }), null);
});
test('actual main coverage and overview adapter remove only the verified Limestone 2A review on LF and CRLF', () => {
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
      '\nreturn allOverviewRuntimeAssessment;')(window, coverage, () => ({}), () => true, () => false, () => false,
      state, () => true, () => null, () => ({ latest: { observedAt: END } }));
    const good = recoveredAsset(10);
    good.replacementAutoCycle = { schemaVersion: 3, normalizationVersion: 4, registeredRuntimeRange: true, clockKnown: false };
    assert.equal(coverage(good), null, name);
    const result = adapter(good, { basis: good.dataParcRuntimeBasis, state: 'running' }, END);
    assert.equal(result.requiresReview, false, name); assert.equal(result.durationEquivalent, true, name);
    assert.equal(result.wholeCycleVerified, false, name); assert.equal(result.scope, 'cycle-equivalent', name);
    const bad = structuredClone(good); bad.runtimeCoverageEvidence.limestone2aFirstRun.prefixRequestId = 'wrong';
    assert.ok(coverage(bad), name + ' invalid proof remains a review');
    const rejected = adapter(bad, { basis: bad.dataParcRuntimeBasis, state: 'running' }, END);
    assert.equal(rejected.requiresReview, true, name); assert.equal(rejected.durationEquivalent, false, name);
    const other = structuredClone(good); other.tagNumber = '103HRJ01AN602';
    const untouched = adapter(other, { basis: other.dataParcRuntimeBasis, state: 'running' }, END);
    assert.equal(untouched.requiresReview, true, name); assert.equal(untouched.durationEquivalent, false, name);
  }
});
test('actual main edit/delete and event type guards preserve the Lime certificate and cycle boundaries on LF and CRLF', () => {
  const boundaryTypes = ['replacement', 'startup', 'operation_start', 'operation_stop', 'runtime_correction'];
  for (const [name, source] of historyVariants()) {
    const helpers = new Function('hasAuthenticatedWriteAccess', 'isMobileMonitoringView', 'isInitialStartupBasis',
      section(source, '  function canEditAnyHistoryEvent(', '\n  async function openHistoryDeleteDialog(', name + ' mutation helpers') +
      '\nreturn { edit: canEditAnyHistoryEvent, remove: canDeleteManualHistoryEvent };')(() => true, () => false, () => false);
    const asset = recoveredAsset();
    const event = type => ({ id: 'history-event', tagNumber: asset.tagNumber, eventType: type, sourceType: 'manual', updatedAt: END });
    for (const type of boundaryTypes) {
      assert.equal(helpers.edit(asset, event(type)), false, name + ' edit ' + type);
      assert.equal(helpers.remove(asset, event(type)), false, name + ' delete ' + type);
    }
    assert.equal(helpers.edit(asset, event('problem')), true, name); assert.equal(helpers.remove(asset, event('problem')), true, name);
    const later = { ...asset, cycleStartRevision: 'new-actual-belt-cycle' };
    for (const certificate of [
      { ...event('problem'), sourceType: 'dataparc_limestone2a_first_run_v1' },
      { ...event('problem'), id: 'dataparc_limestone2a_first_run:' + REQUEST }
    ]) {
      assert.equal(helpers.edit(later, certificate), false, name); assert.equal(helpers.remove(later, certificate), false, name);
    }
    const other = { ...asset, tagNumber: '104HHL60AP611' };
    for (const type of boundaryTypes) assert.equal(helpers.edit(other, { ...event(type), tagNumber: other.tagNumber }), true, name);
    const lock = section(source, '    elements.historyEventEditType.disabled =', '\n    elements.historyEventEditType.title =', name + ' type lock');
    const elements = { historyEventEditType: {} }, setLock = new Function('asset', 'elements', lock);
    setLock(asset, elements); assert.equal(elements.historyEventEditType.disabled, true, name);
    setLock(other, elements); assert.equal(elements.historyEventEditType.disabled, false, name);
    setLock(later, elements); assert.equal(elements.historyEventEditType.disabled, false, name);
  }
});
test('actual main correction and basis controls block recovered Lime without blocking new belt or state creation on LF and CRLF', () => {
  for (const [name, source] of historyVariants()) {
    const state = {}, controls = { historyRuntimeCorrectionButton: {}, limestoneBasisButton: {} };
    const correction = new Function('asset', 'elements', 'hasAuthenticatedWriteAccess', 'awaitingBackfill', 'startupPending',
      section(source, '    if (elements.historyRuntimeCorrectionButton) {', '\n    elements.assetHistoryList.innerHTML', name + ' correction'));
    const basis = new Function('asset', 'elements', 'hasAuthenticatedWriteAccess', 'isMobileMonitoringView',
      'LIMESTONE_DISPUTED_RUN_TAGS', 'state',
      section(source, '    if (elements.limestoneBasisButton) {', '\n    if (elements.historyRuntimeQueryButton)', name + ' basis'));
    const current = recoveredAsset(), other = { ...current, tagNumber: '103HRJ01AN602' }, later = { ...current, cycleStartRevision: 'new-belt' };
    for (const [asset, hidden] of [[current, true], [other, false], [later, false]]) {
      correction(asset, controls, () => true, false, false);
      assert.equal(controls.historyRuntimeCorrectionButton.hidden, hidden, name); assert.equal(controls.historyRuntimeCorrectionButton.disabled, hidden, name);
      basis(asset, controls, () => true, () => false, new Set([ui.TAG, other.tagNumber]), state);
      assert.equal(controls.limestoneBasisButton.hidden, hidden, name);
    }
    let selected = current, notices = [];
    const open = new Function('stopMobileMutation', 'findAsset', 'elements', 'showToast',
      section(source, '  function openRecordDialog(', '\n    resetRecordDialogVisibility();', name + ' direct record guard') +
      '\nreturn true;\n}\nreturn openRecordDialog;')(() => false, () => selected,
      { recordDialog: {} }, text => notices.push(text));
    assert.equal(open('runtime', ui.TAG), undefined, name); assert.equal(notices.length, 1, name);
    assert.equal(open('replacement', ui.TAG), true, name); assert.equal(open('runtime_state', ui.TAG), true, name);
    assert.equal(open('problem', ui.TAG), true, name);
    selected = other; assert.equal(open('runtime', other.tagNumber), true, name);
    selected = later; assert.equal(open('runtime', ui.TAG), true, name);
  }
});
test('actual main operation toggle uses runtime_state for recovered pending Lime and keeps other pending startup behavior on LF and CRLF', async () => {
  for (const [name, source] of historyVariants()) {
    let selected = recoveredAsset(); selected.isRunning = true;
    const toggle = new Function('stopMobileMutation', 'state', 'findAsset', 'showToast', 'currentServerDate',
      section(source, '  async function toggleAssetOperation(', '\n    setBusy(true);', name + ' toggle body') +
      '\nreturn body;\n}\nreturn toggleAssetOperation;')(() => false, {}, () => selected,
      () => { throw Error('unexpected toast'); }, () => new Date(END));
    const stopped = await toggle(ui.TAG); assert.equal(stopped.action, 'runtime_state', name);
    assert.equal(stopped.isRunning, false, name); assert.equal(stopped.expectedCycleRuntimeRevision, selected.cycleRuntimeRevision, name);
    selected.isRunning = false; assert.equal((await toggle(ui.TAG)).isRunning, true, name);
    selected = { ...selected, tagNumber: '103HRJ01AN602', cycleStartRevision: 'ordinary-pending' };
    assert.equal((await toggle(selected.tagNumber)).action, 'startup', name);
  }
});
test('actual main Lime reload bridge accepts the same verified descendant without making a query on LF and CRLF', async () => {
  for (const [name, source] of historyVariants()) {
    let options, current = recoveredAsset(10); const reads = [], state = { data: { permissions: { canAdmin: true } } };
    const window = { BlowerLimestone2aFirstRun: { mount: value => { options = value; }, verifyReadback: ui.verifyReadback },
      sessionStorage: { getItem: () => null, setItem() {} } };
    const snippet = section(source, '    window.BlowerLimestone2aFirstRun?.mount({', '\n    elements.historyDialog.showModal();', name + ' mount bridge');
    new Function('window', 'elements', 'asset', 'document', 'findAsset', 'tagNumber', 'hasAuthenticatedWriteAccess',
      'state', 'isMobileMonitoringView', 'getSessionToken', 'setBusy', 'apiRequest', 'loadData', snippet)(window,
      { historyCycleSummary: {} }, current, {}, () => current, ui.TAG, () => true, state, () => false,
      () => 'fixture-session', () => {}, () => { throw Error('no query permitted'); }, async value => reads.push(value));
    assert.equal(options.canWrite(), true, name); state.data.permissions.canAdmin = false; assert.equal(options.canWrite(), false, name);
    assert.equal(await options.reload(ui.normalizeView(view({ applied: true, eligible: false, attestationRequired: false }))), true, name);
    assert.deepEqual(reads, [{ silent: true, syncOperations: false, strict: true }]);
    current.runtimeCoverageEvidence.limestone2aFirstRun.prefixRequestId = 'other';
    assert.equal(await options.reload(ui.normalizeView(view({ applied: true, eligible: false, attestationRequired: false }))), false, name);
  }
});
test('Limestone 2A preserved state boundary retains the measured integral and rejects a changed boundary anchor', () => {
  const asset = recoveredAsset(10), basis = asset.dataParcRuntimeBasis;
  const boundaryAt = new Date(Date.parse(basis.observedAt) + 60000).toISOString();
  const stateProof = { preservedStateBoundary: true, measuredState: 'running', currentState: 'stopped',
    currentAnchorAt: boundaryAt, currentObservedAt: basis.observedAt };
  basis.preservedStateBoundary = true; asset.cycleRuntimeState = 'stopped'; asset.cycleRuntimeAnchorAt = boundaryAt;
  asset.runRuntime.state = 'stopped';
  for (const owner of [asset.limestone2aFirstRunProof, basis.limestone2aFirstRun, asset.runtimeCoverageEvidence.limestone2aFirstRun])
    Object.assign(owner, stateProof);
  assert.equal(refresh.verifiedLimestone2aFirstRun(asset)?.preservedStateBoundary, true);
  assert.equal(ui.verifyReadback(asset, view()), true);
  assert.equal(basis.runningSeconds, TOTAL + 10, 'new state alone never invents extra RUN');
  asset.cycleRuntimeAnchorAt = basis.observedAt;
  assert.equal(refresh.verifiedLimestone2aFirstRun(asset), null); assert.equal(ui.verifyReadback(asset, view()), false);
});
