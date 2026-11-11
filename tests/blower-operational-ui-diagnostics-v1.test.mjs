import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../maintenance/blower-unified-refresh.js');
const assessor = require('../maintenance/blower-runtime-assessment.js');
const guide = require('../maintenance/blower-resolution-guide.js');
const source = fs.readFileSync(new URL('../maintenance/blower-history.js', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
const NOW = '2026-11-12T00:00:00.000Z', OBSERVED = '2026-11-11T15:00:00.000Z';
const HASH = 'a'.repeat(64), R9_ID = 'f0000000-0000-4000-8000-000000000001';
const OLD_SILO_ID = 'silo-preserved-request', SILO_NONCE = 'silo-preserved-nonce';
const modules = [
  ['BlowerSiloBasisRecovery', require('../maintenance/blower-silo-basis-recovery-v1.js'), '104ETH03AN602'],
  ['BlowerLimestone2aFirstRun', require('../maintenance/blower-limestone2a-first-run-v1.js'), '203HRJ01AN601'],
  ['BlowerLimestone1bFirstRun', require('../maintenance/blower-limestone1b-first-run-v1.js'), '103HRJ01AN602'],
  ['BlowerFbhe1bStandby', require('../maintenance/blower-fbhe1b-standby-v1.js'), '104HHL60AP621'],
  ['BlowerFbhe2cStandby', require('../maintenance/blower-fbhe2c-standby-v1.js'), '204HHL60AP631'],
  ['BlowerFbhe1aRuntime', require('../maintenance/blower-fbhe1a-runtime-v1.js'), '104HHL60AP611']
];
let sequence = 0;
function element(tag = 'div') {
  let markup = '';
  const node = { tag, children: [], parentNode: null, value: '', textContent: '', checked: false,
    hidden: false, disabled: false, required: false, open: false, dataset: {}, style: {}, title: '', listeners: new Map(), attributes: {},
    className: '', classList: { add() {}, remove() {}, toggle() {} },
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
    replaceChildren(...children) { this.children = []; for (const child of children) this.appendChild(child); },
    setAttribute(name, value) { this.attributes[name] = String(value); }, removeAttribute(name) { delete this.attributes[name]; },
    addEventListener(name, handler) { this.listeners.set(name, [...(this.listeners.get(name) || []), handler]); },
    fire(name, event = {}) { for (const handler of this.listeners.get(name) || []) handler({ target: this, ...event }); },
    showModal() { this.open = true; }, close() { this.open = false; }, focus() {}, scrollIntoView() {},
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); },
    contains(child) { return child === this || this.children.some(node => node.contains?.(child)); },
    closest() { return null; },
    querySelectorAll() { return []; }, querySelector() { return null; }
  };
  Object.defineProperty(node, 'innerHTML', { get() { return markup; }, set(value) { markup = String(value); this.children = []; } });
  return node;
}
function ordinaryAsset(tag = '104HHL60AP631', type = 'fbhe', unit = '1') {
  const signal = tag === '104ETH03AN602' ? 'GSPOGE.ABB_DCS.003ETH03AN602XB04' : `GSPOGE.ABB_DCS.${tag}XB04`;
  const start = '2026-10-01T00:00:00+09:00', hours = 12.5;
  return { tagNumber: tag, blowerType: type, unitNo: unit, displayName: `fixture ${tag}`, positionLabel: '#C', sortOrder: 1,
    enabled: true, lastReplacementAt: start, actualLastReplacementAt: start, cycleStartState: 'started',
    cycleStartedAt: start, cycleStoredStartedAt: start, cycleStartRevision: 'ordinary-start', cycleRuntimeRevision: 'ordinary-runtime',
    cycleRuntimeAnchorAt: OBSERVED, cycleRuntimeState: 'running', isRunning: true, severity: 'unset',
    cycleElapsedHours: hours, runtimeHours: hours, dataParcTag: signal, measurementRequired: false,
    runRuntime: { verified: true, source: 'dataparc', state: 'running', measuredAt: OBSERVED },
    dataParcRuntimeBasis: { requestId: 'ordinary-receipt', dataParcTag: signal, startAt: start, requiredStartAt: start,
      observedAt: OBSERVED, runningSeconds: hours * 3600, runtimeHours: hours, appendReady: true,
      coverageComplete: true, missingLeadingSeconds: 0, cycleBasisConfirmed: true },
    runtimeCoverageEvidence: { version: 1, source: 'dataparc', measurementVerified: true, requestId: 'ordinary-receipt',
      hours, startAt: start, requiredStartAt: start, observedAt: OBSERVED, coverageComplete: true,
      missingLeadingSeconds: 0, cycleBasisConfirmed: true, wholeCycleVerified: true } };
}
function verifiedStandbyAsset() {
  const asset = ordinaryAsset('104HHL60AP621');
  const origin = '2026-10-08T00:00:00+09:00', start = '2026-10-09T00:00:00+09:00';
  const metadata = { version: 1, certificateId: 'fbhe1b_standby:' + R9_ID,
    auditId: 'fbhe1b_standby_audit:' + R9_ID, r9RequestId: R9_ID, proofHash: HASH, sourceProofHash: 'b'.repeat(64),
    cycleStartRevision: 'standby-start', currentRuntimeRevision: 'standby-runtime', currentRunningSeconds: 0,
    currentState: 'stopped', currentAnchorAt: OBSERVED, currentObservedAt: OBSERVED, completionDay: '2026-10-08',
    lastRunStoppedAt: '2026-10-08T13:14:47.450+09:00', zeroWindowEndAt: start, measuredStartAt: start,
    completionClockKnown: false, durationEquivalent: true, originalTailRunningSeconds: 0,
    replacementCompletedAfterStop: true, noRestartAfterReplacement: true, sampleGoodCertified: false };
  Object.assign(asset, { lastReplacementAt: origin, actualLastReplacementAt: '', cycleStartState: 'pending',
    cycleStartedAt: '', cycleStoredStartedAt: '', cycleStartRevision: 'standby-start', cycleRuntimeRevision: 'standby-runtime',
    cycleRuntimeState: 'stopped', cycleElapsedHours: 0, runtimeHours: 0, isRunning: false, fbhe1bStandbyProof: { ...metadata } });
  Object.assign(asset.runRuntime, { state: 'stopped' });
  Object.assign(asset.dataParcRuntimeBasis, { composite: true, requestId: 'standby-tail', startAt: start,
    requiredStartAt: origin, runningSeconds: 0, runtimeHours: 0, cycleRuntimeRevision: 'standby-runtime',
    fbhe1bStandby: { ...metadata } });
  Object.assign(asset.runtimeCoverageEvidence, { requestId: 'standby-tail', hours: 0, startAt: start,
    requiredStartAt: origin, durationEquivalent: true, durationVerified: true, completionClockKnown: false,
    cycleBasisConfirmed: false, wholeCycleVerified: false, fbhe1bStandby: { ...metadata } });
  assert.ok(core.verifiedFbhe1bStandby(asset), 'fixture has a valid current certificate before visibility changes');
  return asset;
}
function harness(lineEnding = 'LF', options = {}) {
  const nodes = new Map(), network = [], r9 = [], mounts = [], active = [];
  const receipts = new Map(options.receipts || []); let mobile = false, session = 'synthetic-diagnostic-session-' + (++sequence);
  const storage = { getItem: key => receipts.get(key) || null, setItem: (key, value) => receipts.set(key, value),
    removeItem: key => receipts.delete(key) };
  const local = { getItem: () => session ? JSON.stringify({ employeeNo: 'SYNTHETIC', sessionToken: session }) : null,
    setItem() {}, removeItem() { session = ''; } };
  const docListeners = new Map(), windowListeners = new Map();
  const document = { readyState: 'loading', body: element('body'), createElement: element,
    querySelectorAll: () => [], querySelector: () => null,
    addEventListener(name, fn) { docListeners.set(name, [...(docListeners.get(name) || []), fn]); },
    getElementById(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); } };
  const window = { BlowerUnifiedRefresh: core, BlowerRuntimeAssessment: assessor, BlowerResolutionGuide: guide,
    BlowerR9Signal: { setDiagnosticsVisible(visible, data) { r9.push({ visible, data }); } },
    localStorage: local, sessionStorage: storage, crypto: { randomUUID: () => 'synthetic-diagnostic-nonce' },
    matchMedia: () => ({ matches: mobile }), setTimeout(fn) { fn(); },
    addEventListener(name, fn) { windowListeners.set(name, [...(windowListeners.get(name) || []), fn]); } };
  for (const [name, module, tag] of modules) window[name] = { ...module, mount(settings) {
    mounts.push({ name, tag: settings.asset?.tagNumber }); const controller = module.mount(settings);
    if (controller) active.push({ name, tag, controller }); return controller;
  } };
  const context = vm.createContext({ console, URL, URLSearchParams, clearTimeout() {}, setTimeout() {},
    HTMLButtonElement: class {}, navigator: {}, document, window, localStorage: local, sessionStorage: storage,
    fetch(...args) { network.push({ fetch: args }); throw Error('Presentation must not fetch'); } });
  const marker = '  if (document.readyState === "loading") {';
  assert.equal(source.split(marker).length, 2, 'one bounded main bootstrap marker');
  const expose = `globalThis.ui={state,elements,cacheElements,bindEvents,openAssetHistory,renderHeaderActions,
    diagnosticToolsAvailable,diagnosticToolsEnabled,setDiagnosticToolsVisible};
    globalThis.installHooks=h=>{apiRequest=h.api;loadData=h.load;showToast=()=>{};currentServerDate=()=>new Date('${NOW}');};\n`;
  let actual = source.replace(marker, expose + marker);
  if (lineEnding === 'CRLF') actual = actual.replace(/\n/g, '\r\n');
  vm.runInContext(actual, context, { filename: 'actual-blower-history-' + lineEnding + '.js' });
  const ui = context.ui; ui.cacheElements();
  const assets = options.assets || [verifiedStandbyAsset()];
  ui.state.data = { assets, types: [{ key: 'fbhe', label: 'FBHE Blower' }, { key: 'limestone', label: 'Limestone Blower' },
    { key: 'flyash_silo', label: 'Fly Ash Silo' }], events: [], settings: {}, missingSlots: [], missingTags: [], generatedAt: NOW,
    permissions: { canWrite: true, canAdmin: true }, user: { name: 'Synthetic', isSuperAdmin: true },
    backfill: { hasRun: true, status: 'complete' } };
  context.installHooks({ api: async settings => { network.push({ api: settings }); return options.response?.(settings) || { ok: true }; },
    load: async settings => { network.push({ load: settings }); } });
  ui.bindEvents();
  return { ui, nodes, network, r9, mounts, active, receipts, assets,
    setMobile: value => { mobile = value; }, setSession: value => { session = value; },
    fireWindow(name, event = {}) { for (const handler of windowListeners.get(name) || []) handler(event); },
    toggle(value) { const checkbox = ui.elements.diagnosticToolsToggle; checkbox.checked = value; checkbox.fire('change'); } };
}
const variants = ['LF', 'CRLF'];

test('default projected history never mounts any diagnostic module or makes requests, even with a valid certificate', () => {
  for (const ending of variants) {
    const h = harness(ending), before = structuredClone(h.assets);
    assert.equal(h.ui.state.diagnosticToolsVisible, false); h.ui.renderHeaderActions();
    h.ui.openAssetHistory(h.assets[0].tagNumber);
    assert.equal(h.ui.diagnosticToolsEnabled(), false); assert.equal(h.ui.elements.diagnosticToolsToggle.checked, false);
    assert.equal(h.ui.elements.historyRecoveryTools.hidden, true); assert.equal(h.mounts.length, 0);
    assert.equal(h.network.length, 0); assert.equal(h.ui.elements.historyDialog.open, true);
    assert.match(h.ui.elements.historyCycleSummary.innerHTML, /누적 운전시간|누적 기동시간/);
    assert.deepEqual(h.assets, before); assert.ok(h.r9.every(item => item.visible === false));
  }
});
test('explicit checkbox enables only the applicable real controller once per opened asset without fetching or posting', () => {
  for (const ending of variants) {
    const assets = modules.map(([, , tag]) => ordinaryAsset(tag,
      tag === '104ETH03AN602' ? 'flyash_silo' : tag.includes('HRJ') ? 'limestone' : 'fbhe',
      tag.startsWith('204') || tag.startsWith('203') ? '2' : tag === '104ETH03AN602' ? 'shared' : '1'));
    const h = harness(ending, { assets }); h.ui.renderHeaderActions();
    h.toggle(true); assert.equal(h.ui.diagnosticToolsEnabled(), true);
    for (const asset of assets) {
      const before = h.active.length; h.ui.openAssetHistory(asset.tagNumber);
      assert.equal(h.active.length, before + 1); assert.equal(h.active.at(-1).tag, asset.tagNumber);
      assert.equal(h.ui.elements.historyRecoveryTools.children.length, 1);
    }
    assert.equal(h.network.length, 0); assert.equal(h.ui.elements.historyRecoveryTools.hidden, false);
    assert.equal(h.r9.at(-1).visible, true); assert.equal(h.r9.at(-1).data, h.ui.state.data);
    assert.equal(h.ui.elements.diagnosticToolsToggle.listeners.get('change').length, 1);
  }
});
test('hiding and showing preserves pending receipts and reuses real controller bindings without automatic work', () => {
  for (const ending of variants) {
    const silo = modules[0][1], record = { version: 1, nonce: SILO_NONCE, proofHash: HASH, requestId: OLD_SILO_ID };
    const receipts = [[silo.KEY, JSON.stringify(record)], ['unrelated-retained-receipt', 'do-not-remove']];
    const h = harness(ending, { assets: [ordinaryAsset('104ETH03AN602', 'flyash_silo', 'shared')], receipts });
    const before = [...h.receipts]; h.ui.openAssetHistory('104ETH03AN602');
    h.toggle(true); const original = h.active.at(-1).controller;
    assert.equal(original.snapshot().phase, 'resume');
    for (let index = 0; index < 3; index++) {
      h.toggle(false); assert.equal(h.ui.elements.historyRecoveryTools.children.length, 0);
      h.toggle(true); assert.equal(h.active.at(-1).controller, original);
      assert.equal(h.ui.elements.historyRecoveryTools.children.length, 1);
    }
    assert.deepEqual([...h.receipts], before); assert.equal(h.network.length, 0);
    assert.equal(h.ui.elements.diagnosticToolsToggle.listeners.get('change').length, 1);
    const section = h.ui.elements.historyRecoveryTools.children[0], buttons = section.children.at(-1).children;
    for (const button of buttons) assert.equal(button.listeners.get('click')?.length, 1);
  }
});
test('mobile, read-only, non-superadmin and logged-out projections cannot enable diagnostic tools', () => {
  for (const ending of variants) for (const revoke of [
    h => h.setMobile(true), h => { h.ui.state.data.permissions.canWrite = false; },
    h => { h.ui.state.data.user.isSuperAdmin = false; }, h => { h.ui.state.data.user = null; },
    h => h.setSession('')
  ]) {
    const h = harness(ending); revoke(h); h.ui.renderHeaderActions(); h.toggle(true);
    h.ui.openAssetHistory(h.assets[0].tagNumber);
    assert.equal(h.ui.diagnosticToolsAvailable(), false); assert.equal(h.ui.diagnosticToolsEnabled(), false);
    assert.equal(h.ui.state.diagnosticToolsVisible, false); assert.equal(h.ui.elements.diagnosticToolsToggle.checked, false);
    assert.equal(h.ui.elements.diagnosticToolsToggle.disabled, true); assert.equal(h.mounts.length, 0);
    assert.equal(h.network.length, 0); assert.equal(h.ui.elements.historyRecoveryTools.children.length, 0);
  }
});
test('permission, mobile, logout or session changes reset visibility and never restore it automatically', () => {
  for (const ending of variants) for (const change of ['write', 'superadmin', 'mobile', 'logout', 'session']) {
    const h = harness(ending, { receipts: [['preserved-receipt', 'unchanged']] });
    h.ui.openAssetHistory(h.assets[0].tagNumber); h.toggle(true); assert.equal(h.ui.diagnosticToolsEnabled(), true);
    if (change === 'write') h.ui.state.data.permissions.canWrite = false;
    if (change === 'superadmin') h.ui.state.data.user.isSuperAdmin = false;
    if (change === 'mobile') h.setMobile(true);
    if (change === 'logout') h.setSession('');
    if (change === 'session') h.setSession('replacement-session');
    if (change === 'session') {
      const before = h.r9.length;
      h.fireWindow('storage', { key: 'unrelated.storage.key' });
      assert.equal(h.r9.length, before, 'unrelated storage events do not change diagnostic presentation');
      assert.equal(h.ui.state.diagnosticToolsVisible, true);
      h.fireWindow('storage', { key: 'gsShiftLog.currentUser' });
    } else if (change === 'logout') h.fireWindow('storage', { key: null });
    else if (change === 'mobile') h.fireWindow('focus');
    else h.ui.renderHeaderActions();
    assert.equal(h.ui.state.diagnosticToolsVisible, false); assert.equal(h.ui.elements.diagnosticToolsToggle.checked, false);
    assert.equal(h.ui.elements.historyRecoveryTools.hidden, true); assert.equal(h.ui.elements.historyRecoveryTools.children.length, 0);
    assert.equal(h.r9.at(-1).visible, false); assert.equal(h.receipts.get('preserved-receipt'), 'unchanged');
    h.ui.state.data.permissions.canWrite = true; h.ui.state.data.user.isSuperAdmin = true;
    h.setMobile(false); h.setSession('restored-session'); h.ui.renderHeaderActions();
    assert.equal(h.ui.diagnosticToolsEnabled(), false); assert.equal(h.ui.elements.diagnosticToolsToggle.checked, false);
    assert.equal(h.network.length, 0);
  }
});
test('diagnostic presentation leaves the operational summary and ordinary manual controls unchanged', () => {
  for (const ending of variants) {
    const asset = ordinaryAsset(), h = harness(ending, { assets: [asset] });
    h.ui.openAssetHistory(asset.tagNumber);
    const summary = h.ui.elements.historyCycleSummary.innerHTML;
    const controls = ['historyRuntimeStateButton', 'historyRuntimeQueryButton', 'historyRuntimeCorrectionButton'];
    assert.match(summary, /누적 운전시간|누적 기동시간/); assert.match(summary, /12.5시간/);
    for (const key of controls) assert.equal(h.ui.elements[key].hidden, false, key);
    h.toggle(true); assert.equal(h.ui.elements.historyCycleSummary.innerHTML, summary);
    h.toggle(false); assert.equal(h.ui.elements.historyCycleSummary.innerHTML, summary);
    for (const key of controls) assert.equal(h.ui.elements[key].hidden, false, key);
    assert.equal(h.ui.elements.historyCycleSummary.hidden, false); assert.equal(h.ui.elements.historyDialog.open, true);
    assert.equal(h.network.length, 0);
  }
});
