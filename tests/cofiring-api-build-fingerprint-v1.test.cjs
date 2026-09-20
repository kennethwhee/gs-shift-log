const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const api=fs.readFileSync(
  path.join(root,'functions/api/ois-data-requests.js'),
  'utf8'
);

test('API exposes a deployment fingerprint without changing the organic contract',()=>{
  assert.match(
    api,
    /COFIRING_API_BUILD_FINGERPRINT_V1/
  );

  assert.match(
    api,
    /organic-start2-endactual-20260920-v1/
  );

  const headers=
    api.match(
      /X-GS-Cofiring-Api-Build/g
    ) || [];

  assert.ok(
    headers.length>=2,
    'generic and cofiring responses must both carry the build fingerprint'
  );

  assert.match(
    api,
    /st<p\.startMs\|\|st>=p\.startMs\+120000/
  );

  assert.match(
    api,
    /et<p\.startMs\|\|et>=p\.endMs\+60000/
  );
});
