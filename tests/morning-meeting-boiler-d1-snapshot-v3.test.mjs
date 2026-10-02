import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('boiler snapshot runtime persists complete temperatures to D1 and restores without source requery', () => {
  const source = read('maintenance/morning-meeting-boiler-d1-snapshot-v3.js');
  assert.match(source, /\/api\/morning-meeting-boiler-snapshot/);
  assert.match(source, /efficiencyMorningMeetingShiftLogsLoaded/);
  assert.match(source, /efficiencyMorningMeetingBoilerTemperaturesChanged/);
  assert.match(source, /state\(\)\.boilerTemperatures = restored/);
  assert.match(source, /renderEfficiencyMorningMeetingBoilerTemperatures/);
  assert.doesNotMatch(source, /loadEfficiencyMorningMeetingShiftLogsForDate\s*\(/);
  assert.doesNotMatch(source, /reloadEfficiencyMorningMeetingBoilerLogsButton\.click/);
});

test('D1 API owns only selected-date boiler snapshots and validates all 12 temperatures', () => {
  const api = read('functions/api/morning-meeting-boiler-snapshot.js');
  assert.match(api, /morning_meeting_boiler_snapshots/);
  assert.match(api, /fbheLeft/);
  assert.match(api, /fbheRight/);
  for (const key of ['A', 'B', 'C', 'D']) assert.match(api, new RegExp(`raw\\.wallScrew\\.${key}`));
  assert.doesNotMatch(api, /UPDATE\s+to_night_power|DELETE\s+FROM\s+to_night_power/i);
  assert.doesNotMatch(api, /cofiring.*UPDATE|UPDATE.*cofiring/i);
});

test('selected-date Data Delete deletes the D1 boiler snapshot inside the existing batch', () => {
  const purge = read('functions/api/morning-meeting-purge.js');
  assert.match(purge, /CREATE TABLE IF NOT EXISTS morning_meeting_boiler_snapshots/);
  const arrayStart = purge.indexOf('const statements = [');
  assert.ok(arrayStart >= 0, 'purge statements array missing');
  const deletePos = purge.indexOf('DELETE FROM morning_meeting_boiler_snapshots WHERE target_date = ?', arrayStart);
  const batchPos = purge.indexOf('database.batch(statements)', arrayStart);
  assert.ok(deletePos > arrayStart && deletePos < batchPos, 'boiler snapshot delete must be part of purge statements batch');
});

test('browser Data Delete clears boiler state and rerenders the temperature card', () => {
  const purgeUi = read('maintenance/morning-meeting-permanent-purge-v1.js');
  assert.match(purgeUi, /MORNING_MEETING_BOILER_D1_PURGE_STATE_V3/);
  assert.match(purgeUi, /delete purgeState\.boilerTemperatures/);
  assert.match(purgeUi, /MORNING_MEETING_BOILER_D1_PURGE_RENDER_V3/);
  assert.match(purgeUi, /renderEfficiencyMorningMeetingBoilerTemperatures/);
});

test('index loads D1 boiler snapshot runtime before instant display restore', () => {
  const html = read('index.html');
  const boiler = html.indexOf('morning-meeting-boiler-d1-snapshot-v3.js');
  const instant = html.indexOf('morning-meeting-instant-restore-v1.js');
  assert.ok(boiler >= 0, 'boiler D1 snapshot loader missing');
  assert.ok(instant >= 0, 'instant restore loader missing');
  assert.ok(boiler < instant, 'D1 boiler snapshot runtime should load before instant restore');
});
