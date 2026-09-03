import assert from "node:assert/strict";
import test from "node:test";

import {
  __blowerHistoryTest
} from "../functions/api/blower-history.js";


const {
  normalizeDataParcRuntimeProbeResult
} = __blowerHistoryTest;


const REQUEST_ID = "probe-result-test-request";
const NOW = new Date("2026-08-01T15:00:10.000Z");


function validProbeResult(overrides = {}) {
  const base = {
    schemaVersion: 1,
    requestType: "blower_runtime_probe",
    requestId: REQUEST_ID,
    ok: true,
    readOnly: true,
    assetTag: "104ETH03AN602",
    dataParcTag: "GSPOGE.ABB_DCS.003ETH03AN602XB04",
    startAt: "2026-08-01T00:00:00+09:00",
    endAt: "2026-08-02T00:00:00+09:00",
    observedAt: "2026-08-02T00:00:00+09:00",
    collectedAt: "2026-08-02T00:00:05+09:00",
    expectedLastReplacementAt: "2026-07-31T15:00:00.000Z",
    expectedCycleStartState: "started",
    expectedCycleStartedAt: "2026-08-01T00:00:00+09:00",
    expectedCycleStartRevision: "cycle-start-revision-1",
    expectedCycleRuntimeRevision: "cycle-runtime-revision-1",
    startState: "stopped",
    endState: "running",
    totalRunningHours: 2,
    runningSeconds: 7200,
    chunkDays: 31,
    chunkCount: 1,
    completedChunkCount: 1,
    chunks: [
      {
        index: 1,
        startAt: "2026-08-01T00:00:00+09:00",
        endAt: "2026-08-02T00:00:00+09:00",
        startState: "stopped",
        endState: "running",
        totalRunningHours: 2,
        runningSeconds: 7200
      }
    ]
  };

  return {
    ...base,
    ...overrides
  };
}


function validate(raw, requestId = REQUEST_ID, now = NOW) {
  return normalizeDataParcRuntimeProbeResult(raw, requestId, now);
}


test("accepts a complete exact-tag result and derives current running state", () => {
  const validation = validate(validProbeResult());

  assert.equal(validation.error, "");
  assert.equal(validation.result.requestId, REQUEST_ID);
  assert.equal(validation.result.assetTag, "104ETH03AN602");
  assert.equal(
    validation.result.dataParcTag,
    "GSPOGE.ABB_DCS.003ETH03AN602XB04"
  );
  assert.equal(validation.result.startAt, "2026-07-31T15:00:00.000Z");
  assert.equal(validation.result.endAt, "2026-08-01T15:00:00.000Z");
  assert.equal(validation.result.runningSeconds, 7200);
  assert.equal(validation.result.totalRunningHours, 2);
  assert.equal(validation.result.isRunning, true);
});


test("accepts a legitimate zero-runtime stopped result with no positive interval", () => {
  const raw = validProbeResult({
    startState: "stopped",
    endState: "stopped",
    totalRunningHours: 0,
    runningSeconds: 0,
    chunks: [
      {
        index: 1,
        startAt: "2026-08-01T00:00:00+09:00",
        endAt: "2026-08-02T00:00:00+09:00",
        startState: "stopped",
        endState: "stopped",
        totalRunningHours: 0,
        runningSeconds: 0
      }
    ]
  });

  const validation = validate(raw);

  assert.equal(validation.error, "");
  assert.equal(validation.result.totalRunningHours, 0);
  assert.equal(validation.result.runningSeconds, 0);
  assert.equal(validation.result.isRunning, false);
});


test("rejects unknown, numeric, and otherwise non-binary end states", () => {
  for (const endState of ["unknown", "1", 1, true, null]) {
    const raw = validProbeResult({ endState });
    raw.chunks = [{ ...raw.chunks[0], endState }];

    const validation = validate(raw);
    assert.notEqual(validation.error, "", `endState=${String(endState)} must fail`);
    assert.equal(validation.result, null);
  }
});


test("rejects a mismatched request, asset, source TAG, or writable result", () => {
  const invalidResults = [
    validProbeResult({ requestId: "different-request" }),
    validProbeResult({ assetTag: "104ETH03AN601" }),
    validProbeResult({ dataParcTag: "CLIENT.SUPPLIED.TAG" }),
    validProbeResult({ readOnly: false })
  ];

  for (const raw of invalidResults) {
    const validation = validate(raw);
    assert.notEqual(validation.error, "");
    assert.equal(validation.result, null);
  }
});


test("rejects results outside the server freshness and future-skew window", () => {
  assert.notEqual(
    validate(
      validProbeResult(),
      REQUEST_ID,
      new Date("2026-08-01T15:16:00.000Z")
    ).error,
    ""
  );

  assert.notEqual(
    validate(
      validProbeResult(),
      REQUEST_ID,
      new Date("2026-08-01T14:54:59.000Z")
    ).error,
    ""
  );
});


test("rejects impossible duration totals and sub-second running values", () => {
  const invalidResults = [
    validProbeResult({
      totalRunningHours: 25,
      runningSeconds: 90000,
      chunks: [{
        ...validProbeResult().chunks[0],
        totalRunningHours: 25,
        runningSeconds: 90000
      }]
    }),
    validProbeResult({ runningSeconds: 7200.5 }),
    validProbeResult({ totalRunningHours: 3 }),
    validProbeResult({ runningSeconds: -1 })
  ];

  for (const raw of invalidResults) {
    const validation = validate(raw);
    assert.notEqual(validation.error, "");
    assert.equal(validation.result, null);
  }
});


test("rejects non-contiguous chunks and any single chunk over 31 days", () => {
  const overlong = validProbeResult({
    endAt: "2026-09-02T00:00:01+09:00",
    observedAt: "2026-09-02T00:00:01+09:00",
    collectedAt: "2026-09-02T00:00:02+09:00",
    totalRunningHours: 0,
    runningSeconds: 0,
    chunks: [{
      index: 1,
      startAt: "2026-08-01T00:00:00+09:00",
      endAt: "2026-09-02T00:00:01+09:00",
      startState: "stopped",
      endState: "running",
      totalRunningHours: 0,
      runningSeconds: 0
    }]
  });

  assert.notEqual(validate(overlong).error, "");

  const discontinuous = validProbeResult({
    endAt: "2026-08-03T00:00:00+09:00",
    observedAt: "2026-08-03T00:00:00+09:00",
    collectedAt: "2026-08-03T00:00:05+09:00",
    totalRunningHours: 2,
    runningSeconds: 7200,
    chunkCount: 2,
    completedChunkCount: 2,
    chunks: [
      {
        index: 1,
        startAt: "2026-08-01T00:00:00+09:00",
        endAt: "2026-08-02T00:00:00+09:00",
        startState: "stopped",
        endState: "running",
        totalRunningHours: 1,
        runningSeconds: 3600
      },
      {
        index: 2,
        startAt: "2026-08-02T00:00:01+09:00",
        endAt: "2026-08-03T00:00:00+09:00",
        startState: "running",
        endState: "running",
        totalRunningHours: 1,
        runningSeconds: 3600
      }
    ]
  });

  assert.notEqual(validate(discontinuous).error, "");
});
