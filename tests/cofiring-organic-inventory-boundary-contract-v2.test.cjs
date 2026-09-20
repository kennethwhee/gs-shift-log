const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');

function read(rel){
  return fs.readFileSync(
    path.join(root,rel),
    'utf8'
  );
}

function fnBlock(source,startName,endName){
  const a=source.search(
    new RegExp(
      'function\\s+'+startName+'\\s*\\('
    )
  );

  assert.ok(
    a>=0,
    startName+' missing'
  );

  const tail=source.slice(a);

  const b=tail.search(
    new RegExp(
      'function\\s+'+endName+'\\s*\\('
    )
  );

  assert.ok(
    b>0,
    endName+' missing'
  );

  return tail.slice(0,b);
}

test('organic inventory uses 2-minute START and last-actual END',()=>{
  for(const rel of [
    'functions/api/ois-data-requests.js',
    'maintenance/cofiring-live-contract.js'
  ]){
    const source=read(rel);

    const organic=fnBlock(
      source,
      'validateOrganicInventory',
      'validatePeriodReport'
    );

    assert.match(
      organic,
      /COFIRING_ORGANIC_START_BOUNDARY_2MIN_V1/
    );

    assert.match(
      organic,
      /st\s*<\s*p\.startMs\s*\|\|\s*st\s*>=\s*p\.startMs\s*\+\s*120000/
    );

    assert.doesNotMatch(
      organic,
      /st\s*<\s*p\.startMs\s*\|\|\s*st\s*>=\s*p\.startMs\s*\+\s*60000/
    );

    assert.match(
      organic,
      /et\s*<\s*p\.startMs\s*\|\|\s*et\s*>=\s*p\.endMs\s*\+\s*60000/
    );
  }
});

test('known inventory start timestamps fit the 2-minute contract',()=>{
  const start=Date.parse(
    '2026-09-20T00:00:00+09:00'
  );

  for(const stamp of [
    '2026-09-20T00:00:57+09:00',
    '2026-09-20T00:01:06+09:00',
    '2026-09-20T00:01:51+09:00'
  ]){
    const value=Date.parse(stamp);

    assert.ok(
      value>=start
    );

    assert.ok(
      value<start+120000
    );
  }
});

test('Coal Bio retain the original strict one-minute boundaries',()=>{
  for(const rel of [
    'functions/api/ois-data-requests.js',
    'maintenance/cofiring-live-contract.js'
  ]){
    const source=read(rel);

    const summary=fnBlock(
      source,
      'validatePeriodSummaryItem',
      'validateOrganicInventory'
    );

    assert.match(
      summary,
      /st\s*<\s*p\.startMs\s*\|\|\s*st\s*>=\s*p\.startMs\s*\+\s*60000/
    );

    assert.match(
      summary,
      /et\s*<\s*p\.endMs\s*\|\|\s*et\s*>=\s*p\.endMs\s*\+\s*60000/
    );
  }
});

test('index loads the START2 + END actual contract build exactly once',()=>{
  const html=read('index.html');

  const expected=
    '<script src="/maintenance/cofiring-live-contract.js?v=20260920-organic-start2-endactual-v1-r1" defer></script>';

  assert.equal(
    html.split(expected).length-1,
    1
  );

  assert.equal(
    (
      html.match(
        /cofiring-live-contract\.js\?v=/g
      ) || []
    ).length,
    1
  );
});
