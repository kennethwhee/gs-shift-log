import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import contract from '../efficiency/bed-ash-minute-contract.js';
import {__bedAshTest as api} from '../functions/api/bed-ash-discharge.js';

// Synthetic saved data reproduces an 11.44 t decline, a six-minute pause,
// and a 3.10 t continuation. No plant packet or operator identity is retained.
const DAY='2026-08-01',START=Date.parse(DAY+'T00:00:00+09:00'),MINUTE=60000;
const SOURCE='dataparc_bed_ash_minute',PREVIOUS='bed-ash-drop-minute-v2',CURRENT='bed-ash-drop-minute-v3';
const iso=minute=>new Date(START+minute*MINUTE+32400000).toISOString().slice(0,19)+'+09:00';
const actual=minute=>iso(minute).replace(':00+09:00',':17+09:00');

function database(){
  const raw=new DatabaseSync(':memory:');
  raw.exec('CREATE TABLE ois_data_requests(id TEXT PRIMARY KEY,request_type TEXT,target_date TEXT,status TEXT,result_json TEXT,error_message TEXT,requested_at TEXT,completed_at TEXT,updated_at TEXT);');
  return {raw,statements:[],beforeBatch:null,prepare(sql){this.statements.push(sql);return {values:[],bind(...values){this.values=values;return this;},
    async first(){return raw.prepare(sql).get(...this.values)||null;},
    async all(){return {results:raw.prepare(sql).all(...this.values)};},
    async run(){return {meta:{changes:Number(raw.prepare(sql).run(...this.values).changes)}};}};},
    async batch(statements){if(this.beforeBatch){const fn=this.beforeBatch;this.beforeBatch=null;fn();}
      raw.exec('BEGIN IMMEDIATE');try{const results=[];for(const statement of statements)results.push(await statement.run());raw.exec('COMMIT');return results;}
      catch(error){raw.exec('ROLLBACK');throw error;}},close(){raw.close();}};
}
function seedPrior(db,{key,status='pending',start=900,end=904,amount=11.44,confirmedTon=amount,version=PREVIOUS}={}){
  const at=actual(end+2);
  db.raw.prepare(`INSERT INTO bed_ash_discharge_events(
    event_key,algorithm_version,unit_no,tag_number,event_start_at,event_end_at,threshold_crossed_at,
    start_level_ton,end_level_ton,estimated_ton,confidence,evidence_fingerprint,close_reason,status,
    confirmed_at,confirmed_ton,note,reviewed_by_id,reviewed_by_name,reviewed_at,revision,candidate_active,
    review_ready,first_detected_at,last_detected_at,updated_at,source_kind,sample_interval_seconds,detection_closed_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(key,version,2,'204HDC01CW101XQ01',actual(start),actual(end),actual(start+1),
      30,30-amount,amount,'high',key+'-original','stable',status,status==='confirmed'?at:null,status==='confirmed'?confirmedTon:null,
      key+' original note','synthetic-operator','Synthetic Operator',at,4,1,1,at,at,at,SOURCE,60,at);
  if(status!=='pending')db.raw.prepare('INSERT INTO bed_ash_discharge_review_history VALUES(?,?,?,?,?,?,?,?,?)')
    .run(key+'-history',key,4,'pending',status,JSON.stringify({confirmedTon:status==='confirmed'?confirmedTon:null}),
      'synthetic-operator','Synthetic Operator',at);
}
function saveSource(db,{gap=false,slow=false,id='source',status='complete'}={}){
  const end=980;
  const raw={schemaVersion:2,sourceKind:SOURCE,sampleIntervalSeconds:60,targetDate:DAY,
    intervalStart:iso(0),intervalEnd:iso(end),collectedAt:iso(end+6),
    units:contract.UNIT_DEFINITIONS.map(definition=>({...definition,samples:Array.from({length:end+1},(_,minute)=>{
      const absent=gap&&definition.unitNo===2&&[906,907].includes(minute);
      const level=definition.unitNo===1?40:slow?(minute<900?30:30-Math.floor((Math.min(minute,950)-900)/10)*0.8)
        :minute<=900?30:minute===901?27:minute===902?24:minute===903?21:minute<=910?18.56:minute===911?17:15.46;
      return {sampledAt:iso(minute),returnedAt:absent?null:actual(minute),quality:absent?'No Data, Bad':'Raw, Good',levelTon:absent?null:level};
    })}))};
  db.raw.prepare('INSERT INTO ois_data_requests VALUES(?,?,?,?,?,?,?,?,?)')
    .run(id,'bed_ash_level',DAY,status,status==='complete'?JSON.stringify(raw):null,'',iso(end+6),status==='complete'?iso(end+6):null,iso(end+6));
  return raw;
}
const reviewedState=db=>JSON.stringify({events:db.raw.prepare("SELECT * FROM bed_ash_discharge_events WHERE status IN ('confirmed','excluded') ORDER BY event_key").all(),
  history:db.raw.prepare('SELECT * FROM bed_ash_discharge_review_history ORDER BY history_id').all()});
const sourceState=db=>JSON.stringify(db.raw.prepare('SELECT * FROM ois_data_requests ORDER BY id').all());
async function getRange(db){
  const response=await api.handleRangeGet({env:{DB:db}},new URL(`https://fixture.invalid/api/bed-ash-discharge?startDate=${DAY}&endDate=${DAY}`));
  const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));return body.data;
}
function noSourceWrites(db,original){
  assert.equal(sourceState(db),original);
  assert.ok(db.statements.every(sql=>!/(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+ois_data_requests\b/i.test(sql)),
    'ordinary saved-data GET must not create a DataPARC job or rewrite stored source packets');
}

test('ordinary GET retires the old pending 11.44 t fragment and creates one 14.54 t current candidate from saved sources',async t=>{
  const db=database();t.after(()=>db.close());await api.ensureSchema(db);
  seedPrior(db,{key:'prior-pending'});saveSource(db);const source=sourceState(db);
  const data=await getRange(db);assert.equal(data.events.length,1);const [event]=data.events;
  assert.equal(event.algorithmVersion,CURRENT);assert.equal(event.startAt,actual(900));assert.equal(event.endAt,actual(912));
  assert.equal(event.estimatedTon,14.54);assert.equal(event.reviewReady,true);assert.equal(event.status,'pending');
  assert.equal(event.isRapidDecline,true);
  assert.deepEqual(data.minorObservations,[]);assert.equal(data.summary.pendingCount,1);assert.equal(data.summary.pendingEstimatedTon,14.54);
  const old=db.raw.prepare('SELECT status,candidate_active,review_ready,revision,estimated_ton FROM bed_ash_discharge_events WHERE event_key=?').get('prior-pending');
  assert.deepEqual({...old},{status:'pending',candidate_active:0,review_ready:0,revision:4,estimated_ton:11.44});
  const repeated=await getRange(db);assert.equal(repeated.events.length,1);assert.equal(repeated.events[0].eventKey,event.eventKey);
  assert.equal(repeated.events[0].revision,event.revision);assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM bed_ash_discharge_review_history').get().n,0);
  noSourceWrites(db,source);
});

test('old minute summaries cannot offer stale v1 or v2 pending candidates for review before range recomputation',async t=>{
  const db=database();t.after(()=>db.close());await api.ensureSchema(db);
  for(const [key,version] of [['old-v1','bed-ash-drop-minute-v1'],['old-v2',PREVIOUS]])seedPrior(db,{key,version});
  const before=JSON.stringify(db.raw.prepare('SELECT * FROM bed_ash_discharge_events ORDER BY event_key').all());
  const response=await api.handleSummaryGet({env:{DB:db}});assert.equal(response.status,200);
  assert.deepEqual((await response.json()).data,{pendingCount:0,latestPending:null});
  assert.equal(JSON.stringify(db.raw.prepare('SELECT * FROM bed_ash_discharge_events ORDER BY event_key').all()),before);
});

for(const status of ['confirmed','excluded'])test(`merged evidence overlapping a v2 ${status} fragment preserves every stored decision field and revision`,async t=>{
  const db=database();t.after(()=>db.close());await api.ensureSchema(db);
  seedPrior(db,{key:'reviewed',status,confirmedTon:12.2});const original=reviewedState(db);saveSource(db);const source=sourceState(db);
  const data=await getRange(db);assert.equal(data.events.length,1);const [event]=data.events;
  assert.equal(event.algorithmVersion,PREVIOUS);assert.equal(event.endAt,actual(904));assert.equal(event.estimatedTon,11.44);
  assert.equal(event.status,status);assert.equal(event.revision,4);assert.equal(reviewedState(db),original);
  assert.equal(event.minuteObservations.length,1);const [merged]=event.minuteObservations;
  assert.equal(merged.estimatedTon,14.54);assert.equal(merged.endAt,actual(912));assert.equal(Object.hasOwn(merged,'confirmedTon'),false);
  assert.equal(event.isRapidDecline,false);assert.equal(merged.algorithmVersion,CURRENT);assert.equal(merged.isRapidDecline,true);
  assert.deepEqual(merged.relatedReviewedEventKeys,['reviewed']);assert.equal(data.summary.pendingCount,0);
  assert.equal(data.summary.confirmedTon,status==='confirmed'?12.2:0);
  assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM bed_ash_discharge_events WHERE status='pending' AND candidate_active=1").get().n,0);
  assert.deepEqual((await getRange(db)).events[0].minuteObservations,event.minuteObservations);
  assert.equal(reviewedState(db),original);noSourceWrites(db,source);
});

for(const statuses of [['confirmed','confirmed'],['confirmed','excluded'],['excluded','excluded']])test(`one shared merged observation does not duplicate candidates or allocate saved ${statuses.join('/')} quantities`,async t=>{
  const db=database();t.after(()=>db.close());await api.ensureSchema(db);
  seedPrior(db,{key:'first',status:statuses[0],confirmedTon:12.2});
  // A saved reviewed second fragment may come from an earlier manual review.
  seedPrior(db,{key:'second',status:statuses[1],start:910,end:912,amount:3.1,confirmedTon:3.7});
  const original=reviewedState(db);saveSource(db);const data=await getRange(db);
  assert.equal(data.events.length,2);assert.equal(reviewedState(db),original);
  const uniqueObservations=new Map();
  for(const event of data.events){
    assert.equal(event.minuteObservations.length,1);const [merged]=event.minuteObservations;
    assert.equal(merged.estimatedTon,14.54);assert.equal(merged.sharedReviewedEvidence,true);
    assert.deepEqual(merged.relatedReviewedEventKeys,['first','second']);assert.equal(Object.hasOwn(merged,'confirmedTon'),false);
    uniqueObservations.set(merged.eventKey,merged);
  }
  assert.equal(uniqueObservations.size,1);assert.equal(data.summary.pendingCount,0);assert.equal(data.summary.pendingEstimatedTon,0);
  assert.equal(data.summary.confirmedTon,Math.round(((statuses[0]==='confirmed'?12.2:0)+(statuses[1]==='confirmed'?3.7:0))*1000)/1000);
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM bed_ash_discharge_events').get().n,2);
});

test('merged sparse evidence is attached read-only without enabling a review across source gaps',async t=>{
  const db=database();t.after(()=>db.close());await api.ensureSchema(db);seedPrior(db,{key:'reviewed',status:'confirmed'});
  const original=reviewedState(db);saveSource(db,{gap:true});const data=await getRange(db);
  assert.equal(data.events.length,1);assert.equal(data.events[0].minuteObservations.length,1);
  const [merged]=data.events[0].minuteObservations;assert.equal(merged.estimatedTon,14.54);
  assert.equal(merged.hasSourceGaps,true);assert.equal(merged.sourceGapCount,2);assert.equal(merged.reviewReady,false);
  assert.equal(reviewedState(db),original);assert.equal(data.summary.pendingCount,0);
});

test('source replacement between detection and write cannot insert a merged candidate from superseded evidence',async t=>{
  const db=database();t.after(()=>db.close());await api.ensureSchema(db);seedPrior(db,{key:'prior-pending'});
  const raw=saveSource(db);db.beforeBatch=()=>{
    for(const unit of raw.units)for(const point of unit.samples)point.levelTon=30;
    db.raw.prepare('UPDATE ois_data_requests SET result_json=?,updated_at=? WHERE id=?').run(JSON.stringify(raw),iso(987),'source');
  };
  const data=await getRange(db);assert.deepEqual(data.events,[]);assert.deepEqual(data.minorObservations,[]);
  assert.equal(data.summary.pendingCount,0);assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM bed_ash_discharge_events WHERE algorithm_version=?').get(CURRENT).n,0);
});

test('slow declines above 3 t retain a separate readonly reason in the saved-data response',async t=>{
  const db=database();t.after(()=>db.close());await api.ensureSchema(db);saveSource(db,{slow:true});
  const data=await getRange(db);assert.deepEqual(data.events,[]);assert.equal(data.minorObservations.length,1);
  const [minor]=data.minorObservations;assert.equal(minor.estimatedTon,4);assert.equal(minor.algorithmVersion,CURRENT);
  assert.equal(minor.observationReason,'slow_decline');assert.equal(minor.isRapidDecline,false);assert.equal(minor.reviewReady,false);
  assert.equal(data.summary.pendingCount,0);assert.equal(data.summary.confirmedTon,0);
});
