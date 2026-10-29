import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = fs.readFileSync(path.join(ROOT, 'functions/api/blower-history.js'), 'utf8');
const client = fs.readFileSync(path.join(ROOT, 'maintenance/blower-history.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'maintenance/blower-history.html'), 'utf8');
const originalTags = [
  '104HHL60AP611','104HHL60AP621','104HHL60AP631',
  '204HHL60AP611','204HHL60AP621','204HHL60AP631',
  '104HHL10AN611','104HHL10AN621','104HHL10AN631',
  '204HHL10AN611','204HHL10AN621','204HHL10AN631',
  '104SDF01AN001','104SDF01AN002','204SDF01AN001','204SDF01AN002',
  '204LMDF01AN001','104ETG30AN601','104ETG30AN602',
  '204ETG30AN601','204ETG30AN602','104ETH03AN601','104ETH03AN602'
];
const limestone = [
  ['103HRJ01AN601', '1', '#A', 'GSPOGE.ABB_DCS.103HRJ01AN601XB04', 701],
  ['103HRJ01AN602', '1', '#B', 'GSPOGE.ABB_DCS.103HRJ01AN602XB04', 702],
  ['203HRJ01AN601', '2', '#A', 'GSPOGE.ABB_DCS.203HRJ01AN601XB04', 751],
  ['203HRJ01AN602', '2', '#B', 'GSPOGE.ABB_DCS.203HRJ01AN602XB04', 752]
];
function extractArray(name) {
  const start = server.indexOf(`const ${name} = [`);
  assert.notEqual(start, -1, `${name} missing`);
  const end = server.indexOf('\n];', start);
  assert.ok(end > start);
  return server.slice(server.indexOf('[', start), end + 2);
}
function extractFunction(name) {
  const start = server.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} missing`);
  const end = server.slice(start).search(/^}\s*$/m);
  assert.ok(end > 0);
  return server.slice(start, start + end + 1);
}
const types = vm.runInNewContext(`(${extractArray('TYPE_DEFINITIONS')})`);
const seeds = vm.runInNewContext(`(${extractArray('ASSET_SEEDS')})`);
function missing(assets) {
  const context = { assets };
  vm.runInNewContext(`const TYPE_DEFINITIONS = ${extractArray('TYPE_DEFINITIONS')};\nconst PENDING_ASSET_SLOTS = [];\n${extractFunction('expectedPositions')}\n${extractFunction('buildMissingSlotDetails')}\nresult = buildMissingSlotDetails(assets);`, context);
  return JSON.parse(JSON.stringify(context.result));
}

test('23 historic seeds retain identical identity and order', () => {
  assert.equal(seeds.length, 27);
  assert.deepEqual(JSON.parse(JSON.stringify(seeds.slice(0, 23).map(x => x[0]))), originalTags);
});
test('4 Limestone seeds map exact unit, A/B position and real equipment TAG', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(seeds.slice(23).map(x => [x[0], x[2], x[3], x[5]]))), limestone.map(x => [x[0], x[1], x[2], x[4]]));
  assert.ok(seeds.slice(23).every(x => x[1] === 'limestone'));
  assert.equal(new Set(seeds.map(x => x[0])).size, 27);
});
test('Exactly one new Limestone type with 2 assets per unit', () => {
  const entries = types.filter(x => x.key === 'limestone');
  assert.equal(entries.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(entries[0].expected)), { '1': 2, '2': 2 });
});
test('All 27 real seeds have no phantom missing cards', () => {
  const registered = seeds.map(x => ({ blowerType: x[1], unitNo: x[2], positionLabel: x[3], assetGroup: x[6] || '' }));
  assert.deepEqual(missing(registered), []);
});
test('All 4 DataPARC source candidates are exact, distinct and exclude /PLOT', () => {
  const idx = server.indexOf('const LIMESTONE_RUN_SIGNAL_CANDIDATES');
  assert.ok(idx > 0);
  const mapping = server.slice(idx, server.indexOf('});', idx) + 3);
  for (const row of limestone) assert.ok(mapping.includes(`"${row[0]}": "${row[3]}"`));
  assert.doesNotMatch(mapping, /\/PLOT|104HRJ01AN|204HRJ01AN/);
  assert.equal(new Set(limestone.map(x => x[3])).size, 4);
});
test('RUN probes are restricted to four exact Limestone equipment mappings', () => {
  const sync=server.slice(server.indexOf('const DATAPARC_RUNTIME_SYNC_ASSET_TAGS'),server.indexOf('const DATAPARC_RUNTIME_SYNC_SOURCE_TYPE'));
  const clientSync=client.slice(client.indexOf('const DATAPARC_RUNTIME_ASSET_TAGS'),client.indexOf('const DATAPARC_RUNTIME_KNOWN_SOURCE'));
  assert.match(sync,/"limestone"/);
  for(const [tag] of limestone)assert.match(clientSync,new RegExp(tag));
  assert.match(server,/LIMESTONE_RUN_SIGNAL_CANDIDATES\[assetTag\]/);
});

test('Limestone runtime never accumulates by wall-clock time while RUN is unverified', () => {
  const context = { normalizeText: x => String(x ?? '').trim(), DATAPARC_RUNTIME_SYNC_ASSET_TAGS: [], isIntermittentBlower: () => false };
  vm.runInNewContext(`${extractFunction('usesMeasuredBlowerRuntime')}\nresult = usesMeasuredBlowerRuntime({blower_type:'limestone',tag_number:'103HRJ01AN601'});`, context);
  assert.equal(context.result, true);
  assert.match(server, /!usesMeasuredBlowerRuntime\(asset\) && Number\(asset\.is_running\) === 1/);
});
test('Safe additive DB readiness: 6 types and 10 sentinels', () => {
  assert.match(server, /Number\(ready\?\.setting_count \|\| 0\) >= 6/);
  assert.match(server, /Number\(ready\?\.sentinel_asset_count \|\| 0\) >= 10/);
  assert.match(server, /\["limestone", null, null, null\]/);
});
test('Limestone view is distinct and source is flagged as confirmation pending', () => {
  assert.match(client, /limestone: "Limestone Blower"/);
  assert.match(client, /"seal_pot", "limestone"/);
  assert.match(client, /asset\.limestoneSignalCandidate && !asset\.dataParcRuntimeBasis \?/);
  assert.match(client, /RUN 신호 확인 대기/);
  assert.match(html, /blower-history\.js\?v=20261029-limestone-run-v4/);
});
