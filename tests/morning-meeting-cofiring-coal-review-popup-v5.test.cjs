'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = process.argv[2];
if (!repo) throw new Error('Repo path required');

const overlayPath = path.join(repo, 'maintenance', 'morning-meeting-cofiring-coal-review-popup-v4.js');
const indexPath = path.join(repo, 'index.html');
const source = fs.readFileSync(overlayPath, 'utf8');
const index = fs.readFileSync(indexPath, 'utf8');
const api = require(overlayPath);

let checks = 0;
const check = (value, message) => { assert.ok(value, message); checks += 1; };

check(source.includes('MORNING-MEETING-COFIRING-COAL-REVIEW-POPUP-V5-TOP-LAYER'), 'V5 marker');
check(source.includes("doc.createElement('dialog')"), 'native dialog element');
check(source.includes('dialog.showModal()'), 'top-layer showModal');
check(source.includes('dialog.open'), 'duplicate-open guard');
check(source.includes('globalThis.confirm'), 'native-confirm fallback');
check(source.includes("event.stopImmediatePropagation()"), 'original handler blocked before confirmation');
check(source.includes('bypassButtons'), 'single replay bypass');
check(source.includes('data-mm-cofiring-coal-review-context'), 'V3 origin stamp fallback');
check(source.includes('getClientRects'), 'rendered Morning Meeting view fallback');
check(source.includes('오전\\s*회의\\s*자료'), 'label-based Morning Meeting fallback');
check(index.includes('morning-meeting-cofiring-coal-review-popup-v4.js?v=20260917-popup-v5-top-layer'), 'V5 cache-busted include');
check(!index.includes('morning-meeting-cofiring-coal-review-popup-v4.js?v=20260917-popup-v4'), 'old V4 include removed');

const v3Pos = index.indexOf('morning-meeting-cofiring-coal-review-v1.js?v=20260916-coal-review-v3');
const v5Pos = index.indexOf('morning-meeting-cofiring-coal-review-popup-v4.js?v=20260917-popup-v5-top-layer');
check(v3Pos >= 0, 'V3 context recorder remains loaded');
check(v5Pos > v3Pos, 'V5 loads after V3 so the origin stamp is available first');

const makeClassList = (...classes) => ({ contains: value => classes.includes(value) });
const makeElement = ({ id = '', attrs = {}, classes = [], text = '', hidden = false, rects = 1 } = {}) => ({
  id,
  hidden,
  textContent: text,
  classList: makeClassList(...classes),
  getAttribute(name) { return attrs[name] ?? ''; },
  getClientRects() { return Array.from({ length: rects }, () => ({})); }
});

const activeTab = makeElement({
  id: 'efficiencyMorningMeetingTab',
  attrs: { 'data-efficiency-tab': 'morning-meeting', 'aria-selected': 'true' },
  classes: ['is-active'],
  text: '오전회의자료'
});
const activeView = makeElement({ id: 'efficiencyMorningMeetingView', classes: ['is-active'] });
const activeDoc = {
  getElementById(id) { return id === 'efficiencyMorningMeetingTab' ? activeTab : id === 'efficiencyMorningMeetingView' ? activeView : null; },
  querySelectorAll() { return [activeTab]; }
};
check(api.isMorningMeetingContext(activeDoc, { getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) }) === true, 'active Morning Meeting detected');

const stampedModal = makeElement({ attrs: { 'data-mm-cofiring-coal-review-context': 'morning-meeting' } });
const stampedButton = { closest() { return stampedModal; } };
const neutralDoc = { getElementById() { return null; }, querySelectorAll() { return []; } };
check(api.isMorningMeetingOrigin(neutralDoc, stampedButton, {}) === true, 'V3-stamped modal is accepted even if active-tab state later changes');

const hiddenTab = makeElement({ id: 'efficiencyMorningMeetingTab', attrs: { 'data-efficiency-tab': 'morning-meeting', 'aria-selected': 'false' }, text: '오전회의자료', rects: 0 });
const hiddenView = makeElement({ id: 'efficiencyMorningMeetingView', hidden: true, rects: 0 });
const otherTab = makeElement({ attrs: { 'data-efficiency-tab': 'cofiring', 'aria-selected': 'true' }, classes: ['is-active'], text: '혼소율' });
const otherDoc = {
  getElementById(id) { return id === 'efficiencyMorningMeetingTab' ? hiddenTab : id === 'efficiencyMorningMeetingView' ? hiddenView : null; },
  querySelectorAll() { return [otherTab]; }
};
check(api.isMorningMeetingContext(otherDoc, { getComputedStyle: () => ({ display: 'none', visibility: 'hidden' }) }) === false, 'main co-firing tab is not mistaken for Morning Meeting');

console.log(`PASS: morning-meeting co-firing coal review V5 top-layer contracts (${checks}).`);
