'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {restoreBioZero,normalize,profile}=require('./helpers/cofiring-bio-zero-v1-preservation.cjs');
const runtime=fs.readFileSync(path.join(__dirname,'../local-tools/ois-agent/cofiring-period-v5/cofiring-period-worker-v5.ps1'));
const text=runtime.toString('utf8'),sha=value=>crypto.createHash('sha256').update(value).digest('hex');
test('Bio zero inverse restores exactly the pre-fix Worker while retaining historical baseline pins',()=>{
  assert.equal(sha(runtime),profile.productionWorkerSha256);
  const previous=restoreBioZero(text);
  assert.equal(sha(previous),profile.previousNormalizedSha256);
  assert.equal(sha(Buffer.from('\uFEFF'+previous.replace(/\n/g,'\r\n'))),'7b02eaa5c8289bad2c1fd06c9acc82336cfae5dd3f572f99a97115194fe73f25');
  assert.equal(restoreBioZero(previous),previous);
});
test('Bio zero inverse does not hide any unrelated source edit',()=>{
  for(const changed of [
    text+'\n# unrelated source change',
    text.replace('$durationBad -eq 0 -and','$durationBad -ge 0 -and'),
    text.replace('COFIRING_BIO_CONSTANT_BOTH_NODATA_FALLBACK_V1','REMOVED_ZERO_FALLBACK_MARKER'),
    '# COFIRING_BIO_CONSTANT_BOTH_NODATA_FALLBACK_V1\n'
  ]){
    assert.equal(restoreBioZero(changed),normalize(changed));
    assert.notEqual(sha(restoreBioZero(changed)),profile.previousNormalizedSha256);
  }
});
test('Bio zero inverse accepts only source strings and is independent of BOM/newlines',()=>{
  const restored=restoreBioZero(text);
  assert.equal(restoreBioZero(normalize(text)),restored);
  assert.equal(restoreBioZero('\uFEFF'+normalize(text).replace(/\n/g,'\r\n')),restored);
  for(const value of [null,undefined,{},Buffer.from('source'),123])assert.throws(()=>restoreBioZero(value),TypeError);
});
