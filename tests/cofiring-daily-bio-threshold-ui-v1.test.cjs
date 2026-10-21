'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createRequire} = require('node:module');

const fixturePath = path.join(__dirname, 'morning-meeting-cofiring-bidirectional-v2.test.cjs');
const fixtureSource = fs.readFileSync(fixturePath, 'utf8');
const boundary = fixtureSource.indexOf("\ntest('morning context uses unadjusted original");
assert.ok(boundary > 0);
const fixtureModule = {exports: {}};
vm.runInNewContext(fixtureSource.slice(0, boundary) + '\nmodule.exports={browser,tick};', {
  require: createRequire(fixturePath), module: fixtureModule, __dirname, console, Headers,
  URL, URLSearchParams, AbortController, setImmediate
}, {filename: fixturePath});
const {browser, tick} = fixtureModule.exports;

async function editor(activeUnit, bio = 328.66, saved = null) {
  const b = browser(), inactiveUnit = activeUnit === 'unit1' ? 'unit2' : 'unit1';
  const spec = {startLocal: '2026-10-21T00:00', endLocal: '2026-10-21T17:51'};
  Object.assign(b.raw.period, spec, {durationHours: 17 + 51 / 60});
  b.raw.units[activeUnit].bio.quantity = bio;
  b.raw.units[inactiveUnit].bio.quantity = 0;
  const consistent = b.adjust.adjustFinal(b.raw, b.settings,
    b.raw.units.unit1.bio.quantity, b.raw.units.unit2.bio.quantity);
  assert.equal(consistent.ok, true, consistent.message);
  Object.assign(b.raw, consistent.result);
  delete b.raw.adjustment;
  const posts = [], reads = [];
  let state = saved, revision = saved ? 3 : 0, draws = 0;
  b.root.Math = Object.create(Math);
  b.root.Math.random = () => { draws += 1; return 0; };
  b.root.fetch = async (url, options = {}) => {
    reads.push(String(url));
    if (options.method === 'POST') {
      const body = JSON.parse(options.body);
      posts.push(body);
      state = body.action === 'clear' ? null : body.adjustment;
      revision += 1;
      return {ok: true, json: async () => ({ok: true, entry: {revision}, adjustment: state})};
    }
    return {ok: true, json: async () => ({ok: true, start: spec.startLocal, end: spec.endLocal,
      revision, adjustment: state, setting: {maxBioTpd: 361.4}})};
  };
  const applied = [], resets = [];
  const controller = b.adjust.create({container: b.card, getHeaders: () => ({}),
    getContext: () => ({result: b.raw, settings: b.settings, spec}),
    onApply: result => applied.push(result), onReset: () => resets.push(true)});
  await controller.open();
  const modal = b.doc.body.children.find(child => child.nodes);
  assert.ok(modal);
  const q = key => modal.querySelector('[data-cfv56-' + key + ']');
  const field = (unit, key) => modal.querySelectorAll('[data-cfv56-table-field]').find(
    node => node.dataset.cfv56TableUnit === unit && node.dataset.cfv56TableField === key);
  return {b, activeUnit, inactiveUnit, spec, posts, reads, applied, resets, controller,
    modal, q, field, draws: () => draws};
}

for (const activeUnit of ['unit1', 'unit2']) {
  test(`17h51 screenshot: ${activeUnit} 328.66t stays unchanged below the full 361.40t daily maximum`, async () => {
    const f = await editor(activeUnit), before = JSON.stringify(f.b.raw);
    assert.match(f.q('cap').textContent, /일일 최대.*361\.40/);
    assert.doesNotMatch(f.q('cap').textContent, /268\.79/);
    assert.match(f.q('cap').textContent, /시간 비례 감액 없음/);
    assert.equal(Number(f.field(activeUnit, 'bio').value), 328.66);
    assert.equal(Number(f.field(f.inactiveUnit, 'bio').value), 0);
    assert.equal(f.field(f.inactiveUnit, 'bio').disabled, true);
    f.q('auto').click();
    assert.match(f.q('msg').textContent, /361\.40/);
    assert.equal(Number(f.field(activeUnit, 'bio').value), 328.66);
    assert.equal(Number(f.field(f.inactiveUnit, 'bio').value), 0);
    assert.equal(f.q('apply').disabled, true);
    f.q('apply').click();
    await tick();
    assert.equal(f.draws(), 0);
    assert.deepEqual(f.posts, []);
    assert.deepEqual(f.applied, []);
    assert.equal(JSON.stringify(f.b.raw), before);
  });

  test(`17h51 over-limit ${activeUnit} adjusts to 361.30t while the unused unit stays zero`, async () => {
    const f = await editor(activeUnit, 450), before = JSON.stringify(f.b.raw);
    const inactiveCoal = f.b.raw.units[f.inactiveUnit].coal.quantity;
    f.q('auto').click();
    assert.equal(Number(f.field(activeUnit, 'bio').value), 361.3);
    assert.equal(Number(f.field(f.inactiveUnit, 'bio').value), 0);
    assert.equal(Number(f.field(f.inactiveUnit, 'coal').value), Math.round(inactiveCoal * 100) / 100);
    assert.equal(f.draws(), 1);
    assert.equal(f.q('apply').disabled, false);
    f.q('apply').click();
    await tick();
    assert.equal(f.posts.length, 1);
    const saved = f.posts[0].adjustment;
    assert.equal(saved.mode, 'max_auto');
    assert.equal(saved[activeUnit === 'unit1' ? 'finalBioUnit1' : 'finalBioUnit2'], 361.3);
    assert.equal(saved[f.inactiveUnit === 'unit1' ? 'finalBioUnit1' : 'finalBioUnit2'], 0);
    assert.equal(saved.excludedBioTons, 88.7);
    assert.equal(saved.bioTransferTons, 0);
    assert.equal(JSON.stringify(f.b.raw), before);
  });

  test(`obsolete 268.72t max-auto saved preview cannot replace ${activeUnit}'s original 328.66t`, async () => {
    const saved = {mode: 'max_auto', finalBioUnit1: activeUnit === 'unit1' ? 268.72 : 0,
      finalBioUnit2: activeUnit === 'unit2' ? 268.72 : 0,
      maxBioTpd: 361.4, fromUnit: null, bioTransferTons: 0, excludedBioTons: 59.94};
    const f = await editor(activeUnit, 328.66, saved), before = JSON.stringify(f.b.raw);
    assert.equal(Number(f.field(activeUnit, 'bio').value), 328.66);
    assert.equal(Number(f.field(f.inactiveUnit, 'bio').value), 0);
    assert.equal(f.q('apply').disabled, true);
    assert.equal(f.q('reset').disabled, false);
    f.q('auto').click();
    assert.equal(Number(f.field(activeUnit, 'bio').value), 328.66);
    assert.equal(f.q('apply').disabled, true);
    assert.equal(f.draws(), 0);
    assert.deepEqual(f.posts, []);
    assert.equal(JSON.stringify(f.b.raw), before);
  });
}
