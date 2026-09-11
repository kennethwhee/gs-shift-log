import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync('maintenance/blower-history.css', 'utf8');
const html = fs.readFileSync('maintenance/blower-history.html', 'utf8');

test('mobile hides only refresh action while keeping latest timestamp detail', () => {
  const marker = '@media (max-width: 700px), (max-width: 1024px) and (hover: none) and (pointer: coarse) {';
  const idx = css.lastIndexOf(marker);
  assert.ok(idx >= 0, 'mobile/coarse media query missing');
  const tail = css.slice(idx, css.indexOf('@media (prefers-reduced-motion', idx));
  assert.match(tail, /\.overview-refresh-action\s*\{\s*display:\s*none\s*!important;\s*\}/);
  assert.match(tail, /\.overview-refresh-latest\s*>\s*small\s*\{\s*font-size:\s*9px;\s*\}/);
  assert.doesNotMatch(tail, /\.overview-refresh-latest\s*>\s*small\s*\{[^}]*display:\s*none/);
});

test('refresh/progress markup remains for desktop and only mobile presentation hides it', () => {
  assert.match(html, /id="refreshButton"/);
  assert.match(html, /id="overviewRefreshPercent"/);
  assert.match(html, /id="overviewRefreshProgressTrack"/);
  assert.match(html, /id="overviewLatestQueryDetail"/);
  assert.match(html, /blower-history\.css\?v=20260911-mobile-refresh-hide-only-v10-r1/);
  assert.match(css, /\.overview-refresh-action\s*\{\s*display:\s*flex;/);
});
