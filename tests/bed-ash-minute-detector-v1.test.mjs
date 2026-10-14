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
const runLevel=(unit,m)=>unit===1?(m<424?30:m===424?27:23):(m<422?40:m===422?37:m===423?34:33);
function database(){
  const raw=new DatabaseSync(':memory:');
  raw.exec(`CREATE TABLE ois_data_requests(id TEXT PRIMARY KEY,request_type TEXT,target_date TEXT,status TEXT,result_json TEXT,error_message TEXT,requested_at TEXT,completed_at TEXT,updated_at TEXT);`);
  return {raw,prepare(sql){return {values:[],bind(...values){this.values=values;return this;},async first(){return raw.prepare(sql).get(...this.values)||null;},async all(){return {results:raw.prepare(sql).all(...this.values)};},async run(){return {meta:{changes:Number(raw.prepare(sql).run(...this.values).changes)}};}};},async batch(statements){raw.exec('BEGIN IMMEDIATE');try{const result=[];for(const stmt of statements)result.push(await stmt.run());raw.exec('COMMIT');return result;}catch(e){raw.exec('ROLLBACK');throw e;}},close(){raw.close();}};
}
function saveSource(db,raw,id='source-1'){
  const item=row(raw,id);db.raw.prepare('INSERT INTO ois_data_requests VALUES(?,?,?,?,?,?,?,?,?)').run(id,'bed_ash_level',item.target_date,item.status,item.result_json,'',item.requested_at,item.completed_at,item.updated_at);return item;
}
async function persist(db,events){await api.synchronizeDetectedEvents(db,iso(START),iso(START+86400000),events,[],[]);}

// Actual returned times vary in seconds and timezone; buckets only establish cadence.
test('minute source retains actual seconds, detects independent intervals and annotates strict cross-unit overlap',async()=>{
  const raw=packet({level:runLevel});raw.units[0].samples[423].returnedAt=new Date(START+423*MINUTE+5000).toISOString();
  const samples=normalized(raw);assert.equal(samples.find(p=>p.unitNo===1&&p.bucketAt.endsWith('07:03:00+09:00')).sampledAt,'2026-08-01T07:03:05+09:00');
  const events=await api.detectBedAshEvents(samples);assert.equal(events.length,2);
  const one=events.find(e=>e.unitNo===1),two=events.find(e=>e.unitNo===2);
  assert.equal(one.startAt,'2026-08-01T07:03:05+09:00');assert.equal(one.endAt,'2026-08-01T07:05:05+09:00');assert.equal(one.estimatedTon,7);
  assert.equal(two.startAt,'2026-08-01T07:01:05+09:00');assert.equal(two.endAt,'2026-08-01T07:04:05+09:00');assert.equal(two.estimatedTon,7);
  assert.equal(one.algorithmVersion,'bed-ash-drop-minute-v3');assert.equal(one.sampleIntervalSeconds,60);assert.equal(one.sourceKind,'dataparc_bed_ash_minute');
  assert.equal(one.overlapOtherUnit,true);assert.deepEqual(one.overlapEventKeys,[two.eventKey]);assert.equal(one.overlapStartAt,one.startAt);assert.equal(one.overlapEndAt,two.endAt);
  const touching=api.annotateCrossUnitOverlaps([{...one,startAt:two.endAt},{...two}]);assert.ok(touching.every(e=>e.overlapOtherUnit===false));
});

test('two actual drop runs within one hour remain separate; a large connected drop is never divided into guessed trucks',()=>{
  const points=[30,27,23,23,23,30,26,20,20,20].map((level,i)=>point(1,420+i,level));
  const events=api.detectMinuteBedAshEventsForUnit(1,points);assert.equal(events.length,2);assert.deepEqual(events.map(e=>e.estimatedTon),[7,10]);
  assert.equal(events[0].endAt,'2026-08-01T07:02:05+09:00');assert.equal(events[1].startAt,'2026-08-01T07:05:05+09:00');
  const large=api.detectMinuteBedAshEventsForUnit(1,[45,35,23,23,23].map((n,i)=>point(1,500+i,n)));assert.equal(large.length,1);assert.equal(large[0].estimatedTon,22);assert.notEqual(large[0].closeReason,'truck_split');
});

test('missing minute rows and explicit bad or Good-null rows split evidence rather than bridging the loss',()=>{
  const raw=packet({level:runLevel,missing:['1:424']});const samples=normalized(raw);
  const gap=samples.find(p=>p.unitNo===1&&p.bucketAt.endsWith('07:04:00+09:00'));assert.equal(gap.levelTon,null);assert.equal(gap.quality,'Bad');
  assert.equal(api.detectMinuteBedAshEventsForUnit(1,samples.filter(p=>p.unitNo===1)).length,0);
  gap.quality='Good';assert.equal(api.detectMinuteBedAshEventsForUnit(1,samples.filter(p=>p.unitNo===1)).length,0);
  assert.equal(api.detectMinuteBedAshEventsForUnit(1,[point(1,420,30),point(1,422,23)]).length,0);
  const bad=packet({level:runLevel});bad.units[0].samples[424].quality='Bad';assert.deepEqual(normalized(bad),[]);
});

test('future or malformed minute packets cannot fall through to hourly normalization',()=>{
  const raw=packet({level:runLevel});raw.collectedAt=new Date(Date.parse(raw.intervalEnd)+MINUTE).toISOString();assert.deepEqual(normalized(raw),[]);
  const missing=packet();delete missing.units[0].samples[10].returnedAt;assert.deepEqual(normalized(missing),[]);
});

test('adjacent minute requests deduplicate the shared midnight bucket for detection and review readiness',async()=>{
  const previous=packet({end:1440,level:(u,m)=>u===2?50:m<1439?30:m===1439?27:23});
  const next=packet({date:'2026-08-02',end:12,level:(u,m)=>u===2?50:23});
  const rows=[row(previous,'previous'),row(next,'next')],maps=api.selectRequestRowsByDate(rows),events=await api.detectBedAshEvents(rows.flatMap(r=>api.normalizeCompletedRequestSamples(r)));
  const one=events.find(e=>e.unitNo===1);assert.ok(one);assert.equal(one.startAt,'2026-08-01T23:58:05+09:00');assert.equal(one.endAt,'2026-08-02T00:00:05+09:00');assert.equal(one.closeReason,'stable');
  assert.equal(api.isDetectedEventReviewReady(one,maps.latestByDate,maps.completedByDate,Date.parse(next.collectedAt)+MINUTE),true);
});

test('minute data wins over hourly fallback without converting or mixing hourly evidence',async()=>{
  const fine=packet({level:runLevel}),hourly={targetDate:DAY,collectedAt:'2026-08-02T10:00:00Z',sourceKind:'ois_hourly_fallback',precisionFailure:'BED_ASH_MINUTE_QUERY_FAILED',units:contract.UNIT_DEFINITIONS.map(def=>({...def,samples:[{hour:7,levelTon:100},{hour:8,levelTon:20},{hour:9,levelTon:20}]}))};
  const maps=api.selectRequestRowsByDate([row(hourly,'newer-hourly'),row(fine,'fine')]);assert.equal(maps.completedByDate.get(DAY).id,'fine');
  const old=normalized(hourly);assert.ok(old.length>0);assert.ok(old.every(p=>p.sampleIntervalSeconds===3600&&p.sampledAt.endsWith(':00:00+09:00')));
  const events=await api.detectBedAshEvents([...old,...normalized(fine)]);assert.equal(events.length,2);assert.ok(events.every(e=>e.algorithmVersion==='bed-ash-drop-minute-v3'));
  const hourlyOnly=await api.detectBedAshEvents(old);assert.ok(hourlyOnly.every(e=>e.algorithmVersion==='bed-ash-drop-v2'));
});

test('minute events persist provenance and can be reviewed with append-only history; reviewed hourly records remain unchanged',async t=>{
  const db=database();t.after(()=>db.close());await api.ensureSchema(db);const raw=packet({level:runLevel}),source=saveSource(db,raw),maps=api.selectRequestRowsByDate([source]);
  const events=(await api.detectBedAshEvents(normalized(raw))).map(e=>({...e,reviewReady:api.isDetectedEventReviewReady(e,maps.latestByDate,maps.completedByDate)}));assert.ok(events.every(e=>e.reviewReady));await persist(db,events);
  const stored=await api.findActiveEventRows(db,iso(START),iso(START+86400000));assert.equal(stored.length,2);assert.ok(stored.every(e=>e.sourceKind==='dataparc_bed_ash_minute'&&e.sampleIntervalSeconds===60&&e.overlapOtherUnit));
  const one=stored.find(e=>e.unitNo===1),response=await api.handleReviewPost({env:{DB:db}},{action:'review',eventKey:one.eventKey,revision:one.revision,status:'confirmed',confirmedAt:one.endAt,confirmedTon:7,note:'actual review'},{employeeNo:'reviewer',name:'Reviewer'});
  assert.equal(response.status,200,JSON.stringify(await response.clone().json()));assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM bed_ash_discharge_review_history').get().n,1);
  const original=JSON.stringify(db.raw.prepare('SELECT * FROM bed_ash_discharge_events WHERE event_key=?').get(one.eventKey));const history=JSON.stringify(db.raw.prepare('SELECT * FROM bed_ash_discharge_review_history').all());
  await persist(db,events);assert.equal(JSON.stringify(db.raw.prepare('SELECT * FROM bed_ash_discharge_events WHERE event_key=?').get(one.eventKey)),original);assert.equal(JSON.stringify(db.raw.prepare('SELECT * FROM bed_ash_discharge_review_history').all()),history);
  // An existing hourly confirmed/excluded decision suppresses finer overlapping proposals without a rewrite.
  db.raw.prepare("UPDATE bed_ash_discharge_events SET algorithm_version='bed-ash-drop-v2',source_kind='ois_bed_ash_hourly',sample_interval_seconds=3600 WHERE event_key=?").run(one.eventKey);
  const historical=JSON.stringify(db.raw.prepare('SELECT * FROM bed_ash_discharge_events WHERE event_key=?').get(one.eventKey));await persist(db,events);assert.equal(JSON.stringify(db.raw.prepare('SELECT * FROM bed_ash_discharge_events WHERE event_key=?').get(one.eventKey)),historical);
});

test('a month of minute runs executes with bounded event windows and no recursive truck splitting',()=>{
  const started=performance.now(),points=Array.from({length:31*1440},(_,i)=>point(1,i,[30,27,23,23,23,30,30][i%7]));
  const events=api.detectMinuteBedAshEventsForUnit(1,points);assert.ok(events.length>6000);assert.ok(events.every(e=>e.evidencePoints.length<=7));assert.ok(performance.now()-started<3000);
});

test('a long quiet plateau advances the start to the real pre-drop minute without losing a genuine gradual drop',()=>{
  const points=Array.from({length:426},(_,m)=>point(1,m,m===0?20:m<423?19.7:10));
  const [event]=api.detectMinuteBedAshEventsForUnit(1,points);assert.ok(event);assert.equal(event.startAt,'2026-08-01T07:02:05+09:00');assert.equal(event.endAt,'2026-08-01T07:03:05+09:00');assert.equal(event.estimatedTon,9.7);
  const gradual=api.detectMinuteBedAshEventsForUnit(1,Array.from({length:25},(_,m)=>point(1,m,20-Math.min(m,20)*0.3)));assert.ok(gradual.length);assert.equal(gradual[0].startAt,'2026-08-01T00:00:05+09:00');assert.ok(gradual.reduce((sum,e)=>sum+e.estimatedTon,0)>=5);
});

test('sub-tolerance post-drop jitter settles and a later genuine drop remains a separate same-hour event',()=>{
  const levels=[20,10,10.10,9.99,10.02,9.98,9.99,9.97,9.98,9.96,...Array(12).fill(9.96),4,4.02,3.99,...Array(12).fill(4.01)];
  const events=api.detectMinuteBedAshEventsForUnit(1,levels.map((n,m)=>point(1,420+m,n)));
  assert.equal(events.length,2);assert.ok(events.every(e=>e.closeReason==='stable'));assert.ok(events[0].endAt<events[1].startAt);assert.ok(events[0].estimatedTon>=10);assert.ok(events[1].estimatedTon>=5);
});

test('newer completed hourly fallback does not cause a guaranteed conflict when reviewing preferred minute evidence',async t=>{
  const db=database();t.after(()=>db.close());await api.ensureSchema(db);const fine=packet({level:runLevel}),fineRow=saveSource(db,fine,'fine');
  const events=await api.detectBedAshEvents(normalized(fine));await persist(db,events.map(e=>({...e,reviewReady:true})));
  const fallback={targetDate:DAY,collectedAt:new Date(Date.parse(fine.collectedAt)+MINUTE).toISOString(),sourceKind:'ois_hourly_fallback',sampleIntervalSeconds:3600,units:contract.UNIT_DEFINITIONS.map(def=>({...def,samples:[{hour:7,levelTon:30},{hour:8,levelTon:23}]}))};saveSource(db,fallback,'newer-fallback');
  const one=events.find(e=>e.unitNo===1),response=await api.handleReviewPost({env:{DB:db}},{action:'review',eventKey:one.eventKey,revision:1,status:'confirmed',confirmedAt:one.endAt,confirmedTon:one.estimatedTon},{employeeNo:'operator',name:'Operator'});
  assert.equal(response.status,200,JSON.stringify(await response.clone().json()));assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM bed_ash_discharge_review_history').get().n,1);
});

test('a newer in-flight request blocks minute review and cannot append a reviewed history',async t=>{
  const db=database();t.after(()=>db.close());await api.ensureSchema(db);const fine=packet({level:runLevel});saveSource(db,fine,'fine');const events=await api.detectBedAshEvents(normalized(fine));await persist(db,events.map(e=>({...e,reviewReady:true})));
  db.raw.prepare('INSERT INTO ois_data_requests VALUES(?,?,?,?,?,?,?,?,?)').run('new-pending','bed_ash_level',DAY,'pending',null,'','2026-08-02T01:00:00Z',null,'2026-08-02T01:00:00Z');
  const one=events.find(e=>e.unitNo===1),response=await api.handleReviewPost({env:{DB:db}},{action:'review',eventKey:one.eventKey,revision:1,status:'confirmed',confirmedAt:one.endAt,confirmedTon:one.estimatedTon},{employeeNo:'operator',name:'Operator'});
  assert.equal(response.status,409);assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM bed_ash_discharge_review_history').get().n,0);
});

test('continuation hold waits beyond ten actual elapsed minutes when source seconds vary inside adjacent buckets',()=>{
  const levels=[20,...Array(13).fill(10)],points=levels.map((n,i)=>point(1,420+i,n));
  points[1].sampledAt='2026-08-01T07:01:59+09:00';points[1].returnedAt=points[1].sampledAt;
  const early=api.detectMinuteBedAshEventsForUnit(1,points.slice(0,12));assert.equal(early[0].closeReason,'data_end');
  const settled=api.detectMinuteBedAshEventsForUnit(1,points);assert.equal(settled[0].closeReason,'stable');assert.equal(settled[0].detectionClosedAt,'2026-08-01T07:11:05+09:00');
});

test('request SQL retains all historical metadata but hydrates at most three selected payloads per date',async t=>{
  const db=database();t.after(()=>db.close());await api.ensureSchema(db);
  for(const date of [DAY,'2026-08-02']){
    const base=packet({date,level:runLevel});
    for(let i=0;i<12;i++){
      const raw={...base,collectedAt:new Date(Date.parse(base.collectedAt)+i*1000).toISOString()};saveSource(db,raw,`${date}-fine-${i}`);
    }
    const hourly={targetDate:date,collectedAt:new Date(Date.parse(base.collectedAt)+30000).toISOString(),sourceKind:'ois_hourly_fallback',sampleIntervalSeconds:3600,units:contract.UNIT_DEFINITIONS.map(def=>({...def,samples:[{hour:7,levelTon:30},{hour:8,levelTon:23}]}))};saveSource(db,hourly,`${date}-latest-hourly`);
    const pendingAt=new Date(Date.parse(base.collectedAt)+60000).toISOString();
    db.raw.prepare('INSERT INTO ois_data_requests VALUES(?,?,?,?,?,?,?,?,?)').run(`${date}-raw-pending`,'bed_ash_level',date,'pending','{"phase":"reading"}','pending note',pendingAt,null,pendingAt);
    // Invalid historical payloads must never reach json_extract unguarded.
    db.raw.prepare('INSERT INTO ois_data_requests VALUES(?,?,?,?,?,?,?,?,?)').run(`${date}-malformed`,'bed_ash_level',date,'complete','not valid JSON','legacy parse failure',new Date(Date.parse(base.intervalStart)+MINUTE).toISOString(),new Date(Date.parse(base.intervalStart)+2*MINUTE).toISOString(),new Date(Date.parse(base.intervalStart)+2*MINUTE).toISOString());
  }
  const rows=await api.findOisRequestRows(db,DAY,'2026-08-02');assert.equal(rows.length,30);
  const metadata=rows.map(({result_json,...fields})=>fields).sort((a,b)=>a.id.localeCompare(b.id));
  const expected=db.raw.prepare('SELECT id,target_date,status,error_message,requested_at,completed_at,updated_at FROM ois_data_requests').all().map(r=>({...r})).sort((a,b)=>a.id.localeCompare(b.id));assert.deepEqual(metadata,expected);
  for(const date of [DAY,'2026-08-02']){
    const hydrated=rows.filter(r=>r.target_date===date&&r.result_json!==null);assert.equal(hydrated.length,3);
    assert.deepEqual(new Set(hydrated.map(r=>r.id)),new Set([`${date}-fine-11`,`${date}-latest-hourly`,`${date}-raw-pending`]));
  }
  const maps=api.selectRequestRowsByDate(rows);assert.equal(maps.completedByDate.get(DAY).id,DAY+'-fine-11');assert.equal(maps.latestByDate.get(DAY).id,DAY+'-raw-pending');
  const events=await api.detectBedAshEvents(api.normalizeCompletedRequestSamples(maps.completedByDate.get(DAY)));assert.equal(events.length,2);assert.ok(events.every(e=>e.sampleIntervalSeconds===60));
  assert.equal(api.isDetectedEventReviewReady(events[0],maps.latestByDate,maps.completedByDate),false);
  // A changed historical status still fences synchronization even though that
  // row's large result payload was intentionally projected to NULL.
  const snapshot={startDate:DAY,endDate:'2026-08-02',requests:rows.map(r=>({id:r.id,date:r.target_date,status:r.status,requestedAt:r.requested_at,completedAt:r.completed_at,updatedAt:r.updated_at}))};
  db.raw.prepare("UPDATE ois_data_requests SET status='failed',updated_at=? WHERE id=?").run('2026-08-02T12:00:00Z',DAY+'-fine-0');
  await api.synchronizeDetectedEvents(db,iso(START),iso(START+86400000),events.map(e=>({...e,reviewReady:true})),[],[],snapshot);
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM bed_ash_discharge_events').get().n,0);
});
