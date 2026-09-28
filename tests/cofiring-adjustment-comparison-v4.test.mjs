import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || process.cwd());
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'maintenance/cofiring-period-ui-v5.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'maintenance/cofiring-adjustment-comparison-v4.css'), 'utf8');

test('V4 wraps the current summary renderer instead of depending on a historical deadline expression', () => {
  assert.match(ui, /function renderSummaryOriginal\(/);
  assert.match(ui, /COFIRING_ADJUSTED_COMPARISON_CARDS_V4/);
  assert.match(ui, /COFIRING_ADJUSTED_COMPARISON_STATE_V4/);
  assert.doesNotMatch(ui, /deadlineResult=adjustmentActive/);
});

test('original cards are rendered first and retain their original deadline block', () => {
  assert.match(ui, /renderSummaryOriginal\(container,state\.base,manualValues,targetError\)/);
  assert.match(ui, /cfvDecorateOriginalCard/);
  assert.match(ui, /cfv-original-kind/);
  assert.doesNotMatch(css, /cfv-adjustment-original-card[^}]*data-cfv6-target/s);
});

test('adjusted cards are rendered second, orange, delta annotated, and deadline-free', () => {
  assert.match(ui, /cfvDecorateAdjustedCard/);
  assert.match(ui, /querySelectorAll\('\[data-cfv6-target\], \.cfv8-deadline-target, \.cfv10-target'\)/);
  assert.match(ui, /host\.replaceChildren\(\.\.\.originalCards,\.\.\.adjustedCards,\.\.\.trailingOriginal\)/);
  assert.match(ui, /cfvAppendAdjustmentDelta/);
  assert.match(css, /\.cfv52-summary-grid > \.cfv-adjustment-card/);
  assert.match(css, /content:\s*"↓  " attr\(data-adjustment-label\)/);
  assert.match(css, /\.cfv-adjustment-delta\.is-up/);
  assert.match(css, /\.cfv-adjustment-delta\.is-down/);
});

test('comparison only activates through existing renderDisplay adjusted state and reset returns to original-only', () => {
  assert.match(ui, /container\.__cfvAdjustedComparisonState = adjusted/);
  assert.match(ui, /\? \{ active: true, base: lastResult \|\| null, adjusted: result \|\| null \}/);
  assert.match(ui, /: \{ active: false, base: result \|\| lastResult \|\| null, adjusted: null \}/);
  assert.match(ui, /if\(!result\|\|!state\?\.active\|\|!state\.base\|\|!state\.adjusted\)/);
});

test('stylesheet is loaded after current co-firing base CSS and UI script is cache-busted', () => {
  const base = index.indexOf('/maintenance/cofiring-period-ui-v5.css');
  const comparison = index.indexOf('/maintenance/cofiring-adjustment-comparison-v4.css?v=20260928-adjusted-comparison-v4');
  assert.ok(base >= 0 && comparison > base);
  assert.match(index, /cofiring-period-ui-v5\.js[^"']*adjustedCards=20260928-adjusted-comparison-v4/);
});
