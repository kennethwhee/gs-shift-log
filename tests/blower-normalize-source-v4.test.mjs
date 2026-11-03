import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {loadApprovedReplacementPage,storeReplacementLogReceipts,replacementSourceGuard,
  REPLACEMENT_ANALYSIS_VERSION,REPLACEMENT_NORMALIZE_ANALYSIS_VERSION} from '../functions/_shared/blower-replacement-log-source-v3.js';
import {inspectVbeltAnnotations,annotationControlsFragment,collectConfirmedVbeltFacts} from '../functions/_shared/diary-vbelt-confirm-v1.js';
const NOW=new Date('2026-11-04T00:40:00.000Z'),STAMP='2026-09-04T12:00:00Z',WORK='2026-09-04',BELT='FBHE Blower #A V-Belt 교체 완료';
// Copied table key shape from retained production corpus metadata: the four
// legacy identity columns are the existing composite primary key.
const SUPPRESSION_DDL=`CREATE TABLE legacy_log_suppressions(legacy_diary_id TEXT NOT NULL,work_date TEXT NOT NULL,shift TEXT NOT NULL,role TEXT NOT NULL,source_log_id TEXT NOT NULL DEFAULT '',deleted_by_id TEXT NOT NULL DEFAULT '',deleted_by_name TEXT NOT NULL DEFAULT '',deleted_at TEXT NOT NULL,reason TEXT NOT NULL DEFAULT 'user-delete',PRIMARY KEY(legacy_diary_id,work_date,shift,role))`;
function fixture({suppression=true,suppressionIndex=true}={}){
 const sql=new DatabaseSync(':memory:');sql.exec(`CREATE TABLE shift_logs(id TEXT PRIMARY KEY,work_date TEXT,shift TEXT,role TEXT,author TEXT,status TEXT,log_json TEXT,updated_at TEXT);CREATE INDEX idx_shift_logs_date ON shift_logs(work_date,shift);
 CREATE TABLE legacy_logs(id INTEGER PRIMARY KEY,legacy_diary_id TEXT NOT NULL UNIQUE,work_date TEXT,shift TEXT,role TEXT,author TEXT,status TEXT,entries_json TEXT,original_json TEXT,updated_at TEXT);CREATE INDEX idx_legacy_logs_date ON legacy_logs(work_date,shift);
 CREATE TABLE blower_log_receipts_v1(log_id TEXT PRIMARY KEY,source_snapshot TEXT NOT NULL,replacement_done INTEGER NOT NULL DEFAULT 0,operation_done INTEGER NOT NULL DEFAULT 0,processed_at TEXT NOT NULL);`);
 if(suppression)sql.exec(suppressionIndex?SUPPRESSION_DDL:SUPPRESSION_DDL.replace(',PRIMARY KEY(legacy_diary_id,work_date,shift,role)',''));
 const reads=[],writes=[];
 const db={prepare(text){return{text,values:[],bind(...values){this.values=values;return this;},async all(){const rows=sql.prepare(text).all(...this.values);reads.push({text,values:this.values,rows});return{results:rows};},async run(){writes.push({text,values:this.values});return{meta:{changes:Number(sql.prepare(text).run(...this.values).changes)}};}};},async batch(statements){sql.exec('BEGIN');try{const rows=[];for(const s of statements)rows.push(await s.run());sql.exec('COMMIT');return rows;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const insert=(table,row)=>sql.prepare(`INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`).run(...Object.values(row));
 const canonical=(id,extra={})=>{const row={id,work_date:WORK,shift:'DS',role:'BCO1',author:'fixture',status:'결재완료',log_json:JSON.stringify({entries:[{id:'entry-'+id,content:BELT,time:'10:00'}]}),updated_at:STAMP,...extra};insert('shift_logs',row);return row;};
 const legacy=(id,diary='POCHEON#20260904#DAY#BCO1',extra={})=>{const entries=[{content:BELT,index:1}];const row={id,legacy_diary_id:diary,work_date:WORK,shift:'DS',role:'BCO1',author:'fixture',status:'결재완료',entries_json:JSON.stringify(entries),original_json:JSON.stringify({body:entries}),updated_at:STAMP,...extra};insert('legacy_logs',row);return row;};
 const suppress=(diary,extra={})=>insert('legacy_log_suppressions',{legacy_diary_id:diary,work_date:WORK,shift:'DS',role:'BCO1',deleted_at:STAMP,...extra});
 const page=(body={},version=4)=>loadApprovedReplacementPage(db,{phase:'replacement',limit:8,...body},{now:NOW,analysisVersion:version});
 const valid=row=>{const g=replacementSourceGuard(row);return sql.prepare(`SELECT CASE WHEN ${g.sql} THEN 1 ELSE 0 END valid`).get(...g.values).valid;};
 return{sql,db,reads,writes,canonical,legacy,suppress,page,valid,close:()=>sql.close()};
}

test('default V3 namespace is preserved while explicit V4 rechecks old receipts without altering them',async t=>{
 const f=fixture();t.after(f.close);f.canonical('same');assert.equal(REPLACEMENT_ANALYSIS_VERSION,'replacement-auto-v3');assert.equal(REPLACEMENT_NORMALIZE_ANALYSIS_VERSION,'replacement-normalize-v4');
 const v3=await f.page({},3);await storeReplacementLogReceipts(f.db,v3.logs,NOW);assert.equal((await f.page({},3)).logs.length,0);
 const old=f.sql.prepare('SELECT * FROM blower_log_receipts_v1').get(),v4=await f.page();assert.equal(v4.logs.length,1);assert.equal(v4.logs[0]._analysisVersion,4);assert.ok(v4.logs[0].receiptId.startsWith('replacement-normalize-v4:'));assert.notEqual(v4.logs[0].source_snapshot,v3.logs[0].source_snapshot);assert.equal(f.valid(v4.logs[0]),1);
 await storeReplacementLogReceipts(f.db,v4.logs,NOW);assert.deepEqual(f.sql.prepare('SELECT * FROM blower_log_receipts_v1 WHERE log_id=?').get(old.log_id),old);assert.equal((await f.page()).logs.length,0);assert.equal((await f.page({},3)).logs.length,0);
});
test('hundreds of PART/GROUP leader rows are excluded in SQL before malformed bodies or page limits consume work',async t=>{
 const f=fixture();t.after(f.close);for(let i=0;i<401;i++)f.canonical('leader-'+i,{role:i%2?'PART_LEADER':'GROUP_LEADER',log_json:'invalid JSON FBHE Blower V-Belt 교체 완료'});
 for(const [i,role]of ['파트장','1조 파트장',' part leader ','SHIFT_LEADER'].entries())f.canonical('other-leader-'+i,{role,log_json:'invalid JSON FBHE Blower V-Belt 교체 완료'});
 f.legacy(999,'leader-legacy',{role:'PART_LEADER',entries_json:'invalid FBHE Belt',original_json:'invalid JSON FBHE Blower V-Belt 교체 완료'});f.canonical('valid-operation');const p=await f.page({limit:2});
 assert.deepEqual(p.logs.map(r=>r.id),['valid-operation']);assert.equal(p.done,true);assert.equal(f.writes.length,0);assert.ok(f.reads.filter(r=>!r.text.includes('sqlite_master')).every(r=>r.rows.length<=3));
});
test('eligible approved canonical retains priority and leader canonical does not block an approved operational legacy fallback',async t=>{
 const f=fixture();t.after(f.close);const diary='POCHEON#20260904#DAY#BCO1';f.legacy(10,diary);f.canonical('legacy-'+diary,{role:'PART_LEADER'});
 let p=await f.page();assert.equal(p.logs.length,1);assert.equal(p.logs[0].sourceTable,'legacy_logs');assert.equal(f.valid(p.logs[0]),1);
 f.sql.prepare('UPDATE shift_logs SET role=? WHERE id=?').run('BCO1','legacy-'+diary);assert.equal(f.valid(p.logs[0]),0);p=await f.page();assert.equal(p.logs.length,1);assert.equal(p.logs[0].sourceTable,'shift_logs');
});
test('the full legacy suppression identity excludes both canonical and legacy sources while other shifts remain',async t=>{
 const f=fixture();t.after(f.close);const diary='POCHEON#20260904#DAY#BCO1';f.legacy(10,diary);f.canonical('native-mirror',{log_json:JSON.stringify({legacyDiaryId:diary,entries:[{content:BELT}]})});f.suppress(diary);
 f.legacy(11,'POCHEON#other',{shift:'NS'});f.suppress('POCHEON#other');const p=await f.page();assert.deepEqual(p.logs.map(r=>r.sourceRowId),['11']);assert.equal(p.logs[0].shift,'NS');assert.equal(f.writes.length,0);
});
test('a suppression added after fetch revokes the exact source guard and cannot earn a receipt',async t=>{
 for(const kind of ['canonical','legacy']){const f=fixture();t.after(f.close);const diary='POCHEON#20260904#DAY#BCO1';if(kind==='canonical')f.canonical('legacy-'+diary);else f.legacy(10,diary);const p=await f.page();assert.equal(p.logs.length,1);assert.equal(f.valid(p.logs[0]),1);f.suppress(diary);assert.equal(f.valid(p.logs[0]),0);await assert.rejects(storeReplacementLogReceipts(f.db,p.logs,NOW),e=>e.code==='BLOWER_REPLACEMENT_SOURCE_CHANGED');assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM blower_log_receipts_v1').get().n,0);}
});
test('optional suppression absence is explicit, creates no table and guard rejects later table appearance',async t=>{
 const f=fixture({suppression:false});t.after(f.close);f.canonical('canonical');const p=await f.page();assert.equal(p.logs.length,1);assert.match(p.coverageIssues.join('\n'),/legacy_log_suppressions is absent/);assert.equal(p.logs[0]._suppressionAvailable,false);assert.equal(f.valid(p.logs[0]),1);assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='legacy_log_suppressions'").get().n,0);f.sql.exec(SUPPRESSION_DDL);assert.equal(f.valid(p.logs[0]),0);assert.equal(f.writes.length,0);
});
test('present suppression table without its existing legacy identity index fails before source scans',async t=>{
 const f=fixture({suppressionIndex:false});t.after(f.close);f.canonical('not-read');await assert.rejects(f.page(),e=>e.code==='BLOWER_REPLACEMENT_SOURCE_INDEX_REQUIRED');assert.equal(f.reads.length,1);assert.ok(f.reads[0].text.includes('sqlite_master'));assert.equal(f.writes.length,0);
});
test('source queries and suppression guards use existing date/key indexes with no suppression scan or DDL',async t=>{
 const f=fixture();t.after(f.close);f.canonical('source');const p=await f.page();const sourceReads=f.reads.filter(r=>!r.text.includes('sqlite_master'));
 for(const read of sourceReads){const plan=f.sql.prepare('EXPLAIN QUERY PLAN '+read.text).all(...read.values);assert.ok(plan.some(r=>/idx_(shift|legacy)_logs_date/.test(r.detail)),JSON.stringify(plan));assert.ok(!plan.some(r=>/SCAN replacement_suppression/.test(r.detail)),JSON.stringify(plan));assert.ok(plan.some(r=>/SEARCH replacement_suppression USING COVERING INDEX/.test(r.detail)),JSON.stringify(plan));}
 const guard=replacementSourceGuard(p.logs[0]);const plan=f.sql.prepare('EXPLAIN QUERY PLAN SELECT CASE WHEN '+guard.sql+' THEN 1 ELSE 0 END').all(...guard.values);assert.ok(!plan.some(r=>/SCAN replacement_suppression/.test(r.detail)));assert.equal(f.writes.length,0);
});
test('approval or role changes after fetch invalidate V4 source authority',async t=>{
 for(const patch of [{role:'GROUP_LEADER'},{status:'작성중'}]){const f=fixture();t.after(f.close);f.canonical('changed');const p=await f.page();const [field,value]=Object.entries(patch)[0];f.sql.prepare('UPDATE shift_logs SET '+field+'=? WHERE id=?').run(value,'changed');assert.equal(f.valid(p.logs[0]),0);}
});
test('invalid explicit versions or forged namespaces are rejected without reads or writes',async t=>{
 const f=fixture();t.after(f.close);for(const version of [0,5,'4',null])await assert.rejects(f.page({},version),e=>e.code==='BLOWER_REPLACEMENT_ANALYSIS_VERSION_INVALID');assert.equal(f.reads.length,0);f.canonical('valid');const p=await f.page();assert.throws(()=>replacementSourceGuard({...p.logs[0],_analysisVersion:3}));assert.throws(()=>replacementSourceGuard({...p.logs[0],_suppressionAvailable:undefined}));
});

const AUTHOR_TAG='104HHL60AP611';
const AUTHOR_ASSETS=[{tag_number:AUTHOR_TAG,enabled:1}];
function annotatedLog(id,content,{confirmed=true,markerContent=content}={}){
 return JSON.stringify({id,entries:[{id:'author-entry-'+id,content,vBeltReplacement:{version:1,confirmed,
  content:markerContent,targets:confirmed?[{tagNumber:AUTHOR_TAG,replacedOn:WORK,completedTime:''}]:[]}}]});
}

test('default V3 preserves the current checkbox loader selection without requiring a managed-equipment keyword',async t=>{
 const f=fixture();t.after(f.close);const raw=annotatedLog('author-v3','V-Belt 교체 작업');
 f.canonical('author-v3',{role:'PART_LEADER',log_json:raw});const p=await f.page({},3);
 assert.deepEqual(p.logs.map(row=>row.id),['author-v3']);assert.equal(p.logs[0].log_json,raw);
 assert.ok(p.logs[0].receiptId.startsWith('replacement-auto-v3:'));assert.equal(f.valid(p.logs[0]),1);
 assert.equal(collectConfirmedVbeltFacts(p.logs[0],AUTHOR_ASSETS).length,1);
 assert.equal(f.writes.length,0);
});

test('V4 skips 401 unannotated leaders but includes explicit PART and GROUP author facts before the page limit',async t=>{
 const f=fixture();t.after(f.close);
 for(let i=0;i<401;i++)f.canonical('plain-leader-'+String(i).padStart(3,'0'),{
  role:i%2?'PART_LEADER':'GROUP_LEADER',log_json:'invalid JSON FBHE Blower V-Belt 교체 완료'});
 for(const [id,role]of [['author-part','PART_LEADER'],['author-group','GROUP_LEADER']])
  f.canonical(id,{role,log_json:annotatedLog(id,'V-Belt 교체 작업')});
 const before=f.sql.prepare('SELECT id,role,log_json FROM shift_logs ORDER BY id').all();
 const p=await f.page({limit:2});assert.equal(p.done,true);assert.equal(p.logs.length,2);
 assert.deepEqual(new Set(p.logs.map(row=>row.id)),new Set(['author-part','author-group']));
 for(const row of p.logs){assert.equal(f.valid(row),1);const facts=collectConfirmedVbeltFacts(row,AUTHOR_ASSETS);
  assert.equal(facts.length,1);assert.equal(facts[0].tagNumber,AUTHOR_TAG);assert.equal(facts[0].timePrecision,'day');}
 assert.deepEqual(f.sql.prepare('SELECT id,role,log_json FROM shift_logs ORDER BY id').all(),before);
 assert.equal(f.writes.length,0);assert.ok(f.reads.filter(read=>!read.text.includes('sqlite_master')).every(read=>read.rows.length<=3));
 const read=f.reads.find(item=>item.text.includes('FROM shift_logs s INDEXED BY'));
 const plan=f.sql.prepare('EXPLAIN QUERY PLAN '+read.text).all(...read.values);
 assert.ok(plan.some(item=>/SEARCH s USING INDEX idx_shift_logs_date/.test(item.detail)),JSON.stringify(plan));
});

test('unchecked, stale and non-belt annotations reach the controlled parser and earn only exact source receipts',async t=>{
 const f=fixture();t.after(f.close);
 const cases=[['unchecked','V-Belt 교체 작업',{confirmed:false}],
  ['stale','V-Belt 교체 작업',{markerContent:'이전 V-Belt 교체 작업'}],
  ['non-belt','순찰 이상 없음',{confirmed:false}]];
 for(const [id,content,choice]of cases)f.canonical(id,{role:'GROUP_LEADER',log_json:annotatedLog(id,content,choice)});
 const sourceBefore=f.sql.prepare('SELECT * FROM shift_logs ORDER BY id').all();
 const p=await f.page();assert.equal(p.logs.length,3);
 for(const row of p.logs){const control=inspectVbeltAnnotations(row),entry=JSON.parse(row.log_json).entries[0];
  assert.equal(control.hasAnnotations,true);assert.deepEqual(collectConfirmedVbeltFacts(row,AUTHOR_ASSETS,control),[]);
  assert.equal(annotationControlsFragment(control,{v3Origin:{entryId:entry.id,entryContent:entry.content,collectionName:'entries'}}),true,
   'an explicit author choice must suppress a legacy text fallback for the same entry');
  assert.equal(f.valid(row),1);}
 await storeReplacementLogReceipts(f.db,p.logs,NOW);assert.equal((await f.page()).logs.length,0);
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM blower_log_receipts_v1 WHERE replacement_done=1').get().n,3);
 assert.deepEqual(f.sql.prepare('SELECT * FROM shift_logs ORDER BY id').all(),sourceBefore);
 const original=p.logs.find(row=>row.id==='unchecked');
 f.sql.prepare('UPDATE shift_logs SET log_json=? WHERE id=?').run(annotatedLog('unchecked','V-Belt 교체 작업'),'unchecked');
 assert.equal(f.valid(original),0,'a same-stamp author edit revokes the old exact source authority');
 const changed=await f.page();assert.deepEqual(changed.logs.map(row=>row.id),['unchecked']);
 assert.equal(collectConfirmedVbeltFacts(changed.logs[0],AUTHOR_ASSETS).length,1);
 assert.notEqual(changed.logs[0].source_snapshot,original.source_snapshot);
});

test('an approved annotated leader controls its canonical legacy mirror and still obeys suppression guards',async t=>{
 const f=fixture();t.after(f.close);const diary='POCHEON#20260904#DAY#BCO1',source='legacy-'+diary;
 f.legacy(10,diary);f.canonical(source,{role:'PART_LEADER',log_json:annotatedLog(source,'순찰 이상 없음',{confirmed:false})});
 const p=await f.page();assert.equal(p.logs.length,1);assert.equal(p.logs[0].sourceTable,'shift_logs');
 assert.deepEqual(collectConfirmedVbeltFacts(p.logs[0],AUTHOR_ASSETS),[]);
 assert.equal(f.valid(p.logs[0]),1);f.suppress(diary,{role:'PART_LEADER'});
 assert.equal(f.valid(p.logs[0]),0);await assert.rejects(storeReplacementLogReceipts(f.db,p.logs,NOW),e=>e.code==='BLOWER_REPLACEMENT_SOURCE_CHANGED');
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM blower_log_receipts_v1').get().n,0);
});
