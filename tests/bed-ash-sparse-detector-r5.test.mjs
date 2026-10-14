import assert from 'node:assert/strict';
import test from 'node:test';
import {__bedAshTest as api} from '../functions/api/bed-ash-discharge.js';

// Independent synthetic measurements: production packets are replayed privately.
const MINUTE=60000,DAY='2026-08-01',START=Date.parse(`${DAY}T00:00:00+09:00`);
const iso=at=>new Date(at+32400000).toISOString().slice(0,19)+'+09:00';
const point=(minute,levelTon,offset=17000)=>({unitNo:1,bucketAt:iso(START+minute*MINUTE),
  sampledAt:iso(START+minute*MINUTE+offset),returnedAt:iso(START+minute*MINUTE+offset),
  quality:'Raw, Good',levelTon,sourceDate:DAY,sourceKind:'dataparc_bed_ash_minute',sampleIntervalSeconds:60});
const missing=(minute,quality='No Data, Bad')=>({...point(minute,null,0),returnedAt:null,quality});
const run=(levels,start=420)=>levels.map((level,i)=>level===null?missing(start+i):point(start+i,level));
const detect=points=>api.detectMinuteBedAshObservationsForUnit(1,points,START+86400000);
const settled=(start,from,to)=>[point(start,from),...Array.from({length:13},(_,i)=>point(start+1+i,to))];

test('the ten-minute continuation hold preserves actual source seconds and do not mutate readings',()=>{
  const rows=settled(420,30,23),before=structuredClone(rows),{events,minorObservations}=detect(rows);
  assert.equal(events.length,1);assert.deepEqual(minorObservations,[]);
  const event=events[0];assert.equal(event.algorithmVersion,'bed-ash-drop-minute-v3');
  assert.equal(event.startAt,rows[0].sampledAt);assert.equal(event.endAt,rows[1].sampledAt);
  assert.equal(event.thresholdCrossedAt,rows[1].sampledAt);assert.equal(event.detectionClosedAt,rows[11].sampledAt);
  assert.equal(event.estimatedTon,7);assert.equal(event.closeReason,'stable');assert.equal(event.confidence,'high');
  assert.equal(event.sourceGapCount,0);assert.equal(event.hasSourceGaps,false);
  assert.deepEqual(api.detectMinuteBedAshEventsForUnit(1,rows,START+86400000),events);
  assert.deepEqual(rows,before);
});

test('a short pause inside a continuing decline cannot prematurely close or undercount it',()=>{
  const rows=run([30,27,24,24.1,24.2,22,20,20.1,20.1,18,...Array(12).fill(18.1)]);
  const {events}=detect(rows);assert.equal(events.length,1);
  assert.equal(events[0].startAt,rows[0].sampledAt);assert.equal(events[0].endAt,rows[9].sampledAt);
  assert.equal(events[0].estimatedTon,12);assert.equal(events[0].closeReason,'stable');
  assert.equal(events[0].detectionClosedAt,rows[19].sampledAt);
});

test('three explicit empty buckets join observations without supplying quiet duration or numeric levels',()=>{
  const rows=run([30,24,null,null,null,...Array(9).fill(24)]);
  const before=structuredClone(rows),{events}=detect(rows);assert.equal(events.length,1);
  const event=events[0];assert.equal(event.estimatedTon,6);assert.equal(event.endAt,rows[1].sampledAt);
  assert.equal(event.detectionClosedAt,rows[11].sampledAt);assert.equal(event.closeReason,'stable');
  assert.equal(event.sourceGapCount,3);assert.equal(event.hasSourceGaps,true);
  assert.equal(event.confidence,'low');assert.equal(event.reviewReady,false);
  assert.equal(event.evidencePoints.filter(row=>row.levelTon===null).length,3);
  assert.equal(event.evidencePoints.some(row=>row.levelTon===0),false);assert.deepEqual(rows,before);
  assert.equal(detect(rows.slice(0,7)).events[0].closeReason,'data_end');
});

test('independent short gaps remain counted through a refill and cannot make evidence reviewable',()=>{
  const rows=run([30,28,null,26,null,null,23,24]);const [event]=detect(rows).events;
  assert.equal(event.estimatedTon,7);assert.equal(event.sourceGapCount,3);assert.equal(event.closeReason,'refill');
  assert.equal(event.detectionClosedAt,rows.at(-1).sampledAt);assert.equal(event.confidence,'low');
  assert.equal(event.reviewReady,false);
});

test('long, absent, invalid and ambiguous gaps remain barriers even when an apparent combined drop exceeds three',()=>{
  const base=run([30,28,null,26,26,26,26,26,26]);
  const fixtures=new Map([
    ['absent bucket',base.filter((_,i)=>i!==2)],
    ['ten null buckets',run([30,28,...Array(10).fill(null),26,26,26,26,26,26])],
    ['duplicate null bucket',[...base.slice(0,3),structuredClone(base[2]),...base.slice(3)]],
    ['duplicate good endpoint',[...base.slice(0,4),structuredClone(base[3]),...base.slice(4)]],
    ['Raw Bad',base.map((row,i)=>i===2?{...row,quality:'Raw, Bad'}:row)],
    ['Unknown',base.map((row,i)=>i===2?{...row,quality:'Unknown'}:row)],
    ['Good null',base.map((row,i)=>i===2?{...row,quality:'Good'}:row)],
    ['numeric Bad',base.map((row,i)=>i===3?{...row,quality:'Raw, Bad'}:row)],
    ['returned timestamp mismatch',base.map((row,i)=>i===3?{...row,returnedAt:base[1].returnedAt}:row)],
    ['out-of-bucket source time',base.map((row,i)=>i===3?{...row,sampledAt:base[1].sampledAt,returnedAt:base[1].returnedAt}:row)],
    ['future source time',base.map((row,i)=>i===3?{...row,sampledAt:'2099-01-01T00:00:00+09:00',returnedAt:'2099-01-01T00:00:00+09:00'}:row)]
  ]);
  for(const [name,rows] of fixtures)assert.deepEqual(detect(rows).events,[],name);
  for(const levelTon of ['23','',false,NaN,Infinity,-1]){
    assert.deepEqual(detect(base.map((row,i)=>i===3?{...row,levelTon}:row)).events,[],String(levelTon));
  }
});

test('the maximum bridge uses real elapsed time as well as complete canonical bucket evidence',()=>{
  const rows=[point(420,30),point(421,28,0),missing(422),missing(423),missing(424),point(425,26,59000),
    ...Array.from({length:6},(_,i)=>point(426+i,26,59000))];
  assert.equal(Date.parse(rows[5].sampledAt)-Date.parse(rows[1].sampledAt),299000);
  assert.equal(detect(rows).events.length,1);
  const outside=structuredClone(rows);outside[5].sampledAt=iso(START+426*MINUTE);outside[5].returnedAt=outside[5].sampledAt;
  assert.equal(Date.parse(outside[5].sampledAt)-Date.parse(outside[1].sampledAt),300000);
  assert.deepEqual(detect(outside).events,[]);
});

test('tiny sustained declines postpone stability while bounded post-drop jitter can settle and separate episodes',()=>{
  const rows=run([30,23,22.999,22.998,22.997,22.996,22.995,...Array(12).fill(22.995)]);
  const [event]=detect(rows).events;assert.equal(event.endAt,rows[6].sampledAt);
  assert.equal(event.detectionClosedAt,rows[16].sampledAt);assert.equal(event.estimatedTon,7.005);
  const jitter=run([30,23,23.1,22.99,23.02,22.98,23.01,23.03,...Array(12).fill(23.02),17,17.1,17.08,17.09,17.1,...Array(12).fill(17.11)]);
  const events=detect(jitter).events;assert.equal(events.length,2);
  assert.ok(events.every(item=>item.closeReason==='stable'));assert.ok(events[0].endAt<events[1].startAt);
  assert.ok(events[0].estimatedTon>=7);assert.ok(events[1].estimatedTon>=6);
});

test('subthreshold declines settle independently rather than absorbing a later unrelated drop',()=>{
  const rows=run([30,...Array(13).fill(28),...Array(13).fill(26)]);
  const {events,minorObservations}=detect(rows);assert.deepEqual(events,[]);assert.equal(minorObservations.length,2);
  assert.deepEqual(minorObservations.map(item=>item.estimatedTon),[2,2]);
  assert.ok(minorObservations.every(item=>item.closeReason==='stable'&&item.reviewReady===false));
  for(const item of minorObservations)for(const key of ['eventKey','status','confirmedTon','revision'])assert.equal(Object.hasOwn(item,key),false);
});

test('minor amounts include 0.5 and exclude three; real zero remains distinct from missing evidence',()=>{
  for(const [drop,minor,event] of [[0.499,0,0],[0.5,1,0],[2.999,1,0],[3,0,1]]){
    const result=detect(settled(420,30,30-drop));assert.equal(result.events.length,event,`${drop} events`);
    assert.equal(result.minorObservations.length,minor,`${drop} minor`);
    if(minor){assert.equal(result.minorObservations[0].estimatedTon,drop);assert.equal(result.minorObservations[0].closeReason,'stable');}
  }
  const [zero]=detect(settled(420,1,0)).minorObservations;assert.equal(zero.estimatedTon,1);assert.equal(zero.endLevelTon,0);
  assert.deepEqual(detect(run([1,null,null,null,null])),{events:[],minorObservations:[]});
});

test('the quiet local maximum survives jitter near a detection threshold without retaining a stale peak forever',()=>{
  const rows=run([30.1,30.04,30.1,30.04,25.07,25.07,25.07,25.07,25.07,25.07]);
  const [event]=detect(rows).events;assert.equal(event.startAt,rows[2].sampledAt);assert.equal(event.estimatedTon,5.03);
  const flat=run([30.1,...Array(20).fill(30),25,25,25,25,25,25]);
  const [later]=detect(flat).events;assert.equal(later.estimatedTon,5);assert.equal(later.startAt,flat[20].sampledAt);
});

test('midnight owner packets can replace their boundary duplicate while ordinary duplicates stay ambiguous',()=>{
  const rows=settled(0,30,23),previousPacket={...rows[0],sourceDate:'2026-07-31',levelTon:31};
  for(const source of [[previousPacket,...rows],[...rows,previousPacket]]){
    const [event]=detect(source).events;assert.equal(event.startLevelTon,30);assert.equal(event.estimatedTon,7);
  }
  assert.deepEqual(detect([rows[0],...rows]).events,[]);
});
