"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const childProcess = require("child_process");

const repositoryPath = path.resolve(process.argv[2] || process.cwd());
const navigationCacheVersion = "20260828-navigation-public-v1";
const blowerCacheVersion = "20260830-initial-state-public-navigation-v92";

function read(relativePath) {
  return fs
    .readFileSync(path.join(repositoryPath, relativePath), "utf8")
    .replace(/\r\n?/g, "\n");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function anchorById(source, id) {
  const normalized = source.replaceAll("&amp;", "&");
  const match = normalized.match(
    new RegExp(`<a\\b[^>]*\\bid=["']${id}["'][^>]*>`, "i")
  );
  return match ? match[0] : "";
}

function assertMutationAuthentication(source, exportName, authToken) {
  const marker = `export async function ${exportName}`;
  const start = source.indexOf(marker);
  assert(start >= 0, `${exportName}: handler is missing.`);
  assert(
    source.slice(start, start + 900).includes(authToken),
    `${exportName}: mandatory authentication is missing.`
  );
}

const desktop = read("index.html");
const mobile = read("mobile-app/index.html");
const routes = {
  solidFuelTroubleHeaderLink:
    "/maintenance/solid-fuel-trouble",
  blowerHistoryHeaderButton:
    "/maintenance/blower-history",
  plannedMaintenanceLogicHeaderButton:
    "/maintenance/planned-maintenance?view=logic&sheet=logic-blr",
  plannedMaintenanceWorkHeaderButton:
    "/maintenance/planned-maintenance?view=work&sheet=work-tbn-bop"
};

assert(
  new Set(Object.values(routes)).size === 4,
  "The four share URLs are not unique."
);

for (const [file, source] of [
  ["index.html", desktop],
  ["mobile-app/index.html", mobile]
]) {
  assert(
    source.includes(
      `/maintenance/shift-log-navigation.js?v=${navigationCacheVersion}`
    ),
    `${file}: navigation helper cache version is missing.`
  );

  for (const [id, route] of Object.entries(routes)) {
    const anchor = anchorById(source, id);
    assert(anchor, `${file}: ${id} must be an anchor.`);
    assert(
      anchor.includes(`href="${route}"`),
      `${file}: ${id} href is incorrect.`
    );
    assert(
      anchor.includes(`data-shift-log-target="${route}"`),
      `${file}: ${id} navigation target is incorrect.`
    );
    assert(
      !/\starget\s*=/.test(anchor),
      `${file}: ${id} still opens a named/new window.`
    );
  }
}

const targetPages = [
  "maintenance/solid-fuel-trouble.html",
  "maintenance/blower-history.html",
  "maintenance/planned-maintenance.html"
];

for (const file of targetPages) {
  const source = read(file);
  const returnControl = [...source.matchAll(/<(?:button|a)\b[^>]*>/gi)]
    .map(match => match[0])
    .find(tag => tag.includes("data-shift-log-return"));

  assert(
    source.includes('name="robots" content="noindex, nofollow"'),
    `${file}: noindex protection is missing.`
  );
  assert(returnControl, `${file}: return control is missing.`);
  assert(
    /\shidden(?:\s|>|=)/.test(returnControl),
    `${file}: direct visits must hide the return control initially.`
  );
  assert(
    source.includes(`shift-log-navigation.js?v=${navigationCacheVersion}`),
    `${file}: navigation helper cache version is incorrect.`
  );
}

const helper = read("maintenance/shift-log-navigation.js");
for (const token of [
  "PENDING_TTL_MS",
  "sessionStorage",
  "WINDOW_NAME_MARKER_PREFIX",
  "previousWindowName",
  "history.replaceState",
  "history.back()",
  "data-shift-log-target",
  "data-shift-log-return",
  "gs-shift-log-before-return"
]) {
  assert(helper.includes(token), `Navigation helper is missing ${token}.`);
}
assert(
  !helper.includes("ACTIVE_TTL_MS"),
  "Return context should follow the history entry lifetime."
);

const launcher = read(
  "inspection-logs/daily/night-patrol/night-patrol-launcher.js"
);
assert(
  launcher.includes(
    'const BLOWER_HISTORY_URL = "/maintenance/blower-history"'
  ),
  "Dynamic Blower route is incorrect."
);
assert(
  launcher.includes("window.GSShiftLogNavigation.navigate"),
  "Dynamic Blower entry does not use same-tab navigation."
);
assert(
  !launcher.includes("GS_BLOWER_HISTORY"),
  "Dynamic Blower entry still contains the named popup."
);

const desktopRuntime = read("script.js");
const mobileRuntime = read("mobile-app/mobile-runtime-v14.js");
for (const [file, source] of [
  ["script.js", desktopRuntime],
  ["mobile-app/mobile-runtime-v14.js", mobileRuntime]
]) {
  assert(
    source.includes("function openShiftLogTargetPage"),
    `${file}: same-tab fallback is missing.`
  );
  assert(
    source.includes(routes.plannedMaintenanceLogicHeaderButton),
    `${file}: Logic share URL is missing.`
  );
  assert(
    source.includes(routes.plannedMaintenanceWorkHeaderButton),
    `${file}: work share URL is missing.`
  );
  assert(
    !source.includes(
      'openHeaderManagementPage("/maintenance/planned-maintenance.html'
    ),
    `${file}: planned-maintenance popup handler remains.`
  );
}

const solidPageJs = read("maintenance/solid-fuel-trouble.js");
const blowerPageJs = read("maintenance/blower-history.js");
const plannedPageJs = read("maintenance/planned-maintenance.js");
const blowerPageHtml = read("maintenance/blower-history.html");
const blowerPageCss = read("maintenance/blower-history.css");

assert(
  solidPageJs.includes("solid-fuel-readonly") &&
    solidPageJs.includes("canUploadPhoto") &&
    !solidPageJs.includes('location.assign("/")'),
  "Solid-fuel public/mobile read-only contract is incomplete."
);
assert(
  blowerPageJs.includes("public-monitoring") &&
    blowerPageJs.includes("hasAuthenticatedWriteAccess") &&
    !blowerPageJs.includes("closeButton"),
  "Blower public-monitoring contract is incomplete."
);
assert(
  blowerPageHtml.includes(`blower-history.css?v=${blowerCacheVersion}`) &&
    blowerPageHtml.includes(`blower-history.js?v=${blowerCacheVersion}`),
  "Blower integrated cache version is incorrect."
);
assert(
  (blowerPageHtml.match(/id="assetManagerButton"/g) || []).length === 1 &&
    (blowerPageHtml.match(/id="assetManagerDialog"/g) || []).length === 1,
  "Blower must retain one asset-manager entry and one dialog."
);
for (const token of [
  "type-alert-count",
  '["warning", "critical", "overdue"].includes(displaySeverity(asset))',
  "TAG · 호기 확인 대기",
  "startup_pending",
  'data-asset-action="startup"',
  "cycleStartedAt",
  "replacementStartupAt",
  'action: "asset_save"',
  "expectedUpdatedAt",
  'data-asset-action="runtime_state"',
  "operation_start",
  "operation_stop",
  "expectedCycleRuntimeRevision",
  "serverClockOffsetMs",
  "currentServerDate",
  "serverGeneratedAt - Date.now()",
  "kstDateTimeInputToIso",
  "+09:00",
  "실제 정지일시 (한국시간)",
  "실제 재기동일시 (한국시간)",
  "recordDate.max",
  "latestExplicitRuntimeBoundary",
  "initialCycleCorrection",
  "assetManagerButton.hidden = !hasAuthenticatedWriteAccess()",
  'method !== "GET" && !hasAuthenticatedWriteAccess()'
]) {
  assert(
    blowerPageJs.includes(token),
    `Blower V13.2/public frontend is missing ${token}.`
  );
}
for (const token of [
  "V7 single asset manager + numeric-only alert badge",
  "body.public-monitoring #assetManagerDialog",
  "body.mobile-monitoring #assetManagerDialog",
  ".operation-pill",
  ".runtime-state-action"
]) {
  assert(
    blowerPageCss.includes(token),
    `Blower V13.2/public CSS is missing ${token}.`
  );
}
assert(
  plannedPageJs.includes("pm-public-readonly") &&
    plannedPageJs.includes("permissions.canWrite") &&
    plannedPageJs.includes("gs-shift-log-before-return"),
  "Planned-maintenance public read-only contract is incomplete."
);

const solidApi = read("functions/api/solid-fuel-trouble.js");
const blowerApi = read("functions/api/blower-history.js");
const plannedApi = read("functions/api/planned-maintenance.js");

assert(
  solidApi.includes("auth(context,{optional:true})") &&
    solidApi.includes("publicAccess:!a.user") &&
    solidApi.includes("sample-photo"),
  "Solid-fuel anonymous read/photo protection is incomplete."
);
assert(
  !/function publicTroubleObj[\s\S]{0,550}\bname:/.test(solidApi),
  "Solid-fuel public DTO exposes an original photo filename."
);
assertMutationAuthentication(solidApi, "onRequestPost", "auth(context)");
assertMutationAuthentication(solidApi, "onRequestPut", "auth(context)");
assertMutationAuthentication(solidApi, "onRequestDelete", "auth(context)");

const blowerGet = blowerApi.slice(
  blowerApi.indexOf("export async function onRequestGet"),
  blowerApi.indexOf("export async function onRequestPost")
);
assert(
  blowerApi.includes("{ optional: true }") &&
    blowerApi.includes("sanitizeEventsForAnonymous") &&
    blowerApi.includes("sanitizeAssetsForAnonymous"),
  "Blower anonymous read sanitization is incomplete."
);
for (const token of [
  "assetCatalog: user?.isSuperAdmin ? await loadAssetCatalog(database) : []",
  "cycle_started_at",
  "cycle_start_state",
  "cycle_start_revision",
  'action === "startup"',
  "실제 기동일시는 V-Belt 교체일보다 빠를 수 없습니다",
  'action === "asset_save"',
  "if (!user.isSuperAdmin)",
  "isMobileMonitoringRequest(context)",
  "ASSET_EDIT_CONFLICT",
  "기존 TAG는 교체이력 연결을 위해 변경할 수 없습니다",
  "expectedUpdatedAt",
  "initializeCycleRuntimeTracking",
  "cycleRuntimeHoursAt",
  "changeRuntimeState",
  "expectedCycleRuntimeRevision",
  "loadLatestExplicitRuntimeBoundary",
  "initialCycleCorrection",
  "INITIAL_CYCLE_CORRECTION_NOT_ALLOWED",
  "INITIAL_CYCLE_CORRECTION_REQUIRED",
  "historicalInitialStop",
  "cycleStartRevision",
  "runtime_correction",
  "교체 전 정지 지속",
  "초기 정지시각 정정",
  "ensureHistoryRecoveryV12ArchiveCycleSchema",
  "__blowerHistoryTest"
]) {
  assert(
    blowerApi.includes(token),
    `Blower V13.2 API is missing ${token}.`
  );
}
assert(
  blowerGet.indexOf("if (authentication.user)") >= 0 &&
    blowerGet.indexOf("if (authentication.user)") <
      blowerGet.indexOf("ensureBlowerHistorySchemaReady"),
  "Blower anonymous GET can still initialize the schema."
);
for (const token of [
  "id: _id",
  "sourceLogId: _sourceLogId",
  "createdById: _createdById"
]) {
  assert(blowerApi.includes(token), `Blower public DTO is missing ${token}.`);
}
assertMutationAuthentication(
  blowerApi,
  "onRequestPost",
  "getAuthenticatedUser(context)"
);
assert(
  !blowerPageJs.includes("toISOString().slice(0, 16)"),
  "Blower frontend must not copy a UTC ISO value directly into datetime-local."
);

assert(
  plannedApi.includes("required: false") &&
    plannedApi.includes("rowsForPublicView") &&
    plannedApi.includes("sheetKey: rawSheetKey") &&
    plannedApi.includes("id: _id"),
  "Planned-maintenance anonymous DTO protection is incomplete."
);
assertMutationAuthentication(
  plannedApi,
  "onRequestPut",
  "getAuthenticatedUser"
);

const syntaxFiles = [
  "functions/api/blower-history.js",
  "functions/api/planned-maintenance.js",
  "functions/api/solid-fuel-trouble.js",
  "inspection-logs/daily/night-patrol/night-patrol-launcher.js",
  "maintenance/blower-history.js",
  "maintenance/planned-maintenance.js",
  "maintenance/shift-log-navigation.js",
  "maintenance/solid-fuel-trouble.js",
  "mobile-app/mobile-runtime-v14.js",
  "script.js"
];

for (const file of [
  ...syntaxFiles,
  "index.html",
  "mobile-app/index.html",
  "maintenance/blower-history.html",
  "maintenance/blower-history.css",
  "maintenance/planned-maintenance.html",
  "maintenance/solid-fuel-trouble.html"
]) {
  const source = read(file);
  assert(
    !/^(?:<<<<<<< .+|=======|>>>>>>> .+)$/m.test(source),
    `${file}: unresolved merge marker remains.`
  );
}

for (const file of syntaxFiles) {
  childProcess.execFileSync(
    process.execPath,
    ["--check", path.join(repositoryPath, file)],
    { stdio: "pipe" }
  );
}

for (const file of ["index.html", "mobile-app/index.html"]) {
  const source = read(file);
  const inlineScripts = [...source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(match => !/\bsrc\s*=/.test(match[1]));

  inlineScripts.forEach((match, index) => {
    new vm.Script(match[2], {
      filename: `${file}#inline-${index + 1}`
    });
  });
}

assert(
  blowerPageHtml.includes('<option value="startup">기동</option>') &&
    blowerPageHtml.includes('<option value="operation">기동·정지</option>') &&
    blowerPageHtml.includes('id="replacementStartupAt"') &&
    blowerPageHtml.includes('id="runtimeCycleSummary"') &&
    blowerPageHtml.includes('data-shift-log-return'),
  "Blower initial-state/KST/public-navigation HTML integration is incomplete."
);

console.log("Same-tab public-pages V3 verification passed.");
