import assert from "node:assert/strict";
import test from "node:test";

import {
  __oisDataRequestsTest
} from "../functions/api/ois-data-requests.js";


const {
  buildBlowerRuntimeProbeChunks,
  buildBlowerRuntimeProbeTargetDate,
  formatKstRfc3339,
  parseStrictRfc3339
} = __oisDataRequestsTest;


const ASSET_TAG = "104ETH03AN602";
const SOURCE_TAG = "GSPOGE.ABB_DCS.003ETH03AN602XB04";
const DAY_MS = 24 * 60 * 60 * 1000;


function durationMilliseconds(chunk) {
  return Date.parse(chunk.endAt) - Date.parse(chunk.startAt);
}


test("strict RFC3339 parsing rejects timezone-free and normalized-invalid dates", () => {
  assert.equal(parseStrictRfc3339("2026-09-01T00:00:00"), null);
  assert.equal(parseStrictRfc3339("2026-02-30T00:00:00+09:00"), null);
  assert.equal(parseStrictRfc3339("2026-09-01 00:00:00+09:00"), null);
  assert.equal(parseStrictRfc3339("2026-09-01T00:00:60+09:00"), null);

  const parsed = parseStrictRfc3339("2026-09-01T00:00:00+09:00");
  assert.equal(parsed.timestamp, Date.parse("2026-08-31T15:00:00.000Z"));
});


test("probe queue keys freeze the application asset but never carry a client source TAG", () => {
  const startAt = "2026-08-01T00:00:00+09:00";
  const endAt = "2026-08-02T00:00:00+09:00";
  const key = buildBlowerRuntimeProbeTargetDate(startAt, endAt);

  assert.equal(
    key,
    `v1|${ASSET_TAG}|${startAt}|${endAt}`
  );
  assert.equal(key.includes(SOURCE_TAG), false);
});


test("formats persisted Agent windows in explicit KST RFC3339 seconds", () => {
  assert.equal(
    formatKstRfc3339("2026-08-31T15:00:00.987Z"),
    "2026-09-01T00:00:00+09:00"
  );
});


test("splits a long cycle into consecutive requests no longer than 31 days", () => {
  const chunks = buildBlowerRuntimeProbeChunks(
    "2026-06-01T00:00:00+09:00",
    "2026-08-03T00:00:01+09:00"
  );

  assert.equal(chunks.length, 3);
  assert.equal(durationMilliseconds(chunks[0]), 31 * DAY_MS);
  assert.equal(durationMilliseconds(chunks[1]), 31 * DAY_MS);
  assert.equal(durationMilliseconds(chunks[2]), DAY_MS + 1000);

  for (let index = 0; index < chunks.length; index += 1) {
    assert.ok(durationMilliseconds(chunks[index]) > 0);
    assert.ok(durationMilliseconds(chunks[index]) <= 31 * DAY_MS);
    assert.equal(chunks[index].index, index + 1);

    if (index > 0) {
      assert.equal(chunks[index - 1].endAt, chunks[index].startAt);
    }
  }
});


test("accepts the exact 31-day boundary and rejects empty or reversed ranges", () => {
  const exact = buildBlowerRuntimeProbeChunks(
    "2026-08-01T00:00:00+09:00",
    "2026-09-01T00:00:00+09:00"
  );

  assert.equal(exact.length, 1);
  assert.equal(durationMilliseconds(exact[0]), 31 * DAY_MS);

  assert.deepEqual(
    buildBlowerRuntimeProbeChunks(
      "2026-09-01T00:00:00+09:00",
      "2026-09-01T00:00:00+09:00"
    ),
    []
  );
  assert.deepEqual(
    buildBlowerRuntimeProbeChunks(
      "2026-09-02T00:00:00+09:00",
      "2026-09-01T00:00:00+09:00"
    ),
    []
  );
});
