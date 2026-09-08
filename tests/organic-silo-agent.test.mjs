import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const { ORGANIC_SILO_REQUEST_TYPE, ORGANIC_SILO_TAGS, isOrganicQualityGood, organicDateInterval, normalizeOrganicSiloResult, createOrganicSiloCollector } = require("../local-tools/ois-agent/organic-silo-dataparc-agent.js");
const targetDate = "2026-09-01";
const interval = organicDateInterval(targetDate);
function fixture() {
  const samples = ORGANIC_SILO_TAGS.map((tag, index) => ({
    ...tag, date: targetDate, value: [5.8297, 0.0998, 0.8329][index], qualityText: "Raw, Good", qualityGood: true,
    validNonNegativeValue: true, returnedTimeText: `${targetDate} 00:00:00`, statistic: "End",
    periodStartKst: interval.intervalStartKst.replace("T", " "), periodEndKst: interval.intervalEndKst.replace("T", " ")
  }));
  const raw = {
    schemaVersion: 1, source: "dataparc_hidden_excel", mode: ORGANIC_SILO_REQUEST_TYPE, targetDate, runId: "a".repeat(32), ok: true, cleanupVerified: true, databaseWritten: false,
    allCellsReturned: true, allValuesValid: true, allQualitiesGood: true,
    aggregation: "End", step: "1D", qualityValidationVersion: "1.2", ...interval, samples,
    targetValues: { ...Object.fromEntries(samples.map(sample => [sample.key, sample.value])), organicSiloTotal: samples.reduce((sum, sample) => sum + sample.value, 0) }
  };
  const report = { schemaVersion: 1, mode: raw.mode, runId: raw.runId, targetDate, ok: true, cleanupVerified: true, timedOut: false,
    workerExitCode: 0, resultReceived: true, resultOk: true, failure: "", cleanupErrors: [], databaseWritten: false,
    ownedExcel: { ProcessId: 1234, Path: "C:\\Program Files\\Microsoft Office\\Office16\\EXCEL.EXE" }
  };
  return { raw, report };
}

test("observed Raw, Good is accepted; adverse, unknown and empty quality cannot pass", () => {
  for (const text of ["Good", "Raw, Good", " GOOD , raw "]) assert.equal(isOrganicQualityGood(text), true, text);
  for (const text of ["", null, 0, "Raw", "Not Good", "Bad", "Raw, Bad", "Raw, Uncertain", "Good, Bad", "Calculated, Good", "Raw, Good, Bad", "Good,", "Good, Good"]) assert.equal(isOrganicQualityGood(text), false, String(text));
});

test("normalization preserves unrounded values and computes exact three-Silo sum", () => {
  const { raw, report } = fixture();
  const result = normalizeOrganicSiloResult(raw, report, targetDate);
  assert.equal(result.organicSiloTotal, raw.targetValues.organicSiloTotal);
  assert.equal(result.organicDaySilo, 5.8297);
  assert.equal(result.samples.length, 3);
  assert.equal(result.source, "dataparc_hidden_excel");
  assert.equal(result.cleanupVerified, true);
  assert.equal(result.intervalEndKst, "2026-09-02T00:00:00+09:00");
});

test("completed report, matching execution, and owned Excel evidence are mandatory", () => {
  const mutations = [
    x => x.report.ok = false, x => x.report.cleanupVerified = false, x => x.report.timedOut = true,
    x => x.report.workerExitCode = 1, x => x.report.resultReceived = false, x => x.report.resultOk = false,
    x => x.report.cleanupErrors = ["Excel still alive"], x => x.report.cleanupErrors = null,
    x => x.report.failure = "prior failure", x => x.report.targetDate = "2026-08-31", x => x.report.runId = "b".repeat(32),
    x => x.report.ownedExcel = null, x => x.report.ownedExcel.Path = "C:\\Windows\\notepad.exe",
    x => x.raw.cleanupVerified = false, x => x.raw.databaseWritten = true
  ];
  for (const mutate of mutations) { const data = fixture(); mutate(data); assert.throws(() => normalizeOrganicSiloResult(data.raw, data.report, targetDate)); }
});

test("bad values, duplicates, swapped tags, mismatched totals and stale timestamps fail closed", () => {
  const mutations = [
    x => x.raw.schemaVersion = 2, x => x.raw.source = "excel",
    x => x.raw.samples.push({ ...x.raw.samples[0], date: "2026-08-01" }),
    x => x.raw.samples[0].value = null, x => x.raw.samples[0].value = "5.8297", x => x.raw.samples[0].value = -1,
    x => x.raw.samples[0].value = NaN, x => x.raw.samples[0].value = Infinity, x => x.raw.samples.pop(),
    x => x.raw.samples[1] = x.raw.samples[0], x => x.raw.samples[0].tag = x.raw.samples[1].tag,
    x => x.raw.samples[0].qualityText = "Bad", x => x.raw.samples[0].qualityGood = false,
    x => x.raw.samples[0].returnedTimeText = "2026-08-31 23:59:59", x => x.raw.samples[0].returnedTimeText = "2026-09-02 00:00:01",
    x => x.raw.targetValues.organicSiloTotal += 0.01, x => x.raw.targetValues.organicDaySilo += 0.01,
    x => x.raw.aggregation = "Avg", x => x.raw.intervalEndKst = "2026-10-01T00:00:00+09:00"
  ];
  for (const mutate of mutations) { const data = fixture(); mutate(data); assert.throws(() => normalizeOrganicSiloResult(data.raw, data.report, targetDate)); }
  assert.throws(() => organicDateInterval("2026-02-30"));
  assert.throws(() => organicDateInterval("2026-09-01; exit"));
  assert.equal(organicDateInterval("2026-12-31").intervalEndKst, "2027-01-01T00:00:00+09:00");
});

function harness(t, { timeoutMilliseconds = 1000 } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "organic-agent-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const scriptPath = path.join(directory, "worker with spaces.ps1");
  fs.writeFileSync(scriptPath, "# test controller");
  const children = [];
  const collect = createOrganicSiloCollector({ platform: "win32", scriptPath, runsDirectory: directory, timeoutMilliseconds, log() {},
    spawnProcess(executable, args, options) {
      assert.equal(options.shell, false);
      assert.equal(options.windowsHide, true);
      assert.equal(args[args.indexOf("-File") + 1], scriptPath);
      assert.equal(args[args.indexOf("-TargetDate") + 1], targetDate);
      assert.equal(path.win32.basename(executable), "powershell.exe");
      const child = new EventEmitter();
      child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => assert.fail("controller must retain cleanup ownership");
      child.directory = args[args.indexOf("-OutputDirectory") + 1];
      children.push(child);
      return child;
    }
  });
  const writeResults = child => {
    const { raw, report } = fixture();
    fs.writeFileSync(path.join(child.directory, "pilot-result.json"), JSON.stringify(raw));
    fs.writeFileSync(path.join(child.directory, "pilot-report.json"), JSON.stringify(report));
  };
  return { collect, children, writeResults };
}

test("valid result marker cannot complete before controller close and cleanup report", async t => {
  const { collect, children, writeResults } = harness(t);
  let settled = false;
  const promise = collect({}, { targetDate }).finally(() => { settled = true; });
  const child = children[0];
  writeResults(child);
  child.stdout.write("__ORGANIC_PILOT_RESULT__{}\n");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  child.emit("close", 0, null);
  assert.equal((await promise).cleanupVerified, true);
});

test("nonzero exit, missing report and missing stdout cannot submit values", async t => {
  for (const scenario of ["exit", "missing report", "missing stdout"]) {
    const { collect, children, writeResults } = harness(t);
    const promise = collect({}, { targetDate });
    const child = children[0];
    if (scenario !== "missing report") writeResults(child);
    if (scenario !== "missing stdout") child.stdout.write("PASS\n");
    child.emit("close", scenario === "exit" ? 1 : 0, null);
    await assert.rejects(promise, /진단 폴더/);
    assert.equal(fs.existsSync(path.join(child.directory, "controller-stdout.log")), true);
  }
});

test("soft timeout leaves controller cleanup running and blocks repeat launch until close", async t => {
  const { collect, children, writeResults } = harness(t, { timeoutMilliseconds: 15 });
  const promise = collect({}, { targetDate });
  const child = children[0];
  writeResults(child); child.stdout.write("still cleaning\n");
  await assert.rejects(promise, /대기시간/);
  await assert.rejects(collect({}, { targetDate }), /정리 중/);
  assert.equal(children.length, 1);
  child.emit("close", 0, null);
  const next = collect({}, { targetDate });
  writeResults(children[1]); children[1].stdout.write("PASS\n"); children[1].emit("close", 0, null);
  assert.equal((await next).samples.length, 3);
});

test("new request uses Excel lanes and dispatch without reclassifying Daily DATA", () => {
  const agent = fs.readFileSync(new URL("../local-tools/ois-agent/ois-login.js", import.meta.url), "utf8");
  const extract = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  const laneArrays = [...agent.matchAll(/const excelRequestTypes = \[([\s\S]*?)\];/g)];
  assert.equal(laneArrays.length, 2);
  for (const match of laneArrays) assert.match(match[1], /ORGANIC_SILO_REQUEST_TYPE/);
  const helpers = extract(agent, "function isDailyDataExcelRequestType(", "/* =========================================================\n  요청 유형 표시 이름");
  const context = vm.createContext({ ORGANIC_SILO_REQUEST_TYPE, BLOWER_RUNTIME_PROBE_REQUEST_TYPE: "blower_runtime_probe", normalizeOisAgentText: value => String(value || "").trim() });
  vm.runInContext(helpers, context);
  assert.equal(context.isExcelOnlyRequestType(ORGANIC_SILO_REQUEST_TYPE), true);
  assert.equal(context.isDailyDataExcelRequestType(ORGANIC_SILO_REQUEST_TYPE), false);
  assert.match(agent, /return await collectOrganicSiloDataParcValues\(config, requestItem\)/);
});
