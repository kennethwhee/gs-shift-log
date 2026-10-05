'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {restorePhase2Archive}=require('./helpers/cofiring-phase2-archive-preservation.cjs');
const source=fs.readFileSync(path.join(__dirname,'../local-tools/ois-agent/cofiring-period-v5/run-cofiring-period-v5.ps1'),'utf8');
test('exact archive inverse is idempotent and preserves unrelated controller changes',()=>{
  const restored=restorePhase2Archive(source);
  assert.doesNotMatch(restored,/SkipDiagnosticArchive|COFIRING_PHASE2_ON_DEMAND_ARCHIVE/);
  assert.equal(restorePhase2Archive(restored),restored);
  const changed=source.replace("$timeoutSeconds=150","$timeoutSeconds=999");
  assert.match(restorePhase2Archive(changed),/\$timeoutSeconds=999/);
});
test('archive inverse rejects partial or altered archive patches',()=>{
  assert.throws(()=>restorePhase2Archive(source.replace('Complete-CofiringDiagnosticArchive\r\n','Missing-ArchiveFunction\r\n')),/mismatch/);
  assert.throws(()=>restorePhase2Archive('# COFIRING_PHASE2_ON_DEMAND_ARCHIVE'),/mismatch/);
});
