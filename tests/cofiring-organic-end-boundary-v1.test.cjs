const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const worker=fs.readFileSync(
  path.join(
    root,
    'local-tools/ois-agent/cofiring-period-v5/cofiring-period-worker-v5.ps1'
  ),
  'utf8'
);

function formulaLine(col){
  return worker
    .split(/\r?\n/)
    .find(line =>
      line.includes(`$formulasFast[$r,${col}]=`)
    ) || '';
}

test('coal bio retain Start while organic inventory end uses End over the selected period',()=>{
  assert.match(
    worker,
    /\$endBoundaryStart=\$\(if\(\$r -ge \$cofiringTags\.Count\)\{\$fullStart\}else\{\$fullEnd\}\) # COFIRING_ORGANIC_INVENTORY_END_STAT_V1_R1/
  );

  assert.match(
    worker,
    /\$endBoundaryEnd=\$\(if\(\$r -ge \$cofiringTags\.Count\)\{\$fullEnd\}else\{\$lastEnd\}\) # COFIRING_ORGANIC_INVENTORY_END_STAT_V1_R1/
  );

  assert.match(
    worker,
    /\$endBoundaryMethod=\$\(if\(\$r -ge \$cofiringTags\.Count\)\{'End'\}else\{'Start'\}\) # COFIRING_ORGANIC_INVENTORY_END_STAT_V1_R1/
  );

  for(const col of [3,4,5]){
    const line=formulaLine(col);

    assert.ok(line.includes('$endBoundaryStart'));
    assert.ok(line.includes('$endBoundaryEnd'));
    assert.ok(line.includes('$endBoundaryMethod'));
  }

  assert.match(
    worker,
    /\$endTimeValid=.*\$endTime -ge \$cofiringStart.*\$endTime -le \$cofiringEnd/
  );

  assert.doesNotMatch(
    worker,
    /COFIRING_ORGANIC_INVENTORY_LINEAR_BOUNDARY_V1/
  );

  assert.doesNotMatch(
    worker,
    /else\{\$endBoundaryEnd\}/
  );
});
