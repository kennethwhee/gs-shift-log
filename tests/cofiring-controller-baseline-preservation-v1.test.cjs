'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {restoreControllerBaseline,normalize}=require('./helpers/cofiring-controller-baseline-preservation-v1.cjs');
const source=fs.readFileSync(path.join(__dirname,'../local-tools/ois-agent/cofiring-period-v5/run-cofiring-period-v5.ps1'),'utf8');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const previousNormalizedSha='3fa63c7ed01103ab0c5a08a3c780b85677236ffab537abd3c2bc8b6a99805b9b';
const previousWindowsSha='31e6ca5afc4248a0036b5e0dd1b8c8eef39ef76ae1cefb9d7fab74ad41a73cba';

test('reversing only the baseline checker and its final call restores the complete prior controller',()=>{
  const previous=restoreControllerBaseline(source);
  assert.equal(sha(previous),previousNormalizedSha);
  assert.equal(sha(Buffer.from('\uFEFF'+previous.replace(/\n/g,'\r\n'))),previousWindowsSha);
  assert.equal(restoreControllerBaseline(previous),previous);
  assert.equal(restoreControllerBaseline('\uFEFF'+normalize(source).replace(/\n/g,'\r\n')),previous);
});

test('the exact inverse retains unrelated controller and owned-process guard edits',()=>{
  for (const changed of [
    source+'\n# unrelated source change',
    source.replace('$timeoutSeconds=300','$timeoutSeconds=999'),
    source.replace('-not [string]::IsNullOrWhiteSpace([string]$Signature.Path) -and','[bool]$true -and')
  ]) {
    assert.notEqual(changed,source);
    assert.notEqual(sha(restoreControllerBaseline(changed)),previousNormalizedSha);
  }
});

test('partial, duplicated or altered baseline changes cannot be masked by the inverse',()=>{
  for (const changed of [
    source.replace('COFIRING_CONTROLLER_BASELINE_OPTIONAL_PATH_V1','REMOVED_BASELINE_MARKER'),
    source.replace('function Test-ControllerBaselineSignature($Signature) {','function Altered-ControllerBaseline($Signature) {'),
    source.replace('(Test-ControllerBaselineSignature $signature)','(Test-ControllerSignature $signature)'),
    source+'\n# COFIRING_CONTROLLER_BASELINE_OPTIONAL_PATH_V1\n'
  ]) {
    try { assert.notEqual(sha(restoreControllerBaseline(changed)),previousNormalizedSha); }
    catch (error) { if (error.code==='ERR_ASSERTION') throw error; assert.match(error.message,/preservation.*mismatch/); }
  }
  for (const value of [null,undefined,{},Buffer.from('source'),123]) {
    assert.throws(()=>restoreControllerBaseline(value),TypeError);
  }
});
