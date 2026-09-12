import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || process.cwd());
const agent = fs.readFileSync(
  path.join(root, 'local-tools/ois-agent/ois-login.js'),
  'utf8'
);

function extractFunction(name) {
  const asyncMarker = `async function ${name}`;
  const syncMarker = `function ${name}`;
  const asyncStart = agent.indexOf(asyncMarker);
  const syncStart = agent.indexOf(syncMarker);
  const starts = [asyncStart, syncStart].filter(value => value >= 0);
  assert.ok(starts.length, `${name} is missing`);
  const start = Math.min(...starts);
  const open = agent.indexOf('{', start);
  assert.ok(open > start, `${name} body is missing`);

  let depth = 0;
  for (let index = open; index < agent.length; index += 1) {
    if (agent[index] === '{') depth += 1;
    if (agent[index] === '}') depth -= 1;
    if (depth === 0) return agent.slice(start, index + 1);
  }
  assert.fail(`${name} body is not closed`);
}

function extractRawPowerShell(constName) {
  const marker = `const ${constName} =`;
  const start = agent.indexOf(marker);
  assert.ok(start >= 0, `${constName} is missing`);
  const rawStart = agent.indexOf('String.raw`', start);
  assert.ok(rawStart >= 0, `${constName} raw script start is missing`);
  const contentStart = rawStart + 'String.raw`'.length;
  const end = agent.indexOf('`;', contentStart);
  assert.ok(end > contentStart, `${constName} raw script end is missing`);
  return agent.slice(contentStart, end);
}

const normalizeText = value => String(value ?? '').trim();
const quietConsole = {
  log() {},
  warn() {},
  error() {}
};

function makeClaimFunction(requestOisAgentApi, consoleObject = quietConsole) {
  const source = [
    extractFunction('claimAdditionalBlowerRuntimeProbeRequests'),
    extractFunction('createBlowerRuntimeBatchContractError'),
    extractFunction('isBlowerRuntimeBatchCompatibilityError'),
    extractFunction('claimAdditionalBlowerRuntimeProbeRequestsLegacy')
  ].join('\n');
  return new Function(
    'requestOisAgentApi',
    'getOisAgentApiUrl',
    'normalizeOisAgentText',
    'BLOWER_RUNTIME_PROBE_BATCH_MAX_REQUESTS',
    'BLOWER_RUNTIME_PROBE_REQUEST_TYPE',
    'console',
    `${source}\nreturn claimAdditionalBlowerRuntimeProbeRequests;`
  )(
    requestOisAgentApi,
    (_config, query = {}) => query,
    normalizeText,
    24,
    'blower_runtime_probe',
    consoleObject
  );
}

function makeCompleteBatchFunction(requestOisAgentApi) {
  const source = [
    extractFunction('createBlowerRuntimeBatchContractError'),
    extractFunction('completeBlowerRuntimeProbeBatchRequests')
  ].join('\n');
  return new Function(
    'requestOisAgentApi',
    'getOisAgentApiUrl',
    'normalizeOisAgentText',
    'BLOWER_RUNTIME_PROBE_BATCH_MAX_REQUESTS',
    'BLOWER_RUNTIME_PROBE_REQUEST_TYPE',
    `${source}\nreturn completeBlowerRuntimeProbeBatchRequests;`
  )(
    requestOisAgentApi,
    () => 'https://example.test/api/ois-data-requests',
    normalizeText,
    24,
    'blower_runtime_probe'
  );
}

function makeCollectFunction(overrides = {}) {
  const dependencies = {
    waitOisAgent: async () => {},
    claimAdditionalBlowerRuntimeProbeRequests: async () => [],
    BLOWER_RUNTIME_PROBE_BATCH_COALESCE_MS: 400,
    BLOWER_RUNTIME_PROBE_BATCH_MAX_REQUESTS: 24,
    collectSingleBlowerRuntimeProbeValues: async () => ({ single: true }),
    collectBlowerRuntimeProbeBatchValues: async () => [],
    failOisAgentRequest: async () => {},
    completeBlowerRuntimeProbeBatchRequests: async (_config, outcomes) =>
      outcomes.map(({ requestId }) => ({
        requestId,
        ok: true,
        status: 'complete'
      })),
    isBlowerRuntimeBatchCompatibilityError: () => false,
    normalizeOisAgentText: normalizeText,
    settleClaimedBlowerRuntimeProbeRequest: async () => {},
    retryRejectedBlowerRuntimeProbeCompletions: async () => {},
    console: quietConsole,
    ...overrides
  };
  const names = Object.keys(dependencies);
  const factory = new Function(
    ...names,
    `${extractFunction('collectBlowerRuntimeProbeValues')}\nreturn collectBlowerRuntimeProbeValues;`
  );
  return factory(...Object.values(dependencies));
}

function makeRetryRejectedFunction(overrides = {}) {
  const dependencies = {
    completeOisAgentRequest: async () => {},
    waitOisAgent: async () => {},
    failOisAgentRequest: async () => {},
    console: quietConsole,
    ...overrides
  };
  const source = [
    extractFunction('completeClaimedBlowerRuntimeProbeRequestWithRetry'),
    extractFunction('settleClaimedBlowerRuntimeProbeRequest'),
    extractFunction('retryRejectedBlowerRuntimeProbeCompletions')
  ].join('\n');
  const names = Object.keys(dependencies);
  const factory = new Function(
    ...names,
    `${source}\nreturn retryRejectedBlowerRuntimeProbeCompletions;`
  );
  return factory(...Object.values(dependencies));
}

function successOutcome(requestId) {
  return {
    requestId,
    ok: true,
    result: {
      requestId,
      requestType: 'blower_runtime_probe',
      value: requestId
    }
  };
}

test('current one-second poll, fast Blower coalescing, and elapsed stages are explicit', () => {
  assert.match(agent, /const\s+OIS_AGENT_POLL_INTERVAL\s*=\s*1000\s*;/);
  assert.match(agent, /const\s+BLOWER_RUNTIME_PROBE_BATCH_COALESCE_MS\s*=\s*400\s*;/);
  for (const stage of ['coalesce', 'claim', 'Excel(single)', 'Excel(batch)', 'complete(batch)']) {
    assert.ok(agent.includes(`Blower Runtime 단계 ${stage}`), `${stage} timing log is missing`);
  }
  assert.match(agent, /coalesceStartedAt\s*=\s*Date\.now\(\)[\s\S]*?Date\.now\(\)\s*-\s*coalesceStartedAt/);
  assert.match(agent, /claimStartedAt\s*=\s*Date\.now\(\)[\s\S]*?Date\.now\(\)\s*-\s*claimStartedAt/);
  assert.match(agent, /excelStartedAt\s*=\s*Date\.now\(\)[\s\S]*?Date\.now\(\)\s*-\s*excelStartedAt/);
  assert.match(agent, /completeStartedAt\s*=\s*Date\.now\(\)[\s\S]*?Date\.now\(\)\s*-\s*completeStartedAt/);
});

test('normal claim uses one next_blower_batch GET and clamps the limit to 23', async () => {
  const calls = [];
  const claim = makeClaimFunction(async (_config, query) => {
    calls.push(query);
    return {
      ok: true,
      items: [
        { id: 'one', requestType: 'blower_runtime_probe' },
        { id: 'two', request_type: 'blower_runtime_probe' }
      ]
    };
  });

  const items = await claim({}, 999);
  assert.deepEqual(items.map(item => item.id), ['one', 'two']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, 'next_blower_batch');
  assert.equal(calls[0].limit, 23);
  assert.equal(calls[0].requestTypes, undefined);
});

test('claim falls back only for an old or contract-incompatible batch API', async () => {
  const calls = [];
  const warnings = [];
  const claim = makeClaimFunction(
    async (_config, query) => {
      calls.push(query);
      if (query.action === 'next_blower_batch') {
        const error = new Error('not deployed');
        error.status = 404;
        throw error;
      }
      if (calls.filter(call => call.action === 'next').length === 1) {
        return { ok: true, item: { id: 'legacy', requestType: 'blower_runtime_probe' } };
      }
      return { ok: true, item: null };
    },
    { ...quietConsole, warn: (...args) => warnings.push(args) }
  );

  const items = await claim({}, 2);
  assert.deepEqual(items.map(item => item.id), ['legacy']);
  assert.deepEqual(calls.map(call => call.action), [
    'next_blower_batch',
    'next',
    'next'
  ]);
  assert.equal(warnings.length, 1);

  const contractCalls = [];
  const contractClaim = makeClaimFunction(async (_config, query) => {
    contractCalls.push(query);
    if (query.action === 'next_blower_batch') return { ok: true, item: null };
    return { ok: true, item: null };
  });
  assert.deepEqual(await contractClaim({}, 1), []);
  assert.deepEqual(contractCalls.map(call => call.action), [
    'next_blower_batch',
    'next'
  ]);

  const oldRouteCalls = [];
  const oldRouteClaim = makeClaimFunction(async (_config, query) => {
    oldRouteCalls.push(query);
    if (query.action === 'next_blower_batch') {
      const error = new Error('로그인이 필요합니다.');
      error.status = 401;
      throw error;
    }
    return { ok: true, item: null };
  });
  assert.deepEqual(await oldRouteClaim({}, 1), []);
  assert.deepEqual(oldRouteCalls.map(call => call.action), [
    'next_blower_batch',
    'next'
  ]);

  let authenticationCalls = 0;
  const authenticationFailure = makeClaimFunction(async () => {
    authenticationCalls += 1;
    const error = new Error('OIS 연동 프로그램 인증키가 없습니다.');
    error.status = 401;
    throw error;
  });
  await assert.rejects(
    authenticationFailure({}, 1),
    /인증키가 없습니다/
  );
  assert.equal(authenticationCalls, 1);
});

test('claim does not multiply requests after an ordinary network failure', async () => {
  let calls = 0;
  const claim = makeClaimFunction(async () => {
    calls += 1;
    throw new TypeError('fetch failed');
  });
  await assert.rejects(claim({}, 23), /fetch failed/);
  assert.equal(calls, 1);
});

test('successful outcomes use one completion POST with exact result identity', async () => {
  const calls = [];
  const complete = makeCompleteBatchFunction(async (_config, url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      items: options.body.items.map(({ requestId }) => ({
        requestId,
        ok: true,
        status: 'complete',
        replayed: false
      }))
    };
  });
  const outcomes = [successOutcome('primary'), successOutcome('extra')];

  const acknowledgements = await complete({}, outcomes);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(
    calls[0].options.body.action,
    'complete_blower_runtime_probe_batch'
  );
  assert.deepEqual(
    calls[0].options.body.items,
    outcomes.map(({ requestId, result }) => ({ requestId, result }))
  );
  assert.deepEqual(acknowledgements.map(item => item.requestId), [
    'primary',
    'extra'
  ]);
});

test('completion validates the full envelope and returns valid per-item failures for targeted retry', async () => {
  const outcomes = [successOutcome('a'), successOutcome('b')];
  const duplicate = makeCompleteBatchFunction(async () => ({
    ok: true,
    items: [
      { requestId: 'a', ok: true, status: 'complete' },
      { requestId: 'a', ok: true, status: 'complete' }
    ]
  }));
  await assert.rejects(
    duplicate({}, outcomes),
    error => error.code === 'BLOWER_RUNTIME_BATCH_CONTRACT_MISMATCH'
  );

  const failed = makeCompleteBatchFunction(async () => ({
    ok: true,
    items: [{ requestId: 'a', ok: false, status: 'failed', httpStatus: 409, message: 'lease lost' }]
  }));
  assert.deepEqual(await failed({}, [outcomes[0]]), [
    { requestId: 'a', ok: false, status: 'failed', httpStatus: 409, message: 'lease lost' }
  ]);

  let networkCalls = 0;
  const invalidInput = makeCompleteBatchFunction(async () => {
    networkCalls += 1;
    return { ok: true, items: [] };
  });
  const mismatched = successOutcome('outer');
  mismatched.result.requestId = 'inner';
  await assert.rejects(invalidInput({}, [mismatched]), /요청 결과가 올바르지 않습니다/);
  assert.equal(networkCalls, 0);
});

test('collector batches all successes, fails only extra failures individually, and supports compatibility fallback', async () => {
  const completedBatches = [];
  const settled = [];
  const collect = makeCollectFunction({
    claimAdditionalBlowerRuntimeProbeRequests: async () => [{ id: 'extra' }],
    collectBlowerRuntimeProbeBatchValues: async () => [
      successOutcome('primary'),
      { requestId: 'extra', ok: false, error: 'calculation failed' }
    ],
    completeBlowerRuntimeProbeBatchRequests: async (_config, outcomes) => {
      completedBatches.push(outcomes);
      return outcomes.map(({ requestId }) => ({
        requestId,
        ok: true,
        status: 'complete'
      }));
    },
    settleClaimedBlowerRuntimeProbeRequest: async (_config, outcome) => {
      settled.push(outcome);
    }
  });

  const result = await collect({}, { id: 'primary' });
  assert.equal(result.requestId, 'primary');
  assert.deepEqual(completedBatches.map(batch => batch.map(item => item.requestId)), [
    ['primary']
  ]);
  assert.deepEqual(settled.map(item => [item.requestId, item.ok]), [
    ['extra', false]
  ]);

  const fallbackSettled = [];
  const fallbackWarnings = [];
  const fallback = makeCollectFunction({
    claimAdditionalBlowerRuntimeProbeRequests: async () => [{ id: 'extra' }],
    collectBlowerRuntimeProbeBatchValues: async () => [
      successOutcome('primary'),
      successOutcome('extra')
    ],
    completeBlowerRuntimeProbeBatchRequests: async () => {
      const error = new Error('old response');
      error.code = 'BLOWER_RUNTIME_BATCH_CONTRACT_MISMATCH';
      throw error;
    },
    isBlowerRuntimeBatchCompatibilityError: error =>
      error.code === 'BLOWER_RUNTIME_BATCH_CONTRACT_MISMATCH',
    retryRejectedBlowerRuntimeProbeCompletions: async (_config, outcomes) => {
      fallbackSettled.push(...outcomes.map(outcome => outcome.requestId));
    },
    console: {
      ...quietConsole,
      warn: (...args) => fallbackWarnings.push(args)
    }
  });

  assert.equal((await fallback({}, { id: 'primary' })).requestId, 'primary');
  assert.deepEqual(fallbackSettled.sort(), ['extra', 'primary']);
  assert.equal(fallbackWarnings.length, 1);
});

test('collector retries only valid batch acknowledgements reported as failed', async () => {
  const retried = [];
  const collect = makeCollectFunction({
    claimAdditionalBlowerRuntimeProbeRequests: async () => [
      { id: 'accepted-extra' },
      { id: 'rejected-extra' }
    ],
    collectBlowerRuntimeProbeBatchValues: async () => [
      successOutcome('primary'),
      successOutcome('accepted-extra'),
      successOutcome('rejected-extra')
    ],
    completeBlowerRuntimeProbeBatchRequests: async () => [
      { requestId: 'primary', ok: false, status: 'failed', httpStatus: 409, message: 'retry primary' },
      { requestId: 'accepted-extra', ok: true, status: 'complete' },
      { requestId: 'rejected-extra', ok: false, status: 'failed', httpStatus: 409, message: 'retry extra' }
    ],
    retryRejectedBlowerRuntimeProbeCompletions: async (_config, outcomes, primaryId) => {
      retried.push({
        ids: outcomes.map(outcome => outcome.requestId),
        primaryId
      });
    }
  });

  assert.equal((await collect({}, { id: 'primary' })).requestId, 'primary');
  assert.deepEqual(retried, [{
    ids: ['primary', 'rejected-extra'],
    primaryId: 'primary'
  }]);
});

test('lost batch-complete response retries every exact successful outcome individually', async () => {
  const retried = [];
  let batchPosts = 0;
  const collect = makeCollectFunction({
    claimAdditionalBlowerRuntimeProbeRequests: async () => [{ id: 'extra' }],
    collectBlowerRuntimeProbeBatchValues: async () => [
      successOutcome('primary'),
      successOutcome('extra')
    ],
    completeBlowerRuntimeProbeBatchRequests: async () => {
      batchPosts += 1;
      throw new TypeError('response stream lost');
    },
    isBlowerRuntimeBatchCompatibilityError: () => false,
    retryRejectedBlowerRuntimeProbeCompletions: async (_config, outcomes, primaryId) => {
      retried.push({ outcomes, primaryId });
    }
  });

  assert.equal((await collect({}, { id: 'primary' })).requestId, 'primary');
  assert.equal(batchPosts, 1);
  assert.equal(retried.length, 1);
  assert.equal(retried[0].primaryId, 'primary');
  assert.deepEqual(
    retried[0].outcomes.map(({ requestId, result }) => ({
      requestId,
      resultRequestId: result.requestId,
      requestType: result.requestType
    })),
    [
      { requestId: 'primary', resultRequestId: 'primary', requestType: 'blower_runtime_probe' },
      { requestId: 'extra', resultRequestId: 'extra', requestType: 'blower_runtime_probe' }
    ]
  );
});

test('rejected extra completion may fail individually, while primary exhaustion is thrown to main', async () => {
  const completeCalls = [];
  const failedIds = [];
  const retry = makeRetryRejectedFunction({
    completeOisAgentRequest: async (_config, requestId) => {
      completeCalls.push(requestId);
      if (requestId === 'extra') throw new Error('extra still rejected');
    },
    failOisAgentRequest: async (_config, requestId) => {
      failedIds.push(requestId);
    }
  });
  await retry({}, [successOutcome('primary'), successOutcome('extra')], 'primary');
  assert.equal(completeCalls.filter(id => id === 'primary').length, 1);
  assert.equal(completeCalls.filter(id => id === 'extra').length, 3);
  assert.deepEqual(failedIds, ['extra']);

  const primaryFailures = [];
  const rejectPrimary = makeRetryRejectedFunction({
    completeOisAgentRequest: async (_config, requestId) => {
      throw new Error(`${requestId} still rejected`);
    },
    failOisAgentRequest: async (_config, requestId) => {
      primaryFailures.push(requestId);
    }
  });
  await assert.rejects(
    rejectPrimary({}, [successOutcome('primary')], 'primary'),
    /primary still rejected/
  );
  assert.deepEqual(primaryFailures, []);
});

test('single and batch PowerShell shorten only graceful waits and retain verified pinned-process kills', () => {
  for (const name of [
    'DATAPARC_BLOWER_RUNTIME_PROBE_POWERSHELL_SCRIPT',
    'DATAPARC_BLOWER_RUNTIME_BATCH_POWERSHELL_SCRIPT'
  ]) {
    const script = extractRawPowerShell(name);
    assert.doesNotMatch(script, /AddSeconds\((?:12|25)\)/);
    assert.match(
      script,
      /Wait-ProbePinnedProcessExit\s+\$launchedExcelProcess\s+2000[\s\S]*?Test-OwnedProbeExcelIdentity\s+\$ownedExcelPid\s+\$ownedExcelStartTicks\s+\$ownedExcelPath\s+\$ownedExcelSessionId[\s\S]*?\$launchedExcelProcess\.Kill\(\)/
    );
    assert.doesNotMatch(script, /Stop-Process\s+-Id\s+\$ownedExcelPid/);
    assert.match(script, /Wait-ProbePinnedProcessExit\s+\$launchedExcelProcess\s+5000/);
    assert.match(script, /\$launchedExcelProcess\.Dispose\(\)/);
    assert.match(
      script,
      /\$hostExitDeadline\s*=\s*\[datetime\]::UtcNow\.AddSeconds\(2\)[\s\S]*?Test-ProbeHostSignature\s+\$ownedHostSnapshot[\s\S]*?\$ownedHostProcess\s*=\s*Get-Process[\s\S]*?\[void\]\$ownedHostProcess\.Handle[\s\S]*?\$ownedHostProcess\.Kill\(\)[\s\S]*?Wait-ProbePinnedProcessExit\s+\$ownedHostProcess\s+5000/
    );
    assert.doesNotMatch(script, /Stop-Process\s+-Id\s+\(\[int\]\$ownedHostSnapshot\.ProcessId\)/);
    assert.match(script, /Test-ProbeExactProcessUniverse\s+\$baselineExcelSignatures\s+\$finalExcelPids/);
    assert.match(script, /Test-ProbeExactProcessUniverse\s+\$baselineHostSignatures\s+\$finalHostPids/);
    assert.match(script, /Wait-ProbeProcessExit[\s\S]*?AddSeconds\(1\)/);
    assert.match(script, /\$lateOwnedHosts\.Count\s+-gt\s+1[\s\S]*?DataPARC Host가 둘 이상/);
  }
});
