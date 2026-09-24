import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.length !== 1 || !['--review', '--all'].includes(args[0])) {
  console.error('Usage: node scripts/test-project.mjs --review | --all');
  process.exitCode = 1;
} else {
  const focused = args[0] === '--review';
  const files = fs.readdirSync(path.join(root, 'tests'))
    .filter(name => /\.test\.(?:mjs|cjs|js)$/.test(name))
    .filter(name => !focused || /^project-(?:hardening-v1|access-v2|cofiring-v3|organic-v4|blower-v5|account-v6|structure-v12)\.test\.mjs$/.test(name))
    .sort().map(name => 'tests/' + name);
  console.log(`${focused ? 'REVIEW REGRESSION' : 'ALL NODE TESTS'}: ${files.length} files`);
  if (focused) console.log('Focused review checks only. Run --all to include the remaining historical and integration checks.');
  const result = spawnSync(process.execPath,
    ['--test', '--test-concurrency=4', '--test-timeout=30000', '--test-reporter=spec', ...files],
    { cwd: root, stdio: 'inherit' });
  if (result.error) console.error(result.error.message);
  process.exitCode = result.status ?? 1;
}
