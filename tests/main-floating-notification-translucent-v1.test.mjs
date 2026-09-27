import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || process.cwd());
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'maintenance/main-floating-notification-translucent-v1.css'), 'utf8');

test('desktop operating alert dock loads the translucent overlay', () => {
  assert.match(index, /main-floating-notification-translucent-v1\.css\?v=20260928-v1/);
  assert.match(css, /@media screen and \(min-width: 769px\)/);
  assert.match(css, /#mainNotificationRail\.main-floating-notification-dock/);
  assert.match(css, /background:\s*rgba\(248, 250, 253, 0\.20\)/);
  assert.match(css, /backdrop-filter:\s*blur\(12px\)/);
});

test('translucency is applied through alpha backgrounds, not parent opacity', () => {
  assert.doesNotMatch(css, /(?:^|[;{\s])opacity\s*:/m);
  assert.match(css, /arm-roll-box-main-alert/);
  assert.match(css, /background:\s*rgba\(255, 248, 232, 0\.12\)/);
});
