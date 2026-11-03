import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {loadApprovedReplacementPage,storeReplacementLogReceipts,replacementSourceGuard,
  REPLACEMENT_ANALYSIS_VERSION,REPLACEMENT_NORMALIZE_ANALYSIS_VERSION,REPLACEMENT_ROLE_PRIORITY_ANALYSIS_VERSION,replacementRoleContextRows,replacementSourceHashes} from '../functions/_shared/blower-replacement-log-source-v3.js';
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
 const page=(body={},version=4)=>loadApprovedReplacementPage(db,{phase:'replacement',limit:8,...body},{now:NOW,analysisVersion:version,rolePriority:version===4});
 const valid=row=>{const g=replacementSourceGuard(row);return sql.prepare(`SELECT CASE WHEN ${g.sql} THEN 1 ELSE 0 END valid`).get(...g.values).valid;};
 return{sql,db,reads,writes,canonical,legacy,suppress,page,valid,close:()=>sql.close()};
}


test('R5 replays R4 receipts, loads the approved higher counterpart outside a one-row page and retains exact guards',async t=>{
 const f=fixture();t.after(f.close);f.canonical('a-lower',{role:'BO1'});f.canonical('z-higher');
 const old=await loadApprovedReplacementPage(f.db,{limit:8},{now:NOW,analysisVersion:4});await storeReplacementLogReceipts(f.db,old.logs,NOW);
 const p=await f.page({limit:1});assert.equal(p.logs.length,1);assert.match(p.logs[0].receiptId,/role-priority-v1/);
 const context=replacementRoleContextRows(p.logs);assert.deepEqual(context.map(row=>row.id).sort(),['a-lower','z-higher']);
 for(const row of context){assert.equal(f.valid(row),1);const hashes=await replacementSourceHashes(row);const original=old.logs.find(item=>item.id===row.id);const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(original.source_snapshot)))].map(v=>v.toString(16).padStart(2,'0')).join('');assert.ok(hashes.sourceSnapshotHistorySha256.includes(digest));}
 await storeReplacementLogReceipts(f.db,p.logs,NOW);assert.deepEqual((await f.page({limit:1})).logs.map(r=>r.id),['z-higher']);
});
test('a same-stamp higher edit invalidates a lower receipt and every old dependency guard',async t=>{
 const f=fixture();t.after(f.close);f.canonical('lower',{role:'BO1'});f.canonical('higher');const old=await f.page();await storeReplacementLogReceipts(f.db,old.logs,NOW);assert.equal((await f.page()).logs.length,0);
 f.sql.prepare('UPDATE shift_logs SET log_json=? WHERE id=?').run(JSON.stringify({entries:[{content:BELT,time:'10:04'}]}),'higher');
 for(const row of old.logs)assert.equal(f.valid(row),0);assert.deepEqual((await f.page()).logs.map(r=>r.id).sort(),['higher','lower']);
});
test('deleted or unapproved higher logs invalidate lower receipts and disappear from authoritative context',async t=>{
 for(const mode of ['delete','unapprove','not-a-job']){const f=fixture();t.after(f.close);f.canonical('lower',{role:'BO1'});f.canonical('higher');const old=await f.page();await storeReplacementLogReceipts(f.db,old.logs,NOW);
 if(mode==='delete')f.sql.prepare("DELETE FROM shift_logs WHERE id='higher'").run();
 if(mode==='unapprove')f.sql.prepare("UPDATE shift_logs SET status='작성중' WHERE id='higher'").run();
 if(mode==='not-a-job')f.sql.prepare("UPDATE shift_logs SET log_json='{}' WHERE id='higher'").run();
 const next=await f.page();assert.deepEqual(next.logs.map(r=>r.id),['lower']);assert.deepEqual(replacementRoleContextRows(next.logs).map(r=>r.id),['lower']);assert.equal(f.valid(old.logs.find(r=>r.id==='lower')),0);}
});
test('a late upper approval or edit remains authoritative inside an older source window',async t=>{
 const f=fixture();t.after(f.close);f.canonical('lower',{role:'BO1'});let p=await f.page();const late=new Date(NOW.getTime()+1000).toISOString();f.canonical('higher',{updated_at:late});
 p=await f.page({window:p.window});assert.deepEqual(p.logs.map(r=>r.id),['lower']);const peers=replacementRoleContextRows(p.logs);assert.deepEqual(peers.map(r=>r.id).sort(),['higher','lower']);assert.ok(peers.every(row=>f.valid(row)===1));
});
test('legacy counterpart, canonical mirror precedence and normalized shift aliases retain dependency guards',async t=>{
 const f=fixture();t.after(f.close);f.canonical('lower',{role:'BO1',shift:'DAY'});const diary='POCHEON#20260904#DAY#BCO1';f.legacy(10,diary);let p=await f.page({limit:1});let peers=replacementRoleContextRows(p.logs);assert.equal(peers.length,2);assert.ok(peers.every(row=>f.valid(row)===1));
 f.canonical('legacy-'+diary);for(const row of peers)assert.equal(f.valid(row),0);p=await f.page();peers=replacementRoleContextRows(p.logs);assert.equal(peers.filter(row=>row.sourceTable==='legacy_logs').length,0);assert.equal(peers.length,2);assert.ok(peers.every(row=>f.valid(row)===1));
});
test('oversized counterpart groups fail before reconciliation and queries use date indexes',async t=>{
 const f=fixture();t.after(f.close);for(let i=0;i<65;i++)f.canonical('peer-'+i,{role:i%2?'BCO1':'BO1'});const p=await f.page({limit:1});assert.throws(()=>replacementRoleContextRows(p.logs),e=>e.code==='BLOWER_ROLE_PRIORITY_CONTEXT_LIMIT');
 for(const read of f.reads.filter(r=>r.text.includes('FROM shift_logs s INDEXED BY'))){const plan=f.sql.prepare('EXPLAIN QUERY PLAN '+read.text).all(...read.values);assert.ok(plan.some(r=>/SEARCH rps USING INDEX idx_shift_logs_date/.test(r.detail)),JSON.stringify(plan));assert.ok(!plan.some(r=>/SCAN rps|SCAN rph/.test(r.detail)),JSON.stringify(plan));}assert.equal(f.writes.length,0);
});
test('off-page canonical counterpart retains its numeric legacy alias for exclusion and old-evidence ownership',async t=>{
 const f=fixture();t.after(f.close);f.canonical('a-lower',{role:'BO1'});const diary='POCHEON#20260904#DAY#BCO1';f.legacy(987,diary);f.canonical('legacy-'+diary);const p=await f.page({limit:1});const high=replacementRoleContextRows(p.logs).find(row=>row.role==='BCO1');assert.equal(high.sourceTable,'shift_logs');assert.ok(high.sourceAliases.includes('987'));assert.equal(f.valid(high),1);
});
test('cross-family higher roles remain visible outside a one-row page and invalidate prior receipts',async t=>{
 const f=fixture();t.after(f.close);f.canonical('a-low',{role:'BO1'});f.canonical('b-high',{role:'BCO1'});const initial=await f.page();await storeReplacementLogReceipts(f.db,initial.logs,NOW);f.canonical('z-turbine',{role:'TGO'});const page=await f.page({limit:1});assert.equal(page.logs[0].id,'a-low');assert.deepEqual(replacementRoleContextRows(page.logs).map(row=>row.role).sort(),['BCO1','BO1','TGO']);for(const row of initial.logs)assert.equal(f.valid(row),0);
});
