import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../local-tools/ois-agent/ois-login.js", import.meta.url), "utf8");
const declarationsStart = source.indexOf("const BLOWER_RUNTIME_PROBE_REQUEST_TYPE =");
const declarationsEnd = source.indexOf("/*", declarationsStart);
const parserStart = source.indexOf("function parseBlowerRuntimeProbeTimestamp(");
const parserEnd = source.indexOf("async function collectBlowerRuntimeProbeValues(", parserStart);
assert.ok(declarationsStart >= 0 && declarationsEnd > declarationsStart);
assert.ok(parserStart >= 0 && parserEnd > parserStart);
const agent = vm.createContext({ Array, Date, Error, Math, Number, Set, String });
vm.runInContext(`
  ${source.slice(declarationsStart, declarationsEnd)}
  ${source.slice(parserStart, parserEnd)}
  this.parseClaim = parseBlowerRuntimeProbeRequest;
  this.normalizeResult = normalizeBlowerRuntimeProbeResult;
`, agent);

const ASSETS = [
  "104ETH03AN601", "104ETH03AN602",
  "104ETG30AN601", "104ETG30AN602", "204ETG30AN601", "204ETG30AN602",
  "104SDF01AN001", "104SDF01AN002", "204SDF01AN001", "204SDF01AN002",
  "204LMDF01AN001"
];
const FIXED_ASSET = "104ETH03AN602";
const FIXED_SOURCE = "GSPOGE.ABB_DCS.003ETH03AN602XB04";
// Synthetic fixture sources deliberately cannot be inferred from the equipment TAG.
const CONFIRMED_SOURCE = "GSPOGE.ABB_DCS.FIELD_CONFIRMED_RUN_01";
const START = "2026-09-08T00:00:00+09:00";
const END = "2026-09-08T02:00:00+09:00";

function item(assetTag = "104ETH03AN601", dataParcTag = assetTag === FIXED_ASSET ? FIXED_SOURCE : CONFIRMED_SOURCE) {
  return {
    id: "multi-runtime-agent-test",
    targetDate: `v1|${assetTag}|${START}|${END}`,
    probe: {
      schemaVersion: 1,
      requestType: "blower_runtime_probe",
      requestId: "multi-runtime-agent-test",
      readOnly: true,
      assetTag,
      dataParcTag,
      startAt: START,
      endAt: END,
      expectedLastReplacementAt: "2026-05-03T15:00:00.123Z",
      expectedCycleStartState: "legacy",
      expectedCycleStartedAt: "",
      expectedCycleStartRevision: "",
      expectedCycleRuntimeRevision: "v13-runtime-revision",
      chunkDays: 31,
      chunkCount: 1
    }
  };
}

function rawResult(claim, state = "running") {
  const runningSeconds = state === "running" ? 3600 : 0;
  const totalRunningHours = runningSeconds / 3600;
  return {
    ...claim.probe,
    ok: true,
    observedAt: END,
    collectedAt: "2026-09-07T17:00:05.1234567Z",
    completedChunkCount: 1,
    startState: state,
    endState: state,
    runningSeconds,
    totalRunningHours,
    chunks: [{ index: 1, startAt: START, endAt: END, startState: state, endState: state, runningSeconds, totalRunningHours }]
  };
}

test("all eleven supported assets use the exact confirmed queue source without deriving it", () => {
  for (const asset of ASSETS) {
    const claim = item(asset);
    const expected = agent.parseClaim(claim);
    assert.equal(expected.assetTag, asset);
    assert.equal(expected.dataParcTag, claim.probe.dataParcTag);
    const result = agent.normalizeResult(rawResult(claim), expected);
    assert.equal(result.assetTag, asset);
    assert.equal(result.dataParcTag, claim.probe.dataParcTag);
    assert.equal(result.runningSeconds, 3600);
    assert.equal(result.collectedAt, "2026-09-07T17:00:05.123Z");
  }
});

test("the working Silo B source stays fixed and legacy cycle metadata remains accepted", () => {
  const claim = item(FIXED_ASSET);
  assert.equal(agent.parseClaim(claim).dataParcTag, FIXED_SOURCE);
  claim.probe.dataParcTag = CONFIRMED_SOURCE;
  assert.throws(() => agent.parseClaim(claim), /TAG 계약/);
  for (const asset of ASSETS.filter(value => value !== FIXED_ASSET)) {
    assert.throws(() => agent.parseClaim(item(asset, FIXED_SOURCE)), /TAG 계약/);
  }
});

test("the Agent rejects unsupported assets and conflicting canonical queue identities", () => {
  for (const asset of ["104HHL60AP611", "104HHL10AN611", "204LMDF01AN002", "104ETH03AN603", "", "104eth03an601"]) {
    assert.throws(() => agent.parseClaim(item(asset)), /payload/);
  }
  for (const mutation of [
    claim => { claim.probe.assetTag = "104ETH03AN602"; },
    claim => { claim.probe.assetTag += " "; },
    claim => { claim.probe.requestId = "other-request"; },
    claim => { claim.probe.startAt = "2026-09-08T00:01:00+09:00"; },
    claim => { claim.probe.endAt = "2026-09-08T03:00:00+09:00"; },
    claim => { claim.probe.chunkCount = 2; },
    claim => { claim.probe.readOnly = false; },
    claim => { delete claim.probe; }
  ]) {
    const claim = item();
    mutation(claim);
    assert.throws(() => agent.parseClaim(claim));
  }
});

test("missing, malformed, and formula-injection source TAGs never reach Excel", () => {
  const invalidSources = [
    undefined, null, 123, {}, new String(CONFIRMED_SOURCE), "",
    "GSPOGE.ABB_DCS.", "GSPOGE.ABB_DCS._RUN", "GSPOGE.ABB_DCS.RUN/01",
    "GSPOGE.ABB_DCS.lowercase", "gsPoge.ABB_DCS.RUN", "OTHER.ABB_DCS.RUN",
    ` ${CONFIRMED_SOURCE}`, `${CONFIRMED_SOURCE} `, `${CONFIRMED_SOURCE}\n`,
    `${CONFIRMED_SOURCE}\r\n`, `${CONFIRMED_SOURCE}\u0000`,
    'GSPOGE.ABB_DCS.RUN");WEBSERVICE("https://example.invalid")',
    "GSPOGE.ABB_DCS.RUN`n", "GSPOGE.ABB_DCS.RUN|1", "GSPOGE.ABB_DCS.RUN;1"
  ];
  for (const value of invalidSources) {
    const claim = item();
    claim.probe.dataParcTag = value;
    assert.throws(() => agent.parseClaim(claim), /TAG 계약/);
  }
  const prefix = "GSPOGE.ABB_DCS.";
  const maxLength = prefix + "A".repeat(200 - prefix.length);
  assert.equal(agent.parseClaim(item(ASSETS[0], maxLength)).dataParcTag, maxLength);
  assert.throws(() => agent.parseClaim(item(ASSETS[0], `${maxLength}A`)), /TAG 계약/);
  assert.equal(agent.parseClaim(item(ASSETS[0], "GSPOGE.ABB_DCS.RUN_01.STATE-1")).dataParcTag, "GSPOGE.ABB_DCS.RUN_01.STATE-1");
});

test("every dynamic result must match its requested asset, source, window, and binary state", () => {
  const claim = item("204LMDF01AN001");
  const expected = agent.parseClaim(claim);
  const stopped = agent.normalizeResult(rawResult(claim, "stopped"), expected);
  assert.equal(stopped.runningSeconds, 0);
  assert.equal(stopped.endState, "stopped");
  for (const mutation of [
    raw => { raw.assetTag = "104ETH03AN601"; },
    raw => { raw.dataParcTag = "GSPOGE.ABB_DCS.DIFFERENT_CONFIRMED_RUN"; },
    raw => { raw.requestId = "other-result"; },
    raw => { raw.observedAt = START; },
    raw => { raw.chunks[0].endState = "unknown"; },
    raw => { raw.runningSeconds = 999999; },
    raw => { raw.collectedAt = "2026-09-07T16:59:59.9999999Z"; }
  ]) {
    const raw = rawResult(claim);
    mutation(raw);
    assert.throws(() => agent.normalizeResult(raw, expected));
  }
});

test("the PowerShell boundary has the same eleven assets, strict source grammar, and immutable B mapping", () => {
  const start = source.indexOf("$allowedProbeAssetTags = @(");
  const end = source.indexOf("$chunkDays = 0", start);
  assert.ok(start > 0 && end > start);
  const guard = source.slice(start, end);
  const literalAssets = [...guard.slice(0, guard.indexOf("if (")).matchAll(/"(\d[A-Z0-9]+)"/g)].map(match => match[1]);
  assert.deepEqual(literalAssets, ASSETS);
  assert.match(guard, /\$allowedProbeAssetTags -cnotcontains \$assetTag/);
  assert.match(guard, /\$dataParcTag\.Length -gt 200/);
  assert.ok(guard.includes("'\\AGSPOGE\\.ABB_DCS\\.[A-Z0-9][A-Z0-9._-]*\\z'"));
  assert.ok(guard.includes('$assetTag -ceq "104ETH03AN602" -and'));
  assert.ok(guard.includes('$dataParcTag -cne "GSPOGE.ABB_DCS.003ETH03AN602XB04"'));
  assert.ok(guard.includes('$assetTag -cne "104ETH03AN602" -and'));
  assert.ok(guard.includes('$dataParcTag -ceq "GSPOGE.ABB_DCS.003ETH03AN602XB04"'));
  assert.match(guard, /throw /);
});
