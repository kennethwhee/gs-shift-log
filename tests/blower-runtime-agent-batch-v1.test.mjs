import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || process.cwd());
const agent = fs.readFileSync(path.join(root, 'local-tools/ois-agent/ois-login.js'), 'utf8');

function extractRawPowerShell(constName) {
  const marker = `const ${constName} =`;
  const start = agent.indexOf(marker);
  assert.ok(start >= 0, `${constName} is missing`);
  const rawStart = agent.indexOf('String.raw`', start);
  assert.ok(rawStart >= 0, 'raw script start missing');
  const contentStart = rawStart + 'String.raw`'.length;
  const end = agent.indexOf('`;', contentStart);
  assert.ok(end > contentStart, 'raw script end missing');
  return agent.slice(contentStart, end);
}

test('Agent coalesces up to 24 pending Blower probes before opening Excel', () => {
  assert.match(agent, /const\s+BLOWER_RUNTIME_PROBE_BATCH_MAX_REQUESTS\s*=\s*24\s*;/);
  assert.match(agent, /const\s+BLOWER_RUNTIME_PROBE_BATCH_COALESCE_MS\s*=\s*400\s*;/);
  assert.match(agent, /async function claimAdditionalBlowerRuntimeProbeRequests/);
  assert.match(agent, /action:\s*"next_blower_batch"[\s\S]*?limit/);
  assert.match(agent, /claimAdditionalBlowerRuntimeProbeRequestsLegacy[\s\S]*?action:\s*"next"[\s\S]*?requestTypes:\s*BLOWER_RUNTIME_PROBE_REQUEST_TYPE/);
  assert.match(agent, /const batchItems = \[requestItem, \.\.\.additional\]/);
  assert.match(agent, /collectBlowerRuntimeProbeBatchValues\(config, batchItems\)/);
  assert.match(agent, /if \(!additional\.length\)[\s\S]*?collectSingleBlowerRuntimeProbeValues/);
});

test('batch PowerShell uses one owned hidden Excel session for every probe in the batch', () => {
  const script = extractRawPowerShell('DATAPARC_BLOWER_RUNTIME_BATCH_POWERSHELL_SCRIPT');
  assert.match(script, /blower_runtime_probe_batch/);
  assert.match(script, /\$rawProbes\.Count\s+-gt\s+24/);
  assert.equal((script.match(/Start-Process\s+-FilePath\s+\$ownedExcelPath/g) || []).length, 1);
  assert.match(script, /foreach \(\$probe in \$probeDefinitions\)[\s\S]*?foreach \(\$chunk in @\(\$probe\.Chunks\)\)/);
  assert.ok(script.includes('1,"=",,"H",200,TRUE'));
  assert.ok(script.includes('1,"=",,"H")'));
  assert.match(script, /collectorRevision\s*=\s*"nativeom-batch-v2"/);
  assert.match(script, /기존 사용자 Excel 프로세스가 조회 중 변경되거나 종료되었습니다/);
  assert.match(script, /기존 사용자 DataPARC Host가 조회 중 변경되거나 종료되었습니다/);
});

test('batch result keeps each single-probe contract and batches successful completion', () => {
  assert.match(agent, /normalizeBlowerRuntimeProbeResult\(item\.result, expected\)/);
  assert.match(agent, /action:\s*"complete_blower_runtime_probe_batch"[\s\S]*?items/);
  assert.match(agent, /successfulOutcomes[\s\S]*?completeBlowerRuntimeProbeBatchRequests/);
  assert.match(agent, /failedExtraOutcomes\.map\(outcome =>[\s\S]*?settleClaimedBlowerRuntimeProbeRequest/);
  assert.match(agent, /rejectedCompletionOutcomes[\s\S]*?retryRejectedBlowerRuntimeProbeCompletions/);
  assert.match(agent, /GS_BLOWER_BATCH_FILE:\s*batchFilePath/);
  assert.match(agent, /fs\.unlinkSync\(batchFilePath\)/);
});
