const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const worker = fs.readFileSync(
  path.join(root, 'local-tools/ois-agent/cofiring-period-v5/cofiring-period-worker-v5.ps1'),
  'utf8'
);

test('organic end boundary uses lastEnd for coal/bio and +2 minutes only for inventory rows', () => {
  assert.match(
    worker,
    /\$endBoundaryEnd=\$\(if\(\$r -ge \$cofiringTags\.Count\)\{\$cofiringEnd\.AddMinutes\(2\)\.ToString\('yyyy-MM-dd HH:mm'\)\}else\{\$lastEnd\}\) # COFIRING_ORGANIC_INVENTORY_END_BOUNDARY_V1_R1/
  );

  assert.doesNotMatch(
    worker,
    /else\{\$endBoundaryEnd\}/
  );

  assert.match(
    worker,
    /\$formulasFast\[\$r,3\].*\$endBoundaryEnd.*"Start","Value"/
  );

  assert.match(
    worker,
    /\$formulasFast\[\$r,4\].*\$endBoundaryEnd.*"Start","QualStr"/
  );

  assert.match(
    worker,
    /\$formulasFast\[\$r,5\].*\$endBoundaryEnd.*"Start","Time"/
  );
});
