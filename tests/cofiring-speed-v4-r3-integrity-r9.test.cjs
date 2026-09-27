'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const helper=require('./helpers/cofiring-speed-preservation-v15-r2.cjs');
const ruleRaw=helper.normalize(fs.readFileSync(path.join(__dirname,'helpers/cofiring-speed-post-v15-r9.json'),'utf8'));
const rule=JSON.parse(ruleRaw);
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
const workerBytes=fs.readFileSync(path.join(root,'local-tools/ois-agent/cofiring-period-v5/cofiring-period-worker-v5.ps1'));
const worker=workerBytes.toString('utf8');
const controller=fs.readFileSync(path.join(root,'local-tools/ois-agent/cofiring-period-v5/run-cofiring-period-v5.ps1'));
const agent=fs.readFileSync(path.join(root,'local-tools/ois-agent/cofiring-dataparc-agent.js'),'utf8');
test('post-V15 mapping is pinned to the exact current V4 Worker and the reviewed V15 R2 Worker',()=>{
  assert.equal(sha(Buffer.from(ruleRaw,'utf8')),'d974ab3722e2c0033bda95a3bc412dedb82884bbadfd753563b3175fba83be20');
  assert.equal(rule.v15Commit,'607e34a4191f40260e91961c283aa66007650f48');
  assert.equal(rule.latestWorkerCommit,'af3b743a3a6af3276e8078fe4a5dbd133592ee03');
  assert.equal(sha(workerBytes),'a84b83ea1f024e779414ac647d3ad3dda7b0bc19888e91a6b18f90b53d1413aa');
  assert.equal(sha(Buffer.from(helper.normalize(worker),'utf8')),rule.currentNormalizedSha256);
  const mapped=helper.restorePostV15Worker(worker);
  assert.equal(sha(Buffer.from(mapped,'utf8')),rule.v15NormalizedSha256);
  const mutated=helper.normalize(worker)+'\n# unrelated mutation';
  assert.equal(helper.restorePostV15Worker(mutated),mutated);
});
test('current V4 Worker still reaches the historical preservation baseline through the unchanged V15 R2 rules',()=>{
  const restored=helper.restoreWorkerForPreservation(worker);
  assert.notEqual(sha(Buffer.from(restored,'utf8')),rule.currentNormalizedSha256);
  assert.doesNotMatch(restored,/COFIRING_INITIAL_POLL_BYPASS_V4/);
});
test('existing Controller and Agent pins already match exact Windows worktree runtime bytes',()=>{
  assert.match(controller.toString('utf8'),new RegExp("\\$expectedWorkerSha256='"+sha(workerBytes)+"'"));
  assert.match(agent,new RegExp("PERIOD_CONTROLLER_SHA256='"+sha(controller)+"'"));
  assert.match(agent,new RegExp("PERIOD_WORKER_SHA256='"+sha(workerBytes)+"'"));
});
test('NativeOM preservation test uses the exact reviewed V15 R2 source mapping without rewriting the historical hash',()=>{
  const startup=fs.readFileSync(path.join(root,'tests/cofiring-startup-preservation.test.cjs'),'utf8');
  assert.match(startup,/restorePostV15Worker/);
  assert.match(startup,/preservedPart\(item, restorePostV15Worker\(worker\)\)/);
});
