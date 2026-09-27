import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

test('co-firing keeps existing saved values when closed lookup is loading, missing or failed', () => {
  const source = read('maintenance/morning-meeting-cofiring-card.js');
  assert.match(source, /function renderLegacySavedFallback\(/);
  assert.match(source, /if \(renderLegacySavedFallback\(date\)\) return;/);
  assert.match(source, /else if \(!renderLegacySavedFallback\(targetDate\)\)/);
  assert.match(source, /if \(snapshot\?\.targetDate === targetDate\) \{[\s\S]*clearAllValues\(\);[\s\S]*renderClosedSnapshot\(snapshot\)/);
});

test('organic source owner yields to saved fallback until real closed data is complete', () => {
  const source = read('maintenance/morning-meeting-closed-cofiring.js');
  assert.match(source, /function renderLegacySavedOrganic\(/);
  assert.match(source, /!saved && date && !isBlocked\(date\) && renderLegacySavedOrganic\(date\)/);
});

test('cache keys load both sticky-fallback owners', () => {
  const source = read('index.html');
  assert.match(source, /morning-meeting-closed-cofiring\.js[^"']*legacySticky=20260928-v14/);
  assert.match(source, /morning-meeting-cofiring-card\.js[^"']*legacySticky=20260928-v14/);
});
