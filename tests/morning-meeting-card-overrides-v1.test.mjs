import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const frontend = read('maintenance/morning-meeting-card-overrides-v1.js');
const css = read('maintenance/morning-meeting-card-overrides-v1.css');
const api = read('functions/api/morning-meeting-card-overrides.js');
const index = read('index.html');

test('three Morning Meeting cards expose edit/save/cancel/original-restore controls', () => {
  for (const id of [
    'efficiencyMorningMeetingAutoDailyPowerCard',
    'efficiencyMorningMeetingAutoSteamCard',
    'efficiencyMorningMeetingAutoDailySludgeCard'
  ]) assert.ok(frontend.includes(id), id);
  for (const action of ['edit', 'save', 'cancel', 'restore']) {
    assert.ok(frontend.includes(`"${action}"`) || frontend.includes(`'${action}'`), action);
  }
  assert.match(frontend, /수정됨/);
  assert.match(css, /morning-card-override-input/);
});

test('all requested power, steam and organic fields are override-capable', () => {
  const fields = [
    'generatorEcmsGen1','ismartReception','epowerTransmission','solarDailyGeneration','solarMonthlyCumulative','solarYearlyCumulative',
    'steamSalesLowPressure','steamSalesHighPressure','steamSales','unitOneProduction','unitTwoProduction','totalProduction',
    'sludgeTotal','sludgeTruckCount','organicDaySilo','organicStorageSiloA','organicStorageSiloB','organicSiloTotal'
  ];
  for (const field of fields) {
    assert.ok(frontend.includes(field), `frontend ${field}`);
    assert.ok(api.includes(field), `api ${field}`);
  }
});

test('override storage is separate from every source table', () => {
  assert.match(api, /morning_meeting_card_overrides/);
  assert.match(api, /morning_meeting_card_overrides_audit/);
  assert.doesNotMatch(api, /(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?to_night_power_daily/i);
  assert.doesNotMatch(api, /(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?cofiring_closed/i);
  assert.doesNotMatch(api, /(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?ois_data_requests/i);
  assert.doesNotMatch(api, /(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?solid_fuel/i);
});

test('selected-date Data Delete invalidates older manual card overrides without touching sources', () => {
  assert.match(api, /reset_at/);
  assert.match(api, /updatedAt\s*<=\s*reset\.at/);
  assert.match(api, /MORNING_CARD_DATE_DELETED/);
  assert.match(frontend, /morningMeetingResetStateChanged/);
  assert.match(frontend, /refreshVisible\(true\)/);
});

test('final workbook current-values collector is wrapped so visible manual values win', () => {
  assert.match(frontend, /morningMeetingWorkbookCurrentValues/);
  assert.match(frontend, /originalCollect/);
  assert.match(frontend, /overrideValues\(bundle\?\.values/);
  assert.match(frontend, /current\.getMissing\(values\)/);
});

test('index loads override css and runtime after workbook current values', () => {
  assert.equal((index.match(/morning-meeting-card-overrides-v1\.css/g) || []).length, 1);
  assert.equal((index.match(/morning-meeting-card-overrides-v1\.js/g) || []).length, 1);
  const workbook = index.indexOf('/maintenance/morning-meeting-workbook-current-values.js');
  const overrides = index.indexOf('/maintenance/morning-meeting-card-overrides-v1.js');
  assert.ok(workbook >= 0 && overrides > workbook);
});
