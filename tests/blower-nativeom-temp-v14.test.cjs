'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { restoreReviewedCompilerSource, compilerBlocks, reviewedV13AgentSha256, candidateCompilerSha256 } = require('./helpers/blower-nativeom-temp-v14-baseline.cjs');
const source = fs.readFileSync(path.join(__dirname, '../local-tools/ois-agent/ois-login.js'), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const blocks = compilerBlocks(source);

test('restoring exactly two reviewed compiler helpers reproduces the entire exact V13 Agent', () => {
  assert.equal(reviewedV13AgentSha256, '6ed489f20cafafac24d671d045532bc5e72a7283e4f65e908815104e55b414c5');
  assert.equal(hash(restoreReviewedCompilerSource(source)), reviewedV13AgentSha256,
    'Query math, native C# code, single/batch flow, overlap, owned cleanup and all shared Agent code must stay unchanged.');
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].text, blocks[1].text);
  for (const block of blocks) assert.equal(hash(block.text), candidateCompilerSha256);
});

test('baseline restoration rejects modified, old-only, extra or missing candidate helpers', () => {
  assert.throws(() => restoreReviewedCompilerSource(source.replace('  $compileTempRoot =', '  $changedCompileTempRoot =')), /Unreviewed compiler helper/);
  assert.throws(() => restoreReviewedCompilerSource(restoreReviewedCompilerSource(source)), /Unreviewed compiler helper/);
  assert.throws(() => restoreReviewedCompilerSource(source + blocks[0].text + '\nif (-not ("GsBlowerRuntimeNativeOmV1" -as [type])) {'), /exactly two/);
  assert.throws(() => restoreReviewedCompilerSource(source.slice(0, blocks[0].from) + source.slice(blocks[0].to)), /exactly two/);
});

test('both process temp variables are scoped immediately around Add-Type and restored before retry or return', () => {
  for (const { text } of blocks) {
    const ordered = [
      '$compileTempRoot = [IO.Path]::GetTempPath()',
      'for ($attempt = 0; $attempt -lt 3;',
      'Join-Path $compileTempRoot ("gs-blower-nativeom-"',
      '$previousCompileTemp = [Environment]::GetEnvironmentVariable("TEMP", "Process")',
      '$previousCompileTmp = [Environment]::GetEnvironmentVariable("TMP", "Process")',
      'try {\n          [Environment]::SetEnvironmentVariable("TEMP", $compileDirectory, "Process")',
      '[Environment]::SetEnvironmentVariable("TMP", $compileDirectory, "Process")',
      'Add-Type -TypeDefinition $TypeDefinition -CompilerParameters $parameters -ErrorVariable +compileErrors -ErrorAction Stop',
      '} finally {\n          try {\n            [Environment]::SetEnvironmentVariable("TEMP", $previousCompileTemp, "Process")',
      '} finally {\n            [Environment]::SetEnvironmentVariable("TMP", $previousCompileTmp, "Process")',
      '        return\n      } catch {',
      'Start-Sleep -Milliseconds $retryWaits[$attempt]',
    ];
    let at = -1;
    for (const anchor of ordered) { const next = text.indexOf(anchor, at + 1); assert.ok(next > at, anchor); at = next; }
    assert.equal((text.match(/SetEnvironmentVariable\(/g) || []).length, 4);
    assert.doesNotMatch(text, /SetEnvironmentVariable\([^\n]*"(?:User|Machine)"/);
    assert.match(text, /\$parameters\.TempFiles = \[System\.CodeDom\.Compiler\.TempFileCollection\]::new\(\$compileDirectory, \$false\)/);
    assert.match(text, /\$retryWaits = @\(1000, 2000\)/);
  }
});

test('new retry shape is restricted to exact owned RES temporary writes and rejects known permanent causes', () => {
  for (const { text } of blocks) {
    assert.ok(text.includes("[regex]::Escape($resourcePrefix) + 'RES[0-9a-f]{1,4}\\.tmp"));
    assert.ok(text.includes("cannot\\s+open\\s+"));
    assert.ok(text.includes("for\\s+writing\\b"));
    assert.ok(text.includes('$_ -ne "CS0016"'));
    assert.ok(text.includes('permission\\s+denied'));
    assert.ok(text.includes('disk\\s+(?:is\\s+)?full'));
    assert.ok(text.indexOf('if ($diagnostic -match $resourcePattern)') < text.indexOf('if ($codes.Count -eq 0'),
      'The narrowly recognized RES error can omit a CS number.');
  }
});

test('original DLL lock gate remains byte-identical and directory cleanup remains owned-only', () => {
  const restoredBlocks = compilerBlocks(restoreReviewedCompilerSource(source));
  for (let i = 0; i < blocks.length; i++) {
    const gateStart = '  $codes = @([regex]::Matches';
    const gateEnd = '\nfunction Initialize-ProbeNativeOm';
    const gate = value => value.slice(value.indexOf(gateStart), value.indexOf(gateEnd));
    assert.equal(gate(blocks[i].text), gate(restoredBlocks[i].text));
    const cleanup = '  } finally {\n    foreach ($directory in $createdDirectories)';
    const tail = value => value.slice(value.indexOf(cleanup));
    assert.equal(tail(blocks[i].text), tail(restoredBlocks[i].text));
    assert.match(blocks[i].text, /\$createdDirectories\.Add\(\$compileDirectory\)/);
  }
});
