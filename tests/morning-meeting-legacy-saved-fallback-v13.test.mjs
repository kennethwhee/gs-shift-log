import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const fallbackPath = path.join(root, 'maintenance', 'morning-meeting-legacy-saved-fallback-v1.js');
const indexPath = path.join(root, 'index.html');
const apiPath = path.join(root, 'functions', 'api', 'ois-data-requests.js');
const fallback = fs.readFileSync(fallbackPath, 'utf8').replace(/\r\n/g, '\n');
const index = fs.readFileSync(indexPath, 'utf8').replace(/\r\n/g, '\n');
const api = fs.readFileSync(apiPath, 'utf8').replace(/\r\n/g, '\n');

test('legacy fallback reads completed history only and never starts an Excel/Agent request', () => {
  assert.match(fallback, /action:\s*["']completed_history["']/);
  assert.match(fallback, /method:\s*["']GET["']/);
  assert.doesNotMatch(fallback, /method:\s*["']POST["']/);
  assert.doesNotMatch(fallback, /querySource\s*:\s*["']daily_data_excel["']/);
  assert.doesNotMatch(fallback, /loadEfficiencyMorningMeetingDailyData/);
  assert.doesNotMatch(fallback, /open_workbook|open_final_excel|Excel\.Application/i);
});

test('legacy fallback selects the real daily_data_excel source, not steam_status compatibility rows', () => {
  assert.match(fallback, /sourceRequestType\s*\|\|\s*item\?\.requestType/);
  assert.match(fallback, /actualType\s*!==\s*["']daily_data_excel["']/);
  assert.doesNotMatch(fallback, /\[[^\]]*["']daily_data_excel["'][^\]]*["']steam_status["'][^\]]*\]\.includes/);
});

test('current source owners remain first priority before legacy card values', () => {
  assert.match(fallback, /currentPowerOwns\(date\)/);
  assert.match(fallback, /currentSteamOwns\(date\)/);
  assert.match(fallback, /closedOwns\(date\)/);
  assert.match(fallback, /setFallbackBadge\(byId\(POWER_PREFIX \+ "PowerStatus"\), "기존 저장값"\)/);
  assert.match(fallback, /기존 저장값/);
});

test('completed_history keeps steam_status distinct from daily_data_excel', () => {
  const start = api.indexOf('async function handleCompletedHistoryGet');
  const end = api.indexOf('async function handleOisLegacyBatchStatusGet', start);
  assert.ok(start >= 0 && end > start);
  const segment = api.slice(start, end);
  assert.match(segment, /const\s+requestType\s*=\s*\n?\s*convertedItem\.requestType\s*;/);
  assert.match(segment, /sourceRequestType\s*:\s*convertedItem\.requestType/);
  assert.doesNotMatch(segment, /convertedItem\.requestType\s*===\s*["']steam_status["'][\s\S]{0,160}["']daily_data_excel["']/);
});

test('fallback runtime is loaded once and after TO power', () => {
  const matches = [...index.matchAll(/morning-meeting-legacy-saved-fallback-v1\.js/g)];
  assert.equal(matches.length, 1);
  const fallbackIndex = index.indexOf('morning-meeting-legacy-saved-fallback-v1.js');
  const powerIndex = index.lastIndexOf('maintenance/to-night-power.js');
  assert.ok(fallbackIndex > powerIndex, 'fallback loader must run after TO power');
});
