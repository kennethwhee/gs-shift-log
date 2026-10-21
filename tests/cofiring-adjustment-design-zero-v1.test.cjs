'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createRequire} = require('node:module');

// Exercise production handlers and rendering with the existing shared editor's
// API/DOM adapter. Loading the reusable fixture must not register its old tests.
const fixturePath = path.join(__dirname, 'morning-meeting-cofiring-bidirectional-v2.test.cjs');
const fixtureSource = fs.readFileSync(fixturePath, 'utf8');
const boundary = fixtureSource.indexOf("\ntest('morning context uses unadjusted original");
assert.ok(boundary > 0, 'The reusable browser fixture must precede its registered tests');
const fixtureModule = {exports:{}};
vm.runInNewContext(fixtureSource.slice(0, boundary) + '\nmodule.exports={browser};', {
  require:createRequire(fixturePath), module:fixtureModule, __dirname, console,
  Headers, URL, URLSearchParams, AbortController, setImmediate
}, {filename:fixturePath});
const {browser} = fixtureModule.exports;
const select = (b, key) => b.modal().querySelector('[data-cfv56-' + key + ']');
const notice = b => select(b, 'zero-notices');
const tab = (b, name) => select(b, 'tab="' + name + '"');
const panel = (b, name) => select(b, 'panel="' + name + '"');
const fields = b => b.modal().querySelectorAll('[data-cfv56-table-field]');
const field = (b, unit, key) => fields(b).find(e => e.dataset.cfv56TableUnit === unit && e.dataset.cfv56TableField === key);
const rows = b => [...notice(b).innerHTML.matchAll(/<div\b[^>]*class="[^"]*\bcfv56-zero-row\b[^"]*"[^>]*>([\s\S]*?)<\/div>/g)].map(match => match[1]);

async function opened(b = browser()) {
  const spec = {startLocal:b.raw.period.startLocal, endLocal:b.raw.period.endLocal};
  // Direct mounting also permits incomplete source fixtures: a missing quantity
  // must remain distinct from a confirmed zero before any calculation is valid.
  const context = {result:b.raw, settings:b.settings, spec};
  b.editor = b.adjust.create({container:b.doc.createElement('div'), getContext:() => context,
    getHeaders:b.root.getShiftLogAuthHeaders});
  await b.editor.open();
  assert.ok(notice(b), 'The zero-use notice region must be mounted once');
  return b;
}

function rebaseline(b) {
  const result = b.adjust.adjustFinal(b.raw, b.settings, b.raw.units.unit1.bio.quantity, b.raw.units.unit2.bio.quantity);
  assert.equal(result.ok, true, result.message);
  Object.assign(b.raw, result.result);
  delete b.raw.adjustment;
}

test('redesigned editor initially selects the automatic panel without making a write', async () => {
  const b = await opened();
  assert.equal(tab(b, 'auto').getAttribute('aria-selected'), 'true');
  assert.equal(tab(b, 'manual').getAttribute('aria-selected'), 'false');
  assert.equal(panel(b, 'auto').hidden, false);
  assert.equal(panel(b, 'manual').hidden, true);
  assert.equal(select(b, 'apply').disabled, true, 'A design change must not manufacture an adjustment');
  assert.equal(b.posts.length, 0);
});

test('switching adjustment tabs preserves a successful preview and does not select new random targets', async () => {
  const b = await opened(), original = JSON.stringify(b.raw);
  let draws = 0;
  b.root.Math = Object.create(Math);
  b.root.Math.random = () => { draws++; return 0.4; };
  select(b, 'auto').click();
  assert.equal(select(b, 'apply').disabled, false);
  const result = select(b, 'final').innerHTML;
  const values = fields(b).map(e => e.value);
  const selectedDraws = draws;
  assert.ok(selectedDraws > 0);
  for (const selected of ['manual', 'auto', 'manual', 'auto']) {
    tab(b, selected).click();
    assert.equal(tab(b, selected).getAttribute('aria-selected'), 'true');
    assert.equal(panel(b, selected).hidden, false);
    const other = selected === 'auto' ? 'manual' : 'auto';
    assert.equal(tab(b, other).getAttribute('aria-selected'), 'false');
    assert.equal(panel(b, other).hidden, true);
    assert.equal(select(b, 'final').innerHTML, result);
    assert.deepEqual(fields(b).map(e => e.value), values);
    assert.equal(select(b, 'apply').disabled, false);
  }
  assert.equal(draws, selectedDraws);
  assert.equal(JSON.stringify(b.raw), original);
  assert.equal(b.posts.length, 0);
});

test('confirmed zero Coal, Bio and organic quantities are grouped under their correct unit', async () => {
  const b = browser();
  b.raw.units.unit1.coal = {quantity:0, complete:true};
  b.raw.units.unit1.organic = {quantity:0};
  b.raw.units.unit2.bio = {quantity:0, complete:true};
  const original = JSON.stringify(b.raw);
  await opened(b);
  assert.equal(notice(b).hidden, false);
  const grouped = rows(b);
  assert.equal(grouped.length, 2);
  const one = grouped.find(row => /<strong\b[^>]*>1호기<\/strong>/.test(row));
  const two = grouped.find(row => /<strong\b[^>]*>2호기<\/strong>/.test(row));
  assert.ok(one); assert.ok(two);
  assert.match(one, /Coal 사용량 0톤 입니다\./);
  assert.match(one, /유기성 사용량 0톤 입니다\./);
  assert.doesNotMatch(one, /Bio 사용량/);
  assert.match(two, /Bio 사용량 0톤 입니다\./);
  assert.doesNotMatch(two, /Coal 사용량|유기성 사용량/);
  assert.doesNotMatch(notice(b).innerHTML, /축분 사용량/);
  assert.equal(JSON.stringify(b.raw), original);
  assert.equal(b.posts.length, 0);
});

test('positive fuel use leaves the compact notice hidden even when manure usage is zero', async () => {
  const b = await opened();
  assert.equal(b.raw.units.unit1.manure.quantity, 0);
  assert.equal(notice(b).hidden, true);
  assert.doesNotMatch(notice(b).innerHTML, /사용량 0톤/);
  assert.equal(b.posts.length, 0);
});

test('unknown, nonnumeric, incomplete and small positive quantities are never reported as zero use', async () => {
  const cases = [
    ['null', {quantity:null}], ['missing', {}], ['empty text', {quantity:''}],
    ['numeric text', {quantity:'0'}], ['nonfinite', {quantity:Number.NaN}],
    ['positive below display precision', {quantity:0.000001, complete:true}],
    ['explicitly incomplete zero', {quantity:0, complete:false}]
  ];
  for (const [label, value] of cases) {
    const b = browser();
    for (const unit of ['unit1', 'unit2']) for (const fuel of ['coal', 'bio', 'organic']) b.raw.units[unit][fuel] = {...value};
    await opened(b);
    assert.equal(notice(b).hidden, true, label);
    assert.doesNotMatch(notice(b).innerHTML, /사용량 0톤/, label);
    assert.equal(b.posts.length, 0, label);
  }
});

test('provisional organic inventory zero is suppressed while a confirmed Bio zero remains visible', async () => {
  const b = browser();
  for (const unit of ['unit1', 'unit2']) b.raw.units[unit].organic = {quantity:0, complete:true};
  b.raw.organicUsage = {ok:true, provisionalZero:true};
  b.raw.units.unit2.bio = {quantity:0, complete:true};
  await opened(b);
  assert.equal(notice(b).hidden, false);
  assert.doesNotMatch(notice(b).innerHTML, /유기성 사용량/);
  const grouped = rows(b);
  assert.equal(grouped.length, 1);
  assert.match(grouped[0], /<strong\b[^>]*>2호기<\/strong>/);
  assert.match(grouped[0], /Bio 사용량 0톤 입니다\./);
});

test('maximum preview retains original zero-use notices after Coal compensation changes the displayed quantity', async () => {
  const b = browser();
  b.raw.units.unit1.coal.quantity = 0;
  b.raw.units.unit2.bio.quantity = 0;
  rebaseline(b);
  const original = JSON.stringify(b.raw);
  await opened(b);
  const before = notice(b).innerHTML;
  assert.match(before, /Coal 사용량 0톤 입니다\./);
  assert.match(before, /Bio 사용량 0톤 입니다\./);
  select(b, 'auto').click();
  assert.equal(select(b, 'apply').disabled, false);
  assert.ok(Number(field(b, 'unit1', 'coal').value) > 0, 'Automatic Bio reduction compensates Coal');
  assert.equal(Number(field(b, 'unit2', 'bio').value), 0, 'The existing inactive-Bio safeguard must remain active');
  assert.equal(notice(b).innerHTML, before, 'The note describes source use, not the adjusted result');
  assert.equal(JSON.stringify(b.raw), original);
  assert.equal(b.posts.length, 0);
});

test('a direct preview that reduces positive Bio to zero does not create a false source-zero notice', async () => {
  const b = await opened(), original = JSON.stringify(b.raw);
  assert.equal(notice(b).hidden, true);
  select(b, 'final1').value = '0';
  select(b, 'final2').value = String(b.raw.units.unit2.bio.quantity);
  select(b, 'preview-final').click();
  assert.equal(select(b, 'apply').disabled, false);
  assert.equal(Number(field(b, 'unit1', 'bio').value), 0);
  assert.equal(notice(b).hidden, true);
  assert.doesNotMatch(notice(b).innerHTML, /사용량 0톤/);
  assert.equal(JSON.stringify(b.raw), original);
  assert.equal(b.posts.length, 0);
});
