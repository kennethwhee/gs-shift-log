import test from 'node:test';
import assert from 'node:assert/strict';
import {r7EvidencePlan,R7_WINDOWS} from '../functions/_shared/blower-r7-evidence.js';
const now=new Date('2026-11-07T15:00:00+09:00');
function asset(mode){const p=R7_WINDOWS[mode];return {
 tag_number:p.tag,blower_type:p.type,unit_no:p.unit,enabled:1,
 last_replacement_at:p.replacementDate,cycle_runtime_hours:0,runtime_hours:0,
 cycle_runtime_state:'stopped',cycle_start_state:'pending',cycle_started_at:'',
 cycle_start_revision:'cycle-1',cycle_runtime_revision:'run-1'
};}
for(const mode of Object.keys(R7_WINDOWS)){
 test(mode+' accepts authenticated OIS role-only super_admin',()=>{
  const user={employeeNo:'sample',role:'super_admin'};
  assert.equal('isSuperAdmin' in user,false);
  assert.equal(r7EvidencePlan(mode,asset(mode),user,now).readOnly,true);
 });
 test(mode+' preserves blower-history flag-only compatibility',()=>{
  assert.equal(r7EvidencePlan(mode,asset(mode),{isSuperAdmin:true},now).readOnly,true);
 });
 test(mode+' denies non-admin and contradictory roles',()=>{
  for(const user of [null,{}, {role:'admin'},{role:'user'},{role:'superadmin'},
   {role:'admin',isSuperAdmin:true},{role:'user',isSuperAdmin:true}]){
   assert.throws(()=>r7EvidencePlan(mode,asset(mode),user,now), e=>e?.code==='R7_FORBIDDEN'&&e?.status===403);
  }
 });
 test(mode+' role fix preserves asset identity guard',()=>{
  assert.throws(()=>r7EvidencePlan(mode,{...asset(mode),tag_number:'invalid'},
   {role:'super_admin'},now),e=>e?.code==='R7_ASSET_STATE_CHANGED');
 });
}
