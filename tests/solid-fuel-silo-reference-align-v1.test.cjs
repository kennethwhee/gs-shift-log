'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const css = fs.readFileSync('maintenance/cofiring-solid-fuel-management-tab-v2.css', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');

test('silo reference alignment override exists exactly once', () => {
  assert.equal((css.match(/SOLID FUEL SILO REFERENCE ALIGN V1 START/g) || []).length, 1);
  assert.match(css, /\.sfux15-silo-panel \.silo-summary__row,[\s\S]*min-height:\s*27px !important/);
  assert.match(css, /grid-template-columns:\s*22% 1fr auto !important/);
});

test('index loads the current silo alignment stylesheet once with a cache version', () => {
  const loaders = [...index.matchAll(/<link\b[^>]*\bhref\s*=\s*(["'])([^"']+)\1[^>]*>/gi)]
    .filter(match => match[2].split('?')[0] === '/maintenance/cofiring-solid-fuel-management-tab-v2.css');
  assert.equal(loaders.length, 1, 'the alignment stylesheet must load exactly once');
  assert.match(loaders[0][0], /\brel\s*=\s*["']stylesheet["']/i);
  const url = new URL(loaders[0][2].replace(/&amp;/g, '&'), 'https://fixture.invalid');
  assert.ok(url.searchParams.get('v')?.trim(), 'cache version must be nonempty');
  assert.ok(fs.existsSync(url.pathname.slice(1)), 'the loaded asset must exist');
});
