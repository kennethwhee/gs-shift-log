import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import contract from '../efficiency/bed-ash-minute-contract.js';
import {__bedAshTest as api} from '../functions/api/bed-ash-discharge.js';

const MINUTE=60000,DAY='2026-08-01',START=Date.parse(DAY+'T00:00:00+09:00');
const iso=ms=>new Date(ms+9*3600000).toISOString().slice(0,19)+'+09:00';
const point=(unitNo,minute,levelTon,start=START)=>({unitNo,bucketAt:iso(start+minute*MINUTE),sampledAt:iso(start+minute*MINUTE+5000),returnedAt:iso(start+minute*MINUTE+5000),quality:'Raw, Good',levelTon,sourceDate:iso(start+minute*MINUTE).slice(0,10),sampleIntervalSeconds:60,sourceKind:'dataparc_bed_ash_minute'});
function packet({date=DAY,end=440,level=(unit,m)=>30,missing=[]}={}){
  const start=Date.parse(date+'T00:00:00+09:00');
  return {schemaVersion:2,sourceKind:'dataparc_bed_ash_minute',sampleIntervalSeconds:60,targetDate:date,
    intervalStart:iso(start),intervalEnd:iso(start+end*MINUTE),collectedAt:new Date(start+(end+6)*MINUTE).toISOString(),
    units:contract.UNIT_DEFINITIONS.map(def=>({...def,samples:Array.from({length:end+1},(_,m)=>({
      sampledAt:iso(start+m*MINUTE),returnedAt:iso(start+m*MINUTE+5000),quality:missing.includes(`${def.unitNo}:${m}`)?'Bad':'Raw, Good',
      levelTon:missing.includes(`${def.unitNo}:${m}`)?null:level(def.unitNo,m)}))}))};
}
function row(raw,id='source-1'){
  return {id,target_date:raw.targetDate,status:'complete',result_json:JSON.stringify(raw),requested_at:raw.collectedAt,completed_at:raw.collectedAt,updated_at:raw.collectedAt};
}
function normalized(raw,id){return api.normalizeCompletedRequestSamples(row(raw,id),Date.parse(raw.collectedAt)+MINUTE);}
const runLevel=(unit,m)=>unit===2?50:m<424?30:m===424?27:m<430?23:m===430?30:m===431?26:20;
function database(){
  const raw=new DatabaseSync(':memory:');
  raw.exec(`CREATE TABLE ois_data_requests(id TEXT PRIMARY KEY,request_type TEXT,target_date TEXT,status TEXT,result_json TEXT,error_message TEXT,requested_at TEXT,completed_at TEXT,updated_at TEXT);`);
  return {raw,prepare(sql){return {values:[],bind(...values){this.values=values;return this;},async first(){return raw.prepare(sql).get(...this.values)||null;},async all(){return {results:raw.prepare(sql).all(...this.values)};},async run(){return {meta:{changes:Number(raw.prepare(sql).run(...this.values).changes)}};}};},async batch(statements){raw.exec('BEGIN IMMEDIATE');try{const result=[];for(const stmt of statements)result.push(await stmt.run());raw.exec('COMMIT');return result;}catch(e){raw.exec('ROLLBACK');throw e;}},close(){raw.close();}};
}
function saveSource(db,raw,id='source-1'){
  const item=row(raw,id);db.raw.prepare('INSERT INTO ois_data_requests VALUES(?,?,?,?,?,?,?,?,?)').run(id,'bed_ash_level',item.target_date,item.status,item.result_json,'',item.requested_at,item.completed_at,item.updated_at);return item;
}
async function persist(db,events){await api.synchronizeDetectedEvents(db,iso(START),iso(START+86400000),events,[],[]);}


async function reviewedFixture(status='confirmed'){
  const db=database();await api.ensureSchema(db);
  const legacy={eventKey:'hourly-reviewed-aggregate',algorithmVersion:'bed-ash-drop-v2',unitNo:1,tagNumber:'104HDC01CW101XQ01',
    startAt:DAY+'T07:00:00+09:00',endAt:DAY+'T09:00:00+09:00',thresholdCrossedAt:DAY+'T08:00:00+09:00',
    startLevelTon:50,endLevelTon:28.6,estimatedTon:21.4,confidence:'high',closeReason:'stable',reviewReady:true,
    evidenceFingerprint:'hourly-original-fingerprint',sourceKind:'ois_bed_ash_hourly',sampleIntervalSeconds:3600};
  await persist(db,[legacy]);
  db.raw.prepare("UPDATE bed_ash_discharge_events SET status=?,confirmed_at=?,confirmed_ton=?,note='saved historical decision',reviewed_by_id='operator',reviewed_by_name='Operator',reviewed_at=?,revision=2 WHERE event_key=?")
    .run(status,status==='confirmed'?DAY+'T08:30:00+09:00':null,status==='confirmed'?21.4:null,DAY+'T09:00:00+09:00',legacy.eventKey);
  db.raw.prepare('INSERT INTO bed_ash_discharge_review_history VALUES(?,?,?,?,?,?,?,?,?)').run('history-original',legacy.eventKey,2,'pending',status,JSON.stringify({status,confirmedTon:status==='confirmed'?21.4:null,note:'original'}),'operator','Operator',DAY+'T09:00:00+09:00');
  const before=()=>JSON.stringify({row:db.raw.prepare('SELECT * FROM bed_ash_discharge_events WHERE event_key=?').get(legacy.eventKey),history:db.raw.prepare('SELECT * FROM bed_ash_discharge_review_history').all()});
  return {db,legacy,before,original:before()};
}
async function getRange(db){
  const response=await api.handleRangeGet({env:{DB:db}},new URL('https://fixture.invalid/api/bed-ash-discharge?startDate='+DAY+'&endDate='+DAY));
  assert.equal(response.status,200,JSON.stringify(await response.clone().json()));return (await response.json()).data;
}
const allowed=['eventKey','unitNo','startAt','endAt','startLevelTon','endLevelTon','estimatedTon','sourceKind','sampleIntervalSeconds','overlapOtherUnit','reviewReady','relatedReviewedEventKeys','sharedReviewedEvidence'].sort();

test('GET adds separate read-only minute observations to a confirmed hourly aggregate without changing its amount, identity or history',async t=>{
  const fixture=await reviewedFixture();t.after(()=>fixture.db.close());saveSource(fixture.db,packet({level:runLevel}));
  const data=await getRange(fixture.db);assert.equal(data.events.length,1);const event=data.events[0];
  assert.equal(event.eventKey,fixture.legacy.eventKey);assert.equal(event.sourceKind,'ois_bed_ash_hourly');assert.equal(event.sampleIntervalSeconds,3600);
  assert.equal(event.startAt,fixture.legacy.startAt);assert.equal(event.endAt,fixture.legacy.endAt);assert.equal(event.status,'confirmed');assert.equal(event.confirmedTon,21.4);assert.equal(event.evidenceFingerprint,'hourly-original-fingerprint');
  assert.equal(event.minuteObservations.length,2);assert.deepEqual(event.minuteObservations.map(item=>item.estimatedTon),[7,10]);
  assert.equal(event.minuteObservations[0].startAt,DAY+'T07:03:05+09:00');assert.equal(event.minuteObservations[0].endAt,DAY+'T07:05:05+09:00');
  assert.equal(event.minuteObservations[1].startAt,DAY+'T07:10:05+09:00');assert.equal(event.minuteObservations[1].endAt,DAY+'T07:12:05+09:00');
  for(const item of event.minuteObservations){assert.deepEqual(Object.keys(item).sort(),allowed);assert.equal(item.sourceKind,'dataparc_bed_ash_minute');assert.equal(item.sampleIntervalSeconds,60);assert.equal(item.unitNo,1);assert.equal(item.reviewReady,true);assert.deepEqual(item.relatedReviewedEventKeys,[event.eventKey]);assert.equal(item.sharedReviewedEvidence,false);assert.equal(Object.hasOwn(item,'confirmedTon'),false);}
  assert.equal(data.summary.confirmedCount,1);assert.equal(data.summary.confirmedTon,21.4);assert.equal(data.summary.pendingCount,0);
  assert.equal(fixture.before(),fixture.original);assert.equal(fixture.db.raw.prepare('SELECT COUNT(*) n FROM bed_ash_discharge_events').get().n,1);
  assert.equal(fixture.db.raw.prepare('SELECT COUNT(*) n FROM bed_ash_discharge_review_history').get().n,1);
  const repeated=await getRange(fixture.db);assert.deepEqual(repeated.events[0].minuteObservations,event.minuteObservations);assert.equal(fixture.before(),fixture.original);
});

test('excluded hourly decisions retain their stored fields while displaying fresh minute evidence without adding totals',async t=>{
  const fixture=await reviewedFixture('excluded');t.after(()=>fixture.db.close());saveSource(fixture.db,packet({level:runLevel}));
  const data=await getRange(fixture.db),event=data.events[0];assert.equal(event.status,'excluded');assert.equal(event.confirmedTon,null);assert.equal(event.minuteObservations.length,2);assert.equal(data.summary.confirmedTon,0);assert.equal(data.summary.confirmedCount,0);assert.equal(data.summary.pendingCount,0);assert.equal(fixture.before(),fixture.original);
});

test('newer pending or failed sources do not advertise previous minute observations as freshly eligible',async t=>{
  for(const status of ['pending','failed']){
    const fixture=await reviewedFixture();t.after(()=>fixture.db.close());const fine=packet({level:runLevel});saveSource(fixture.db,fine,'old-minute');
    const later=new Date(Date.parse(fine.collectedAt)+2*MINUTE).toISOString();fixture.db.raw.prepare('INSERT INTO ois_data_requests VALUES(?,?,?,?,?,?,?,?,?)').run('new-'+status,'bed_ash_level',DAY,status,null,'newer source unavailable',later,null,later);
    const data=await getRange(fixture.db),event=data.events[0];assert.equal(event.status,'confirmed');assert.equal(event.confirmedTon,21.4);assert.deepEqual(event.minuteObservations,[]);assert.equal(fixture.before(),fixture.original);assert.equal(fixture.db.raw.prepare('SELECT COUNT(*) n FROM bed_ash_discharge_events').get().n,1);
  }
});

test('only same-unit, strictly overlapping eligible minute observations are attached and their field set is allowlisted',()=>{
  const event={eventKey:'old',unitNo:1,status:'confirmed',sampleIntervalSeconds:3600,sourceKind:'ois_bed_ash_hourly',startAt:DAY+'T07:00:00+09:00',endAt:DAY+'T08:00:00+09:00',confirmedTon:21.4};
  const candidate={eventKey:'new',unitNo:1,startAt:DAY+'T07:30:05+09:00',endAt:DAY+'T07:35:05+09:00',startLevelTon:30,endLevelTon:23,estimatedTon:7,sourceKind:'dataparc_bed_ash_minute',sampleIntervalSeconds:60,overlapOtherUnit:true,reviewReady:true,confirmedTon:12345,note:'unrequested source field'};
  const [result]=api.attachReviewedMinuteObservations([event],[candidate,{...candidate,eventKey:'other-unit',unitNo:2},{...candidate,eventKey:'touching',startAt:event.endAt,endAt:DAY+'T08:03:00+09:00'},{...candidate,eventKey:'unsettled',reviewReady:false}]);
  assert.equal(result.minuteObservations.length,1);assert.deepEqual(Object.keys(result.minuteObservations[0]).sort(),allowed);assert.equal(result.minuteObservations[0].estimatedTon,7);assert.equal(result.minuteObservations[0].overlapOtherUnit,true);assert.equal(result.confirmedTon,21.4);assert.equal(Object.hasOwn(event,'minuteObservations'),false);
  assert.equal(api.attachReviewedMinuteObservations([{...event,status:'pending'}],[candidate])[0].minuteObservations,undefined);
  assert.equal(api.attachReviewedMinuteObservations([{...event,sampleIntervalSeconds:60,sourceKind:'dataparc_bed_ash_minute'}],[candidate])[0].minuteObservations,undefined);
});


test('one minute observation overlapping several reviewed hourly records is explicitly shared without allocating its amount',async t=>{
  const fixture=await reviewedFixture();t.after(()=>fixture.db.close());
  const second={...fixture.db.raw.prepare('SELECT * FROM bed_ash_discharge_events WHERE event_key=?').get(fixture.legacy.eventKey),event_key:'hourly-second-reviewed',event_start_at:DAY+'T07:04:00+09:00',confirmed_ton:9.4,note:'second historical decision'};
  const names=Object.keys(second);fixture.db.raw.prepare(`INSERT INTO bed_ash_discharge_events(${names.join(',')}) VALUES(${names.map(()=>'?').join(',')})`).run(...names.map(name=>second[name]));
  fixture.db.raw.prepare('INSERT INTO bed_ash_discharge_review_history VALUES(?,?,?,?,?,?,?,?,?)').run('history-second',second.event_key,2,'pending','confirmed',JSON.stringify({confirmedTon:9.4,note:'second original'}),'operator','Operator',DAY+'T09:01:00+09:00');
  const before=JSON.stringify({rows:fixture.db.raw.prepare('SELECT * FROM bed_ash_discharge_events ORDER BY event_key').all(),history:fixture.db.raw.prepare('SELECT * FROM bed_ash_discharge_review_history ORDER BY history_id').all()});
  saveSource(fixture.db,packet({level:runLevel}));const data=await getRange(fixture.db);assert.equal(data.events.length,2);
  const first=data.events.find(event=>event.eventKey===fixture.legacy.eventKey),other=data.events.find(event=>event.eventKey===second.event_key);
  const sharedFirst=first.minuteObservations.find(observation=>observation.startAt===DAY+'T07:03:05+09:00'),sharedOther=other.minuteObservations.find(observation=>observation.eventKey===sharedFirst.eventKey);
  assert.ok(sharedOther);assert.equal(sharedFirst.sharedReviewedEvidence,true);assert.equal(sharedOther.sharedReviewedEvidence,true);assert.deepEqual(sharedFirst.relatedReviewedEventKeys,[fixture.legacy.eventKey,second.event_key].sort());assert.deepEqual(sharedOther.relatedReviewedEventKeys,sharedFirst.relatedReviewedEventKeys);
  assert.equal(sharedFirst.estimatedTon,7);assert.equal(sharedOther.estimatedTon,7);assert.equal(Object.hasOwn(sharedFirst,'confirmedTon'),false);assert.equal(first.confirmedTon,21.4);assert.equal(other.confirmedTon,9.4);assert.equal(data.summary.confirmedCount,2);assert.equal(data.summary.confirmedTon,30.8);assert.equal(data.summary.pendingCount,0);
  assert.equal(JSON.stringify({rows:fixture.db.raw.prepare('SELECT * FROM bed_ash_discharge_events ORDER BY event_key').all(),history:fixture.db.raw.prepare('SELECT * FROM bed_ash_discharge_review_history ORDER BY history_id').all()}),before);
});

test('bounded monthly evidence linking preserves parent totals and shared links without mutating inputs',t=>{
  const parents=[],observations=[];
  for(let day=0;day<31;day++)for(let unitNo=1;unitNo<=2;unitNo++){
    const dayStart=START+day*86400000;
    // Sixteen overlapping historical windows per unit/day, and 96 newer runs.
    for(let window=0;window<16;window++)parents.push({eventKey:`parent-${day}-${unitNo}-${window}`,unitNo,status:'confirmed',sourceKind:'ois_bed_ash_hourly',sampleIntervalSeconds:3600,startAt:iso(dayStart+window*90*MINUTE),endAt:iso(dayStart+(window*90+120)*MINUTE),confirmedTon:10.7,evidenceFingerprint:`original-${day}-${unitNo}-${window}`});
    for(let run=0;run<96;run++)observations.push({eventKey:`minute-${day}-${unitNo}-${run}`,unitNo,startAt:iso(dayStart+(run*15+5)*MINUTE),endAt:iso(dayStart+(run*15+7)*MINUTE),startLevelTon:30,endLevelTon:23,estimatedTon:7,sourceKind:'dataparc_bed_ash_minute',sampleIntervalSeconds:60,overlapOtherUnit:false,reviewReady:true});
  }
  const before=JSON.stringify({parents,observations}),began=performance.now(),result=api.attachReviewedMinuteObservations(parents,observations),elapsed=performance.now()-began;
  assert.equal(parents.length,992);assert.equal(observations.length,5952);assert.equal(result.length,parents.length);assert.equal(JSON.stringify({parents,observations}),before);
  assert.deepEqual(api.buildSummary(result),api.buildSummary(parents));
  let shared=0;
  for(let i=0;i<result.length;i++){
    const {minuteObservations,...originalFields}=result[i];assert.deepEqual(originalFields,parents[i]);assert.ok(minuteObservations.length);
    for(const observation of minuteObservations){assert.equal(observation.estimatedTon,7);assert.equal(Object.hasOwn(observation,'confirmedTon'),false);assert.ok(observation.relatedReviewedEventKeys.includes(result[i].eventKey));assert.equal(observation.sharedReviewedEvidence,observation.relatedReviewedEventKeys.length>1);if(observation.sharedReviewedEvidence)shared++;}
  }
  assert.ok(shared>0);t.diagnostic(`Linked ${parents.length} reviewed records with ${observations.length} minute observations in ${elapsed.toFixed(1)} ms.`);
});
