const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const repo=path.join(__dirname,'..');
const js=fs.readFileSync(path.join(repo,'maintenance/cofiring-organic-excel-auto-v1.js'),'utf8');
const html=fs.readFileSync(path.join(repo,'index.html'),'utf8');
const helper=fs.readFileSync(path.join(repo,'local-tools/ois-agent/daily-data-open-workbook.ps1'),'utf8');

test('co-firing organic auto-fill uses the existing daily_data_excel queue',()=>{
  assert.match(js,/REQUEST_TYPE='daily_data_excel'/);
  assert.match(js,/organicUsageUnitOne/);
  assert.match(js,/organicUsageUnitTwo/);
  assert.match(js,/forceRefresh:forceRefresh===true/);
});
test('auto-fill stays unsaved and preserves a user edit made while waiting',()=>{
  assert.match(js,/event\.isTrusted/);
  assert.match(js,/state\.userEditSeq!==editSeq/);
  assert.match(js,/저장 전/);
});
test('polling is bounded and not a one-second loop',()=>{
  assert.match(js,/POLL_MS=5000/);
  assert.match(js,/MAX_WAIT_MS=180000/);
});
test('host loads auto-fill exactly once',()=>{
  assert.equal((html.match(/cofiring-organic-excel-auto-v1\.js/g)||[]).length,1);
});
test('helper uses open workbook first then hidden read-only fallback',()=>{
  assert.match(helper,/COFIRING_ORGANIC_HIDDEN_EXCEL_V1/);
  assert.match(helper,/CofiringOrganicOriginalResolve/);
  assert.match(helper,/Visible = \$false/);
  assert.match(helper,/workbooks\.Open\(\$paths\[0\], 0, \$true\)/i);
  assert.match(helper,/Quit\(\)/);
});
