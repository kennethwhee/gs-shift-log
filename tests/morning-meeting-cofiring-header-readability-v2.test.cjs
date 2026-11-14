'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../maintenance/morning-meeting-cofiring-card.js'), 'utf8');

class Element {
  constructor(tag = 'span') { this.tagName = tag.toUpperCase(); this.dataset = {}; this.attributes = new Map(); this.children = []; this._text = ''; this._classes = new Set(); }
  get className() { return [...this._classes].join(' '); }
  set className(value) { this._classes = new Set(String(value).split(/\s+/).filter(Boolean)); }
  get classList() { return {add: (...names) => names.forEach(x => this._classes.add(x)), remove: (...names) => names.forEach(x => this._classes.delete(x)), contains: x => this._classes.has(x)}; }
  get textContent() { return this.children.length ? this.children.map(x => x.textContent).join('') : this._text; }
  set textContent(value) { this._text = String(value); this.children = []; }
  replaceChildren(...children) { this.children = children; this._text = ''; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
}
function browser() {
  const badge = new Element();
  badge.setAttribute('title', 'ordinary title'); badge.setAttribute('aria-label', 'ordinary label');
  const document = {readyState: 'loading', addEventListener() {}, getElementById: () => badge,
    createElement: tag => new Element(tag), createTextNode: text => ({textContent: text})};
  const window = {};
  const marker = '  if (document.readyState === "loading") {';
  assert.equal(source.split(marker).length, 2, 'the production module exposes one startup point');
  const instrumented = source.replace(marker, '  window.__test = {setStatus, clearCalculationStatusNote, createCard};\n' + marker);
  vm.runInNewContext(instrumented, {window, document, HTMLElement: Element});
  return {...window.__test, badge};
}

test('quality gap has separate basis and caution labels with the full accessible note', () => {
  const b = browser(), note = '누적계 기준 계산 완료 · 품질 공백 포함 · 원본 품질 공백 최대 34.5초';
  b.setStatus('complete', '누적계 기준 · 품질 공백', note);
  assert.equal(b.badge.textContent, '누적계 기준 · 품질 공백');
  assert.equal(b.badge.children.length, 3);
  assert.equal(b.badge.children[0].textContent, '누적계 기준');
  assert.equal(b.badge.children[2].textContent, '품질 공백');
  assert.equal(b.badge.classList.contains('is-quality-gap'), true);
  assert.equal(b.badge.getAttribute('title'), note);
  assert.equal(b.badge.getAttribute('aria-label'), note);
});

test('loading, clean and unavailable states remove the gap styling and separate labels', () => {
  for (const [state, label] of [['loading', '마감자료 조회 중'], ['complete', '마감자료'], ['idle', '조회 대기'], ['warning', '마감자료 없음']]) {
    const b = browser();
    b.setStatus('complete', '혼소조정 적용 · 품질 공백', '원본 품질 공백 최대 34.5초');
    b.setStatus(state, label);
    assert.equal(b.badge.classList.contains('is-quality-gap'), false);
    assert.equal(b.badge.children.length, 0);
    assert.equal(b.badge.textContent, label);
    assert.equal(b.badge.getAttribute('title'), 'ordinary title');
    assert.equal(b.badge.getAttribute('aria-label'), 'ordinary label');
  }
});

test('legacy fallback clears the owned gap color while respecting another module note', () => {
  const b = browser();
  b.setStatus('complete', '누적계 기준 · 품질 공백', 'quality note');
  b.badge.setAttribute('title', 'another module title');
  b.clearCalculationStatusNote(b.badge);
  assert.equal(b.badge.classList.contains('is-quality-gap'), false);
  assert.equal(b.badge.getAttribute('title'), 'another module title');
  assert.equal(b.badge.getAttribute('aria-label'), 'ordinary label');
});

test('status is immediately before refresh in one compact toolbar and date stays with the title', () => {
  const b = browser(), html = b.createCard().innerHTML;
  const controls = /<div class="efficiency-morning-meeting-auto-card__meta morning-meeting-cofiring-card__meta">([\s\S]*?)<\/div>/.exec(html)?.[1];
  const title = /<header[^>]*>\s*<div>([\s\S]*?)<\/div>/.exec(html)?.[1];
  assert.ok(controls); assert.ok(title);
  assert.match(title, /혼소율 현황/);
  assert.match(title, /efficiencyMorningMeetingCofiringDate/);
  assert.doesNotMatch(controls, /efficiencyMorningMeetingCofiringDate/);
  assert.match(controls, /id="efficiencyMorningMeetingCofiringStatus"\s*>조회 대기<\/span>\s*<button[^>]*\bid="morningMeetingCofiringRefreshButton"/);
  assert.match(controls, /morningMeetingCofiringCalorificButton/);
  assert.doesNotMatch(html, /morning-meeting-cofiring-card__status-row/);
  const css = fs.readFileSync(path.join(__dirname, '../maintenance/morning-meeting-cofiring-card.css'), 'utf8');
  const inline = css.slice(css.indexOf('/* MORNING_MEETING_COFIRING_HEADER_INLINE_V3'));
  assert.match(inline, /flex-flow:\s*row nowrap !important/);
  assert.match(inline, /grid-template-rows:\s*auto !important/);
  assert.match(inline, /#efficiencyMorningMeetingCofiringStatus\s*\{[^}]*white-space:\s*nowrap !important[^}]*text-overflow:\s*ellipsis !important/);
});
