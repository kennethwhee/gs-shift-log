import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || process.cwd());
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'maintenance/main-floating-notification-translucent-v2.css'), 'utf8');

test('V2 translucent override loads after the existing notification dock styles', () => {
  const v2 = index.indexOf('main-floating-notification-translucent-v2.css?v=20260928-v2');
  assert.ok(v2 >= 0, 'V2 loader missing');
  const base = index.indexOf('main-floating-notification-dock.css');
  assert.ok(base >= 0 && v2 > base, 'V2 must load after base dock CSS');
});

test('desktop dock is visibly transparent with minimal blur', () => {
  assert.match(css, /@media screen and \(min-width: 769px\)/);
  assert.match(css, /background:\s*rgba\(248, 250, 253, 0\.06\)/);
  assert.match(css, /backdrop-filter:\s*blur\(3px\)/);
  assert.doesNotMatch(css, /(?:^|[;{\s])opacity\s*:/m);
});

test('warning and critical rows are also strongly translucent', () => {
  assert.match(css, /rgba\(255, 248, 232, 0\.05\)/);
  assert.match(css, /rgba\(255, 241, 243, 0\.04\)/);
});
