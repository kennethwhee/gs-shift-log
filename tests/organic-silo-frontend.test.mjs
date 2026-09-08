import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../maintenance/morning-meeting-organic-silo-dataparc.js', import.meta.url), 'utf8');
const keys = ['organicDaySilo', 'organicStorageSiloA', 'organicStorageSiloB'];
const ids = ['efficiencyMorningMeetingAutoDailyOrganicDaySilo', 'efficiencyMorningMeetingAutoDailyOrganicStorageSiloA',
  'efficiencyMorningMeetingAutoDailyOrganicStorageSiloB', 'efficiencyMorningMeetingAutoDailyOrganicSiloTotal'];
const tags = ['GSPOGE.ABB_DCS.104SDF01CW001XQ01/PLOT', 'GSPOGE.ABB_DCS.003SDF01CW001XQ01/PLOT', 'GSPOGE.ABB_DCS.003SDF02CW001XQ01/PLOT'];
function item(date = '2026-09-01', values = [5.82951, .09961, .83252]) {
  const next = new Date(`${date}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
  return { id: 'request-1', requestType: 'organic_silo_dataparc', targetDate: date, status: 'complete',
    completedAt: '2026-09-08T12:00:00Z', result: {
      schemaVersion: 1, source: 'dataparc_hidden_excel', targetDate: date, aggregation: 'End', step: '1D',
      qualityValidationVersion: '1.2', allQualitiesGood: true, cleanupVerified: true,
      intervalStartKst: `${date}T00:00:00+09:00`, intervalEndKst: `${next.toISOString().slice(0, 10)}T00:00:00+09:00`,
      ...Object.fromEntries(keys.map((key, i) => [key, values[i]])), organicSiloTotal: values.reduce((a, b) => a + b, 0),
      samples: keys.map((key, i) => ({ date, key, tag: tags[i], value: values[i], qualityText: 'Raw, Good', returnedTimeText: `${date} 00:00:00` }))
    } };
}
const node = (value = '') => ({ textContent: value, dataset: {}, title: '', classList: { toggle() {} },
  setAttribute() {}, addEventListener() {}, parentElement: {} });
function harness() {
  const nodes = new Map(['efficiencyMorningMeetingAutoDailySludgeCard', 'organicSiloDataParcControls', 'organicSiloDataParcStatus',
    'organicSiloDataParcQueryButton', 'efficiencyMorningMeetingAutoDailySludgeStatus', ...ids].map(id => [id, node()]));
  const panel = node(); panel.dataset.morningMeetingAutoBaseDate = '2026-09-01';
  nodes.set('efficiencyMorningMeetingWaterPanel', panel);
  const events = []; const requests = [];
  let token = 'signed-in'; let mobile = false;
  const window = { efficiencyMorningMeetingUploadState: {}, location: { origin: 'https://example.test' },
    navigator: { userAgent: 'Windows', platform: 'Win32' }, matchMedia: () => ({ matches: mobile }),
    setTimeout, clearTimeout, addEventListener() {} };
  const context = vm.createContext({ window, console, Map, Set, Date, URL, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    document: { readyState: 'loading', addEventListener() {}, getElementById: id => nodes.get(id), dispatchEvent: e => events.push(e) },
    getShiftLogSessionToken: () => token, getShiftLogAuthHeaders: extra => ({ Authorization: `Bearer ${token}`, ...extra }),
    fetch: async (url, options) => { requests.push({ url, options }); return { ok: true, json: async () => ({ ok: true, item: item() }) }; } });
  vm.runInContext(source, context);
  return { api: window.organicSiloDataParc, window, context, nodes, panel, events, requests,
    signedIn: value => { token = value; }, mobile: value => { mobile = value; } };
}

test('accepts three validated Raw, Good samples and preserves unrounded sum, zero inventory', () => {
  const { api } = harness();
  const value = item(); assert.ok(api.validateResult(value, value.targetDate));
  const zero = item('2026-09-01', [0, 0, 0]); assert.equal(api.validateResult(zero, zero.targetDate).organicSiloTotal, 0);
  assert.equal(api.inventoryFields(value.result).organicStorageSiloALevel, value.result.organicStorageSiloA);
});

test('rejects adverse quality, partial/duplicate samples, wrong date/tag, failed cleanup and inconsistent sums', () => {
  const { api } = harness();
  for (const mutate of [r => { r.samples[0].qualityText = 'Raw, Bad'; }, r => { r.samples[0].qualityText = 'Raw, Good, Uncertain'; },
    r => { r.samples.pop(); }, r => { r.samples[1] = r.samples[0]; }, r => { r.samples[0].date = '2026-08-01'; },
    r => { r.samples[0].tag = 'other-tag'; }, r => { r.cleanupVerified = false; }, r => { r.organicSiloTotal += 1; },
    r => { r.organicDaySilo = ''; }, r => { r.samples[0].returnedTimeText = ''; }, r => { r.intervalEndKst = 'wrong'; }]) {
    const candidate = item(); mutate(candidate.result); assert.equal(api.validateResult(candidate, candidate.targetDate), null);
  }
  const other = item(); other.requestType = 'daily_data_excel'; assert.equal(api.validateResult(other, other.targetDate), null);
});

test('date restoration and workbook overlays preserve receipts and other cards without fabricating daily status', () => {
  const h = harness(); const original = { sourceDate: '2026-09-01', generatorEcmsGen1: 10, sludgeTotal: 20,
    sludgeTruckCount: 2, sludgeEntries: [{ amount: 20 }], organicSiloTotal: 100, schemaVersion: 2 };
  h.window.efficiencyMorningMeetingUploadState.steamStatus = original;
  assert.equal(h.api.restoreCompleted([item()], '2026-09-01'), true);
  const exported = h.api.valuesForWorkbook(original);
  assert.equal(exported.sludgeTotal, 20); assert.equal(exported.sludgeTruckCount, 2); assert.equal(exported.generatorEcmsGen1, 10);
  assert.equal(exported.organicSiloTotal, item().result.organicSiloTotal);
  assert.equal(h.window.efficiencyMorningMeetingUploadState.steamStatus, original);
  assert.equal(original.organicSiloTotal, 100);
  h.panel.dataset.morningMeetingAutoBaseDate = '2026-09-02'; h.api.render();
  assert.equal(h.nodes.get(ids[0]).textContent, '-');
  assert.equal(h.api.valuesForWorkbook(original).organicSiloTotal, undefined);
  assert.equal(h.api.valuesForWorkbook(original).sludgeTotal, 20);
  h.panel.dataset.morningMeetingAutoBaseDate = '2026-09-01'; h.api.render();
  assert.match(h.nodes.get(ids[0]).textContent, /5\.830/);
});

test('monthly history merges only inventory regardless of item order; leaves caller override precedence intact', () => {
  const h = harness();
  const rows = new Map([['2026-09-01', { date: '2026-09-01', dailyData: { sludgeTotal: 50, steamSales: 200, organicSiloTotal: 99 } }]]);
  const newer = item(); newer.completedAt = '2026-09-08T13:00:00Z';
  const older = item('2026-09-01', [20, 30, 40]);
  const next = item('2026-09-02', [1, 2, 3]);
  h.api.mergeHistoryRows(rows, [older, next, newer], d => d >= '2026-09-01' && d <= '2026-09-30');
  assert.equal(rows.get('2026-09-01').dailyData.organicSiloTotal, newer.result.organicSiloTotal);
  assert.equal(rows.get('2026-09-01').dailyData.sludgeTotal, 50); assert.equal(rows.get('2026-09-01').dailyData.steamSales, 200);
  assert.equal(rows.get('2026-09-02').dailyData.organicSiloTotal, 6);
  rows.get('2026-09-01').dailyData.organicSiloTotal = 25;
  assert.equal(rows.get('2026-09-01').dailyData.organicSiloTotal, 25);
});

test('only explicit desktop authenticated action creates requests; date restore is read only', async () => {
  const h = harness();
  await h.api.load(); assert.equal(h.requests.length, 0);
  h.api.restoreCompleted([item()], '2026-09-01'); assert.equal(h.requests.length, 0);
  h.signedIn(''); await h.api.load({ userInitiated: true }); assert.equal(h.requests.length, 0);
  h.signedIn('token'); h.mobile(true); await h.api.load({ userInitiated: true }); assert.equal(h.requests.length, 0);
  h.mobile(false); await h.api.load({ userInitiated: true });
  assert.equal(h.requests.length, 1); const request = JSON.parse(h.requests[0].options.body);
  assert.deepEqual(request, { requestType: 'organic_silo_dataparc', targetDate: '2026-09-01', forceRefresh: true });
  assert.equal(h.events[0].type, 'efficiencyMorningMeetingOrganicSiloLoaded');
});

test('late response after navigation cannot overwrite current date; failed refresh retains previous inventory', async () => {
  const h = harness(); let complete;
  h.context.fetch = async () => ({ ok: true, json: () => new Promise(resolve => { complete = resolve; }) });
  const pending = h.api.load({ userInitiated: true }); await new Promise(resolve => setImmediate(resolve));
  h.panel.dataset.morningMeetingAutoBaseDate = '2026-09-02'; complete({ ok: true, item: item() }); await pending;
  assert.equal(h.events.length, 0); assert.deepEqual(Object.keys(h.api.valuesForWorkbook({})), []);
  h.panel.dataset.morningMeetingAutoBaseDate = '2026-09-01'; h.api.restoreCompleted([item()], '2026-09-01');
  h.context.fetch = async () => ({ ok: false, json: async () => ({ ok: false, message: 'Agent unavailable' }) });
  await h.api.load({ userInitiated: true });
  assert.equal(h.api.valuesForWorkbook({}).organicSiloTotal, item().result.organicSiloTotal);
  assert.equal(h.nodes.get('organicSiloDataParcStatus').textContent, '조회 실패');
});

test('script integration hooks run before manual history overrides and after base daily renderer', () => {
  const script = readFileSync(new URL('../script.js', import.meta.url), 'utf8');
  const history = script.slice(script.indexOf('function mergeSavedRows('));
  assert.ok(history.indexOf('organicSiloDataParc?.mergeHistoryRows') < history.indexOf('const overrideItems'));
  assert.match(script, /if \(window\.organicSiloDataParc\?\.restoreCompleted\(items, normalizedDate\)\)\s*\{\s*restored = true;/);
  const renderer = script.slice(script.indexOf('function renderSteamStatus()'), script.indexOf('function scheduleRender()', script.indexOf('function renderSteamStatus()')));
  assert.ok(renderer.indexOf('organicSiloDataParc?.render({ baseRendered: true })') > renderer.indexOf('elements.organicSiloTotal.textContent'));
  assert.match(script, /organicSiloDataParc\.valuesForWorkbook\(dailyData\)/);
});


test('Silo-only export notice handles zero stock and preserves the existing confirmation flow', () => {
  const h = harness(); h.api.restoreCompleted([item('2026-09-01', [0, 0, 0])], '2026-09-01');
  assert.equal(Number.isFinite(h.api.valuesForWorkbook({}).organicSiloTotal), true);
  const script = readFileSync(new URL('../script.js', import.meta.url), 'utf8');
  assert.match(script, /const hasOrganicSiloInventory = Number\.isFinite\(\s*window\.organicSiloDataParc\?\.valuesForWorkbook\(\{\}\)\?\.organicSiloTotal\s*\)/);
  assert.match(script, /전력·태양광·증기·유기성 입고 자동수치가 없습니다\. 조회한 Silo 재고는 포함됩니다\./);
  assert.match(script, /const missingDailyDataMessage = hasOrganicSiloInventory/);
});
