'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ui = require('../maintenance/blower-silo-basis-recovery-v1.js');
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
  const source = fs.readFileSync(require.resolve('../maintenance/blower-history.js'), 'utf8');
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
  const source = fs.readFileSync(require.resolve('../maintenance/blower-history.js'), 'utf8');
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
  const source = fs.readFileSync(require.resolve('../maintenance/blower-history.js'), 'utf8');
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
  const source = fs.readFileSync(require.resolve('../maintenance/blower-history.js'), 'utf8');
  const start = source.indexOf('    if (elements.historyRuntimeCorrectionButton) {');
  const end = source.indexOf('\n\n    elements.assetHistoryList', start);
  const render = new Function('elements', 'asset', 'hasAuthenticatedWriteAccess', 'awaitingBackfill', 'startupPending', source.slice(start, end));
  const setStart = source.indexOf('  const DATAPARC_RUNTIME_ASSET_TAGS = new Set([');
  const setEnd = source.indexOf('\n  ]);', setStart);
  const tags = [...source.slice(setStart, setEnd).matchAll(/"([0-9A-Z]+)"/g)].map(match => match[1]);
  assert.equal(tags.length, 27);
  for (const tagNumber of tags) {
    const button = {}, asset = { tagNumber, lastReplacementAt: '2026-01-01T00:00:00Z', cycleStartRevision: 'ordinary-cycle' };
    render({ historyRuntimeCorrectionButton: button }, asset, () => true, false, false);
    assert.equal(button.hidden, false, 'ordinary correction remains available: ' + tagNumber);
  }
  const recovered = { tagNumber: ui.TAG, lastReplacementAt: '2025-10-23T09:17:00+09:00', cycleStartRevision: 'silo-prefix-basis-v1:fixture' };
  const button = {}; render({ historyRuntimeCorrectionButton: button }, recovered, () => true, false, false);
  assert.equal(button.hidden, true); assert.equal(button.disabled, true);
  const dialogStart = source.indexOf('  function openRecordDialog(');
  const bodyEnd = source.indexOf('\n    resetRecordDialogVisibility();', dialogStart);
  let current = recovered, notices = [];
  const open = new Function('stopMobileMutation', 'findAsset', 'elements', 'showToast',
    source.slice(dialogStart, bodyEnd) + '\nreturn true;\n}\nreturn openRecordDialog;')(
    () => false, () => current, { recordDialog: {} }, message => notices.push(message));
  assert.equal(open('runtime', ui.TAG), undefined); assert.equal(notices.length, 1);
  assert.equal(open('replacement', ui.TAG), true); assert.equal(open('runtime_state', ui.TAG), true);
  current = { ...recovered, tagNumber: '104ETH03AN601' }; assert.equal(open('runtime', current.tagNumber), true);
  current = { ...recovered, cycleStartRevision: 'new-real-belt-cycle' }; assert.equal(open('runtime', ui.TAG), true);
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
  const history = fs.readFileSync(require.resolve('../maintenance/blower-history.js'), 'utf8');
  assert.match(html, /blower-silo-basis-recovery-v1\.js\?v=20261111-v1/);
  assert.match(html, /src="blower-history\.js\?[^"\n]*&siloBasis=20261111-v1/);
  assert.ok(html.indexOf('blower-silo-basis-recovery-v1.js') < html.indexOf('src="blower-history.js'));
  assert.match(history, /BlowerSiloBasisRecovery\?\.mount/);
  assert.equal(ui.mount({ container: {}, asset: { tagNumber: '104ETH03AN601' }, canWrite: () => true, isMobile: () => false }), null);
});
