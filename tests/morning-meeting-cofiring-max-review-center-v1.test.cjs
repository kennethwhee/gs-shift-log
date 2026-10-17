'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const repo = path.resolve(__dirname, '..');
const morning = fs.readFileSync(path.join(repo, 'maintenance/morning-meeting-cofiring-adjustment.js'), 'utf8');
const index = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');

test('current morning editing delegates to the shared adjustment editor before the retained legacy modal path', () => {
  assert.match(morning, /async function openModal\(\)\s*\{\s*if\s*\(usingClosedHistory\(\)\)\s*\{\s*closeModal\(\);\s*await window\.CofiringSharedAdjustmentSyncV2\?\.morning\?\.open\(\);\s*return;/);
  const engine = index.indexOf('/maintenance/cofiring-period-adjustment-v56.js?');
  const bridge = index.indexOf('/maintenance/cofiring-shared-adjustment-sync-v2.js?');
  const calculator = index.indexOf('/maintenance/cofiring-period-ui-v5.js?');
  assert.ok(engine >= 0 && bridge > engine && calculator > bridge, 'The same editor must serve morning and calculator entry points');
});

test('the retained standalone legacy maximum calculation still validates fuel and conserves available Bio', () => {
  const window = {};
  const context = {window, document:{readyState:'loading', addEventListener(){}}, console};
  vm.runInNewContext(morning, context);
  const calculate = window.calculateMorningMeetingCofiringMaxAdjustment;
  assert.equal(typeof calculate, 'function');
  assert.equal(calculate({}, {}, 361.4).ok, false);
  const fuel = {unitOne:{coal:600, bio:500, organic:30}, unitTwo:{coal:650, bio:100, organic:20}};
  const original = JSON.stringify(fuel);
  const settings = {coalKcalPerKg:5868, bioKcalPerKg:3237, organicKcalPerKg:3487};
  const result = calculate(fuel, settings, 361.4);
  assert.equal(result.ok, true, result.message);
  assert.ok(result.fuelData.unitOne.bio <= 361.4 && result.fuelData.unitTwo.bio <= 361.4);
  assert.ok(Math.abs(result.fuelData.unitOne.bio + result.fuelData.unitTwo.bio - 600) < 0.011);
  assert.equal(JSON.stringify(fuel), original);
});
