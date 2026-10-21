'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const controller = path.join(root, 'local-tools/ois-agent/cofiring-period-v5/run-cofiring-period-v5.ps1');
const helper = path.join(__dirname, 'helpers/cofiring-controller-baseline-v1.ps1');
const fixture = path.join(__dirname, 'fixtures/cofiring-controller-baseline-v1.json');
const names = process.platform === 'win32' ? ['powershell.exe', 'pwsh.exe'] : ['pwsh'];
const shell = names.find(name => spawnSync(name, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'],
  {timeout: 15000, encoding: 'utf8'}).status === 0);

test('the regression fixture retains both supplied baseline PIDs and exact creation ticks without JS number conversion', () => {
  const text = fs.readFileSync(fixture, 'utf8');
  assert.match(text, /"ProcessId": 177848/);
  assert.match(text, /"StartTicks": 639281975399692784/);
  assert.match(text, /"ProcessId": 180548/);
  assert.match(text, /"StartTicks": 639281975307771672/);
  assert.equal((text.match(/"Path": ""/g) || []).length, 2);
});

test('actual PowerShell accepts unchanged blank-path baselines while keeping owned-process path checks strict',
  {skip: !shell && 'PowerShell unavailable; run the mandatory Windows baseline verifier'}, () => {
    const result = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper,
      '-ControllerPath', controller, '-FixturePath', fixture], {encoding: 'utf8', timeout: 30000, cwd: root});
    assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
    assert.match(result.stdout, /BASELINE IDENTITY PASS: 56;/);
    assert.match(result.stdout, /STRICT OWNED IDENTITY PASS: 8;/);
    assert.match(result.stdout, /BASELINE SCOPE PASS: one baseline-only call site/);
  });
