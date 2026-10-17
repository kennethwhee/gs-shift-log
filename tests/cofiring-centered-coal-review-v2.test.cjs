'use strict';
// A centered popup is no longer the active UI. Keep its replacement in normal
// document flow and ensure the late stylesheet does not expose hidden notes.
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const repo = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(repo, 'maintenance/cofiring-adjustment-readability-v15.css'), 'utf8');
const index = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');

test('the coal-review replacement occupies normal dialog flow instead of a centered overlay', () => {
  const rule = /\.cfv56-adjust-modal\.cfv56-design-v15\s+\.cfv56-coal-review-notice\s*\{([^}]*)\}/.exec(css);
  assert.ok(rule, 'The note styling must remain scoped to this adjustment dialog');
  assert.match(rule[1], /position:\s*static\s*!important/);
  assert.match(rule[1], /transform:\s*none\s*!important/);
  assert.match(rule[1], /box-shadow:\s*none\s*!important/);
  assert.doesNotMatch(rule[1], /\b(?:inset|top|left|z-index)\s*:/);
});

test('the replacement stylesheet displays only explicitly visible notes and loads after the prior dialog styles', () => {
  assert.match(css, /\.cfv56-coal-review-notice:not\(\[hidden\]\)\s*\{[^}]*display:\s*flex\s*!important/s);
  const basePosition = index.indexOf('/maintenance/cofiring-period-ui-v5.css');
  const finalPosition = index.indexOf('/maintenance/cofiring-adjustment-readability-v15.css?v=');
  assert.ok(basePosition >= 0 && finalPosition > basePosition);
  assert.equal((index.match(/(?:href|src)="[^"\n]*cofiring-adjustment-readability-v15\.css\?/g) || []).length, 1);
});
