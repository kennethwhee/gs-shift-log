import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || process.cwd());
const agent = fs.readFileSync(path.join(root, 'local-tools/ois-agent/ois-login.js'), 'utf8');

function extractRawPowerShell(constName) {
  const marker = `const ${constName} =`;
  const start = agent.indexOf(marker);
  assert.ok(start >= 0, `${constName} is missing`);
  const rawStart = agent.indexOf('String.raw`', start);
  assert.ok(rawStart >= 0, 'raw script start missing');
  const contentStart = rawStart + 'String.raw`'.length;
  const end = agent.indexOf('`;', contentStart);
  assert.ok(end > contentStart, 'raw script end missing');
  return agent.slice(contentStart, end);
}

test('one Agent batch has capacity for all 22 currently queried Blowers in a single hidden Excel session', () => {
  assert.match(agent, /const\s+BLOWER_RUNTIME_PROBE_BATCH_MAX_REQUESTS\s*=\s*24\s*;/);
  assert.match(agent, /BLOWER_RUNTIME_PROBE_BATCH_MAX_REQUESTS\s*-\s*1/);
  const script = extractRawPowerShell('DATAPARC_BLOWER_RUNTIME_BATCH_POWERSHELL_SCRIPT');
  assert.match(script, /\$rawProbes\.Count\s+-gt\s+24/);
  assert.equal((script.match(/Start-Process\s+-FilePath\s+\$ownedExcelPath/g) || []).length, 1);
  assert.match(script, /collectorRevision\s*=\s*"nativeom-batch-v2"/);
});

test('batch capacity remains bounded rather than unbounded', () => {
  const match = agent.match(/const\s+BLOWER_RUNTIME_PROBE_BATCH_MAX_REQUESTS\s*=\s*(\d+)\s*;/);
  assert.ok(match);
  const max = Number(match[1]);
  assert.ok(max >= 23, `batch must fit the 23-card dashboard if every card becomes queryable; got ${max}`);
  assert.ok(max <= 24, `batch must remain bounded; got ${max}`);
});
