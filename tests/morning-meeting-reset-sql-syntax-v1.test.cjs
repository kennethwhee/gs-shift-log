const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const source=fs.readFileSync(
  path.join(__dirname,'..','functions','api','ois-data-requests.js'),
  'utf8'
);

test('morning meeting reset SQL has no malformed IN-list commas',()=>{
  assert.equal(source.includes("'silo_level',)"),false);
  assert.equal(source.includes("request_type IN (,"),false);
  assert.equal(source.includes("Object.freeze([,"),false);
});

test('morning meeting reset retains the intended core and steam request groups',()=>{
  assert.match(
    source,
    /request_type IN \(\s*'water_environment',\s*'limestone_stock',\s*'turbine_gear_pinion',\s*'silo_level'\s*\)/
  );

  assert.match(
    source,
    /Object\.freeze\(\[\s*"steam_status"\s*\]\)/
  );

  assert.match(
    source,
    /request_type IN \(\s*'steam_status'\s*\)/
  );
});
