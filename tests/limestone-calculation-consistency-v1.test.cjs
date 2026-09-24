'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../script.js'), 'utf8');
const start = source.indexOf('(function installLimestoneOisRequestClient() {');
const end = source.indexOf('\n})();', start) + '\n})();'.length;
assert.ok(start > 0 && end > start);
const DATE = '2026-09-23';
const item = (status = 'complete', id = 'new') => ({ id, status, targetDate: DATE,
  completedAt: '2026-09-24T00:30:00Z', errorMessage: status === 'failed' ? '운영정보 메뉴를 연 뒤 왼쪽 메뉴를 다시 찾지 못했습니다.' : '' });
function records(requestId = 'new') {
  return [{ unitNo: 1, startStock: 357.462, endStock: 384.985, receiptQuantity: 59.86, usageQuantity: 32.33 },
    { unitNo: 2, startStock: 344.569, endStock: 389.697, receiptQuantity: 88.64, usageQuantity: 43.51 }]
    .map(r => ({ ...r, usageDate: DATE, oisRequestId: requestId, updatedAt: '2026-09-24T00:30:00Z' }));
}
function deferred() { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; }
function harness(options = {}) {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { value: '', textContent: '', disabled: false, dataset: {}, attrs: {}, listeners: {},
      classList: { toggle() {} }, focus() {},
      addEventListener(type, fn) { this.listeners[type] = fn; },
      setAttribute(key, value) { this.attrs[key] = value; }, removeAttribute(key) { delete this.attrs[key]; },
      dispatchEvent() {} });
    return nodes.get(id);
  };
  node('limestoneUsageDate').value = DATE;
  const h = { posts: 0, gets: 0, reads: 0, waits: [], snapshots: [], node, options };
  const window = { location: { origin: 'https://example.test' },
    setTimeout: fn => { queueMicrotask(fn); return 1; },
    setLimestoneUsageSavedReceiptQuantities: (date, values) => h.snapshots.push({date, values}),
    renderEfficiencyMorningMeetingAutoPreview() {},
    async waitForSharedOisRequestCompletion(id, config) {
      h.waits.push(id);
      return options.wait ? options.wait(id, config, h) : item();
    }
  };
  let boot;
  const context = vm.createContext({ window, URL, Event, console: {warn() {}, error() {}},
    document: { readyState: 'loading', getElementById: node,
      querySelector: id => node(id), addEventListener: (type, fn) => { boot = fn; } },
    isLimestoneUsageMobileMonitorMode: () => options.mobile === true,
    getShiftLogAuthHeaders: () => ({ Authorization: 'test' }),
    async fetch(url, request) {
      let result;
      if (request.method === 'POST') { h.posts++; result = options.create ? await options.create(h) : { item: item('pending') }; }
      else if (new URL(url).searchParams.get('action') === 'usage_records') {
        h.reads++; result = { items: options.records ? await options.records(h) : records() };
      } else { h.gets++; result = options.get ? await options.get(h) : { item: item('complete') }; }
      return { ok: true, text: async () => JSON.stringify({ ok: true, ...result }) };
    }
  });
  vm.runInContext(source.slice(start, end), context); boot();
  h.run = () => window.loadLimestoneOisStock();
  h.restore = opts => window.loadSavedLimestoneUsageRecords(DATE, opts);
  h.changeDate = date => { node('limestoneUsageDate').value = date; node('limestoneUsageDate').listeners.change(); };
  h.status = () => node('limestoneUsageCalculatorView').dataset.limestoneUsageStatus;
  h.title = () => node('limestoneUsageStatusTitle').textContent;
  return h;
}
function readyButton(h) {
  assert.equal(h.node('loadLimestoneUsageOisButton').textContent, '석회석 사용량 계산');
  assert.equal(h.node('loadLimestoneUsageOisButton').disabled, false);
  assert.equal(h.node('loadLimestoneUsageOisButton').attrs['aria-busy'], undefined);
}
function failed(_id, config) { config.onUpdate(item('failed')); throw Error('navigation failed'); }

test('normal completion displays exact saved quantities without a second receipt lookup', async () => {
  const h = harness(); const r = await h.run(); assert.equal(r.id, 'new'); assert.equal(h.status(), 'complete');
  assert.equal(h.node('limestoneUsageTotalSummary').textContent, '75.84');
  assert.equal(h.node('limestoneUsageUnitOneSummary').textContent, '32.33');
  assert.equal(h.node('limestoneUsageUnitTwoSummary').textContent, '43.51');
  assert.equal(h.snapshots[0].values[1], 59.86); assert.equal(h.reads, 1); assert.equal(h.posts, 1); readyButton(h);
});
test('a lost completion response is recovered from the same request and saved records', async () => {
  const h = harness({ wait() { throw Error('connection lost'); } });
  assert.equal((await h.run()).id, 'new'); assert.equal(h.status(), 'complete'); assert.equal(h.gets, 1); assert.equal(h.posts, 1); readyButton(h);
});
test('a failed request with saved rows is shown as a status mismatch, never a new success', async () => {
  const h = harness({ wait: failed, get: () => ({ item: item('failed') }) });
  assert.equal(await h.run(), undefined); assert.equal(h.status(), 'warning');
  assert.match(h.title(), /사용량 저장 확인/); assert.equal(h.node('limestoneUsageTotalSummary').textContent, '75.84'); readyButton(h);
});
test('old saved records remain visible with explicit recalculation failure', async () => {
  const h = harness({ wait: failed, get: () => ({ item: item('failed') }), records: () => records('old') });
  assert.equal(await h.run(), undefined); assert.equal(h.status(), 'warning'); assert.match(h.title(), /재계산 실패 · 기존 저장값 표시/); readyButton(h);
});
test('confirmed failure without any saved records remains an error', async () => {
  const h = harness({ wait: failed, get: () => ({ item: item('failed') }), records: () => [] });
  assert.equal(await h.run(), undefined); assert.equal(h.status(), 'error'); assert.match(h.title(), /계산 실패/); readyButton(h);
});
test('polling interruptions resume the existing job once without submitting another calculation', async () => {
  const h = harness({ wait(_id, config, h) { config.onUpdate(item('processing')); if (h.waits.length === 1) throw Error('offline'); return item(); }, get: () => ({ item: item('processing') }) });
  assert.equal((await h.run()).id, 'new'); assert.deepEqual(h.waits, ['new', 'new']); assert.equal(h.posts, 1); assert.equal(h.status(), 'complete');
});
test('unconfirmed processing is never labelled calculation failure or complete', async () => {
  const h = harness({ wait(_id, config) { config.onUpdate(item('processing')); throw Error('offline'); }, get: () => ({ item: item('processing') }), records: () => [] });
  assert.equal(await h.run(), undefined); assert.equal(h.status(), 'warning'); assert.match(h.title(), /확인 필요/); assert.equal(h.posts, 1); readyButton(h);
});
test('changing date while request creation is pending suppresses old status and polling', async () => {
  const gate = deferred(); const h = harness({ create: () => gate.promise }); const run = h.run();
  h.changeDate('2026-09-24'); const title = h.title(); gate.resolve({ item: item('pending') }); await run;
  assert.equal(h.title(), title); assert.equal(h.waits.length, 0); assert.equal(h.reads, 0); readyButton(h);
});
test('changing date during saved-result retrieval cannot inject old stocks or a success status', async () => {
  const gate = deferred(); let readStarted; const started = new Promise(r => readStarted = r);
  const h = harness({ records: () => { readStarted(); return gate.promise; } });
  const run = h.run(); await started; h.changeDate('2026-09-24'); const title = h.title(); gate.resolve(records()); await run;
  assert.equal(h.title(), title); assert.equal(h.node('limestoneUsageUnitOneStartStock').value, ''); assert.equal(h.snapshots.length, 0); readyButton(h);
});
test('duplicate clicks or programmatic requests share one in-flight calculation', async () => {
  const gate = deferred(); const h = harness({ create: () => gate.promise }); const a = h.run(), b = h.run();
  assert.equal(a, b); assert.equal(h.posts, 1); assert.equal(h.node('loadLimestoneUsageOisButton').disabled, true);
  gate.resolve({ item: item('complete') }); await a; readyButton(h);
});
test('saved-data restoration validates both units before touching either stock input', async () => {
  for (const bad of [null, undefined, '', ' ', true, 'not a number']) {
    const rows = records(); rows[1].endStock = bad;
    const h = harness({ records: () => rows }); assert.equal(await h.restore({silentWhenMissing:true}), false);
    assert.equal(h.node('limestoneUsageUnitOneStartStock').value, ''); assert.equal(h.snapshots.length, 0);
  }
});
test('recovery rejects mixed request IDs and incorrect dates while accepting legitimate zero stocks', async () => {
  const mixed = records(); mixed[1].oisRequestId = 'old';
  const a = harness({ records: () => mixed }); assert.equal(await a.restore({requiredRequestId:'new'}), false);
  const wrong = records(); wrong[1].usageDate = '2026-09-22';
  const b = harness({ records: () => wrong }); assert.equal(await b.restore({requiredRequestId:'new'}), false);
  const zero = records(); zero[0].startStock = 0;
  const c = harness({ records: () => zero }); assert.equal(await c.restore({requiredRequestId:'new'}), true);
  assert.equal(c.node('limestoneUsageUnitOneStartStock').value, '0');
});
test('mobile monitor mode cannot create OIS requests', async () => {
  const h = harness({mobile:true}); await h.run(); assert.equal(h.posts, 0); assert.equal(h.reads, 0);
});

test('a saved snapshot loading before a new calculation cannot overtake its progress', async () => {
  const gate = deferred(), create = deferred();
  const h = harness({ records: () => gate.promise, create: () => create.promise });
  const restore = h.restore(); const run = h.run();
  gate.resolve(records('old')); assert.equal(await restore, false);
  assert.equal(h.status(), 'loading'); assert.equal(h.node('limestoneUsageUnitOneStartStock').value, '');
  h.changeDate('2026-09-24'); create.resolve({item:item('pending')}); await run;
});
