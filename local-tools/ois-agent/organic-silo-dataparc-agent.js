"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");

const ORGANIC_SILO_REQUEST_TYPE = "organic_silo_dataparc";
const ORGANIC_SILO_TAGS = Object.freeze([
  Object.freeze({ key: "organicDaySilo", label: "Day Silo", tag: "GSPOGE.ABB_DCS.104SDF01CW001XQ01/PLOT" }),
  Object.freeze({ key: "organicStorageSiloA", label: "Storage A", tag: "GSPOGE.ABB_DCS.003SDF01CW001XQ01/PLOT" }),
  Object.freeze({ key: "organicStorageSiloB", label: "Storage B", tag: "GSPOGE.ABB_DCS.003SDF02CW001XQ01/PLOT" })
]);

function isOrganicQualityGood(value) {
  if (typeof value !== "string") return false;
  const tokens = value.split(",").map(token => token.trim().toLowerCase());
  return (tokens.length === 1 && tokens[0] === "good") ||
    (tokens.length === 2 && tokens.includes("raw") && tokens.includes("good"));
}

function organicDateInterval(targetDate) {
  if (typeof targetDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    throw new Error("유기성 Silo 조회일 형식이 올바르지 않습니다.");
  }
  const date = new Date(`${targetDate}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== targetDate) {
    throw new Error("유기성 Silo 조회일이 달력에 없는 날짜입니다.");
  }
  return {
    intervalStartKst: `${targetDate}T00:00:00+09:00`,
    intervalEndKst: `${new Date(date.getTime() + 86400000).toISOString().slice(0, 10)}T00:00:00+09:00`
  };
}

function validNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function normalizeOrganicSiloResult(raw, report, targetDate) {
  const fail = message => { throw new Error(`유기성 Silo 결과 검증 실패: ${message}`); };
  const object = value => value && typeof value === "object" && !Array.isArray(value);
  const interval = organicDateInterval(targetDate);
  if (!object(raw) || !object(report)) fail("결과 또는 종료 보고서가 없습니다.");
  if (report.schemaVersion !== 1 || report.ok !== true || report.timedOut !== false ||
      report.workerExitCode !== 0 || report.resultReceived !== true || report.resultOk !== true ||
      report.cleanupVerified !== true || !Array.isArray(report.cleanupErrors) || report.cleanupErrors.length ||
      (report.failure !== "" && report.failure !== null) || report.databaseWritten !== false) {
    fail("정상 종료와 정리 완료를 확인하지 못했습니다.");
  }
  if (raw.mode !== ORGANIC_SILO_REQUEST_TYPE || report.mode !== ORGANIC_SILO_REQUEST_TYPE ||
      raw.targetDate !== targetDate || report.targetDate !== targetDate ||
      typeof raw.runId !== "string" || !/^[a-f0-9]{32}$/i.test(raw.runId) || raw.runId !== report.runId) {
    fail("실행 식별자 또는 조회일이 일치하지 않습니다.");
  }
  if (!object(report.ownedExcel) || !Number.isInteger(report.ownedExcel.ProcessId) || report.ownedExcel.ProcessId <= 0 ||
      typeof report.ownedExcel.Path !== "string" || path.win32.basename(report.ownedExcel.Path).toLowerCase() !== "excel.exe") {
    fail("조회용 Excel 소유 프로세스 기록이 없습니다.");
  }
  if (raw.schemaVersion !== 1 || raw.source !== "dataparc_hidden_excel" ||
      raw.ok !== true || raw.cleanupVerified !== true || raw.databaseWritten !== false ||
      raw.allCellsReturned !== true || raw.allValuesValid !== true || raw.allQualitiesGood !== true ||
      raw.aggregation !== "End" || raw.step !== "1D" || raw.qualityValidationVersion !== "1.2" ||
      raw.intervalStartKst !== interval.intervalStartKst || raw.intervalEndKst !== interval.intervalEndKst) {
    fail("기간·집계 방식·값·품질 검증이 완료되지 않았습니다.");
  }
  if (!Array.isArray(raw.samples) || raw.samples.length !== 3 || !object(raw.targetValues)) fail("조회값이 정확히 3개가 아닙니다.");
  const targetSamples = raw.samples.filter(sample => sample?.date === targetDate);
  if (targetSamples.length !== 3) fail("조회일 Silo 값이 정확히 3개가 아닙니다.");
  const startMs = Date.parse(interval.intervalStartKst);
  const endMs = Date.parse(interval.intervalEndKst);
  const samples = ORGANIC_SILO_TAGS.map(definition => {
    const matches = targetSamples.filter(sample => sample.key === definition.key);
    if (matches.length !== 1) fail(`${definition.label} 누락 또는 중복`);
    const sample = matches[0];
    if (sample.tag !== definition.tag || sample.label !== definition.label || sample.statistic !== "End" ||
        sample.periodStartKst !== interval.intervalStartKst.replace("T", " ") ||
        sample.periodEndKst !== interval.intervalEndKst.replace("T", " ") ||
        !validNumber(sample.value) || sample.validNonNegativeValue !== true || sample.qualityGood !== true ||
        !isOrganicQualityGood(sample.qualityText)) fail(`${definition.label} TAG·값·품질 불일치`);
    const time = sample.returnedTimeText;
    if (typeof time !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(time)) fail(`${definition.label} 반환 시각 누락`);
    const timeMs = Date.parse(`${time.replace(" ", "T")}+09:00`);
    if (!Number.isFinite(timeMs) || timeMs < startMs || timeMs > endMs ||
        new Date(timeMs + 9 * 3600000).toISOString().slice(0, 19).replace("T", " ") !== time) {
      fail(`${definition.label} 반환 시각이 조회기간과 다릅니다.`);
    }
    if (!validNumber(raw.targetValues[definition.key]) || Math.abs(raw.targetValues[definition.key] - sample.value) > 1e-9) {
      fail(`${definition.label} 결과와 표본 값이 다릅니다.`);
    }
    return {
      date: targetDate, ...definition, value: sample.value, qualityText: sample.qualityText, qualityGood: true,
      returnedTimeText: time, periodStartKst: sample.periodStartKst, periodEndKst: sample.periodEndKst, statistic: "End"
    };
  });
  const total = samples.reduce((sum, sample) => sum + sample.value, 0);
  if (!validNumber(total) || !validNumber(raw.targetValues.organicSiloTotal) || Math.abs(raw.targetValues.organicSiloTotal - total) > 1e-9) {
    fail("총 재고량이 Silo 3개 합계와 다릅니다.");
  }
  return {
    schemaVersion: 1, source: "dataparc_hidden_excel", targetDate,
    aggregation: "End", step: "1D", ...interval,
    ...Object.fromEntries(samples.map(sample => [sample.key, sample.value])),
    organicSiloTotal: total, samples, qualityValidationVersion: "1.2",
    allQualitiesGood: true, cleanupVerified: true
  };
}

function createOrganicSiloCollector(options = {}) {
  const spawnProcess = options.spawnProcess || spawn;
  const timeoutMilliseconds = options.timeoutMilliseconds ?? 450000;
  const platform = options.platform || process.platform;
  const scriptPath = options.scriptPath || path.join(__dirname, "organic-silo-dataparc.ps1");
  const runsDirectory = options.runsDirectory || path.join(process.env.LOCALAPPDATA || os.tmpdir(), "GSShiftLog", "organic-silo-dataparc", "runs");
  const log = options.log || (message => console.log(message));
  let activeController = null;

  return async function collectOrganicSiloDataParcValues(_config, requestItem) {
    const targetDate = requestItem?.targetDate ?? requestItem?.target_date;
    organicDateInterval(targetDate);
    const todayKst = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
    if (targetDate >= todayKst) throw new Error("유기성 Silo는 조회가 완료된 전일까지 조회할 수 있습니다.");
    if (platform !== "win32") throw new Error("유기성 Silo DataPARC 조회에는 회사 Windows PC가 필요합니다.");
    if (activeController) throw new Error("이전 유기성 Silo 조회 프로세스가 아직 정리 중입니다.");
    if (!fs.existsSync(scriptPath)) throw new Error("유기성 Silo DataPARC 조회 스크립트가 설치되지 않았습니다.");
    fs.mkdirSync(runsDirectory, { recursive: true });
    const runDirectory = fs.mkdtempSync(path.join(runsDirectory, `${targetDate}-`));
    const executable = path.win32.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    log(`유기성 Silo DataPARC 조회 시작 · ${targetDate}`);
    try {
      await new Promise((resolve, reject) => {
        const child = spawnProcess(executable, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-TargetDate", targetDate, "-OutputDirectory", runDirectory], {
          windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"]
        });
        activeController = child;
        let settled = false;
        let stdout = "";
        let stderr = "";
        const finish = error => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          error ? reject(error) : resolve();
        };
        const timer = setTimeout(() => {
          // The independent controller owns its worker/Excel watchdog and cleanup.
          // Never terminate it or its process tree from this soft timeout.
          finish(new Error("조회 대기시간을 초과했습니다. 조회용 프로세스 정리는 계속 진행됩니다."));
        }, timeoutMilliseconds);
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", chunk => { stdout = (stdout + chunk.toString("utf8")).slice(-1024 * 1024); });
        child.stderr.on("data", chunk => { stderr = (stderr + chunk.toString("utf8")).slice(-1024 * 1024); });
        child.once("error", error => finish(new Error(`PowerShell 실행 오류: ${error.message}`)));
        child.once("close", (code, signal) => {
          if (activeController === child) activeController = null;
          try {
            fs.writeFileSync(path.join(runDirectory, "controller-stdout.log"), stdout, "utf8");
            fs.writeFileSync(path.join(runDirectory, "controller-stderr.log"), stderr, "utf8");
            if (signal || code !== 0) finish(new Error(`조회 프로세스가 정상 종료되지 않았습니다 (exit=${code}, signal=${signal || "none"}).`));
            else if (!stdout.trim()) finish(new Error("조회 프로세스의 종료 출력이 없습니다."));
            else finish();
          } catch (error) { finish(error); }
        });
      });
      const readJson = name => JSON.parse(fs.readFileSync(path.join(runDirectory, name), "utf8").replace(/^\uFEFF/, ""));
      const result = normalizeOrganicSiloResult(readJson("pilot-result.json"), readJson("pilot-report.json"), targetDate);
      log(`유기성 Silo DataPARC 조회 완료 · ${targetDate} · 총 ${result.organicSiloTotal.toFixed(3)} ton`);
      return result;
    } catch (error) {
      throw new Error(`${error.message} · 진단 폴더: ${runDirectory}`);
    }
  };
}

const collectOrganicSiloDataParcValues = createOrganicSiloCollector();
module.exports = { ORGANIC_SILO_REQUEST_TYPE, ORGANIC_SILO_TAGS, isOrganicQualityGood, organicDateInterval, normalizeOrganicSiloResult, createOrganicSiloCollector, collectOrganicSiloDataParcValues };
