import assert from 'node:assert/strict';
import test from 'node:test';
import {__bedAshTest as api} from '../functions/api/bed-ash-discharge.js';
const MINUTE=60000,DAY='2026-10-13',START=Date.parse(`${DAY}T00:00:00+09:00`);
const iso=at=>new Date(at+32400000).toISOString().slice(0,23)+'+09:00';
const point=(minute,levelTon,offset=17000)=>({unitNo:1,bucketAt:iso(START+minute*MINUTE),sampledAt:iso(START+minute*MINUTE+offset),returnedAt:iso(START+minute*MINUTE+offset),quality:'Raw, Good',levelTon,sourceDate:DAY,sourceKind:'dataparc_bed_ash_minute',sampleIntervalSeconds:60});
const missing=minute=>({...point(minute,null,0),quality:'No Data, Bad',returnedAt:null});
const run=(levels,start=420)=>levels.map((n,i)=>n===null?missing(start+i):point(start+i,n));
const detect=rows=>api.detectMinuteBedAshObservationsForUnit(1,rows,START+86400000);
const end=rows=>[...rows,...Array.from({length:12},(_,i)=>point(Math.round((Date.parse(rows.at(-1).bucketAt)-START)/MINUTE)+i+1,rows.at(-1).levelTon))];

test('exactly three rapid tonnes qualifies; smaller amounts remain readonly and real zero stays numeric',()=>{
  for(const amount of [2.999,3,3.001]){
    const result=detect(end(run([10,10-amount])));
    assert.equal(result.events.length,amount>=3?1:0);
    assert.equal(result.minorObservations.length,amount<3?1:0);
    const item=[...result.events,...result.minorObservations][0];assert.equal(item.estimatedTon,amount);
    assert.equal(item.isRapidDecline,amount>=3);assert.equal(item.algorithmVersion,'bed-ash-drop-minute-v3');
    if(amount<3){assert.equal(item.observationReason,'below_threshold');assert.equal(item.reviewReady,false);}
    for(const key of ['confirmedTon','vehicleCount'])assert.equal(Object.hasOwn(item,key),false);
  }
  const [zero]=detect(end(run([3,0]))).events;assert.equal(zero.endLevelTon,0);assert.equal(zero.estimatedTon,3);
});

test('three tonnes within thirty actual minutes qualifies but a slower decline does not',()=>{
  const boundary=Array.from({length:31},(_,m)=>point(m,30-m/10));
  const [event]=detect(end(boundary)).events;assert.equal(event.estimatedTon,3);assert.equal(event.thresholdCrossedAt,boundary[30].sampledAt);
  const slow=Array.from({length:61},(_,m)=>point(m,30-m/20));
  const result=detect(end(slow));assert.equal(result.events.length,0);assert.equal(result.minorObservations.length,1);
  assert.equal(result.minorObservations[0].estimatedTon,3);assert.equal(result.minorObservations[0].observationReason,'slow_decline');assert.equal(result.minorObservations[0].isRapidDecline,false);
  const outside=boundary.map((row,i)=>i===30?{...row,sampledAt:iso(START+30*MINUTE+17001),returnedAt:iso(START+30*MINUTE+17001)}:row);
  assert.equal(detect(outside).events.length,0);
});

test('a slow lead-in is kept separate from a later rapid decrease with bounded observed onset',()=>{
  const slow=Array.from({length:121},(_,m)=>point(m,50-m/20));
  const rows=end([...slow,point(121,41)]),before=structuredClone(rows),result=detect(rows);
  assert.equal(result.events.length,1);assert.equal(result.events[0].startAt,slow.at(-1).sampledAt);
  assert.equal(result.events[0].estimatedTon,3);assert.equal(result.events[0].thresholdCrossedAt,rows[121].sampledAt);
  assert.equal(result.minorObservations.length,1);assert.equal(result.minorObservations[0].estimatedTon,6);assert.equal(result.minorObservations[0].observationReason,'slow_decline');
  assert.equal(result.events[0].estimatedTon+result.minorObservations[0].estimatedTon,9);assert.deepEqual(rows,before);
});

test('illustrative screenshot endpoints produce one 14.54t run and qualify the 3.83t Unit1 decrease',()=>{
  // Intermediate values are synthetic; only the user-visible endpoints/time ranges are replayed here.
  const first=Array.from({length:19},(_,i)=>point(873+i,51.08-(51.08-39.63)*i/18));
  const pause=Array.from({length:4},(_,i)=>missing(892+i));
  const second=Array.from({length:6},(_,i)=>point(896+i,39.63-(39.63-36.54)*i/5));
  const rows=end([...first,...pause,...second]),result=detect(rows);
  assert.equal(result.events.length,1);assert.equal(result.events[0].startLevelTon,51.08);assert.equal(result.events[0].endLevelTon,36.54);assert.equal(result.events[0].estimatedTon,14.54);
  assert.equal(result.events[0].hasSourceGaps,true);assert.equal(result.events[0].reviewReady,false);assert.equal(result.minorObservations.length,0);
  const unit1=Array.from({length:11},(_,i)=>point(436+i,46.67-(46.67-42.84)*i/10));
  assert.equal(detect(end(unit1)).events[0].estimatedTon,3.83);
});

test('five-minute pauses and an exactly ten-minute continuation join; a longer pause separates',()=>{
  for(const resume of [6,11,12]){
    const rows=end(run([30,24,...Array(resume-2).fill(24),20]));
    const events=detect(rows).events;
    assert.deepEqual(events.map(e=>e.estimatedTon),resume<=11?[10]:[6,4],String(resume));
  }
});

test('explicit sparse bridges include ten actual minutes but reject ten minutes plus a millisecond',()=>{
  const base=[point(420,30),point(421,28),...Array.from({length:9},(_,i)=>missing(422+i)),point(431,25)];
  const result=detect(base);assert.equal(result.events.length,1);assert.equal(result.events[0].estimatedTon,5);assert.equal(result.events[0].sourceGapCount,9);assert.equal(result.events[0].reviewReady,false);
  const after=structuredClone(base);after.at(-1).sampledAt=iso(START+431*MINUTE+17001);after.at(-1).returnedAt=after.at(-1).sampledAt;
  assert.equal(detect(after).events.length,0);
  assert.equal(detect([point(420,30),point(421,28),...Array.from({length:10},(_,i)=>missing(422+i)),point(432,25)]).events.length,0);
});

test('several short sparse bridges cannot turn a long quiet pause into one discharge',()=>{
  const rows=end(run([30,24,null,null,null,24,null,null,null,24,null,null,null,20]));
  const events=detect(rows).events;assert.deepEqual(events.map(e=>e.estimatedTon),[6,4]);assert.equal(events[0].closeReason,'pause_elapsed');assert.equal(events[0].reviewReady,false);
});

test('missing, ambiguous and invalid quality observations are hard barriers; refilling separates real episodes',()=>{
  const base=run([30,28,null,26]);
  const cases=[base.filter((_,i)=>i!==2),[...base.slice(0,3),base[2],base[3]],base.map((r,i)=>i===2?{...r,quality:'Raw, Bad'}:r),base.map((r,i)=>i===2?{...r,quality:'Good'}:r),base.map((r,i)=>i===3?{...r,returnedAt:base[1].returnedAt}:r)];
  for(const rows of cases)assert.equal(detect(rows).events.length,0);
  assert.deepEqual(detect(end(run([30,24,24.6,20]))).events.map(e=>e.estimatedTon),[6,4.6]);
});

test('a long connected rapid drain stays one run rather than artificial truck-sized pieces',()=>{
  const rows=end(Array.from({length:71},(_,m)=>point(m,60-m/2)));
  const {events}=detect(rows);assert.equal(events.length,1);assert.equal(events[0].estimatedTon,35);assert.equal(events[0].startAt,rows[0].sampledAt);
});
