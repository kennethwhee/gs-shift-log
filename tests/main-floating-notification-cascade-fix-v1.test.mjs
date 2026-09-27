import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || process.cwd());
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const compact = fs.readFileSync(path.join(root, 'maintenance/main-status-compact-v1.css'), 'utf8');

test('temporary V1/V2 transparency overlays are retired', () => {
  assert.doesNotMatch(index, /main-floating-notification-translucent-v[12]\.css/);
  assert.equal(fs.existsSync(path.join(root, 'maintenance/main-floating-notification-translucent-v1.css')), false);
  assert.equal(fs.existsSync(path.join(root, 'maintenance/main-floating-notification-translucent-v2.css')), false);
});

test('main status compact CSS is the canonical desktop transparency owner', () => {
  assert.match(index, /main-status-compact-v1\.css\?v=20260928-alert-transparency-canonical-v1/);
  assert.match(compact, /#mainNotificationRail\.main-floating-notification-dock[\s\S]*?background:\s*rgba\(248, 250, 253, 0\.06\) !important/);
  assert.match(compact, /-webkit-backdrop-filter:\s*blur\(3px\) saturate\(1\.01\) !important/);
  assert.match(compact, /backdrop-filter:\s*blur\(3px\) saturate\(1\.01\) !important/);
  assert.doesNotMatch(compact, /body:has\(#statusView\.is-active\) #mainNotificationRail\.main-floating-notification-dock[^{]*\{[^}]*background:\s*#fff\s*!important/);
});

test('desktop alert rows are translucent while text remains opaque', () => {
  assert.match(compact, /arm-roll-box-main-alert[^}]*background:\s*rgba\(255, 248, 232, 0\.05\) !important/);
  assert.match(compact, /arm-roll-box-main-alert\.is-critical[\s\S]*?background:\s*rgba\(255, 241, 243, 0\.04\) !important/);
  assert.match(compact, /\[class\$="__count"\][^{]*\{[^}]*background:\s*rgba\(255, 255, 255, 0\.22\) !important/);
  assert.doesNotMatch(compact, /body:has\(#statusView\.is-active\)[^{]*\{[^}]*\bopacity\s*:/);
});

test('no stylesheet loaded after compact reintroduces the same desktop solid-white dock rule', () => {
  const hrefs = [...index.matchAll(/<link\s+[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi)].map(m => m[1]);
  const compactIndex = hrefs.findIndex(href => href.includes('main-status-compact-v1.css'));
  assert.ok(compactIndex >= 0, 'main-status compact loader missing');
  for (const href of hrefs.slice(compactIndex + 1)) {
    if (!href.startsWith('/')) continue;
    const relative = href.split('?')[0].replace(/^\//, '');
    const file = path.join(root, relative);
    if (!fs.existsSync(file) || !file.endsWith('.css')) continue;
    const css = fs.readFileSync(file, 'utf8');
    const hasExactDesktopOwner = css.includes('html:not(.main-floating-notification-mobile-client) body:has(#statusView.is-active) #mainNotificationRail.main-floating-notification-dock');
    const hasSolidWhite = /#mainNotificationRail\.main-floating-notification-dock[^{]*\{[^}]*background:\s*(?:#fff(?:fff)?|white)\s*!important/i.test(css);
    assert.equal(hasExactDesktopOwner && hasSolidWhite, false, 'later stylesheet overrides canonical transparency: ' + relative);
  }
});
