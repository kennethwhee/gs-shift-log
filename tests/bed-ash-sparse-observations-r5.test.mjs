import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import contract from '../efficiency/bed-ash-minute-contract.js';
import {__bedAshTest as api} from '../functions/api/bed-ash-discharge.js';

// All measurements in this file are synthetic. No production packet is used.
const MINUTE=60000,DAY='2026-08-01',START=Date.parse(DAY+'T00:00:00+09:00'),END=START+86400000;
const SOURCE='dataparc_bed_ash_minute',VERSION='bed-ash-drop-minute-v2';
const iso=at=>new Date(at+32400000).toISOString().slice(0,19)+'+09:00';
const point=(unitNo,minute,levelTon,offset=17000)=>({unitNo,bucketAt:iso(START+minute*MINUTE),
  sampledAt:iso(START+minute*MINUTE+offset),returnedAt:iso(START+minute*MINUTE+offset),
  quality:'Raw, Good',levelTon,sourceDate:DAY,sourceKind:SOURCE,sampleIntervalSeconds:60});
const missing=(unitNo,minute,quality='No Data, Bad')=>({...point(unitNo,minute,null,0),returnedAt:null,quality});
const observations=points=>api.detectMinuteBedAshObservationsForUnit(1,points);
const simpleRun=(levels,start=420)=>levels.map((level,offset)=>point(1,start+offset,level));

function packet({end=440,level=()=>30,missingRows=new Map()}={}){
  return {schemaVersion:2,sourceKind:SOURCE,sampleIntervalSeconds:60,targetDate:DAY,
    intervalStart:iso(START),intervalEnd:iso(START+end*MINUTE),collectedAt:iso(START+(end+6)*MINUTE),
    units:contract.UNIT_DEFINITIONS.map(definition=>({...definition,samples:Array.from({length:end+1},(_,minute)=>{
      const quality=missingRows.get(`${definition.unitNo}:${minute}`);
      return {sampledAt:iso(START+minute*MINUTE),returnedAt:quality?null:iso(START+minute*MINUTE+17000),
        quality:quality||'Raw, Good',levelTon:quality?null:level(definition.unitNo,minute)};
    })}))};
}
function requestRow(raw,id='source'){
  return {id,target_date:DAY,status:'complete',result_json:JSON.stringify(raw),
    requested_at:raw.collectedAt,completed_at:raw.collectedAt,updated_at:raw.collectedAt};
}
function database(){
  const raw=new DatabaseSync(':memory:');
  raw.exec('CREATE TABLE ois_data_requests(id TEXT PRIMARY KEY,request_type TEXT,target_date TEXT,status TEXT,result_json TEXT,error_message TEXT,requested_at TEXT,completed_at TEXT,updated_at TEXT);');
  return {raw,beforeBatch:null,prepare(sql){return {values:[],bind(...values){this.values=values;return this;},
    async first(){return raw.prepare(sql).get(...this.values)||null;},
    async all(){return {results:raw.prepare(sql).all(...this.values)};},
    async run(){return {meta:{changes:Number(raw.prepare(sql).run(...this.values).changes)}};}};},
    async batch(statements){
      if(this.beforeBatch){const callback=this.beforeBatch;this.beforeBatch=null;callback();}
      raw.exec('BEGIN IMMEDIATE');
      try{const results=[];for(const statement of statements)results.push(await statement.run());raw.exec('COMMIT');return results;}
      catch(error){raw.exec('ROLLBACK');throw error;}
    },close(){raw.close();}};
}
function saveSource(db,raw,id='source'){
  const row=requestRow(raw,id);
  db.raw.prepare('INSERT INTO ois_data_requests VALUES(?,?,?,?,?,?,?,?,?)')
    .run(id,'bed_ash_level',DAY,'complete',row.result_json,'',row.requested_at,row.completed_at,row.updated_at);
  return row;
}
async function getRange(db){
  const response=await api.handleRangeGet({env:{DB:db}},new URL(`https://fixture.invalid/api/bed-ash-discharge?startDate=${DAY}&endDate=${DAY}`));
  const payload=await response.json();assert.equal(response.status,200,JSON.stringify(payload));return payload.data;
}
const reviewer={employeeNo:'synthetic-operator',name:'Synthetic Operator'};
function reviewBody(event){return {action:'review',eventKey:event.eventKey,revision:event.revision,status:'confirmed',
  confirmedAt:event.endAt,confirmedTon:event.estimatedTon,note:'synthetic review'};}
function seedLegacyDecision(db,{key,unitNo,status,startMinute,endMinute,amount}){
  const at=iso(START+(endMinute+2)*MINUTE);
  db.raw.prepare(`INSERT INTO bed_ash_discharge_events(
    event_key,algorithm_version,unit_no,tag_number,event_start_at,event_end_at,threshold_crossed_at,
    start_level_ton,end_level_ton,estimated_ton,confidence,evidence_fingerprint,close_reason,status,
    confirmed_at,confirmed_ton,note,reviewed_by_id,reviewed_by_name,reviewed_at,revision,candidate_active,
    review_ready,first_detected_at,last_detected_at,updated_at,source_kind,sample_interval_seconds,detection_closed_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(key,'bed-ash-drop-minute-v1',unitNo,unitNo===1?'104HDC01CW101XQ01':'204HDC01CW101XQ01',
      iso(START+startMinute*MINUTE+17000),iso(START+endMinute*MINUTE+17000),iso(START+(startMinute+1)*MINUTE+17000),
      30,30-amount,amount,'high',key+'-original-evidence','stable',status,
      status==='confirmed'?at:null,status==='confirmed'?amount:null,key+' original note',reviewer.employeeNo,reviewer.name,at,
      4,1,1,at,at,at,SOURCE,60,at);
  db.raw.prepare('INSERT INTO bed_ash_discharge_review_history VALUES(?,?,?,?,?,?,?,?,?)')
    .run(key+'-history',key,4,'pending',status,JSON.stringify({confirmedTon:status==='confirmed'?amount:null,
      note:key+' original note'}),reviewer.employeeNo,reviewer.name,at);
}
function savedState(db){return JSON.stringify({events:db.raw.prepare('SELECT * FROM bed_ash_discharge_events ORDER BY event_key').all(),
  history:db.raw.prepare('SELECT * FROM bed_ash_discharge_review_history ORDER BY history_id').all()});}

test('actual GET derives gap metadata and review POST rejects a bridged candidate even if a stored readiness flag is forced',async t=>{
  const db=database();t.after(()=>db.close());await api.ensureSchema(db);
  const raw=packet({level:(unit,minute)=>unit===1?(minute<421?30:minute===421?27:23):40,
    missingRows:new Map([['1:422','No Data, Bad']])});saveSource(db,raw);
  const data=await getRange(db);assert.equal(data.events.length,1);assert.deepEqual(data.minorObservations,[]);
  const event=data.events[0];assert.equal(event.algorithmVersion,VERSION);assert.equal(event.hasSourceGaps,true);
  assert.equal(event.sourceGapCount,1);assert.equal(event.confidence,'low');assert.equal(event.reviewReady,false);
  assert.equal(data.summary.confirmedCount,0);assert.equal(data.summary.confirmedTon,0);
  const schema=db.raw.prepare('PRAGMA table_info(bed_ash_discharge_events)').all().map(column=>column.name);
  assert.equal(schema.includes('has_source_gaps'),false);assert.equal(schema.includes('source_gap_count'),false);
  db.raw.prepare('UPDATE bed_ash_discharge_events SET review_ready=1 WHERE event_key=?').run(event.eventKey);
  const response=await api.handleReviewPost({env:{DB:db}},reviewBody(event),reviewer);
  assert.equal(response.status,409);assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM bed_ash_discharge_review_history').get().n,0);
  const stored=db.raw.prepare('SELECT status,confirmed_ton,review_ready FROM bed_ash_discharge_events WHERE event_key=?').get(event.eventKey);
  assert.equal(stored.status,'pending');assert.equal(stored.confirmed_ton,null);assert.equal(stored.review_ready,0);
});

test('actual GET and review POST still permit a continuous minute v2 candidate with append-only history',async t=>{
  const db=database();t.after(()=>db.close());await api.ensureSchema(db);
  saveSource(db,packet({level:(unit,minute)=>unit===1?(minute<421?30:23):40}));
  const data=await getRange(db);assert.equal(data.events.length,1);const event=data.events[0];
  assert.equal(event.algorithmVersion,VERSION);assert.equal(event.hasSourceGaps,false);assert.equal(event.sourceGapCount,0);
  assert.equal(event.reviewReady,true);const response=await api.handleReviewPost({env:{DB:db}},reviewBody(event),reviewer);
  assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM bed_ash_discharge_review_history').get().n,1);
  const original=savedState(db);await getRange(db);assert.equal(savedState(db),original);
});

test('v1 confirmed and excluded manual decisions survive overlapping v2 detection without duplicate candidates or history changes',async t=>{
  const db=database();t.after(()=>db.close());await api.ensureSchema(db);
  seedLegacyDecision(db,{key:'legacy-confirmed',unitNo:1,status:'confirmed',startMinute:420,endMinute:430,amount:13.7});
  seedLegacyDecision(db,{key:'legacy-excluded',unitNo:2,status:'excluded',startMinute:480,endMinute:490,amount:8.4});
  const original=savedState(db);
  const raw=packet({end:500,level:(unit,minute)=>unit===1?(minute<421?30:minute===421?27:23):(minute<481?40:32),
    missingRows:new Map([['1:422','No Data, Bad']])});saveSource(db,raw);
  const data=await getRange(db);assert.equal(savedState(db),original);
  assert.equal(data.events.length,2);assert.deepEqual(new Set(data.events.map(event=>event.eventKey)),new Set(['legacy-confirmed','legacy-excluded']));
  assert.ok(data.events.every(event=>event.algorithmVersion==='bed-ash-drop-minute-v1'));
  assert.equal(data.events.find(event=>event.eventKey==='legacy-confirmed').confirmedTon,13.7);
  assert.equal(data.summary.confirmedTon,13.7);assert.equal(data.summary.confirmedCount,1);
  const response=await api.handleReviewPost({env:{DB:db}},reviewBody(data.events[0]),reviewer);
  assert.equal(response.status,409);assert.equal(savedState(db),original);
});

test('GET caps minor observations at 128, reports the omitted count and never persists or totals them',async t=>{
  const db=database();t.after(()=>db.close());await api.ensureSchema(db);
  saveSource(db,packet({end:1440,level:(unit,minute)=>unit===1?[30,28,28,28,30][minute%5]:40}));
  const data=await getRange(db);assert.deepEqual(data.events,[]);assert.equal(data.minorObservations.length,128);
  assert.equal(data.minorObservationsOmitted,160);assert.equal(data.minorObservations.length+data.minorObservationsOmitted,288);
  assert.equal(data.summary.confirmedCount,0);assert.equal(data.summary.confirmedTon,0);assert.equal(data.summary.pendingCount,0);
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM bed_ash_discharge_events').get().n,0);
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM bed_ash_discharge_review_history').get().n,0);
  for(const item of data.minorObservations){assert.equal(item.reviewReady,false);
    for(const key of ['eventKey','status','confirmedTon','revision'])assert.equal(Object.hasOwn(item,key),false,key);}
  const repeated=await getRange(db);assert.deepEqual(repeated.minorObservations,data.minorObservations);
  assert.equal(repeated.minorObservationsOmitted,data.minorObservationsOmitted);
});

test('GET discards stale minor metadata and synchronizes only the replacement source after a snapshot change',async t=>{
  const db=database();t.after(()=>db.close());await api.ensureSchema(db);
  const old=packet({level:(unit,minute)=>unit===1?(minute<421?30:27):40});saveSource(db,old);
  const replacement=packet({level:(unit,minute)=>unit===1?(minute<421?30:24):40});
  let replacements=0;db.beforeBatch=()=>{replacements++;
    db.raw.prepare('UPDATE ois_data_requests SET result_json=?,updated_at=? WHERE id=?')
      .run(JSON.stringify(replacement),iso(Date.parse(old.collectedAt)+MINUTE),'source');};
  const data=await getRange(db);assert.equal(replacements,1);assert.deepEqual(data.minorObservations,[]);
  assert.equal(data.minorObservationsOmitted,0);assert.equal(data.events.length,1);assert.equal(data.events[0].estimatedTon,6);
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM bed_ash_discharge_events').get().n,1);
  assert.equal(db.raw.prepare('SELECT estimated_ton FROM bed_ash_discharge_events').get().estimated_ton,6);
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM bed_ash_discharge_review_history').get().n,0);
});
