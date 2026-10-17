'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const repo = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');

test('the active page has one shared adjustment owner without legacy coal-warning listeners or cleanup observers', () => {
  assert.equal((index.match(/<script\b[^>]*\/maintenance\/cofiring-period-adjustment-v56\.js\?/g) || []).length, 1);
  for (const name of [
    'morning-meeting-cofiring-coal-review-v1.js',
    'morning-meeting-cofiring-coal-review-popup-v4.js',
    'cofiring-max-adjust-warning-bar-cleanup-v1.js'
  ]) {
    const scripts = [...index.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(match => match[1].split('?')[0]);
    assert.equal(scripts.some(url => url.endsWith('/'+name)), false, name+' must not add a second warning owner');
  }
});

test('deprecated warning modules remain available without being registered into the current page', () => {
  const retainedPopup = fs.readFileSync(path.join(repo, 'maintenance/morning-meeting-cofiring-coal-review-popup-v4.js'), 'utf8');
  const retainedObserver = fs.readFileSync(path.join(repo, 'maintenance/cofiring-max-adjust-warning-bar-cleanup-v1.js'), 'utf8');
  assert.match(retainedPopup, /CofiringCoalReviewV12/);
  assert.match(retainedObserver, /COFIRING_MAX_ADJUST_WARNING_BAR_CLEANUP_V1/);
});

test('the retained purge confirmation guard awaits its existing async confirmation before mutation', () => {
  // Preserve the old test's independent safety check with the actual async
  // contract. Its obsolete sync string already failed before this UI change.
  const purge = fs.readFileSync(path.join(repo, 'maintenance/morning-meeting-permanent-purge-v1.js'), 'utf8');
  assert.match(purge, /async function confirmDelete\(date\)/);
  assert.match(purge, /if\s*\(\s*!\(\s*await\s+confirmDelete\(date\)\s*\)\s*\)\s*return\s*;/);
});
