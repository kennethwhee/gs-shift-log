import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const timeline = require('../maintenance/blower-history-timeline-v1.js');
const core = require('../maintenance/blower-unified-refresh.js');
const assessment = require('../maintenance/blower-runtime-assessment.js');
const resolution = require('../maintenance/blower-resolution-guide.js');
const main = fs.readFileSync(new URL('../maintenance/blower-history.js', import.meta.url), 'utf8');
const TAG = '104SDF01AN001', NOW = '2026-11-12T04:30:00.000Z', REPLACED = '2026-08-20T00:00:00+09:00';

function element() {
  return {
    value: '', textContent: '', innerHTML: '', hidden: false, disabled: false, required: false,
    open: false, dataset: {}, listeners: {}, classList: {toggle() {}, add() {}, remove() {}},
    setAttribute() {}, removeAttribute() {}, focus() {},
    replaceChildren() { this.innerHTML = ''; this.textContent = ''; },
    addEventListener(type, fn) { this.listeners[type] = fn; },
    showModal() { this.open = true; }, close() { this.open = false; }
  };
}

function ordinary(id, at = NOW, patch = {}) {
  const source = {
    schemaVersion: 1, requestType: 'blower_runtime_probe', requestId: id, assetTag: TAG,
    dataParcTag: 'GSPOGE.ABB_DCS.' + TAG + 'XB04', startAt: REPLACED, endAt: at, observedAt: at,
    runningSeconds: 7200, startState: 'stopped', endState: 'running',
    expectedLastReplacementAt: REPLACED, expectedCycleStartState: 'legacy',
    expectedCycleStartRevision: 'same-belt-cycle', expectedCycleRuntimeRevision: 'earlier-runtime'
  };
  return {
    id: 'dataparc_runtime:' + id, tagNumber: TAG, blowerType: 'organic_fuel', displayName: '#1 유기성 Blower #A',
    positionLabel: '#A', eventType: 'runtime_correction', sourceType: 'dataparc_runtime', sourceLogId: id,
    eventDate: at, runtimeHours: 2, issueType: '', actionType: '자동 조회',
    note: 'AUTO-' + id, sourceText: JSON.stringify(source), createdAt: at, updatedAt: at, ...patch
  };
}

function mixedEvents() {
  const last = ordinary('latest');
  const old = ordinary('old', '2026-11-11T04:30:00.000Z');
  const base = {tagNumber: TAG, blowerType: 'organic_fuel', positionLabel: '#A', displayName: '#1 유기성 Blower #A',
    eventDate: REPLACED, runtimeHours: 0, createdAt: REPLACED, updatedAt: REPLACED, sourceType: 'manual'};
  const override = ordinary('override', '2026-11-10T04:30:00.000Z');
  override.note = 'MANUAL-OVERRIDE';
  override.sourceText = JSON.stringify({...JSON.parse(override.sourceText), manualOverride: true});
  const edited = ordinary('edited', '2026-11-09T04:30:00.000Z', {updatedAt: NOW, note: 'EDITED-RAW-RECEIPT'});
  return [last,
    {...base, id: 'manual-belt', eventType: 'replacement', note: 'BELT-COMPLETED · 완료시각 미기록'},
    {...base, id: 'manual-counter', eventType: 'runtime_correction', note: 'MANUAL-COUNTER'},
    {...base, id: 'custom-certificate', eventType: 'runtime_correction', sourceType: 'dataparc_fbhe1a_runtime_v1', note: 'CUSTOM-CERTIFICATE · 완료시각 미기록'},
    old, override, edited,
    {...base, id: 'manual-problem', eventType: 'problem', note: 'VISIBLE-PROBLEM'},
    {...base, id: 'manual-stop', eventType: 'operation_stop', note: 'MANUAL-STOP'},
    {...base, id: 'worklog-belt', eventType: 'replacement', sourceType: 'shift_log_auto_v3', replacementAutoV3: true,
      sourceTimePrecision: 'day', note: 'WORKLOG-BELT', sourceText: 'WORKLOG-BELT'}
  ];
}

function harness({helper = true} = {}) {
  const nodes = new Map(), calls = [], storageWrites = [], recoveryMounts = [];
  const stored = new Map([['existing-request', 'preserved-request-id'], ['existing-nonce', 'preserved-nonce']]);
  const localStorage = {
    getItem(key) { return key === 'gsShiftLog.currentUser' ? JSON.stringify({employeeNo: 'operator', name: 'Operator', sessionToken: 'same-session'}) : null; },
    setItem(...args) { storageWrites.push(['local-set', ...args]); }, removeItem(...args) { storageWrites.push(['local-remove', ...args]); }
  };
  const sessionStorage = {
    getItem: key => stored.get(key) || null,
    setItem(...args) { storageWrites.push(['session-set', ...args]); }, removeItem(...args) { storageWrites.push(['session-remove', ...args]); }
  };
  const window = {
    addEventListener() {}, matchMedia: () => ({matches: false}), setTimeout() {},
    sessionStorage, localStorage, BlowerUnifiedRefresh: core, BlowerRuntimeAssessment: assessment, BlowerResolutionGuide: resolution,
    ...(helper ? {BlowerHistoryTimeline: timeline} : {})
  };
  for (const key of ['BlowerSiloBasisRecovery', 'BlowerLimestone2aFirstRun', 'BlowerLimestone1bFirstRun',
    'BlowerFbhe1bStandby', 'BlowerFbhe2cStandby', 'BlowerFbhe1aRuntime']) window[key] = {mount() { recoveryMounts.push(key); }};
  const context = vm.createContext({console, HTMLButtonElement: class {}, localStorage, sessionStorage, window,
    fetch(...args) { calls.push(args); throw new Error('Rendering must not call the network'); },
    document: {readyState: 'loading', body: element(), querySelectorAll: () => [], addEventListener() {},
      getElementById(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); }}
  });
  const marker = '  if (document.readyState === "loading") {';
  const hooks = `globalThis.ui={state,elements,cacheElements,bindEvents,renderHistory,openAssetHistory,getVisibleEvents,getAssetEvents,getRawAssetEvents,getLatestDataParcRuntimeBasis};
    globalThis.installHooks=()=>{apiRequest=async (...args)=>{globalThis.networkCalls.push(args);throw new Error('Unexpected API call');};currentServerDate=()=>new Date('${NOW}');};\n`;
  assert.equal(main.split(marker).length, 2);
  context.networkCalls = calls;
  vm.runInContext(main.replace(marker, hooks + marker), context);
  context.installHooks();
  const ui = context.ui;
  ui.cacheElements(); ui.bindEvents();
  const asset = {tagNumber: TAG, blowerType: 'organic_fuel', unitNo: '1', displayName: '#1 유기성 Blower #A', positionLabel: '#A', enabled: true,
    lastReplacementAt: REPLACED, cycleStartState: 'legacy', cycleStartedAt: '', cycleStoredStartedAt: '',
    cycleStartRevision: 'same-belt-cycle', cycleRuntimeRevision: 'latest-runtime', cycleRuntimeAnchorAt: NOW,
    cycleElapsedHours: 2, runtimeHours: 2, cycleRuntimeState: 'running', cycleRuntimeTracked: true, isRunning: true,
    severity: 'normal', dataParcTag: 'GSPOGE.ABB_DCS.' + TAG + 'XB04'};
  ui.state.data = {permissions: {canWrite: true, canAdmin: true}, user: {employeeNo: 'operator', name: 'Operator', isSuperAdmin: true},
    backfill: {hasRun: true, status: 'complete'}, assets: [asset], events: mixedEvents(), generatedAt: NOW,
    types: [{key: 'organic_fuel', label: '유기성 Blower'}], settings: {}, missingSlots: [], missingTags: []};
  ui.elements.historyFilter.value = 'all';
  return {ui, asset, calls, storageWrites, recoveryMounts, stored};
}

function split(markup) {
  const at = markup.indexOf('<details');
  return {major: at < 0 ? markup : markup.slice(0, at), group: at < 0 ? '' : markup.slice(at)};
}

test('actual asset-dialog render groups only ordinary query receipts and preserves raw proof getters and edit access', () => {
  const h = harness(), original = h.ui.state.data.events, before = JSON.stringify(original);
  const rawBefore = h.ui.getRawAssetEvents(TAG), latestBefore = h.ui.getLatestDataParcRuntimeBasis(TAG);
  h.ui.openAssetHistory(TAG);
  const {major, group} = split(h.ui.elements.assetHistoryList.innerHTML);
  assert.match(group, /자동 운전시간 조회 2건/);
  assert.doesNotMatch(group, /<details[^>]*\bopen(?:\s|=|>)/);
  for (const id of ['manual-belt', 'manual-counter', 'custom-certificate', 'dataparc_runtime:override', 'dataparc_runtime:edited', 'manual-problem', 'manual-stop', 'worklog-belt']) {
    assert.ok(major.includes(id) || major.includes(original.find(e => e.id === id).note), id + ' remains prominent');
  }
  assert.match(major, /data-history-action="history_event_edit" data-event-id="manual-counter"/);
  assert.match(major, /data-history-action="history_event_delete" data-event-id="manual-belt"/);
  assert.match(major, /완료시각 미기록/);
  assert.match(group, /data-event-id="dataparc_runtime:latest"/);
  assert.match(group, /data-event-id="dataparc_runtime:old"/);
  assert.equal(h.ui.state.data.events, original);
  assert.equal(JSON.stringify(original), before);
  assert.deepEqual(h.ui.getRawAssetEvents(TAG), rawBefore);
  assert.deepEqual(h.ui.getLatestDataParcRuntimeBasis(TAG), latestBefore);
  assert.equal(h.ui.getAssetEvents(TAG).length, original.length);
  assert.equal(h.ui.elements.historyRecoveryTools.hidden, true);
  assert.deepEqual(h.recoveryMounts, []);
  assert.deepEqual(h.calls, []); assert.deepEqual(h.storageWrites, []);
});

test('actual global history groups within its existing filter and keeps a valid nested eight-column table', () => {
  const h = harness(), before = JSON.stringify(h.ui.state.data.events);
  h.ui.renderHistory();
  const {major, group} = split(h.ui.elements.historyBody.innerHTML);
  assert.match(group, /자동 운전시간 조회 2건/);
  assert.match(major, /MANUAL-COUNTER/);
  assert.match(major, /CUSTOM-CERTIFICATE/);
  assert.match(group, /<table class="history-table" aria-label="자동 운전시간 조회 이력">/);
  assert.equal((group.match(/scope="col"/g) || []).length, 8);
  assert.match(h.ui.elements.historyBody.innerHTML, /<td colspan="8"><details/);
  assert.match(group, /<\/tbody><\/table><\/div><\/details><\/td><\/tr>$/);
  h.ui.elements.historyFilter.value = 'replacement'; h.ui.renderHistory();
  assert.doesNotMatch(h.ui.elements.historyBody.innerHTML, /<details/);
  assert.match(h.ui.elements.historyBody.innerHTML, /BELT-COMPLETED/);
  assert.match(h.ui.elements.historyBody.innerHTML, /WORKLOG-BELT/);
  assert.equal(JSON.stringify(h.ui.state.data.events), before);
  assert.deepEqual(h.calls, []); assert.deepEqual(h.storageWrites, []);
});

test('native expand and close clicks pass through actual history delegation without API, storage, or recovery mounts', () => {
  const h = harness(); h.ui.openAssetHistory(TAG);
  const before = JSON.stringify(h.ui.state.data.events), saved = [...h.stored.entries()];
  for (let n = 0; n < 3; n++) h.ui.elements.historyDialog.listeners.click({target: {closest: () => null}});
  h.ui.renderHistory(); h.ui.openAssetHistory(TAG);
  assert.equal(JSON.stringify(h.ui.state.data.events), before);
  assert.deepEqual([...h.stored.entries()], saved);
  assert.deepEqual(h.calls, []); assert.deepEqual(h.storageWrites, []); assert.deepEqual(h.recoveryMounts, []);
});

test('a missing optional timeline helper safely renders every original row in both main views', () => {
  const h = harness({helper: false}), before = JSON.stringify(h.ui.state.data.events);
  h.ui.openAssetHistory(TAG); h.ui.renderHistory();
  assert.doesNotMatch(h.ui.elements.assetHistoryList.innerHTML, /<details/);
  assert.doesNotMatch(h.ui.elements.historyBody.innerHTML, /<details/);
  assert.equal((h.ui.elements.assetHistoryList.innerHTML.match(/<article class="asset-history-item">/g) || []).length, h.ui.state.data.events.length);
  assert.equal((h.ui.elements.historyBody.innerHTML.match(/<tr>/g) || []).length, h.ui.state.data.events.length);
  assert.equal(JSON.stringify(h.ui.state.data.events), before);
  assert.deepEqual(h.calls, []); assert.deepEqual(h.storageWrites, []);
});

test('current review and failed-query information remain in the operational summary while temporary diagnostics stay off', () => {
  const h = harness();
  h.asset.cycleSourceReview = {code: 'SOURCE_CHANGED', message: 'CURRENT-SOURCE-REVIEW', measuredRangeMayContinue: true};
  h.asset.replacementAutoCycle = {schemaVersion: 3, normalizationVersion: 4, timePrecision: 'day', clockKnown: false,
    registeredBaseline: true, registeredRuntimeRange: true, rangeTrackingAllowed: true, rangeStartAt: REPLACED};
  h.ui.state.unifiedRefreshResults = [{tagNumber: TAG, status: 'failed', requestId: 'existing-failed-request',
    dataParcTag: h.asset.dataParcTag, errorCode: 'BLOWER_INCREMENTAL_BASE_REQUIRED', failureStage: 'create',
    message: 'CURRENT-QUERY-ERROR', startAt: REPLACED, endAt: NOW, completedAt: NOW,
    cycleSnapshot: {tagNumber: TAG, lastReplacementAt: REPLACED, cycleStartState: 'legacy', cycleStartedAt: '',
      cycleStartRevision: h.asset.cycleStartRevision, cycleRuntimeRevision: h.asset.cycleRuntimeRevision}}];
  const before = JSON.stringify(h.ui.state.data.events);
  h.ui.openAssetHistory(TAG);
  const summary = h.ui.elements.historyCycleSummary.innerHTML;
  assert.match(summary, /CURRENT-SOURCE-REVIEW/);
  assert.match(summary, /data-query-result="failed"/);
  assert.match(summary, /BLOWER_INCREMENTAL_BASE_REQUIRED/);
  assert.match(summary, /CURRENT-QUERY-ERROR/);
  assert.match(h.ui.elements.assetHistoryList.innerHTML, /완료시각 미기록/);
  assert.equal(h.ui.elements.historyRecoveryTools.hidden, true);
  assert.deepEqual(h.recoveryMounts, []);
  assert.equal(JSON.stringify(h.ui.state.data.events), before);
  assert.deepEqual(h.calls, []); assert.deepEqual(h.storageWrites, []);
});

test('the Blower page loads its optional timeline helper before the renderer and the main navigation still links to it', () => {
  const html = fs.readFileSync(new URL('../maintenance/blower-history.html', import.meta.url), 'utf8');
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)].map(match => match[1].split('?')[0].split('/').at(-1));
  assert.equal(scripts.filter(name => name === 'blower-history-timeline-v1.js').length, 1);
  assert.ok(scripts.indexOf('blower-history-timeline-v1.js') < scripts.indexOf('blower-history.js'));
  assert.match(html, /href="(?:\/maintenance\/)?blower-history-timeline-v1\.css\?/);
  const home = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(home, /id="blowerHistoryHeaderButton"[\s\S]*?href="\/maintenance\/blower-history"/);
});

test('actual authenticated API receipts collapse while the saved recovery certificate and manual basis stay primary', async t => {
  const {createFbhe1aRuntimeFixture, ordinaryAppend, TAG: assetTag, BROWSER_TOKEN} = await import('./helpers/blower-fbhe1a-runtime-fixture-v1.mjs');
  const {onRequestGet} = await import('../functions/api/blower-history.js');
  const f = await createFbhe1aRuntimeFixture(t);
  await f.apply(await f.ready());
  await ordinaryAppend(f);
  const saved = () => JSON.stringify([f.asset(), f.events(), f.sql.prepare('SELECT * FROM blower_history_asset_history ORDER BY id').all()]);
  const before = saved();
  const response = await onRequestGet({env: {DB: f.db}, request: new Request('https://fixture.test/api/blower-history', {
    headers: {Authorization: 'Bearer ' + BROWSER_TOKEN}
  })});
  assert.equal(response.status, 200);
  const payload = JSON.parse(JSON.stringify(await response.json()));
  const events = payload.events.filter(event => event.tagNumber === assetTag);
  const grouped = timeline.partition(events);
  assert.equal(grouped.automatic.length, 2);
  assert.ok(grouped.automatic.every(event => event.sourceType === 'dataparc_runtime'));
  assert.ok(grouped.major.some(event => event.sourceType === 'manual'));
  assert.ok(grouped.major.some(event => event.sourceType === 'dataparc_fbhe1a_runtime_v1'));
  const raw = JSON.stringify(events);
  const html = timeline.renderAssetTimeline(events, {renderEvent: event => '<article>' + event.id + '</article>'});
  assert.match(html, /자동 운전시간 조회 2건/);
  assert.doesNotMatch(html, /<details[^>]*\bopen(?:\s|=|>)/);
  assert.equal(JSON.stringify(events), raw);
  assert.equal(saved(), before);
});
