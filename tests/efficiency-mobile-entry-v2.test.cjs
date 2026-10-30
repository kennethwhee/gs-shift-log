'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const html = read('mobile-app/index.html');
const decode = value => value.replaceAll('&amp;', '&');
const runtimeUrl = decode(html.match(/<script\b[^>]*src="([^"]*mobile-runtime[^"\s]*)"/)[1]);
const runtime = read(new URL(runtimeUrl, 'https://local.test').pathname.slice(1));

test('authenticated mobile entry loads the monitor and both menu panels', () => {
  // This page is the actual destination of the existing mobile gateway.
  assert.match(read('mobile/index.html'), /\/mobile-app\/\?build=/);
  for (const extension of ['css', 'js']) {
    const references = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => decode(match[1]));
    assert.equal(references.filter(url => url.startsWith('/maintenance/efficiency-mobile-menu-v1.' + extension + '?')).length, 1);
  }
  const nav = html.match(/<nav\b[^>]*class="efficiency-team-tabs"[^>]*>([\s\S]*?)<\/nav>/)[1];
  for (const [tabId, view] of [['efficiencyCofiringMonitorTab', 'cofiring-monitor'], ['efficiencySolidFuelTab', 'solid-fuel']]) {
    const buttons = [...nav.matchAll(/<button\b([^>]*)>/g)].filter(match => match[1].includes('id="' + tabId + '"'));
    assert.equal(buttons.length, 1);
    assert.ok(buttons[0][1].includes('data-efficiency-tab="' + view + '"'));
    const panelId = buttons[0][1].match(/aria-controls="([^"]+)"/)[1];
    const panel = [...html.matchAll(/<(?:section|article)\b([^>]*)>/g)].find(match => match[1].includes('id="' + panelId + '"'));
    assert.ok(panel && panel[1].includes('data-efficiency-view="' + view + '"') && /\bhidden\b/.test(panel[1]));
  }
  assert.doesNotMatch(html, /data-cofiring-draft-root/);
});

test('mobile normal load, preload and recovery loader use the same new runtime version', () => {
  const references = [...html.matchAll(/"(\/mobile-app\/mobile-runtime[^"\s]+)"/g)].map(match => decode(match[1]));
  assert.equal(references.length, 3);
  assert.deepEqual([...new Set(references)], [runtimeUrl]);
  assert.equal(new URL(runtimeUrl, 'https://local.test').searchParams.get('efficiencyMobile'), '20261030-entry-fix-v2');
});

test('real mobile runtime tab handlers activate monitor and solid fuel, then return to existing views', () => {
  const elements = new Map();
  function element(id, dataset = {}) {
    const classes = new Set();
    const listeners = new Map();
    const node = {
      id, dataset, hidden: false, attributes: {}, scrollTop: 10,
      classList: {
        add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name),
        toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); }
      },
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(name, fn) { listeners.set(name, fn); },
      click() { listeners.get('click')?.({target: this}); },
      focus() {}
    };
    elements.set(id, node);
    return node;
  }
  const tabs = [...html.matchAll(/<button\b([^>]*data-efficiency-tab="([^"]+)"[^>]*)>/g)].map(match =>
    element(match[1].match(/\bid="([^"]+)"/)[1], {efficiencyTab: match[2]}));
  const views = [...html.matchAll(/<(?:section|article)\b([^>]*data-efficiency-view="([^"]+)"[^>]*)>/g)].map(match =>
    element(match[1].match(/\bid="([^"]+)"/)[1], {efficiencyView: match[2]}));
  for (const id of ['efficiencyTeamModal', 'efficiencyTeamButton', 'closeEfficiencyTeamModalButton', 'closeEfficiencyTeamModalFooterButton', 'efficiencyTeamEmptyState']) element(id);
  const callbacks = [], selected = [];
  const document = {
    readyState: 'loading', body: element('body'),
    getElementById: id => elements.get(id),
    querySelectorAll: selector => selector === '[data-efficiency-tab]' ? tabs : views,
    querySelector: () => null,
    addEventListener(name, fn) { if (name === 'DOMContentLoaded') callbacks.push(fn); }
  };
  const window = {matchMedia: () => ({matches: true}), setTimeout: fn => fn(), GSEfficiencyMobileV1: {selectView: view => selected.push(view)}};
  const start = runtime.indexOf('(function initializeEfficiencyTeamFeature()');
  const end = runtime.indexOf('function getAuxiliaryMaterialElements()', start);
  assert.ok(start >= 0 && end > start);
  vm.runInNewContext(runtime.slice(start, end), {window, document, console});
  callbacks.forEach(fn => fn());
  elements.get('efficiencyTeamButton').click();
  assert.ok(elements.get('efficiencyTeamModal').classList.contains('is-open'));
  for (const value of ['cofiring-monitor', 'solid-fuel', 'limestone', 'auxiliary-materials', 'bed-ash-discharge', 'arm-roll']) {
    tabs.find(tab => tab.dataset.efficiencyTab === value).click();
    assert.equal(selected.at(-1), value, 'controller notified: ' + value);
    assert.deepEqual(views.filter(view => !view.hidden).map(view => view.dataset.efficiencyView), [value]);
    assert.equal(tabs.find(tab => tab.dataset.efficiencyTab === value).attributes['aria-selected'], 'true');
    assert.equal(elements.get('efficiencyTeamEmptyState').hidden, true);
  }
  window.switchEfficiencyTeamView('invalid');
  assert.ok(views.every(view => view.hidden));
  assert.equal(elements.get('efficiencyTeamEmptyState').hidden, false);
});
