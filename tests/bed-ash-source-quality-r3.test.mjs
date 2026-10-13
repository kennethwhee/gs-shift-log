import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import contract from '../efficiency/bed-ash-minute-contract.js';
import {__bedAshTest as api} from '../functions/api/bed-ash-discharge.js';

const DAY='2026-08-01',START=Date.parse(DAY+'T00:00:00+09:00'),END=START+86400000;
const iso=at=>new Date(at+32400000).toISOString().slice(0,19)+'+09:00';
const startAt=iso(START),endAt=iso(END);
function point(unitNo,minute,levelTon){
  return {unitNo,bucketAt:iso(START+minute*60000),sampledAt:iso(START+minute*60000+17000),
    levelTon,sourceKind:'dataparc_bed_ash_minute',sampleIntervalSeconds:60};
}
function database(){
  const raw=new DatabaseSync(':memory:');
  raw.exec('CREATE TABLE ois_data_requests(id TEXT PRIMARY KEY,request_type TEXT,target_date TEXT,status TEXT,result_json TEXT,error_message TEXT,requested_at TEXT,completed_at TEXT,updated_at TEXT);');
  return {raw,prepare(sql){return {values:[],bind(...values){this.values=values;return this;},
    async first(){return raw.prepare(sql).get(...this.values)||null;},
    async all(){return {results:raw.prepare(sql).all(...this.values)};},
    async run(){return {meta:{changes:Number(raw.prepare(sql).run(...this.values).changes)}};}};},
    async batch(statements){raw.exec('BEGIN IMMEDIATE');try{const results=[];for(const statement of statements)results.push(await statement.run());raw.exec('COMMIT');return results;}catch(error){raw.exec('ROLLBACK');throw error;}},
    close(){raw.close();}};
}
function sparsePacket(){
  const values={1:new Map([[420,30],[421,27],[422,23],[423,23],[424,23],[1438,42.3]]),
    2:new Map([[12,25],[13,25],[14,25]])};
  return {schemaVersion:2,sourceKind:'dataparc_bed_ash_minute',sampleIntervalSeconds:60,targetDate:DAY,
    intervalStart:startAt,intervalEnd:endAt,collectedAt:iso(END+6*60000),
    units:contract.UNIT_DEFINITIONS.map(definition=>({...definition,samples:Array.from({length:1441},(_,minute)=>{
      const levelTon=values[definition.unitNo].get(minute)??null;
      return {sampledAt:iso(START+minute*60000),returnedAt:levelTon===null?null:iso(START+minute*60000+17000),
        quality:levelTon===null?'NoData':'Raw, Good',levelTon};
    })}))};
}

test('latest weight ignores null, blank, invalid and out-of-range rows while preserving a real zero and its actual time',()=>{
  const samples=[point(1,10,38.7),point(1,11,0),point(1,12,null),point(1,13,''),point(1,14,'99'),
    point(1,15,NaN),point(1,16,Infinity),point(1,17,-1),point(1,18,false),point(1,1440,99),
    {...point(1,20,88),sampledAt:'invalid'},point(2,22,null)];
  const before=structuredClone(samples),latest=api.buildLatestLevels(samples,startAt,endAt);
  assert.equal(latest[1].levelTon,0);assert.equal(latest[1].sampledAt,DAY+'T00:11:17+09:00');
  assert.equal(latest[2],null);assert.deepEqual(samples,before);
});

test('per-unit minute statistics preserve partial availability, explicit zero, unique buckets and selected-day bounds',()=>{
  const source=[point(1,0,0),point(1,1,20),point(1,1,21),point(1,2,null),point(1,1440,99),
    point(2,0,null),point(2,1,null),point(2,2,null),
    {...point(1,60,35),sourceKind:'ois_hourly_fallback',sampleIntervalSeconds:3600},
    {...point(1,60,35),sourceKind:'ois_hourly_fallback',sampleIntervalSeconds:3600}];
  const before=structuredClone(source),coverage=api.buildUnitCoverage(source,startAt,endAt);
  assert.deepEqual(coverage[1],{hasMinuteSource:true,minuteSampleCount:3,validMinuteSampleCount:2,
    missingMinuteSampleCount:1,hasGaps:true,latestMinuteBucketAt:DAY+'T00:02:00+09:00',
    latestMinuteMissing:true,latestValidAt:DAY+'T01:00:17+09:00',hourlySampleCount:1});
  assert.equal(coverage[2].hasMinuteSource,true);assert.equal(coverage[2].minuteSampleCount,3);
  assert.equal(coverage[2].validMinuteSampleCount,0);assert.equal(coverage[2].missingMinuteSampleCount,3);
  assert.equal(coverage[2].latestMinuteMissing,true);assert.equal(coverage[2].latestValidAt,null);
  assert.equal(Object.hasOwn(coverage[2],'complete'),false);assert.equal(Object.hasOwn(coverage[2],'noDischarge'),false);
  assert.deepEqual(source,before);
});

test('empty or hourly-only units keep minute availability distinct from absence of detected events',()=>{
  const hourly={...point(1,60,19.3),sourceKind:'ois_bed_ash_hourly',sampleIntervalSeconds:3600};
  const coverage=api.buildUnitCoverage([hourly],startAt,endAt);
  assert.equal(coverage[1].hasMinuteSource,false);assert.equal(coverage[1].hourlySampleCount,1);
  assert.equal(coverage[1].latestValidAt,hourly.sampledAt);assert.equal(coverage[1].latestMinuteBucketAt,null);
  assert.equal(coverage[2].hasMinuteSource,false);assert.equal(coverage[2].minuteSampleCount,0);
  assert.equal(coverage[2].hourlySampleCount,0);assert.equal(coverage[2].latestValidAt,null);
  assert.equal(coverage[2].latestMinuteMissing,false);
});

test('the owning day missing minute rows cannot reuse a good baseline midnight endpoint or an earlier duplicate',()=>{
  const baseline={...point(1,0,0),sourceDate:'2026-07-31'};
  const ownerRows=[0,1,2].map(minute=>({...point(1,minute,null),sourceDate:DAY}));
  const source=[baseline,{...point(1,0,77),sourceDate:DAY},...ownerRows],before=structuredClone(source);
  const latest=api.buildLatestLevels(source,startAt,endAt),coverage=api.buildUnitCoverage(source,startAt,endAt);
  assert.equal(latest[1],null);assert.equal(coverage[1].hasMinuteSource,true);
  assert.equal(coverage[1].minuteSampleCount,3);assert.equal(coverage[1].validMinuteSampleCount,0);
  assert.equal(coverage[1].missingMinuteSampleCount,3);assert.equal(coverage[1].latestValidAt,null);
  assert.equal(coverage[1].latestMinuteMissing,true);assert.deepEqual(source,before);
});

test('a baseline minute endpoint alone does not upgrade selected-day hourly display availability',()=>{
  const baseline=[1,2].map(unitNo=>({...point(unitNo,0,0),sourceDate:'2026-07-31'}));
  const hourly={...point(1,60,19.3),sourceDate:DAY,sourceKind:'ois_bed_ash_hourly',sampleIntervalSeconds:3600};
  const source=[...baseline,hourly],before=structuredClone(source);
  const latest=api.buildLatestLevels(source,startAt,endAt),coverage=api.buildUnitCoverage(source,startAt,endAt);
  assert.equal(latest[1].levelTon,19.3);assert.equal(latest[1].sampledAt,hourly.sampledAt);assert.equal(latest[2],null);
  assert.equal(coverage[1].hasMinuteSource,false);assert.equal(coverage[1].minuteSampleCount,0);
  assert.equal(coverage[1].hourlySampleCount,1);assert.equal(coverage[1].latestValidAt,hourly.sampledAt);
  assert.equal(coverage[2].hasMinuteSource,false);assert.equal(coverage[2].latestValidAt,null);
  assert.deepEqual(source,before);
});

test('actual GET reports two sparse units and last valid readings without rewriting reviewed amounts or history',async t=>{
  const db=database();t.after(()=>db.close());await api.ensureSchema(db);
  const reviewed={eventKey:'reviewed-hourly',algorithmVersion:'bed-ash-drop-v2',unitNo:1,tagNumber:'104HDC01CW101XQ01',
    startAt:DAY+'T07:00:00+09:00',endAt:DAY+'T09:00:00+09:00',thresholdCrossedAt:DAY+'T08:00:00+09:00',
    startLevelTon:50,endLevelTon:28.6,estimatedTon:21.4,confidence:'high',closeReason:'stable',reviewReady:true,
    evidenceFingerprint:'original-reviewed-evidence',sourceKind:'ois_bed_ash_hourly',sampleIntervalSeconds:3600};
  await api.synchronizeDetectedEvents(db,startAt,endAt,[reviewed],[],[]);
  db.raw.prepare("UPDATE bed_ash_discharge_events SET status='confirmed',confirmed_at=?,confirmed_ton=21.4,note='original note',reviewed_by_id='operator',reviewed_by_name='Operator',reviewed_at=?,revision=2 WHERE event_key=?")
    .run(DAY+'T08:30:00+09:00',DAY+'T09:00:00+09:00',reviewed.eventKey);
  db.raw.prepare('INSERT INTO bed_ash_discharge_review_history VALUES(?,?,?,?,?,?,?,?,?)')
    .run('original-history',reviewed.eventKey,2,'pending','confirmed',JSON.stringify({confirmedTon:21.4,note:'original note'}),'operator','Operator',DAY+'T09:00:00+09:00');
  const original=JSON.stringify({row:db.raw.prepare('SELECT * FROM bed_ash_discharge_events WHERE event_key=?').get(reviewed.eventKey),
    history:db.raw.prepare('SELECT * FROM bed_ash_discharge_review_history').all()});
  const raw=sparsePacket();db.raw.prepare('INSERT INTO ois_data_requests VALUES(?,?,?,?,?,?,?,?,?)')
    .run('sparse-source','bed_ash_level',DAY,'complete',JSON.stringify(raw),'',raw.collectedAt,raw.collectedAt,raw.collectedAt);
  const response=await api.handleRangeGet({env:{DB:db}},new URL('https://fixture.invalid/api/bed-ash-discharge?startDate='+DAY+'&endDate='+DAY));
  assert.equal(response.status,200);const {data}=await response.json();
  assert.equal(data.latestLevels[1].levelTon,42.3);assert.equal(data.latestLevels[1].sampledAt,DAY+'T23:58:17+09:00');
  assert.equal(data.latestLevels[2].levelTon,25);assert.equal(data.latestLevels[2].sampledAt,DAY+'T00:14:17+09:00');
  for(const unit of [1,2]){assert.equal(data.unitCoverage[unit].minuteSampleCount,1440);
    assert.equal(data.unitCoverage[unit].hasGaps,true);assert.equal(data.unitCoverage[unit].latestMinuteMissing,true);
    assert.equal(data.unitCoverage[unit].latestMinuteBucketAt,DAY+'T23:59:00+09:00');
    assert.equal(data.unitCoverage[unit].latestValidAt,data.latestLevels[unit].sampledAt);}
  assert.equal(data.unitCoverage[1].validMinuteSampleCount,6);assert.equal(data.unitCoverage[1].missingMinuteSampleCount,1434);
  assert.equal(data.unitCoverage[2].validMinuteSampleCount,3);assert.equal(data.unitCoverage[2].missingMinuteSampleCount,1437);
  assert.equal(data.events.length,1);assert.equal(data.events[0].eventKey,reviewed.eventKey);
  assert.equal(data.events[0].confirmedTon,21.4);assert.equal(data.events[0].evidenceFingerprint,reviewed.evidenceFingerprint);
  assert.equal(data.summary.confirmedCount,1);assert.equal(data.summary.confirmedTon,21.4);assert.equal(data.summary.unit2Ton,0);
  assert.deepEqual(data.coverage.completeDates,[]);
  assert.equal(JSON.stringify({row:db.raw.prepare('SELECT * FROM bed_ash_discharge_events WHERE event_key=?').get(reviewed.eventKey),
    history:db.raw.prepare('SELECT * FROM bed_ash_discharge_review_history').all()}),original);
});
