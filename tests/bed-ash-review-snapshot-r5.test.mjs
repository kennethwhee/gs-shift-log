import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import contract from '../efficiency/bed-ash-minute-contract.js';
import {__bedAshTest as api} from '../functions/api/bed-ash-discharge.js';

// Synthetic packets reproduce source changes between validation and mutation.
const DAY='2026-08-01',START=Date.parse(DAY+'T00:00:00+09:00'),MINUTE=60000;
const iso=minute=>new Date(START+minute*MINUTE+32400000).toISOString().slice(0,19)+'+09:00';
function packet(){return {schemaVersion:2,sourceKind:'dataparc_bed_ash_minute',sampleIntervalSeconds:60,targetDate:DAY,
  intervalStart:iso(0),intervalEnd:iso(440),collectedAt:iso(446),
  units:contract.UNIT_DEFINITIONS.map(definition=>({...definition,samples:Array.from({length:441},(_,minute)=>({
    sampledAt:iso(minute),returnedAt:iso(minute).replace(':00+09:00',':17+09:00'),quality:'Raw, Good',
    levelTon:definition.unitNo===1&&minute>=421?23:30}))}))};}
function database(){
  const raw=new DatabaseSync(':memory:');
  raw.exec('CREATE TABLE ois_data_requests(id TEXT PRIMARY KEY,request_type TEXT,target_date TEXT,status TEXT,result_json TEXT,error_message TEXT,requested_at TEXT,completed_at TEXT,updated_at TEXT);');
  return {raw,beforeBatch:null,beforeRun:null,prepare(sql){return {values:[],bind(...values){this.values=values;return this;},
    async first(){return raw.prepare(sql).get(...this.values)||null;},
    async all(){return {results:raw.prepare(sql).all(...this.values)};},
    async run(){return {meta:{changes:Number(raw.prepare(sql).run(...this.values).changes)}};}};},
    async batch(statements){if(this.beforeBatch){const fn=this.beforeBatch;this.beforeBatch=null;fn();}
      raw.exec('BEGIN IMMEDIATE');try{const results=[];for(const statement of statements)results.push(await statement.run());raw.exec('COMMIT');return results;}
      catch(error){raw.exec('ROLLBACK');throw error;}},close(){raw.close();}};
}
async function fixture(t){
  const db=database();t.after(()=>db.close());await api.ensureSchema(db);const original=packet();
  db.raw.prepare('INSERT INTO ois_data_requests VALUES(?,?,?,?,?,?,?,?,?)')
    .run('source','bed_ash_level',DAY,'complete',JSON.stringify(original),'',iso(446),iso(446),iso(446));
  const response=await api.handleRangeGet({env:{DB:db}},new URL(`https://fixture.invalid/api/bed-ash-discharge?startDate=${DAY}&endDate=${DAY}`));
  assert.equal(response.status,200);const {data}=await response.json();assert.equal(data.events.length,1);
  assert.equal(data.events[0].reviewReady,true);return {db,event:data.events[0],original};
}
function review(db,event,status='confirmed'){
  return api.handleReviewPost({env:{DB:db}},{action:'review',eventKey:event.eventKey,revision:event.revision,status,
    confirmedAt:event.endAt,confirmedTon:event.estimatedTon,note:'Synthetic review'},
    {employeeNo:'synthetic-operator',name:'Synthetic Operator'});
}
function flattenSource(db){
  const source=JSON.parse(db.raw.prepare('SELECT result_json FROM ois_data_requests WHERE id=?').get('source').result_json);
  for(const unit of source.units)for(const point of unit.samples)point.levelTon=30;
  db.raw.prepare('UPDATE ois_data_requests SET result_json=? WHERE id=?').run(JSON.stringify(source),'source');
}

for(const [name,mutate] of [
  ['result JSON without timestamp changes',db=>flattenSource(db)],
  ['updated timestamp only',db=>db.raw.prepare('UPDATE ois_data_requests SET updated_at=? WHERE id=?').run(iso(447),'source')],
  ['processing status with the same ID',db=>db.raw.prepare('UPDATE ois_data_requests SET status=? WHERE id=?').run('processing','source')],
  ['failed status with the same ID',db=>db.raw.prepare('UPDATE ois_data_requests SET status=? WHERE id=?').run('failed','source')],
  ['completion timestamp only',db=>db.raw.prepare('UPDATE ois_data_requests SET completed_at=? WHERE id=?').run(iso(447),'source')],
  ['result JSON plus updated timestamp',db=>{flattenSource(db);db.raw.prepare('UPDATE ois_data_requests SET updated_at=? WHERE id=?').run(iso(447),'source');}],
  ['request deletion',db=>db.raw.prepare('DELETE FROM ois_data_requests WHERE id=?').run('source')],
  ['newer source insertion',db=>db.raw.prepare('INSERT INTO ois_data_requests VALUES(?,?,?,?,?,?,?,?,?)').run('newer','bed_ash_level',DAY,'pending',null,'',iso(447),null,iso(447))]
]){
  test(`review rejects a concurrent ${name} without persisting a decision or history`,async t=>{
    const {db,event}=await fixture(t);db.beforeBatch=()=>mutate(db);
    const response=await review(db,event);assert.equal(response.status,409,JSON.stringify(await response.clone().json()));
    const stored=db.raw.prepare('SELECT status,confirmed_ton,revision,review_ready FROM bed_ash_discharge_events WHERE event_key=?').get(event.eventKey);
    assert.equal(stored.status,'pending');assert.equal(stored.confirmed_ton,null);assert.equal(stored.revision,event.revision);
    assert.equal(stored.review_ready,0);assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM bed_ash_discharge_review_history').get().n,0);
  });
}

test('unmodified source permits confirm and exclude, each with exactly one matching append-only history row',async t=>{
  for(const status of ['confirmed','excluded']){
    const {db,event}=await fixture(t);const response=await review(db,event,status);
    assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
    const stored=db.raw.prepare('SELECT status,confirmed_ton,revision FROM bed_ash_discharge_events WHERE event_key=?').get(event.eventKey);
    assert.equal(stored.status,status);assert.equal(stored.confirmed_ton,status==='confirmed'?7:null);assert.equal(stored.revision,event.revision+1);
    const rows=db.raw.prepare('SELECT * FROM bed_ash_discharge_review_history').all();assert.equal(rows.length,1);
    assert.equal(rows[0].new_status,status);assert.equal(rows[0].event_revision,event.revision+1);
    assert.equal((await review(db,event,status)).status,409);assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM bed_ash_discharge_review_history').get().n,1);
  }
});

test('the source guard also protects evidence refresh before the reviewer can retry',async t=>{
  const {db,event}=await fixture(t);
  db.raw.prepare('UPDATE bed_ash_discharge_events SET evidence_fingerprint=? WHERE event_key=?').run('old-evidence',event.eventKey);
  const prepare=db.prepare.bind(db);let changed=false;
  db.prepare=sql=>{const statement=prepare(sql);if(sql.includes('SET\n          event_start_at = ?')){
    const run=statement.run.bind(statement);statement.run=async()=>{changed=true;flattenSource(db);return await run();};}
    return statement;};
  const response=await review(db,event);assert.equal(response.status,409);assert.equal(changed,true);
  const stored=db.raw.prepare('SELECT status,evidence_fingerprint,revision,review_ready FROM bed_ash_discharge_events WHERE event_key=?').get(event.eventKey);
  assert.equal(stored.status,'pending');assert.equal(stored.evidence_fingerprint,'old-evidence');assert.equal(stored.revision,event.revision);
  assert.equal(stored.review_ready,0);assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM bed_ash_discharge_review_history').get().n,0);
});
