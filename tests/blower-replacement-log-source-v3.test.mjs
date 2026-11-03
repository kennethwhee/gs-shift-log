import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { loadApprovedReplacementPage, storeReplacementLogReceipts, replacementSourceGuard } from '../functions/_shared/blower-replacement-log-source-v3.js';

const NOW = new Date('2026-11-03T12:00:00.000Z');
const WORK = '2026-09-04';
const STAMP = '2026-09-04T12:00:00.000Z';
const BELT = '#1 FBHE Blower #A V-Belt 교체 완료\n- 정확한 현장 원문 "보존"';
function fixture({ legacy = true, shiftIndex = true, legacyIndex = true } = {}) {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE shift_logs(id TEXT PRIMARY KEY,work_date TEXT,shift TEXT,role TEXT,author TEXT,status TEXT,log_json TEXT,updated_at TEXT);
    CREATE TABLE blower_log_receipts_v1(log_id TEXT PRIMARY KEY,source_snapshot TEXT NOT NULL,replacement_done INTEGER NOT NULL DEFAULT 0 CHECK(replacement_done IN(0,1)),operation_done INTEGER NOT NULL DEFAULT 0 CHECK(operation_done IN(0,1)),processed_at TEXT NOT NULL);`);
  if (shiftIndex) sql.exec('CREATE INDEX idx_shift_logs_work_date ON shift_logs(work_date,shift)');
  if (legacy) {
    sql.exec(`CREATE TABLE legacy_logs(id INTEGER PRIMARY KEY AUTOINCREMENT,legacy_diary_id TEXT NOT NULL UNIQUE,work_date TEXT NOT NULL,shift TEXT NOT NULL,role TEXT NOT NULL,author TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT '작성중',operation_status TEXT NOT NULL DEFAULT '',entries_json TEXT NOT NULL DEFAULT '[]',original_json TEXT NOT NULL DEFAULT '{}',updated_at TEXT NOT NULL DEFAULT '');`);
    if (legacyIndex) sql.exec('CREATE INDEX idx_legacy_logs_date_shift ON legacy_logs(work_date,shift)');
  }
  const reads = [], writes = [];
  const db = { sql, reads, writes, prepare(text) {
    return { values: [], text, bind(...values) { this.values = values; return this; },
      async all() { const rows=sql.prepare(text).all(...this.values);reads.push({text,values:this.values.slice(),rows});return { results: rows }; },
      async first() { const row=sql.prepare(text).get(...this.values)||null;reads.push({text,values:this.values.slice(),rows:row?[row]:[]});return row; },
      async run() { writes.push({text,values:this.values.slice()});return {meta:{changes:Number(sql.prepare(text).run(...this.values).changes)}}; }
    };
  }, async batch(statements) {
    sql.exec('BEGIN');try { const out=[];for(const s of statements)out.push(/^\s*(?:SELECT|WITH)\b/i.test(s.text)?await s.all():await s.run());sql.exec('COMMIT');return out; }
    catch(e){sql.exec('ROLLBACK');throw e;}
  } };
  const addCanonical = (id, delta = {}) => {
    const row={id,work_date:WORK,shift:'DS',role:'BCO1',author:'시험 원문 작성자',status:'결재완료',
      log_json:JSON.stringify({entries:[{id:'entry-'+id,time:'10:39',tag:'104HHL60AP611',content:BELT,customRaw:'원문 메타'}]}),updated_at:STAMP,...delta};
    sql.prepare(`INSERT INTO shift_logs(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`).run(...Object.values(row));
    return row;
  };
  const addLegacy = (id, diary = 'POCHEON#20260904#DAY#BCO1', delta = {}) => {
    const body=[{index:2,entry_id:'2',content:'1. [TM] 09:23 FBHE Blower #C V-Blet 전체 교체 실시\n- 교체운전 실시 (#C 정지, #B 기동)\n- V-Belt 교체 및 Alignment 교정 실시 후 차단기 투입 (Stand by 상태)'}];
    const row={id,legacy_diary_id:diary,work_date:WORK,shift:'DS',role:'BCO1',author:'승인 원문 작성자',status:'결재완료',operation_status:'정상 운전',
      entries_json:JSON.stringify(body),original_json:JSON.stringify({diary_id:diary,diary_status:'APPROVED',date:'20260904',shift:'DAY',position:'BCO1',body}),updated_at:STAMP,...delta};
    sql.prepare(`INSERT INTO legacy_logs(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`).run(...Object.values(row));
    return row;
  };
  return {db,sql,addCanonical,addLegacy,close:()=>sql.close()};
}
const readPage = (f, extra={}) => loadApprovedReplacementPage(f.db,{phase:'replacement',limit:8,...extra},{now:NOW});
const text = row => JSON.stringify(JSON.parse(row.log_json));
const aliases = row => new Set((row.sourceAliases||[]).map(String));
const receiptRows = f => f.sql.prepare('SELECT * FROM blower_log_receipts_v1 ORDER BY log_id').all();
const sources = f => JSON.stringify(['shift_logs','legacy_logs'].filter(table=>f.sql.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)).map(table=>({table,rows:f.sql.prepare(`SELECT * FROM ${table} ORDER BY id`).all()})));

// Every fixture is local SQLite. Neither the loader nor these tests can contact
// a plant system, Cloudflare, an account, an Agent or Excel.
test('approved canonical source wins over its approved legacy mirror with all original identity aliases retained',async t=>{
  const f=fixture();t.after(f.close);const diary='POCHEON#20260904#DAY#BCO1';
  f.addLegacy(39718,diary);f.addCanonical('legacy-'+diary);
  const before=sources(f),p=await readPage(f);assert.equal(p.logs.length,1);
  const row=p.logs[0];assert.ok(text(row).includes('정확한 현장 원문'));assert.ok(!text(row).includes('V-Blet 전체'));
  assert.equal(JSON.parse(row.log_json).entries[0].customRaw,'원문 메타');
  const ids=aliases(row);for(const id of ['39718',diary,'legacy-'+diary])assert.ok(ids.has(id),id);
  assert.equal(row.status,'결재완료');assert.equal(sources(f),before);assert.deepEqual(receiptRows(f),[]);assert.equal(f.db.writes.length,0);
});

test('approved legacy is used when a canonical mirror is a draft and its raw body and metadata survive normalization',async t=>{
  const f=fixture();t.after(f.close);const diary='POCHEON#20260916#DAY#BO2';
  const original=f.addLegacy(40040,diary,{work_date:'2026-09-16',role:'BO2'});
  f.addCanonical('legacy-'+diary,{work_date:'2026-09-16',role:'BO2',status:'임시저장',log_json:JSON.stringify({entries:[{content:'승인되지 않은 사본'}]})});
  const p=await readPage(f);assert.equal(p.logs.length,1);const row=p.logs[0],normalized=JSON.parse(row.log_json);
  assert.equal(row.work_date,'2026-09-16');assert.equal(row.shift,'DS');assert.equal(row.role,'BO2');assert.equal(row.status,'결재완료');
  assert.ok(JSON.stringify(normalized).includes('09:23'));assert.ok(JSON.stringify(normalized).includes('V-Blet 전체 교체 실시'));
  assert.ok(JSON.stringify(normalized).includes('#C 정지, #B 기동'));
  assert.ok(!JSON.stringify(normalized).includes('승인되지 않은 사본'));
  const rawContent=JSON.parse(original.original_json).body[0].content;
  assert.ok(normalized.entries.some(e=>String(e.content||'').includes(rawContent)), 'the complete original context remains available to the replacement parser');
  for(const id of ['40040',diary,'legacy-'+diary])assert.ok(aliases(row).has(id),id);
});

test('SQL candidate filtering retains Belt, Blet, Korean and managed TAG context while excluding unrelated routine records',async t=>{
  const f=fixture();t.after(f.close);
  const notes=[['belt','#1 FBHE Blower #A V-Belt 교체 완료'],['blet','#2 FBHE Blower #C V-Blet 전체 교체 실시'],['korean','1호기 Seal Pot 블로워 #A 벨트 교체 완료'],['tag','[104HHL60AP611] V-Belt 교체 완료'],['pump','냉각수 Pump #A Belt 교체 완료'],['routine','FBHE Blower #A 일상 점검']];
  for(const [id,content]of notes)f.addCanonical(id,{log_json:JSON.stringify({entries:[{content}]})});
  const p=await readPage(f);const got=new Set(p.logs.map(r=>r.id));
  for(const id of ['belt','blet','korean','tag'])assert.ok(got.has(id),id);
  assert.ok(!got.has('pump'));assert.ok(!got.has('routine'));
  const dataReads=f.db.reads.filter(r=>/FROM\s+["`]?shift_logs/i.test(r.text));assert.ok(dataReads.length);
  assert.ok(dataReads.every(r=>r.rows.length<=9),'candidate rows are bounded before normalization');
});

test('bounded pages use verified date indexes and a fixed 365-day snapshot without any source writes',async t=>{
  const f=fixture();t.after(f.close);f.addCanonical('inside');f.addCanonical('old',{work_date:'2025-11-02'});f.addCanonical('future-edit',{updated_at:'2026-11-04T00:00:00Z'});
  const before=sources(f),changes=f.sql.prepare('SELECT total_changes() n').get().n,p=await readPage(f,{limit:1});
  assert.deepEqual(p.logs.map(r=>r.id),['inside']);assert.equal(p.limit,1);
  assert.equal(p.window.snapshotAt,NOW.toISOString());assert.equal(p.window.endDate,'2026-11-03');assert.equal(p.window.fromDate,'2025-11-03');
  assert.ok(f.db.reads.length<=3,`read query ceiling: ${f.db.reads.length}`);
  const dataReads=f.db.reads.filter(r=>/\b(?:FROM|JOIN)\s+["`]?(?:shift_logs|legacy_logs)/i.test(r.text)&&!r.text.includes('sqlite_master'));
  assert.ok(dataReads.length);
  for(const r of dataReads){
    const plan=f.sql.prepare('EXPLAIN QUERY PLAN '+r.text).all(...r.values);
    assert.ok(plan.some(x=>/USING (?:COVERING )?INDEX|INTEGER PRIMARY KEY/.test(x.detail)),JSON.stringify(plan));
    if(/work_date\s*>=/.test(r.text))assert.ok(plan.some(x=>/idx_(?:shift_logs_work_date|legacy_logs_date_shift)/.test(x.detail)),JSON.stringify(plan));
  }
  assert.equal(sources(f),before);assert.equal(f.sql.prepare('SELECT total_changes() n').get().n,changes);assert.equal(f.db.writes.length,0);
});

test('a page is never marked done by reading; successful stored receipts advance at most eight sources and never repeat',async t=>{
  const f=fixture();t.after(f.close);for(let i=0;i<19;i++)f.addCanonical('source-'+String(i).padStart(2,'0'));
  const before=sources(f),first=await readPage(f,{limit:8});assert.equal(first.logs.length,8);assert.equal(first.done,false);
  const repeat=await readPage(f,{limit:8,window:first.window,cursor:first.nextCursor});assert.deepEqual(repeat.logs.map(r=>r.id),first.logs.map(r=>r.id),'a browser cursor cannot discard uncommitted analysis');
  const ids=[];let p=first;
  for(let step=0;step<5;step++){
    ids.push(...p.logs.map(r=>r.id));await storeReplacementLogReceipts(f.db,p.logs,NOW);
    p=await readPage(f,{limit:8,window:first.window,cursor:p.nextCursor});if(!p.logs.length)break;
  }
  assert.equal(ids.length,19);assert.equal(new Set(ids).size,19);assert.equal(p.done,true);assert.equal(p.logs.length,0);
  assert.equal(sources(f),before);assert.equal(receiptRows(f).length,19);
});

test('same-stamp source edits become pending again and uncommitted changed content cannot be lost',async t=>{
  const f=fixture();t.after(f.close);f.addCanonical('same');
  const a=await readPage(f);await storeReplacementLogReceipts(f.db,a.logs,NOW);assert.equal((await readPage(f)).logs.length,0);
  const body=JSON.stringify({entries:[{time:'11:11',content:BELT+'\n동일 updated_at 편집 😀'}]});f.sql.prepare('UPDATE shift_logs SET log_json=? WHERE id=?').run(body,'same');
  const b=await readPage(f);assert.equal(b.logs.length,1);assert.ok(text(b.logs[0]).includes('동일 updated_at 편집'));
  assert.notEqual(b.logs[0].source_snapshot,a.logs[0].source_snapshot);
  // A result committed for the old page cannot claim a subsequently edited source.
  await assert.rejects(storeReplacementLogReceipts(f.db,a.logs,NOW),error=>error.code==='BLOWER_REPLACEMENT_SOURCE_CHANGED');
  assert.equal((await readPage(f)).logs.length,1);
  await storeReplacementLogReceipts(f.db,b.logs,NOW);assert.equal((await readPage(f)).logs.length,0);
});

test('v3 replacement receipts are version namespaced and leave the previous operation receipt untouched',async t=>{
  const f=fixture();t.after(f.close);f.addCanonical('prior-v1');
  f.sql.prepare('INSERT INTO blower_log_receipts_v1 VALUES(?,?,?,?,?)').run('prior-v1','old-v1-snapshot',1,1,STAMP);
  const old=f.sql.prepare('SELECT * FROM blower_log_receipts_v1 WHERE log_id=?').get('prior-v1');
  const p=await readPage(f);assert.equal(p.logs.length,1,'an old parser receipt does not suppress the v3 analysis');
  assert.ok(p.logs[0].source_snapshot.includes('replacement-auto-v3'));
  await storeReplacementLogReceipts(f.db,p.logs,NOW);
  assert.deepEqual(f.sql.prepare('SELECT * FROM blower_log_receipts_v1 WHERE log_id=?').get('prior-v1'),old);
  const added=receiptRows(f).filter(r=>r.log_id!=='prior-v1');assert.equal(added.length,1);assert.ok(added[0].log_id.startsWith('replacement-auto-v3:'));assert.equal(added[0].replacement_done,1);
  assert.equal((await readPage(f)).logs.length,0);
});

test('optional legacy absence is explicit and canonical approvals still work without table creation',async t=>{
  const f=fixture({legacy:false});t.after(f.close);f.addCanonical('canonical-only');const before=f.sql.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
  const p=await readPage(f);assert.equal(p.logs.length,1);
  assert.match(JSON.stringify(p.coverageIssues||p.skippedSources||p.sourceCoverage||p),/legacy[^\n]*(?:missing|absent|unavailable|skip)|(?:missing|absent|unavailable|skip)[^\n]*legacy/i);
  assert.deepEqual(f.sql.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all(),before);assert.equal(f.db.writes.length,0);
});

test('missing required date indexes fails closed before an unbounded source read',async t=>{
  const f=fixture({shiftIndex:false});t.after(f.close);f.addCanonical('not-scanned');
  await assert.rejects(readPage(f),/index|인덱스/i);
  assert.ok(f.db.reads.every(r=>!/^\s*SELECT[\s\S]*FROM\s+["`]?shift_logs\b/i.test(r.text)||r.text.includes('sqlite_master')));
  assert.equal(f.db.writes.length,0);
});

test('invalid page limits, phase and supplied time windows are rejected without writes',async t=>{
  const f=fixture();t.after(f.close);
  for(const limit of [0,9,1.5,'8'])await assert.rejects(readPage(f,{limit}),/limit|page|1.?8|한도|범위/i);
  await assert.rejects(readPage(f,{phase:'operation'}));
  await assert.rejects(readPage(f,{window:{fromDate:'1900-01-01',endDate:'2026-11-03',snapshotAt:NOW.toISOString()}}));
  assert.equal(f.db.writes.length,0);assert.deepEqual(receiptRows(f),[]);
});

test('the exact source guard rejects concurrent edits, revoked approval and a newly approved canonical mirror',async t=>{
  for(const mode of ['body-edit','approval-revoked','canonical-appeared']){
    const f=fixture();t.after(f.close);const diary='POCHEON#20260904#DAY#BCO1';
    if(mode==='canonical-appeared')f.addLegacy(39718,diary);else f.addCanonical('guard-source');
    const {logs}=await readPage(f);assert.equal(logs.length,1);const row=logs[0],guard=replacementSourceGuard(row);
    const valid=()=>f.sql.prepare(`SELECT CASE WHEN ${guard.sql} THEN 1 ELSE 0 END valid`).get(...guard.values).valid;
    assert.equal(valid(),1,mode);
    if(mode==='body-edit')f.sql.prepare('UPDATE shift_logs SET log_json=? WHERE id=?').run(JSON.stringify({entries:[{content:BELT+' 수정'}]}),'guard-source');
    if(mode==='approval-revoked')f.sql.prepare('UPDATE shift_logs SET status=? WHERE id=?').run('임시저장','guard-source');
    if(mode==='canonical-appeared')f.addCanonical('native-uuid-mirror',{log_json:JSON.stringify({legacyDiaryId:diary,entries:[{content:BELT}]})});
    assert.equal(valid(),0,mode);
    await assert.rejects(storeReplacementLogReceipts(f.db,logs,NOW),error=>error.code==='BLOWER_REPLACEMENT_SOURCE_CHANGED');
    assert.deepEqual(receiptRows(f),[],mode);
    if(mode==='canonical-appeared'){
      const next=await readPage(f);assert.equal(next.logs.length,1);assert.equal(next.logs[0].id,'native-uuid-mirror');
      for(const id of ['native-uuid-mirror','39718',diary,'legacy-'+diary])assert.ok(aliases(next.logs[0]).has(id),id);
    }
  }
});
