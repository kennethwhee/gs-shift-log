import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

test('steam OIS owner yields to an existing saved value until OIS actually succeeds', () => {
  const source = read('maintenance/morning-meeting-steam-ois-probe-v1.js');
  assert.ok(source.includes('function preserveLegacySavedSteamFallback('));
  assert.ok(source.includes('const currentOisOwns = Boolean('));
  assert.ok(source.includes('if (!currentOisOwns && preserveLegacySavedSteamFallback(targetDate)) return;'));
  assert.ok(source.includes('fallback?.render?.(targetDate)'));
});

test('steam owner keeps the OIS query path and does not restore a Daily DATA Excel request', () => {
  const source = read('maintenance/morning-meeting-steam-ois-probe-v1.js');
  assert.ok(source.includes('requestType: "steam_status"') || source.includes("requestType: 'steam_status'"));
  assert.ok(!source.includes('requestType: "daily_data_excel"'));
  assert.ok(!source.includes("requestType: 'daily_data_excel'"));
});

test('steam owner cache key includes sticky legacy fallback v15', () => {
  const source = read('index.html');
  assert.ok(source.includes('steamLegacySticky=20260928-v15'));
});
