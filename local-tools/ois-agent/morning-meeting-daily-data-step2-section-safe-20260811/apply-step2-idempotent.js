"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const vm = require("node:vm");

/*
  This installer deliberately does not trust a whole-file hash.

  The user's script.js and ois-login.js can receive unrelated edits while this
  patch is being prepared.  Each patch point is therefore accepted only when
  it is byte-for-byte (after CRLF normalization) in one of two known states:

  - the exact pre-step2 state; or
  - the exact installed step2 state.

  Unknown content inside any owned section/anchor stops the installer before
  either target file is written.  Unknown content outside the owned locations
  is preserved.
*/

const SECTION_HASHES = Object.freeze({
  agentNormalizeExcelText: Object.freeze({
    old: "C9F9277B6A80CE8B9DAD473A54B3A5B805E2B51D7275074D1BA9090DE979768E",
    installed: "E7A53D094C30636A97CB6217AB051C6C008A72B8DC26234EE627B27F7C7FEE06"
  }),
  previewCard: Object.freeze({
    old: "FBACEA13102DED192F0859EC032CA96E25BFDDAADA7B769995E51C26531E7AE2",
    installed: "24E2945166CDE214DE8E2E4D6BCDA21B4FE76E458069128840B3ECCC99A9E1B2"
  }),
  dailyDataClient: Object.freeze({
    old: "15E301C5852777E1A52B1BD1DA9F4A73FCFB84943FE9FFFD873660FC98401967",
    installed: "06094E3D903C9C1BFED6D0E2FC7227E9C4D32D50DE6950DF24193B12D201F358"
  })
});

const DAILY_DATA_OLD_START = [
  "/* =========================================================",
  "  오전회의 취합",
  "  증기 현황 OIS 요청·복원·미리보기"
].join("\n");

const DAILY_DATA_INSTALLED_START = [
  "/* =========================================================",
  "  오전회의 취합",
  "  월간 일일DATA관리 Excel 요청·복원·미리보기"
].join("\n");

const AGENT_EXACT_PATCHES = Object.freeze([
  Object.freeze({
    label: "에이전트 일일 DATA 표시명",
    old: '    return "증기 현황";',
    installed: '    return "일일 DATA 현황";'
  }),
  Object.freeze({
    label: "에이전트 Excel 제한시간 문구",
    old: '                  "DataPARC 증기생산량 조회가 45초를 초과해 중단되었습니다.",',
    installed: '                  "월간 일일DATA관리 Excel 조회가 45초를 초과해 중단되었습니다.",'
  }),
  Object.freeze({
    label: "에이전트 자료원 표시",
    old: [
      "      const requestLabel =",
      "        getOisAgentRequestLabel(",
      "          requestType",
      "        );",
      "",
      "",
      "      const targetDate ="
    ].join("\n"),
    installed: [
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
    ].join("\n")
  }),
  Object.freeze({
    label: "에이전트 완료 문구",
    old: '          `OIS ${requestLabel} 조회가 완료되었습니다.`',
    installed: '          `${requestSourceLabel} ${requestLabel} 조회가 완료되었습니다.`'
  }),
  Object.freeze({
    label: "에이전트 실패 문구",
    old: '          `OIS ${requestLabel} 요청 처리 실패:`,',
    installed: '          `${requestSourceLabel} ${requestLabel} 요청 처리 실패:`,'
  })
]);

const SCRIPT_EXACT_PATCHES = Object.freeze([
  Object.freeze({
    label: "자동자료 버튼명",
    old: '      "OIS 자동자료 다시 조회";',
    installed: '      "자동자료 다시 조회";'
  }),
  Object.freeze({
    label: "자동자료 버튼 설명",
    old: '      "수처리 현황과 Gear Wheel / Pinion OIS 자료를 다시 조회합니다.";',
    installed: '      "OIS 자동자료와 월간 일일DATA관리 Excel 자료를 다시 조회합니다.";'
  })
]);

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(value)
    .digest("hex")
    .toUpperCase();
}

function normalizeSource(value) {
  return String(value)
    .replace(/^\uFEFF/, "")
    .replaceAll("\r\n", "\n");
}

function assertUniformLineEndings(buffer, label) {
  const source = buffer.toString("utf8");
  const withoutCrLf = source.replaceAll("\r\n", "");
  const hasCrLf = source.includes("\r\n");
  const hasLoneLf = withoutCrLf.includes("\n");
  const hasLoneCr = withoutCrLf.includes("\r");

  if ((hasCrLf && (hasLoneLf || hasLoneCr)) || hasLoneCr) {
    throw new Error(
      `${label} 줄바꿈 형식이 섞여 있어 쓰기 전에 중단했습니다.`
    );
  }
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

function countOccurrences(source, search) {
  if (!search) {
    throw new Error("빈 교체 기준은 사용할 수 없습니다.");
  }

  let count = 0;
  let offset = 0;

  while (true) {
    const index = source.indexOf(search, offset);
    if (index < 0) return count;
    count += 1;
    offset = index + search.length;
  }
}

function findSection(source, startMarker, endMarker, label) {
  const startCount = countOccurrences(source, startMarker);
  if (startCount !== 1) {
    throw new Error(
      `${label} 시작 기준이 ${startCount}개입니다. 대상 구간을 변경하지 않았습니다.`
    );
  }

  const startIndex = source.indexOf(startMarker);
  const endIndex = source.indexOf(
    endMarker,
    startIndex + startMarker.length
  );

  if (endIndex < 0) {
    throw new Error(
      `${label} 종료 기준을 찾지 못했습니다. 대상 구간을 변경하지 않았습니다.`
    );
  }

  return {
    startIndex,
    endIndex,
    text: source.slice(startIndex, endIndex)
  };
}

function classifySameMarkerSection(
  source,
  startMarker,
  endMarker,
  hashes,
  label
) {
  const section = findSection(
    source,
    startMarker,
    endMarker,
    label
  );
  const hash = sha256(section.text);

  if (hash === hashes.old) {
    return { ...section, state: "old", hash };
  }

  if (hash === hashes.installed) {
    return { ...section, state: "installed", hash };
  }

  throw new Error(
    `${label} 내용이 알려진 설치 전/후 상태와 다릅니다. 현재 구간 SHA256: ${hash}`
  );
}

function classifyAlternateMarkerSection(
  source,
  oldStartMarker,
  installedStartMarker,
  endMarker,
  hashes,
  label
) {
  const oldStartCount = countOccurrences(
    source,
    oldStartMarker
  );
  const installedStartCount = countOccurrences(
    source,
    installedStartMarker
  );

  if (oldStartCount + installedStartCount !== 1) {
    throw new Error(
      `${label} 시작 기준 상태가 모호합니다. 설치 전=${oldStartCount}, 설치 후=${installedStartCount}`
    );
  }

  const expectedState = oldStartCount === 1
    ? "old"
    : "installed";
  const startMarker = expectedState === "old"
    ? oldStartMarker
    : installedStartMarker;
  const section = findSection(
    source,
    startMarker,
    endMarker,
    label
  );
  const hash = sha256(section.text);
  const expectedHash = hashes[expectedState];

  if (hash !== expectedHash) {
    throw new Error(
      `${label} ${expectedState === "old" ? "설치 전" : "설치 후"} 구간 내용이 다릅니다. 현재 구간 SHA256: ${hash}`
    );
  }

  return { ...section, state: expectedState, hash };
}

function replaceSectionIfOld(source, section, replacement) {
  if (section.state === "installed") {
    return source;
  }

  return (
    source.slice(0, section.startIndex) +
    replacement +
    source.slice(section.endIndex)
  );
}

function applyExactStatePatch(source, patch) {
  const oldCount = countOccurrences(source, patch.old);
  const installedCount = countOccurrences(
    source,
    patch.installed
  );

  if (oldCount === 1 && installedCount === 0) {
    return {
      source: source.replace(patch.old, patch.installed),
      state: "old"
    };
  }

  if (oldCount === 0 && installedCount === 1) {
    return {
      source,
      state: "installed"
    };
  }

  throw new Error(
    `${patch.label} 상태가 모호합니다. 설치 전=${oldCount}, 설치 후=${installedCount}`
  );
}

function verifySyntax(source, label) {
  try {
    new vm.Script(source, { filename: label });
  } catch (error) {
    throw new Error(
      `${label} 문법 검사 실패: ${error.message}`
    );
  }
}

function timestamp() {
  const now = new Date();
  const pad = (value, width = 2) =>
    String(value).padStart(width, "0");

  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
    "-",
    pad(now.getMilliseconds(), 3)
  ].join("");
}

function makeBackupPath(targetFile, stamp) {
  const extension = path.extname(targetFile);
  const basename = path.basename(targetFile, extension);
  return path.join(
    path.dirname(targetFile),
    `${basename}-before-daily-data-step2-${stamp}${extension}`
  );
}

function makeTemporaryPath(targetFile, stamp) {
  return path.join(
    path.dirname(targetFile),
    `.${path.basename(targetFile)}.daily-data-step2-${stamp}.tmp`
  );
}

function writeAndVerifyTemporary(target) {
  fs.writeFileSync(
    target.temporaryFile,
    target.output,
    { flag: "wx" }
  );

  const temporaryBuffer = fs.readFileSync(
    target.temporaryFile
  );
  if (sha256(temporaryBuffer) !== sha256(target.output)) {
    throw new Error(
      `${target.label} 임시 파일 검증에 실패했습니다.`
    );
  }
}

function copyBackupAndVerify(target) {
  fs.copyFileSync(
    target.file,
    target.backupFile,
    fs.constants.COPYFILE_EXCL
  );

  const backupBuffer = fs.readFileSync(
    target.backupFile
  );
  if (sha256(backupBuffer) !== target.hashBefore) {
    throw new Error(
      `${target.label} 백업 검증에 실패했습니다.`
    );
  }
}

const packageDirectory = __dirname;
const commandArguments = process.argv.slice(2);
const checkOnly = commandArguments.includes("--check");
const projectRootArgument = commandArguments.find(
  argument => argument !== "--check"
);
const projectRoot = path.resolve(
  projectRootArgument || process.cwd()
);

const agentFile = path.join(
  projectRoot,
  "local-tools",
  "ois-agent",
  "ois-login.js"
);
const scriptFile = path.join(projectRoot, "script.js");

for (const targetFile of [agentFile, scriptFile]) {
  if (!fs.existsSync(targetFile)) {
    throw new Error(
      `대상 파일을 찾지 못했습니다: ${targetFile}`
    );
  }
}

const agentBuffer = fs.readFileSync(agentFile);
const scriptBuffer = fs.readFileSync(scriptFile);

assertUniformLineEndings(agentBuffer, "ois-login.js");
assertUniformLineEndings(scriptBuffer, "script.js");

const agentHashBefore = sha256(agentBuffer);
const scriptHashBefore = sha256(scriptBuffer);
const agentSourceBefore = normalizeSource(
  agentBuffer.toString("utf8")
);
const scriptSourceBefore = normalizeSource(
  scriptBuffer.toString("utf8")
);

/* Reject pre-existing syntax errors before preparing any write. */
verifySyntax(agentSourceBefore, "ois-login.js (설치 전)");
verifySyntax(scriptSourceBefore, "script.js (설치 전)");

const normalizeExcelFunction = normalizeSource(
  fs.readFileSync(
    path.join(
      packageDirectory,
      "01-agent-normalize-excel-text.txt"
    ),
    "utf8"
  )
).trimEnd() + "\n\n\n";

const previewCardFunction = normalizeSource(
  fs.readFileSync(
    path.join(
      packageDirectory,
      "02-preview-card-function.txt"
    ),
    "utf8"
  )
).trimEnd() + "\n\n\n";

const dailyDataClientSection = normalizeSource(
  fs.readFileSync(
    path.join(
      packageDirectory,
      "03-daily-data-client-section.txt"
    ),
    "utf8"
  )
).trimEnd() + "\n\n\n";

for (const [label, payload, expectedHash] of [
  [
    "Normalize-ExcelText 패키지",
    normalizeExcelFunction,
    SECTION_HASHES.agentNormalizeExcelText.installed
  ],
  [
    "자동수치 하단 카드 패키지",
    previewCardFunction,
    SECTION_HASHES.previewCard.installed
  ],
  [
    "월간 일일DATA 클라이언트 패키지",
    dailyDataClientSection,
    SECTION_HASHES.dailyDataClient.installed
  ]
]) {
  const actualHash = sha256(payload);
  if (actualHash !== expectedHash) {
    throw new Error(
      `${label} 무결성 검증 실패: ${actualHash}`
    );
  }
}

const stateRows = [];

let agentSource = agentSourceBefore;

let section = classifySameMarkerSection(
  agentSource,
  "function Normalize-ExcelText {",
  "function ConvertTo-ExcelColumnName {",
  SECTION_HASHES.agentNormalizeExcelText,
  "Normalize-ExcelText 함수"
);
stateRows.push([
  "Normalize-ExcelText 함수",
  section.state
]);
agentSource = replaceSectionIfOld(
  agentSource,
  section,
  normalizeExcelFunction
);

for (const patch of AGENT_EXACT_PATCHES) {
  const result = applyExactStatePatch(
    agentSource,
    patch
  );
  stateRows.push([patch.label, result.state]);
  agentSource = result.source;
}

let scriptSource = scriptSourceBefore;

section = classifySameMarkerSection(
  scriptSource,
  "function ensureSiloPreviewCard() {",
  "  function setStatusBadge(",
  SECTION_HASHES.previewCard,
  "자동수치 하단 카드 함수"
);
stateRows.push([
  "자동수치 하단 카드 함수",
  section.state
]);
scriptSource = replaceSectionIfOld(
  scriptSource,
  section,
  previewCardFunction
);

for (const patch of SCRIPT_EXACT_PATCHES) {
  const result = applyExactStatePatch(
    scriptSource,
    patch
  );
  stateRows.push([patch.label, result.state]);
  scriptSource = result.source;
}

section = classifyAlternateMarkerSection(
  scriptSource,
  DAILY_DATA_OLD_START,
  DAILY_DATA_INSTALLED_START,
  "(function initializeEfficiencyMorningMeetingSmpPrice() {",
  SECTION_HASHES.dailyDataClient,
  "월간 일일DATA 클라이언트 섹션"
);
stateRows.push([
  "월간 일일DATA 클라이언트 섹션",
  section.state
]);
scriptSource = replaceSectionIfOld(
  scriptSource,
  section,
  dailyDataClientSection
);

/* Confirm that every owned location is now exactly in the installed state. */
section = classifySameMarkerSection(
  agentSource,
  "function Normalize-ExcelText {",
  "function ConvertTo-ExcelColumnName {",
  SECTION_HASHES.agentNormalizeExcelText,
  "Normalize-ExcelText 함수 (설치 후)"
);
if (section.state !== "installed") {
  throw new Error(
    "Normalize-ExcelText 함수 설치 후 검증에 실패했습니다."
  );
}

for (const patch of AGENT_EXACT_PATCHES) {
  const oldCount = countOccurrences(
    agentSource,
    patch.old
  );
  const installedCount = countOccurrences(
    agentSource,
    patch.installed
  );
  if (oldCount !== 0 || installedCount !== 1) {
    throw new Error(
      `${patch.label} 설치 후 검증에 실패했습니다.`
    );
  }
}

section = classifySameMarkerSection(
  scriptSource,
  "function ensureSiloPreviewCard() {",
  "  function setStatusBadge(",
  SECTION_HASHES.previewCard,
  "자동수치 하단 카드 함수 (설치 후)"
);
if (section.state !== "installed") {
  throw new Error(
    "자동수치 하단 카드 함수 설치 후 검증에 실패했습니다."
  );
}

for (const patch of SCRIPT_EXACT_PATCHES) {
  const oldCount = countOccurrences(
    scriptSource,
    patch.old
  );
  const installedCount = countOccurrences(
    scriptSource,
    patch.installed
  );
  if (oldCount !== 0 || installedCount !== 1) {
    throw new Error(
      `${patch.label} 설치 후 검증에 실패했습니다.`
    );
  }
}

section = classifyAlternateMarkerSection(
  scriptSource,
  DAILY_DATA_OLD_START,
  DAILY_DATA_INSTALLED_START,
  "(function initializeEfficiencyMorningMeetingSmpPrice() {",
  SECTION_HASHES.dailyDataClient,
  "월간 일일DATA 클라이언트 섹션 (설치 후)"
);
if (section.state !== "installed") {
  throw new Error(
    "월간 일일DATA 클라이언트 섹션 설치 후 검증에 실패했습니다."
  );
}

verifySyntax(agentSource, "ois-login.js (설치 후)");
verifySyntax(scriptSource, "script.js (설치 후)");

const agentOutput = restoreEncoding(
  agentSource,
  agentBuffer
);
const scriptOutput = restoreEncoding(
  scriptSource,
  scriptBuffer
);
const agentChanged = !agentOutput.equals(agentBuffer);
const scriptChanged = !scriptOutput.equals(scriptBuffer);
const appliedCount = stateRows.filter(
  row => row[1] === "old"
).length;
const existingCount = stateRows.filter(
  row => row[1] === "installed"
).length;

if (checkOnly) {
  console.log("Status       : CHECK_OK");
  console.log(`WouldChange  : ${agentChanged || scriptChanged ? "YES" : "NO"}`);
  console.log(`AppliedParts : ${appliedCount}`);
  console.log(`ExistingParts: ${existingCount}`);
  console.log(`AgentBefore  : ${agentHashBefore}`);
  console.log(`ScriptBefore : ${scriptHashBefore}`);
  console.log("Write        : NONE");
  process.exit(0);
}

if (!agentChanged && !scriptChanged) {
  console.log("Status       : ALREADY_INSTALLED");
  console.log(`AppliedParts : 0`);
  console.log(`ExistingParts: ${existingCount}`);
  console.log(`AgentFile    : ${agentFile}`);
  console.log(`AgentSHA256  : ${agentHashBefore}`);
  console.log(`ScriptFile   : ${scriptFile}`);
  console.log(`ScriptSHA256 : ${scriptHashBefore}`);
  console.log("Backup       : NONE");
  console.log("APIChange    : NONE");
  process.exit(0);
}

const stamp = timestamp();
const targets = [
  {
    label: "ois-login.js",
    file: agentFile,
    before: agentBuffer,
    output: agentOutput,
    hashBefore: agentHashBefore,
    changed: agentChanged
  },
  {
    label: "script.js",
    file: scriptFile,
    before: scriptBuffer,
    output: scriptOutput,
    hashBefore: scriptHashBefore,
    changed: scriptChanged
  }
]
  .filter(target => target.changed)
  .map(target => ({
    ...target,
    backupFile: makeBackupPath(target.file, stamp),
    temporaryFile: makeTemporaryPath(target.file, stamp)
  }));

/*
  Detect edits made after the initial read.  The agent should be stopped while
  applying this patch, but this guard also protects against an editor/save or
  another patch process racing with this installer.
*/
for (const target of targets) {
  const currentHash = sha256(
    fs.readFileSync(target.file)
  );
  if (currentHash !== target.hashBefore) {
    throw new Error(
      `${target.label}가 검사 중 변경되었습니다. 쓰기 전에 중단했습니다. 현재 SHA256: ${currentHash}`
    );
  }
}

const writeAttemptedTargets = [];

try {
  for (const target of targets) {
    copyBackupAndVerify(target);
    writeAndVerifyTemporary(target);
  }

  for (const target of targets) {
    const currentHash = sha256(
      fs.readFileSync(target.file)
    );
    if (currentHash !== target.hashBefore) {
      throw new Error(
        `${target.label}가 백업 후 변경되었습니다. 대상 파일에는 쓰지 않았습니다. 현재 SHA256: ${currentHash}`
      );
    }

    writeAttemptedTargets.push(target);
    fs.writeFileSync(target.file, target.output);

    const installedBuffer = fs.readFileSync(target.file);
    if (sha256(installedBuffer) !== sha256(target.output)) {
      throw new Error(
        `${target.label} 쓰기 후 검증에 실패했습니다.`
      );
    }
  }
} catch (installError) {
  const rollbackErrors = [];

  for (const target of writeAttemptedTargets) {
    if (!fs.existsSync(target.backupFile)) {
      continue;
    }

    try {
      fs.copyFileSync(target.backupFile, target.file);
      const restoredBuffer = fs.readFileSync(target.file);
      if (sha256(restoredBuffer) !== target.hashBefore) {
        throw new Error("복원 후 해시가 다릅니다.");
      }
    } catch (rollbackError) {
      rollbackErrors.push(
        `${target.label}: ${rollbackError.message}`
      );
    }
  }

  if (rollbackErrors.length > 0) {
    throw new Error(
      `설치 실패: ${installError.message}\n자동 복원도 확인이 필요합니다: ${rollbackErrors.join(" | ")}`
    );
  }

  throw new Error(
    `설치 실패 후 원본으로 자동 복원했습니다: ${installError.message}`
  );
} finally {
  for (const target of targets) {
    try {
      if (fs.existsSync(target.temporaryFile)) {
        fs.unlinkSync(target.temporaryFile);
      }
    } catch {
      /* The installed files and verified backups remain authoritative. */
    }
  }
}

const installedAgentBuffer = fs.readFileSync(agentFile);
const installedScriptBuffer = fs.readFileSync(scriptFile);

console.log("Status       : OK");
console.log(`AppliedParts : ${appliedCount}`);
console.log(`ExistingParts: ${existingCount}`);
console.log(`AgentFile    : ${agentFile}`);
console.log(`AgentBefore  : ${agentHashBefore}`);
console.log(`AgentLength  : ${installedAgentBuffer.length}`);
console.log(`AgentSHA256  : ${sha256(installedAgentBuffer)}`);
console.log(`ScriptFile   : ${scriptFile}`);
console.log(`ScriptBefore : ${scriptHashBefore}`);
console.log(`ScriptLength : ${installedScriptBuffer.length}`);
console.log(`ScriptSHA256 : ${sha256(installedScriptBuffer)}`);

for (const target of targets) {
  console.log(
    `${target.label === "ois-login.js" ? "AgentBackup " : "ScriptBackup"}: ${target.backupFile}`
  );
}

console.log("APIChange    : NONE");
