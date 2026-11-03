import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { __blowerHistoryTest as api } from '../functions/api/blower-history.js';
import { collectApprovedReplacementFacts } from '../functions/_shared/blower-replacement-facts-v3.js';
import { inspectVbeltAnnotations, collectConfirmedVbeltFacts } from '../functions/_shared/diary-vbelt-confirm-v1.js';
import { normalizeContent } from '../maintenance/diary-vbelt-core-v1.js';
const url = new URL('../functions/api/blower-history.js', import.meta.url);
const source = fs.readFileSync(url,'utf8').replace(/from (["'])(\.\.?\/[^"']+)\1/g, (_,q,p) => 'from '+JSON.stringify(new URL(p,url).href));
const {adapters} = await import('data:text/javascript;base64,'+Buffer.from(source+`
export const adapters={parseFragments:parseShiftLogFragments,contextualizeFragments:v13ContextualizeScanFragments,
sourceText:fragmentSourceText,identityText:fragmentIdentityText,sourceRole:fragmentSourceRole,sourceTime:fragmentSourceTime,
resolveTargets:v13ResolveTargets,actualBeltReplacement:v13ActualBeltReplacement,detectDateTime:detectionDateTime,
normalizeTime:normalizeCanonicalEntryTime,normalizeRole:normalizeDutyPosition};`).toString('base64'));
const TAG='104HHL60AP611', B='104HHL60AP621', NOW=new Date('2026-11-03T13:00:00Z');
const CONTENT='FBHE Blower #A V-Belt 교체 완료';
const assets=[TAG,B].map((tag_number,index)=>({tag_number,blower_type:'fbhe',unit_no:'1',position_label:'#'+('AB'[index]),enabled:1,asset_group:''}));
const annotation=(content=CONTENT, confirmed=true, targets=[{tagNumber:TAG,replacedOn:'2026-11-03',completedTime:''}])=>({version:1,confirmed,content:normalizeContent(content),targets:confirmed?targets:[]});
const entry=(patch={})=>({id:'entry-a',content:CONTENT,time:'09:58',...patch});
const row=(entries,patch={})=>({id:'source-a',work_date:'2026-11-03',shift:'DS',role:'BCO1',status:'결재완료',author:'Author',log_json:JSON.stringify({id:'source-a',entries}),...patch});
const facts=r=>collectApprovedReplacementFacts(r,assets,adapters);

test('absent metadata retains legacy completion, while false and every malformed/stale marker block fallback',()=>{
 assert.equal(facts(row([entry()])).length,1);
 for(const marker of [annotation(CONTENT,false),null,{}, {...annotation(),confirmed:'false'}, {...annotation(),content:'old content'}, {...annotation(),version:2}]) {
  assert.deepEqual(facts(row([entry({vBeltReplacement:marker})])),[],JSON.stringify(marker));
 }
});
test('author-selected targets/date/time are authoritative; work entry clock is never borrowed',()=>{
 const content='V-Blet 교체 작업';
 const out=facts(row([entry({content,vBeltReplacement:annotation(content,true,[
  {tagNumber:TAG,replacedOn:'2026-11-02',completedTime:''},
  {tagNumber:B,replacedOn:'2026-11-03',completedTime:'11:20'}])})]));
 assert.equal(out.length,2);assert.equal(out[0].timePrecision,'day');assert.equal(out[0].recordDate,'2026-11-02');
 assert.equal(out[0].originalSourceClock,'');assert.equal(out[1].timePrecision,'minute');
 assert.equal(Date.parse(out[1].eventDate),Date.parse('2026-11-03T11:20:00+09:00'));
});
test('draft, tension-only, invalid target and copied confirmations produce no author fact',()=>{
 assert.equal(facts(row([entry({vBeltReplacement:annotation()})],{status:'저장완료'})).length,0);
 const tension='FBHE Blower #A V-Belt Tension 조정 완료';
 assert.equal(facts(row([entry({content:tension,vBeltReplacement:annotation(tension)})])).length,0);
 assert.equal(facts(row([entry({vBeltReplacement:annotation(CONTENT,true,[{tagNumber:'999INVALID000',replacedOn:'2026-11-03',completedTime:''}])})])).length,0);
 for(const patch of [{source:'previous-shift'},{inheritedFromDate:'2026-11-02'},{importedFromLogId:'other-source'}])
  assert.equal(facts(row([entry({...patch,vBeltReplacement:annotation()})])).length,0);
});
test('a native leader may author-confirm; an unannotated or imported leader copy remains excluded',()=>{
 assert.equal(facts(row([entry({vBeltReplacement:annotation()})],{role:'PART_LEADER'})).length,1);
 assert.equal(facts(row([entry()],{role:'PART_LEADER'})).length,0);
 assert.equal(facts(row([entry({importedFromLogId:'other',vBeltReplacement:annotation()})],{role:'PART_LEADER'})).length,0);
});
test('unchecked duplicate arrays win regardless of array order; separate explicit entries stay independent',()=>{
 const log={id:'source-a',entries:[entry({vBeltReplacement:annotation()})],tmEntries:[entry({vBeltReplacement:annotation(CONTENT,false)})],note:CONTENT};
 assert.equal(facts(row([],{log_json:JSON.stringify(log)})).length,0);
 const separate=facts(row([entry({vBeltReplacement:annotation(CONTENT,false)}),entry({id:'entry-b',vBeltReplacement:annotation()})]));
 assert.equal(separate.length,1);assert.equal(separate[0].sourceEntryId,'entry-b');
});
test('a false item does not suppress an unrelated unannotated legacy item',()=>{
 const out=facts(row([entry({vBeltReplacement:annotation(CONTENT,false)}),entry({id:'entry-b',content:'FBHE Blower #B V-Belt 교체 완료'})]));
 assert.equal(out.length,1);assert.equal(out[0].tagNumber,B);
});

async function fixture(t) {
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
 const db={prepare(query){return{values:[],bind(...values){this.values=values;return this;},async all(){return{results:sql.prepare(query).all(...this.values)};},async first(){return sql.prepare(query).get(...this.values)||null;},async run(){return{meta:{changes:Number(sql.prepare(query).run(...this.values).changes)}};}};},
  async batch(items){sql.exec('BEGIN');try{const out=[];for(const item of items)out.push(await item.run());sql.exec('COMMIT');return out;}catch(error){sql.exec('ROLLBACK');throw error;}}};
 await api.ensureSchema(db);await api.ensureIncrementalLogSchema(db);
 sql.exec(`CREATE TABLE shift_logs(id TEXT PRIMARY KEY,work_date TEXT,shift TEXT,role TEXT,author TEXT,status TEXT,log_json TEXT,updated_at TEXT);
 CREATE INDEX shift_date ON shift_logs(work_date,shift,role);`);
 sql.prepare(`UPDATE blower_history_assets SET last_replacement_at='2026-07-01T00:00:00+09:00',cycle_start_state='legacy',cycle_start_revision='prior-start',cycle_runtime_revision='prior-runtime',cycle_runtime_hours=123,runtime_hours=123,cycle_runtime_state='running',is_running=1 WHERE tag_number=?`).run(TAG);
 const asset=()=>sql.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(TAG);
 function save(entries,patch={}){const r=row(entries,patch);sql.prepare('INSERT OR REPLACE INTO shift_logs VALUES(?,?,?,?,?,?,?,?)').run(r.id,r.work_date,r.shift,r.role,r.author,r.status,r.log_json,'2026-11-03T12:00:00Z');return r;}
 const events=()=>sql.prepare("SELECT * FROM blower_history_events WHERE event_type='replacement' ORDER BY id").all();
 async function step(){const res=await api.latestLogsStep(db,{employeeNo:'tester',name:'Author'},{phase:'replacement',replacementAutoVersion:3,incrementalLogs:true,autoApplyConfirmedReplacements:true,limit:8},{now:NOW});const body=await res.json();assert.equal(res.status,200,JSON.stringify(body));return body;}
 return{sql,db,save,step,asset,events};
}
test('approved annotated no-Blower heading is selected; day precision is applied once and replay keeps measured hours',async t=>{
 const f=await fixture(t),content='V-Belt 교체 작업';f.save([entry({content,vBeltReplacement:annotation(content)})]);
 const first=await f.step();assert.equal(first.autoAppliedReplacementCount,1);assert.equal(f.events().length,1);
 const metadata=JSON.parse(f.events()[0].source_text);assert.equal(metadata.timePrecision,'day');
 f.sql.prepare('UPDATE blower_history_assets SET cycle_runtime_hours=7,runtime_hours=7 WHERE tag_number=?').run(TAG);
 const before=JSON.stringify(f.asset());assert.equal((await f.step()).scannedLogCount,0);assert.equal(JSON.stringify(f.asset()),before);
 f.save([entry({content,vBeltReplacement:annotation(content)}),{id:'unrelated',content:'순찰 이상 없음'}]);
 await f.step();assert.equal(f.events().length,1);assert.equal(JSON.stringify(f.asset()),before);
});
test('unchecked then confirmed then stale never reapplies/reset a previously registered fact',async t=>{
 const f=await fixture(t);f.save([entry({vBeltReplacement:annotation(CONTENT,false)})]);
 const before=JSON.stringify(f.asset());await f.step();assert.equal(f.events().length,0);assert.equal(JSON.stringify(f.asset()),before);
 f.save([entry({vBeltReplacement:annotation()})]);await f.step();assert.equal(f.events().length,1);
 f.sql.prepare('UPDATE blower_history_assets SET cycle_runtime_hours=11,runtime_hours=11 WHERE tag_number=?').run(TAG);
 const registered=JSON.stringify(f.asset()),eventId=f.events()[0].id;
 f.save([entry({vBeltReplacement:annotation(CONTENT,false)})]);const off=await f.step();
 assert.equal(off.autoRetractedReplacementCount,0);assert.equal(f.events()[0].id,eventId);assert.equal(JSON.stringify(f.asset()),registered);
 f.save([entry({content:'FBHE Blower #A V-Belt Tension 조정',vBeltReplacement:annotation()})]);await f.step();
 assert.equal(f.events()[0].id,eventId);assert.equal(JSON.stringify(f.asset()),registered);
});
test('adopting an already parsed same-day replacement preserves its event and accumulated runtime',async t=>{
 const f=await fixture(t);f.save([entry({time:''})]);await f.step();assert.equal(f.events().length,1);
 f.sql.prepare('UPDATE blower_history_assets SET cycle_runtime_hours=17,runtime_hours=17 WHERE tag_number=?').run(TAG);
 const before=JSON.stringify(f.asset()),id=f.events()[0].id;
 f.save([entry({vBeltReplacement:annotation()})]);const adopted=await f.step();
 assert.equal(adopted.autoRetractedReplacementCount,0);assert.equal(f.events().length,1);assert.equal(f.events()[0].id,id);assert.equal(JSON.stringify(f.asset()),before);
 f.save([entry({vBeltReplacement:annotation(CONTENT,false)})]);await f.step();assert.equal(JSON.stringify(f.asset()),before);assert.equal(f.events().length,1);
});
test('an old position-keyed event survives assigning a new entry ID with an unchecked confirmation',async t=>{
 const f=await fixture(t);f.save([entry({id:undefined,time:''})]);await f.step();
 const original=f.events()[0];assert.equal(JSON.parse(JSON.parse(original.source_text).sourceKey)[2],'entries:0');
 f.sql.prepare('UPDATE blower_history_assets SET cycle_runtime_hours=19,runtime_hours=19 WHERE tag_number=?').run(TAG);
 const before=JSON.stringify(f.asset());
 f.save([entry({id:'new-stable-entry-id',vBeltReplacement:annotation(CONTENT,false)})]);const result=await f.step();
 assert.equal(result.autoRetractedReplacementCount,0);assert.ok(result.protectedReplacementCount>=1);
 assert.equal(f.events().length,1);assert.equal(f.events()[0].id,original.id);assert.equal(JSON.stringify(f.asset()),before);
});
test('correcting the day of the same author-confirmed job updates one event and preserves unknown clock precision',async t=>{
 const f=await fixture(t);
 f.save([entry({vBeltReplacement:annotation(CONTENT,true,[{tagNumber:TAG,replacedOn:'2026-11-02',completedTime:''}])})]);
 await f.step();const original=f.events()[0],oldRevision=f.asset().cycle_runtime_revision;
 const sourceKey=JSON.parse(original.source_text).sourceKey;assert.equal(JSON.parse(sourceKey)[3],'author-confirmed-v1');
 f.sql.prepare('UPDATE blower_history_assets SET cycle_runtime_hours=23,runtime_hours=23 WHERE tag_number=?').run(TAG);
 f.save([entry({vBeltReplacement:annotation()})]);const changed=await f.step();
 assert.equal(f.events().length,1);assert.equal(f.events()[0].id,original.id);
 assert.equal(changed.autoCorrectedReplacementCount,1);assert.equal(changed.autoAppliedReplacementCount,0);
 const metadata=JSON.parse(f.events()[0].source_text);
 assert.equal(metadata.sourceKey,sourceKey);assert.equal(metadata.timePrecision,'day');assert.equal(metadata.recordDate,'2026-11-03');
 assert.equal(Date.parse(f.events()[0].event_date),Date.parse('2026-11-03T00:00:00+09:00'));
 assert.equal(f.asset().cycle_runtime_hours,0);assert.notEqual(f.asset().cycle_runtime_revision,oldRevision);
 const audit=f.sql.prepare("SELECT before_json,after_json FROM blower_history_asset_history WHERE action_type='replacement_auto_v3' ORDER BY rowid DESC LIMIT 1").get();
 assert.equal(JSON.parse(audit.before_json).events.find(event=>event.id===original.id).event_date,original.event_date);
 assert.equal(JSON.parse(audit.after_json).events.find(event=>event.id===original.id).event_date,f.events()[0].event_date);
 const after=JSON.stringify(f.asset());await f.step();assert.equal(f.events().length,1);assert.equal(JSON.stringify(f.asset()),after);
});
test('copied confirmed entry creates no second physical event or cycle reset',async t=>{
 const f=await fixture(t);f.save([entry({vBeltReplacement:annotation()})]);await f.step();
 const before=JSON.stringify(f.asset());f.save([entry({importedFromLogId:'source-a',vBeltReplacement:annotation()})],{id:'copy',role:'BCO2',log_json:JSON.stringify({id:'copy',entries:[entry({importedFromLogId:'source-a',vBeltReplacement:annotation()})]})});
 await f.step();assert.equal(f.events().length,1);assert.equal(JSON.stringify(f.asset()),before);
});
test('older replacement scan cannot bypass an author control, while operation recognition stays active',async t=>{
 const f=await fixture(t);const content=CONTENT+'\n10:00 FBHE Blower #A → #B 교체운전 실시';
 const r=f.save([entry({content,vBeltReplacement:annotation(content,false)})]);
 const replacement=await api.scanShiftLogs(f.db,{}, {autoApplyConfirmedReplacements:true},{logs:[r]});
 assert.equal((await replacement.json()).detectedCount,0);
 const operation=await api.syncOperationChanges(f.db,{}, {},{logs:[r]});
 assert.ok((await operation.json()).detectedChangeovers>0);
});
