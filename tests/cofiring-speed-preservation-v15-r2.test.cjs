'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const h = require('./helpers/cofiring-speed-preservation-v15-r2.cjs');
const profiles = require('./helpers/cofiring-speed-preservation-v15-r2-rules.json');
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
function fixture(profile) {
  let before = '';
  for (const r of [...profile.rules].sort((a, b) => b.from.length - a.from.length)) {
    let count = before.split(r.from).length - 1;
    while (count < r.count) { before += '\n# SYNTHETIC ANCHOR FIXTURE\n' + r.from + '\n'; count++; }
  }
  let after = before;
  for (const r of profile.rules) {
    assert.equal(after.split(r.from).length - 1, r.count, r.label);
    after = after.split(r.from).join(r.to);
  }
  return { before, after };
}
for (const [name, profile] of Object.entries(profiles)) {
  const restore = name === 'worker' ? h.restoreWorkerForPreservation : h.restoreControllerForPreservation;
  const { before, after } = fixture(profile);
  test(name + ': legacy source is unchanged', () => assert.equal(restore(before), before));
  test(name + ': complete exact V1 delta returns the original synthetic source', () => assert.equal(restore(after), before));
  test(name + ': BOM and CRLF do not change the comparison', () => assert.equal(restore('\uFEFF' + after.replace(/\n/g, '\r\n')), before));
  test(name + ': an unrelated operational mutation survives normalization and fails the old hash', () => {
    const changed = after + '\n# UNREVIEWED OPERATIONAL CHANGE\n$executionSucceeded=$true\n';
    assert.notEqual(sha(restore(changed)), sha(before));
    assert.match(restore(changed), /\$executionSucceeded=\$true/);
  });
  test(name + ': deleting the marker does not turn optimized text into the old baseline', () => {
    assert.notEqual(sha(restore(after.replace(profile.marker, 'REMOVED_MARKER'))), sha(before));
  });
  test(name + ': a partial marker-only installation is rejected', () => assert.throws(() => restore(profile.marker), /mismatch/));
  test(name + ': original inputs are immutable strings', () => { const copy=after; restore(after); assert.equal(after, copy); });
  for (const r of profile.rules) {
    test(name + ': exact inverse: ' + r.label, () => {
      assert.equal(h.reverseRule(Array(r.count).fill(r.to).join('\n# RULE BOUNDARY\n'), r),
        Array(r.count).fill(r.from).join('\n# RULE BOUNDARY\n'));
    });
    test(name + ': missing replacement fails: ' + r.label, () => assert.throws(() => h.reverseRule('', r), /mismatch/));
    test(name + ': duplicate replacement fails: ' + r.label, () => assert.throws(() => h.reverseRule(Array(r.count+1).fill(r.to).join('\n# RULE BOUNDARY\n'), r), /mismatch/));
  }
}
test('invalid input types are rejected', () => {
  for (const value of [null, undefined, 12, {}, Buffer.from('x')]) assert.throws(() => h.normalize(value), TypeError);
});
test('empty and invalid replacement definitions are rejected', () => {
  for (const rule of [null, {}, {from:'a',to:'',count:1}, {from:'a',to:'b',count:0}, {from:'a',to:'b',count:1.5}]) {
    assert.throws(() => h.reverseRule('abc', rule), TypeError);
  }
});
test('startup checks retain original hashes and the raw worker integrity check', () => {
  const source=fs.readFileSync(path.join(__dirname,'cofiring-startup-preservation.test.cjs'),'utf8');
  assert.match(source,/const item=baselines\[0\];[\s\S]*?assert\.equal\(sha\(preservedPart\(item, restorePostV15Worker\(worker\)\)\), item\.sha256\)/);
  assert.match(source,/preservedPart\(item, restoreControllerForPreservation\(controller\)\)/);
  assert.match(source,/preservedPart\(item, restoreWorkerForPreservation\(worker\)\)/);
  assert.match(source,/assert\.equal\(pin\[1\], sha\(workerBytes\)\)/);
  assert.doesNotMatch(source,/721d48fd|43b9dc9b|\.skip\(|\.todo\(/);
});
