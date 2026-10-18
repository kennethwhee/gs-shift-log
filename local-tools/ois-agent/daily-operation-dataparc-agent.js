"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");

const contract = require("../../daily-operation/daily-operation-query-contract.js");
const DAILY_OPERATION_REQUEST_TYPE = contract.TYPE;

function normalizeDailyOperationResult(raw, report, targetDate) {
  const fail = message => { throw new Error(`일일운전 결과 검증 실패: ${message}`); };
  if (!raw || !report || report.schemaVersion !== 1 || report.ok !== true || report.timedOut !== false ||
      report.workerExitCode !== 0 || report.resultReceived !== true || report.resultOk !== true ||
      report.cleanupVerified !== true || !Array.isArray(report.cleanupErrors) || report.cleanupErrors.length ||
      (report.failure !== "" && report.failure !== null) || report.databaseWritten !== false) {
    fail("정상 종료와 정리 완료를 확인하지 못했습니다.");
  }
  if (raw.mode !== DAILY_OPERATION_REQUEST_TYPE || report.mode !== DAILY_OPERATION_REQUEST_TYPE ||
      raw.targetDate !== targetDate || report.targetDate !== targetDate || raw.databaseWritten !== false ||
      typeof raw.runId !== "string" || !/^[a-f0-9]{32}$/i.test(raw.runId) || raw.runId !== report.runId) {
    fail("실행 식별자 또는 조회일이 일치하지 않습니다.");
  }
  if (!report.ownedExcel || !Number.isInteger(report.ownedExcel.ProcessId) || report.ownedExcel.ProcessId <= 0 ||
      typeof report.ownedExcel.Path !== "string" || path.win32.basename(report.ownedExcel.Path).toLowerCase() !== "excel.exe") {
    fail("조회용 Excel 소유 프로세스 기록이 없습니다.");
  }
  return contract.normalize(raw, targetDate);
}

function createDailyOperationCollector(options = {}) {
  const spawnProcess = options.spawnProcess || spawn;
  const timeoutMilliseconds = options.timeoutMilliseconds ?? 450000;
  const platform = options.platform || process.platform;
  const scriptPath = options.scriptPath || path.join(__dirname, "daily-operation-dataparc.ps1");
  const runsDirectory = options.runsDirectory || path.join(process.env.LOCALAPPDATA || os.tmpdir(), "GSShiftLog", "daily-operation-dataparc", "runs");
  const log = options.log || (message => console.log(message));
  let activeController = null;

  return async function collectDailyOperationDataParcValues(_config, requestItem) {
    const targetDate = requestItem?.targetDate ?? requestItem?.target_date;
    contract.completedDay(targetDate);
    if (platform !== "win32") throw new Error("일일운전 운영정보 DataPARC 조회에는 회사 Windows PC가 필요합니다.");
    if (activeController) throw new Error("이전 일일운전 운영정보 조회 프로세스가 아직 정리 중입니다.");
    if (!fs.existsSync(scriptPath)) throw new Error("일일운전 운영정보 DataPARC 조회 스크립트가 설치되지 않았습니다.");
    fs.mkdirSync(runsDirectory, { recursive: true });
    const runDirectory = fs.mkdtempSync(path.join(runsDirectory, `${targetDate}-`));
    const executable = path.win32.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    log(`일일운전 운영정보 DataPARC 조회 시작 · ${targetDate}`);
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
      const result = normalizeDailyOperationResult(readJson("pilot-result.json"), readJson("pilot-report.json"), targetDate);
      log(`일일운전 운영정보 DataPARC 조회 완료 · ${targetDate} · 정상값 ${Object.values(result.values).filter(value => value !== null).length}/${contract.definitions.length}`);
      return result;
    } catch (error) {
      throw new Error(`${error.message} · 진단 폴더: ${runDirectory}`);
    }
  };
}

const collectDailyOperationDataParcValues = createDailyOperationCollector();
module.exports = { DAILY_OPERATION_REQUEST_TYPE, normalizeDailyOperationResult, createDailyOperationCollector, collectDailyOperationDataParcValues };
