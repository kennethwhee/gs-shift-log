const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');

const worker=fs.readFileSync('local-tools/ois-agent/cofiring-period-v5/cofiring-period-worker-v5.ps1','utf8');
const controller=fs.readFileSync('local-tools/ois-agent/cofiring-period-v5/run-cofiring-period-v5.ps1','utf8');
const agent=fs.readFileSync('local-tools/ois-agent/cofiring-dataparc-agent.js','utf8');
const contract=fs.readFileSync('maintenance/cofiring-live-contract.js','utf8');
const api=fs.readFileSync('functions/api/ois-data-requests.js','utf8');
const ui=fs.readFileSync('maintenance/cofiring-period-ui-v5.js','utf8');
const css=fs.readFileSync('maintenance/cofiring-period-ui-v5.css','utf8');

const sha=p=>crypto
  .createHash('sha256')
  .update(fs.readFileSync(p))
  .digest('hex');

test('organic start inventory uses last actual through midnight',()=>{
  assert.match(
    worker,
    /COFIRING_ORGANIC_INVENTORY_START_MIDNIGHT_V2/
  );

  assert.match(
    worker,
    /\$cofiringStart\.AddDays\(-1\)/
  );

  assert.match(
    worker,
    /\{'End'\}else\{'Start'\}/
  );

  assert.match(
    worker,
    /\$startTime -ge \$cofiringStart\.AddDays\(-1\) -and \$startTime -le \$cofiringStart/
  );

  assert.doesNotMatch(
    worker,
    /COFIRING_ORGANIC_INVENTORY_BOUNDARY_V2_R7/
  );
});

test('browser and API use midnight lookback contract',()=>{
  for(const source of [contract,api]){
    assert.match(
      source,
      /st<p\.startMs-86400000\|\|st>p\.startMs/
    );

    assert.doesNotMatch(
      source,
      /st<p\.startMs\|\|st>=p\.startMs\+120000/
    );
  }
});

test('UI uses DataPARC total and compact operator text',()=>{
  assert.match(
    ui,
    /COFIRING_ORGANIC_START_DATAPARC_SUM_V1/
  );

  assert.match(
    ui,
    /COFIRING_ORGANIC_EQUAL_SPLIT_V1/
  );

  assert.doesNotMatch(
    ui,
    /COFIRING_ORGANIC_20260920_ANCHOR_3471_V1/
  );

  assert.match(
    ui,
    /DataPARC A\+B\+Day/
  );

  assert.match(
    ui,
    /현재재고/
  );

  assert.match(
    ui,
    /50:50 자동배분\\n계산:/
  );

  assert.match(
    css,
    /COFIRING_ORGANIC_COMPACT_SUMMARY_V1/
  );

  assert.match(
    css,
    /white-space:pre-line/
  );
});

test('controller and agent hashes match edited bytes',()=>{
  const w=sha('local-tools/ois-agent/cofiring-period-v5/cofiring-period-worker-v5.ps1');
  const c=sha('local-tools/ois-agent/cofiring-period-v5/run-cofiring-period-v5.ps1');

  assert.match(
    controller,
    new RegExp("\\$expectedWorkerSha256='"+w+"'")
  );

  assert.match(
    agent,
    new RegExp("PERIOD_WORKER_SHA256='"+w+"'")
  );

  assert.match(
    agent,
    new RegExp("PERIOD_CONTROLLER_SHA256='"+c+"'")
  );
});
