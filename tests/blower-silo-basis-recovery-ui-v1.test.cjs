'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ui = require('../maintenance/blower-silo-basis-recovery-v1.js');
const normalizeLineEndings = source => source.replace(/\r\n?/g, '\n');
const readHistorySource = () => normalizeLineEndings(fs.readFileSync(require.resolve('../maintenance/blower-history.js'), 'utf8'));
function extractSection(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, label + ': start marker was not found');
  const end = source.indexOf(endMarker, start);
  assert.ok(end > start, label + ': end marker was not found after the start marker');
  return source.slice(start, end);
}
const PROOF = 'a'.repeat(64);
const requestId = 'silo-recovery-123';
function response(patch = {}) {
  return { ok: true, assetTag: ui.TAG, eligible: true, proofHash: PROOF,
    approvedCompletionAt: '2025-10-23T09:17:00+09:00',
    prefix: { startAt: '2025-10-23T09:17:00+09:00', endAt: '2026-05-10T00:00:00+09:00', chunkCount: 7 },
    tail: { startAt: '2026-05-10T00:00:00+09:00', observedAt: '2026-11-11T05:18:47+09:00', runningSeconds: 7602274 },
    quality: { sampleGoodCertified: false }, ...patch };
}
function complete(patch = {}) {
  return response({ request: { id: requestId, status: 'complete' },
    preview: { prefixRunningSeconds: 4000000, tailRunningSeconds: 7602274,
      totalRunningSeconds: 11602274, observedAt: '2026-11-11T05:18:47+09:00' }, ...patch });
}
function diagnosticResponse(patch = {}) {
  return { ok: true, diagnosticVersion: 2, readOnly: true, applyAllowed: false, requestState: 'complete',
    dimensionsScope: 'precondition_diagnostic',
    stages: [{ stage: 'EXISTING_REQUEST', outcome: 'pass' }, { stage: 'PREFIX_INTEGRITY', outcome: 'pass' },
      { stage: 'PREFIX_FRESHNESS', outcome: 'fail', reason: 'SILO_PREFIX_STALE' },
      { stage: 'DERIVE_APPEND_BASE', outcome: 'pass' }, { stage: 'BEFORE_GUARDS', outcome: 'pass' }],
    prefix: { integrity: 'pass', freshness: 'expired' }, proof: { compatible: true }, derivation: { valid: true },
    guards: { total: 8, passed: 8, failed: 0, combined: { outcome: 'pass' },
      checks: [{ index: 0, outcome: 'pass' }] },
    dimensions: { maxSqlBytes: 30356, maxBindings: 19, maxBoundValueBytes: 348227, serializedBytes: 1008477 }, ...patch };
}
function diagnosticV3(patch = {}) {
  return diagnosticResponse({ diagnosticVersion: 3,
    stages: ['EXISTING_REQUEST', 'PREFIX_INTEGRITY', 'LOAD_PROOF', 'COMPATIBILITY', 'BUILD_CERTIFICATE', 'DERIVE_APPEND_BASE', 'BEFORE_GUARDS']
      .map(stage => ({ stage, outcome: 'pass' })).concat({ stage: 'PREFIX_FRESHNESS', outcome: 'fail', reason: 'SILO_PREFIX_STALE' }),
    guards: { strategy: 'individual_atomic_v3', total: 11, passed: 11, failed: 0, combined: { outcome: 'skip' },
      checks: Array.from({ length: 11 }, (_, i) => ({ index: i + 1, outcome: 'pass' })) },
    applyGuardPlan: { strategy: 'individual_atomic_v3', beforeChecks: 11, afterChecks: 3, sameBatch: true }, ...patch });
}
async function expiredController(options = {}) {
  const old = { version: 1, nonce: 'r3-original-nonce-001', proofHash: PROOF, requestId };
  const store = new Map([[ui.KEY, JSON.stringify(old)]]);
  if (options.previousFailure) store.set(ui.FAILURE_KEY, JSON.stringify(options.previousFailure));
  const storage = { getItem: key => store.get(key) || null, setItem: (key, value) => store.set(key, value) };
  const h = harness({ storage, nonce: () => 'r3-new-nonce-001', ...options });
  h.set(complete({ eligible: false, code: 'SILO_PREFIX_STALE' })); await h.controller.refresh();
  h.set(diagnosticV3()); await h.controller.diagnose();
  return { ...h, store, old, storage };
}
async function readyController(h) {
  await h.controller.refresh(); h.set(response({ request: { id: requestId, status: 'pending' } }));
  await h.controller.start(); h.set(complete()); await h.controller.refresh();
}
function recoveredAsset(delta = 0) {
  const view = complete(), observedAt = new Date(Date.parse(view.preview.observedAt) + delta * 1000).toISOString();
  const certificate = { version: 1, prefixRequestId: requestId, certificateEventId: 'dataparc_silo_basis:' + requestId,
    approvedCompletionAt: '2025-10-23T09:17:00+09:00' };
  return { tagNumber: ui.TAG, lastReplacementAt: certificate.approvedCompletionAt,
    dataParcRuntimeBasis: { composite: true, coverageComplete: true, appendReady: true,
      dataParcTag: 'GSPOGE.ABB_DCS.003ETH03AN602XB04', startAt: certificate.approvedCompletionAt,
      runningSeconds: view.preview.totalRunningSeconds + delta, observedAt, siloBasis: { ...certificate } },
    runtimeCoverageEvidence: { source: 'dataparc', measurementVerified: true, wholeCycleVerified: true,
      cycleBasisConfirmed: true, composite: true, siloBasis: { ...certificate } } };
}
function harness(change = {}) {
  const saved = new Map(), calls = [], locks = [];
  let current = response(), reloads = 0;
  const deps = {
    getAsset: () => ({ tagNumber: ui.TAG, enabled: true }), isMobile: () => false,
    canWrite: () => true, session: () => 'session-not-stored', isBusy: () => false,
    setBusy: value => locks.push(value), nonce: () => 'fixture-nonce-123',
    storage: { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value) },
    api: async options => { calls.push(options); if (current instanceof Error) throw current; return current; },
    reload: async () => { reloads++; return true; }, ...change
  };
  const controller = ui.createController(deps);
  return { controller, calls, saved, locks, deps, set: value => { current = value; }, reloads: () => reloads };
}
test('loading the controller never fetches or starts a DataPARC query', () => {
  const h = harness();
  assert.equal(h.calls.length, 0);
  assert.equal(h.controller.snapshot().phase, 'idle');
  assert.equal(h.saved.size, 0);
});
test('verify is a read and start persists nonce before the one explicit POST', async () => {
  const h = harness();
  await h.controller.refresh();
  assert.match(h.calls[0].url, /action=silo_basis_recovery_status$/);
  assert.equal(h.calls[0].method, undefined);
  assert.equal(h.controller.snapshot().phase, 'verified');
  h.set(response({ request: { id: requestId, status: 'pending' } }));
  assert.equal(await h.controller.start(), true);
  assert.deepEqual(h.calls[1].body, { action: 'start_silo_basis_recovery', expectedProofHash: PROOF, nonce: 'fixture-nonce-123' });
  const saved = JSON.parse(h.saved.get(ui.KEY));
  assert.equal(saved.requestId, requestId);
  assert.doesNotMatch(JSON.stringify(saved), /session-not-stored|7602274|approvedCompletion/);
  assert.equal(await h.controller.start(), false);
  assert.equal(h.calls.length, 2, 'duplicate start is blocked after a request ID is known');
});
test('network-uncertain start keeps nonce and resumes GET by nonce; retry never issues a new nonce', async () => {
  const h = harness();
  await h.controller.refresh();
  h.set(new Error('private network detail must not reach UI'));
  assert.equal(await h.controller.start(), false);
  assert.equal(h.controller.snapshot().error, 'REQUEST_UNCERTAIN');
  h.set(response());
  await h.controller.refresh();
  assert.match(h.calls.at(-1).url, /&nonce=fixture-nonce-123$/);
  h.set(response({ request: { id: requestId, status: 'processing' } }));
  await h.controller.start();
  assert.equal(h.calls.at(-1).body.nonce, 'fixture-nonce-123');
  assert.equal(JSON.parse(h.saved.get(ui.KEY)).requestId, requestId);
});
test('a queued request is only checked; completed preview waits for explicit apply', async () => {
  const h = harness();
  await h.controller.refresh(); h.set(response({ request: { id: requestId, status: 'pending' } }));
  await h.controller.start(); h.set(complete());
  await h.controller.refresh();
  assert.equal(h.controller.snapshot().phase, 'ready');
  assert.equal(h.calls.filter(call => call.body?.action === 'apply_silo_basis_recovery').length, 0);
  h.set(complete({ applied: true }));
  assert.equal(await h.controller.apply(), true);
  assert.deepEqual(h.calls.at(-1).body, { action: 'apply_silo_basis_recovery', requestId,
    expectedProofHash: PROOF, confirmation: 'SILO_PREFIX_STITCH' });
  assert.equal(h.controller.snapshot().readbackVerified, true);
  assert.equal(h.reloads(), 1);
});
test('wrong asset, mobile, missing write permission, no session and busy state never make API calls', async () => {
  for (const changes of [
    { getAsset: () => ({ tagNumber: '104ETH03AN601' }) },
    { getAsset: () => ({ tagNumber: ui.TAG, enabled: false }) },
    { isMobile: () => true }, { canWrite: () => false }, { session: () => '' }, { isBusy: () => true }
  ]) {
    const h = harness(changes);
    assert.equal(await h.controller.refresh(), false);
    assert.equal(await h.controller.start(), false);
    assert.equal(await h.controller.apply(), false);
    assert.equal(h.calls.length, 0);
  }
});
test('source conflicts, invalid totals, wrong ranges and wrong assets cannot enable apply', async () => {
  const invalid = [response({ assetTag: '104ETH03AN601' }), response({ approvedCompletionAt: '2025-10-23T00:00:00+09:00' }),
    response({ prefix: { startAt: '2026-05-04T00:00:00+09:00', endAt: '2026-05-10T00:00:00+09:00' } }),
    complete({ preview: { prefixRunningSeconds: 4000000, tailRunningSeconds: 7602274, totalRunningSeconds: 1,
      observedAt: '2026-11-11T05:18:47+09:00' } })];
  for (const raw of invalid) assert.throws(() => ui.normalizeView(raw), /INVALID_RESPONSE/);
  const h = harness();
  await h.controller.refresh(); h.set(response({ request: { id: requestId, status: 'pending' } })); await h.controller.start();
  h.set(complete({ eligible: false })); await h.controller.refresh();
  assert.equal(h.controller.snapshot().phase, 'stale');
  assert.equal(await h.controller.apply(), false);
  assert.equal(h.calls.filter(call => call.body?.action === 'apply_silo_basis_recovery').length, 0);
});
test('lost apply response resumes existing request and confirms readback without another apply', async () => {
  const h = harness();
  await h.controller.refresh(); h.set(response({ request: { id: requestId, status: 'pending' } })); await h.controller.start();
  h.set(complete()); await h.controller.refresh(); h.set(new Error('lost response'));
  await h.controller.apply();
  h.set(complete({ replayed: true, eligible: false }));
  await h.controller.refresh();
  assert.equal(h.controller.snapshot().phase, 'applied');
  assert.equal(h.controller.snapshot().readbackVerified, true);
  assert.match(h.calls.at(-1).url, /requestId=silo-recovery-123/);
  assert.equal(h.calls.filter(call => call.body?.action === 'apply_silo_basis_recovery').length, 1);
});
test('a server-verified descendant tail refreshes the reviewed proof without creating another query', async () => {
  const h = harness(); await h.controller.refresh();
  h.set(response({ request: { id: requestId, status: 'pending' } })); await h.controller.start();
  const fresh = 'b'.repeat(64);
  h.set(complete({ proofHash: fresh })); await h.controller.refresh();
  assert.equal(h.controller.snapshot().phase, 'ready');
  assert.equal(JSON.parse(h.saved.get(ui.KEY)).proofHash, fresh);
  h.set(complete({ proofHash: fresh, applied: true })); await h.controller.apply();
  assert.equal(h.calls.at(-1).body.expectedProofHash, fresh);
  assert.equal(h.calls.filter(call => call.body?.action === 'start_silo_basis_recovery').length, 1);
});
test('readback accepts the same verified composite and its normal append descendants, rejecting lost ownership', () => {
  assert.equal(ui.verifyReadback(recoveredAsset(), complete()), true);
  assert.equal(ui.verifyReadback(recoveredAsset(10), complete()), true);
  const bad = [
    asset => { asset.dataParcRuntimeBasis.siloBasis.prefixRequestId = 'another-request'; },
    asset => { asset.runtimeCoverageEvidence.siloBasis.certificateEventId = 'another-certificate'; },
    asset => { asset.cycleSourceReview = { code: 'SILO_BASIS_SOURCE_CHANGED' }; },
    asset => { asset.runtimeCoverageEvidence.wholeCycleVerified = false; },
    asset => { asset.runtimeCoverageEvidence.source = 'unverified'; },
    asset => { asset.dataParcRuntimeBasis.composite = false; },
    asset => { asset.dataParcRuntimeBasis.runningSeconds = 1; },
    asset => { asset.dataParcRuntimeBasis.observedAt = '2026-11-10T00:00:00+09:00'; },
    asset => { asset.lastReplacementAt = '2026-05-04T00:00:00+09:00'; }
  ];
  for (const mutate of bad) { const asset = recoveredAsset(10); mutate(asset); assert.equal(ui.verifyReadback(asset, complete()), false); }
});
test('actual main history reload bridge accepts a verified append after applied replay without another query', async () => {
  const source = readHistorySource();
  const start = source.indexOf('    window.BlowerSiloBasisRecovery?.mount({');
  const closing = '\n    });', end = source.indexOf(closing, start);
  assert.ok(start > 0 && end > start);
  let options, saved = recoveredAsset(10), reads = [];
  const window = { BlowerSiloBasisRecovery: { mount: value => { options = value; }, verifyReadback: ui.verifyReadback },
    sessionStorage: { getItem: () => null, setItem() {} }, crypto: { randomUUID: () => 'fixture-nonce-123' } };
  const integrate = new Function('window', 'state', 'elements', 'asset', 'document', 'findAsset',
    'hasAuthenticatedWriteAccess', 'isMobileMonitoringView', 'getSessionToken', 'setBusy', 'apiRequest', 'loadData', 'tagNumber',
    source.slice(start, end + closing.length));
  integrate(window, { data: { permissions: { canAdmin: true } } }, { historyCycleSummary: {} }, saved, {}, () => saved,
    () => true, () => false, () => 'fixture-session', () => {}, () => { throw new Error('no query allowed'); },
    async value => { reads.push(value); }, ui.TAG);
  assert.equal(await options.reload(ui.normalizeView(complete({ replayed: true, eligible: false }))), true);
  assert.deepEqual(reads, [{ silent: true, syncOperations: false, strict: true }]);
  saved.runtimeCoverageEvidence.siloBasis.prefixRequestId = 'unrelated-prefix';
  assert.equal(await options.reload(ui.normalizeView(complete({ replayed: true, eligible: false }))), false);
});
test('actual edit/delete helpers protect every composite certificate and recovered Silo boundaries while preserving problem notes', () => {
  const source = readHistorySource();
  const start = source.indexOf('  function canEditAnyHistoryEvent(');
  const end = source.indexOf('\n  async function openHistoryDeleteDialog(', start);
  const helpers = new Function('hasAuthenticatedWriteAccess', 'isMobileMonitoringView', 'isInitialStartupBasis',
    source.slice(start, end) + '\nreturn { canEditAnyHistoryEvent, canDeleteManualHistoryEvent };')(() => true, () => false, () => false);
  const recovered = { tagNumber: ui.TAG, cycleStartRevision: 'silo-prefix-basis-v1:fixture' };
  const event = { tagNumber: ui.TAG, id: 'fixture-event', updatedAt: '2026-11-11T00:00:00Z', sourceType: 'manual' };
  for (const type of ['replacement', 'startup', 'operation_start', 'operation_stop', 'runtime_correction']) {
    for (const helper of Object.values(helpers)) assert.equal(helper(recovered, { ...event, eventType: type }), false, type);
  }
  for (const helper of Object.values(helpers)) {
    assert.equal(helper(recovered, { ...event, eventType: 'problem' }), true, 'ordinary problem notes remain editable');
    assert.equal(helper({ tagNumber: ui.TAG, cycleStartRevision: '' }, { ...event, eventType: 'replacement' }), true, 'unrecovered existing behavior');
    assert.equal(helper({ tagNumber: '104ETH03AN601' }, { ...event, tagNumber: '104ETH03AN601', eventType: 'replacement' }), true, 'other assets unchanged');
    assert.equal(helper({ tagNumber: '104ETH03AN601' }, { ...event, tagNumber: '104ETH03AN601', eventType: 'problem', sourceType: 'dataparc_silo_basis_v1' }), false,
      'certificate source is immutable regardless of active asset or retyped event');
    assert.equal(helper({ tagNumber: ui.TAG, cycleStartRevision: '' }, { ...event, eventType: 'runtime_correction', sourceType: 'dataparc_silo_basis_v1' }), false);
    assert.equal(helper({ tagNumber: ui.TAG, cycleStartRevision: '' }, { ...event, id: 'dataparc_silo_basis:fixture', eventType: 'problem' }), false);
  }
});
test('actual history edit dialog locks recovered Silo problem type while keeping note editing and other assets available', () => {
  const source = readHistorySource();
  const start = source.indexOf('  function openHistoryEventEditDialog('), end = source.indexOf('\n  async function submitHistoryEventEdit(', start);
  const makeDialog = new Function('stopMobileMutation', 'state', 'findAsset', 'findEvent', 'canEditAnyHistoryEvent', 'elements',
    'eventLabel', 'historySourceLabel', 'historyEditDateInput', 'formatKstDateTimeInput',
    source.slice(start, end) + '\nreturn openHistoryEventEditDialog;');
  let asset = { tagNumber: ui.TAG, displayName: 'Silo B', cycleStartRevision: 'silo-prefix-basis-v1:fixture' };
  const event = { id: 'note', tagNumber: ui.TAG, eventType: 'problem', note: 'keep this editable', updatedAt: '2026-11-11T00:00:00Z' };
  const nodes = {};
  for (const key of ['historyEventEditAsset', 'historyEventEditSource', 'historyEventEditType', 'historyEventEditDate',
    'historyEventEditRuntime', 'historyEventEditIssue', 'historyEventEditAction', 'historyEventEditNote', 'historyEventEditReason',
    'historyEventEditError', 'historyEventEditSave']) nodes[key] = { focus() {} };
  nodes.historyEventEditDialog = { showModal() {} }; nodes.historyDialog = { close() {} };
  const open = makeDialog(() => false, {}, () => asset, () => event, () => true, nodes,
    value => value, () => 'manual', value => value, () => '2026-11-11T00:00');
  open(ui.TAG, event.id);
  assert.equal(nodes.historyEventEditType.disabled, true);
  assert.equal(nodes.historyEventEditType.value, 'problem');
  assert.equal(nodes.historyEventEditNote.value, 'keep this editable');
  assert.equal(nodes.historyEventEditSave.disabled, false);
  asset = { tagNumber: '104ETH03AN601', displayName: 'Silo A', cycleStartRevision: '' };
  open(asset.tagNumber, event.id);
  assert.equal(nodes.historyEventEditType.disabled, false);
  assert.equal(nodes.historyEventEditType.title, '');
});
test('actual correction button hides only the current recovered Silo and direct runtime dialog keeps replacement/state creation available', () => {
  const lfSource = readHistorySource();
  for (const [lineEnding, rawSource] of [['LF', lfSource], ['CRLF', lfSource.replace(/\n/g, '\r\n')]]) {
    if (lineEnding === 'CRLF') assert.match(rawSource, /\r\n/);
    else assert.doesNotMatch(rawSource, /\r/);
    const source = normalizeLineEndings(rawSource);
    const correction = extractSection(source, '    if (elements.historyRuntimeCorrectionButton) {',
      '\n\n    const renderAssetHistoryEvent', lineEnding + ' correction button');
    const render = new Function('elements', 'asset', 'hasAuthenticatedWriteAccess', 'awaitingBackfill', 'startupPending', correction);
    const set = extractSection(source, '  const DATAPARC_RUNTIME_ASSET_TAGS = new Set([', '\n  ]);', lineEnding + ' supported assets');
    const tags = [...set.matchAll(/"([0-9A-Z]+)"/g)].map(match => match[1]);
    assert.equal(tags.length, 27);
    for (const tagNumber of tags) {
      const button = {}, asset = { tagNumber, lastReplacementAt: '2026-01-01T00:00:00Z', cycleStartRevision: 'ordinary-cycle' };
      render({ historyRuntimeCorrectionButton: button }, asset, () => true, false, false);
      assert.equal(button.hidden, false, lineEnding + ' ordinary correction remains available: ' + tagNumber);
    }
    const recovered = { tagNumber: ui.TAG, lastReplacementAt: '2025-10-23T09:17:00+09:00', cycleStartRevision: 'silo-prefix-basis-v1:fixture' };
    const button = {}; render({ historyRuntimeCorrectionButton: button }, recovered, () => true, false, false);
    assert.equal(button.hidden, true); assert.equal(button.disabled, true);
    const dialog = extractSection(source, '  function openRecordDialog(', '\n    resetRecordDialogVisibility();', lineEnding + ' record dialog');
    let current = recovered, notices = [];
    const open = new Function('stopMobileMutation', 'findAsset', 'elements', 'showToast',
      dialog + '\nreturn true;\n}\nreturn openRecordDialog;')(
      () => false, () => current, { recordDialog: {} }, message => notices.push(message));
    assert.equal(open('runtime', ui.TAG), undefined); assert.equal(notices.length, 1);
    assert.equal(open('replacement', ui.TAG), true); assert.equal(open('runtime_state', ui.TAG), true);
    current = { ...recovered, tagNumber: '104ETH03AN601' }; assert.equal(open('runtime', current.tagNumber), true);
    current = { ...recovered, cycleStartRevision: 'new-real-belt-cycle' }; assert.equal(open('runtime', ui.TAG), true);
  }
});
test('changed authentication and broken session storage stop before another mutation', async () => {
  const h = harness();
  await h.controller.refresh(); h.deps.session = () => 'changed-session';
  assert.equal(await h.controller.start(), false);
  assert.equal(h.calls.length, 1);
  const k = harness({ storage: { getItem: () => null, setItem: () => { throw new Error('blocked'); } } });
  await k.controller.refresh(); assert.equal(await k.controller.start(), false);
  assert.equal(k.calls.length, 1);
  assert.equal(k.controller.snapshot().error, 'STORAGE_UNAVAILABLE');
});
test('pending state survives controller reload and requires explicit status check', async () => {
  const h = harness(); await h.controller.refresh();
  h.set(response({ request: { id: requestId, status: 'pending' } })); await h.controller.start();
  const reloaded = ui.createController(h.deps);
  assert.equal(reloaded.snapshot().phase, 'resume'); assert.equal(h.calls.length, 2);
  await reloaded.refresh(); assert.match(h.calls.at(-1).url, /requestId=/);
});
test('a login change while an API call is pending cannot enable the returned proof', async () => {
  let session = 'original-session', settle;
  const h = harness({ session: () => session, api: () => new Promise(resolve => { settle = resolve; }) });
  const pending = h.controller.refresh();
  session = 'new-session'; settle(response());
  assert.equal(await pending, false);
  assert.equal(h.controller.snapshot().view, null);
  assert.equal(h.controller.snapshot().error, 'SESSION_CHANGED');
});
test('mounted history panel stays read-only until explicit check, start, review and apply clicks', async () => {
  function element(tag) {
    return { tag, children: [], handlers: {}, hidden: false, disabled: false, textContent: '',
      appendChild(child) { this.children.push(child); }, replaceChildren() { this.children = []; },
      setAttribute() {}, addEventListener(name, fn) { this.handlers[name] = fn; } };
  }
  const h = harness(), container = element('div'), document = { createElement: element };
  const controller = ui.mount({ ...h.deps, document, container, asset: { tagNumber: ui.TAG } });
  const section = container.children[0], buttons = section.children.at(-1).children;
  assert.equal(h.calls.length, 0); assert.equal(buttons[0].textContent, '승인 근거 확인');
  assert.equal(buttons[1].hidden, true); assert.equal(buttons[2].hidden, true);
  buttons[0].handlers.click(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(buttons[1].hidden, false);
  h.set(response({ request: { id: requestId, status: 'pending' } }));
  buttons[1].handlers.click(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(buttons[1].hidden, true); assert.equal(buttons[2].hidden, true);
  h.set(complete()); buttons[0].handlers.click(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(buttons[2].hidden, false);
  assert.ok(section.children[2].children.some(child => child.textContent === '반영할 전체 누적'));
  h.set(complete({ applied: true })); buttons[2].handlers.click(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(controller.snapshot().phase, 'applied');
  assert.equal(buttons[2].hidden, true);
  assert.match(section.children[4].textContent, /최신 값 대조를 완료/);
  assert.doesNotMatch(section.children.map(child => child.textContent).join(' '), /silo-recovery-123|session-not-stored/);
});
test('history integration is isolated to Silo and loaded before the history bridge with a cache token', () => {
  const html = fs.readFileSync(require.resolve('../maintenance/blower-history.html'), 'utf8');
  const history = readHistorySource();
  assert.match(html, /blower-silo-basis-recovery-v1\.js\?v=20261111-v3/);
  assert.match(html, /src="blower-history\.js\?[^"\n]*&siloBasis=20261111-v3/);
  assert.ok(html.indexOf('blower-silo-basis-recovery-v1.js') < html.indexOf('src="blower-history.js'));
  assert.match(history, /BlowerSiloBasisRecovery\?\.mount/);
  assert.equal(ui.mount({ container: {}, asset: { tagNumber: '104ETH03AN601' }, canWrite: () => true, isMobile: () => false }), null);
});
test('R2 keeps safe apply failure HTTP/stage/reason across successful status reads and a controller reload', async () => {
  const h = harness(); await readyController(h);
  const error = Object.assign(new Error('PRIVATE_TOKEN secret URL and raw SQL'), { status: 500,
    code: 'SILO_BASIS_STORAGE_FAILED', diagnostic: { stage: 'ATOMIC_BATCH', reason: 'D1_QUERY_INVALID', raw: 'PRIVATE_TOKEN' },
    responseKind: 'JSON', requestId: 'PRIVATE_REQUEST', token: 'PRIVATE_TOKEN' });
  h.set(error); assert.equal(await h.controller.apply(), false);
  const previous = h.controller.snapshot().lastFailure;
  assert.equal(previous.action, 'APPLY'); assert.equal(previous.httpStatus, 500);
  assert.equal(previous.stage, 'ATOMIC_BATCH'); assert.equal(previous.reason, 'D1_QUERY_INVALID');
  assert.doesNotMatch(h.saved.get(ui.FAILURE_KEY), /PRIVATE|secret|SQL|URL/);
  h.set(complete()); await h.controller.refresh();
  assert.deepEqual(h.controller.snapshot().lastFailure, previous);
  const reloaded = ui.createController(h.deps);
  assert.deepEqual(reloaded.snapshot().lastFailure, previous);
  assert.match(ui.failureSummary(previous), /HTTP 500/);
  assert.doesNotMatch(ui.diagnosticSummary(h.controller.snapshot()), /PRIVATE|silo-recovery-123|session-not-stored/);
});
test('R2 existing-request diagnostics use only one explicit GET, preserve the original record and keep expired results ineligible', async () => {
  const h = harness(); await readyController(h);
  const original = h.saved.get(ui.KEY), before = h.calls.length;
  h.set(diagnosticResponse());
  assert.equal(await h.controller.diagnose(), true);
  const calls = h.calls.slice(before);
  assert.equal(calls.length, 1); assert.equal(calls[0].method, undefined); assert.equal(calls[0].body, undefined);
  assert.match(calls[0].url, /^\/api\/blower-history\?action=silo_basis_recovery_diagnostics&requestId=silo-recovery-123$/);
  assert.equal(h.saved.get(ui.KEY), original);
  assert.equal(h.controller.snapshot().phase, 'stale');
  assert.equal(h.controller.snapshot().view.code, 'SILO_PREFIX_STALE');
  assert.equal(h.controller.snapshot().diagnostics.prefix.integrity, 'pass');
  assert.equal(h.controller.snapshot().diagnostics.applyAllowed, false);
  assert.equal(await h.controller.apply(), false);
  assert.equal(h.calls.length, before + 1, 'diagnostics and expired apply never create a POST');
  const text = ui.diagnosticSummary(h.controller.snapshot());
  assert.match(text, /readOnly=true · applyAllowed=false/); assert.match(text, /유효기간: 만료/);
  assert.match(text, /precondition_diagnostic/); assert.match(text, /원본: 통과/);
});
test('R2 read-only diagnostics do not invent a request or replace stored apply failure when diagnostics fail', async () => {
  const empty = harness(); assert.equal(await empty.controller.diagnose(), false); assert.equal(empty.calls.length, 0);
  const h = harness(); await readyController(h);
  h.set(Object.assign(new Error('private'), { status: 504, code: 'REQUEST_TIMEOUT' })); await h.controller.apply();
  const before = h.controller.snapshot().lastFailure;
  h.set(Object.assign(new Error('different private'), { status: 500, code: 'HTTP_ERROR' })); await h.controller.diagnose();
  assert.deepEqual(h.controller.snapshot().lastFailure, before);
  assert.equal(h.controller.snapshot().diagnostics, null);
});
test('R2 old version-one record stays compatible and no historical HTTP status is fabricated', () => {
  const saved = JSON.stringify({ version: 1, nonce: 'old-fixture-nonce', proofHash: PROOF, requestId });
  const h = harness({ storage: { getItem: key => key === ui.KEY ? saved : null, setItem() {} } });
  assert.equal(h.controller.snapshot().phase, 'resume'); assert.equal(h.controller.hasRequest(), true);
  assert.equal(h.controller.snapshot().lastFailure, null);
  assert.doesNotMatch(ui.failureSummary(null), /HTTP [0-9]/);
});
test('R2 stale status keeps an explicit expiry code apart from the persisted earlier apply failure', async () => {
  const h = harness(); await readyController(h);
  h.set(Object.assign(new Error('private'), { status: 500, code: 'HTTP_ERROR' })); await h.controller.apply();
  h.set(complete({ eligible: false, code: 'SILO_PREFIX_STALE', message: 'PRIVATE_MESSAGE' })); await h.controller.refresh();
  const state = h.controller.snapshot();
  assert.equal(state.phase, 'stale'); assert.equal(state.view.code, 'SILO_PREFIX_STALE');
  assert.equal(state.lastFailure.httpStatus, 500); assert.equal(state.lastFailure.action, 'APPLY');
  assert.match(ui.diagnosticSummary(state), /SILO_PREFIX_STALE/);
  assert.doesNotMatch(ui.diagnosticSummary(state), /PRIVATE_MESSAGE/);
});
test('R2 malicious diagnostic strings and failure fields never enter normalized output or copied summary', () => {
  const secret = 'PRIVATE_TOKEN_SESSION_EMPLOYEE_REQUEST_SQL';
  const raw = diagnosticResponse({ requestState: secret, requestId: secret, token: secret,
    stages: [{ stage: secret, outcome: secret, reason: secret, raw: secret }],
    guards: { total: secret, passed: -1, failed: Infinity, combined: { outcome: 'fail', reason: 'D1_QUERY_INVALID', raw: secret },
      checks: [{ index: secret, outcome: secret, reason: secret }] },
    dimensions: { maxSqlBytes: secret, maxBindings: 1e15, maxBoundValueBytes: {}, serializedBytes: NaN } });
  const normalized = ui.normalizeDiagnostics(raw);
  const failure = ui.safeFailure({ action: 'APPLY', httpStatus: '500', code: secret, stage: secret,
    reason: secret, responseKind: secret, atUtc: secret, elapsedMs: secret, raw: secret });
  assert.equal(failure.httpStatus, null); assert.equal(failure.code, 'UNKNOWN');
  const summary = ui.diagnosticSummary({ diagnostics: normalized, lastFailure: failure });
  assert.doesNotMatch(JSON.stringify(normalized) + JSON.stringify(failure) + summary, /PRIVATE|EMPLOYEE|SESSION/);
  assert.match(summary, /통합 비교: 실패 \[D1_QUERY_INVALID\]/);
  assert.throws(() => ui.normalizeDiagnostics({ ...raw, readOnly: false }), /INVALID_RESPONSE/);
  assert.throws(() => ui.normalizeDiagnostics({ ...raw, applyAllowed: true }), /INVALID_RESPONSE/);
});
test('R2 an unexecuted freshness check is distinct from expiry after invalid prefix integrity', () => {
  const normalized = ui.normalizeDiagnostics(diagnosticResponse({ prefix: { integrity: 'fail', freshness: 'skip' },
    stages: [{ stage: 'PREFIX_INTEGRITY', outcome: 'fail', reason: 'SILO_PREFIX_SUM_INVALID' },
      { stage: 'PREFIX_FRESHNESS', outcome: 'skip' }], derivation: { valid: null } }));
  const summary = ui.diagnosticSummary({ diagnostics: normalized });
  assert.match(summary, /앞 구간 원본: 실패 · 유효기간: 미실행/);
  assert.doesNotMatch(summary, /유효기간: 만료/);
  assert.equal(normalized.applyAllowed, false);
});
test('R2 classifies readback failures separately from the already accepted apply response', async () => {
  const h = harness({ reload: async () => { throw Object.assign(new Error('private'), { status: 503, code: 'HTTP_ERROR' }); } });
  await readyController(h); h.set(complete({ applied: true }));
  await h.controller.apply();
  assert.equal(h.controller.snapshot().lastFailure.action, 'READBACK');
  assert.equal(h.controller.snapshot().lastFailure.stage, 'READBACK');
  assert.equal(h.controller.snapshot().lastFailure.httpStatus, 503);
});
test('R2 mounted diagnostic controls are explicit, copy only sanitized results, and hide the copy button without clipboard support', async () => {
  function element(tag) { return { tag, children: [], handlers: {}, hidden: false, disabled: false, textContent: '',
    appendChild(child) { this.children.push(child); }, replaceChildren() { this.children = []; }, setAttribute() {},
    addEventListener(name, fn) { this.handlers[name] = fn; } }; }
  const old = JSON.stringify({ version: 1, nonce: 'old-fixture-nonce', proofHash: PROOF, requestId });
  const h = harness({ session: () => 'r2-clipboard-session',
    storage: { getItem: key => key === ui.KEY ? old : null, setItem() {} } });
  const container = element('div'); let copied = '';
  const controller = ui.mount({ ...h.deps, document: { createElement: element }, container, asset: { tagNumber: ui.TAG },
    clipboard: { writeText: async value => { copied = value; } } });
  const section = container.children[0], buttons = section.children.at(-1).children;
  assert.equal(h.calls.length, 0); assert.equal(buttons[3].hidden, false);
  assert.equal(buttons[3].textContent, '저장 오류 점검 (읽기 전용)'); assert.equal(buttons[4].hidden, true);
  h.set(diagnosticResponse()); buttons[3].handlers.click(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.calls.length, 1); assert.equal(buttons[4].hidden, false);
  await buttons[4].handlers.click();
  assert.match(copied, /readOnly=true · applyAllowed=false/);
  assert.doesNotMatch(copied, /silo-recovery-123|old-fixture-nonce|r2-clipboard-session/);
  assert.equal(h.calls.length, 1, 'copy does not call the server');
  assert.equal(controller.snapshot().diagnostics.prefix.freshness, 'expired');
  const other = element('div');
  ui.mount({ ...h.deps, session: () => 'r2-no-clipboard-session', document: { createElement: element }, container: other,
    asset: { tagNumber: ui.TAG }, clipboard: {} });
  assert.equal(other.children[0].children.at(-1).children[4].hidden, true);
});
test('R3 readonly plan never applies or renews automatically and explains the same-transaction individual guard plan', async () => {
  const h = await expiredController();
  assert.equal(h.controller.canRenew(), true);
  assert.equal(h.calls.filter(call => call.method === 'POST').length, 0);
  assert.equal(h.controller.snapshot().phase, 'stale');
  assert.equal(await h.controller.apply(), false);
  const summary = ui.diagnosticSummary(h.controller.snapshot());
  assert.match(summary, /저장 전 11개 · 저장 후 3개 · 하나의 트랜잭션에서 검사/);
  assert.match(summary, /실제 반영은 별도/); assert.match(summary, /applyAllowed=false/);
});
test('R3 explicit renew rechecks expired status, durably archives the old record, and saves the new nonce before its sole POST', async () => {
  const failure = { action: 'APPLY', httpStatus: 500, code: 'HTTP_ERROR', stage: 'UNKNOWN', reason: 'UNKNOWN' };
  const h = await expiredController({ previousFailure: failure });
  const prior = JSON.stringify(h.old), fresh = 'c'.repeat(64), newId = 'r3-new-request-001';
  const before = h.calls.length;
  h.deps.api = async options => {
    h.calls.push(options);
    if (!options.method) return complete({ eligible: false, code: 'SILO_PREFIX_STALE', proofHash: fresh });
    assert.deepEqual(JSON.parse(h.store.get(ui.HISTORY_KEY)), [h.old]);
    assert.equal(JSON.stringify(JSON.parse(h.store.get(ui.HISTORY_KEY))[0]), prior);
    assert.deepEqual(JSON.parse(h.store.get(ui.KEY)), { version: 1, nonce: 'r3-new-nonce-001', proofHash: fresh, requestId: '' });
    assert.equal(h.store.get(ui.FAILURE_KEY), JSON.stringify(failure));
    assert.deepEqual(options.body, { action: 'start_silo_basis_recovery', nonce: 'r3-new-nonce-001', expectedProofHash: fresh });
    return response({ proofHash: fresh, request: { id: newId, status: 'pending' } });
  };
  assert.equal(await h.controller.renew(), true);
  assert.equal(h.calls.length, before + 2); assert.match(h.calls[before].url, /requestId=silo-recovery-123$/);
  assert.equal(h.calls[before + 1].method, 'POST');
  assert.equal(JSON.parse(h.store.get(ui.KEY)).requestId, newId);
  assert.equal(h.controller.canRenew(), false); assert.equal(h.controller.snapshot().phase, 'queued');
  assert.equal(h.controller.snapshot().lastFailure.action, 'APPLY'); assert.equal(h.controller.snapshot().lastFailure.httpStatus, 500);
});
test('R3 uncertain renewed start retains its new nonce for reload and GET resume without another DataPARC request', async () => {
  const h = await expiredController();
  h.deps.api = async options => { h.calls.push(options);
    if (!options.method) return complete({ eligible: false, code: 'SILO_PREFIX_STALE' });
    throw Object.assign(new Error('uncertain'), { status: 0, code: 'NETWORK_ERROR' }); };
  assert.equal(await h.controller.renew(), false);
  const current = JSON.parse(h.store.get(ui.KEY)); assert.equal(current.nonce, 'r3-new-nonce-001'); assert.equal(current.requestId, '');
  assert.deepEqual(JSON.parse(h.store.get(ui.HISTORY_KEY)), [h.old]);
  const before = h.calls.length;
  h.deps.api = async options => { h.calls.push(options); return response({ request: { id: 'r3-resumed-request', status: 'pending' } }); };
  const reloaded = ui.createController(h.deps); assert.equal(reloaded.snapshot().phase, 'resume');
  await reloaded.refresh(); assert.equal(h.calls.length, before + 1);
  assert.match(h.calls.at(-1).url, /nonce=r3-new-nonce-001$/); assert.equal(h.calls.at(-1).method, undefined);
  assert.equal(JSON.parse(h.store.get(ui.KEY)).requestId, 'r3-resumed-request');
});
test('R3 explicit retry after uncertain renewal reuses the saved nonce and prevents double-click creation', async () => {
  const h = await expiredController(); let settle;
  h.deps.api = options => { h.calls.push(options);
    if (!options.method) return new Promise(resolve => { settle = resolve; });
    return Promise.reject(Object.assign(new Error('uncertain'), { status: 504, code: 'REQUEST_TIMEOUT' })); };
  const before = h.calls.length, first = h.controller.renew();
  assert.equal(await h.controller.renew(), false); assert.equal(h.calls.length, before + 1);
  settle(complete({ eligible: false, code: 'SILO_PREFIX_STALE' })); await first;
  h.deps.nonce = () => { throw new Error('must not create another nonce'); };
  h.deps.api = async options => { h.calls.push(options); assert.equal(options.body.nonce, 'r3-new-nonce-001');
    return response({ request: { id: 'r3-retried-request', status: 'pending' } }); };
  assert.equal(await h.controller.start(), true);
  assert.equal(JSON.parse(h.store.get(ui.KEY)).requestId, 'r3-retried-request');
  assert.deepEqual(JSON.parse(h.store.get(ui.HISTORY_KEY)), [h.old]);
});
test('R3 every required V3 layout, source, integrity, derivation and individual check is necessary for renewal', async () => {
  const cases = [
    d => { d.diagnosticVersion = 2; }, d => { d.guards.strategy = 'unknown'; },
    d => { d.guards.combined.outcome = 'fail'; }, d => { d.applyGuardPlan.sameBatch = false; },
    d => { d.applyGuardPlan.beforeChecks = 10; }, d => { d.applyGuardPlan.afterChecks = 2; },
    d => { d.proof.compatible = false; }, d => { d.derivation.valid = false; },
    d => { d.prefix.integrity = 'fail'; }, d => { d.prefix.freshness = 'fresh'; },
    d => { d.requestState = 'pending'; }, d => { d.guards.checks.pop(); },
    d => { d.guards.checks[0].index = 2; }, d => { d.guards.checks[0].outcome = 'fail'; },
    d => { d.stages.find(s => s.stage === 'LOAD_PROOF').outcome = 'fail'; }
  ];
  for (const change of cases) {
    const h = await expiredController(), raw = diagnosticV3(); change(raw);
    h.set(raw); await h.controller.diagnose();
    assert.equal(h.controller.canRenew(), false);
    const count = h.calls.length; assert.equal(await h.controller.renew(), false); assert.equal(h.calls.length, count);
    assert.equal(h.store.get(ui.HISTORY_KEY), undefined);
  }
});
test('R3 status or source changes, archive failure and new-record persistence failure stop before any POST', async () => {
  for (const mode of ['source_changed', 'already_applied', 'archive_write', 'archive_readback', 'primary_write', 'primary_readback', 'history_full']) {
    const h = await expiredController();
    if (mode === 'history_full') h.store.set(ui.HISTORY_KEY, JSON.stringify(Array.from({ length: 10 }, (_, i) =>
      ({ version: 1, nonce: 'archived-nonce-' + i, proofHash: PROOF, requestId: 'archived-request-' + i }))));
    const setItem = h.deps.storage.setItem;
    if (mode === 'archive_readback') {
      const getItem = h.deps.storage.getItem;
      h.deps.storage.getItem = key => key === ui.HISTORY_KEY ? null : getItem(key);
    }
    if (mode === 'primary_readback') {
      const getItem = h.deps.storage.getItem, original = h.store.get(ui.KEY);
      h.deps.storage.getItem = key => key === ui.KEY ? original : getItem(key);
    }
    h.deps.storage.setItem = (key, value) => {
      if (mode === 'archive_write' && key === ui.HISTORY_KEY || mode === 'primary_write' && key === ui.KEY) throw new Error('storage blocked');
      setItem(key, value);
    };
    h.deps.api = async options => { h.calls.push(options); assert.equal(options.method, undefined);
      return mode === 'source_changed' ? complete({ eligible: false, code: 'SILO_BASIS_SOURCE_CONFLICT' })
        : mode === 'already_applied' ? complete({ eligible: false, applied: true })
          : complete({ eligible: false, code: 'SILO_PREFIX_STALE' }); };
    const original = h.store.get(ui.KEY); assert.equal(await h.controller.renew(), false, mode);
    if (mode === 'primary_readback') {
      assert.equal(JSON.parse(h.store.get(ui.KEY)).nonce, 'r3-new-nonce-001');
      assert.equal(JSON.parse(h.store.get(ui.KEY)).requestId, '');
      assert.deepEqual(JSON.parse(h.store.get(ui.HISTORY_KEY)), [h.old]);
    } else assert.equal(h.store.get(ui.KEY), original, mode);
    if (mode === 'primary_write') assert.deepEqual(JSON.parse(h.store.get(ui.HISTORY_KEY)), [h.old]);
    if (mode === 'history_full') {
      assert.equal(h.controller.snapshot().error, 'ARCHIVE_FULL');
      assert.equal(JSON.parse(h.store.get(ui.HISTORY_KEY)).length, 10);
    }
    assert.equal(h.calls.filter(call => call.method === 'POST').length, 0, mode);
  }
});
