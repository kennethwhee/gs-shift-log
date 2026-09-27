'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'maintenance/cofiring-closed-detail-operator-v1.js'), 'utf8');
const context = vm.createContext({ window: {}, document: { readyState: 'loading', addEventListener() {} },
  MutationObserver: class {}, requestAnimationFrame() {}, setTimeout() {} });
vm.runInContext(source.replace(/\n\}\)\(\);\s*$/, '\n globalThis.detail = {parseHeatingValues, renderHeatingStrip};\n})();'), context);
const cells = values => ({ children: values.map(textContent => ({ textContent })) });
const table = rows => ({ querySelector: () => ({ querySelectorAll: () => rows.map(cells) }) });
const plain = value => JSON.parse(JSON.stringify(value));

test('closed detail reads four fuel heats, ignores repeated headers and preserves unequal unit values', () => {
  const values = plain(context.detail.parseHeatingValues(table([
    ['연료', '1호기', '계수', '2호기', '계수'],
    ['Coal', '5,800', '1.01', '5,800', '0.99'],
    ['Bio', '3,200', '1', '3,300', '1'],
    ['유기성', '3,400', '1', '3,400', '1'],
    ['축분', '3,100', '1', '3,100', '1'],
    ['연료', '1호기', '계수', '2호기', '계수'], ['unknown', '99']
  ])));
  assert.deepEqual(values.map(x => x.fuel), ['Coal', 'Bio-SRF', '유기성 고형연료', '축분']);
  assert.equal(values[0].value, '5,800');
  assert.equal(values[1].same, false);
  assert.equal(values[1].unit1Heat, '3,200'); assert.equal(values[1].unit2Heat, '3,300');
  assert.deepEqual(plain(context.detail.parseHeatingValues({ querySelector: () => null })), []);
});

test('repeated detail rendering keeps one strip and retains the original table for audit', () => {
  const classes = () => { const names = new Set(); return { add: x => names.add(x), contains: x => names.has(x) }; };
  const original = { classList: classes() }, host = { classList: classes(), innerHTML: '' };
  host.classList.add('cfh-v5-strip-host');
  const card = { children: [original, host], classList: classes(), querySelector: () => host };
  const values = [{ fuel: 'Coal', same: true, value: '5,800' }, { fuel: 'Bio-SRF', same: false, unit1Heat: '3,200', unit2Heat: '3,300' }];
  context.detail.renderHeatingStrip(card, values); const first = host.innerHTML;
  context.detail.renderHeatingStrip(card, values);
  assert.equal(host.innerHTML, first); assert.equal(card.children.length, 2);
  assert.equal(original.classList.contains('cfh-v5-hide-original'), true);
  assert.match(first, /1호기 3,200 · 2호기 3,300/); assert.match(first, /5,800/);
  assert.equal((first.match(/cfh-v5-fuel-item/g) || []).length, 2);
});

test('current enhancer stays scoped to closed detail and hides the obsolete metadata branch', () => {
  assert.match(source, /ROOT_SELECTOR = "#efficiencyCofiringDraftView"/);
  assert.match(source, /if \(!basisCard \|\| !metaCard \|\| basisCard === metaCard\) return false/);
  assert.match(source, /metaBranch\.classList\.add\("cfh-v5-meta-branch-hidden"\)/);
  const css = fs.readFileSync(path.join(root, 'maintenance/cofiring-closed-detail-operator-v1.css'), 'utf8');
  assert.match(css, /\.cfh-v5-meta-branch-hidden\{\s*display:none!important/);
});
