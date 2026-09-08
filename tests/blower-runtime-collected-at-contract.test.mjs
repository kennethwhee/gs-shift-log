import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import { __oisDataRequestsTest } from "../functions/api/ois-data-requests.js";
import { __blowerHistoryTest } from "../functions/api/blower-history.js";

const REQUEST_ID = "blower-collected-at-contract";
const ASSET_TAG = "104ETH03AN602";
const SOURCE_TAG = "GSPOGE.ABB_DCS.003ETH03AN602XB04";
const NOW = new Date("2026-09-08T12:10:10.000Z");
const { buildBlowerRuntimeProbeChunks, normalizeBlowerRuntimeProbeResult: validateCompletion } = __oisDataRequestsTest;
const { normalizeDataParcRuntimeProbeResult: validateSync } = __blowerHistoryTest;

// Execute the actual Agent functions without starting its Windows services.
const agentSource = await readFile(new URL("../local-tools/ois-agent/ois-login.js", import.meta.url), "utf8");
const parserStart = agentSource.indexOf("function parseBlowerRuntimeProbeTimestamp(");
const parserEnd = agentSource.indexOf("async function collectBlowerRuntimeProbeValues(", parserStart);
assert.ok(parserStart >= 0 && parserEnd > parserStart, "Agent parser and normalizer must be available");
const agent = vm.createContext({ Array, Date, Error, Math, Number, String });
vm.runInContext(`
  const BLOWER_RUNTIME_PROBE_REQUEST_TYPE = "blower_runtime_probe";
  const BLOWER_RUNTIME_PROBE_ASSET_TAG = "${ASSET_TAG}";
  const BLOWER_RUNTIME_PROBE_DATAPARC_TAG = "${SOURCE_TAG}";
  const BLOWER_RUNTIME_PROBE_CHUNK_DAYS = 31;
  ${agentSource.slice(parserStart, parserEnd)}
  this.parseClaim = parseBlowerRuntimeProbeRequest;
  this.normalizeResult = normalizeBlowerRuntimeProbeResult;
`, agent);

function fixture(collectedAt) {
  const startAt = "2026-05-10T00:00:00+09:00";
  const endAt = "2026-09-08T21:10:00+09:00";
  const chunkWindows = buildBlowerRuntimeProbeChunks(startAt, endAt);
  assert.equal(chunkWindows.length, 4);
  const probe = {
    schemaVersion: 1,
    requestType: "blower_runtime_probe",
    requestId: REQUEST_ID,
    readOnly: true,
    assetTag: ASSET_TAG,
    dataParcTag: SOURCE_TAG,
    startAt,
    endAt,
    expectedLastReplacementAt: "2026-05-03T15:00:00.321Z",
    expectedCycleStartState: "legacy",
    expectedCycleStartedAt: "",
    expectedCycleStartRevision: "v13-restored-start-revision",
    expectedCycleRuntimeRevision: "existing-runtime-revision",
    chunkDays: 31,
    chunkCount: chunkWindows.length
  };
  // Synthetic chunk distribution: the field log provides only the four-chunk total.
  const chunkSeconds = [1080000, 1080000, 1080000, 1304330];
  const runningSeconds = chunkSeconds.reduce((sum, seconds) => sum + seconds, 0);
  const raw = {
    ...probe,
    ok: true,
    observedAt: endAt,
    collectedAt,
    completedChunkCount: chunkWindows.length,
    startState: "running",
    endState: "running",
    runningSeconds,
    totalRunningHours: Math.round(runningSeconds / 3600 * 1000000) / 1000000,
    chunks: chunkWindows.map((window, index) => ({
      ...window,
      startState: "running",
      endState: "running",
      runningSeconds: chunkSeconds[index],
      totalRunningHours: Math.round(chunkSeconds[index] / 3600 * 1000000) / 1000000
    }))
  };
  const item = { id: REQUEST_ID, targetDate: `v1|${ASSET_TAG}|${startAt}|${endAt}`, probe };
  return { raw, probe, expected: agent.parseClaim(item) };
}

function normalizeAgent(raw, expected) {
  return JSON.parse(JSON.stringify(agent.normalizeResult(raw, expected)));
}

function assertPipeline(collectedAt, expectedUtc) {
  const { raw, probe, expected } = fixture(collectedAt);
  const originalRaw = structuredClone(raw);
  const normalized = normalizeAgent(raw, expected);
  assert.deepEqual(raw, originalRaw, "normalization must not mutate the captured result");
  assert.equal(normalized.collectedAt, expectedUtc);
  assert.equal(normalized.runningSeconds, 4544330);
  assert.equal(normalized.chunkCount, 4);
  for (const key of [
    "requestId", "startAt", "endAt", "observedAt",
    "expectedLastReplacementAt", "expectedCycleStartState",
    "expectedCycleStartedAt", "expectedCycleStartRevision", "expectedCycleRuntimeRevision"
  ]) {
    assert.equal(normalized[key], raw[key], `${key} identity must remain exact`);
  }
  assert.deepEqual(normalized.chunks, raw.chunks, "chunk timestamp identities and totals must remain exact");
  const completion = validateCompletion(normalized, probe, REQUEST_ID, NOW);
  assert.ok(completion.result, completion.error);
  assert.equal(completion.result.collectedAt, expectedUtc);
  const sync = validateSync(completion.result, REQUEST_ID, NOW);
  assert.equal(sync.error, "", sync.error);
  assert.equal(sync.result.collectedAt, expectedUtc);
  assert.equal(sync.result.runningSeconds, 4544330);
  assert.equal(sync.result.isRunning, true);
}

test("PowerShell seven-digit UTC timestamp passes Agent, completion API, and history sync", () => {
  assertPipeline("2026-09-08T12:10:05.1234567Z", "2026-09-08T12:10:05.123Z");
});

test("PowerShell seven-digit KST timestamp preserves the instant through both APIs", () => {
  assertPipeline("2026-09-08T21:10:05.1234567+09:00", "2026-09-08T12:10:05.123Z");
});

test("millisecond and second-only timestamps remain valid", () => {
  assertPipeline("2026-09-08T12:10:05.123Z", "2026-09-08T12:10:05.123Z");
  assertPipeline("2026-09-08T21:10:05+09:00", "2026-09-08T12:10:05.000Z");
});

test("sub-millisecond digits do not round into a different second", () => {
  assertPipeline("2026-09-08T12:10:05.9999999Z", "2026-09-08T12:10:05.999Z");
});

test("unnormalized PowerShell output reproduces the original completion API rejection", () => {
  const { raw, probe } = fixture("2026-09-08T12:10:05.1234567Z");
  assert.match(validateCompletion(raw, probe, REQUEST_ID, NOW).error, /수집시각을 확인해 주세요/);
  assert.notEqual(validateSync(raw, REQUEST_ID, NOW).error, "");
});

test("invalid calendar dates, missing zones, and impossible offsets remain rejected", () => {
  for (const collectedAt of [
    "2026-02-30T12:10:05.1234567Z",
    "2026-09-08T12:10:05.1234567",
    "2026-09-08T12:10:05.1234567+14:01",
    "2026-09-08T12:10:05.1234567+09:60",
    "not-a-timestamp"
  ]) {
    const { raw, expected } = fixture(collectedAt);
    assert.throws(() => normalizeAgent(raw, expected), /수집시각/, collectedAt);
  }
});

test("a capture before the observation end remains rejected by the Agent", () => {
  const { raw, expected } = fixture("2026-09-08T12:09:59.9999999Z");
  assert.throws(() => normalizeAgent(raw, expected), /수집시각이 관측 종료시각보다 빠릅니다/);
});

test("normalization preserves the actual future timestamp so both APIs still reject clock skew", () => {
  const { raw, probe, expected } = fixture("2026-09-08T12:16:00.1234567Z");
  const normalized = normalizeAgent(raw, expected);
  assert.equal(normalized.collectedAt, "2026-09-08T12:16:00.123Z");
  assert.match(validateCompletion(normalized, probe, REQUEST_ID, NOW).error, /수집시각/);
  assert.equal(validateSync(normalized, REQUEST_ID, NOW).code, "DATAPARC_RUNTIME_PROBE_STALE");
});

test("history freshness remains enforced after a valid timestamp is normalized", () => {
  const { raw, probe, expected } = fixture("2026-09-08T12:10:05.1234567Z");
  const normalized = normalizeAgent(raw, expected);
  const later = new Date("2026-09-08T12:26:00.000Z");
  const completion = validateCompletion(normalized, probe, REQUEST_ID, later);
  assert.ok(completion.result, completion.error);
  assert.equal(validateSync(completion.result, REQUEST_ID, later).code, "DATAPARC_RUNTIME_PROBE_STALE");
});
