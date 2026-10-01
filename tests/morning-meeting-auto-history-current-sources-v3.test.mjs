import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=
  fs.readFileSync(
    'script.js',
    'utf8'
  );

const index=
  fs.readFileSync(
    'index.html',
    'utf8'
  );

test('V3 current-source helper and overlay are both installed',()=>{
  assert.equal(
    (
      source.match(
        /MORNING_MEETING_AUTO_HISTORY_CURRENT_SOURCES_V3/g
      )||[]
    ).length,
    2
  );

  assert.match(
    source,
    /fetchAutoHistoryCurrentSources/
  );
});

test('TO saved power is queried and normalized',()=>{
  assert.match(
    source,
    /\/api\/to-night-power\?date=/
  );

  for(
    const field of [
      'generatorEcmsGen1',
      'ismartReception',
      'epowerTransmission',
      'solarDailyGeneration'
    ]
  ){
    assert.ok(
      source.includes(field),
      field
    );
  }

  assert.match(
    source,
    /solarMonthlyCumulative/
  );

  assert.match(
    source,
    /solarYearlyCumulative/
  );
});

test('closed organic and completed unloading sources are queried',()=>{
  assert.match(
    source,
    /\/api\/cofiring-closed-history\?targetDate=/
  );

  assert.match(
    source,
    /snapshot\s*\?\.\s*manual/
  );

  assert.match(
    source,
    /organicUsage/
  );

  assert.match(
    source,
    /\/api\/solid-fuel-trouble\?/
  );

  assert.match(
    source,
    /completed-unloading-departure/
  );
});

test('fetchSavedHistory returns currentSourcePayload while retaining legacy payloads',()=>{
  const start=
    source.indexOf(
      'async function fetchSavedHistory('
    );

  assert.ok(
    start>=0
  );

  const section=
    source.slice(
      start,
      start+15000
    );

  assert.match(
    section,
    /completedPayload/
  );

  assert.match(
    section,
    /limestonePayload/
  );

  assert.match(
    section,
    /weatherPayload/
  );

  assert.match(
    section,
    /currentSourcePayload/
  );
});

test('current source overlay is inserted before the complete smpByDate declaration',()=>{
  const merge=
    source.indexOf(
      'function mergeSavedRows('
    );

  const overlay=
    source.indexOf(
      'MORNING_MEETING_AUTO_HISTORY_CURRENT_SOURCES_V3 OVERLAY',
      merge
    );

  const tail=
    source.slice(
      merge
    );

  const smpMatch=
    /const\s+smpByDate\s*=\s*readLocalSmpByDate\(\)\s*;/
      .exec(
        tail
      );

  assert.ok(
    merge>=0 &&
    overlay>merge &&
    smpMatch
  );

  const smpAbsolute=
    merge+
    smpMatch.index;

  assert.ok(
    overlay<
    smpAbsolute
  );

  const section=
    source.slice(
      overlay,
      smpAbsolute
    );

  assert.match(
    section,
    /row\.dailyData/
  );

  assert.match(
    section,
    /sludgeTotal/
  );

  assert.match(
    section,
    /organicSiloTotal/
  );

  /*
    V2 regression:
    overlay must not appear after "const smpByDate =" and before
    readLocalSmpByDate().
  */
  assert.doesNotMatch(
    source,
    /const\s+smpByDate\s*=\s*[\s\S]{0,160}?MORNING_MEETING_AUTO_HISTORY_CURRENT_SOURCES_V3 OVERLAY/
  );
});

test('script cache is bumped for V3',()=>{
  assert.match(
    index,
    /script\.js\?[^"]*autoHistoryCurrentSources=20261002-v3/
  );
});
