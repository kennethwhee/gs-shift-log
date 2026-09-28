'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.join(__dirname, '..');
const provider = fs.readFileSync(path.join(repo, 'maintenance', 'morning-meeting-closed-cofiring.js'), 'utf8');
const script = fs.readFileSync(path.join(repo, 'script.js'), 'utf8');
const query = fs.readFileSync(path.join(repo, 'maintenance', 'morning-meeting-query-sources.js'), 'utf8');
const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');

test('provider exposes an explicit user-facing closing refresh path', () => {
  assert.match(provider, /MORNING_MEETING_ORGANIC_MINI_REFRESH_EXPLICIT_V4_R4/);
  assert.match(provider, /async function refreshOrganicFromClosing\(options = \{\}\)/);
  assert.match(provider, /beginExplicitOrganicRequery\(date\)/);
  assert.match(provider, /return refresh\(\{\.\.\.options, force: true\}\)/);
  assert.match(provider, /Object\.freeze\(\{[^}]*refreshOrganicFromClosing/);
});

test('small organic refresh button uses the explicit closing refresh path', () => {
  assert.match(
    script,
    /efficiencyMorningMeetingAutoDailySludgeRefreshButton[\s\S]{0,600}?refreshOrganicFromClosing\?\.\(\{ userInitiated: true \}\)/
  );
  assert.doesNotMatch(
    script,
    /key:\s*["']organic["'][\s\S]{0,500}?morningMeetingClosedCofiring\?\.refresh\?\.\(\{ force: true \}\)/
  );
});

test('전체자료 uses the same explicit closing refresh path', () => {
  assert.match(
    query,
    /\["closed", \(\) => window\.morningMeetingClosedCofiring\?\.refreshOrganicFromClosing\?\.\(\{ userInitiated: true \}\)\]/
  );
});

test('Saved-First V3 R3 and no-Daily-DATA contracts remain intact', () => {
  assert.match(provider, /MORNING_MEETING_ORGANIC_SAVED_FIRST_V3_R3/);
  assert.match(provider, /hasCompleteClosedOrganic/);
  assert.match(provider, /shouldPreserveExistingOrganic/);
  assert.doesNotMatch(provider, /daily_data_excel/);
});

test('all modified browser assets are cache-busted together', () => {
  assert.match(
    html,
    /morning-meeting-closed-cofiring.js?[^"]*organicMiniExplicit=20260928-v4-r4/
  );
  assert.match(
    html,
    /morning-meeting-query-sources.js?[^"]*organicMiniExplicit=20260928-v4-r4/
  );
  assert.match(
    html,
    /script.js?[^"]*organicMiniExplicit=20260928-v4-r4/
  );
});
