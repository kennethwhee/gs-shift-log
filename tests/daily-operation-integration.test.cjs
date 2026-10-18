'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = process.env.DAILY_OPERATION_SOURCE_ROOT || path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'script.js'), 'utf8');

test('native efficiency menu contains the new report between the two requested menus', () => {
  const daily = html.indexOf('id="efficiencyDailyWorkTab"');
  const operation = html.indexOf('id="efficiencyDailyOperationTab"');
  const morning = html.indexOf('id="efficiencyMorningMeetingTab"');
  assert.ok(daily > 0 && daily < operation && operation < morning);
  for (const id of ['efficiencyDailyOperationTab', 'efficiencyDailyOperationView']) {
    assert.equal(html.split(`id="${id}"`).length - 1, 1);
  }
  assert.match(html, /data-efficiency-tab="daily-operation"/);
  assert.match(html, /data-efficiency-view="daily-operation"/);
  const positions = ['daily-operation-layout.js', 'daily-operation-sources.js', 'daily-operation-reports.js'].map(name => {
    assert.equal(html.split(name).length - 1, 1);
    return html.indexOf(name);
  });
  assert.ok(positions[0] < positions[1] && positions[1] < positions[2]);
  assert.match(html, /dailyOperation=20261018-v1/);
});

test('native router selects only daily report and preserves existing menu switching', () => {
  const start = script.indexOf('function switchEfficiencyTeamView(');
  const end = script.indexOf('function openEfficiencyTeamModal()', start);
  assert.ok(start >= 0 && end > start);
  const element = dataset => ({dataset, hidden: true, attrs: {}, scrollTop: 32,
    classList: { values: new Set(), toggle(key, enabled) { if (enabled) this.values.add(key); else this.values.delete(key); } },
    setAttribute(key, value) { this.attrs[key] = value; }});
  const names = ['daily-work', 'daily-operation', 'morning-meeting', 'morning-meeting-auto-history', 'limestone'];
  const tabs = names.map(name => element({efficiencyTab: name}));
  const views = names.map(name => element({efficiencyView: name}));
  const empty = element({});
  let reportsOpened = 0, morningHistoryOpened = 0;
  const context = vm.createContext({getEfficiencyTeamElements: () => ({tabs, views}),
    document: {getElementById: () => empty},
    window: {matchMedia: () => ({matches: false}), openDailyOperationReportView: () => reportsOpened++,
      openEfficiencyMorningMeetingAutoHistoryView: () => morningHistoryOpened++}});
  vm.runInContext(script.slice(start, end), context);
  context.switchEfficiencyTeamView('daily-operation');
  assert.equal(reportsOpened, 1); assert.equal(morningHistoryOpened, 0);
  assert.deepEqual(views.filter(view => !view.hidden).map(view => view.dataset.efficiencyView), ['daily-operation']);
  assert.equal(tabs[1].attrs['aria-selected'], 'true'); assert.equal(tabs[1].tabIndex, 0);
  assert.equal(empty.hidden, true); assert.equal(views[1].scrollTop, 0);
  context.switchEfficiencyTeamView('morning-meeting');
  assert.equal(reportsOpened, 1);
  assert.deepEqual(views.filter(view => !view.hidden).map(view => view.dataset.efficiencyView), ['morning-meeting']);
  context.switchEfficiencyTeamView('morning-meeting-auto-history');
  assert.equal(morningHistoryOpened, 1);
  assert.equal(tabs[2].classList.values.has('is-parent-active'), true);
  context.switchEfficiencyTeamView('unknown');
  assert.equal(empty.hidden, false); assert.equal(views.every(view => view.hidden), true);
});
