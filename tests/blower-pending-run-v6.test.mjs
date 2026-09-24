import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
  fixture, browserCreate, agentClaim, agentComplete, callApi, agent,
  BROWSER_TOKEN, history, historyPost
} from './helpers/blower-incremental-fixture.mjs';
import { verifiedAppendBase } from '../functions/_shared/blower-incremental.js';

const core = createRequire(import.meta.url)('../maintenance/blower-unified-refresh.js');
const TAGS = ['104ETH03AN601', '104ETH03AN602', '104ETG30AN601', '104ETG30AN602',
  '204ETG30AN601', '204ETG30AN602', '104SDF01AN001', '104SDF01AN002',
  '204SDF01AN001', '204SDF01AN002', '204LMDF01AN001',
  ...['104', '204'].flatMap(p => ['60AP', '10AN'].flatMap(g =>
    ['611', '621', '631'].map(n => `${p}HHL${g}${n}`)))];
const BAG = '204ETG30AN602';
const RealDate = Date;
const source = readFileSync(new URL('../maintenance/blower-history.js', import.meta.url), 'utf8');

async function setup(tag = BAG) {
  let clock = RealDate.parse('2026-09-24T14:40:00Z');
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  };
  const f = await fixture(tag, true);
  f.tag = tag;
  f.signal = tag === '104ETH03AN602' ? 'GSPOGE.ABB_DCS.003ETH03AN602XB04'
    : tag === BAG ? 'GSPOGE.ABB_DCS.203ETG30AN602XJ04'
    : `GSPOGE.ABB_DCS.TEST_ONLY_${tag}_RUN`;
  f.replacementAt = '2026-09-22T01:20:00.000Z';
  f.sqlite.prepare(`UPDATE blower_history_assets SET last_replacement_at=?,
    cycle_start_state='pending', cycle_started_at=NULL, cycle_start_revision='pending-start',
    cycle_runtime_revision='pending-runtime', cycle_runtime_state='stopped',
    cycle_runtime_hours=0, cycle_runtime_anchor_at=?, runtime_hours=0, runtime_anchor_at=NULL,
    is_running=0 WHERE tag_number=?`).run(f.replacementAt, f.replacementAt, tag);
  f.sqlite.prepare(`INSERT INTO blower_history_events
    (id,tag_number,event_type,event_date,runtime_hours,issue_type,action_type,note,
     source_type,source_log_id,source_text,created_by_id,created_by_name,created_at,updated_at)
    VALUES ('replacement',?,'replacement',?,0,'정기주기','교체','',
      'shift_log_auto','log-1','test replacement','test','test',?,?)`)
    .run(tag, f.replacementAt, f.replacementAt, f.replacementAt);
  f.read = () => f.sqlite.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(tag);
  f.events = () => f.sqlite.prepare(`SELECT * FROM blower_history_events WHERE tag_number=?
    ORDER BY created_at DESC,event_date DESC,id DESC`).all(tag);
  f.state = async () => (await history.loadAssetStates(f.database, {})).find(a => a.tagNumber === tag);
  f.advance = ms => { clock += ms; };
  f.body = (extra = {}) => {
    const a = f.read();
    return { action: 'create_blower_runtime_probe', assetTag: tag, dataParcTag: f.signal,
      confirmRunSignal: true, startAt: f.replacementAt, requireIncrementalAppend: false,
      expectedLastReplacementAt: a.last_replacement_at, expectedCycleStartState: a.cycle_start_state,
      expectedCycleStartedAt: a.cycle_started_at || '', expectedCycleStartRevision: a.cycle_start_revision,
      expectedCycleRuntimeRevision: a.cycle_runtime_revision, ...extra };
  };
  f.create = extra => browserCreate(f.database, f.body(extra));
  f.finish = async (item, seconds, startState = 'running', endState = 'running') => {
    const claimed = await agentClaim(f.database);
    assert.equal(claimed.status, 200, JSON.stringify(claimed.body));
    const row = claimed.body.items.excel;
    assert.equal(row.id, item.id);
    const raw = { ...row.probe, ok: true, observedAt: row.probe.endAt,
      collectedAt: new Date().toISOString(), completedChunkCount: 1,
      startState, endState, runningSeconds: seconds, totalRunningHours: seconds / 3600,
      chunks: [{ index: 1, startAt: row.probe.startAt, endAt: row.probe.endAt,
        startState, endState, runningSeconds: seconds, totalRunningHours: seconds / 3600 }] };
    const done = await agentComplete(f.database, row.id, agent.normalizeResult(raw, agent.parseClaim(row)));
    assert.equal(done.status, 200, JSON.stringify(done.body));
  };
  f.sync = requestId => callApi(historyPost, f.database, new Request('https://example.test/api/blower-history', {
    method: 'POST', headers: { Authorization: `Bearer ${BROWSER_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'dataparc_runtime_sync', requestId })
  }));
  f.close = () => { f.database.close(); globalThis.Date = RealDate; };
  return f;
}

function uiFor(asset) {
  const nodes = new Map();
  const element = () => ({ innerHTML: '', textContent: '', value: '', hidden: false, disabled: false,
    dataset: {}, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {},
    setAttribute() {}, removeAttribute() {}, showModal() {}, close() {}, focus() {} });
  const context = vm.createContext({ console, Date, setTimeout, clearTimeout,
    localStorage: { getItem: () => null },
    document: { readyState: 'loading', body: element(), addEventListener() {}, querySelectorAll: () => [],
      getElementById(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); } },
    window: { BlowerUnifiedRefresh: core, matchMedia: () => ({ matches: false }),
      addEventListener() {}, setTimeout, clearTimeout } });
  const marker = '  if (document.readyState === "loading") {';
  assert.equal(source.split(marker).length, 2);
  vm.runInContext(source.replace(marker, `globalThis.ui = { state, elements, cacheElements,
    renderAssetCard, allOverviewOperation, openAssetHistory, formatSignedRemaining };\n${marker}`), context);
  const ui = context.ui;
  ui.cacheElements();
  ui.state.data = { permissions: { canWrite: true }, user: { name: 'test' },
    backfill: { hasRun: true, status: 'complete' }, assets: [asset], events: [], settings: {} };
  return ui;
}

for (const tag of TAGS) test(`${tag}: pending replacement → RUN query → verified display, without a fabricated startup`, async () => {
  const f = await setup(tag);
  try {
    const before = f.read(), replacement = f.events()[0];
    const created = await f.create();
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const item = created.body.item;
    assert.equal(item.probe.expectedCycleStartState, 'legacy');
    assert.equal(item.probe.expectedCycleStartRevision, 'signal-only-v1:pending-start');
    assert.deepEqual(f.read(), before);
    const seconds = (Date.parse(item.probe.endAt) - Date.parse(item.probe.startAt)) / 1000;
    await f.finish(item, seconds);
    assert.deepEqual(f.read(), before, 'Agent completion is read-only until apply');
    const saved = await f.sync(item.id);
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.runtimeHours, seconds / 3600);
    const row = f.read(), state = await f.state();
    assert.equal(row.cycle_start_state, 'pending');
    assert.equal(row.cycle_started_at, null);
    assert.equal(row.cycle_start_revision, 'pending-start');
    assert.equal(row.last_replacement_at, f.replacementAt);
    assert.equal(row.cycle_runtime_state, 'running');
    assert.equal(state.measurementRequired, false);
    assert.equal(state.cycleElapsedHours, seconds / 3600);
    assert.equal(state.runRuntime.verified, true);
    assert.equal(state.dataParcRuntimeBasis.appendReady, true);
    const view = core.fbheSealRunView(state, state.dataParcRuntimeBasis);
    assert.equal(view.stateLabel, '기동중');
    assert.equal(view.pending, false);
    assert.equal(verifiedAppendBase(row, f.events(), f.signal).runningSeconds, seconds);
    assert.deepEqual(f.events().find(e => e.id === 'replacement'), replacement);
    assert.equal(f.events().filter(e => e.event_type === 'startup').length, 0);
    assert.equal((await f.sync(item.id)).body.replayed, true);
    assert.deepEqual(f.read(), row);
  } finally { f.close(); }
});

test('all 23 pending assets are included in Latest with their pinned cycle snapshots', () => {
  const assets = TAGS.map(tagNumber => ({ tagNumber, enabled: true, cycleStartState: 'pending',
    cycleStartedAt: '', cycleStoredStartedAt: '', cycleStartRevision: 'start', cycleRuntimeRevision: 'runtime',
    lastReplacementAt: '2026-09-22T01:20:00.000Z', dataParcTag: `GSPOGE.ABB_DCS.TEST_ONLY_${tagNumber}` }));
  const planned = core.plan(assets, new Date('2026-09-24T14:40:00Z'));
  assert.equal(planned.tasks.length, 23);
  assert.equal(planned.skipped.length, 0);
  assert.ok(planned.tasks.every(t => t.startAt === t.asset.lastReplacementAt && t.snapshot.cycleStartState === 'pending'));
});

test('pending Bag Filter participates in atomic Latest batch and appends only new seconds', async () => {
  const f = await setup();
  try {
    const batch = await browserCreate(f.database, { action: 'create_blower_runtime_probe_batch',
      requests: [f.body({ unifiedRefresh: true, incrementalRefresh: true })] });
    assert.equal(batch.status, 201, JSON.stringify(batch.body));
    assert.equal(batch.body.atomic, true);
    const first = batch.body.results[0].item;
    await f.finish(first, 3601);
    assert.equal((await f.sync(first.id)).status, 200);
    f.advance(3600000);
    const state = await f.state(), planned = core.plan([state], new Date());
    assert.equal(planned.tasks.length, 1);
    assert.equal(planned.tasks[0].incremental, true);
    const next = await f.create({ unifiedRefresh: true, incrementalRefresh: true, requireIncrementalAppend: true });
    assert.equal(next.status, 201, JSON.stringify(next.body));
    assert.equal(Date.parse(next.body.item.probe.startAt), Date.parse(first.probe.endAt));
    await f.finish(next.body.item, 901);
    const saved = await f.sync(next.body.item.id);
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.runtimeHours, 4502 / 3600);
    assert.equal(saved.body.addedRunningSeconds, 901);
    assert.equal((await f.state()).dataParcRuntimeBasis.appendReady, true);
    assert.equal((await f.sync(next.body.item.id)).body.replayed, true);
    assert.equal(f.read().cycle_runtime_hours, 4502 / 3600);
  } finally { f.close(); }
});

for (const endState of ['running', 'stopped']) test(`Bag Filter card, overview and history display queried ${endState}, never pending or zero by assumption`, async () => {
  const f = await setup();
  try {
    const q = await f.create();
    assert.equal(q.status, 201, JSON.stringify(q.body));
    const seconds = endState === 'running' ? 7200 : 0;
    await f.finish(q.body.item, seconds, endState, endState);
    assert.equal((await f.sync(q.body.item.id)).status, 200);
    const state = await f.state(), ui = uiFor(state);
    const card = ui.renderAssetCard(state, {});
    assert.match(card, new RegExp(`data-operation-state="${endState}"`));
    assert.match(card, endState === 'running' ? /기동중/ : /정지중/);
    assert.doesNotMatch(card, /기동 대기|기동 등록 전|기동<\/em><strong>미등록/);
    assert.equal(ui.allOverviewOperation(state).state, endState);
    ui.openAssetHistory(BAG);
    assert.match(ui.elements.historyCycleSummary.innerHTML, endState === 'running' ? /2\.0시간/ : /0\.0시간/);
    assert.doesNotMatch(ui.elements.historyCycleSummary.innerHTML, /기동 대기/);
  } finally { f.close(); }
});

test('unqueried pending state is RUN unverified; historical running flags cannot certify it', async () => {
  const f = await setup();
  try {
    f.sqlite.prepare(`UPDATE blower_history_assets SET cycle_runtime_state='running', is_running=1,
      cycle_runtime_hours=100, runtime_hours=100 WHERE tag_number=?`).run(BAG);
    const state = await f.state(), ui = uiFor(state);
    assert.equal(state.measurementRequired, true);
    assert.equal(state.cycleElapsedHours, null);
    const card = ui.renderAssetCard(state, {});
    assert.match(card, /RUN 미확인/);
    assert.doesNotMatch(card, /operation-pill running|>기동중<|>정지중<|100\.0시간|기동 대기/);
  } finally { f.close(); }
});

for (const change of ['runtime', 'replacement', 'startup']) test(`a ${change} edit while pending RUN query runs is preserved`, async () => {
  const f = await setup();
  try {
    const q = await f.create();
    assert.equal(q.status, 201, JSON.stringify(q.body));
    await f.finish(q.body.item, 3600);
    if (change === 'runtime') f.sqlite.prepare(`UPDATE blower_history_assets SET cycle_runtime_revision='edited',
      cycle_runtime_hours=99 WHERE tag_number=?`).run(BAG);
    if (change === 'replacement') f.sqlite.prepare(`UPDATE blower_history_assets SET
      last_replacement_at='2026-09-23T00:00:00.000Z', cycle_start_revision='edited' WHERE tag_number=?`).run(BAG);
    if (change === 'startup') f.sqlite.prepare(`UPDATE blower_history_assets SET cycle_start_state='started',
      cycle_started_at='2026-09-23T00:00:00.000Z', cycle_start_revision='edited' WHERE tag_number=?`).run(BAG);
    const before = f.read(), rows = f.events();
    const saved = await f.sync(q.body.item.id);
    assert.equal(saved.status, 409, JSON.stringify(saved.body));
    assert.deepEqual(f.read(), before);
    assert.deepEqual(f.events(), rows);
  } finally { f.close(); }
});

test('pending does not relax confirmation, equipment mapping, or replacement-time validation', async () => {
  const f = await setup();
  try {
    for (const extra of [{ confirmRunSignal: false }, { dataParcTag: 'GSPOGE.ABB_DCS.003ETH03AN602XB04' },
      { assetTag: 'UNKNOWN' }, { startAt: '2026-09-21T00:00:00+09:00' }]) {
      const response = await f.create(extra);
      assert.ok(response.status >= 400, JSON.stringify(response.body));
    }
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM ois_data_requests').get().n, 0);
  } finally { f.close(); }
});
