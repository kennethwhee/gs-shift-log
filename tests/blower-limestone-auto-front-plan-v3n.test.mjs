import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const source = fs.readFileSync(new URL('../maintenance/blower-history.js', import.meta.url), 'utf8');
const core = createRequire(import.meta.url)('../maintenance/blower-unified-refresh.js');
const marker = '  if (document.readyState === "loading") {';
const now = '2026-11-02T13:00:00.000Z';
const tags = ['103HRJ01AN602', '203HRJ01AN601', '203HRJ01AN602'];
const signal = tag => `GSPOGE.ABB_DCS.${tag}XB04`;

function automatic(tag, patch = {}) {
  return {
    tagNumber: tag, displayName: tag, enabled: true, blowerType: 'limestone',
    lastReplacementAt: tag === '203HRJ01AN601'
      ? '2026-05-12T00:00:00+09:00' : '2026-09-22T00:00:00+09:00',
    cycleStartState: 'pending', cycleStartedAt: '', cycleStoredStartedAt: '',
    cycleStartRevision: 'saved-start', cycleRuntimeRevision: 'saved-runtime',
    dataParcTag: signal(tag), dataParcRuntimeBasis: null,
    hasUnverifiedDataParcHistory: true, limestoneAutoApply: true,
    limestoneBasisConfirmed: false, limestoneRunDisputed: false, ...patch
  };
}
function ordinary(patch = {}) {
  return {
    ...automatic('104ETG30AN601'), blowerType: 'flyash_bag',
    lastReplacementAt: '2026-09-25T00:00:00+09:00',
    limestoneAutoApply: false, ...patch
  };
}

// Run the production function within its complete lexical scope, including
// isLimestoneDisputedAsset, rather than substituting the planner wrapper.
function harness(assets, options = {}) {
  const calls = [];
  const context = vm.createContext({ console, HTMLButtonElement: class {},
    localStorage: { getItem() { return null; } }, navigator: {},
    URL, Date, Number, String, Intl, Map, Set,
    window: { addEventListener() {}, matchMedia: () => ({ matches: false }) },
    document: { readyState: 'loading', addEventListener() {}, querySelectorAll() { return []; } }
  });
  assert.equal(source.split(marker).length, 2);
  vm.runInContext(source.replace(marker,
    '  globalThis.readProductionPlan = readUnifiedRefreshPlan;\n' +
    '  assertUnifiedRefreshWritable = () => {};\n' + marker), context);
  const ordered = assets.slice().sort((a, b) => a.tagNumber.localeCompare(b.tagNumber));
  const io = { assertWritable() {}, progress() {},
    api: async optionsIn => {
      calls.push(optionsIn);
      const url = new URL(optionsIn.url, 'https://example.test');
      if (url.searchParams.get('action') === 'limestone_run_tracking') {
        if (options.ledgerError) throw options.ledgerError;
        return { ok: true, version: 'limestone-run-ledger-v1', items: [] };
      }
      assert.equal(url.searchParams.get('action'), 'refresh_state_page');
      if (options.page) return options.page;
      const cursor = url.searchParams.get('cursor') || '';
      const remaining = ordered.filter(a => a.tagNumber > cursor);
      const pageAssets = remaining.slice(0, 2);
      const done = remaining.length <= 2;
      return { ok: true, version: 'blower-refresh-state-page-v1',
        generatedAt: now, user: { employeeNo: 'tester' }, permissions: { canWrite: true },
        assets: pageAssets, done, nextCursor: done ? null : pageAssets.at(-1).tagNumber };
    } };
  return { calls, read: () => context.readProductionPlan(core, io) };
}

test('production UI admits all three automatic pending recovery snapshots with unverified history into the real core', async () => {
  const assets = tags.map(tag => automatic(tag));
  const before = structuredClone(assets);
  const h = harness(assets, { ledgerError: new Error('old ledger must not be read') });
  const planned = await h.read();
  assert.equal(planned.tasks.length, 3, JSON.stringify(planned));
  assert.equal(planned.skipped.length, 0);
  assert.equal(planned.targetCount, 3);
  assert.equal(h.calls.length, 2, 'three assets require exactly two bounded planning pages');
  for (const task of planned.tasks) {
    const a = assets.find(a => a.tagNumber === task.snapshot.tagNumber);
    assert.equal(task.limestoneAutoRebuild, true);
    assert.equal(task.incremental, false);
    assert.equal(task.previewOnly, undefined);
    assert.equal(task.startAt, a.lastReplacementAt);
    assert.equal(task.queryStartAt, a.lastReplacementAt);
  }
  assert.equal(h.calls.some(call => call.url.includes('limestone_run_tracking')), false);
  assert.deepEqual(assets, before);
});

test('production UI keeps the ordinary unverified-history guard while automatic Limestone recovery proceeds', async () => {
  const held = ordinary();
  const h = harness([held, ...tags.map(tag => automatic(tag))]);
  const planned = await h.read();
  assert.equal(planned.tasks.length, 3);
  assert.equal(planned.targetCount, 4);
  assert.equal(planned.skipped.length, 1);
  assert.equal(planned.skipped[0].tagNumber, held.tagNumber);
  assert.match(planned.skipped[0].message, /기존 조회값 보호/);
  assert.equal(h.calls.some(call => call.url.includes('limestone_run_tracking')), false);
});

test('the automatic capability does not admit Limestone 1A or a different equipment type with unverified history', async () => {
  for (const asset of [automatic('103HRJ01AN601'),
    automatic(tags[0], { blowerType: 'flyash_bag' }),
    ordinary({ limestoneAutoApply: true })]) {
    const h = harness([asset]);
    const planned = await h.read();
    assert.equal(planned.tasks.length, 0, JSON.stringify(asset));
    assert.equal(planned.skipped.length, 1);
    assert.equal(planned.skipped[0].tagNumber, asset.tagNumber);
    assert.equal(planned.targetCount, 1);
    assert.equal(h.calls.some(call => call.url.includes('limestone_run_tracking')), false);
  }
});

test('a verified automatic full-baseline receipt still uses the normal exact incremental endpoint through production UI', async () => {
  const a = automatic(tags[1], { hasUnverifiedDataParcHistory: false });
  a.dataParcRuntimeBasis = { appendReady: true, startAt: a.lastReplacementAt,
    observedAt: '2026-11-02T12:00:00.000Z', dataParcTag: a.dataParcTag,
    runningSeconds: 7200 };
  const h = harness([a]);
  const planned = await h.read();
  assert.equal(planned.tasks.length, 1);
  assert.equal(planned.tasks[0].incremental, true);
  assert.equal(planned.tasks[0].queryStartAt, a.dataParcRuntimeBasis.observedAt);
  assert.equal(planned.tasks[0].limestoneAutoRebuild, undefined);
  assert.equal(h.calls.length, 1);
});

test('older held Limestone snapshots without the capability retain their separate ledger behavior', async () => {
  const a = automatic(tags[0], { limestoneRunDisputed: true });
  delete a.limestoneAutoApply;
  const h = harness([a]);
  const planned = await h.read();
  assert.equal(planned.tasks.length, 1);
  assert.equal(planned.tasks[0].previewOnly, true);
  assert.equal(planned.tasks[0].limestoneAutoRebuild, undefined);
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].url.includes('limestone_run_tracking'), true);
});

test('malformed automatic snapshots are rejected before planning or any ledger access', async () => {
  for (const asset of [
    (() => { const a = automatic(tags[0]); delete a.dataParcRuntimeBasis; return a; })(),
    automatic(tags[0], { hasUnverifiedDataParcHistory: 'true' })
  ]) {
    const h = harness([], { page: { ok: true, version: 'blower-refresh-state-page-v1',
      generatedAt: now, user: { employeeNo: 'tester' }, permissions: { canWrite: true },
      assets: [asset], done: true, nextCursor: null } });
    await assert.rejects(h.read, error => error.code === 'INVALID_REFRESH_STATE');
    assert.equal(h.calls.length, 1);
  }
});

test('malformed page ordering remains rejected even for automatic supported tags', async () => {
  const h = harness([], { page: { ok: true, version: 'blower-refresh-state-page-v1',
    generatedAt: now, user: { employeeNo: 'tester' }, permissions: { canWrite: true },
    assets: [automatic(tags[2]), automatic(tags[0])], done: true, nextCursor: null } });
  await assert.rejects(h.read, error => error.code === 'INVALID_REFRESH_STATE');
  assert.equal(h.calls.length, 1);
});
