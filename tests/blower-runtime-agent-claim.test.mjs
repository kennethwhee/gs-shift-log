import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";


const [queueSource, agentSource] = await Promise.all([
  readFile(
    new URL("../functions/api/ois-data-requests.js", import.meta.url),
    "utf8"
  ),
  readFile(
    new URL("../local-tools/ois-agent/ois-login.js", import.meta.url),
    "utf8"
  )
]);


function balancedBlock(source, openingIndex, openCharacter, closeCharacter) {
  let depth = 0;
  let quote = "";
  let escaped = false;

  for (let index = openingIndex; index < source.length; index += 1) {
    const character = source[index];

    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }

    if (["\"", "'", "`"].includes(character)) {
      quote = character;
      continue;
    }

    if (character === openCharacter) depth += 1;
    if (character === closeCharacter) depth -= 1;
    if (depth === 0) return source.slice(openingIndex, index + 1);
  }

  assert.fail(`unbalanced ${openCharacter}${closeCharacter} block`);
}


function extractFunction(source, name) {
  const declaration = new RegExp(
    `(?:async\\s+)?function\\s+${name}\\s*\\(`
  ).exec(source);
  assert.ok(declaration, `${name} function is missing`);

  const parametersStart = source.indexOf("(", declaration.index);
  const parameters = balancedBlock(source, parametersStart, "(", ")");
  const bodyStart = source.indexOf(
    "{",
    parametersStart + parameters.length
  );
  const body = balancedBlock(source, bodyStart, "{", "}");
  return source.slice(declaration.index, bodyStart + body.length);
}


function plain(value) {
  return JSON.parse(JSON.stringify(value));
}


function buildQueueProbe(row) {
  const context = vm.createContext({ String, Number });
  vm.runInContext(`
    const BLOWER_RUNTIME_PROBE_SCHEMA_VERSION = 1;
    const BLOWER_RUNTIME_PROBE_REQUEST_TYPE = "blower_runtime_probe";
    const BLOWER_RUNTIME_PROBE_CHUNK_DAYS = 31;
    ${extractFunction(queueSource, "normalizeText")}
    ${extractFunction(queueSource, "convertBlowerRuntimeProbeIntentRow")}
    this.convertIntent = convertBlowerRuntimeProbeIntentRow;
  `, context);

  return plain(context.convertIntent(row));
}


function parseAgentClaim(item) {
  const context = vm.createContext({
    Array,
    Date,
    Error,
    Math,
    Number,
    String
  });
  vm.runInContext(`
    const BLOWER_RUNTIME_PROBE_REQUEST_TYPE = "blower_runtime_probe";
    const BLOWER_RUNTIME_PROBE_ASSET_TAG = "104ETH03AN602";
    const BLOWER_RUNTIME_PROBE_DATAPARC_TAG = "GSPOGE.ABB_DCS.003ETH03AN602XB04";
    const BLOWER_RUNTIME_PROBE_CHUNK_DAYS = 31;
    ${extractFunction(agentSource, "parseBlowerRuntimeProbeTimestamp")}
    ${extractFunction(agentSource, "parseBlowerRuntimeProbeRequest")}
    this.parseClaim = parseBlowerRuntimeProbeRequest;
  `, context);

  return plain(context.parseClaim(item));
}


function normalizeAgentResult(raw, expected) {
  const context = vm.createContext({
    Array,
    Date,
    Error,
    Math,
    Number,
    String
  });
  vm.runInContext(`
    const BLOWER_RUNTIME_PROBE_REQUEST_TYPE = "blower_runtime_probe";
    ${extractFunction(agentSource, "parseBlowerRuntimeProbeTimestamp")}
    ${extractFunction(agentSource, "normalizeBlowerRuntimeProbeResult")}
    this.normalizeResult = normalizeBlowerRuntimeProbeResult;
  `, context);

  return plain(context.normalizeResult(raw, expected));
}


function intentRow(overrides = {}) {
  return {
    request_id: "claim-probe-1",
    schema_version: 1,
    asset_tag: "104ETH03AN602",
    dataparc_tag: "GSPOGE.ABB_DCS.003ETH03AN602XB04",
    window_start: "2026-06-01T00:00:00+09:00",
    window_end: "2026-08-03T00:00:01+09:00",
    chunk_days: 31,
    chunk_count: 3,
    expected_last_replacement_at: "2026-05-31T00:00:00+09:00",
    expected_cycle_start_state: "started",
    expected_cycle_started_at: "2026-06-01T00:00:00.500+09:00",
    expected_cycle_start_revision: "cycle-start-r1",
    expected_cycle_runtime_revision: "cycle-runtime-r1",
    ...overrides
  };
}


function claimItem(probe, overrides = {}) {
  return {
    id: probe.requestId,
    requestType: "blower_runtime_probe",
    targetDate: `v1|104ETH03AN602|${probe.startAt}|${probe.endAt}`,
    probe,
    ...overrides
  };
}


function zeroRuntimeCapture(expected, overrides = {}) {
  const chunks = [
    ["2026-06-01T00:00:00+09:00", "2026-07-02T00:00:00+09:00"],
    ["2026-07-02T00:00:00+09:00", "2026-08-02T00:00:00+09:00"],
    ["2026-08-02T00:00:00+09:00", "2026-08-03T00:00:01+09:00"]
  ].map(([startAt, endAt], index) => ({
    index: index + 1,
    startAt,
    endAt,
    startState: "stopped",
    endState: "stopped",
    totalRunningHours: 0,
    runningSeconds: 0
  }));

  return {
    schemaVersion: 1,
    requestType: "blower_runtime_probe",
    requestId: expected.requestId,
    ok: true,
    readOnly: true,
    assetTag: expected.assetTag,
    dataParcTag: expected.dataParcTag,
    startAt: expected.startAt,
    endAt: expected.endAt,
    observedAt: expected.endAt,
    expectedLastReplacementAt: expected.expectedLastReplacementAt,
    expectedCycleStartState: expected.expectedCycleStartState,
    expectedCycleStartedAt: expected.expectedCycleStartedAt,
    expectedCycleStartRevision: expected.expectedCycleStartRevision,
    expectedCycleRuntimeRevision: expected.expectedCycleRuntimeRevision,
    chunkDays: 31,
    chunkCount: 3,
    completedChunkCount: 3,
    startState: "stopped",
    endState: "stopped",
    totalRunningHours: 0,
    runningSeconds: 0,
    collectedAt: expected.endAt,
    chunks,
    ...overrides
  };
}


test("queue intent becomes canonical item.probe and the Agent consumes it unchanged", () => {
  const attachSource = extractFunction(
    queueSource,
    "attachBlowerRuntimeProbeIntent"
  );
  assert.match(attachSource, /\.\.\.requestItem,[\s\S]{0,80}\bprobe\b/);

  const probe = buildQueueProbe(intentRow());
  const item = claimItem(probe);
  const parsed = parseAgentClaim(item);

  assert.equal(item.probe.requestId, item.id);
  assert.equal(parsed.requestId, item.id);
  assert.equal(parsed.assetTag, "104ETH03AN602");
  assert.equal(
    parsed.dataParcTag,
    "GSPOGE.ABB_DCS.003ETH03AN602XB04"
  );
  assert.equal(parsed.startAt, probe.startAt);
  assert.equal(parsed.endAt, probe.endAt);
  assert.equal(parsed.chunkDays, 31);
  assert.equal(parsed.expectedChunkCount, 3);
  assert.equal(parsed.expectedCycleStartedAt, probe.expectedCycleStartedAt);
  assert.equal(parsed.expectedCycleRuntimeRevision, "cycle-runtime-r1");
});


test("Agent fails closed when canonical claim data is absent or conflicts with the queue key", () => {
  const probe = buildQueueProbe(intentRow());

  assert.throws(
    () => parseAgentClaim({
      ...claimItem(probe),
      probe: undefined
    }),
    /probe intent/i
  );

  assert.throws(
    () => parseAgentClaim(claimItem({
      ...probe,
      requestId: "different-request"
    }, {
      id: probe.requestId
    }))
  );

  assert.throws(
    () => parseAgentClaim(claimItem({
      ...probe,
      dataParcTag: "CLIENT.SUPPLIED.TAG"
    }))
  );

  assert.throws(
    () => parseAgentClaim(claimItem(probe, {
      targetDate: `v1|104ETH03AN602|2026-06-01T00:00:01+09:00|${probe.endAt}`
    }))
  );
});


test("Agent rejects timezone-free claim windows and an incorrect 31-day chunk count", () => {
  const probe = buildQueueProbe(intentRow());

  assert.throws(
    () => parseAgentClaim(claimItem({
      ...probe,
      startAt: "2026-06-01T00:00:00"
    }, {
      targetDate: `v1|104ETH03AN602|2026-06-01T00:00:00|${probe.endAt}`
    })),
    /RFC3339/
  );

  assert.throws(
    () => parseAgentClaim(claimItem({
      ...probe,
      chunkCount: 2
    }))
  );
});


test("Agent accepts a complete zero-runtime bridge result and rejects non-binary state or totals", () => {
  const probe = buildQueueProbe(intentRow());
  const expected = parseAgentClaim(claimItem(probe));
  const zero = zeroRuntimeCapture(expected);
  const normalized = normalizeAgentResult(zero, expected);

  assert.equal(normalized.runningSeconds, 0);
  assert.equal(normalized.totalRunningHours, 0);
  assert.equal(normalized.startState, "stopped");
  assert.equal(normalized.endState, "stopped");
  assert.equal(normalized.chunks.length, 3);

  const nonBinary = zeroRuntimeCapture(expected);
  nonBinary.endState = 1;
  nonBinary.chunks[2].endState = 1;
  assert.throws(() => normalizeAgentResult(nonBinary, expected));

  const impossibleTotal = zeroRuntimeCapture(expected, {
    totalRunningHours: 1,
    runningSeconds: 3600
  });
  assert.throws(() => normalizeAgentResult(impossibleTotal, expected));
});
