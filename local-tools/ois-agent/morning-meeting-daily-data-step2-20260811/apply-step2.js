"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const vm = require("node:vm");

const EXPECTED_AGENT_SHA256 =
  "F486C4506D8430697CC64F3490BC3CAA68FFEDD08F2CB88E4FC5CCE317C8E3B9";

const EXPECTED_SCRIPT_SHA256 =
  "85DD91348910E379D20C6A3212F32E12822CD39C0EBDD16379D19C55DC89D028";

function sha256(buffer) {
  return crypto
    .createHash("sha256")
    .update(buffer)
    .digest("hex")
    .toUpperCase();
}

function normalizeSource(value) {
  return String(value)
    .replace(/^\uFEFF/, "")
    .replaceAll("\r\n", "\n");
}

function countOccurrences(source, search) {
  let count = 0;
  let offset = 0;

  while (true) {
    const index = source.indexOf(search, offset);
    if (index < 0) return count;
    count += 1;
    offset = index + search.length;
  }
}

function replaceExactOnce(source, before, after, label) {
  const count = countOccurrences(source, before);
  if (count !== 1) {
    throw new Error(`${label} 교체 기준이 ${count}개입니다. 파일 버전을 확인해 주세요.`);
  }
  return source.replace(before, after);
}

function replaceBetweenOnce(source, startMarker, endMarker, replacement, label) {
  const startCount = countOccurrences(source, startMarker);
  if (startCount !== 1) {
    throw new Error(`${label} 시작 기준이 ${startCount}개입니다. 파일 버전을 확인해 주세요.`);
  }

  const startIndex = source.indexOf(startMarker);
  const endIndex = source.indexOf(
    endMarker,
    startIndex + startMarker.length
  );

  if (endIndex < 0) {
    throw new Error(`${label} 종료 기준을 찾지 못했습니다.`);
  }

  return (
    source.slice(0, startIndex) +
    replacement.trimEnd() +
    "\n\n\n" +
    source.slice(endIndex)
  );
}

function restoreEncoding(source, originalBuffer) {
  const originalText = originalBuffer.toString("utf8");
  const hasBom = originalText.startsWith("\uFEFF");
  const usesCrLf = originalText.includes("\r\n");
  const encodedText = usesCrLf
    ? source.replaceAll("\n", "\r\n")
    : source;

  return Buffer.from(
    `${hasBom ? "\uFEFF" : ""}${encodedText}`,
    "utf8"
  );
}

function timestamp() {
  const now = new Date();
  const pad = value => String(value).padStart(2, "0");

  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds())
  ].join("");
}

const packageDirectory = __dirname;
const projectRoot = path.resolve(process.argv[2] || process.cwd());
const agentFile = path.join(
  projectRoot,
  "local-tools",
  "ois-agent",
  "ois-login.js"
);
const scriptFile = path.join(projectRoot, "script.js");

for (const targetFile of [agentFile, scriptFile]) {
  if (!fs.existsSync(targetFile)) {
    throw new Error(`대상 파일을 찾지 못했습니다: ${targetFile}`);
  }
}

const agentBuffer = fs.readFileSync(agentFile);
const scriptBuffer = fs.readFileSync(scriptFile);
const agentHashBefore = sha256(agentBuffer);
const scriptHashBefore = sha256(scriptBuffer);

if (agentHashBefore !== EXPECTED_AGENT_SHA256) {
  throw new Error(
    `ois-login.js 기준본이 다릅니다. 현재 SHA256: ${agentHashBefore}`
  );
}

if (scriptHashBefore !== EXPECTED_SCRIPT_SHA256) {
  throw new Error(
    `script.js 기준본이 다릅니다. 현재 SHA256: ${scriptHashBefore}`
  );
}

const normalizeExcelFunction = normalizeSource(
  fs.readFileSync(
    path.join(packageDirectory, "01-agent-normalize-excel-text.txt"),
    "utf8"
  )
);

const previewCardFunction = normalizeSource(
  fs.readFileSync(
    path.join(packageDirectory, "02-preview-card-function.txt"),
    "utf8"
  )
);

const dailyDataClientSection = normalizeSource(
  fs.readFileSync(
    path.join(packageDirectory, "03-daily-data-client-section.txt"),
    "utf8"
  )
);

let agentSource = normalizeSource(agentBuffer.toString("utf8"));

agentSource = replaceBetweenOnce(
  agentSource,
  "function Normalize-ExcelText {",
  "function ConvertTo-ExcelColumnName {",
  normalizeExcelFunction,
  "Normalize-ExcelText 함수"
);

agentSource = replaceExactOnce(
  agentSource,
  '    return "증기 현황";',
  '    return "일일 DATA 현황";',
  "에이전트 일일 DATA 표시명"
);

agentSource = replaceExactOnce(
  agentSource,
  '                  "DataPARC 증기생산량 조회가 45초를 초과해 중단되었습니다.",',
  '                  "월간 일일DATA관리 Excel 조회가 45초를 초과해 중단되었습니다.",',
  "에이전트 Excel 제한시간 문구"
);

agentSource = replaceExactOnce(
  agentSource,
  [
    "      const requestLabel =",
    "        getOisAgentRequestLabel(",
    "          requestType",
    "        );",
    "",
    "",
    "      const targetDate ="
  ].join("\n"),
  [
    "      const requestLabel =",
    "        getOisAgentRequestLabel(",
    "          requestType",
    "        );",
    "",
    "",
    "      const requestSourceLabel =",
    "        requestType ===",
    '          "steam_status"',
    '          ? "Excel"',
    '          : "OIS";',
    "",
    "",
    "      const targetDate ="
  ].join("\n"),
  "에이전트 자료원 표시"
);

agentSource = replaceExactOnce(
  agentSource,
  '          `OIS ${requestLabel} 조회가 완료되었습니다.`',
  '          `${requestSourceLabel} ${requestLabel} 조회가 완료되었습니다.`',
  "에이전트 완료 문구"
);

agentSource = replaceExactOnce(
  agentSource,
  '          `OIS ${requestLabel} 요청 처리 실패:`,',
  '          `${requestSourceLabel} ${requestLabel} 요청 처리 실패:`,',
  "에이전트 실패 문구"
);

let scriptSource = normalizeSource(scriptBuffer.toString("utf8"));

scriptSource = replaceBetweenOnce(
  scriptSource,
  "function ensureSiloPreviewCard() {",
  "  function setStatusBadge(",
  previewCardFunction,
  "자동수치 하단 카드 함수"
);

scriptSource = replaceExactOnce(
  scriptSource,
  '      "OIS 자동자료 다시 조회";',
  '      "자동자료 다시 조회";',
  "자동자료 버튼명"
);

scriptSource = replaceExactOnce(
  scriptSource,
  '      "수처리 현황과 Gear Wheel / Pinion OIS 자료를 다시 조회합니다.";',
  '      "OIS 자동자료와 월간 일일DATA관리 Excel 자료를 다시 조회합니다.";',
  "자동자료 버튼 설명"
);

scriptSource = replaceBetweenOnce(
  scriptSource,
  [
    "/* =========================================================",
    "  오전회의 취합",
    "  증기 현황 OIS 요청·복원·미리보기"
  ].join("\n"),
  "(function initializeEfficiencyMorningMeetingSmpPrice() {",
  dailyDataClientSection,
  "월간 일일DATA 클라이언트 섹션"
);

if (/^\s*\.(Trim|Normalize)\(/m.test(agentSource)) {
  throw new Error("Windows PowerShell 5.1 비호환 줄바꿈 메서드 호출이 남아 있습니다.");
}

for (const [label, source] of [
  ["ois-login.js", agentSource],
  ["script.js", scriptSource]
]) {
  try {
    new vm.Script(source, { filename: label });
  } catch (error) {
    throw new Error(`${label} 문법 검사 실패: ${error.message}`);
  }
}

const agentOutput = restoreEncoding(agentSource, agentBuffer);
const scriptOutput = restoreEncoding(scriptSource, scriptBuffer);
const stamp = timestamp();

const agentBackup = path.join(
  path.dirname(agentFile),
  `ois-login-before-daily-data-step2-${stamp}.js`
);
const scriptBackup = path.join(
  path.dirname(scriptFile),
  `script-before-daily-data-step2-${stamp}.js`
);

fs.copyFileSync(agentFile, agentBackup, fs.constants.COPYFILE_EXCL);
fs.copyFileSync(scriptFile, scriptBackup, fs.constants.COPYFILE_EXCL);

try {
  fs.writeFileSync(agentFile, agentOutput);
  fs.writeFileSync(scriptFile, scriptOutput);
} catch (error) {
  fs.copyFileSync(agentBackup, agentFile);
  fs.copyFileSync(scriptBackup, scriptFile);
  throw error;
}

const installedAgentBuffer = fs.readFileSync(agentFile);
const installedScriptBuffer = fs.readFileSync(scriptFile);

console.log("Status       : OK");
console.log(`AgentFile    : ${agentFile}`);
console.log(`AgentLength  : ${installedAgentBuffer.length}`);
console.log(`AgentSHA256  : ${sha256(installedAgentBuffer)}`);
console.log(`ScriptFile   : ${scriptFile}`);
console.log(`ScriptLength : ${installedScriptBuffer.length}`);
console.log(`ScriptSHA256 : ${sha256(installedScriptBuffer)}`);
console.log(`AgentBackup  : ${agentBackup}`);
console.log(`ScriptBackup : ${scriptBackup}`);
console.log("APIChange    : NONE");
