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

function block(source,startName,endName){
  const start=source.search(
    new RegExp(
      'function\\s+'+startName+'\\s*\\('
    )
  );

  assert.ok(start>=0,startName+' missing');

  const tail=source.slice(start);

  const end=tail.search(
    new RegExp(
      'function\\s+'+endName+'\\s*\\('
    )
  );

  assert.ok(end>0,endName+' missing');

  return tail.slice(0,end);
}

test('organic inventory accepts last actual END sample inside selected period',()=>{
  for(const rel of [
    'functions/api/ois-data-requests.js',
    'maintenance/cofiring-live-contract.js'
  ]){
    const source=read(rel);

    const organic=block(
      source,
      'validateOrganicInventory',
      'validatePeriodReport'
    );

    assert.match(
      organic,
      /COFIRING_ORGANIC_LAST_ACTUAL_END_V1/
    );

    assert.match(
      organic,
      /([A-Za-z_$][A-Za-z0-9_$]*)\s*<\s*p\.startMs\s*\|\|\s*\1\s*>=\s*p\.endMs\s*\+\s*\d+/
    );

    assert.doesNotMatch(
      organic,
      /([A-Za-z_$][A-Za-z0-9_$]*)\s*<\s*p\.endMs\s*\|\|\s*\1\s*>=\s*p\.endMs\s*\+\s*\d+/
    );

    const summary=block(
      source,
      'validatePeriodSummaryItem',
      'validatePeriodReport'
    );

    // Coal/Bio contract remains unchanged and strict.
    assert.match(
      summary,
      /et\s*<\s*p\.endMs/
    );
  }
});

test('index has exactly one valid live-contract loader and no malformed replacement',()=>{
  const html=read('index.html');

  const loaders=
    html.match(
      /<script\s+src="\/maintenance\/cofiring-live-contract\.js\?v=[^"]+"\s+defer><\/script>/g
    ) || [];

  assert.equal(
    loaders.length,
    1
  );

  assert.doesNotMatch(
    html,
    /\$1\d+organic-last-actual/
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
