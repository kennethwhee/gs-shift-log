'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createRequire} = require('node:module');
const repo = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(repo, name), 'utf8');
const normal = value => JSON.parse(JSON.stringify(value));
const reviewText = '최대혼소 조정 후 1·2호기 석탄 사용량을 확인해 주세요.';

// Reuse the actual shared-modal fixture without registering its historical
// tests. It supplies synthetic DOM and API adapters; all adjustment handlers,
// calculation, rendering and persistence still come from production modules.
const fixturePath = path.join(__dirname, 'morning-meeting-cofiring-bidirectional-v2.test.cjs');
const fixtureSource = fs.readFileSync(fixturePath, 'utf8');
const testBoundary = fixtureSource.indexOf("\ntest('morning context uses unadjusted original");
assert.ok(testBoundary > 0, 'The reviewed reusable browser fixture must precede its tests');
const fixtureModule = {exports:{}};
vm.runInNewContext(fixtureSource.slice(0, testBoundary)+'\nmodule.exports={browser,tick,Event,deferred};', {
  require:createRequire(fixturePath), module:fixtureModule, __dirname, console,
  Headers, URL, URLSearchParams, AbortController, setImmediate
}, {filename:fixturePath});
const {browser, tick, Event, deferred} = fixtureModule.exports;
const select = (b, name) => b.modal().querySelector('[data-cfv56-'+name+']');
function input(b, name, value) {
  const element = select(b, name); element.value = String(value);
  element.dispatchEvent(new Event('input', {target:element}));
}
async function opened() { const b = browser(); await b.shared.morning.open(); return b; }
function verifyNoDynamicToast(b, originalChildren) {
  const modal = b.modal();
  assert.equal(modal.querySelectorAll('[data-cfv56-coal-review-notice]').length, 1);
  assert.equal(modal.querySelectorAll('[data-cfv56-coal-review-toast]').length, 0);
  assert.equal(modal.querySelectorAll('[data-cfv56-coal-review-center-close]').length, 0);
  assert.equal(b.doc.body.children.length, originalChildren, 'No body-level central toast is created');
  assert.equal(modal.children.length, 0, 'The fixed warning must not dynamically append an overlay');
}

test('V15 markup owns one inline coal note and separates the result title from its preview badge', () => {
  const b = browser(), html = b.adjust.modalHtml();
  assert.equal((html.match(/data-cfv56-coal-review-notice\b/g) || []).length, 1);
  assert.equal((html.match(new RegExp(reviewText, 'g')) || []).length, 1);
  assert.match(html, /<p\b[^>]*data-cfv56-coal-review-notice[^>]*role="note"[^>]*hidden/);
  assert.match(html, /<span\b[^>]*data-cfv56-result-title>현재 계산값<\/span>/);
  assert.match(html, /<span\b[^>]*data-cfv56-preview-badge[^>]*hidden>미리보기<\/span>/);
  const index = read('index.html');
  assert.doesNotMatch(index, /<script\b[^>]*morning-meeting-cofiring-coal-review-(?:v1|popup-v4)\.js/);
  assert.doesNotMatch(index, /<script\b[^>]*cofiring-max-adjust-warning-bar-cleanup-v1\.js/);
  assert.doesNotMatch(read('maintenance/cofiring-period-adjustment-v56.js'), /showCoalReviewToast|cfv56-coal-review-center-close/);
});

test('V15 successful opening has a quiet status area and no preview warning or badge', async () => {
  const b = await opened();
  assert.equal(select(b, 'msg').textContent, '');
  assert.equal(select(b, 'msg').hidden, true);
  assert.equal(select(b, 'preview-badge').hidden, true);
  assert.equal(select(b, 'coal-review-notice').hidden, true);
  assert.equal(select(b, 'result-title').textContent, '현재 계산값');
  assert.equal(b.posts.length, 0);
});

test('V15 repeated maximum previews show one persistent inline note without central or blue success messages', async () => {
  const b = await opened(), children = b.doc.body.children.length;
  for (let index=0; index<3; index++) {
    select(b, 'auto').click();
    assert.equal(select(b, 'coal-review-notice').hidden, false);
    assert.equal(select(b, 'preview-badge').hidden, false);
    assert.equal(select(b, 'result-title').textContent, '조정 결과');
    assert.equal(select(b, 'msg').textContent, '');
    assert.equal(select(b, 'msg').hidden, true);
    assert.equal(select(b, 'apply').disabled, false);
    assert.match(select(b, 'result-note').textContent, /Bio .+ t를 혼소 계산에서 제외합니다/);
    verifyNoDynamicToast(b, children);
  }
  assert.equal(b.posts.length, 0, 'A preview does not write to the API');
});

test('V15 changed inputs invalidate the preview while retaining the actionable input-change message', async () => {
  const b = await opened(); select(b, 'auto').click();
  input(b, 'max', 361.4);
  assert.equal(select(b, 'coal-review-notice').hidden, true);
  assert.equal(select(b, 'preview-badge').hidden, true);
  assert.equal(select(b, 'apply').disabled, true);
  assert.equal(select(b, 'msg').hidden, false);
  assert.match(select(b, 'msg').textContent, /입력값이 변경되었습니다/);
  assert.equal(select(b, 'msg').dataset.bad, '0');
});

test('V15 invalid maximum keeps its error visible and never displays a successful coal-review note', async () => {
  const b = await opened(), original = normal(b.raw);
  input(b, 'max', 0); select(b, 'auto').click();
  assert.equal(select(b, 'coal-review-notice').hidden, true);
  assert.equal(select(b, 'preview-badge').hidden, true);
  assert.equal(select(b, 'apply').disabled, true);
  assert.equal(select(b, 'msg').hidden, false);
  assert.equal(select(b, 'msg').dataset.bad, '1');
  assert.match(select(b, 'msg').textContent, /최대량/);
  assert.deepEqual(normal(b.raw), original); assert.equal(b.posts.length, 0);
});

test('V15 manual transfer clears the maximum-only note and preserves the original transfer calculation', async () => {
  const b = await opened(); select(b, 'auto').click();
  input(b, 'transfer', '10.123'); select(b, 'preview-transfer').click();
  assert.equal(select(b, 'coal-review-notice').hidden, true);
  assert.equal(select(b, 'preview-badge').hidden, false);
  assert.equal(select(b, 'msg').hidden, true);
  select(b, 'apply').click(); await tick();
  assert.equal(b.posts.length, 1);
  const payload = b.posts[0].body.adjustment;
  assert.equal(payload.mode, 'manual_transfer');
  assert.equal(payload.finalBioUnit1, 425.287987);
  assert.equal(payload.finalBioUnit2, 366.333456);
});

test('V15 an unchanged direct preview renders every zero delta as a dash', async () => {
  const b = await opened(); select(b, 'edit').click();
  input(b, 'final1', b.raw.units.unit1.bio.quantity);
  input(b, 'final2', b.raw.units.unit2.bio.quantity);
  select(b, 'preview-final').click();
  const html = select(b, 'final').innerHTML;
  const zeroDeltas = [...html.matchAll(/<div class="cfv56-metric-delta [^"]*is-zero[^"]*">([\s\S]*?)<\/div>/g)];
  assert.equal(zeroDeltas.length, 10, 'Two units retain all five original/delta metric pairs');
  assert.ok(zeroDeltas.every(match => match[1].trim() === '—'));
  assert.doesNotMatch(html, /±\s*0\.00/);
  assert.match(html, /cfv56-metric-base/);
  assert.equal(select(b, 'coal-review-notice').hidden, true);
});

test('V15 pending initial reads remain visible until the successful read clears the status', async () => {
  const b = browser(), wait = deferred(); b.qWaits.push(wait);
  const opening = b.shared.morning.open(); await tick();
  assert.equal(select(b, 'msg').hidden, false);
  assert.match(select(b, 'msg').textContent, /저장된 조정값을 확인/);
  wait.resolve(b.periodAnswer()); await opening;
  assert.equal(select(b, 'msg').hidden, true); assert.equal(select(b, 'msg').textContent, '');
});

test('V15 saving keeps its live status and the exact API payload before closing after success', async () => {
  const b = await opened(); select(b, 'auto').click();
  const originalFetch = b.root.fetch, gate = deferred();
  b.root.fetch = async (url, options={}) => {
    if (options.method === 'POST') await gate.promise;
    return originalFetch(url, options);
  };
  select(b, 'apply').click();
  assert.equal(select(b, 'msg').hidden, false);
  assert.match(select(b, 'msg').textContent, /저장하고 있습니다/);
  assert.equal(select(b, 'apply').disabled, true);
  assert.equal(b.modal().getAttribute('aria-busy'), 'true');
  gate.resolve(); await tick();
  assert.equal(b.posts.length, 1); assert.equal(b.modal().hidden, true);
  const post = b.posts[0];
  assert.equal(post.url, '/api/cofiring-period-adjustments');
  assert.deepEqual(Object.keys(post.body).sort(), ['action','start','end','adjustment','expectedRevision','requestId'].sort());
  assert.equal(post.body.action, 'save'); assert.equal(post.body.adjustment.mode, 'max_auto');
  const replay = b.adjust.replayAutoMax(b.raw, b.settings, post.body.adjustment.maxBioTpd,
    post.body.adjustment.finalBioUnit1, post.body.adjustment.finalBioUnit2);
  assert.equal(replay.ok, true, replay.message);
});

test('V15 failed saves retain the error and the open preview instead of publishing success', async () => {
  const b = await opened(); select(b, 'auto').click(); b.failWrite(true);
  select(b, 'apply').click(); await tick();
  assert.equal(b.modal().hidden, false); assert.equal(select(b, 'msg').hidden, false);
  assert.equal(select(b, 'msg').dataset.bad, '1');
  assert.match(select(b, 'msg').textContent, /WRITE_FAILED/);
  assert.equal(select(b, 'apply').disabled, false);
  assert.equal(b.server().revision, 0);
});
