import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import contract from '../efficiency/bed-ash-minute-contract.js';
import {__bedAshTest as api} from '../functions/api/bed-ash-discharge.js';

// Synthetic upgrade fixtures; no plant packet or operator identity is retained.
const DAY='2026-08-01',START=Date.parse(DAY+'T00:00:00+09:00'),MINUTE=60000;
const SOURCE='dataparc_bed_ash_minute',LEGACY='bed-ash-drop-minute-v1',CURRENT='bed-ash-drop-minute-v3';
const iso=minute=>new Date(START+minute*MINUTE+32400000).toISOString().slice(0,19)+'+09:00';
const actual=minute=>iso(minute).replace(':00+09:00',':17+09:00');

function database(){
  const raw=new DatabaseSync(':memory:');
  raw.exec('CREATE TABLE ois_data_requests(id TEXT PRIMARY KEY,request_type TEXT,target_date TEXT,status TEXT,result_json TEXT,error_message TEXT,requested_at TEXT,completed_at TEXT,updated_at TEXT);');
  return {raw,prepare(sql){return {values:[],bind(...values){this.values=values;return this;},
    async first(){return raw.prepare(sql).get(...this.values)||null;},
    async all(){return {results:raw.prepare(sql).all(...this.values)};},
    async run(){return {meta:{changes:Number(raw.prepare(sql).run(...this.values).changes)}};}};},
    async batch(statements){raw.exec('BEGIN IMMEDIATE');try{const results=[];for(const statement of statements)results.push(await statement.run());raw.exec('COMMIT');return results;}
      catch(error){raw.exec('ROLLBACK');throw error;}},close(){raw.close();}};
}
function seedLegacy(db,{key,status='confirmed',start=420,end=424,amount=6,unit=1}){
  const at=actual(end+2);
  db.raw.prepare(`INSERT INTO bed_ash_discharge_events(
    event_key,algorithm_version,unit_no,tag_number,event_start_at,event_end_at,threshold_crossed_at,
    start_level_ton,end_level_ton,estimated_ton,confidence,evidence_fingerprint,close_reason,status,
    confirmed_at,confirmed_ton,note,reviewed_by_id,reviewed_by_name,reviewed_at,revision,candidate_active,
    review_ready,first_detected_at,last_detected_at,updated_at,source_kind,sample_interval_seconds,detection_closed_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(key,LEGACY,unit,unit===1?'104HDC01CW101XQ01':'204HDC01CW101XQ01',actual(start),actual(end),actual(start+1),
      30,30-amount,amount,'high',key+'-original','stable',status,status==='confirmed'?at:null,status==='confirmed'?amount:null,
      key+' note','synthetic-operator','Synthetic Operator',at,4,1,1,at,at,at,SOURCE,60,at);
  if(status!=='pending')db.raw.prepare('INSERT INTO bed_ash_discharge_review_history VALUES(?,?,?,?,?,?,?,?,?)')
    .run(key+'-history',key,4,'pending',status,JSON.stringify({confirmedTon:status==='confirmed'?amount:null}),
      'synthetic-operator','Synthetic Operator',at);
}
function saveSource(db,{status='complete',id='source',gap=true,end=440}={}){
  const raw={schemaVersion:2,sourceKind:SOURCE,sampleIntervalSeconds:60,targetDate:DAY,
    intervalStart:iso(0),intervalEnd:iso(end),collectedAt:iso(end+6),
    units:contract.UNIT_DEFINITIONS.map(definition=>({...definition,samples:Array.from({length:end+1},(_,minute)=>{
      const absent=gap&&definition.unitNo===1&&minute===422;
      const level=definition.unitNo===2?40:minute<=420?30:minute===421?27:minute===422?25:minute===423?23:minute===424?21:19;
      return {sampledAt:iso(minute),returnedAt:absent?null:actual(minute),quality:absent?'No Data, Bad':'Raw, Good',levelTon:absent?null:level};
    })}))};
  db.raw.prepare('INSERT INTO ois_data_requests VALUES(?,?,?,?,?,?,?,?,?)')
    .run(id,'bed_ash_level',DAY,status,status==='complete'?JSON.stringify(raw):null,'',iso(end+6),status==='complete'?iso(end+6):null,iso(end+6));
}
const stored=db=>JSON.stringify({events:db.raw.prepare('SELECT * FROM bed_ash_discharge_events ORDER BY event_key').all(),
  history:db.raw.prepare('SELECT * FROM bed_ash_discharge_review_history ORDER BY history_id').all()});
async function getRange(db){
  const response=await api.handleRangeGet({env:{DB:db}},new URL(`https://fixture.invalid/api/bed-ash-discharge?startDate=${DAY}&endDate=${DAY}`));
  const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));return body.data;
}
const parent={eventKey:'legacy-reviewed',algorithmVersion:LEGACY,unitNo:1,status:'confirmed',sourceKind:SOURCE,
  sampleIntervalSeconds:60,startAt:actual(420),endAt:actual(424),confirmedTon:6};
const observation={eventKey:'current-observation',algorithmVersion:CURRENT,unitNo:1,sourceKind:SOURCE,sampleIntervalSeconds:60,
  startAt:actual(420),endAt:actual(425),startLevelTon:30,endLevelTon:19,estimatedTon:11,
  closeReason:'data_gap',sourceSettled:true,reviewReady:false,hasSourceGaps:true,sourceGapCount:1,confidence:'low'};

test('legacy minute decisions expose low-confidence extended evidence without changing saved fields or totals',async t=>{
  for(const status of ['confirmed','excluded']){
    const db=database();t.after(()=>db.close());await api.ensureSchema(db);
    seedLegacy(db,{key:'legacy-'+status,status});const original=stored(db);saveSource(db);
    const data=await getRange(db);assert.equal(data.events.length,1);const event=data.events[0];
    assert.equal(event.eventKey,'legacy-'+status);assert.equal(event.algorithmVersion,LEGACY);
    assert.equal(event.endAt,actual(424));assert.equal(event.status,status);assert.equal(stored(db),original);
    assert.equal(event.minuteObservations.length,1);const evidence=event.minuteObservations[0];
    assert.equal(evidence.startAt,actual(420));assert.equal(evidence.endAt,actual(425));assert.equal(evidence.estimatedTon,11);
    assert.equal(evidence.hasSourceGaps,true);assert.equal(evidence.sourceGapCount,1);assert.equal(evidence.confidence,'low');
    assert.equal(evidence.reviewReady,false);assert.equal(Object.hasOwn(evidence,'confirmedTon'),false);
    assert.equal(data.summary.confirmedTon,status==='confirmed'?6:0);assert.equal(data.summary.pendingCount,0);
    assert.deepEqual((await getRange(db)).events[0].minuteObservations,event.minuteObservations);assert.equal(stored(db),original);
  }
});

test('a merged current observation is shared by two saved v1 decisions with no amount allocation or duplicate candidate',async t=>{
  const db=database();t.after(()=>db.close());await api.ensureSchema(db);
  seedLegacy(db,{key:'first',start:420,end:423,amount:7});
  seedLegacy(db,{key:'second',start:423,end:425,amount:4});const original=stored(db);saveSource(db);
  const data=await getRange(db);assert.equal(data.events.length,2);assert.equal(stored(db),original);
  for(const event of data.events){assert.equal(event.minuteObservations.length,1);const evidence=event.minuteObservations[0];
    assert.equal(evidence.sharedReviewedEvidence,true);assert.deepEqual(evidence.relatedReviewedEventKeys,['first','second']);
    assert.equal(evidence.estimatedTon,11);assert.equal(Object.hasOwn(evidence,'confirmedTon'),false);}
  assert.equal(data.summary.confirmedCount,2);assert.equal(data.summary.confirmedTon,11);assert.equal(data.summary.pendingCount,0);
});

test('settled terminal gap evidence is read-only and eligible while stale sources cannot attach to saved v1 records',()=>{
  const original=structuredClone(parent);
  const [result]=api.attachReviewedMinuteObservations([parent],[observation]);
  assert.equal(result.minuteObservations.length,1);assert.equal(result.minuteObservations[0].reviewReady,false);
  assert.equal(result.minuteObservations[0].confidence,'low');assert.deepEqual(parent,original);
  assert.deepEqual(api.attachReviewedMinuteObservations([parent],[{...observation,sourceSettled:false}])[0].minuteObservations,[]);
  assert.deepEqual(api.attachReviewedMinuteObservations([parent],[{...observation,unitNo:2}])[0].minuteObservations,[]);
  assert.deepEqual(api.attachReviewedMinuteObservations([parent],[{...observation,startAt:parent.endAt}])[0].minuteObservations,[]);
});

test('a newer pending or failed source suppresses stale attached evidence but keeps legacy decisions',async t=>{
  for(const status of ['pending','failed']){
    const db=database();t.after(()=>db.close());await api.ensureSchema(db);seedLegacy(db,{key:'legacy'});
    const original=stored(db);saveSource(db);saveSource(db,{status,id:'newer',end:450});
    const data=await getRange(db);assert.equal(data.events.length,1);assert.deepEqual(data.events[0].minuteObservations,[]);
    assert.equal(data.summary.confirmedTon,6);assert.equal(stored(db),original);
  }
});

test('pending v1 candidates retire in favor of one current candidate without mutating stored review history',async t=>{
  const db=database();t.after(()=>db.close());await api.ensureSchema(db);seedLegacy(db,{key:'legacy-pending',status:'pending'});
  saveSource(db,{gap:false});const data=await getRange(db);assert.equal(data.events.length,1);
  assert.equal(data.events[0].algorithmVersion,CURRENT);assert.equal(data.events[0].reviewReady,true);
  const old=db.raw.prepare('SELECT status,candidate_active,review_ready,revision FROM bed_ash_discharge_events WHERE event_key=?').get('legacy-pending');
  assert.deepEqual({...old},{status:'pending',candidate_active:0,review_ready:0,revision:4});
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM bed_ash_discharge_review_history').get().n,0);
  const repeated=await getRange(db);assert.equal(repeated.events.length,1);assert.equal(repeated.events[0].eventKey,data.events[0].eventKey);
});

test('reviewed current minute parents are not relabeled as upgraded legacy evidence',()=>{
  const current={...parent,algorithmVersion:CURRENT};
  assert.equal(api.attachReviewedMinuteObservations([current],[observation])[0],current);
  const pending={...parent,status:'pending'};assert.equal(api.attachReviewedMinuteObservations([pending],[observation])[0],pending);
});
